import {exportSelection,parseSelection,defaultChoice,physicalControls,rejectDuplicateJsonKeys,type Selection,type Issue} from './selection.ts';
import catalogManifest from '../../content/feature-catalog-manifest.json' with {type:'json'};

export const MAX_RECEIPT_BYTES=128*1024;
const APP1_BASE=0x60080000,MAXIMUM=0x37f000,SECTOR=4096;
const MARKER_ALGORITHM='CRC32(SPG1CFG1||LE32(policy_id)||config[0:124])';
const B2_TAIL_SHA='b0b1697152804f8a5770e4931a36b9e44c518f8431474534621cd102fdb94cb2';
const statuses=new Set(['DISABLED_PACKAGE_VERIFIED','DISABLED_PROVISIONAL_PACKAGE_VERIFIED','DISABLED_PENDING_UPSTREAM','FAILED']);
// These names describe the current source-profile contract, not release approval.
const profileMasks:Record<string,number>={'synth-only-default':1,'synth-only-source08-default':1,'synth-only-custom':1,'global-only-default':2,'global-only-custom':2,'combined-default':3,'combined-custom':3};
type ObjectValue=Record<string,unknown>;
export type BuildReceiptInspection={
  valid:boolean;matchesSelection:boolean;issues:Issue[];
  summary:{status:string;profileKey:string;selectionSha256:string;configurationSha256:string;configurationMarker:number;candidate:{bytes:number;sha256:string;identity:string}|null;pendingGates:string[]}|null;
  sourceFamilyVerified:false;artifactVerified:false;downloadReady:false;uploadReady:false;releaseReady:false;
};
const object=(value:unknown):value is ObjectValue=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const record=(value:unknown):ObjectValue=>object(value)?value:{};
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uint=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=0xffffffff;
const text=(value:unknown,max=128):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&/^[\x20-\x7e]+$/.test(value);
const relativePath=(value:unknown)=>text(value,512)&&!value.includes('\\')&&!value.includes(':')&&!value.startsWith('/')&&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
const pin=(value:unknown)=>object(value)&&relativePath(value.path)&&uint(value.bytes)&&value.bytes>0&&hash(value.sha256);
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.length>0&&value.length<=64&&value.every(item=>text(item,256));
const interval=(value:unknown)=>object(value)&&uint(value.start)&&uint(value.end)&&uint(value.bytes)&&value.end>value.start&&value.bytes===value.end-value.start;
const label=(value:unknown):value is string=>typeof value==='string'&&/^[A-Z][A-Z0-9 !._]{0,63}$/.test(value);
const sha256=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes))),v=>v.toString(16).padStart(2,'0')).join('');
function crc32(bytes:Uint8Array){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}

/** Reproduce the public SPCF ABI, including the exact intent and ordered trigger. */
async function expectedConfiguration(selection:Selection,intentSha:string,mask:number){
  const bytes=new Uint8Array(128),view=new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('SPCF'));view.setUint16(4,1,true);view.setUint16(6,128,true);
  view.setUint32(8,0x552,true);view.setUint32(12,mask,true);view.setUint32(16,1,true);
  const unhex=(value:string)=>Uint8Array.from(value.match(/../g)!,part=>parseInt(part,16));
  bytes.set(unhex(intentSha),24);bytes.set(unhex(selection.catalogDigest),56);
  for(const [index,id]of ['synth','usb-recorder'].entries()){
    const choice=selection.features.find(feature=>feature.id===id),offset=88+16*index;
    let bits=0n,trigger=0;
    for(const control of choice?.shortcut?.controls??[]){
      const at=physicalControls.findIndex(entry=>entry.id===control&&entry.shortcut);
      if(at<0||at>=50)throw Error('The configuration contains an unmapped shortcut control.');
      bits|=1n<<BigInt(at);trigger=at+1;
    }
    view.setBigUint64(offset,bits,true);view.setUint8(offset+8,trigger);view.setUint8(offset+9,index+1);
  }
  view.setUint32(124,crc32(bytes.subarray(0,124)),true);
  return {bytes,sha256:await sha256(bytes)};
}

