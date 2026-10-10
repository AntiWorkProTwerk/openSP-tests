import {readFile,writeFile,mkdir,realpath,access} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {requireDisabled} from './run.mjs';

const here=dirname(fileURLToPath(import.meta.url)),opensp=resolve(here,'../..');
export const PORTABLE_CATALOG_SHA256='5a3fbbd3b96efc4993626f2d9a4ac619592c4ea6bb7f6fd14d21993da3ecc5cc';
export const PORTABLE_KIT06_CATALOG_SHA256='4e0f545043f00a6e1ad0431110e2a82726eace51a3c12be36b2221475d80cceb';
export const REVIEWED_PORTABLE_CATALOG_SHA256S=Object.freeze([PORTABLE_CATALOG_SHA256,PORTABLE_KIT06_CATALOG_SHA256]);
const admittedCatalogs=new Set(REVIEWED_PORTABLE_CATALOG_SHA256S);
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
const within=(root,path)=>{const child=relative(root,path);return child!==''&&!child.startsWith('..')&&!isAbsolute(child);};
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const held=value=>value.delivery==='DO_NOT_DELIVER'&&['source_redistribution_reviewed','source_promotion_authorized',
  'public_ready','native_hardware_qualified','device_operations'].every(key=>value[key]===false);
const write=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});

export function parsePortableArgs(args){
  const options={python:'python'},seen=new Set();
  const allowed=['python','private-root','evidence-root','kit-root','dependency-catalog','dependency-catalog-sha',
    'profile','family','family-sha','anchor-sha','official','stage-root','run'];
  for(let i=0;i<args.length;i+=2){
    const key=args[i]?.slice(2);
    need(args[i]?.startsWith('--')&&allowed.includes(key)&&args[i+1]&&!args[i+1].startsWith('--'),`Invalid portable argument ${args[i]??''}`);
    need(!seen.has(key),`Duplicate portable argument --${key}`);seen.add(key);options[key]=args[i+1];
  }
  need(allowed.filter(key=>key!=='python').every(key=>options[key]),'Supply every explicit portable root, input and admission pin.');
  need(/^[a-z0-9][a-z0-9_-]{0,31}$/.test(options.run),'Use a new portable run key of 1..32 lowercase letters, digits, hyphens or underscores.');
  need(['combined','synth-only','recorder-only'].includes(options.profile),'Portable profile is outside the three reviewed vectors.');
  for(const key of ['dependency-catalog-sha','family-sha','anchor-sha'])need(/^[a-f0-9]{64}$/.test(options[key]),`Invalid --${key} digest.`);
  need(admittedCatalogs.has(options['dependency-catalog-sha']),'Portable dependency catalog has no reviewed admission.');
  return options;
}

export async function checkedPortableCatalog(root,catalogPath,expected){
  need(admittedCatalogs.has(expected),'Portable dependency catalog has no reviewed admission.');
  const path=await realpath(resolve(catalogPath));need(within(root,path),'Dependency catalog escapes the private root.');
  const raw=await readFile(path);need(hash(raw)===expected,'Portable dependency catalog digest differs.');
  const catalog=JSON.parse(raw);
  need(exactKeys(catalog,['schema','version','status','dependencies','reviewed_bundle','evidence_root','profiles',
    'delivery','source_redistribution_reviewed','source_promotion_authorized','public_ready','native_hardware_qualified','device_operations'])&&
    catalog.schema==='opensp-private-portable-stage-dependency-catalog'&&catalog.version===1&&
    catalog.status==='PRIVATE_THREE_REVIEWED_VECTORS_ONLY'&&held(catalog),'Portable dependency catalog schema or holds differ.');
  need(exactKeys(catalog.dependencies,['stage','verifier','projection'])&&
    exactKeys(catalog.profiles,['combined','synth-only','recorder-only']),'Portable catalog dependency/profile registry differs.');
  const checked=[];
  async function pinned(ref){
    need(exactKeys(ref,['path','bytes','sha256'])&&typeof ref.path==='string'&&ref.path&&!ref.path.includes('\\')&&
      !isAbsolute(ref.path)&&!ref.path.includes(':')&&!ref.path.split('/').some(p=>['..','.',''].includes(p))&&
      Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&/^[a-f0-9]{64}$/.test(ref.sha256),'Malformed portable artifact pin.');
    const target=await realpath(resolve(root,ref.path));need(within(root,target)&&!within(opensp,target),'Portable artifact escapes the private external root.');
    const body=await readFile(target);need(body.length===ref.bytes&&hash(body)===ref.sha256,`Portable artifact pin differs: ${ref.path}`);
    checked.push(ref);return {path:target,raw:body};
  }
  const executables={};
  for(const [name,ref] of Object.entries(catalog.dependencies))executables[name]=(await pinned(ref)).path;
  await pinned(catalog.reviewed_bundle);
  for(const row of Object.values(catalog.profiles)){
    need(exactKeys(row,['family','anchor','kit_inventory','kit_root','candidate','selection']),'Portable profile registry fields differ.');
    for(const key of ['family','anchor','kit_inventory','candidate','selection'])await pinned(row[key]);
  }
  return {catalog,checked,executables,pinned,path};
}

