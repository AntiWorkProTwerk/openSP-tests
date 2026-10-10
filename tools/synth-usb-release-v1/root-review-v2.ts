import {allowOnlyFields,record} from './data.ts';

// V1 scope values stay fixed. V2 narrows only recording_flow and adds explicit policy fields.
export const BENCH_PROOF_SCOPES=Object.freeze({
  source_tool_module_image:'exact-final-source-tools-module-image',
  b2_size_profile:'exact-abi2-b2-capacity-and-qualified-chip-profile-contract',
  audio:'exact-linked-native-audio-64-frame-path',
  cold_memory_lifetime:'exact-linked-cold-clear-owner-lifetime-memory',
  runtime:'exact-linked-runtime-deadline-and-headroom',
  recording_flow:'exact-linked-chooser-record-stop-save-repeat',
  composition:'exact-final-pattern-click-composition',
});
export const ROOT_SOFTWARE_REVIEW_V2=Object.freeze({schema:'opensp-priority1-root-software-bench-review-v2',version:2,
  firstOwnerTestScope:'single-stopped-pattern-take-save-playback-exit',recordingScope:'exact-linked-chooser-record-stop-save-first-take'} as const);
export type BenchProofRole=keyof typeof BENCH_PROOF_SCOPES;
export interface RootReviewSubject {readonly candidate_sha256:string;readonly module_elf_sha256:string;readonly module_sha256:string;readonly source_contract_sha256:string;}
export interface RootReviewCheck {readonly scope:string;readonly conclusion:'PASS_FOR_FIRST_OWNER_TEST';readonly receipt_ids:readonly string[];readonly limitations:readonly string[];}
type ChecksV1={readonly [Role in BenchProofRole]:Omit<RootReviewCheck,'scope'>&{readonly scope:typeof BENCH_PROOF_SCOPES[Role]}};
type ChecksV2={readonly [Role in BenchProofRole]:Omit<RootReviewCheck,'scope'>&{readonly scope:Role extends 'recording_flow'?typeof ROOT_SOFTWARE_REVIEW_V2.recordingScope:typeof BENCH_PROOF_SCOPES[Role]}};
interface RootReviewBase {readonly subject:RootReviewSubject;
  readonly decision:'APPROVED_FOR_FIRST_OWNER_TEST_ONLY';readonly public_release_eligible:false;readonly same_candidate_prior_hardware_required:false;}
export interface RootSoftwareBenchReviewV1 extends RootReviewBase {readonly schema:'opensp-priority1-root-software-bench-review-v1';readonly version:1;readonly checks:ChecksV1;}
export interface RootSoftwareBenchReviewV2 extends RootReviewBase {readonly schema:typeof ROOT_SOFTWARE_REVIEW_V2.schema;readonly version:2;
  readonly first_owner_test_scope:typeof ROOT_SOFTWARE_REVIEW_V2.firstOwnerTestScope;readonly repeat_qualified:false;readonly checks:ChecksV2;}
export interface RootReviewContract {readonly version:1|2;readonly firstOwnerTestScope?:typeof ROOT_SOFTWARE_REVIEW_V2.firstOwnerTestScope;readonly repeatQualified?:false;readonly recordingScope:string;}
const need=(value:unknown,why:string):void=>{if(!value)throw new TypeError(why);};
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>[key,canonical(row)])):value;
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));

/** A schema check only. Actual proof bytes, root seal and private admission remain separate requirements. */
export function inspectRootSoftwareBenchReview(value:unknown,subject:RootReviewSubject,proofs:Readonly<Record<string,unknown>>):RootReviewContract {
  const review=record(value,'root review'),v2=review.schema===ROOT_SOFTWARE_REVIEW_V2.schema&&review.version===2;
  allowOnlyFields(review,new Set(['schema','version','subject','checks','decision','public_release_eligible','same_candidate_prior_hardware_required',...(v2?['first_owner_test_scope','repeat_qualified']:[])]),'root review');
  need((v2||(review.schema==='opensp-priority1-root-software-bench-review-v1'&&review.version===1))&&same(review.subject,subject),'Root review subject/schema differs');
  need(review.decision==='APPROVED_FOR_FIRST_OWNER_TEST_ONLY'&&review.public_release_eligible===false&&review.same_candidate_prior_hardware_required===false,'Root review decision differs');
  if(v2)need(review.first_owner_test_scope===ROOT_SOFTWARE_REVIEW_V2.firstOwnerTestScope&&review.repeat_qualified===false,'Root V2 restricted first-owner scope/repeat claim differs');
  const roles=Object.keys(BENCH_PROOF_SCOPES),checks=record(review.checks,'root checks');allowOnlyFields(checks,new Set(roles),'root checks');need(Object.keys(checks).length===roles.length,'Root check roles differ');
  for(const role of roles){const check=record(checks[role],role);allowOnlyFields(check,new Set(['scope','conclusion','receipt_ids','limitations']),role);
    const scope=v2&&role==='recording_flow'?ROOT_SOFTWARE_REVIEW_V2.recordingScope:BENCH_PROOF_SCOPES[role as BenchProofRole];
    need(check.scope===scope&&check.conclusion==='PASS_FOR_FIRST_OWNER_TEST'&&same(check.receipt_ids,proofs[role])&&Array.isArray(check.limitations)&&check.limitations.every(row=>typeof row==='string'),`Root ${role} scope/conclusion/receipt binding differs`);
    if(v2)need(Array.isArray(check.receipt_ids)&&check.receipt_ids.length>0,'Root V2 lacks a concrete proof reference: '+role);
  }
  return Object.freeze(v2?{version:2,firstOwnerTestScope:ROOT_SOFTWARE_REVIEW_V2.firstOwnerTestScope,repeatQualified:false,recordingScope:ROOT_SOFTWARE_REVIEW_V2.recordingScope}:
    {version:1,recordingScope:BENCH_PROOF_SCOPES.recording_flow});
}