/** Parse bounded metadata only. It never opens package paths or connects to a device. */
export function readLocalBuildReceipt(textValue:string):unknown{
  if(new TextEncoder().encode(textValue).byteLength>MAX_RECEIPT_BYTES)throw Error('Build receipts must be 128 KiB or smaller.');
  try{rejectDuplicateJsonKeys(textValue);return JSON.parse(textValue);}catch(error){
    if(error instanceof SyntaxError||error instanceof RangeError)throw Error('The build receipt is not valid bounded JSON.');
    // Do not include imported keys, paths or other untrusted text in the error.
    throw Error('The build receipt contains duplicate JSON fields.');
  }
}

/** Metadata consistency is distinct from artifact verification and release authorization. */
export async function inspectLocalBuildReceipt(selection:Selection,value:unknown):Promise<BuildReceiptInspection>{
  const selected=parseSelection(selection),issues:Issue[]=[];
  const result=(summary:BuildReceiptInspection['summary']=null):BuildReceiptInspection=>({valid:issues.length===0,matchesSelection:issues.length===0,issues,summary,sourceFamilyVerified:false,artifactVerified:false,downloadReady:false,uploadReady:false,releaseReady:false});
  const need=(ok:unknown,code:string,message:string)=>{if(!ok)issues.push({code,message});};
  if(!object(value)){need(false,'receipt-schema','Use an OpenSP local USB build receipt version 3.');return result();}
  const receipt=value;
  const fields=['schema','version','status','delivery','device_io','upload_enabled','release_eligible','selection','catalog','source_family','configuration','module','recipe','candidate','restore','b2_writer','identity_contract','device_evidence','controlled_bench','public_release','pending_release_gates','provisional','compiled_patch_transitions'];
  need(Object.keys(receipt).every(key=>fields.includes(key)),'receipt-fields','The receipt contains unsupported top-level fields.');
  need(receipt.schema==='opensp-local-usb-build-receipt'&&receipt.version===3&&statuses.has(String(receipt.status)),'receipt-schema','Use a supported disabled build receipt version 3.');
  need(receipt.delivery==='DO_NOT_DELIVER'&&receipt.device_io===false&&receipt.upload_enabled===false&&receipt.release_eligible===false,'receipt-authorization','This local receipt must keep device access, upload and release disabled.');
  const required=['selection','catalog','source_family','configuration','module','recipe','b2_writer','identity_contract','device_evidence','controlled_bench','public_release'];
  need(required.every(key=>object(receipt[key]))&&Object.hasOwn(receipt,'candidate')&&Object.hasOwn(receipt,'restore'),'receipt-fields','The receipt is missing required package metadata.');
  const intent=record(receipt.selection),catalog=record(receipt.catalog),family=record(receipt.source_family),config=record(receipt.configuration);
  const module=record(receipt.module),recipe=record(receipt.recipe),writer=record(receipt.b2_writer),bench=record(receipt.controlled_bench);
  const identity=record(receipt.identity_contract),evidence=record(receipt.device_evidence),release=record(receipt.public_release);
  const canonical=exportSelection(selected),canonicalBytes=new TextEncoder().encode(canonical),intentSha=await sha256(canonicalBytes);
  const mask=selected.features.reduce((bits,feature)=>bits|(feature.id==='synth'?1:feature.id==='usb-recorder'?2:0),0);
  need(selected.profile==='roland-5.52'&&mask>=1&&mask<=3,'receipt-profile','This package contract supports one or both release features on Roland 5.52.');
  need(pin(intent)&&intent.schema===selected.schema&&intent.version===2&&intent.registry_revision===selected.registryRevision&&intent.catalog_digest===selected.catalogDigest&&intent.sha256===intentSha&&intent.intent_sha256===intentSha&&intent.bytes===canonicalBytes.length&&intent.feature_mask===mask,'selection-identity','The receipt must match the exact current canonical selection and catalog.');
  let matchesFeatures=false;
  try{matchesFeatures=exportSelection(parseSelection({...selected,features:intent.features}))===canonical;}catch{/* Malformed or stale choices fail without echoing imported data. */}
  need(matchesFeatures,'selection-features','The receipt must contain the exact selected feature versions and shortcuts.');
  need(catalog.registry_revision===selected.registryRevision&&catalog.catalog_digest===selected.catalogDigest&&['registry','physical_controls','manifest'].every(key=>pin(catalog[key]))&&record(catalog.registry).sha256===catalogManifest.registrySha256&&record(catalog.physical_controls).sha256===catalogManifest.physicalControlsSha256,'catalog-identity','The package catalog must match the current registry and control map.');
  need(['manifest','source_manifest','profile_manifest'].every(key=>pin(family[key]))&&family.source_family_sha256===record(family.manifest).sha256&&family.source_manifest_sha256===record(family.source_manifest).sha256&&family.profile_manifest_sha256===record(family.profile_manifest).sha256&&typeof family.profile_key==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(family.profile_key),'source-pins','The source family and profile need consistent file pins.');
  const profileKey=typeof family.profile_key==='string'?family.profile_key:'';
  const defaultIntent=exportSelection({...selected,features:selected.features.map(feature=>defaultChoice(feature.id))});
  need(Object.hasOwn(profileMasks,profileKey)&&profileMasks[profileKey]===mask&&family.family_key===profileKey.replace(/-/g,'_')&&(profileKey.endsWith('-custom')?canonical!==defaultIntent:canonical===defaultIntent),'profile-selection','The profile label must match its family key, feature mask and default or custom selection.');
  const expected=await expectedConfiguration(selected,intentSha,mask),configPin=record(config.file);
  need(pin(config.file)&&config.bytes===128&&configPin.bytes===128&&config.sha256===expected.sha256&&configPin.sha256===expected.sha256&&config.embedded_sha256===expected.sha256&&config.intent_sha256===intentSha&&config.feature_mask===mask,'configuration-identity','The compiled configuration must match the selected features, shortcuts and intent.');
  const policy=typeof config.policy_id==='string'&&/^[A-Fa-f0-9]{8}$/.test(config.policy_id)?parseInt(config.policy_id,16):0;
  const markerBytes=new Uint8Array(136);markerBytes.set(new TextEncoder().encode('SPG1CFG1'));
  new DataView(markerBytes.buffer).setUint32(8,policy,true);markerBytes.set(expected.bytes.subarray(0,124),12);
  const marker=crc32(markerBytes),chooser=(mask&1)?`SYNTH P6 ${marker.toString(16).toUpperCase().padStart(8,'0')}`:null;
  need(policy===(mask===2?0x47524b32:0x50544b32),'configuration-policy','The configuration policy must match the current source-profile contract.');
  need(policy>0&&config.marker_algorithm===MARKER_ALGORITHM&&config.spg1_session_marker===marker&&config.normal_config_marker===marker&&config.expected_chooser_label===chooser,'configuration-marker','The normal-session marker and chooser label must come from the exact configuration.');
  need(['elf','binary','manifest','section_audit','config_section'].every(key=>pin(module[key]))&&module.manifest_sha256===record(module.manifest).sha256&&record(module.config_section).bytes===128&&record(module.config_section).sha256===expected.sha256,'module-pins','The linked module and configuration section need consistent file pins.');
  need(module.manifest_sha256===family.source_manifest_sha256,'module-family','The module must use the linked manifest pinned by the selected source family.');
  const xip=module.xip;
  need(Array.isArray(xip)&&xip.length===2&&uint(xip[0])&&uint(xip[1])&&xip[0]>=APP1_BASE&&xip[1]>xip[0]&&xip[1]<=APP1_BASE+MAXIMUM&&uint(config.embedded_address)&&config.embedded_address>=xip[0]&&config.embedded_address+128<=xip[1],'configuration-range','The configuration must fit inside the linked APP1 module extent.');
  const writable=module.writable_intervals;
  need(Array.isArray(writable)&&writable.length>0&&writable.length<=128&&writable.every(row=>object(row)&&text(row.name,64)&&uint(row.address)&&uint(row.size)&&row.size>0&&row.address+row.size<=0x100000000),'memory-metadata','The writable-section report needs bounded address and size metadata.');
  if(Array.isArray(writable)&&writable.every(row=>object(row)&&uint(row.address)&&uint(row.size))){
    const sorted=[...writable as {address:number;size:number}[]].sort((a,b)=>a.address-b.address);
    need(sorted.every((row,index)=>index===0||sorted[index-1].address+sorted[index-1].size<=row.address),'memory-overlap','Declared writable sections must not overlap.');
  }
  need((module.ordinary_bss===null||interval(module.ordinary_bss))&&(module.arena===null||interval(module.arena))&&uint(module.arena_bytes)&&uint(module.spare_bytes)&&object(module.runtime_ownership)&&record(module.runtime_ownership).requested_capacity_bytes===module.arena_bytes,'memory-metadata','The arena capacity and ownership metadata must be consistent.');
  need(['native_recipe','ordered_trace','complete_plan','stock_app1_model','patch_chain_audit'].every(key=>pin(recipe[key])),'recipe-pins','The native recipe and ordered patch plan need file pins.');
  need(writer.marker===0x52420201&&writer.protocol===2&&writer.maximum===MAXIMUM&&writer.jedec===0xc22016&&writer.flash_status===0x40&&writer.flash_ready===1&&writer.flash_error===0&&writer.error===0&&pin(writer.bridge_tail)&&record(writer.bridge_tail).bytes===17412&&record(writer.bridge_tail).sha256===B2_TAIL_SHA,'writer-profile','This package requires the exact B2 writer and bridge profile.');
  need(identity.physical_truth_established_by_checker===false&&identity.receipts_present===false&&['checker_path','handoff_path','qualification_report_path'].every(key=>relativePath(identity[key]))&&['storage_receipt_present','normal_receipt_present','del_receipt_present'].every(key=>evidence[key]===false)&&['full_padded_readback_required','separate_status_required','normal_reboot_required','post_del_required'].every(key=>evidence[key]===true),'device-evidence','A local disabled receipt cannot claim completed device qualification.');
  need(bench.first_test_eligible===false&&bench.write_authorized===false&&bench.owner_confirmed===false&&bench.fresh_b2_preflight_required===true&&bench.owner_confirmation_required===true&&release.eligible===false&&strings(release.required_receipts),'bench-authorization','Bench and public-release authorization must remain separate from this metadata.');
  need(strings(receipt.pending_release_gates)&&receipt.pending_release_gates.every(gate=>/^[a-z][a-z0-9_]{0,127}$/.test(gate)),'pending-gates','The disabled package must list its remaining release checks.');
  const verified=receipt.status==='DISABLED_PACKAGE_VERIFIED'||receipt.status==='DISABLED_PROVISIONAL_PACKAGE_VERIFIED';
  let candidateSummary:NonNullable<BuildReceiptInspection['summary']>['candidate']=null;
  if(verified){
    const candidate=record(receipt.candidate),file=record(candidate.file),bytes=candidate.bytes;
    const extent=uint(bytes)?Math.ceil(bytes/SECTOR)*SECTOR:0;
    const title=typeof candidate.title_bytes_hex==='string'&&/^[a-f0-9]{26}$/.test(candidate.title_bytes_hex)?String.fromCharCode(...candidate.title_bytes_hex.match(/../g)!.map(part=>parseInt(part,16))).replace(/\0.*$/,'').trimEnd():null;
    need(pin(candidate.file)&&uint(bytes)&&bytes>0&&bytes<=MAXIMUM&&bytes===file.bytes&&hash(candidate.sha256)&&candidate.sha256===file.sha256&&uint(candidate.crc32)&&candidate.padded_bytes===extent&&extent<=MAXIMUM&&candidate.sectors===extent/SECTOR&&label(candidate.identity)&&title===candidate.identity,'candidate-identity','The candidate needs consistent size, hash, title and full-sector extents within B2 capacity.');
    need(Array.isArray(xip)&&uint(xip[1])&&uint(bytes)&&xip[1]<=APP1_BASE+bytes,'candidate-range','The linked module must fit inside the composed candidate extent.');
    need(pin(receipt.restore),'restore-pin','A verified local package needs a pinned restoration image.');
    if(uint(bytes)&&hash(candidate.sha256)&&label(candidate.identity))candidateSummary={bytes,sha256:candidate.sha256,identity:candidate.identity};
  }else need(receipt.candidate===null,'candidate-status','A pending or failed package cannot present a verified candidate.');
  // Paths and arbitrary receipt text never enter the returned display summary.
  return result(issues.length?null:{status:String(receipt.status),profileKey:String(family.profile_key),selectionSha256:intentSha,configurationSha256:expected.sha256,configurationMarker:marker,candidate:candidateSummary,pendingGates:[...(receipt.pending_release_gates as string[])]});
}
