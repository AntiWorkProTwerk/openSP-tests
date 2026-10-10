import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs,readPinned,requireDisabled,checkedDependencies,requireFamilyBinding,HANDOFF_SHA256} from './run.mjs';

const opensp=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const synth=resolve(opensp,'../sp404mk2-synth');
const report=JSON.parse(await readFile(resolve(synth,'build/source16-local-build-v1/runs/custom-combined-pad34-05/PACKAGE_REVALIDATION-1e5e1077def8.json'),'utf8'));
const receipt=JSON.parse(await readFile(resolve(synth,report.package.receipt.path),'utf8'));
const baseArgs=['--selection','selection.json','--official-base','stock.bin','--run','new-01'];

test('default invocation plans an actual local build without compiling',()=>{
  assert.equal(parseArgs(baseArgs).mode,'plan');
});
test('real catalog, builder and package entry points match the frozen dependency pins',async()=>{
  const {handoff,checked}=await checkedDependencies(synth);
  assert.equal(handoff.evidence_scope.compile_units_each,151);
  assert(checked.some(pin=>pin.path.endsWith('HANDOFF-02.json')&&pin.sha256===HANDOFF_SHA256));
  assert(checked.some(pin=>pin.path.endsWith('build_source16_profile_family_v1.py')));
  assert(checked.some(pin=>pin.path.endsWith('package_synth_full_b2.py')));
  assert(checked.some(pin=>pin.path.endsWith('selection.ts')));
  assert(checked.some(pin=>pin.path.endsWith('buildReceipt.ts')));
});
test('duplicate mode is refused instead of silently changing the action',()=>{
  assert.throws(()=>parseArgs([...baseArgs,'--mode','plan','--mode','build']),/Duplicate/);
});
test('run traversal cannot select an output folder',()=>{
  assert.throws(()=>parseArgs(baseArgs.map(value=>value==='new-01'?'../old':value)),/run key/);
});
test('unknown command options cannot become a compiler argument',()=>{
  assert.throws(()=>parseArgs([...baseArgs,'--execute','anything']),/Invalid argument/);
});
test('stage requires a real report and build refuses a report shortcut',()=>{
  assert.throws(()=>parseArgs([...baseArgs,'--mode','stage']),/requires/);
  assert.throws(()=>parseArgs([...baseArgs,'--mode','build','--build-report','old.json']),/requires/);
});
test('authentic reviewed receipt passes the disabled policy',()=>{
  assert.doesNotThrow(()=>requireDisabled(receipt));
});
test('real reviewed report binds its ledger, source outputs and recipe to its source family',async()=>{
  const family=JSON.parse((await readPinned(synth,report.source_family)).raw);
  assert.doesNotThrow(()=>requireFamilyBinding(report,family));
  const changed=structuredClone(report);changed.source.elf_sha256='0'.repeat(64);
  assert.throws(()=>requireFamilyBinding(changed,family),/source\/config\/recipe pin differs/);
});
for(const [name,mutate] of [
  ['upload enabled',row=>row.upload_enabled=true],
  ['release eligible',row=>row.release_eligible=true],
  ['bench write authorized',row=>row.controlled_bench.write_authorized=true],
  ['bench first test eligible',row=>row.controlled_bench.first_test_eligible=true],
  ['public release eligible',row=>row.public_release.eligible=true],
  ['device normal receipt claimed',row=>row.device_evidence.normal_receipt_present=true],
  ['pending package offered as verified',row=>row.status='PENDING'],
])test(`refuse ${name}`,()=>{
  const changed=structuredClone(receipt);mutate(changed);
  assert.throws(()=>requireDisabled(changed));
});
test('actual private candidate bytes match the report pin',async()=>{
  const candidate=await readPinned(synth,report.package.candidate);
  assert.equal(candidate.raw.length,report.package.candidate.bytes);
});
test('wrong hash and extent refuse a real candidate',async()=>{
  await assert.rejects(readPinned(synth,{...report.package.candidate,sha256:'0'.repeat(64)}),/mismatch/);
  await assert.rejects(readPinned(synth,{...report.package.candidate,bytes:1}),/mismatch/);
});
test('a matching hash does not admit an artifact outside private build',async()=>{
  const path=resolve(opensp,'src/content/features.json'),raw=await readFile(path);
  await assert.rejects(readPinned(synth,{path,sha256:createHash('sha256').update(raw).digest('hex')}),/escapes/);
});
