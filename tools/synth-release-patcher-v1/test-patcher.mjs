import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm,realpath} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,relative,isAbsolute} from 'node:path';
import {blankSelection,defaultChoice,exportSelection} from '../../src/lib/features/selection.ts';
import {checkedOfficialInput,crc32,hash,OFFICIAL_INPUTS} from './official.mjs';
import {canonicalSelectionBytes,checkFixedSynthSelection,inspectStandaloneForPatcher,inspectPatcherHandoffStrict,P6S_PIN} from './handoff.mjs';
import {parseArgs,runPatcher} from './run.mjs';

async function owned(fn){
  const base=await realpath(tmpdir()),dir=await mkdtemp(resolve(base,'opensp-synth-patcher-test-'));
  try{return await fn(dir);}finally{
    const actual=await realpath(dir),child=relative(base,actual);
    assert(!isAbsolute(child)&&!child.includes('/')&&!child.includes('\\')&&child.startsWith('opensp-synth-patcher-test-'));
    await rm(actual,{recursive:true});
  }
}
test('fixed canonical export contains synth only and registered default shortcut',()=>{
  const raw=canonicalSelectionBytes(),selection=checkFixedSynthSelection(raw);
  assert.equal(selection.profile,'roland-5.52');assert.deepEqual(selection.features,[defaultChoice('synth')]);
  assert.equal(raw.toString(),exportSelection(selection));
});
test('fixed intent refuses a combined feature selection and changed shortcut',()=>{
  const combined=blankSelection();combined.features=[defaultChoice('synth'),defaultChoice('usb-recorder')];
  assert.throws(()=>checkFixedSynthSelection(Buffer.from(exportSelection(combined))),/exact fixed synth-only/);
  const changed=JSON.parse(canonicalSelectionBytes());changed.features[0].shortcut=null;
  assert.throws(()=>checkFixedSynthSelection(Buffer.from(exportSelection(changed))),/exact fixed synth-only/);
  assert.throws(()=>checkFixedSynthSelection(Buffer.concat([canonicalSelectionBytes(),Buffer.from('\n')])),/exact fixed synth-only/);
});
test('official input admission refuses wrong bytes even with the exact expected length',()=>{
  for(const pin of OFFICIAL_INPUTS)assert.throws(()=>checkedOfficialInput(Buffer.alloc(pin.bytes)),/unchanged official Roland/);
  assert.throws(()=>checkedOfficialInput(Buffer.from('not firmware')),/no reviewed identity/);
});
test('CRC matches known IEEE vector',()=>assert.equal(crc32(Buffer.from('123456789')),0xcbf43926));
test('parser does not accept caller compiler, source, hash or qualification authority',()=>{
  for(const flag of ['command','source-archive','candidate-sha','authority-sha','macro','upload','release-ready'])
    assert.throws(()=>parseArgs(['--mode','selection','--output','new.json','--'+flag,'anything']),/Invalid patcher argument/);
});
test('parser distinguishes fixed reference build from restoration inspection',()=>{
  assert.equal(parseArgs(['--mode','restoration-inspect','--official','owner.zip','--build','old-build','--output','new']).mode,'restoration-inspect');
  assert.throws(()=>parseArgs(['--mode','compact-build','--output','new']),/awaiting sealed source admission/);
  assert.throws(()=>parseArgs(['--mode','selection','--output','new','--output','other']),/Duplicate/);
  assert.throws(()=>parseArgs(['--mode','selection','--output','new','--official','owner.zip']),/unrelated/);
  assert.throws(()=>parseArgs(['--mode','source16-build','--output','new']),/Supply/);
});
test('actual selection export preserves existing output and stays outside website',()=>owned(async dir=>{
  const output=resolve(dir,'fixed.json');const result=await runPatcher({mode:'selection',output});
  assert.equal(result.device_operations,false);assert((await readFile(output)).equals(canonicalSelectionBytes()));
  await assert.rejects(runPatcher({mode:'selection',output}),/new patcher output/);
  await assert.rejects(runPatcher({mode:'selection',output:resolve('public','synth-patcher-denied.json')}),/outside the website/);
}));
test('wrong official base refuses before output or child invocation',()=>owned(async dir=>{
  const official=resolve(dir,'official.bin'),selection=resolve(dir,'selection.json'),output=resolve(dir,'new');
  await writeFile(official,Buffer.from('wrong firmware'));await writeFile(selection,canonicalSelectionBytes());let calls=0;
  await assert.rejects(runPatcher({mode:'source16-build',official,selection,python:'absent-python', 'toolchain-root':'absent-tools',output},{execute:()=>{calls++;}}),/unchanged official Roland/);
  assert.equal(calls,0);await assert.rejects(readFile(resolve(output,'PATCHER_HANDOFF.json')),/ENOENT/);
  await assert.rejects(realpath(output),/ENOENT/);
}));

