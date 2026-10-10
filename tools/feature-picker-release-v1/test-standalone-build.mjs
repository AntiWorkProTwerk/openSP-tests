import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {blankSelection,defaultChoice,exportSelection} from '../../src/lib/features/selection.ts';
import {parseStandaloneArgs,checkedSourceArchive,canonicalStandaloneSelection,launcherArguments,invokeStandaloneLauncher,
 inspectStandaloneBuild,buildStandalone,SOURCE_ARCHIVE_PIN,SOURCE_AUTHORITY_SHA256,LAUNCHER_PIN} from './standalone-build.mjs';

const hash=body=>createHash('sha256').update(body).digest('hex');
const args=['--source-archive','source.zip','--python','python.exe','--toolchain-root','arm-root','--selection','selection.json','--official','owner.zip','--output','new-output'];
async function owned(fn){
 const base=await realpath(tmpdir()),path=await mkdtemp(resolve(base,'opensp-standalone-test-'));
 try{return await fn(path);}finally{
  const actual=await realpath(path),child=relative(base,actual);
  assert(!isAbsolute(child)&&!child.includes('/')&&!child.includes('\\')&&child.startsWith('opensp-standalone-test-'));
  await rm(actual,{recursive:true});
 }
}
test('standalone parser accepts only the six explicit transaction inputs',()=>assert.equal(parseStandaloneArgs(args).output,'new-output'));
for(const key of ['family','source-list','macro','candidate-sha','authority-sha','tool-hash','private-root','dependency-root'])
 test(`standalone parser refuses caller --${key}`,()=>assert.throws(()=>parseStandaloneArgs([...args,`--${key}`,'unadmitted']),/Invalid standalone argument/));
test('standalone parser refuses duplicate and missing inputs',()=>{
 assert.throws(()=>parseStandaloneArgs([...args,'--selection','another']),/Duplicate/);
 assert.throws(()=>parseStandaloneArgs(args.slice(0,-2)),/Supply/);
});
test('source archive digest refusal precedes decoding',()=>{
 assert.throws(()=>checkedSourceArchive(Buffer.alloc(SOURCE_ARCHIVE_PIN.bytes)),/no reviewed admission/);
 assert.throws(()=>checkedSourceArchive(Buffer.from('not an archive')),/no reviewed admission/);
});
test('canonical website selection must retain exact bytes and supported features',async()=>owned(async dir=>{
 const selection=blankSelection();selection.features=[defaultChoice('synth')];const canonical=exportSelection(selection),path=resolve(dir,'selection.json');
 await writeFile(path,canonical);assert.equal((await canonicalStandaloneSelection(path)).selection.features[0].id,'synth');
 await writeFile(path,canonical+'\n');await assert.rejects(canonicalStandaloneSelection(path),/exact current canonical/);
 const extra={...selection,authority_sha256:SOURCE_AUTHORITY_SHA256};await writeFile(path,JSON.stringify(extra));await assert.rejects(canonicalStandaloneSelection(path),/version 2 configuration/);
 await writeFile(path,exportSelection(blankSelection()));await assert.rejects(canonicalStandaloneSelection(path),/Only supported/);
}));
test('structured launch preserves arguments with spaces/metacharacters through an actual inert child',()=>{
 const request={official:'owner & firmware.zip',selection:'selection $ name.json',tools:'Arm root',build:'new output'},launch=launcherArguments('source bundle',request);let observed;
 const result=invokeStandaloneLauncher(process.execPath,launch,{cwd:process.cwd(),env:process.env},(program,values,options)=>{
  observed={program,values,options};return spawnSync(process.execPath,['-e','process.stdout.write(JSON.stringify(process.argv.slice(1)));process.exit(23)','--',...values],options);
 });
 assert.equal(result.status,23);assert.deepEqual(JSON.parse(result.stdout),launch);assert.equal(observed.program,process.execPath);
 assert.deepEqual(launch.slice(0,3),['-I','-S','-B']);assert.equal(observed.options.shell,false);assert.equal(observed.options.windowsHide,true);
 assert(launch.includes(request.official)&&launch.includes(request.selection)&&launch.includes(request.tools)&&launch.includes(request.build));
});

// Owner-local integration inputs are explicit environment variables, never repo
// paths or caller hash grants. These cases read the retained fresh transaction.
const archivePath=process.env.OPENSP_STANDALONE_ARCHIVE,buildPath=process.env.OPENSP_STANDALONE_BUILD,
 officialPath=process.env.OPENSP_STANDALONE_OFFICIAL,pythonPath=process.env.OPENSP_STANDALONE_PYTHON,
 toolsPath=process.env.OPENSP_STANDALONE_TOOLS;
