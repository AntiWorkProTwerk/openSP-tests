import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readSelection} from '../../src/lib/features/selection.ts';
import {readLocalBuildReceipt,inspectLocalBuildReceipt} from '../../src/lib/features/buildReceipt.ts';
import {requireDisabled,readPinned} from './run.mjs';

const opensp=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const synth=resolve(opensp,'../sp404mk2-synth');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const reportKey=process.argv[2]??`integration-${Date.now().toString(36)}`;
assert.match(reportKey,/^[a-z0-9][a-z0-9_-]{0,31}$/);
const runKeys=process.argv.slice(3);
const keys=runKeys.length?runKeys:['combined-stage-01','synth-stage-01','recorder-stage-01','chooser-stage-01','combined-build-02','combined-app1-stage-02','combined-final-stage-03','combined-build-04'];
const cases=[];
for(const key of keys){
  assert.match(key,/^[a-z0-9][a-z0-9_-]{0,31}$/);
  const root=resolve(synth,'build/feature-picker-release-v1/runs',key);
  const read=async name=>JSON.parse(await readFile(resolve(root,name),'utf8'));
  const stage=await read('STAGE_REPORT.json'),request=await read('REQUEST.json');
  const replay=await read('PACKAGE_REPLAY.json'),savedInspection=await read('WEBSITE_INSPECTION.json');
  assert.equal(stage.status,'PASS_EXACT_SELECTION_PRIVATE_DISABLED_STAGE');
  assert.equal(stage.source_recompiled,request.mode==='build');
  assert.equal(stage.staged_from_supplied_official_bytes,true);
  assert.equal(stage.request_sha256,hash(await readFile(resolve(root,'REQUEST.json'))));
  if(stage.build_report){
    const origin=await readPinned(synth,stage.build_report);
    assert.equal(stage.build_report_sha256,hash(origin.raw));
    assert.equal(JSON.parse(origin.raw).source_family.sha256,stage.source_family.sha256);
    await readPinned(synth,stage.source_family);
    await readPinned(synth,stage.compiler_ledger);
  }
  assert.equal(hash(await readFile(resolve(root,'stage/selection.json'))),request.selection.sha256);
  assert.equal(hash(await readFile(resolve(root,'stage/receipt.json'))),stage.receipt_sha256);
  assert.equal(hash(await readFile(resolve(root,'stage/candidate.disabled.bin'))),stage.candidate_sha256);
  assert.equal(replay.status,'PASS_SUPPLIED_BASE_NATIVE_RECIPE_AND_B2_REPLAY');
  assert.equal(replay.family_validation.status,'PASS_SOURCE16_LOCAL_FRESH_FAMILY');
  const selection=readSelection(await readFile(resolve(root,'stage/selection.json'),'utf8'));
  const receipt=readLocalBuildReceipt(await readFile(resolve(root,'stage/receipt.json'),'utf8'));
  requireDisabled(receipt);
  const inspection=await inspectLocalBuildReceipt(selection,receipt);
  assert.deepEqual(inspection,savedInspection);
  assert.equal(inspection.valid,true);assert.equal(inspection.matchesSelection,true);
  for(const name of ['sourceFamilyVerified','artifactVerified','downloadReady','uploadReady','releaseReady'])assert.equal(inspection[name],false);
  if(stage.source_recompiled){
    const reportPath=resolve(synth,'build/source16-local-build-v1/runs',`picker-${key}`,'LOCAL_BUILD_REPORT.json');
    const reportRaw=await readFile(reportPath),report=JSON.parse(reportRaw);
    assert.equal(stage.build_report_sha256,hash(reportRaw));
    const ledger=JSON.parse((await readPinned(synth,report.compiler_ledger)).raw);
    assert.equal(ledger.compile_unit_count,151);assert.equal(ledger.objects.length,151);
    for(const object of ledger.objects)await readPinned(synth,object);
    await readPinned(synth,{path:report.source.path+'/module.elf',sha256:report.source.elf_sha256});
    await readPinned(synth,{path:report.source.path+'/module.bin',sha256:report.source.bin_sha256});
  }
  cases.push({key,status:stage.status,selection_sha256:stage.selection_sha256,candidate_sha256:stage.candidate_sha256,
    source_recompiled:stage.source_recompiled,compile_unit_count:151,
    stage_report_sha256:hash(await readFile(resolve(root,'STAGE_REPORT.json'))),native_or_device_qualification:false});
}
const out=resolve(synth,'build/feature-picker-release-v1',`${reportKey}.json`);
await writeFile(out,JSON.stringify({status:'PASS_REAL_PRIVATE_STAGES_AND_CURRENT_RECEIPT_IMPORTS',cases,
  fresh_compilation_checked:cases.some(row=>row.source_recompiled),device_operations:false,
  upload_enabled:false,release_eligible:false,delivery:'DO_NOT_DELIVER'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PASS_REAL_PRIVATE_STAGES_AND_CURRENT_RECEIPT_IMPORTS',stages:cases.length,report:out}));
