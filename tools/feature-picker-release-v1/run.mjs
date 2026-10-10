import {readFile,writeFile,mkdir,realpath,stat,access} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const here=dirname(fileURLToPath(import.meta.url));
const opensp=resolve(here,'../..');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
const within=(root,path)=>{const child=relative(root,path);return child!==''&&!child.startsWith('..')&&!isAbsolute(child);};
const writeJson=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const exists=async path=>{try{await access(path);return true;}catch{return false;}};
export const HANDOFF_SHA256='369109f07a0d49e44006bf077210eed2db148550a3dc1ae828fa6dbe2ca71d58';
const directDependencies=[
  {path:'tools/package_synth_full_b2.py',sha256:'b4108931548b70afe0ec2726259d8927d52274ad783602fce21002489339f648'},
  {path:'diagnostics/synth_p6/full_composition_v2/build_source16_profile_family_v1.py',sha256:'0557b961357fe99c8f494ebb765486ead354a8f3c6cedcd6e5544e0b7b2732b0'},
  {path:'diagnostics/synth_p6/full_composition_v2/prepare_source16_profile_family_v1.py',sha256:'e5f182898161f7f38843c805f8904d992d484972bee41f8c073df40e31311853'},
  {path:'diagnostics/synth_p6/release_profiles_v3/config_api.py',sha256:'178c188925d3b853a1883a6edfdbbb0c14aa397b975f682cea94d7f3b0cd47d5'},
];

export async function checkedDependencies(synth){
  const handoffPath=resolve(synth,'diagnostics/source16_local_build_v1/HANDOFF-02.json');
  const raw=await readFile(handoffPath);
  need(hash(raw)===HANDOFF_SHA256,'Frozen Source16 handoff changed.');
  const handoff=JSON.parse(raw),pins=[];
  for(const section of ['catalog','local_tooling','package_api']){
    for(const pin of Object.values(handoff[section]))if(pin?.path&&pin?.sha256)pins.push(pin);
  }
  pins.push(...directDependencies,{path:'diagnostics/source16_local_build_v1/HANDOFF-02.json',sha256:HANDOFF_SHA256});
  const checked=[];
  for(const pin of pins){
    const path=await realpath(resolve(synth,pin.path));
    need(within(synth,path)||within(opensp,path),'Frozen dependency escapes the local project roots.');
    const body=await readFile(path);
    need(hash(body)===pin.sha256&&(!Object.hasOwn(pin,'bytes')||body.length===pin.bytes),`Frozen dependency mismatch: ${pin.path}`);
    checked.push({path:pin.path,sha256:pin.sha256,bytes:body.length});
  }
  return {handoff,checked};
}

export function parseArgs(args){
  const options={mode:'plan',python:'python'};
  const allowed=new Set(['mode','python','selection','official-base','run','synth-root','build-report']);
  const seen=new Set();
  for(let i=0;i<args.length;i+=2){
    const name=args[i]?.replace(/^--/,'');
    need(args[i]?.startsWith('--')&&allowed.has(name)&&args[i+1]&&!args[i+1].startsWith('--'),`Invalid argument ${args[i]??''}`);
    need(!seen.has(name),`Duplicate argument --${name}`);seen.add(name);
    options[name]=args[i+1];
  }
  need(['plan','build','stage'].includes(options.mode),'Mode must be plan, build or stage.');
  need(options.selection&&options['official-base']&&options.run,'Supply --selection, --official-base and --run.');
  need(/^[a-z0-9][a-z0-9_-]{0,31}$/.test(options.run),'Use a new lowercase run key of 1..32 letters, digits, hyphens or underscores.');
  need((options.mode==='stage')===Boolean(options['build-report']),'Only stage mode requires --build-report.');
  return options;
}

export async function readPinned(synth,pin){
  need(pin&&typeof pin.path==='string'&&/^[a-f0-9]{64}$/.test(pin.sha256),'Malformed build pin.');
  const path=await realpath(resolve(synth,pin.path));
  need(within(resolve(synth,'build'),path),'Build pin escapes the private synth build area.');
  const raw=await readFile(path);
  need(hash(raw)===pin.sha256&&(!Object.hasOwn(pin,'bytes')||raw.length===pin.bytes),`Artifact pin mismatch: ${pin.path}`);
  return {path,raw};
}

