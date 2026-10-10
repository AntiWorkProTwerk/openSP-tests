import {hash,json,need} from '../compact-final13-v1/common.mjs';
import {inspectCompactHandoff} from '../compact-final13-v1/handoff.mjs';

export const WITHDRAWN_N1=Object.freeze([
  '9b754c96e69f141d419049eccdb4be7375b5bd1ad8880670edee24a850f241d8',
  '39982fa63950dadd42c2ecde6a677704f3d876d6b1fcfceb0d37893a5d4a72d1',
  'dcdb25738f1f40cf517175592eddd28b465e2bbb17ca0dfd05ebdde6da18e1fe',
  '26cb4f1d99696eb0cda014a74f34719836eb2aa02fe2995966038907b8ee95b8',
  '7881b5c18e4cdd83a405349109c05822b23bd6e38f1df37b264eafe558756f48',
]);
const promotionFields=['release_ready','public_ready','public_release_eligible','software_eligible_for_owner_test','hardware_qualified','delivery_enabled','upload_enabled','browser_enabled','writer_authority_granted','sample_preservation_qualified'];
const backupFields=['sample_backup','project_backup','samples_restored','project_restored','missing_pad_recovery_established'];
const freezes=value=>Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item])=>[key,Array.isArray(item)?Object.freeze([...item]):item&&typeof item==='object'?freezes(item):item])));

/** No authority registry or runtime override exists in this withdrawal guard. */
export function withdrawnDecision(identity,candidateSha256){
  need(typeof identity==='string'&&/^[a-f0-9]{64}$/.test(candidateSha256),'Candidate identity and actual SHA256 are required.');
  const n1=WITHDRAWN_N1.includes(candidateSha256)||/^openSynth\s+N/i.test(identity);
  return freezes({schema:'opensp-patcher-withdrawal-decision-v1',status:n1?'WITHDRAWN_N1_SAMPLE_PRESERVATION_INCIDENT':'UNADMITTED_CANDIDATE',identity,candidate_sha256:candidateSha256,
    owner_reported_missing_pads:true,physical_sample_deletion_established:false,incident_cause_established:false,
    approved_candidate_authorities:0,source_build_execution_allowed:false,recording_test_allowed:false,
    software_eligible_for_owner_test:false,hardware_qualified:false,public_release_eligible:false,release_ready:false,public_ready:false,delivery_enabled:false,upload_enabled:false,browser_enabled:false,writer_authority_granted:false,sample_preservation_qualified:false,
    firmware_restoration_is_sample_backup:false,firmware_restoration_is_project_backup:false,missing_pad_recovery_established:false,
    delivery:'DO_NOT_DELIVER',blockers:['N1 admission withdrawn after owner-reported missing pads.','No candidate-bound populated-project preservation authority is installed.','Root incident resolution and physical acceptance are separate from source and flash readback.']});
}

export function rejectPromotionClaims(value){
  need(value&&typeof value==='object'&&!Array.isArray(value),'Expected a proposed release summary.');
  need(promotionFields.every(key=>value[key]!==true),'Withdrawn or unadmitted firmware cannot be presented ready, qualified or deliverable.');
  for(const object of [value,value.restoration,value.firmware_restoration]){
    if(!object||typeof object!=='object')continue;
    need(backupFields.every(key=>object[key]!==true),'Firmware restoration is not a verified sample or project backup or recovery.');
  }
  return true;
}

export function inspectWithdrawnHandoff(handoffRaw,candidateRaw,restorationRaw){
  const historical=inspectCompactHandoff(handoffRaw,candidateRaw,restorationRaw),value=json(handoffRaw);
  rejectPromotionClaims(value);
  const decision=withdrawnDecision(value.identity,hash(candidateRaw));
  return freezes({...decision,historical_byte_inspection_passed:true,historical_handoff_sha256:hash(handoffRaw),
    firmware_restoration:{identity:historical.restoration.identity,sha256:historical.restoration.sha256,bytes:historical.restoration.bytes,scope:'firmware-app1-only',sample_backup:false,project_backup:false,missing_pad_recovery_established:false},
    source_inspection_is_sample_preservation_proof:false,flash_readback_is_sample_preservation_proof:false});
}

/** Called before source materialization, compiler launch, file writes or transport access. */
export function requireReleaseAction(){throw Error('N1 release and source builds are withdrawn pending sample-preservation incident resolution. No build, test-recording, upload or publication authority is installed.');}