export async function stagePortable(options){
  options=parsePortableArgs(Object.entries(options).flatMap(([key,value])=>value===undefined?[]:[`--${key}`,String(value)]));
  const root=await realpath(resolve(options['private-root']));
  need(root!==opensp&&!within(opensp,root)&&!within(root,opensp),'Private root must be separate from the website repository.');
  const input=await checkedPortableCatalog(root,options['dependency-catalog'],options['dependency-catalog-sha']);
  const {catalog}=input,row=catalog.profiles[options.profile];
  const evidence=await realpath(resolve(options['evidence-root'])),kit=await realpath(resolve(options['kit-root']));
  need(evidence===await realpath(resolve(root,catalog.evidence_root))&&within(root,evidence),'Explicit evidence root differs from the reviewed catalog.');
  need(kit===await realpath(resolve(root,row.kit_root))&&within(root,kit),'Explicit source kit root differs from the reviewed catalog.');
  const family=await realpath(resolve(options.family));
  need(family===(await input.pinned(row.family)).path&&options['family-sha']===row.family.sha256,'Portable family path/digest has no reviewed admission.');
  need(options['anchor-sha']===row.anchor.sha256,'Portable anchor digest has no reviewed admission.');
  const official=await realpath(resolve(options.official));
  need(!within(opensp,official),'Official firmware input must remain outside the website repository.');
  const officialRaw=await readFile(official),officialHash=hash(officialRaw);
  const stageRoot=await realpath(resolve(options['stage-root']));
  const buildRoot=await realpath(resolve(root,'build'));
  need(within(buildRoot,stageRoot)&&!within(opensp,stageRoot),'Stage root must be an explicit existing private build directory.');
  const output=resolve(stageRoot,options.run);
  try{await access(output);throw Error('Portable stage output already exists; choose a fresh run.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const selectionApi=await import(pathToFileURL(resolve(opensp,'src/lib/features/selection.ts')).href);
  const receiptApi=await import(pathToFileURL(resolve(opensp,'src/lib/features/buildReceipt.ts')).href);
  const modules=['src/lib/features/selection.ts','src/lib/features/buildReceipt.ts','tools/register-test-typescript.mjs',
    'tools/feature-picker-release-v1/run.mjs','tools/feature-picker-release-v1/portable-stage.mjs'];
  const modulePins=await Promise.all(modules.map(async path=>({path,sha256:hash(await readFile(resolve(opensp,path)))})));
  await mkdir(output,{recursive:false});
  try{
    const command=[input.executables.stage,'--private-root',root,'--evidence-root',evidence,'--kit-root',kit,
      '--catalog',input.path,'--catalog-sha',options['dependency-catalog-sha'],'--family',family,
      '--family-sha',options['family-sha'],'--anchor-sha',options['anchor-sha'],'--profile',options.profile,
      '--official',official,'--output',output];
    const child=spawnSync(options.python,['-I','-B',...command],{cwd:evidence,encoding:'utf8',
      windowsHide:true,shell:false,maxBuffer:8*1024*1024});
    need(!child.error&&child.status===0,`Pinned portable verifier refused: ${child.error?.message??child.stderr??child.stdout}`);
    const proof=JSON.parse(child.stdout.trim());
    need(proof.schema==='opensp-private-portable-stage-byte-proof-v1'&&proof.status==='PASS_PINNED_PORTABLE_SOURCE_AND_BYTES_STAGE'&&
      proof.profile===options.profile&&proof.family_sha256===options['family-sha']&&proof.anchor_sha256===options['anchor-sha']&&
      proof.dependency_catalog_sha256===options['dependency-catalog-sha']&&proof.official_input_sha256===officialHash&&
      proof.local_source_family_verified===true&&proof.local_artifact_verified===true&&proof.source_recompiled===false&&held(proof),
      'Private verifier result identity or holds differ.');
    async function staged(ref,name){
      const path=await realpath(resolve(root,ref.path));need(path===resolve(output,'stage',name),'Staged artifact path differs.');
      const raw=await readFile(path);need(raw.length===ref.bytes&&hash(raw)===ref.sha256,'Staged artifact digest differs.');return raw;
    }
    const candidate=await staged(proof.staged_candidate,'candidate.disabled.bin');
    const selectionRaw=await staged(proof.staged_selection,'selection.json');
    const receiptRaw=await staged(proof.staged_receipt,'receipt.json');
    need(hash(candidate)===row.candidate.sha256&&candidate.length===row.candidate.bytes&&hash(selectionRaw)===row.selection.sha256,
      'Staged candidate/selection differs from the reviewed vector.');
    const selection=selectionApi.readSelection(selectionRaw.toString('utf8'));
    need(selectionRaw.equals(Buffer.from(selectionApi.exportSelection(selection))),'Staged selection is not canonical.');
    const receipt=receiptApi.readLocalBuildReceipt(receiptRaw.toString('utf8'));requireDisabled(receipt);
    const inspection=await receiptApi.inspectLocalBuildReceipt(selection,receipt);
    need(inspection.valid&&inspection.matchesSelection&&inspection.issues.length===0,'Current website metadata inspector refused.');
    need(['sourceFamilyVerified','artifactVerified','downloadReady','uploadReady','releaseReady'].every(key=>inspection[key]===false),
      'Website inspection promotes verification or readiness.');
    need(receipt.candidate.sha256===hash(candidate)&&receipt.candidate.bytes===candidate.length,'Staged receipt candidate binding differs.');
    await checkedPortableCatalog(root,input.path,options['dependency-catalog-sha']);
    need(hash(await readFile(official))===officialHash,'Owner official input changed during staging.');
    for(const ref of modulePins)need(hash(await readFile(resolve(opensp,ref.path)))===ref.sha256,'Website/staging source changed during execution.');
    for(const [ref,name] of [[proof.staged_candidate,'candidate.disabled.bin'],[proof.staged_selection,'selection.json'],[proof.staged_receipt,'receipt.json']])await staged(ref,name);
    await write(resolve(output,'WEBSITE_INSPECTION.json'),inspection);
    const report={schema:'opensp-private-portable-local-stage-v1',status:'PASS_THREE_VECTOR_PORTABLE_LOCAL_STAGE',profile:options.profile,
      source_family_sha256:options['family-sha'],reviewed_anchor_sha256:options['anchor-sha'],dependency_catalog_sha256:options['dependency-catalog-sha'],
      private_stage_proof_sha256:hash(await readFile(resolve(output,'PRIVATE_STAGE_PROOF.json'))),
      candidate_sha256:hash(candidate),candidate_bytes:candidate.length,selection_sha256:hash(selectionRaw),receipt_sha256:hash(receiptRaw),
      current_source_pins:modulePins,private_dependencies:input.checked,portable_local_stage_verified:true,
      local_source_family_verified:true,local_artifact_verified:true,website_source_family_verified:false,website_artifact_verified:false,
      download_ready:false,upload_ready:false,release_ready:false,upload_enabled:false,release_eligible:false,
      legacy_staging_admitted:false,source_redistribution_reviewed:false,source_promotion_authorized:false,
      public_ready:false,native_hardware_qualified:false,source_recompiled:false,device_operations:false,delivery:'DO_NOT_DELIVER'};
    await write(resolve(output,'STAGE_REPORT.json'),report);return {...report,output};
  }catch(error){
    await write(resolve(output,'FAILED.json'),{status:'REFUSED_PORTABLE_LOCAL_STAGE',reason:error.message,delivery:'DO_NOT_DELIVER',device_operations:false});
    throw error;
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--help'))console.log('node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/portable-stage.mjs --private-root PRIVATE_WORKSPACE --evidence-root REVIEWED_EVIDENCE_ROOT --kit-root REVIEWED_KIT_ROOT --dependency-catalog PRIVATE_CATALOG --dependency-catalog-sha REVIEWED_DIGEST --profile combined|synth-only|recorder-only --family REVIEWED_FAMILY --family-sha REVIEWED_DIGEST --anchor-sha REVIEWED_DIGEST --official OWNER_V552_ZIP_OR_APP1 --stage-root EXISTING_PRIVATE_BUILD_DIRECTORY --run NEW_KEY [--python PYTHON]');
  else try{console.log(JSON.stringify(await stagePortable(parsePortableArgs(process.argv.slice(2))),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
