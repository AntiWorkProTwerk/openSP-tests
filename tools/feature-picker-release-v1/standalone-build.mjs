import {readFile,writeFile,mkdir,realpath,readdir,access} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {readSelection,exportSelection,rejectDuplicateJsonKeys,MAX_IMPORT_BYTES} from '../../src/lib/features/selection.ts';

const opensp=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const SOURCE_ARCHIVE_PIN=Object.freeze({bytes:1032317,sha256:'3abb90aafe7ecc1ca669a3f3e35885ddbf3803200db96768ef43fdd16b424117'});
export const SOURCE_AUTHORITY_SHA256='ef933914f014d27ba18632906423546aa2394e281167e231314bd59eccd95ed5';
export const LAUNCHER_PIN=Object.freeze({bytes:8933,sha256:'74c95a38c9bdce75b8842b214774eabc083bf69f5e04507ec724c1906ed13744'});
const RESTORE_SHA='7f9917ffb0871cca25b1ce5d281ac5c2bf790ae6b8278b04a5ffef8e3c06fd60';
const hash=body=>createHash('sha256').update(body).digest('hex');
const need=(value,why)=>{if(!value)throw Error(why);};
const inside=(root,path)=>{const child=relative(root,path);return child===''||(!child.startsWith('..')&&!isAbsolute(child));};
const holds=['source_promotion_authorized','source_redistribution_reviewed','public_ready','native_hardware_qualified',
 'browser_build_enabled','browser_upload_enabled','website_source_family_verified','website_artifact_verified',
 'download_ready','upload_ready','release_ready','device_operations'];