export function requireDisabled(receipt){
  need(['DISABLED_PACKAGE_VERIFIED','DISABLED_PROVISIONAL_PACKAGE_VERIFIED'].includes(receipt.status),'Receipt must contain a verified disabled package.');
  need(receipt.delivery==='DO_NOT_DELIVER'&&receipt.device_io===false&&receipt.upload_enabled===false&&receipt.release_eligible===false,'Receipt changes delivery authorization.');
  need(receipt.controlled_bench?.first_test_eligible===false&&receipt.controlled_bench?.write_authorized===false&&receipt.public_release?.eligible===false,'Receipt claims bench or public release eligibility.');
  need(['storage_receipt_present','normal_receipt_present','del_receipt_present'].every(name=>receipt.device_evidence?.[name]===false),'Receipt claims device qualification.');
}

export function requireFamilyBinding(report,family){
  const profile=family.profiles?.[report.profile_key];
  need(profile&&family.source16_local_build?.profile_key===report.profile_key,'Build report selects another source-family profile.');
  const samePin=(a,b)=>a?.path===b?.path&&a?.sha256===b?.sha256;
  need(samePin(report.compiler_ledger,family.source16_local_build.compiler_ledger),'Build report compiler ledger differs from the selected source family.');
  need(samePin(report.selection,profile.selection),'Build report selection pin differs from the selected source family.');
  for(const [pin,path,sha256] of [
    [profile.linked?.source_manifest,report.source.path+'/manifest.json',report.source.manifest_sha256],
    [profile.linked?.elf,report.source.path+'/module.elf',report.source.elf_sha256],
    [profile.linked?.module_bin,report.source.path+'/module.bin',report.source.bin_sha256],
    [profile.config,report.config_artifact?.config_path,report.config_artifact?.config_sha256],
    [profile.recipe?.recipe,report.prepared.path+'/package/recipe.json',report.prepared.recipe_sha256],
  ])need(samePin(pin,{path,sha256}),'Build report source/config/recipe pin differs from the selected source family.');
}

function call(command,cwd){
  const child=spawnSync(command[0],command.slice(1),{cwd,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true,shell:false});
  need(!child.error&&child.status===0,`${command[0]} failed: ${child.error?.message??child.stderr??child.stdout}`);
  return child;
}

