import {CORE09,P6S,QUALIFICATION} from './pins.mjs';
import {need,json,exactKeys,same,imageMetadata} from './common.mjs';

/** A held local handoff cannot create a device token or replace a qualification seal. */
export function inspectCompactHandoff(raw,candidateRaw,restorationRaw){
  need(raw.length<=32768,'Compact handoff exceeds 32 KiB.');const value=json(raw);
  const keys=['schema','version','recipe','identity','source_archive','entry_sha256','source_contract_sha256','official_input','candidate','restoration','build_report_sha256','native_recipe_sha256','canonical_entry_completed','source_recompiled_in_this_patcher','compilation_observation','fresh_compile_execution_attested','restoration_freshly_compiled','pattern_join','metronome_join','source_and_artifact_verified','writer_authority_granted',...Object.keys(QUALIFICATION)];
  need(exactKeys(value,keys)&&value.schema==='opensp-compact-local-handoff-v1'&&value.version===1&&value.recipe===CORE09.recipe&&value.identity===CORE09.identity,'Compact handoff schema, fields or fixed recipe differ.');
  need(Object.entries(QUALIFICATION).every(([key,expected])=>value[key]===expected)&&value.writer_authority_granted===false,'Compact handoff promotes software, hardware, public or writer authority.');
  need(same(value.source_archive,CORE09.archive)&&value.entry_sha256===CORE09.entry_sha256&&value.source_contract_sha256===CORE09.source_contract_sha256&&value.native_recipe_sha256===CORE09.recipe_sha256,'Compact handoff source/entry/recipe binding differs.');
  const official=value.official_input;
  need(exactKeys(official,['kind','bytes','sha256','official_app1_bytes','official_app1_sha256'])&&official.official_app1_bytes===2652672&&official.official_app1_sha256==='4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80'&&[
    ['official-v552-app1',2652672,official.official_app1_sha256],['official-v552-zip',1966465,'ffe5cbbbc971383bcbef34959ea32cb36470d3c9eadad296f52bc4ea6a3cb3c5'],
  ].some(([kind,bytes,sha256])=>official.kind===kind&&official.bytes===bytes&&official.sha256===sha256),'Compact handoff official input binding differs.');
  need(typeof value.canonical_entry_completed==='boolean'&&value.source_recompiled_in_this_patcher===value.canonical_entry_completed&&value.fresh_compile_execution_attested===value.canonical_entry_completed&&value.compilation_observation===(value.canonical_entry_completed?'105_SUCCESSFUL_CURRENT_CHILD_COMMAND_ROWS':'RETAINED_CURRENT_TRANSACTION_REUSE')&&value.restoration_freshly_compiled===false,'Compact handoff compilation scope differs.');
  need(value.pattern_join===false&&value.metronome_join===false&&value.source_and_artifact_verified===true&&/^[a-f0-9]{64}$/.test(value.build_report_sha256),'Compact handoff borrows join or receipt claims.');
  const candidate={path:'candidate.disabled.bin',...imageMetadata(candidateRaw,CORE09.identity)},restoration={...imageMetadata(restorationRaw,P6S.identity),source_recompiled_in_compact_transaction:false};
  need(exactKeys(value.candidate,Object.keys(candidate))&&same(value.candidate,candidate)&&candidate.bytes===CORE09.candidate.bytes&&candidate.sha256===CORE09.candidate.sha256&&candidate.crc32===CORE09.candidate.crc32,'Compact handoff candidate bytes or transfer metadata differ.');
  need(exactKeys(value.restoration,Object.keys(restoration))&&same(value.restoration,restoration)&&restoration.bytes===P6S.bytes&&restoration.sha256===P6S.sha256&&restoration.crc32===P6S.crc32,'Compact handoff restoration bytes or transfer metadata differ.');
  return {recipe:CORE09.recipe,identity:CORE09.identity,candidate:{...candidate},restoration:{...restoration},writer_authority_granted:false,...QUALIFICATION};
}
