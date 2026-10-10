import {readFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {checkedSourceArchive,inspectStandaloneBuild,SOURCE_AUTHORITY_SHA256,SOURCE_ARCHIVE_PIN} from '../feature-picker-release-v1/standalone-build.mjs';
import {readSelection,exportSelection,blankSelection,defaultChoice,rejectDuplicateJsonKeys} from '../../src/lib/features/selection.ts';
import {checkedOfficialInput,hash,crc32,OFFICIAL_INPUTS} from './official.mjs';

export const P6S_PIN=Object.freeze({bytes:2741144,sha256:'7f9917ffb0871cca25b1ce5d281ac5c2bf790ae6b8278b04a5ffef8e3c06fd60',identity:'SYNTH P6S!'});
const need=(value,why)=>{if(!value)throw Error(why);};
const inside=(root,path)=>{const child=relative(root,path);return child===''||(!child.startsWith('..')&&!isAbsolute(child));};
const holds=['public_ready','release_ready','download_ready','upload_ready','browser_build_enabled','browser_upload_enabled','native_hardware_qualified','device_operations'];
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

/** Fixed intent for the historical Source16 source builder; never a compact-candidate authority. */
export function canonicalSelectionBytes() {
  const selection=blankSelection();selection.features=[defaultChoice('synth')];
  return Buffer.from(exportSelection(selection));
}

export function checkFixedSynthSelection(raw) {
  const selection=readSelection(raw.toString('utf8'));
  need(raw.equals(canonicalSelectionBytes()),'Use the exact fixed synth-only selection exported by this patcher.');
  return selection;
}

function imageEntry(body,path,identity) {
  const padded=Buffer.alloc(Math.ceil(body.length/4096)*4096,0xff);body.copy(padded);
  return {path,identity,bytes:body.length,sha256:hash(body),crc32:crc32(body),padded_bytes:padded.length,padded_crc32:crc32(padded),sectors:padded.length/4096,abi:2,expected_cold_del_marker:0x52420201};
}

/** Inspect all authentic source/artifact receipts. No source recompilation or device operation. */
export async function inspectStandaloneForPatcher(build,{sourceArchive,official}) {
  const archiveRaw=await readFile(sourceArchive),{authority}=checkedSourceArchive(archiveRaw);
  const officialRaw=await readFile(official),officialPin=checkedOfficialInput(officialRaw);
  const root=await realpath(resolve(build));
  async function read(name){const expected=resolve(root,name),actual=await realpath(expected);need(actual===expected&&inside(root,actual),'Patcher artifact escaped its transaction.');return readFile(actual);}
  const selectionRaw=await read('selection.json'),selection=readSelection(selectionRaw.toString('utf8'));
  need(selectionRaw.equals(Buffer.from(exportSelection(selection))),'Saved selection is not canonical.');
  const inspection=await inspectStandaloneBuild(root,{authority,selectionRaw,officialHash:officialPin.sha256});
  const candidate=await read(inspection.artifacts.candidate.path),restoration=await read(inspection.artifacts.restoration.path);
  for(const [role,body] of [['candidate',candidate],['restoration',restoration]])need(body.length===inspection.artifacts[role].bytes&&hash(body)===inspection.artifacts[role].sha256,`Patcher ${role} changed after source receipt inspection.`);
  need((await read('selection.json')).equals(selectionRaw)&&hash(await read('REPORT.json'))===inspection.standalone_report_sha256,'Patcher selection or receipt changed after inspection.');
  const fixedSynth=selectionRaw.equals(canonicalSelectionBytes());
  const handoff={
    schema:'opensp-synth-release-local-handoff-v1',version:1,
    recipe:'historical-standalone-source16-v1',status:'PASS_SOURCE_AND_ARTIFACT_INSPECTION_RELEASE_HELD',
    candidate_role:fixedSynth?'historical-fixed-synth-only-source16':'historical-selected-source16',
    compact_recording_candidate_admitted:false,
    canonical_selection_sha256:hash(selectionRaw),canonical_selection:selection,
    source_authority_sha256:SOURCE_AUTHORITY_SHA256,source_archive:{...SOURCE_ARCHIVE_PIN},
    standalone_report_sha256:inspection.standalone_report_sha256,official_input:officialPin,
    candidate:imageEntry(candidate,inspection.artifacts.candidate.path,'Historical Source16 selected build'),
    restoration:{...imageEntry(restoration,inspection.artifacts.restoration.path,P6S_PIN.identity),artifact_equal_existing_p6s:true},
    source_and_artifact_verified:true,
    public_ready:false,release_ready:false,download_ready:false,upload_ready:false,
    browser_build_enabled:false,browser_upload_enabled:false,native_hardware_qualified:false,device_operations:false,
    delivery:'DO_NOT_DELIVER',writer_authority_granted:false,
    blockers:[
      'The compact P6S plus native pad-recording candidate needs its own sealed source, compiler and recipe authority.',
      'Normal record, SAVE, native saved-pad playback, persistence and repeated takes remain unqualified.',
      'Selected-candidate audio, memory, runtime and compatible USB delivery qualification remain required.',
      'Exact P6S restoration bytes require the separate authenticated B2 delivery adapter before any upload.',
    ],
  };
  inspectPatcherHandoffStrict(Buffer.from(JSON.stringify(handoff)),candidate,restoration);
  need(hash(await readFile(sourceArchive))===hash(archiveRaw)&&hash(await readFile(official))===officialPin.sha256,'Patcher source or official input changed during inspection.');
  return handoff;
}

/** A local handoff proves byte binding and holds; it never grants transport authority. */
export function inspectPatcherHandoffStrict(raw,candidate,restoration) {
  need(raw.length<=32768,'Patcher handoff exceeds 32 KiB.');
  rejectDuplicateJsonKeys(raw.toString('utf8'));const value=JSON.parse(raw.toString('utf8'));
  need(exactKeys(value,['schema','version','recipe','status','candidate_role','compact_recording_candidate_admitted','canonical_selection_sha256','canonical_selection','source_authority_sha256','source_archive','standalone_report_sha256','official_input','candidate','restoration','source_and_artifact_verified',...holds,'delivery','writer_authority_granted','blockers']),'Patcher handoff contains missing or unrecognized fields.');
  need(value?.schema==='opensp-synth-release-local-handoff-v1'&&value.version===1&&value.recipe==='historical-standalone-source16-v1'&&value.status==='PASS_SOURCE_AND_ARTIFACT_INSPECTION_RELEASE_HELD','Patcher handoff schema or recipe differs.');
  need(holds.every(key=>value[key]===false)&&value.delivery==='DO_NOT_DELIVER'&&value.writer_authority_granted===false&&value.compact_recording_candidate_admitted===false,'Patcher handoff promotes held firmware or writer authority.');
  const selection=readSelection(JSON.stringify(value.canonical_selection));
  need(hash(Buffer.from(exportSelection(selection)))===value.canonical_selection_sha256,'Patcher canonical selection binding differs.');
  need(value.source_authority_sha256===SOURCE_AUTHORITY_SHA256&&exactKeys(value.source_archive,['bytes','sha256'])&&value.source_archive.sha256===SOURCE_ARCHIVE_PIN.sha256&&value.source_archive.bytes===SOURCE_ARCHIVE_PIN.bytes,'Patcher source authority differs.');
  need(/^[a-f0-9]{64}$/.test(value.standalone_report_sha256)&&value.source_and_artifact_verified===true,'Patcher inspection receipt binding differs.');
  need(OFFICIAL_KIND(value.official_input),'Patcher official-input identity differs.');
  const fixed=Buffer.from(exportSelection(selection)).equals(canonicalSelectionBytes());
  need(value.candidate_role===(fixed?'historical-fixed-synth-only-source16':'historical-selected-source16'),'Patcher candidate role differs from canonical selection.');
  for(const [name,body,path,identity] of [
    ['candidate',candidate,'selected-build/candidate.disabled.bin','Historical Source16 selected build'],
    ['restoration',restoration,'restore-build/restore-p6s.disabled.bin',P6S_PIN.identity],
  ]){
    const expected=imageEntry(body,path,identity),entry=value[name];
    need(body.length>0&&body.length<=3665920&&exactKeys(entry,[...Object.keys(expected),...(name==='restoration'?['artifact_equal_existing_p6s']:[])])&&Object.entries(expected).every(([key,item])=>entry[key]===item),`Patcher ${name} bytes or transfer metadata differ.`);
  }
  need(restoration.length===P6S_PIN.bytes&&hash(restoration)===P6S_PIN.sha256&&value.restoration.artifact_equal_existing_p6s===true,'Patcher restoration is not exact authentic P6S.');
  need(Array.isArray(value.blockers)&&value.blockers.length===4&&value.blockers.every(item=>typeof item==='string'&&item.length>0),'Patcher release blockers differ.');
  return {schema:value.schema,recipe:value.recipe,candidate:{...value.candidate},restoration:{...value.restoration},canonical_selection_sha256:value.canonical_selection_sha256,browser_upload_enabled:false,delivery:'DO_NOT_DELIVER',writer_authority_granted:false};
}

function OFFICIAL_KIND(pin) {
  return exactKeys(pin,['kind','bytes','sha256','official_app1_bytes','official_app1_sha256'])&&OFFICIAL_INPUTS.some(({kind,bytes,sha256})=>pin.kind===kind&&pin.bytes===bytes&&pin.sha256===sha256)&&pin.official_app1_bytes===OFFICIAL_INPUTS[0].bytes&&pin.official_app1_sha256===OFFICIAL_INPUTS[0].sha256;
}