export async function run(options){
  // Programmatic callers receive the same option/run containment checks as the CLI.
  options=parseArgs(Object.entries(options).flatMap(([key,value])=>value===undefined?[]:[`--${key}`,String(value)]));
  const synth=await realpath(resolve(options['synth-root']??resolve(opensp,'../sp404mk2-synth')));
  const selectionPath=await realpath(resolve(options.selection));
  const officialPath=await realpath(resolve(options['official-base']));
  const {handoff,checked}=await checkedDependencies(synth);
  const selectionApi=await import(pathToFileURL(resolve(opensp,'src/lib/features/selection.ts')).href);
  const receiptApi=await import(pathToFileURL(resolve(opensp,'src/lib/features/buildReceipt.ts')).href);
  need((await stat(selectionPath)).size<=selectionApi.MAX_IMPORT_BYTES,'Selection exceeds the public 32 KiB input limit.');
  const selectionRaw=await readFile(selectionPath);
  const selection=selectionApi.readSelection(selectionRaw.toString('utf8'));
  need(selection.features.length>0,'Select at least one supported feature.');
  need(selectionRaw.equals(Buffer.from(selectionApi.exportSelection(selection))),'Use the exact bytes exported by the current feature picker.');
  const builder=resolve(synth,'diagnostics/source16_local_build_v1/local_build.py');
  need(hash(await readFile(builder))===handoff.local_tooling.cli.sha256,'Local builder differs from the frozen handoff.');
  const privateRoot=resolve(synth,'build/feature-picker-release-v1/runs');
  await mkdir(privateRoot,{recursive:true});
  need(within(resolve(synth,'build'),await realpath(privateRoot)),'Private output root escapes synth build/.');
  const out=resolve(privateRoot,options.run);
  await mkdir(out,{recursive:false});
  let request;
  try{
    await writeFile(resolve(out,'selection.json'),selectionRaw,{flag:'wx'});
    const baseline=resolve(out,'baseline-r3.bin');
    const normalized=call([options.python,resolve(here,'private_package.py'),'--synth-root',synth,'--official-base',officialPath,'--out',baseline],synth);
    const baseProof=JSON.parse(normalized.stdout.trim());
    await writeJson(resolve(out,'BASE_PROOF.json'),baseProof);
    const buildKey='picker-'+options.run;
    const command=[options.python,builder,'--selection',resolve(out,'selection.json'),'--run',buildKey];
    request={schema:'opensp-private-feature-picker-request-v1',version:1,mode:options.mode,run:options.run,
      selection:{sha256:hash(selectionRaw),bytes:selectionRaw.length,registry_revision:selection.registryRevision,catalog_digest:selection.catalogDigest,features:selection.features},
      official_base:baseProof,builder:{sha256:hash(await readFile(builder)),command,cwd:synth},
      handoff_sha256:HANDOFF_SHA256,dependencies:checked,
      glue:{runner_sha256:hash(await readFile(fileURLToPath(import.meta.url))),package_helper_sha256:hash(await readFile(resolve(here,'private_package.py')))},
      environment:{node:process.version,python:call([options.python,'--version'],synth).stdout.trim()},
      delivery:'DO_NOT_DELIVER',device_operations:false,upload_enabled:false,release_eligible:false};
    await writeJson(resolve(out,'REQUEST.json'),request);
    if(options.mode==='plan')return {status:'PLAN_READY_NO_COMPILATION',output:out,builder_command:command,delivery:'DO_NOT_DELIVER',device_operations:false};
    let reportPath;
    if(options.mode==='build'){
      need(!await exists(resolve(synth,'build/source16-local-build-v1/runs',buildKey)),'Builder run already exists; choose a new run key.');
      const child=call(command,synth);
      await writeFile(resolve(out,'builder.stdout.log'),child.stdout,{flag:'wx'});
      await writeFile(resolve(out,'builder.stderr.log'),child.stderr,{flag:'wx'});
      reportPath=resolve(synth,'build/source16-local-build-v1/runs',buildKey,'LOCAL_BUILD_REPORT.json');
    }else reportPath=await realpath(resolve(options['build-report']));
    need(within(resolve(synth,'build/source16-local-build-v1/runs'),reportPath),'Build report must belong to the local Source16 run area.');
    const reportRaw=await readFile(reportPath),report=JSON.parse(reportRaw);
    need(['opensp-source16-local-build-v1','opensp-source16-local-package-revalidation-v1'].includes(report.schema)&&report.delivery==='DO_NOT_DELIVER'&&report.device_operations===false,'Unsupported or deliverable build report.');
    need(['device_tested','runtime_qualified','startup_qualified','native_shortcut_route_qualified','record_save_reentry_playback_qualified','profile_coexistence_qualified'].every(name=>report[name]===false),'Build report changes native or device qualification.');
    need(report.source?.compile_unit_count===151&&report.compiler_ledger?.compile_unit_count===151&&report.compiler_ledger?.object_count===151,'Build report must attest the full 151-unit Source16 compile.');
    await readPinned(synth,report.compiler_ledger);
    const builtSelection=await readPinned(synth,report.selection);
    need(builtSelection.raw.equals(selectionRaw)&&report.selection.intent_sha256===hash(selectionRaw),'Build report does not match this exact exported selection.');
    const family=JSON.parse((await readPinned(synth,report.source_family)).raw);
    requireFamilyBinding(report,family);
    if(report.prior_build_report)await readPinned(synth,report.prior_build_report);
    const receiptInput=await readPinned(synth,report.package.receipt);
    const candidateInput=await readPinned(synth,report.package.candidate);
    await readPinned(synth,report.package.run_report);
    const receipt=receiptApi.readLocalBuildReceipt(receiptInput.raw.toString('utf8'));
    requireDisabled(receipt);
    const inspection=await receiptApi.inspectLocalBuildReceipt(selection,receipt);
    need(inspection.valid&&inspection.matchesSelection,'Current website receipt inspector refused the matching receipt.');
    need(['sourceFamilyVerified','artifactVerified','downloadReady','uploadReady','releaseReady'].every(name=>inspection[name]===false),'Website readiness changed during metadata inspection.');
    need(receipt.candidate.sha256===hash(candidateInput.raw)&&receipt.candidate.bytes===candidateInput.raw.length,'Candidate and imported receipt differ.');
    const stage=resolve(out,'stage');
    await mkdir(stage);
    const replayed=call([options.python,resolve(here,'private_package.py'),'--synth-root',synth,'--build-report',reportPath,'--baseline',baseline,'--out',resolve(stage,'candidate.disabled.bin')],synth);
    const replay=JSON.parse(replayed.stdout.trim());
    need(hash(await readFile(resolve(stage,'candidate.disabled.bin')))===hash(candidateInput.raw),'Staged replay candidate changed.');
    need(hash(await readFile(reportPath))===hash(reportRaw)&&hash(await readFile(selectionPath))===hash(selectionRaw)&&hash(await readFile(officialPath))===baseProof.input_sha256,'Request, supplied base or build report changed during staging.');
    await readPinned(synth,report.package.receipt);
    await readPinned(synth,report.package.candidate);
    await readPinned(synth,report.package.run_report);
    await checkedDependencies(synth);
    need(request.glue.runner_sha256===hash(await readFile(fileURLToPath(import.meta.url)))&&request.glue.package_helper_sha256===hash(await readFile(resolve(here,'private_package.py'))),'Local composition glue changed during the run.');
    await writeFile(resolve(stage,'selection.json'),selectionRaw,{flag:'wx'});
    await writeFile(resolve(stage,'receipt.json'),receiptInput.raw,{flag:'wx'});
    await writeJson(resolve(out,'PACKAGE_REPLAY.json'),replay);
    await writeJson(resolve(out,'WEBSITE_INSPECTION.json'),inspection);
    const result={schema:'opensp-private-feature-picker-stage-v1',status:'PASS_EXACT_SELECTION_PRIVATE_DISABLED_STAGE',request_sha256:hash(await readFile(resolve(out,'REQUEST.json'))),
      build_report_sha256:hash(reportRaw),build_report:{path:relative(synth,reportPath).replaceAll('\\','/'),sha256:hash(reportRaw),bytes:reportRaw.length},
      source_family:report.source_family,compiler_ledger:report.compiler_ledger,
      selection_sha256:hash(selectionRaw),receipt_sha256:hash(receiptInput.raw),candidate_sha256:hash(candidateInput.raw),
      source_recompiled:options.mode==='build',compile_unit_count:151,staged_from_supplied_official_bytes:true,stage,delivery:'DO_NOT_DELIVER',device_operations:false,upload_enabled:false,release_eligible:false,
      native_shortcut_route_qualified:false,runtime_qualified:false,startup_qualified:false,device_tested:false};
    await writeJson(resolve(out,'STAGE_REPORT.json'),result);
    return {...result,output:out};
  }catch(error){
    await writeJson(resolve(out,'FAILED.json'),{status:'REFUSED_PRIVATE_STAGE',reason:error.message,delivery:'DO_NOT_DELIVER',device_operations:false});
    throw error;
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--help')){
    console.log('From OpenSP: node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/run.mjs --mode plan|build|stage --selection PATH --official-base PATH --run NEW-KEY [--build-report PATH (stage)] [--python PYTHON] [--synth-root PATH]');
  }else{
    try{console.log(JSON.stringify(await run(parseArgs(process.argv.slice(2))),null,2));}
    catch(error){console.error(error.message);process.exitCode=1;}
  }
}
