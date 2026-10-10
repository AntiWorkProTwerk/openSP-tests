import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {loadBenchTransaction} from './prepare-bench.mjs';
import {inspectLocalBenchByteBindings,admitRootSealedLocalBenchCandidate,ROOT_SEALED_LOCAL_BENCH_AUTHORITIES,KNOWN_BENCH_HOLDS} from './local-bench-v1.ts';

const root=resolve('../sp404mk2-synth/build/openSynth-n1-bench-final06-01'),{inputs}=await loadBenchTransaction(root);
const manifest=JSON.parse(await inputs.ownerTestEligibilityManifest.text()),inspection=await inspectLocalBenchByteBindings(inputs),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('exact final06 byte subject has722 sectors and its own CRC without authority',()=>{
  assert.deepEqual(inspection.subject,{candidate_sha256:'26cb4f1d99696eb0cda014a74f34719836eb2aa02fe2995966038907b8ee95b8',module_elf_sha256:'58fcd493672590808f6b0d6aee600b441fa55de77b740be823b41b26e37c086b',module_sha256:'f133b7050d1d73cb5bfd480cd2c5e20a5ecc2e646a4300396319038c97972a18',source_contract_sha256:'eeb9fec53cb9c149240fb2cf2fe46761ad2d9c1cdcc45a699e2c5034e203ab21'});
  assert.equal(inspection.candidate.bytes,2954632);assert.equal(inspection.candidate.crc32,0x98834F31);assert.equal(inspection.candidate.padded_bytes,2957312);assert.equal(inspection.candidate.sectors,722);
  assert.equal(inspection.transferAuthorityGranted,false);assert.equal(inspection.rootReviewedSoftwareEligible,false);assert.equal(inspection.hardwareQualified,false);
});
test('actual successor109/202/108retained+1fresh provenance and pending scopes are preserved',async()=>{
  const review=JSON.parse(await readFile(resolve(root,'PROPOSAL_REVIEW.json'))),ledger=JSON.parse(await readFile(resolve(root,'EXACT_SCOPE_LEDGER.json')));
  assert.equal(review.staticCounts.objects,109);assert.equal(review.staticCounts.nativePatches,202);assert.equal(review.staticCounts.compilerCalls,0);
  assert.equal(review.producerCompilationProvenance.retainedCurrentTransactionUnits,108);assert.equal(review.producerCompilationProvenance.newlyCompiledUnits,1);assert.equal(review.producerCompilationProvenance.singleNormalEntryEndToEndExecution,false);
  for(const role of ['cold_memory_lifetime','recording_flow','composition'])assert(ledger.roles[role].status.startsWith('HELD_'));
  assert.equal(ledger.root_review,'UNREVIEWED_HELD');assert.equal(ledger.software_eligible_for_owner_test,false);
});
test('actual metronome retarget is narrow carryforward and not freshCPU or physical proof',async()=>{
  const met=JSON.parse(await inputs.softwareEvidenceFiles['composition-01'].text());assert.deepEqual(met.subject,inspection.subject);
  assert.equal(met.new_M7_execution,false);assert.equal(met.hardware,false);assert.equal(met.public_eligibility,false);assert.equal(met.version,6);
  assert.equal(hash(Buffer.from(await inputs.softwareEvidenceFiles['composition-01'].arrayBuffer())),'8954c80351807424f5d206777054f851ddd57034dfec747c576f57655e9e1259');
});
test('old05 runtime receipt cannot be silently reused under final06 even if rehashed',async()=>{
  const old=await readFile('../sp404mk2-synth/diagnostics/synth_p6/priority1_runtime_review_v1/final05-runtime-handoff-v1/HANDOFF.json'),changed=structuredClone(manifest);
  changed.proof_files['runtime-01']={bytes:old.length,sha256:hash(old)};
  await assert.rejects(inspectLocalBenchByteBindings({...inputs,ownerTestEligibilityManifest:new Blob([JSON.stringify(changed)]),softwareEvidenceFiles:{...inputs.softwareEvidenceFiles,'runtime-01':new Blob([old])}}),/Qualifying receipt subject differs/);
});
test('explicit heldroot template does not require priorN1hardware and admits no candidate read',async()=>{
  const template=JSON.parse(await readFile(resolve(root,'ROOT_SOFTWARE_REVIEW.template.json')));assert.equal(template.same_candidate_prior_hardware_required,false);
  assert.equal(template.decision,'HELD_QUALIFYING_PROOFS_REQUIRED');assert(Object.values(template.checks).every(row=>row.conclusion==='UNREVIEWED_HELD'));
  assert.deepEqual(manifest.proofs.recording_flow,[]);let reads=0;const unread={size:2954632,arrayBuffer(){reads++;throw Error('must not read');}};
  await assert.rejects(admitRootSealedLocalBenchCandidate({...inputs,candidate:unread}),/No root-sealed LOCALBENCH software authority/);assert.equal(reads,0);assert.equal(ROOT_SEALED_LOCAL_BENCH_AUTHORITIES.length,0);
});
test('P6S21 restoration and exact core03/final05 source holds survive retarget',()=>{
  assert.equal(Object.keys(inputs.restorationEvidenceFiles).length,21);assert.equal(inspection.restoration.sha256,'7f9917ffb0871cca25b1ce5d281ac5c2bf790ae6b8278b04a5ffef8e3c06fd60');
  assert(Object.hasOwn(KNOWN_BENCH_HOLDS,'9b754c96e69f141d419049eccdb4be7375b5bd1ad8880670edee24a850f241d8'));assert(Object.hasOwn(KNOWN_BENCH_HOLDS,'dcdb25738f1f40cf517175592eddd28b465e2bbb17ca0dfd05ebdde6da18e1fe'));
  assert(!inspection.blockers.some(row=>row.includes('Final-package-05')));
});
