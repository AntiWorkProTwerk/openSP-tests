import {FINAL12,P6S,QUALIFICATION} from './pins.mjs';
import {need,hash,json,same,rootedReader} from './common.mjs';

/** This exact static reference carries no runtime, hardware or writer authority. */
export function inspectReferenceOwnerHandoff(raw){
  need(hash(raw)===FINAL12.reference_owner_handoff_sha256,'Final06 owner handoff has no code-owned admission.');
  const value=json(raw),subject={candidate_sha256:FINAL12.candidate.sha256,module_elf_sha256:FINAL12.module_elf_sha256,module_sha256:FINAL12.module_sha256,source_contract_sha256:FINAL12.source_contract_sha256};
  need(value.schema==='opensp-priority1-held-candidate-handoff-v1'&&value.status==='HELD_STATIC_SOURCE_BYTE_PROOF'&&value.identity===FINAL12.identity&&value.policy_id===FINAL12.policy_id&&same(value.subject,subject),'Final06 owner subject differs.');
  need(value.delivery==='DO_NOT_DELIVER'&&['software_eligible_for_owner_test','public_release_eligible','release_ready','delivery_enabled','upload_enabled','browser_enabled','device_operations','source_promoted'].every(key=>value[key]===false),'Final06 owner handoff promotes qualification.');
  need(Object.keys(value.artifacts).length===27&&value.artifacts.source_archive.sha256===FINAL12.archive.sha256&&value.artifacts.source_authority.sha256===FINAL12.authority_sha256&&value.artifacts.source_entry.sha256===FINAL12.entry_sha256&&value.artifacts.build_report.sha256===FINAL12.reference_report_sha256&&value.artifacts.restoration.sha256===P6S.sha256,'Final06 owner artifact bindings differ.');
  need(same(value.compilation,{retained_current_transaction_units:108,newly_compiled_units:[5],fresh_link:true,single_normal_entry_end_to_end_execution:false}),'Final06 owner compilation scope differs.');
  return {reference_owner_handoff_sha256:FINAL12.reference_owner_handoff_sha256,subject,artifact_count:27,current_transaction_reuse_rows:108,successful_compile_command_rows:1,canonical_entry_completed:false,writer_authority_granted:false,...QUALIFICATION};
}

export async function authenticateReferenceArtifacts(raw,root){
  const summary=inspectReferenceOwnerHandoff(raw),value=json(raw),reader=await rootedReader(root);
  for(const pin of Object.values(value.artifacts)){const body=await reader.bytes(pin.path);need(body.length===pin.bytes&&hash(body)===pin.sha256,'Final06 reference artifact bytes differ.');}
  return {...summary,reference_artifacts_checked:27};
}
