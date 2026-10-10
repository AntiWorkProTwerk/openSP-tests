import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {hash,json} from '../compact-final13-v1/common.mjs';
import {WITHDRAWN_N1,withdrawnDecision,rejectPromotionClaims,inspectWithdrawnHandoff,requireReleaseAction} from './guard.mjs';
import {parseArgs} from './run.mjs';

const here=dirname(fileURLToPath(import.meta.url)),synthRoot=process.env.OPENSP_WITHDRAWAL_SYNTH_ROOT;
assert(synthRoot,'Set OPENSP_WITHDRAWAL_SYNTH_ROOT to retained synth evidence.');
const at=name=>resolve(synthRoot,name),handoff=await readFile(at('build/synth-release-patcher-v1/compact-final13-inspection-01/COMPACT_HANDOFF.json'));
const candidate=await readFile(at('build/priority1-release-candidate-v1/final-package-07/candidate.disabled.bin')),restoration=await readFile(at('build/sol-restore-source-v1/audited-build-04/restore-p6s.disabled.bin'));

for(const sha of WITHDRAWN_N1)test(`withdrawn artifact ${sha.slice(0,8)} stays blocked after a caller renames it`,()=>{
  const result=withdrawnDecision('Renamed candidate',sha);assert.equal(result.status,'WITHDRAWN_N1_SAMPLE_PRESERVATION_INCIDENT');assert.equal(result.release_ready,false);assert.equal(result.source_build_execution_allowed,false);assert.equal(result.writer_authority_granted,false);
});
test('unsealed corrected N1 successor has no sample-preservation or delivery authority',()=>{
  const result=withdrawnDecision('openSynth N2','0'.repeat(64));assert.equal(result.status,'WITHDRAWN_N1_SAMPLE_PRESERVATION_INCIDENT');assert.equal(result.sample_preservation_qualified,false);assert.equal(result.approved_candidate_authorities,0);
});
test('an unrelated name and hash cannot turn the guard into an authority source',()=>{assert.equal(withdrawnDecision('Other image','1'.repeat(64)).status,'UNADMITTED_CANDIDATE');});
for(const key of ['release_ready','public_ready','public_release_eligible','software_eligible_for_owner_test','hardware_qualified','delivery_enabled','upload_enabled','browser_enabled','writer_authority_granted','sample_preservation_qualified'])
  test(`withdrawal refuses promoted ${key}`,()=>{assert.throws(()=>rejectPromotionClaims({[key]:true}),/cannot be presented ready/);});
for(const key of ['sample_backup','project_backup','samples_restored','project_restored','missing_pad_recovery_established'])
  test(`firmware restoration cannot claim ${key}`,()=>{assert.throws(()=>rejectPromotionClaims({firmware_restoration:{[key]:true}}),/not a verified sample or project backup/);assert.throws(()=>rejectPromotionClaims({restoration:{[key]:true}}),/not a verified sample or project backup/);});
test('actual historical source and byte success produces withdrawn status and no backup claim',()=>{
  const result=inspectWithdrawnHandoff(handoff,candidate,restoration);assert.equal(result.historical_byte_inspection_passed,true);assert.equal(result.status,'WITHDRAWN_N1_SAMPLE_PRESERVATION_INCIDENT');assert.equal(result.physical_sample_deletion_established,false);assert.equal(result.incident_cause_established,false);assert.equal(result.flash_readback_is_sample_preservation_proof,false);assert.equal(result.source_inspection_is_sample_preservation_proof,false);assert.equal(result.firmware_restoration.sample_backup,false);assert.equal(result.firmware_restoration.project_backup,false);assert.equal(result.firmware_restoration.scope,'firmware-app1-only');
});
test('decision and nested restoration scope cannot be mutated into a release token',()=>{
  const result=inspectWithdrawnHandoff(handoff,candidate,restoration);assert.throws(()=>{result.upload_enabled=true;},TypeError);assert.throws(()=>{result.firmware_restoration.sample_backup=true;},TypeError);
});
test('normal current CLI reports withdrawal from actual held bytes',()=>{
  const child=spawnSync(process.execPath,[resolve(here,'../current.mjs'),'--handoff',at('build/synth-release-patcher-v1/compact-final13-inspection-01/COMPACT_HANDOFF.json'),'--candidate',at('build/priority1-release-candidate-v1/final-package-07/candidate.disabled.bin'),'--restoration',at('build/sol-restore-source-v1/audited-build-04/restore-p6s.disabled.bin')],{encoding:'utf8',shell:false,windowsHide:true});assert.equal(child.status,0,child.stderr);const result=json(Buffer.from(child.stdout));assert.equal(result.status,'WITHDRAWN_N1_SAMPLE_PRESERVATION_INCIDENT');assert.equal(result.firmware_restoration.sample_backup,false);assert.equal(result.release_ready,false);
});
test('normal current CLI refuses build before nonexistent inputs are accessed',()=>{
  const child=spawnSync(process.execPath,[resolve(here,'../current.mjs'),'--build','--handoff','absent','--candidate','absent','--restoration','absent'],{encoding:'utf8',shell:false,windowsHide:true});assert.equal(child.status,1);assert.match(child.stderr,/release and source builds are withdrawn/);assert.doesNotMatch(child.stderr,/ENOENT/);assert.equal(child.stdout,'');
  assert.throws(()=>requireReleaseAction(),/withdrawn/);assert.throws(()=>parseArgs(['--force','yes']),/withdrawn/);
});
test('actual browser bench authority file matches the coordinated empty registry',async()=>{
  const raw=await readFile(resolve(here,'../../synth-usb-release-v1/root-seals-v1.ts'));assert.equal(hash(raw),'ca85db5362e557ed751491b07cb7c9ce98bb3c98480623b0685cc936d8db9f47');assert.match(raw.toString(),/ROOT_SEALED_LOCAL_BENCH_AUTHORITIES:[^=]+=Object\.freeze\(\[\]\)/);
});
test('all16 frozen kit13 source snapshots remain unchanged',async()=>{
  const review=json(await readFile(resolve(here,'../compact-final13-v1/REVIEW.json'))),website=resolve(here,'../../..');let count=0;for(const [name,pin] of Object.entries(review.source_files)){const raw=await readFile(resolve(website,name));assert.equal(hash(raw),pin.sha256,name);assert.equal(raw.length,pin.bytes,name);count++;}assert.equal(count,16);
});
