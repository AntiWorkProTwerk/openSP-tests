import {readFile,writeFile,realpath,access,readdir} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {requireDisabled} from './run.mjs';
const here=dirname(fileURLToPath(import.meta.url)),opensp=resolve(here,'../..');
export const REQUEST_BUILD_CLOSURE_SHA256='2f3a97ebbfc89c5f408301281bd848e2884eabf91cca95070224e25d4e8be54e';
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const need=(ok,why)=>{if(!ok)throw Error(why);};
const within=(root,path)=>{const child=relative(root,path);return child!==''&&!child.startsWith('..')&&!isAbsolute(child);};
const held=value=>value.delivery==='DO_NOT_DELIVER'&&['source_redistribution_reviewed','source_promotion_authorized',
 'public_ready','native_hardware_qualified','device_operations'].every(k=>value[k]===false);
const write=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
export function parseRequestBuildArgs(args){
 const options={},seen=new Set(),allowed=['private-root','dependency-root','kit-root','toolchain-root','python','selection','official','output-root','run'];
 for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2);need(args[i]?.startsWith('--')&&allowed.includes(key)&&args[i+1]&&!args[i+1].startsWith('--'),`Invalid request-build argument ${args[i]??''}`);need(!seen.has(key),`Duplicate --${key}`);seen.add(key);options[key]=args[i+1];}
 need(allowed.every(k=>options[k]),'Supply all explicit private roots, interpreter, canonical selection and official input.');
 need(/^[a-z0-9][a-z0-9_-]{0,31}$/.test(options.run),'Use a new request run key of 1..32 lowercase letters, digits, hyphens or underscores.');
 return options;
}
export async function checkedRequestBuildClosure(root,dependencyRoot,python){
 const base=await realpath(resolve(dependencyRoot));need(within(root,base)&&!within(opensp,base),'Dependencies must remain in the explicit private workspace.');
 const raw=await readFile(resolve(base,'EXECUTABLE_CLOSURE.json'));need(hash(raw)===REQUEST_BUILD_CLOSURE_SHA256,'Request executable closure has no reviewed admission.');
 const value=JSON.parse(raw);need(value.schema==='opensp-private-request-build-executable-closure-v1'&&value.version===2&&held(value)&&value.caller_families_admitted===false&&value.old_three_vector_admission_changed===false,'Request closure scope or holds differ.');
 const local=Object.keys(value.files).filter(name=>dirname(resolve(root,name))===base).map(name=>name.split('/').at(-1));
 need((await readdir(base)).sort().join('|')===[...local,'EXECUTABLE_CLOSURE.json'].sort().join('|'),'Private dependency directory contains unreviewed import alternatives.');
 const checked=[];
 for(const [name,pin] of Object.entries(value.files)){
  need(typeof name==='string'&&name&&!name.includes('\\')&&!name.includes(':')&&!isAbsolute(name)&&!name.split('/').some(v=>['..','.',''].includes(v)),'Request dependency path differs.');
  const path=await realpath(resolve(root,name));need(within(root,path)&&!within(opensp,path),'Request dependency escapes its private authority.');
  const bytes=await readFile(path);need(bytes.length===pin.bytes&&hash(bytes)===pin.sha256,`Request dependency changed: ${name}`);checked.push({path:name,...pin});
 }
 const launcher=await realpath(resolve(python)),fixedLauncher=await realpath(resolve(root,'../sp404mk2/.venv/Scripts/python.exe'));
 need(launcher===fixedLauncher&&hash(await readFile(launcher))===value.python_launcher_sha256,'Python interpreter is outside the fixed reviewed local environment.');
 const configuration=await readFile(resolve(dirname(launcher),'../pyvenv.cfg'));
 need(hash(configuration)===value.python_environment.configuration_sha256,'Python environment configuration changed.');
 const home=configuration.toString('utf8').match(/^home = (.+)$/m)?.[1]?.trim();need(home,'Python base runtime is missing.');
 for(const [name,digest] of Object.entries(value.python_environment.base_binary_files))need(hash(await readFile(resolve(home,name)))===digest,'Python base runtime binary changed.');
 const entry=resolve(base,'request_build.py');need(checked.some(row=>resolve(root,row.path)===entry),'Unpinned request entrypoint.');
 return {entry,launcher,checked};
}
export async function buildPortableRequest(options){
 options=parseRequestBuildArgs(Object.entries(options).flatMap(([k,v])=>[`--${k}`,String(v)]));
 const root=await realpath(resolve(options['private-root']));need(root!==opensp&&!within(opensp,root)&&!within(root,opensp),'Private workspace must be separate from OpenSP.');
 const closure=await checkedRequestBuildClosure(root,options['dependency-root'],options.python);
 const selectionPath=await realpath(resolve(options.selection)),official=await realpath(resolve(options.official));
 need(!within(opensp,official)&&!within(resolve(opensp,'public'),selectionPath)&&!within(resolve(opensp,'dist'),selectionPath),'Official bytes and selection inputs must remain outside website assets.');
 const api=await import(pathToFileURL(resolve(opensp,'src/lib/features/selection.ts')).href);
 const raw=await readFile(selectionPath);need(raw.length<=api.MAX_IMPORT_BYTES,'Selection exceeds the public import limit.');
 const selection=api.readSelection(raw.toString('utf8'));need(raw.equals(Buffer.from(api.exportSelection(selection))),'Use exact current canonical export bytes.');
 need(selection.profile==='roland-5.52'&&selection.features.length>0&&selection.features.every(f=>['synth','usb-recorder'].includes(f.id)),'Only supported Roland v5.52 Synth/recorder selections can build.');
 const kit=await realpath(resolve(options['kit-root'])),tools=await realpath(resolve(options['toolchain-root']));need(within(root,kit),'Source kit must belong to the private workspace.');
 need(tools===await realpath(resolve(root,'../sp404mk2/toolchains')),'Only the fixed reviewed installed toolchain is admitted.');
 const outputRoot=await realpath(resolve(options['output-root'])),buildRoot=await realpath(resolve(root,'build'));need(within(buildRoot,outputRoot),'Output root must be an existing owned private build directory.');
 const output=resolve(outputRoot,options.run);try{await access(output);throw Error('Request output exists; choose a new key.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const officialHash=hash(await readFile(official));
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['SYSTEMROOT','WINDIR','TEMP','TMP'].includes(k.toUpperCase())));
 env.PATH=resolve(tools,'bin')+';'+resolve(process.env.SystemRoot??process.env.SYSTEMROOT,'System32');
 const bootstrap='import sys;sys.path.insert(0,sys.argv.pop(1));entry=sys.argv.pop(1);sys.argv[0]=entry;import runpy;runpy.run_path(entry,run_name="__main__")';
 const args=['-I','-B','-c',bootstrap,dirname(closure.entry),closure.entry,'--private-root',root,'--kit-root',kit,'--toolchain-root',tools,
  '--selection',selectionPath,'--official',official,'--output',output,'--closure-sha',REQUEST_BUILD_CLOSURE_SHA256];
 const child=spawnSync(closure.launcher,args,{cwd:dirname(closure.entry),env,encoding:'utf8',shell:false,windowsHide:true,maxBuffer:12*1024*1024});
 need(!child.error&&child.status===0,`Request build refused: ${child.error?.message??child.stderr??child.stdout}`);
 const result=JSON.parse(child.stdout.trim());
 need(result.schema==='opensp-private-request-build-result-v1'&&result.status==='PASS_REQUEST_BOUND_SOURCE_AND_ARTIFACT_BUILD'&&held(result)&&
  result.executable_closure_sha256===REQUEST_BUILD_CLOSURE_SHA256&&result.selection_sha256===hash(raw)&&result.local_source_family_verified===true&&result.local_artifact_verified===true,'Request result identity, proof or holds differ.');
 async function artifact(ref,name){const path=await realpath(resolve(root,ref.path));need(path===resolve(output,'evidence/stage',name),'Request stage path differs.');const bytes=await readFile(path);need(bytes.length===ref.bytes&&hash(bytes)===ref.sha256,'Request artifact bytes differ.');return bytes;}
 const candidate=await artifact(result.candidate,'candidate.disabled.bin'),saved=await artifact(result.selection,'selection.json'),receiptRaw=await artifact(result.receipt,'receipt.json');need(saved.equals(raw),'Request stage changes the canonical selection.');
 const receiptApi=await import(pathToFileURL(resolve(opensp,'src/lib/features/buildReceipt.ts')).href),receipt=receiptApi.readLocalBuildReceipt(receiptRaw.toString('utf8'));requireDisabled(receipt);
 const inspection=await receiptApi.inspectLocalBuildReceipt(selection,receipt);need(inspection.valid&&inspection.matchesSelection&&inspection.issues.length===0,'Current website metadata inspector refused this request.');
 need(['sourceFamilyVerified','artifactVerified','downloadReady','uploadReady','releaseReady'].every(k=>inspection[k]===false),'Website inspection promotes request authority.');
 need(receipt.candidate.sha256===hash(candidate)&&receipt.candidate.bytes===candidate.length,'Request receipt candidate identity differs.');
 await checkedRequestBuildClosure(root,options['dependency-root'],options.python);need(hash(await readFile(official))===officialHash&&(await readFile(selectionPath)).equals(raw),'Request input changed during build/verification.');
 await write(resolve(output,'WEBSITE_INSPECTION.json'),inspection);
 const report={...result,schema:'opensp-request-bound-portable-local-build-v1',status:'PASS_CANONICAL_REQUEST_LOCAL_BUILD_AND_WEBSITE_METADATA',
  private_dependencies:closure.checked,candidate_sha256:hash(candidate),selection_sha256:hash(raw),receipt_sha256:hash(receiptRaw),
  website_source_family_verified:false,website_artifact_verified:false,download_ready:false,upload_ready:false,release_ready:false};
 await write(resolve(output,'STAGE_REPORT.json'),report);return {...report,output};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--help'))console.log('node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/portable-build.mjs --private-root PRIVATE_WORKSPACE --dependency-root REVIEWED_PRIVATE_DEPENDENCIES --kit-root REVIEWED_KIT --toolchain-root PINNED_ARM_ROOT --python PINNED_PYTHON --selection CANONICAL_EXPORT --official OWNER_V552 --output-root EXISTING_PRIVATE_BUILD_DIRECTORY --run NEW_KEY');
 else try{console.log(JSON.stringify(await buildPortableRequest(parseRequestBuildArgs(process.argv.slice(2))),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
