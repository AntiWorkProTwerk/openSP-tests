import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {loadBenchTransaction} from './prepare-bench.mjs';import {schemaFixtureV1,schemaFixtureV2} from './root-review-schema-fixture.ts';
import {inspectRootSoftwareBenchReview,BENCH_PROOF_SCOPES,ROOT_SOFTWARE_REVIEW_V2} from './root-review-v2.ts';
import {inspectLocalBenchByteBindings,admitRootSealedLocalBenchCandidate,ROOT_SEALED_LOCAL_BENCH_AUTHORITIES} from './local-bench-v1.ts';
import {SingleTakeBenchUsbFlow} from './bench-flow-v2.ts';import {adaptFrozenOwnerProof} from './owner-proof-adapter.mjs';
const synth='C:/Users/mryba/code/sp404mk2-synth',{inputs}=await loadBenchTransaction(synth+'/build/openSynth-n1-bench-final07-v2-02');
const manifest=JSON.parse(await inputs.ownerTestEligibilityManifest.text()),inspection=await inspectLocalBenchByteBindings(inputs),proofs=manifest.proofs,subject=inspection.subject;
const v1=schemaFixtureV1(subject,proofs),v2=schemaFixtureV2(subject,proofs),hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('typed V2 schema accepts only explicit first-take scope and grants no authority',()=>{
  const result=inspectRootSoftwareBenchReview(v2,subject,proofs);assert.equal(result.version,2);assert.equal(result.firstOwnerTestScope,'single-stopped-pattern-take-save-playback-exit');
  assert.equal(result.repeatQualified,false);assert.equal(result.recordingScope,'exact-linked-chooser-record-stop-save-first-take');assert.equal(ROOT_SEALED_LOCAL_BENCH_AUTHORITIES.length,0);
});
test('typed V1 schema preserves its existing repeated-take scope and excludes V2-only fields',()=>{
  const result=inspectRootSoftwareBenchReview(v1,subject,proofs);assert.equal(result.version,1);assert.equal(result.recordingScope,'exact-linked-chooser-record-stop-save-repeat');
  const wrong=structuredClone(v1);wrong.checks.recording_flow.scope=ROOT_SOFTWARE_REVIEW_V2.recordingScope;assert.throws(()=>inspectRootSoftwareBenchReview(wrong,subject,proofs),/Root recording_flow scope/);
  assert.throws(()=>inspectRootSoftwareBenchReview({...v1,repeat_qualified:false},subject,proofs),/unsupported field/);
});
test('V2 rejects repeat/public/prior-hardware promotions and unrequested scope fields',()=>{
  for(const change of [row=>row.repeat_qualified=true,row=>row.public_release_eligible=true,row=>row.same_candidate_prior_hardware_required=true,row=>row.first_owner_test_scope='repeat-persist-and120seconds',row=>row.persistence_qualified=false]){
    const changed=structuredClone(v2);change(changed);assert.throws(()=>inspectRootSoftwareBenchReview(changed,subject,proofs),/differs|unsupported field/);
  }
});
test('V2 rejects absent restricted fields and mismatched schema/version pairs',()=>{
  for(const change of [row=>delete row.repeat_qualified,row=>delete row.first_owner_test_scope,row=>row.version=1,row=>row.schema=v1.schema,row=>row.version=3]){
    const changed=structuredClone(v2);change(changed);assert.throws(()=>inspectRootSoftwareBenchReview(changed,subject,proofs),/differs|unsupported field/);
  }
});
test('V2 changes only recording scope; the other six scopes and exact subject remain mandatory',()=>{
  for(const role of Object.keys(BENCH_PROOF_SCOPES)){const changed=structuredClone(v2);changed.checks[role].scope+='-broadened';assert.throws(()=>inspectRootSoftwareBenchReview(changed,subject,proofs),/scope\/conclusion/);}
  const wrong=structuredClone(v2);wrong.subject.candidate_sha256='0'.repeat(64);assert.throws(()=>inspectRootSoftwareBenchReview(wrong,subject,proofs),/subject\/schema differs/);
});
test('V2 rejects empty or changed proof references rather than accepting a scope-only claim',()=>{
  const missing=structuredClone(v2),emptyProofs=structuredClone(proofs);missing.checks.recording_flow.receipt_ids=[];emptyProofs.recording_flow=[];
  assert.throws(()=>inspectRootSoftwareBenchReview(missing,subject,emptyProofs),/lacks a concrete proof reference/);
  const changed=structuredClone(v2);changed.checks.audio.receipt_ids=['unknown-proof'];assert.throws(()=>inspectRootSoftwareBenchReview(changed,subject,proofs),/receipt binding differs/);
});
test('actual complete07 packet stays held without root review; every root V2 template row remains unreviewed',async()=>{
  assert.deepEqual(inspection.blockers,['Root software review has not been provided']);assert.equal(inspection.rootReviewedSoftwareEligible,false);assert.equal(inspection.transferAuthorityGranted,false);
  const template=JSON.parse(await readFile(synth+'/build/openSynth-n1-bench-final07-v2-02/ROOT_SOFTWARE_REVIEW.template.json'));
  assert.equal(template.schema,ROOT_SOFTWARE_REVIEW_V2.schema);assert.equal(template.version,2);assert.equal(template.repeat_qualified,false);assert(Object.values(template.checks).every(row=>row.conclusion==='UNREVIEWED_HELD'));
});
test('missing actual recording proof is refused despite a typed V2 review shape',async()=>{
  const changed=structuredClone(manifest),raw=Buffer.from(JSON.stringify(v2));changed.root_review={bytes:raw.length,sha256:hash(raw)};
  const evidence={...inputs.softwareEvidenceFiles,root_review:new Blob([raw])};delete evidence['recording_flow-01'];
  await assert.rejects(inspectLocalBenchByteBindings({...inputs,ownerTestEligibilityManifest:new Blob([JSON.stringify(changed)]),softwareEvidenceFiles:evidence}),/evidence set differs/);
});
test('owned adapters preserve all frozen raw bytes, scope limits and measurement subjects without qualification',async()=>{
  for(const [id,pin] of [['recording_flow-01','1b356a49e8dfaa219d62caa355554c995c5b8ab7647d1a1a8f66c54e7df1bc62'],['composition-01','38814498e134e17ff3cf85a9c12e604d039536b304b45e3ebd367cfee40430dc']]){
    const wrapper=JSON.parse(await inputs.softwareEvidenceFiles[id].text()),raw=Buffer.from(wrapper.rawOwnerReceipt.base64,'base64'),owner=JSON.parse(raw);
    assert.equal(hash(raw),pin);assert.equal(raw.length,wrapper.rawOwnerReceipt.bytes);assert.deepEqual(wrapper.subject,owner.exact_subject);assert.equal(wrapper.newQualificationGranted,false);
    assert.equal(wrapper.softwareEligibilityGranted,false);assert.equal(wrapper.publicReleaseEligible,false);assert.deepEqual(wrapper.subject,subject);
    if(id==='recording_flow-01'){assert.equal(owner.current07_save_playback_executed,false);assert.equal(owner.repeat_qualified,false);assert.equal(owner.persistence_qualified,false);assert.deepEqual(wrapper.ownerMeasurementSubject,owner.measurement_subject);}
  }
});
test('owner adapter rejects raw-digest/subject drift before writing output',async()=>{
  const common={synthRoot:synth,rawPath:synth+'/diagnostics/synth_p6/priority1_pad_recording_v1/evidence/final07-first-owner-carry-01/RECORDING_FLOW_HANDOFF.json',rawSha256:'1b356a49e8dfaa219d62caa355554c995c5b8ab7647d1a1a8f66c54e7df1bc62',subject,role:'recording_flow',output:synth+'/build/never-create-owner-proof.json'};
  await assert.rejects(adaptFrozenOwnerProof({...common,rawSha256:'0'.repeat(64)}),/Pinned owner receipt differs/);
  await assert.rejects(adaptFrozenOwnerProof({...common,subject:{...subject,module_sha256:'0'.repeat(64)}}),/Owner exact subject differs/);
});
test('copied V2 objects cannot construct a flow or access candidate bytes through an empty registry',async()=>{
  assert.throws(()=>new SingleTakeBenchUsbFlow({candidate:manifest.candidate,restoration:manifest.restoration,rootReviewContract:{version:2,firstOwnerTestScope:ROOT_SOFTWARE_REVIEW_V2.firstOwnerTestScope,repeatQualified:false}}),/not admitted/);
  let reads=0;const candidate={size:2954640,arrayBuffer(){reads++;throw Error('must not read');}};
  await assert.rejects(admitRootSealedLocalBenchCandidate({...inputs,candidate}),/No root-sealed LOCALBENCH software authority/);assert.equal(reads,0);assert.equal(ROOT_SEALED_LOCAL_BENCH_AUTHORITIES.length,0);
});
