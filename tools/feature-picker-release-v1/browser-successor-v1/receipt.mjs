import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {checkedSourceArchive,inspectStandaloneBuild} from '../standalone-build.mjs';
import {canonicalLocalSelection,selectionConfiguration,inspectStandaloneReceipt,heldB2Handoff,STANDALONE_RECIPE,STANDALONE_SOURCE,STANDALONE_AUTHORITY,DELIVERY_GATES} from '../../../src/lib/features/standaloneReceipt.ts';

const hash=raw=>createHash('sha256').update(raw).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
export const OFFICIAL_PINS=[{bytes:1966465,sha256:'ffe5cbbbc971383bcbef34959ea32cb36470d3c9eadad296f52bc4ea6a3cb3c5'},{bytes:2652672,sha256:'4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80'}];
export function checkedOfficialInput(raw){const sha256=hash(raw);need(OFFICIAL_PINS.some(pin=>pin.bytes===raw.length&&pin.sha256===sha256),'Supply the unchanged official v5.52 ZIP or APP1.');return {bytes:raw.length,sha256};}

/** Reuse the actual standalone verifier and complete bytes; no caller receipt authority. */
export async function inspectBuildForBrowser({build,sourceArchive,official,runKey,recompiledThisRequest=false}){
 need(/^[a-z0-9][a-z0-9-]{0,63}$/.test(runKey),'Use a bounded local run name.');
 build=await realpath(build);const archive=await readFile(sourceArchive),{authority}=checkedSourceArchive(archive),officialPin=checkedOfficialInput(await readFile(official));
 const selectionRaw=await readFile(resolve(build,'selection.json')),selection=canonicalLocalSelection(selectionRaw.toString('utf8'));
 const inspection=await inspectStandaloneBuild(build,{authority,selectionRaw,officialHash:officialPin.sha256});
 const reportRaw=await readFile(resolve(build,'REPORT.json')),report=JSON.parse(reportRaw);
 const selectedRaw=await readFile(resolve(build,'selected-build/REPORT.json')),selected=JSON.parse(selectedRaw);
 const configuration=await selectionConfiguration(selection),config=JSON.parse(await readFile(resolve(build,'selected-build/CONFIG.json'),'utf8'));
 const candidate=await readFile(resolve(build,'selected-build/candidate.disabled.bin')),restoration=await readFile(resolve(build,'restore-build/restore-p6s.disabled.bin'));
 need(config.config_sha256===configuration.sha256&&config.selection_sha256===configuration.selectionSha&&config.mask===configuration.mask&&config.policy===configuration.policy&&config.marker===configuration.marker&&config.chooser_label===configuration.chooserLabel&&selected.session_marker===configuration.marker&&selected.policy_id===configuration.policy.toString(16).toUpperCase(),'The source configuration identity differs.');
 const receipt={schema:'opensp-standalone-browser-receipt-v1',version:1,recipe:STANDALONE_RECIPE,status:'SOURCE_AND_ARTIFACT_CHECKED_DELIVERY_HELD',run_key:runKey,
  build_id:`spcf1-${configuration.selectionSha.slice(0,16)}-${inspection.artifacts.candidate.sha256.slice(0,16)}`,
  selection_sha256:configuration.selectionSha,catalog_digest:selection.catalogDigest,registry_revision:selection.registryRevision,
  configuration:{sha256:configuration.sha256,address:report.selected.config_address,bytes:128,feature_mask:configuration.mask,policy_id:configuration.policy,session_marker:configuration.marker,chooser_label:configuration.chooserLabel},
  source:{archive:STANDALONE_SOURCE,authority_sha256:STANDALONE_AUTHORITY,standalone_report_sha256:hash(reportRaw),transaction_sha256:hash(await readFile(resolve(build,'TRANSACTION.json'))),selected_report_sha256:hash(selectedRaw),selected_compile_units:151,restoration_compile_units:27,local_verifier_checked:true},
  candidate:{bytes:candidate.length,sha256:hash(candidate),title:'SYNTH P6K3!',module_xip:report.selected.module_xip,writable_intervals:report.selected.writable_intervals},restoration:{bytes:restoration.length,sha256:hash(restoration)},
  source_recompiled_this_request:recompiledThisRequest,runtime_qualified:false,hardware_qualified:false,public_ready:false,browser_upload_enabled:false,device_operations:false,delivery:'DO_NOT_DELIVER',pending_gates:[...DELIVERY_GATES]};
 const admitted=await inspectStandaloneReceipt(selection,receipt,candidate);
 return {receipt,handoff:heldB2Handoff(admitted),candidate,restoration,selectionRaw};
}
export async function stageBrowserInspection(folder,inspection){
 await mkdir(folder);
 const bodies={receipt:Buffer.from(JSON.stringify(inspection.receipt,null,2)+'\n'),handoff:Buffer.from(JSON.stringify(inspection.handoff,null,2)+'\n'),candidate:inspection.candidate,restoration:inspection.restoration,selection:inspection.selectionRaw};
 const files={receipt:'receipt.json',handoff:'handoff.json',candidate:'candidate.disabled.bin',restoration:'restoration-p6s.disabled.bin',selection:'selection.json'};
 for(const [role,name]of Object.entries(files))await writeFile(resolve(folder,name),bodies[role],{flag:'wx'});
 return {folder,files,pins:Object.fromEntries(Object.entries(bodies).map(([role,raw])=>[role,{bytes:raw.length,sha256:hash(raw)}]))};
}