const build=process.env.OPENSP_SYNTH_PATCHER_BUILD,official=process.env.OPENSP_SYNTH_PATCHER_OFFICIAL;
const sourceArchive=resolve('tools/feature-picker-release-v1/standalone-source-bundle.zip'),integration=Boolean(build&&official);
let retained;
async function actual(){
  if(!retained){
    const handoff=await inspectStandaloneForPatcher(build,{sourceArchive,official});
    retained={handoff,candidate:await readFile(resolve(build,handoff.candidate.path)),restoration:await readFile(resolve(build,handoff.restoration.path))};
  }
  return retained;
}
test('actual retained fresh151+27 source/receipt inspection emits a held exact-P6S fallback',{skip:!integration},async()=>{
  const {handoff,candidate,restoration}=await actual(),summary=inspectPatcherHandoffStrict(Buffer.from(JSON.stringify(handoff)),candidate,restoration);
  assert.equal(summary.delivery,'DO_NOT_DELIVER');assert.equal(summary.browser_upload_enabled,false);assert.equal(summary.writer_authority_granted,false);
  assert.equal(handoff.compact_recording_candidate_admitted,false);assert.equal(handoff.restoration.sha256,P6S_PIN.sha256);
  assert.equal(hash(restoration),P6S_PIN.sha256);assert.equal(handoff.restoration.bytes,P6S_PIN.bytes);
  assert.equal(handoff.restoration.sectors,670);assert.equal(handoff.restoration.expected_cold_del_marker,0x52420201);
  assert.equal(checkedOfficialInput(await readFile(official)).kind,'official-v552-zip');
});
test('normal restoration-inspect command produces its complete held handoff without a compiler',{skip:!integration},async()=>owned(async dir=>{
  const output=resolve(dir,'inspection');let calls=0;
  const result=await runPatcher({mode:'restoration-inspect',official,build,output},{execute:()=>{calls++;throw Error('Compiler forbidden');}});
  assert.equal(calls,0);assert.equal(result.delivery,'DO_NOT_DELIVER');
  const {candidate,restoration}=await actual();inspectPatcherHandoffStrict(await readFile(resolve(output,'PATCHER_HANDOFF.json')),candidate,restoration);
}));
const python=process.env.OPENSP_SYNTH_PATCHER_PYTHON;
test('normal reference build preserves an actual inert-child refusal and accepts no candidate',{skip:!integration||!python},async()=>owned(async dir=>{
  const output=resolve(dir,'refused'),selection=resolve(dir,'fixed.json'),tools=resolve(dir,'inert-tools');
  await mkdir(tools);await writeFile(selection,canonicalSelectionBytes());let observed;
  await assert.rejects(runPatcher({mode:'source16-build',official,selection,python,'toolchain-root':tools,output},{execute:(program,args,settings)=>{
    observed={program,args,settings};
    return spawnSync(process.execPath,['-e','process.stdout.write(JSON.stringify(process.argv.slice(1)));process.exit(23)','--',...args],settings);
  }}),/launcher refused/);
  assert.deepEqual(observed.args.slice(0,3),['-I','-S','-B']);assert.equal(observed.settings.shell,false);
  assert.equal(observed.settings.env.PYTHONPATH,undefined);assert.equal(observed.settings.env.PYTHONHOME,undefined);
  const refusal=JSON.parse(await readFile(resolve(output,'PATCHER_REFUSAL.json'))),child=JSON.parse(await readFile(resolve(output,'transaction/REFUSAL_REPORT.json')));
  assert.equal(refusal.candidate_accepted,false);assert.equal(refusal.compact_recording_candidate_admitted,false);
  assert.equal(refusal.browser_upload_enabled,false);assert.equal(child.child_exit_status,23);assert.equal(child.selected_candidate_created,false);
  await assert.rejects(readFile(resolve(output,'PATCHER_HANDOFF.json')),/ENOENT/);
}));
test('normal reference build refuses a successful child lacking bound saved receipts',{skip:!integration||!python},async()=>owned(async dir=>{
  const output=resolve(dir,'missing'),selection=resolve(dir,'fixed.json'),tools=resolve(dir,'inert-tools');await mkdir(tools);await writeFile(selection,canonicalSelectionBytes());
  await assert.rejects(runPatcher({mode:'source16-build',official,selection,python,'toolchain-root':tools,output},{execute:()=>({status:0,stdout:'{}',stderr:''})}),/ENOENT/);
  const refusal=JSON.parse(await readFile(resolve(output,'PATCHER_REFUSAL.json')));assert.equal(refusal.candidate_accepted,false);
  await assert.rejects(readFile(resolve(output,'PATCHER_HANDOFF.json')),/ENOENT/);
}));
for(const flag of ['release_ready','public_ready','browser_upload_enabled','native_hardware_qualified','device_operations','compact_recording_candidate_admitted','writer_authority_granted'])
  test(`actual handoff refuses promoted ${flag}`,{skip:!integration},async()=>{
    const {handoff,candidate,restoration}=await actual(),changed=structuredClone(handoff);changed[flag]=true;
    assert.throws(()=>inspectPatcherHandoffStrict(Buffer.from(JSON.stringify(changed)),candidate,restoration),/promotes held/);
  });
