import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {loadBenchTransaction} from './prepare-bench.mjs';
import {inspectLocalBenchByteBindings,admitRootSealedLocalBenchCandidate,ROOT_SEALED_LOCAL_BENCH_AUTHORITIES} from './local-bench-v1.ts';

const root=resolve(process.env.OPENSP_FINAL05_BENCH_TRANSACTION??'../sp404mk2-synth/build/openSynth-n1-bench-final05-01');
const {inputs}=await loadBenchTransaction(root),manifest=JSON.parse(await inputs.ownerTestEligibilityManifest.text());
const inspection=await inspectLocalBenchByteBindings(inputs),hash=raw=>createHash('sha256').update(raw).digest('hex');
test('actual final05 snapshot binds exact four hashes and 722 padded sectors without transfer authority',()=>{
  assert.deepEqual(inspection.subject,{candidate_sha256:'dcdb25738f1f40cf517175592eddd28b465e2bbb17ca0dfd05ebdde6da18e1fe',module_elf_sha256:'e45e54672c4563bec7a21c26e3333e0d926c385b637de5d55ada2473ecdff207',module_sha256:'6a33b0a05cb16c34516d09fe9a608f9b4b798ae8e04bfc514382c5e0bf402c09',source_contract_sha256:'5121c1db487d8eefe426799c985f4bc9a73cd3e022ffeb4aea2bfd5355ab620f'});
  assert.equal(inspection.candidate.bytes,2954632);assert.equal(inspection.candidate.crc32,0x5FBBD549);assert.equal(inspection.candidate.padded_bytes,2957312);assert.equal(inspection.candidate.sectors,722);
  assert.equal(inspection.transferAuthorityGranted,false);assert.equal(inspection.publicReleaseEligible,false);assert.equal(inspection.hardwareQualified,false);
});
test('final proposal preserves actual202/109 and101retained+8fresh provenance',async()=>{
  const review=JSON.parse(await readFile(resolve(root,'PROPOSAL_REVIEW.json')));
  assert.equal(review.staticCounts.nativePatches,202);assert.equal(review.staticCounts.objects,109);assert.equal(review.staticCounts.stackReceipts,96);assert.equal(review.staticCounts.compilerCalls,0);
  assert.equal(review.producerCompilationProvenance.retainedCurrentTransactionUnits,101);assert.equal(review.producerCompilationProvenance.newlyCompiledUnits,8);
  assert.equal(review.producerCompilationProvenance.singleNormalEntryEndToEndExecution,false);assert.equal(review.producerCompilationProvenance.phaseInputReadsBeforeAuditHook,true);
  assert.equal(hash(Buffer.from(await inputs.softwareEvidenceFiles['source_tool_module_image-01'].arrayBuffer())),'360580eb06b3210d5f98282ff4e118efb19e3d1027a30f60757d2affcda71a65');
});
test('final proposal keeps pending linked roles/root review and exactP6S; no core03 status is inherited',()=>{
  assert.equal(inspection.restoration.sha256,'7f9917ffb0871cca25b1ce5d281ac5c2bf790ae6b8278b04a5ffef8e3c06fd60');assert.equal(inspection.restoration.sectors,670);
  assert.equal(Object.keys(inputs.restorationEvidenceFiles).length,21);assert.equal(inspection.rootReviewedSoftwareEligible,false);
  assert.equal(manifest.prior_candidate_hardware_proof_required,false);assert(!inspection.blockers.some(row=>row.includes('Core-package-03')));
  assert(inspection.blockers.some(row=>row.includes('rejects PATTERN SELECT20')));
  for(const role of ['audio','cold_memory_lifetime','runtime','recording_flow','composition'])assert(inspection.blockers.includes('Missing exact qualifying proof: '+role));
});
test('rehashed old-core proof cannot be attached to the final candidate',async()=>{
  const changed=structuredClone(manifest),old=await readFile('../sp404mk2-synth/build/priority1-release-candidate-v1/core-verification-02/REPORT.json');
  changed.proof_files['source_tool_module_image-01']={bytes:old.length,sha256:hash(old)};
  await assert.rejects(inspectLocalBenchByteBindings({...inputs,ownerTestEligibilityManifest:new Blob([JSON.stringify(changed)]),softwareEvidenceFiles:{...inputs.softwareEvidenceFiles,'source_tool_module_image-01':new Blob([old])}}),/Qualifying receipt subject differs/);
});
test('held final manifest cannot read candidate or grant authority through the empty root registry',async()=>{
  let reads=0;const candidate={size:2954632,arrayBuffer(){reads++;throw Error('Unregistered candidate must not be read');}};
  await assert.rejects(admitRootSealedLocalBenchCandidate({...inputs,candidate}),/No root-sealed LOCALBENCH software authority/);assert.equal(reads,0);assert.equal(ROOT_SEALED_LOCAL_BENCH_AUTHORITIES.length,0);
});
