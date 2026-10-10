import {BENCH_PROOF_SCOPES,ROOT_SOFTWARE_REVIEW_V2} from './root-review-v2.ts';
import type {BenchProofRole,RootReviewSubject,RootSoftwareBenchReviewV1,RootSoftwareBenchReviewV2} from './root-review-v2.ts';

// In-memory schema fixtures only. These functions neither perform root review nor create authority.
export function schemaFixtureV2(subject:RootReviewSubject,proofs:Readonly<Record<BenchProofRole,readonly string[]>>):RootSoftwareBenchReviewV2 {
  const row=(role:BenchProofRole)=>({conclusion:'PASS_FOR_FIRST_OWNER_TEST' as const,receipt_ids:proofs[role],limitations:['Schema fixture only; no actual root approval or transfer authority.']});
  return {schema:ROOT_SOFTWARE_REVIEW_V2.schema,version:2,subject,first_owner_test_scope:ROOT_SOFTWARE_REVIEW_V2.firstOwnerTestScope,repeat_qualified:false,
    decision:'APPROVED_FOR_FIRST_OWNER_TEST_ONLY',public_release_eligible:false,same_candidate_prior_hardware_required:false,
    checks:{source_tool_module_image:{...row('source_tool_module_image'),scope:BENCH_PROOF_SCOPES.source_tool_module_image},
      b2_size_profile:{...row('b2_size_profile'),scope:BENCH_PROOF_SCOPES.b2_size_profile},audio:{...row('audio'),scope:BENCH_PROOF_SCOPES.audio},
      cold_memory_lifetime:{...row('cold_memory_lifetime'),scope:BENCH_PROOF_SCOPES.cold_memory_lifetime},runtime:{...row('runtime'),scope:BENCH_PROOF_SCOPES.runtime},
      recording_flow:{...row('recording_flow'),scope:ROOT_SOFTWARE_REVIEW_V2.recordingScope},composition:{...row('composition'),scope:BENCH_PROOF_SCOPES.composition}}};
}
export function schemaFixtureV1(subject:RootReviewSubject,proofs:Readonly<Record<BenchProofRole,readonly string[]>>):RootSoftwareBenchReviewV1 {
  const v2=schemaFixtureV2(subject,proofs);
  return {schema:'opensp-priority1-root-software-bench-review-v1',version:1,subject,decision:v2.decision,public_release_eligible:false,same_candidate_prior_hardware_required:false,
    checks:{...v2.checks,recording_flow:{...v2.checks.recording_flow,scope:BENCH_PROOF_SCOPES.recording_flow}}};
}
