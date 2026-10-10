import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm,realpath,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CORE09,P6S,QUALIFICATION} from './pins.mjs';
import {json,hash,crc32} from './common.mjs';
import {checkedCompactArchive,materializeSource,checkMaterializedSource} from './source.mjs';
import {checkCompactReport,inspectCompactBuild} from './inspect.mjs';
import {inspectCompactHandoff} from './handoff.mjs';
import {parseArgs,compilerArguments,runCompactPatcher} from './build.mjs';

const here=dirname(fileURLToPath(import.meta.url)),sourceArchive=resolve(here,'source-core09.zip');
const sourceArchiveRaw=await readFile(sourceArchive),admitted=checkedCompactArchive(sourceArchiveRaw);
async function owned(fn){const base=await realpath(tmpdir()),dir=await mkdtemp(resolve(base,'opensp-compact-test-'));try{return await fn(dir);}finally{const actual=await realpath(dir),child=relative(base,actual);assert(!isAbsolute(child)&&!child.includes('/')&&!child.includes('\\')&&child.startsWith('opensp-compact-test-'));await rm(actual,{recursive:true});}}
test('actual code-owned compact archive contains 349 authenticated source/license members',()=>{
  assert.equal(admitted.members.size,349);assert.equal(admitted.plan.compile_commands.length,105);assert.equal(Object.keys(admitted.plan.inputs).length,304);
  assert.equal(hash(admitted.members.get('build_candidate.py')),CORE09.entry_sha256);assert.equal(admitted.plan.capture_contract.source_implemented_maximum_seconds,120);
  assert(admitted.members.get('LICENSE').includes('AntiWorkProTwerk'));assert(admitted.members.get('NOTICE').includes("Roland's official firmware"));
});
test('changed source archive refuses before extracting or executing code',()=>{
  const changed=Buffer.from(sourceArchiveRaw);changed[changed.length-40]^=1;assert.throws(()=>checkedCompactArchive(changed),/no code-owned/);
  assert.throws(()=>checkedCompactArchive(Buffer.alloc(758411)),/no code-owned/);
});
test('materialized source refuses extra imports and changed entry bytes',()=>owned(async dir=>{
  const source=resolve(dir,'source');await materializeSource(source,admitted);await checkMaterializedSource(source,admitted);
  await writeFile(resolve(source,'unreviewed.py'),'print("unreviewed")');await assert.rejects(checkMaterializedSource(source,admitted),/namespace differs/);
  await rm(resolve(source,'unreviewed.py'));await writeFile(resolve(source,'build_candidate.py'),Buffer.concat([admitted.members.get('build_candidate.py'),Buffer.from('\n')]));
  await assert.rejects(checkMaterializedSource(source,admitted),/source changed/);
}));
test('duplicate JSON authority fields are refused',()=>{
  assert.throws(()=>json(Buffer.from('{"upload_enabled":false,"upload_enabled":true}')),/Duplicate JSON/);
  assert.deepEqual(json(Buffer.from('{"x":[1,2,{"y":"value"}]}')),{x:[1,2,{y:'value'}]});
});
test('compact parser admits only fixed build/inspect inputs, with no selected-feature or caller authority',()=>{
  const args=['--mode','inspect','--source-archive','source.zip','--official','owner.zip','--restoration','restore.bin','--build','build','--output','new'];assert.equal(parseArgs(args).mode,'inspect');
  for(const name of ['selection','command','macro','candidate-sha','authority-sha','recipe','root-seal','upload'])assert.throws(()=>parseArgs([...args,'--'+name,'unadmitted']),/Invalid compact/);
  assert.throws(()=>parseArgs([...args,'--output','other']),/Duplicate/);assert.throws(()=>parseArgs(args.slice(0,-2)),/Supply/);
});
test('compiler arguments preserve spaces and metacharacters in the fixed source roles',()=>{
  const official='owner & $ file.zip',args=compilerArguments('source folder',official,'Arm root','new output');
  assert.deepEqual(args.slice(0,3),['-I','-S','-B']);assert.equal(args[args.indexOf('--official')+1],official);
  assert(args.includes(resolve('source folder','inputs')));assert.equal(args[args.indexOf('--tool-prefix')+1],resolve('Arm root','bin','arm-none-eabi-'));
});

