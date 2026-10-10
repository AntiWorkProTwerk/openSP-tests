import {exportSelection,readSelection,physicalControls,rejectDuplicateJsonKeys,type Selection} from './selection.ts';

export const STANDALONE_RECIPE='standalone-source16-selected-v1';
export const STANDALONE_SOURCE={bytes:1032317,sha256:'3abb90aafe7ecc1ca669a3f3e35885ddbf3803200db96768ef43fdd16b424117'};
export const STANDALONE_AUTHORITY='ef933914f014d27ba18632906423546aa2394e281167e231314bd59eccd95ed5';
export const P6S_RESTORATION={bytes:2741144,sha256:'7f9917ffb0871cca25b1ce5d281ac5c2bf790ae6b8278b04a5ffef8e3c06fd60'};
export const MAX_STANDALONE_RECEIPT=32768;
export const MAX_APP1=0x37f000;
export const DELIVERY_GATES=['Selected-image native shortcut and runtime qualification','Global capture and native pad recording qualification','Exact-image physical B2 update and normal/DEL reboot evidence'];
type Pin={bytes:number;sha256:string};
type Range={name:string;address:number;size:number};
export type StandaloneReceipt={
 schema:'opensp-standalone-browser-receipt-v1';version:1;recipe:typeof STANDALONE_RECIPE;status:'SOURCE_AND_ARTIFACT_CHECKED_DELIVERY_HELD';
 run_key:string;build_id:string;selection_sha256:string;catalog_digest:string;registry_revision:string;
 configuration:{sha256:string;address:number;bytes:128;feature_mask:number;policy_id:number;session_marker:string;chooser_label:string|null};
 source:{archive:Pin;authority_sha256:string;standalone_report_sha256:string;transaction_sha256:string;selected_report_sha256:string;selected_compile_units:151;restoration_compile_units:27;local_verifier_checked:true};
 candidate:Pin&{title:'SYNTH P6K3!';module_xip:[number,number];writable_intervals:Range[]};restoration:Pin;
 source_recompiled_this_request:boolean;runtime_qualified:false;hardware_qualified:false;public_ready:false;browser_upload_enabled:false;device_operations:false;delivery:'DO_NOT_DELIVER';pending_gates:string[];
};
const need=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>record(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const integer=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff;
const pin=(v:unknown)=>exact(v,['bytes','sha256'])&&integer(v.bytes)&&v.bytes>0&&digest(v.sha256);
export const sha256=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes))),v=>v.toString(16).padStart(2,'0')).join('');
export function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function canonicalLocalSelection(text:string){
 const selection=readSelection(text);need(exportSelection(selection)===text,'Use the exact canonical configuration export.');
 need(selection.profile==='roland-5.52'&&selection.features.length>0&&selection.features.every(f=>['synth','usb-recorder'].includes(f.id)),'Only current Roland v5.52 Synth/recorder selections are supported.');return selection;
}
/** Fixed source archive selection_config.py ABI; no caller policy or macro. */
export async function selectionConfiguration(selection:Selection){
 const raw=new TextEncoder().encode(exportSelection(selection));canonicalLocalSelection(new TextDecoder().decode(raw));
 const selectionSha=await sha256(raw),mask=selection.features.reduce((bits,f)=>bits|(f.id==='synth'?1:2),0);
 const bytes=new Uint8Array(128),view=new DataView(bytes.buffer),unhex=(s:string)=>Uint8Array.from(s.match(/../g)!,b=>parseInt(b,16));
 bytes.set(new TextEncoder().encode('SPCF'));view.setUint16(4,1,true);view.setUint16(6,128,true);view.setUint32(8,0x552,true);view.setUint32(12,mask,true);view.setUint32(16,1,true);
 bytes.set(unhex(selectionSha),24);bytes.set(unhex(selection.catalogDigest),56);
 for(const [index,id]of ['synth','usb-recorder'].entries()){
  let bits=0n,trigger=0;for(const control of selection.features.find(f=>f.id===id)?.shortcut?.controls??[]){const at=physicalControls.findIndex(c=>c.id===control&&c.shortcut);need(at>=0&&at<50,'Unmapped shortcut control.');bits|=1n<<BigInt(at);trigger=at+1;}
  view.setBigUint64(88+16*index,bits,true);view.setUint8(96+16*index,trigger);view.setUint8(97+16*index,index+1);
 }
 view.setUint32(124,crc32(bytes.subarray(0,124)),true);
 const policy=mask===2?0x47524b32:0x50544b32,prefix=new Uint8Array(12+124);prefix.set(new TextEncoder().encode('SPG1CFG1'));new DataView(prefix.buffer).setUint32(8,policy,true);prefix.set(bytes.subarray(0,124),12);
 const marker=crc32(prefix).toString(16).toUpperCase().padStart(8,'0');
 return {bytes,selectionSha,sha256:await sha256(bytes),mask,policy,marker,chooserLabel:mask&1?`SYNTH P6 ${marker}`:null};
}
export function readStandaloneReceipt(text:string):unknown{
 need(new TextEncoder().encode(text).length<=MAX_STANDALONE_RECEIPT,'Standalone receipts must be 32 KiB or smaller.');
 // The canonical emitter permits no duplicate or extra fields; duplicate parser is shared with the exporter.
 rejectDuplicateJsonKeys(text);return JSON.parse(text);
}
export async function inspectStandaloneReceipt(selection:Selection,value:unknown,candidate?:Uint8Array){
 const c=await selectionConfiguration(selection);
 need(exact(value,['schema','version','recipe','status','run_key','build_id','selection_sha256','catalog_digest','registry_revision','configuration','source','candidate','restoration','source_recompiled_this_request','runtime_qualified','hardware_qualified','public_ready','browser_upload_enabled','device_operations','delivery','pending_gates']),'Use a standalone browser receipt version 1.');
 const r=value as unknown as StandaloneReceipt;
 need(r.schema==='opensp-standalone-browser-receipt-v1'&&r.version===1&&r.recipe===STANDALONE_RECIPE&&r.status==='SOURCE_AND_ARTIFACT_CHECKED_DELIVERY_HELD','The source recipe is not admitted.');
 need(/^[a-z0-9][a-z0-9-]{0,63}$/.test(r.run_key)&&r.selection_sha256===c.selectionSha&&r.catalog_digest===selection.catalogDigest&&r.registry_revision===selection.registryRevision,'The receipt belongs to another configuration or catalog.');
 need(['runtime_qualified','hardware_qualified','public_ready','browser_upload_enabled','device_operations'].every(key=>r[key as keyof StandaloneReceipt]===false)&&r.delivery==='DO_NOT_DELIVER','Selected-image delivery holds must remain false.');
 need(typeof r.source_recompiled_this_request==='boolean'&&JSON.stringify(r.pending_gates)===JSON.stringify(DELIVERY_GATES),'The receipt scope differs.');
 const config=r.configuration;
 need(exact(config,['sha256','address','bytes','feature_mask','policy_id','session_marker','chooser_label'])&&config.sha256===c.sha256&&config.bytes===128&&config.feature_mask===c.mask&&config.policy_id===c.policy&&config.session_marker===c.marker&&config.chooser_label===c.chooserLabel,'The linked configuration/identity does not match the selected shortcuts.');
 const source=r.source;
 need(exact(source,['archive','authority_sha256','standalone_report_sha256','transaction_sha256','selected_report_sha256','selected_compile_units','restoration_compile_units','local_verifier_checked'])&&pin(source.archive)&&source.archive.bytes===STANDALONE_SOURCE.bytes&&source.archive.sha256===STANDALONE_SOURCE.sha256&&source.authority_sha256===STANDALONE_AUTHORITY&&[source.standalone_report_sha256,source.transaction_sha256,source.selected_report_sha256].every(digest)&&source.selected_compile_units===151&&source.restoration_compile_units===27&&source.local_verifier_checked===true,'The receipt has no fixed standalone source authority.');
 const image=r.candidate;
 need(exact(image,['bytes','sha256','title','module_xip','writable_intervals'])&&integer(image.bytes)&&image.bytes>0x290000&&image.bytes<=MAX_APP1&&digest(image.sha256)&&image.title==='SYNTH P6K3!','The selected APP1 extent or identity differs.');
 need(r.build_id===`spcf1-${c.selectionSha.slice(0,16)}-${image.sha256.slice(0,16)}`,'The build identity is not bound to the selection and complete image.');
 need(Array.isArray(image.module_xip)&&image.module_xip.length===2&&image.module_xip.every(integer)&&image.module_xip[0]===0x60310000&&image.module_xip[1]===0x60080000+image.bytes&&integer(config.address)&&config.address%32===0&&config.address>=image.module_xip[0]&&config.address+128<=image.module_xip[1],'The configuration escapes its linked module.');
 need(Array.isArray(image.writable_intervals)&&image.writable_intervals.length===7,'The writable ownership report differs.');
 const names=new Set<string>();for(const range of image.writable_intervals){need(exact(range,['name','address','size'])&&typeof range.name==='string'&&/^\.[a-z_]+$/.test(range.name)&&!names.has(range.name)&&integer(range.address)&&integer(range.size)&&range.size>0&&range.address>=0x80000000&&range.address+range.size<=0x84000000,'A writable interval is invalid.');names.add(range.name);}
 for(let i=0;i<image.writable_intervals.length;i++)for(let j=i+1;j<image.writable_intervals.length;j++){const a=image.writable_intervals[i],b=image.writable_intervals[j];need(a.address+a.size<=b.address||b.address+b.size<=a.address,'Writable source owners overlap.');}
 need(pin(r.restoration)&&r.restoration.bytes===P6S_RESTORATION.bytes&&r.restoration.sha256===P6S_RESTORATION.sha256,'The separate P6S restoration differs.');
 if(candidate){
  need(candidate.length===image.bytes&&await sha256(candidate)===image.sha256,'The complete candidate bytes do not match the receipt.');
  const offset=config.address-0x60080000;need(candidate.subarray(offset,offset+128).every((b,i)=>b===c.bytes[i]),'The actual candidate contains another configuration.');
  need(new TextDecoder().decode(candidate.subarray(0x160560,0x16056d))==='SYNTH P6K3!'.padEnd(12,' ')+'\0','The actual candidate title differs.');
  const header=new DataView(candidate.buffer,candidate.byteOffset+0x288200,64);
  need(header.getUint32(0,true)===0x41555053&&header.getUint32(4,true)===0x30315746&&header.getUint32(8,true)===2&&header.getUint32(12,true)===image.bytes-0x288000&&header.getUint32(16,true)===0x80000000&&header.getUint32(32,true)===0x32425053&&header.getUint32(36,true)===17412&&header.getUint32(48,true)===0x8000&&header.getUint32(52,true)===image.bytes-0x290000,'The candidate has no matching bounded B2 APP1 envelope.');
 }
 return {receipt:r,matchesSelection:true as const,candidateVerified:!!candidate,sourceMetadataMatched:true as const,sourceExecutionAuthenticated:false as const,uploadReady:false as const,releaseReady:false as const};
}
/** Always a held selected-image handoff. Qualified restoration admission is separate. */
export function heldB2Handoff(inspection:Awaited<ReturnType<typeof inspectStandaloneReceipt>>){
 need(inspection.candidateVerified,'Inspect the complete candidate bytes before preparing its handoff.');
 const r=inspection.receipt;return {schema:'opensp-selected-b2-handoff-v1',version:1,recipe:STANDALONE_RECIPE,build_id:r.build_id,selection_sha256:r.selection_sha256,configuration_sha256:r.configuration.sha256,candidate:{bytes:r.candidate.bytes,sha256:r.candidate.sha256},source_authority_sha256:STANDALONE_AUTHORITY,writer:{id:'b2-abi2',marker:'52420201',app1_maximum:MAX_APP1},status:'HELD_EXACT_SELECTED_IMAGE_EVIDENCE_REQUIRED',runtime_qualified:false,hardware_qualified:false,upload_authorized:false,device_operations:false,public_ready:false,delivery:'DO_NOT_DELIVER',pending_gates:[...DELIVERY_GATES]};
}