for(const [field,value,pattern] of [
  ['canonical_selection_sha256','0'.repeat(64),/selection binding/],
  ['source_authority_sha256','0'.repeat(64),/source authority/],
  ['recipe','compact-p6n1-unreviewed',/schema or recipe/],
  ['candidate_role','compact-ready',/candidate role/],
])test(`actual handoff refuses unrelated ${field}`,{skip:!integration},async()=>{
  const {handoff,candidate,restoration}=await actual(),changed=structuredClone(handoff);changed[field]=value;
  assert.throws(()=>inspectPatcherHandoffStrict(Buffer.from(JSON.stringify(changed)),candidate,restoration),pattern);
});
test('actual handoff refuses changed candidate, restoration and transport metadata',{skip:!integration},async()=>{
  const {handoff,candidate,restoration}=await actual(),raw=Buffer.from(JSON.stringify(handoff));
  const wrong=Buffer.from(candidate);wrong[wrong.length-1]^=1;
  assert.throws(()=>inspectPatcherHandoffStrict(raw,wrong,restoration),/candidate bytes/);
  const wrongRestore=Buffer.from(restoration);wrongRestore[0]^=1;
  assert.throws(()=>inspectPatcherHandoffStrict(raw,candidate,wrongRestore),/restoration bytes/);
  for(const field of ['crc32','padded_bytes','sectors','abi','expected_cold_del_marker']){
    const changed=structuredClone(handoff);changed.candidate[field]++;
    assert.throws(()=>inspectPatcherHandoffStrict(Buffer.from(JSON.stringify(changed)),candidate,restoration),/candidate bytes/);
  }
});
test('actual handoff refuses duplicate JSON keys before interpreting receipt',{skip:!integration},async()=>{
  const {handoff,candidate,restoration}=await actual(),raw=JSON.stringify(handoff).replace('{','{"delivery":"READY",');
  assert.throws(()=>inspectPatcherHandoffStrict(Buffer.from(raw),candidate,restoration),/Duplicate JSON/);
});
test('actual handoff refuses additional caller authority and nested upload fields',{skip:!integration},async()=>{
  const {handoff,candidate,restoration}=await actual();
  for(const mutate of [value=>{value.release_authority_sha256='a'.repeat(64);},value=>{value.candidate.upload_ready=true;},value=>{value.source_archive.grants_delivery=true;},value=>{value.official_input.trusted=true;}]){
    const changed=structuredClone(handoff);mutate(changed);
    assert.throws(()=>inspectPatcherHandoffStrict(Buffer.from(JSON.stringify(changed)),candidate,restoration),/unrecognized fields|candidate bytes|source authority|official-input/);
  }
});
