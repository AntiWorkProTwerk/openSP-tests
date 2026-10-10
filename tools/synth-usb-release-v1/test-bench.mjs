import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access,mkdtemp,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {loadBenchTransaction} from './prepare-bench.mjs';
import {createRootSoftwareBenchSeal} from './seal-bench.mjs';
import {inspectLocalBenchByteBindings,admitRootSealedLocalBenchCandidate,BENCH_PROOF_SCOPES,ROOT_SEALED_LOCAL_BENCH_AUTHORITIES} from './local-bench-v1.ts';
import {LocalBenchUsbFlow} from './bench-flow-v1.ts';
import {resolveAdmittedImage} from './resolve-image.ts';

const transaction=resolve(process.env.OPENSP_N1_BENCH_TRANSACTION??'../sp404mk2-synth/build/openSynth-n1-bench-core03-01');
const loaded=await loadBenchTransaction(transaction),base=loaded.inputs;
const manifest=JSON.parse(await base.ownerTestEligibilityManifest.text());
const blob=value=>new Blob([typeof value==='object'&&!Buffer.isBuffer(value)?JSON.stringify(value):value]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const pin=value=>({bytes:value.length,sha256:hash(value)});
function changedManifest(change){const value=structuredClone(manifest);change(value);return {...base,ownerTestEligibilityManifest:blob(value)};}
async function changedEvidence(id,change){const value=JSON.parse(await base.softwareEvidenceFiles[id].text());change(value);const body=Buffer.from(JSON.stringify(value));
  const updated=structuredClone(manifest);(updated.artifacts[id]?updated.artifacts:updated.proof_files)[id]=pin(body);
  return {...base,ownerTestEligibilityManifest:blob(updated),softwareEvidenceFiles:{...base.softwareEvidenceFiles,[id]:blob(body)}};
}
function fakeReview(){return {schema:'opensp-priority1-root-software-bench-review-v1',version:1,subject:{candidate_sha256:manifest.candidate.sha256,module_elf_sha256:manifest.artifacts.module_elf.sha256,module_sha256:manifest.artifacts.module_bin.sha256,source_contract_sha256:manifest.artifacts.source_contract.sha256},
  checks:Object.fromEntries(Object.entries(BENCH_PROOF_SCOPES).map(([role,scope])=>[role,{scope,conclusion:'PASS_FOR_FIRST_OWNER_TEST',receipt_ids:manifest.proofs[role],limitations:[]} ])),
  decision:'APPROVED_FOR_FIRST_OWNER_TEST_ONLY',public_release_eligible:false,same_candidate_prior_hardware_required:false};}
function withReview(review,eligible=false){const body=Buffer.from(JSON.stringify(review)),value=structuredClone(manifest);value.root_review=pin(body);value.software_eligible_for_owner_test=eligible;
  if(eligible)value.status='ROOT_REVIEWED_SOFTWARE_ELIGIBLE_SEAL_REQUIRED';return {...base,ownerTestEligibilityManifest:blob(value),softwareEvidenceFiles:{...base.softwareEvidenceFiles,root_review:blob(body)}};}

test('actual core03 snapshot has exact ABI2/721-sector byte binding, retains known defect and grants no authority',async()=>{
  const result=await inspectLocalBenchByteBindings(base);assert.equal(result.candidate.sha256,'9b754c96e69f141d419049eccdb4be7375b5bd1ad8880670edee24a850f241d8');
  assert.equal(result.candidate.bytes,2950164);assert.equal(result.candidate.padded_bytes,2953216);assert.equal(result.candidate.sectors,721);
  assert.equal(result.candidate.crc32,0xB14200D7);assert.equal(result.restoration.sha256,'7f9917ffb0871cca25b1ce5d281ac5c2bf790ae6b8278b04a5ffef8e3c06fd60');
  assert.equal(result.authenticatedEvidence.length,22);assert.equal(result.transferAuthorityGranted,false);assert.equal(result.rootReviewedSoftwareEligible,false);
  assert(result.blockers.some(row=>row.includes('stopped-pattern')));for(const role of ['audio','cold_memory_lifetime','runtime','recording_flow','composition'])assert(result.blockers.includes('Missing exact qualifying proof: '+role));
});
test('manifest cannot promote hardware/public authority or change the B2 profile',async()=>{
  for(const field of ['hardware_qualified','public_release_eligible','candidate_upload_enabled','prior_candidate_hardware_proof_required'])await assert.rejects(inspectLocalBenchByteBindings(changedManifest(value=>value[field]=true)),/promotes/);
  await assert.rejects(inspectLocalBenchByteBindings(changedManifest(value=>value.writer.maximum+=4096)),/specific B2 profile/);
});
test('unknown caller admission keys and duplicate manifest fields are refused',async()=>{
  await assert.rejects(inspectLocalBenchByteBindings(changedManifest(value=>value.root_sealed=true)),/unsupported field/);
  const raw=await base.ownerTestEligibilityManifest.text();await assert.rejects(inspectLocalBenchByteBindings({...base,ownerTestEligibilityManifest:blob(raw.replace('"version": 1','"version": 1, "version": 1'))}),/duplicate/);
});
test('changed actual candidate bytes fail before any hardware operation',async()=>{
  const raw=Buffer.from(await base.candidate.arrayBuffer());raw[0x160560]^=1;await assert.rejects(inspectLocalBenchByteBindings({...base,candidate:blob(raw)}),/candidate bytes\/header differ/);
});
test('changed module bytes cannot be authenticated by their old pin',async()=>{
  const raw=Buffer.from(await base.softwareEvidenceFiles.module_bin.arrayBuffer());raw[0]^=1;
  await assert.rejects(inspectLocalBenchByteBindings({...base,softwareEvidenceFiles:{...base.softwareEvidenceFiles,module_bin:blob(raw)}}),/module_bin digest differs/);
});
test('resealed stale build report still cannot disagree with actual candidate',async()=>{
  await assert.rejects(inspectLocalBenchByteBindings(await changedEvidence('build_report',value=>value.candidate_bytes++)),/Build report candidate_bytes differs/);
});
test('rehashed proof for a different module is refused',async()=>{
  await assert.rejects(inspectLocalBenchByteBindings(await changedEvidence('source_tool_module_image-01',value=>value.subject.module_sha256='0'.repeat(64))),/Qualifying receipt subject differs/);
});
test('legacy receipt lacking a machine subject stays held even after hashing it',async()=>{
  const result=await inspectLocalBenchByteBindings(await changedEvidence('b2_size_profile-01',value=>delete value.subject));
  assert(result.blockers.some(row=>row.includes('lacks the exact machine-bound subject')));assert.equal(result.rootReviewedSoftwareEligible,false);
});
test('proof-file shadowing and unreferenced supplied evidence are refused',async()=>{
  await assert.rejects(inspectLocalBenchByteBindings(changedManifest(value=>value.proof_files.module_bin=manifest.artifacts.module_bin)),/shadows an artifact/);
  await assert.rejects(inspectLocalBenchByteBindings({...base,softwareEvidenceFiles:{...base.softwareEvidenceFiles,arbitrary:blob('ignored')}}),/evidence set differs/);
});
test('standalone software-eligible boolean does not satisfy missing proof roles or root review',async()=>{
  await assert.rejects(inspectLocalBenchByteBindings(changedManifest(value=>{value.software_eligible_for_owner_test=true;value.status='ROOT_REVIEWED_SOFTWARE_ELIGIBLE_SEAL_REQUIRED';})),/missing concrete proofs/);
});
test('root review requires the exact allowed scope and receipt IDs',async()=>{
  const wrongScope=fakeReview();wrongScope.checks.audio.scope='static arithmetic only';await assert.rejects(inspectLocalBenchByteBindings(withReview(wrongScope)),/Root audio scope/);
  const wrongIds=fakeReview();wrongIds.checks.source_tool_module_image.receipt_ids=[];await assert.rejects(inspectLocalBenchByteBindings(withReview(wrongIds)),/Root source_tool_module_image scope/);
});
test('invented passing root review cannot erase core03 defect or missing actual proofs',async()=>{
  const result=await inspectLocalBenchByteBindings(withReview(fakeReview()));assert.equal(result.rootReviewedSoftwareEligible,false);assert(result.blockers.some(row=>row.includes('stopped-pattern')));
  await assert.rejects(inspectLocalBenchByteBindings(withReview(fakeReview(),true)),/missing concrete proofs/);
});
test('root-only seal CLI refuses held core before creating any output or registry entry',async()=>{
  const directory=await mkdtemp(resolve(tmpdir(),'opensynth-bench-negative-')),reviewRaw=Buffer.from(JSON.stringify(fakeReview())),reviewPath=resolve(directory,'review.json'),output=resolve(directory,'must-not-exist');
  await writeFile(reviewPath,reviewRaw);await assert.rejects(createRootSoftwareBenchSeal({transaction,rootReview:reviewPath,rootReviewSha256:hash(reviewRaw),output}),/missing concrete proofs/);
  await assert.rejects(access(output),/ENOENT/);assert.equal(ROOT_SEALED_LOCAL_BENCH_AUTHORITIES.length,0);
});
test('root seal CLI refuses drift from the exact independently reviewed SHA',async()=>{
  await assert.rejects(createRootSoftwareBenchSeal({transaction,rootReview:resolve(transaction,'ROOT_SOFTWARE_REVIEW.template.json'),rootReviewSha256:'0'.repeat(64),output:resolve(transaction,'unused')}),/wrong approved digest/);
});
test('empty root registry refuses manifest before candidate reads; copied objects cannot construct bench flow',async()=>{
  let reads=0;const unread={size:1,arrayBuffer(){reads++;throw Error('must not read');}};
  await assert.rejects(admitRootSealedLocalBenchCandidate({...base,candidate:unread}),/No root-sealed LOCALBENCH software authority/);assert.equal(reads,0);
  const copied={schema:'opensp-root-sealed-localbench-candidate-admission-v1',candidate:manifest.candidate,restoration:manifest.restoration};
  assert.throws(()=>new LocalBenchUsbFlow(copied),/not admitted/);assert.throws(()=>resolveAdmittedImage(copied,'candidate'),/Only this module/);
  assert(Object.isFrozen(ROOT_SEALED_LOCAL_BENCH_AUTHORITIES));
});