const build=process.env.OPENSP_COMPACT_BUILD,official=process.env.OPENSP_COMPACT_OFFICIAL,restoration=process.env.OPENSP_COMPACT_RESTORATION,python=process.env.OPENSP_COMPACT_PYTHON;
const integration=Boolean(build&&official&&restoration);let actualInputs,actualReport;
async function inputs(){if(!actualInputs)actualInputs={sourceArchiveRaw,officialRaw:await readFile(official),restorationRaw:await readFile(restoration)};return actualInputs;}
async function report(){if(!actualReport)actualReport=json(await readFile(resolve(build,'REPORT.json')));return actualReport;}
test('actual core package replays 197 patches and complete candidate while preserving reuse scope',{skip:!integration},async()=>{
  const inspected=await inspectCompactBuild(build,await inputs());assert.equal(inspected.objects_checked,105);assert.equal(inspected.module_source_files_checked,304);assert.equal(inspected.native_patches_replayed,197);
  assert.equal(inspected.current_transaction_reuse_rows,105);assert.equal(inspected.successful_compile_command_rows,0);assert.equal(inspected.fresh_compile_execution_attested,false);
  assert.equal(inspected.candidate.sha256,CORE09.candidate.sha256);assert.equal(inspected.candidate.sectors,721);assert.equal(inspected.restoration.sha256,P6S.sha256);assert.equal(inspected.restoration.sectors,670);
  assert.equal(inspected.pattern_join,false);assert.equal(inspected.metronome_join,false);assert.equal(inspected.software_eligible_for_owner_test,false);assert.equal(inspected.delivery,'DO_NOT_DELIVER');
});
test('actual normal inspect CLI produces held source/artifact handoff without a compiler',{skip:!integration},()=>owned(async dir=>{
  const output=resolve(dir,'inspection');let invoked=false;const result=await runCompactPatcher({mode:'inspect','source-archive':sourceArchive,official,restoration,build,output},{execute:()=>{invoked=true;throw Error('Compiler forbidden');}});
  assert.equal(invoked,false);assert.equal(result.canonical_entry_completed,false);assert.equal(result.delivery,'DO_NOT_DELIVER');
  const handoff=await readFile(resolve(output,'COMPACT_HANDOFF.json')),candidate=await readFile(resolve(build,'candidate.disabled.bin')),restore=(await inputs()).restorationRaw;
  const inspected=inspectCompactHandoff(handoff,candidate,restore);assert.equal(inspected.upload_enabled,false);
  const binding=json(await readFile(resolve(output,'COMPACT_INPUT_BINDING.json')));assert.equal(binding.handoff_sha256,hash(handoff));
  await assert.rejects(runCompactPatcher({mode:'inspect','source-archive':sourceArchive,official,restoration,build,output}),/new compact output/);
}));
test('wrong official base refuses before output, Python or tools are used',{skip:!integration},()=>owned(async dir=>{
  const bad=resolve(dir,'wrong.bin'),output=resolve(dir,'new');await writeFile(bad,Buffer.alloc(2652672));let calls=0;
  await assert.rejects(runCompactPatcher({mode:'build','source-archive':sourceArchive,official:bad,restoration,python:'absent','toolchain-root':'absent',output},{execute:()=>{calls++;}}),/unchanged official Roland/);
  assert.equal(calls,0);await assert.rejects(realpath(output),/ENOENT/);
}));
test('changed restoration refuses before a compiler is used',{skip:!integration},()=>owned(async dir=>{
  const bad=resolve(dir,'restore.bin'),output=resolve(dir,'new'),changed=Buffer.from((await inputs()).restorationRaw);changed[0]^=1;await writeFile(bad,changed);let calls=0;
  await assert.rejects(runCompactPatcher({mode:'inspect','source-archive':sourceArchive,official,restoration:bad,build,output},{execute:()=>{calls++;}}),/exact authentic P6S/);assert.equal(calls,0);await assert.rejects(realpath(output),/ENOENT/);
}));
for(const flag of ['actual_native_route_qualified','runtime_budget_qualified','hardware_qualified','software_eligible_for_owner_test','public_release_eligible','release_ready','delivery_enabled','upload_enabled','browser_enabled','public_ready'])
  test(`actual compact report refuses promoted ${flag}`,{skip:!integration},async()=>{const changed=structuredClone(await report());changed[flag]=true;assert.throws(()=>checkCompactReport(changed),/promotes qualification/);});