const save=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const exists=async path=>{try{await access(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const pinMatches=(body,pin)=>body.length===pin.bytes&&hash(body)===pin.sha256;
const json=body=>{const text=body.toString('utf8');rejectDuplicateJsonKeys(text);const value=JSON.parse(text);need(value&&typeof value==='object'&&!Array.isArray(value),'Expected an object receipt.');return value;};

export function parseStandaloneArgs(args){
 const allowed=['source-archive','python','toolchain-root','selection','official','output'],result={};
 for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2);need(args[i]?.startsWith('--')&&allowed.includes(key)&&args[i+1]&&!args[i+1].startsWith('--'),`Invalid standalone argument ${args[i]??''}`);need(!Object.hasOwn(result,key),`Duplicate --${key}`);result[key]=args[i+1];}
 need(allowed.every(key=>result[key]),'Supply source archive, matching Python/tools, canonical selection, official firmware and new output.');return result;
}

/** Decode only the single code-admitted archive; no caller inventory or hash. */
export function checkedSourceArchive(raw){
 need(pinMatches(raw,SOURCE_ARCHIVE_PIN),'Standalone source archive has no reviewed admission.');
 const end=raw.length-22;need(raw.readUInt32LE(end)===0x06054b50&&raw.readUInt16LE(end+20)===0,'Source ZIP end record differs.');
 const count=raw.readUInt16LE(end+10),central=raw.readUInt32LE(end+16),size=raw.readUInt32LE(end+12);
 need(count===12&&raw.readUInt16LE(end+4)===0&&raw.readUInt16LE(end+6)===0&&raw.readUInt16LE(end+8)===count&&central+size===end,'Source ZIP layout differs.');
 const members=new Map();let at=central;
 for(let index=0;index<count;index++){
  need(at+46<=end&&raw.readUInt32LE(at)===0x02014b50,'Source ZIP directory differs.');
  const flags=raw.readUInt16LE(at+8),method=raw.readUInt16LE(at+10),compressed=raw.readUInt32LE(at+20),bytes=raw.readUInt32LE(at+24),namesize=raw.readUInt16LE(at+28),extra=raw.readUInt16LE(at+30),comment=raw.readUInt16LE(at+32),offset=raw.readUInt32LE(at+42);
  const mode=raw.readUInt32LE(at+38)>>>16,name=raw.subarray(at+46,at+46+namesize).toString('utf8');
  need(at+46+namesize+extra+comment<=end&&/^[A-Za-z0-9_.-]+$/.test(name)&&!['.','..'].includes(name)&&!members.has(name)&&[0,0x8000].includes(mode&0xf000)&&flags===0&&[0,8].includes(method)&&bytes<=2*1024*1024,'Source ZIP member path/type differs.');
  need(offset+30<=central&&raw.readUInt32LE(offset)===0x04034b50&&raw.readUInt16LE(offset+6)===flags&&raw.readUInt16LE(offset+8)===method,'Source ZIP local header differs.');
  const localName=raw.readUInt16LE(offset+26),localExtra=raw.readUInt16LE(offset+28),start=offset+30+localName+localExtra;
  need(raw.subarray(offset+30,offset+30+localName).toString('utf8')===name&&start+compressed<=central,'Source ZIP local member differs.');
  const encoded=raw.subarray(start,start+compressed),body=method===8?inflateRawSync(encoded,{maxOutputLength:2*1024*1024}):encoded;
  need(body.length===bytes,'Source ZIP member extent differs.');members.set(name,body);at+=46+namesize+extra+comment;
 }
 need(at===end&&hash(members.get('AUTHORITY.json')??Buffer.alloc(0))===SOURCE_AUTHORITY_SHA256&&pinMatches(members.get('launch.py')??Buffer.alloc(0),LAUNCHER_PIN),'Source authority or trusted launcher differs.');
 const authority=json(members.get('AUTHORITY.json'));
 need(authority.schema==='opensp-standalone-owned-source-authority-v1'&&authority.caller_source_authority_admitted===false&&authority.historical_artifacts_required===false&&authority.public_ready===false&&authority.source_promotion_authorized===false&&authority.native_hardware_qualified===false&&authority.device_operations===false&&authority.delivery==='DO_NOT_DELIVER','Source authority scope differs.');
 const expected=[...Object.keys(authority.files),'AUTHORITY.json','launch.py'].sort();need([...members.keys()].sort().join('|')===expected.join('|'),'Source bundle file set differs.');
 for(const [name,pin] of Object.entries(authority.files))need(pinMatches(members.get(name),pin),`Source bundle member changed: ${name}`);
 return {authority,members};
}

export async function canonicalStandaloneSelection(path){
 const raw=await readFile(path);need(raw.length<=MAX_IMPORT_BYTES,'Selection exceeds the canonical import limit.');
 const selection=readSelection(raw.toString('utf8'));need(raw.equals(Buffer.from(exportSelection(selection))),'Use exact current canonical OpenSP export bytes.');
 need(selection.profile==='roland-5.52'&&selection.features.length>0&&selection.features.every(feature=>['synth','usb-recorder'].includes(feature.id)),'Only supported Roland v5.52 Synth/recorder selections can build.');return {raw,selection};
}

export function launcherArguments(bundle,request){
 return ['-I','-S','-B',resolve(bundle,'launch.py'),'--official',request.official,'--selection',request.selection,
  '--toolchain-root',request.tools,'--output',request.build];
}
export function invokeStandaloneLauncher(python,args,{cwd,env},execute=spawnSync){
 return execute(python,args,{cwd,env,encoding:'utf8',shell:false,windowsHide:true,maxBuffer:24*1024*1024});
}

/** Inspect a current standalone transaction; this is not browser family admission. */
export async function inspectStandaloneBuild(build,{authority,selectionRaw,officialHash}){
 build=await realpath(build);
 async function bytes(name){const expected=resolve(build,name),path=await realpath(expected);need(path===expected&&inside(build,path),'Standalone artifact escaped its transaction.');return readFile(path);}
 const reportRaw=await bytes('REPORT.json'),report=json(reportRaw),transaction=json(await bytes('TRANSACTION.json'));
 need(report.schema==='opensp-standalone-owned-source-build-proof-v1'&&report.status==='PASS_FRESH_SELECTED_AND_AUTHENTIC_P6S_SOURCE_BUILD_AND_BYTE_REPLAY'&&report.authority_sha256===SOURCE_AUTHORITY_SHA256&&report.delivery==='DO_NOT_DELIVER'&&holds.every(key=>report[key]===false),'Standalone success receipt scope or holds differ.');
 need(report.source_recompiled===true&&report.selected_observed_compile_units===151&&report.restoration_observed_compile_units===27&&report.toolchain_inputs_checked===1874&&report.historical_artifacts_read===false&&report.captured_images_read===false&&report.compiler_binaries_packaged===false&&report.standalone_local_source_dependency_closure===true,'Standalone execution/source scope differs.');
 need(report.python_role?.version==='3.12.14'&&['isolated','site_disabled','bytecode_disabled','role_bound'].every(key=>report.python_role[key]===true)&&report.python_role.stdlib_and_os_reads_traced===false,'Standalone Python role scope differs.');
 need(transaction.schema==='opensp-standalone-owned-source-transaction-v1'&&transaction.authority_sha256===SOURCE_AUTHORITY_SHA256&&transaction.selection_sha256===hash(selectionRaw)&&transaction.official_sha256===officialHash&&transaction.selected_archive_sha256===authority.roles.selected.archive_sha256&&transaction.restore_archive_sha256===authority.roles.restore.archive_sha256&&transaction.public_ready===false&&transaction.device_operations===false&&transaction.delivery==='DO_NOT_DELIVER','Standalone transaction is not bound to supplied inputs.');
 need(report.selection_sha256===hash(selectionRaw)&&(await bytes('selection.json')).equals(selectionRaw)&&report.configuration_sha256===hash(await bytes('selected-build/config.bin')),'Standalone canonical selection/configuration differs.');
 const selected=report.selected,restore=report.restoration;
 need(selected.status==='PASS_STANDALONE_FRESH_SELECTED_SOURCE_AND_BYTES'&&selected.sources_checked===345&&selected.objects_checked===151&&selected.native_interval_groups_checked===241&&selected.native_recipe_patches===269&&selected.included_official_extractions_checked===2&&selected.allocation_request_bytes===142399&&selected.arena_capacity_bytes===142392&&selected.artifact_verified_locally===true&&selected.fresh_compile_execution_attested_by_verifier===false,'Standalone selected verifier scope differs.');
 need(restore.status==='PASS_FRESH_AUTHENTIC_P6S_SOURCE_AND_BYTE_REPLAY'&&restore.compile_units===27&&restore.source_files_checked===119&&restore.official_extraction_intervals===14&&restore.symbolic_patches===45&&restore.restoration_sha256===RESTORE_SHA&&restore.authentic_identity_hash_matches===true&&restore.new_device_qualification===false,'Standalone restoration verifier scope differs.');
 for(const proof of [selected,restore])need(proof.public_ready===false&&proof.device_operations===false&&proof.delivery==='DO_NOT_DELIVER','Standalone verifier promotes delivery.');
 need(selected.native_hardware_qualified===false&&selected.website_source_family_verified===false&&selected.website_artifact_verified===false&&selected.legacy_staging_admitted===false,'Standalone verifier promotes native/browser authority.');
 const artifacts={};
 for(const [role,name,digest,length] of [['candidate','selected-build/candidate.disabled.bin',selected.candidate_sha256,selected.candidate_bytes],['restoration','restore-build/restore-p6s.disabled.bin',restore.restoration_sha256,restore.restoration_bytes]]){
  const body=await bytes(name);need(body.length===length&&hash(body)===digest,`Standalone ${role} bytes differ from verifier.`);artifacts[role]={path:name,bytes:body.length,sha256:hash(body)};
 }
 const parent=json(await bytes('READ_BOUNDARY.json'));
 need(parent.status==='PASS'&&parent.parent_python_reads_outside_roles===0&&parent.historical_artifacts_read===false&&parent.captured_images_read===false&&parent.compiler_internal_reads_traced===false&&parent.os_stdlib_reads_attested===false&&parent.source_helpers_loaded_from_authenticated_bodies===true&&parent.child_roles?.length===2&&parent.child_roles.every(role=>role==='isolated-reviewed-python-role'),'Standalone parent read boundary differs.');
 for(const role of ['selected','restore']){
  const boundary=json(await bytes(`${role}-build/READ_BOUNDARY.json`));need(boundary.status==='PASS'&&boundary.python_reads_outside_boundary===0&&boundary.historical_artifact_read===false&&boundary.captured_image_read===false,'Standalone child read boundary differs.');
  const contract=authority.roles[role];
  need(Object.keys(boundary.code_sha256).sort().join('|')===contract.helpers.map(name=>name+'.py').sort().join('|'),'Standalone child helper ledger differs.');
  for(const [name,digest] of Object.entries(boundary.code_sha256))need(digest===contract.members[name]?.sha256,'Standalone child helper identity differs.');
  const source=resolve(build,'sources',role,'source'),names=[];
  async function walk(folder,prefix=''){for(const entry of await readdir(folder,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())await walk(resolve(folder,entry.name),name+'/');else{need(entry.isFile(),'Standalone source contains a link or foreign entry.');names.push(name);}}}
  await walk(source);const original=Object.entries(contract.members).filter(([,pin])=>pin.original);
  need(names.sort().join('|')===original.map(([name])=>name).sort().join('|'),'Standalone source namespace differs.');
  for(const [name,pin] of Object.entries(contract.members)){
   const path=`sources/${role}/${pin.original?'source/':''}${name}`;need(pinMatches(await bytes(path),pin),`Standalone source/license identity differs: ${role}/${name}`);
  }
 }
 return {schema:'opensp-standalone-local-inspection-v1',status:'PASS_STANDALONE_SOURCE_AND_ARTIFACT_RECEIPTS',authority_sha256:SOURCE_AUTHORITY_SHA256,
  selection_sha256:hash(selectionRaw),standalone_report_sha256:hash(reportRaw),artifacts,selected_observed_compile_units:151,restoration_observed_compile_units:27,
  source_promotion_authorized:false,source_redistribution_reviewed:false,public_ready:false,native_hardware_qualified:false,browser_build_enabled:false,browser_upload_enabled:false,
  website_source_family_verified:false,website_artifact_verified:false,download_ready:false,upload_ready:false,release_ready:false,device_operations:false,delivery:'DO_NOT_DELIVER',
  limits:['OS/Python standard-library and compiler-internal reads remain untraced.','Source origin labels are not independent authorship attestations.','Standalone source receipts have no current browser source-family admission or native/hardware/USB delivery qualification.']};
}

export async function buildStandalone(options,{execute=spawnSync}={}){
 options=parseStandaloneArgs(Object.entries(options).flatMap(([key,value])=>[`--${key}`,String(value)]));
 const archive=await realpath(resolve(options['source-archive'])),python=await realpath(resolve(options.python)),tools=await realpath(resolve(options['toolchain-root']));
 const official=await realpath(resolve(options.official)),selection=await realpath(resolve(options.selection));
 const output=resolve(await realpath(dirname(resolve(options.output))),resolve(options.output).split(/[\\/]/).at(-1));
 need(!inside(opensp,output)&&!inside(opensp,official)&&![archive,selection].some(path=>inside(resolve(opensp,'public'),path)||inside(resolve(opensp,'dist'),path)),'Source/firmware outputs and inputs must remain outside website assets.');
 need(!await exists(output)&&![archive,python,tools,official,selection].some(path=>inside(output,path)),'Use a new output separate from source/tool/input authority.');
 const sourceRaw=await readFile(archive),{authority,members}=checkedSourceArchive(sourceRaw),{raw}=await canonicalStandaloneSelection(selection);
 need(authority.python_role.launcher_sha256.includes(hash(await readFile(python))),'Python launcher has no reviewed binary role.');
 const officialHash=hash(await readFile(official));await mkdir(output);const bundle=resolve(output,'source-bundle');await mkdir(bundle);
 for(const [name,body] of members)await writeFile(resolve(bundle,name),body,{flag:'wx'});
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['SYSTEMROOT','WINDIR','TEMP','TMP'].includes(key.toUpperCase())));
 env.PATH=resolve(tools,'bin')+';'+resolve(process.env.SystemRoot??process.env.SYSTEMROOT,'System32');
 const build=resolve(output,'build'),args=launcherArguments(bundle,{official,selection,tools,build});
 const child=invokeStandaloneLauncher(python,args,{cwd:bundle,env},execute);
 await writeFile(resolve(output,'launcher.stdout.log'),child.stdout??'',{flag:'wx'});await writeFile(resolve(output,'launcher.stderr.log'),child.stderr??'',{flag:'wx'});
 try{
  need(!child.error&&child.status===0,`Standalone launcher refused (exit ${child.status??'unknown'}). Inspect local launcher logs.`);
  const stdout=json(Buffer.from(child.stdout));const saved=json(await readFile(resolve(build,'REPORT.json')));need(JSON.stringify(stdout)===JSON.stringify(saved),'Launcher stdout differs from its saved success report.');
  const inspection=await inspectStandaloneBuild(build,{authority,selectionRaw:raw,officialHash});
  need((await readFile(archive)).equals(sourceRaw)&&(await readFile(selection)).equals(raw)&&hash(await readFile(official))===officialHash,'Standalone inputs changed during execution.');
  for(const [name,body] of members)need((await readFile(resolve(bundle,name))).equals(body),'Extracted standalone source authority changed during execution.');
  await save(resolve(output,'LOCAL_BUILD_REPORT.json'),{...inspection,source_archive:SOURCE_ARCHIVE_PIN,trusted_launcher:LAUNCHER_PIN,build:'build',source_bundle:'source-bundle',source_recompiled:true});return {...inspection,output};
 }catch(error){
  await save(resolve(output,'REFUSAL_REPORT.json'),{schema:'opensp-standalone-local-refusal-v1',status:'REFUSED',reason:error.message,
   child_invoked:true,child_exit_status:child.status??null,compiler_calls:null,partial_source_materialization:await exists(resolve(build,'sources')),
   selected_candidate_created:await exists(resolve(build,'selected-build/candidate.disabled.bin')),success_report_accepted:false,
   source_promotion_authorized:false,public_ready:false,native_hardware_qualified:false,browser_build_enabled:false,browser_upload_enabled:false,device_operations:false,delivery:'DO_NOT_DELIVER'});throw error;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.slice(2).join(' ')==='--help')console.log('node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/standalone-build.mjs --source-archive REVIEWED_SOURCE.zip --python MATCHING_PYTHON.exe --toolchain-root MATCHING_ARM_ROOT --selection CANONICAL_EXPORT.json --official OWNER_V552.zip --output NEW_LOCAL_OUTPUT');
 else try{console.log(JSON.stringify(await buildStandalone(parseStandaloneArgs(process.argv.slice(2))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