const integration=archivePath&&buildPath&&officialPath&&pythonPath&&toolsPath;
test('actual admitted bundle preserves twelve pinned source/license files',{skip:!integration},async()=>{
 const raw=await readFile(archivePath),{members,authority}=checkedSourceArchive(raw);assert.equal(members.size,12);
 assert.equal(hash(members.get('launch.py')),LAUNCHER_PIN.sha256);assert.equal(hash(members.get('AUTHORITY.json')),SOURCE_AUTHORITY_SHA256);
 assert(members.get('LICENSE').includes('AntiWorkProTwerk')&&members.get('NOTICE').includes('Roland'));
 assert.equal(authority.selected_source_count+authority.restoration_source_count,505);
 const changed=Buffer.from(raw);changed[0]^=1;assert.throws(()=>checkedSourceArchive(changed),/no reviewed admission/);
});
test('actual fresh151+27 receipt inspection retains all browser/device/public holds',{skip:!integration},async()=>{
 const {authority}=checkedSourceArchive(await readFile(archivePath)),selectionRaw=await readFile(resolve(buildPath,'selection.json'));
 const result=await inspectStandaloneBuild(buildPath,{authority,selectionRaw,officialHash:hash(await readFile(officialPath))});
 assert.equal(result.status,'PASS_STANDALONE_SOURCE_AND_ARTIFACT_RECEIPTS');assert.equal(result.selected_observed_compile_units,151);assert.equal(result.restoration_observed_compile_units,27);
 for(const key of ['public_ready','native_hardware_qualified','browser_build_enabled','browser_upload_enabled','device_operations','website_source_family_verified','website_artifact_verified','download_ready','upload_ready','release_ready'])assert.equal(result[key],false);
});
test('normal wrapper refuses an output in website public assets before invoking a child',{skip:!integration},async()=>{
 const output=resolve('public','owned-denied-standalone-output');let invoked=false;
 await assert.rejects(buildStandalone({'source-archive':archivePath,python:pythonPath,'toolchain-root':toolsPath,
  selection:resolve(buildPath,'selection.json'),official:officialPath,output},{execute:()=>{invoked=true;throw Error('Must not launch');}}),/outside website assets/);
 assert.equal(invoked,false);await assert.rejects(readFile(resolve(output,'LOCAL_BUILD_REPORT.json')),/ENOENT/);
});
for(const flag of ['public_ready','native_hardware_qualified','device_operations','browser_build_enabled'])
 test(`actual saved receipt refuses promoted ${flag}`,{skip:!integration},async()=>owned(async dir=>{
  const {authority}=checkedSourceArchive(await readFile(archivePath)),report=JSON.parse(await readFile(resolve(buildPath,'REPORT.json')));report[flag]=true;
  await writeFile(resolve(dir,'REPORT.json'),JSON.stringify(report));await writeFile(resolve(dir,'TRANSACTION.json'),await readFile(resolve(buildPath,'TRANSACTION.json')));
  await assert.rejects(inspectStandaloneBuild(dir,{authority,selectionRaw:await readFile(resolve(buildPath,'selection.json')),officialHash:hash(await readFile(officialPath))}),/scope or holds/);
 }));
test('actual saved transaction refuses an unrelated official input digest',{skip:!integration},async()=>{
 const {authority}=checkedSourceArchive(await readFile(archivePath));
 await assert.rejects(inspectStandaloneBuild(buildPath,{authority,selectionRaw:await readFile(resolve(buildPath,'selection.json')),officialHash:'0'.repeat(64)}),/bound to supplied inputs/);
});
test('actual saved receipt refuses unrelated candidate bytes',{skip:!integration},async()=>owned(async dir=>{
 const {authority}=checkedSourceArchive(await readFile(archivePath));await mkdir(resolve(dir,'selected-build'));
 for(const name of ['REPORT.json','TRANSACTION.json','selection.json','selected-build/config.bin'])await writeFile(resolve(dir,name),await readFile(resolve(buildPath,name)));
 await writeFile(resolve(dir,'selected-build/candidate.disabled.bin'),Buffer.alloc(0));
 await assert.rejects(inspectStandaloneBuild(dir,{authority,selectionRaw:await readFile(resolve(buildPath,'selection.json')),officialHash:hash(await readFile(officialPath))}),/candidate bytes differ/);
}));
test('normal wrapper invokes only the inert child and preserves a refusal report',{skip:!integration},async()=>owned(async dir=>{
 const output=resolve(dir,'refused'),options={'source-archive':archivePath,python:pythonPath,'toolchain-root':toolsPath,
  selection:resolve(buildPath,'selection.json'),official:officialPath,output};let observed;
 await assert.rejects(buildStandalone(options,{execute:(program,values,settings)=>{
  observed={program,values,settings};return spawnSync(process.execPath,['-e','process.stdout.write(JSON.stringify(process.argv.slice(1)));process.exit(23)','--',...values],settings);
 }}),/launcher refused/);
 assert.deepEqual(observed.values.slice(0,3),['-I','-S','-B']);assert.equal(observed.settings.shell,false);
 assert.equal(observed.settings.env.PYTHONPATH,undefined);assert.equal(observed.settings.env.PYTHONHOME,undefined);
 const refusal=JSON.parse(await readFile(resolve(output,'REFUSAL_REPORT.json')));assert.equal(refusal.child_exit_status,23);assert.equal(refusal.selected_candidate_created,false);assert.equal(refusal.success_report_accepted,false);assert.equal(refusal.compiler_calls,null);
 for(const key of ['public_ready','device_operations','native_hardware_qualified','browser_build_enabled','browser_upload_enabled'])assert.equal(refusal[key],false);
 await assert.rejects(readFile(resolve(output,'LOCAL_BUILD_REPORT.json')),/ENOENT/);
 assert.equal(hash(await readFile(resolve(output,'source-bundle/launch.py'))),LAUNCHER_PIN.sha256);
 const archive=checkedSourceArchive(await readFile(archivePath));for(const name of ['LICENSE','NOTICE'])assert((await readFile(resolve(output,'source-bundle',name))).equals(archive.members.get(name)));
}));
test('a child success claim without its fresh transaction is refused',{skip:!integration},async()=>owned(async dir=>{
 const output=resolve(dir,'missing-transaction');
 await assert.rejects(buildStandalone({'source-archive':archivePath,python:pythonPath,'toolchain-root':toolsPath,selection:resolve(buildPath,'selection.json'),official:officialPath,output},
  {execute:()=>({status:0,stdout:'{}',stderr:''})}),/ENOENT/);
 const report=JSON.parse(await readFile(resolve(output,'REFUSAL_REPORT.json')));assert.equal(report.success_report_accepted,false);assert.equal(report.public_ready,false);
 await assert.rejects(readFile(resolve(output,'LOCAL_BUILD_REPORT.json')),/ENOENT/);
}));