for(const [key,value,pattern] of [
  ['identity','SYNTH P6N1!',/profile differs/],['compile_units',151,/source\/configuration/],['authority_sha256','0'.repeat(64),/source\/configuration/],
  ['candidate_sha256','51cd22432612c1e9ffcea6fb4f714831b779a8a2765117aed4f253dce8968878',/artifact identities/],['recipe_sha256','0'.repeat(64),/artifact identities/],
  ['file_header_sha256','0'.repeat(64),/FILE ABI/],['restoration_freshly_compiled',true,/restoration binding/],
])test(`actual compact report refuses unrelated ${key}`,{skip:!integration},async()=>{const changed=structuredClone(await report());changed[key]=value;assert.throws(()=>checkCompactReport(changed),pattern);});
for(const [file,pattern] of [
  ['candidate.disabled.bin',/candidate bytes/],['module/objects/unit-000.o',/object differs|reused compiler input/],['module/source/joined/derived/sp_p6_record_view_v552.c',/copied source changed/],['recipe.json',/recipe or B2 components/],['b2/tail.bin',/recipe or B2 components/],
])test(`actual build inspector refuses changed ${file}`,{skip:!integration},()=>owned(async dir=>{
  const copy=resolve(dir,'build');await cp(build,copy,{recursive:true});const path=resolve(copy,file),changed=await readFile(path);changed[changed.length-1]^=1;await writeFile(path,changed);
  await assert.rejects(inspectCompactBuild(copy,await inputs()),pattern);
}));
test('normal compact build preserves a real inert-child refusal, with no firmware compiler',{skip:!integration||!python},()=>owned(async dir=>{
  const tools=resolve(dir,'inert tools'),output=resolve(dir,'refused');await mkdir(tools);let observed;
  await assert.rejects(runCompactPatcher({mode:'build','source-archive':sourceArchive,official,restoration,python,'toolchain-root':tools,output},{execute:(program,args,settings)=>{
    observed={program,args,settings};return spawnSync(process.execPath,['-e','process.stdout.write(JSON.stringify(process.argv.slice(1)));process.exit(23)','--',...args],settings);
  }}),/entry refused/);
  assert.deepEqual(observed.args.slice(0,3),['-I','-S','-B']);assert.equal(observed.settings.shell,false);assert.equal(observed.settings.env.PYTHONPATH,undefined);assert.equal(observed.settings.env.GCC_SPECS,undefined);
  const refusal=json(await readFile(resolve(output,'COMPACT_REFUSAL.json')));assert.equal(refusal.child_exit_status,23);assert.equal(refusal.candidate_accepted,false);assert.equal(refusal.compiler_calls,null);assert.equal(refusal.upload_enabled,false);
  await assert.rejects(readFile(resolve(output,'COMPACT_HANDOFF.json')),/ENOENT/);assert.equal(hash(await readFile(resolve(output,'source-kit/build_candidate.py'))),CORE09.entry_sha256);
}));
test('normal compact build refuses a successful child without matching saved report',{skip:!integration||!python},()=>owned(async dir=>{
  const tools=resolve(dir,'inert-tools'),output=resolve(dir,'missing');await mkdir(tools);
  await assert.rejects(runCompactPatcher({mode:'build','source-archive':sourceArchive,official,restoration,python,'toolchain-root':tools,output},{execute:()=>({status:0,stdout:'{}',stderr:''})}),/ENOENT/);
  const refusal=json(await readFile(resolve(output,'COMPACT_REFUSAL.json')));assert.equal(refusal.candidate_accepted,false);await assert.rejects(readFile(resolve(output,'COMPACT_HANDOFF.json')),/ENOENT/);
}));
test('actual isolated compact entry refuses an incomplete tool installation before compiling',{skip:!integration||!python},()=>owned(async dir=>{
  const tools=resolve(dir,'incomplete-tools'),output=resolve(dir,'tool-refusal');await mkdir(tools);
  await assert.rejects(runCompactPatcher({mode:'build','source-archive':sourceArchive,official,restoration,python,'toolchain-root':tools,output}),/entry refused/);
  const stderr=(await readFile(resolve(output,'compiler.stderr.log'))).toString('utf8');assert.match(stderr,/Unreviewed compiler namespace input: bin/);
  const refusal=json(await readFile(resolve(output,'COMPACT_REFUSAL.json')));assert.equal(refusal.child_exit_status,1);assert.equal(refusal.candidate_accepted,false);
  await assert.rejects(realpath(resolve(output,'build')),/ENOENT/);await assert.rejects(readFile(resolve(output,'COMPACT_HANDOFF.json')),/ENOENT/);
}));
test('held handoff refuses candidate bytes and promoted or borrowed joins',{skip:!integration},()=>owned(async dir=>{
  const output=resolve(dir,'held');await runCompactPatcher({mode:'inspect','source-archive':sourceArchive,official,restoration,build,output});
  const handoff=json(await readFile(resolve(output,'COMPACT_HANDOFF.json'))),candidate=await readFile(resolve(build,'candidate.disabled.bin')),restore=(await inputs()).restorationRaw;
  for(const key of ['upload_enabled','software_eligible_for_owner_test','public_ready','writer_authority_granted','pattern_join','metronome_join']){const changed=structuredClone(handoff);changed[key]=true;assert.throws(()=>inspectCompactHandoff(Buffer.from(JSON.stringify(changed)),candidate,restore),/authority|borrows join/);}
  const changed=Buffer.from(candidate);changed[0]^=1;assert.throws(()=>inspectCompactHandoff(Buffer.from(JSON.stringify(handoff)),changed,restore),/candidate bytes/);
  const extra={...handoff,caller_root_seal:'unadmitted'};assert.throws(()=>inspectCompactHandoff(Buffer.from(JSON.stringify(extra)),candidate,restore),/fields or fixed recipe/);
}));
