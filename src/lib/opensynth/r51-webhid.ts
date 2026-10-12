import {inspectStockUsbRouteImage} from './usb-route.ts';

export const R51_WEBHID = Object.freeze({
  vendorId: 0xcafe,
  productId: 0x404f,
  productName: 'SP404 STOCK FLASH R51',
  usagePage: 0xff00,
  usage: 1,
  reportId: 0,
  marker: 0x52650001,
  maximum: 0x37f000,
  jedec: 0xc22016,
  flashStatus: 0x40,
});

const STATUS_FIELDS = ['version','state','error','length','received','crc32','maximum','capabilities',
  'jedec','flash_status','flash_error','programmed','flash_ready','flash_crc32','build_marker'] as const;

export type R51Status = Readonly<Record<(typeof STATUS_FIELDS)[number], number> & {signature:'SP51'}>;
export type R51Collection = Readonly<{usagePage:number;usage:number}>;
export interface R51FeatureDevice {
  readonly vendorId:number;
  readonly productId:number;
  readonly productName:string;
  readonly collections:ReadonlyArray<R51Collection>;
  readonly opened:boolean;
  open():Promise<void>;
  close():Promise<void>;
  receiveFeatureReport(reportId:number):Promise<DataView>;
  sendFeatureReport(reportId:number,data:Uint8Array):Promise<void>;
}

export type R51FreshAttestation = Readonly<{
  format:'opensp-r51-fresh-attestation-v1';
  endpoint:Readonly<{vendorId:number;productId:number;productName:string;usagePage:number;usage:number}>;
  bootEvidence:'power-cycle'|'stock-carrier';
  powerCycleConfirmed:boolean;
  stockCarrierConfirmed:boolean;
  freshConnectionConfirmed:true;
  statusHex:string;
  confirmationStatusHex:string;
  status:R51Status;
  statusReads:2;
  featureReportsSent:0;
}>;

export type R51InstallReceipt = Readonly<{
  format:'opensp-r51-install-receipt-v1';
  image:Readonly<{bytes:number;paddedBytes:number;sectors:number;sha256:string;crc32:number}>;
  initialStatusHex:readonly[string,string];
  preflight:R51Status;
  ramVerified:R51Status;
  terminal:R51Status;
  separateStatusHex:readonly[string,string];
  guardedReset:Readonly<{armToken:number;commitToken:number;armedStatusHex:string;featureReportsSent:2}>;
  transport:Readonly<{featureReportsSent:number;featureReportPayloadSha256:string;statusReportsRead:number;statusReportPayloadSha256:string}>;
  flashWriteVerified:true;
  installationComplete:false;
  remainingCheck:'normal Roland USB return';
}>;

export class R51WebHidError extends Error {
  readonly phase:string;
  readonly code:string;
  readonly evidence:unknown;
  readonly commitSent:boolean;
  constructor(phase:string,code:string,message:string,evidence?:unknown,commitSent=false){
    super(message);this.name='R51WebHidError';this.phase=phase;this.code=code;this.evidence=evidence;this.commitSent=commitSent;
  }
}

const fail=(phase:string,code:string,message:string,evidence?:unknown,commitSent=false):never=>{
  throw new R51WebHidError(phase,code,message,evidence,commitSent);
};
function need(condition:unknown,phase:string,code:string,message:string,evidence?:unknown,commitSent=false):asserts condition{
  if(!condition)fail(phase,code,message,evidence,commitSent);
}
const bytesOf=(view:DataView)=>new Uint8Array(view.buffer,view.byteOffset,view.byteLength).slice();
const hex=(bytes:Uint8Array)=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
const same=(left:Uint8Array,right:Uint8Array)=>left.length===right.length&&left.every((value,index)=>value===right[index]);
const sleepDefault=(milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds));
const crcTable=Uint32Array.from({length:256},(_,start)=>{let crc=start;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);return crc>>>0;});

export function r51Crc32(bytes:Uint8Array):number{
  let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^crcTable[(crc^byte)&255];return (crc^0xffffffff)>>>0;
}

async function sha256(bytes:Uint8Array):Promise<string>{
  need(globalThis.crypto?.subtle,'image','hash-unavailable','WebCrypto SHA-256 is unavailable.');
  const owned=new Uint8Array(bytes.length);owned.set(bytes);
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',owned.buffer)));
}

function concatenate(parts:readonly Uint8Array[]):Uint8Array{
  const result=new Uint8Array(parts.reduce((total,part)=>total+part.length,0));
  let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}

export function r51Command(opcode:number,argument=0,payload=new Uint8Array(),dataLength=0):Uint8Array{
  need(Number.isInteger(opcode)&&opcode>=0&&opcode<=255&&Number.isInteger(argument)&&argument>=0&&argument<=0xffffffff,
    'packet','command-bounds','R51 opcode or argument is outside the feature-report contract.');
  need(payload instanceof Uint8Array&&payload.length<=56&&Number.isInteger(dataLength)&&dataLength>=0&&dataLength<=56,
    'packet','payload-bounds','R51 payload is outside the 56-byte feature-report contract.');
  const report=new Uint8Array(64);report[0]=opcode;report[1]=1;report[2]=dataLength;
  new DataView(report.buffer).setUint32(4,argument,true);report.set(payload,8);return report;
}

export function parseR51Status(view:DataView,phase='status'):Readonly<{raw:Uint8Array;status:R51Status}>{
  const raw=bytesOf(view);
  need(raw.length===64,phase,'report-framing','R51 WebHID must return exactly 64 payload bytes without a report-ID prefix.');
  need(String.fromCharCode(...raw.subarray(0,4))==='SP51',phase,'status-signature','The feature report is not an SP51 status.',hex(raw.subarray(0,8)));
  const words=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  const values=Object.fromEntries(STATUS_FIELDS.map((name,index)=>[name,words.getUint32(4+index*4,true)])) as Record<(typeof STATUS_FIELDS)[number],number>;
  const status=Object.freeze({signature:'SP51' as const,...values});
  need(status.version===2&&status.maximum===R51_WEBHID.maximum&&status.capabilities===3&&status.build_marker===R51_WEBHID.marker,
    phase,'writer-contract','The connected writer is not the frozen R51 contract.',status);
  return Object.freeze({raw,status});
}

function requireFresh(status:R51Status,phase:string):void{
  need(status.state===0&&status.error===0&&status.length===0&&status.received===0&&status.crc32===0&&
    status.jedec===0&&status.flash_status===0&&status.flash_error===0&&status.programmed===0&&status.flash_ready===0&&status.flash_crc32===0,
    phase,'writer-not-fresh','R51 must be freshly idle after its stock-carrier boot or a real power cycle.',status);
}
function requireHealthy(status:R51Status,phase:string,commitSent=false):void{
  need(status.error===0&&status.flash_error===0&&status.state!==7,phase,'firmware-rejected','R51 rejected the operation; preserve status and do not retry.',status,commitSent);
}
function requireProfile(status:R51Status,phase:string):void{
  requireHealthy(status,phase);
  need(status.flash_ready===1&&status.jedec===R51_WEBHID.jedec&&status.flash_status===R51_WEBHID.flashStatus,
    phase,'chip-profile','R51 did not report the required C22016/status40 profile.',status);
}
function terminal(status:R51Status,length:number,crc32:number,paddedBytes:number,phase:string):void{
  requireHealthy(status,phase,true);
  need(status.state===6&&status.length===length&&status.received===length&&status.crc32===crc32&&
    status.programmed===paddedBytes&&status.flash_crc32===crc32&&status.flash_ready===1&&
    status.jedec===R51_WEBHID.jedec&&status.flash_status===R51_WEBHID.flashStatus,
    phase,'flash-result','R51 did not preserve complete full-sector readback evidence.',status,true);
}

export function assertR51Device(device:R51FeatureDevice):void{
  need(device&&device.vendorId===R51_WEBHID.vendorId&&device.productId===R51_WEBHID.productId&&device.productName===R51_WEBHID.productName,
    'endpoint','device-identity','Select the exact SP404 STOCK FLASH R51 device.');
  need(device.collections.some(collection=>collection.usagePage===R51_WEBHID.usagePage&&collection.usage===R51_WEBHID.usage),
    'endpoint','usage-identity','R51 must expose the vendor FF00/1 collection.');
}

async function readStatus(device:R51FeatureDevice,phase:string,statusPayloads?:Uint8Array[]):Promise<Readonly<{raw:Uint8Array;status:R51Status}>>{
  const commitSent=phase==='commit'||phase==='separate-status'||phase==='reset-armed';
  let view:DataView;try{view=await device.receiveFeatureReport(R51_WEBHID.reportId);}catch(error){
    fail(phase,'transport-read',`R51 feature-report read failed: ${error instanceof Error?error.message:String(error)}`,undefined,commitSent);
  }
  try{
    const parsed=parseR51Status(view!,phase);statusPayloads?.push(parsed.raw);return parsed;
  }catch(error){
    if(error instanceof R51WebHidError&&commitSent)
      fail(error.phase,error.code,error.message,error.evidence,true);
    throw error;
  }
}
async function send(device:R51FeatureDevice,report:Uint8Array,phase:string,sent:Uint8Array[],commitSent=false):Promise<void>{
  try{await device.sendFeatureReport(R51_WEBHID.reportId,report);}catch(error){
    fail(phase,'transport-write',`R51 feature-report write failed: ${error instanceof Error?error.message:String(error)}`,undefined,commitSent);
  }
  sent.push(report.slice());
}
async function openDevice(device:R51FeatureDevice,phase:string,commitSent=false):Promise<void>{
  try{await device.open();}catch(error){fail(phase,'transport-open',`R51 open failed: ${error instanceof Error?error.message:String(error)}`,undefined,commitSent);}
}
async function closeDevice(device:R51FeatureDevice,phase:string,commitSent=false):Promise<void>{
  try{await device.close();}catch(error){fail(phase,'transport-close',`R51 close failed: ${error instanceof Error?error.message:String(error)}`,undefined,commitSent);}
}

export async function attestFreshR51(device:R51FeatureDevice,confirmation:Readonly<{
  powerCycleConfirmed:boolean;
  stockCarrierConfirmed?:boolean;
  freshConnectionConfirmed:boolean;
}>):Promise<R51FreshAttestation>{
  assertR51Device(device);
  const bootEvidence=confirmation.powerCycleConfirmed?'power-cycle':confirmation.stockCarrierConfirmed?'stock-carrier':undefined;
  need(bootEvidence&&confirmation.freshConnectionConfirmed,'attestation','confirmation-required',
    'A real power cycle or completed stock carrier, plus a fresh connection, must be confirmed.');
  need(!device.opened,'attestation','already-open','Close other R51 clients before attestation.');
  await openDevice(device,'attestation');
  try{
    const first=await readStatus(device,'attestation'),second=await readStatus(device,'attestation');
    requireFresh(first.status,'attestation');requireFresh(second.status,'attestation');
    need(same(first.raw,second.raw),'attestation','status-changed','The two fresh R51 status reads differ.');
    return Object.freeze({format:'opensp-r51-fresh-attestation-v1',endpoint:Object.freeze({vendorId:device.vendorId,productId:device.productId,
      productName:device.productName,usagePage:R51_WEBHID.usagePage,usage:R51_WEBHID.usage}),bootEvidence,
      powerCycleConfirmed:bootEvidence==='power-cycle',stockCarrierConfirmed:bootEvidence==='stock-carrier',freshConnectionConfirmed:true,
      statusHex:hex(first.raw),confirmationStatusHex:hex(second.raw),status:first.status,statusReads:2,featureReportsSent:0});
  }finally{await closeDevice(device,'attestation');}
}

export type R51InstallOptions=Readonly<{
  expectedSha256:string;
  attestation:R51FreshAttestation;
  maximumProbePolls?:number;
  maximumFlashPolls?:number;
  sleep?:(milliseconds:number)=>Promise<void>;
  onBeforeCommit?:(evidence:Readonly<{imageSha256:string;crc32:number;bytes:number;paddedBytes:number;sectors:number}>)=>void|Promise<void>;
  onProgress?:(event:Readonly<{phase:'preflight'|'upload'|'ram-verified'|'commit'|'flash-verified'|'separate-status'|'reset-armed'|'reset-requested';completedBytes:number;totalBytes:number}>)=>void;
}>;

/** Install one checksum-pinned ABI2 APP1 image through a freshly attested R51 writer. */
export async function installApp1ViaR51(device:R51FeatureDevice,candidate:Uint8Array,options:R51InstallOptions):Promise<R51InstallReceipt>{
  assertR51Device(device);need(!device.opened,'setup','already-open','Close other R51 clients before installation.');
  need(options.attestation?.format==='opensp-r51-fresh-attestation-v1'&&
    ((options.attestation.bootEvidence==='power-cycle'&&options.attestation.powerCycleConfirmed===true&&options.attestation.stockCarrierConfirmed===false)||
     (options.attestation.bootEvidence==='stock-carrier'&&options.attestation.powerCycleConfirmed===false&&options.attestation.stockCarrierConfirmed===true))&&
    options.attestation.freshConnectionConfirmed===true&&options.attestation.featureReportsSent===0&&
    options.attestation.statusReads===2&&options.attestation.endpoint.vendorId===device.vendorId&&
    options.attestation.endpoint.productId===device.productId&&options.attestation.endpoint.productName===device.productName&&
    options.attestation.endpoint.usagePage===R51_WEBHID.usagePage&&options.attestation.endpoint.usage===R51_WEBHID.usage,
    'setup','attestation','The install requires this endpoint’s completed zero-write R51 attestation.');
  need(typeof options.attestation.statusHex==='string'&&/^[a-f0-9]{128}$/i.test(options.attestation.statusHex)&&
    typeof options.attestation.confirmationStatusHex==='string'&&/^[a-f0-9]{128}$/i.test(options.attestation.confirmationStatusHex),
    'setup','attestation-status','The R51 attestation must contain two complete hexadecimal status payloads.');
  const attestedRaw=Uint8Array.from(options.attestation.statusHex.match(/../g)?.map(value=>Number.parseInt(value,16))??[]);
  const attestedConfirmation=Uint8Array.from(options.attestation.confirmationStatusHex.match(/../g)?.map(value=>Number.parseInt(value,16))??[]);
  need(same(attestedRaw,attestedConfirmation)&&attestedRaw.length===64,'setup','attestation-status','The R51 attestation status pair is invalid.');
  requireFresh(parseR51Status(new DataView(attestedRaw.buffer),'setup').status,'setup');
  need(candidate instanceof Uint8Array,'image','image-bytes','The APP1 image must be supplied as raw bytes.');
  const image=candidate.slice(),route=inspectStockUsbRouteImage(image);
  need(typeof options.expectedSha256==='string'&&/^[a-f0-9]{64}$/i.test(options.expectedSha256),'image','image-pin','Pin the APP1 image with a complete SHA-256.');
  const imageSha256=await sha256(image);
  need(imageSha256===options.expectedSha256.toLowerCase(),'image','image-hash','The APP1 bytes differ from the pinned image.',{expected:options.expectedSha256,actual:imageSha256});
  const crc32=r51Crc32(image),paddedBytes=route.paddedBytes,total=image.length;
  const maximumProbePolls=options.maximumProbePolls??200,maximumFlashPolls=options.maximumFlashPolls??1800;
  need(Number.isSafeInteger(maximumProbePolls)&&maximumProbePolls>0&&maximumProbePolls<=10000&&
    Number.isSafeInteger(maximumFlashPolls)&&maximumFlashPolls>0&&maximumFlashPolls<=10000,
    'setup','poll-bounds','R51 poll bounds must be positive and bounded.');
  const sleep=options.sleep??sleepDefault,sent:Uint8Array[]=[],statuses:Uint8Array[]=[];
  const progress=(phase:Parameters<NonNullable<R51InstallOptions['onProgress']>>[0]['phase'],completedBytes:number)=>options.onProgress?.({phase,completedBytes,totalBytes:total});
  let preflight:R51Status|undefined,ramVerified:R51Status|undefined,final:R51Status|undefined;
  let initialHex:readonly[string,string]|undefined,separateHex:readonly[string,string]|undefined,commitSent=false;
  let resetRequested=false,armedStatusHex:string|undefined;
  await openDevice(device,'preflight');
  try{
    const initialA=await readStatus(device,'preflight',statuses),initialB=await readStatus(device,'preflight',statuses);
    requireFresh(initialA.status,'preflight');requireFresh(initialB.status,'preflight');
    need(same(initialA.raw,initialB.raw),'preflight','status-changed','The two pre-write R51 status reads differ.');
    initialHex=Object.freeze([hex(initialA.raw),hex(initialB.raw)] as const);
    progress('preflight',0);await send(device,r51Command(5),'preflight',sent);
    for(let poll=0;poll<maximumProbePolls;poll++){
      const current=(await readStatus(device,'preflight',statuses)).status;requireHealthy(current,'preflight');
      if(current.flash_ready===1){requireProfile(current,'preflight');preflight=current;break;}
      need(current.flash_ready===0,'preflight','probe-ready','R51 returned an invalid flash-ready value.',current);
      await sleep(50);
    }
    need(preflight,'preflight','probe-timeout','R51 chip/profile preflight timed out; BEGIN was not sent.');
    const crcPayload=new Uint8Array(4);new DataView(crcPayload.buffer).setUint32(0,crc32,true);
    await send(device,r51Command(1,total,crcPayload),'upload',sent);
    let nextCheckpoint=65536;
    for(let offset=0;offset<total;offset+=56){
      const part=image.subarray(offset,Math.min(total,offset+56));await send(device,r51Command(2,offset,part,part.length),'upload',sent);
      const received=offset+part.length;
      if(received>=nextCheckpoint||received===total){
        const status=(await readStatus(device,'upload',statuses)).status;requireHealthy(status,'upload');
        need(status.state===1&&status.length===total&&status.received===received,'upload','chunk-result','R51 did not acknowledge the ordered upload extent.',status);
        progress('upload',received);while(nextCheckpoint<=received)nextCheckpoint+=65536;
      }
    }
    await send(device,r51Command(3),'ram-verified',sent);ramVerified=(await readStatus(device,'ram-verified',statuses)).status;
    requireProfile(ramVerified,'ram-verified');need(ramVerified.state===2&&ramVerified.length===total&&ramVerified.received===total&&ramVerified.crc32===crc32,
      'ram-verified','ram-result','R51 RAM CRC or extent verification failed.',ramVerified);progress('ram-verified',total);
    try{
      await options.onBeforeCommit?.(Object.freeze({imageSha256,crc32,bytes:total,paddedBytes,sectors:route.sectors}));
    }catch(error){
      fail('commit-journal','journal-failure',`The caller could not seal its pre-COMMIT journal: ${error instanceof Error?error.message:String(error)} COMMIT was not sent.`);
    }
    progress('commit',0);await send(device,r51Command(6,(crc32^0x46534c48)>>>0),'commit',sent,true);commitSent=true;
    for(let poll=0;poll<maximumFlashPolls;poll++){
      const status=(await readStatus(device,'commit',statuses)).status;requireHealthy(status,'commit',true);
      if(status.state===6){terminal(status,total,crc32,paddedBytes,'commit');final=status;break;}
      need(status.state===4||status.state===5,'commit','commit-state','R51 entered an unexpected post-COMMIT state.',status,true);
      progress('commit',Math.min(status.programmed,total));await sleep(100);
    }
    need(final,'commit','flash-timeout','R51 flash completion timed out. COMMIT was sent; do not retry.',undefined,true);
    progress('flash-verified',total);
  }catch(error){
    if(error instanceof R51WebHidError)throw error;
    fail(commitSent?'commit':'transport','transport-failure',error instanceof Error?error.message:String(error),undefined,commitSent);
  }finally{await closeDevice(device,commitSent?'commit':'transport',commitSent);}

  await openDevice(device,'separate-status',true);
  try{
    const separateA=await readStatus(device,'separate-status',statuses),separateB=await readStatus(device,'separate-status',statuses);
    terminal(separateA.status,total,crc32,paddedBytes,'separate-status');terminal(separateB.status,total,crc32,paddedBytes,'separate-status');
    need(same(separateA.raw,separateB.raw),'separate-status','status-changed','The two separately reopened terminal status reads differ.',undefined,true);
    final=separateB.status;separateHex=Object.freeze([hex(separateA.raw),hex(separateB.raw)] as const);progress('separate-status',total);
    const armToken=(crc32^0x52535141)>>>0,commitToken=(crc32^0x52535143)>>>0;
    await send(device,r51Command(13,armToken),'reset-armed',sent,true);
    const armed=await readStatus(device,'reset-armed',statuses);
    terminal(armed.status,total,crc32,paddedBytes,'reset-armed');
    need(same(armed.raw,separateB.raw),'reset-armed','status-changed','R51 terminal status changed while the guarded reset was armed.',armed.status,true);
    armedStatusHex=hex(armed.raw);progress('reset-armed',total);
    await send(device,r51Command(14,commitToken),'reset-requested',sent,true);
    resetRequested=true;progress('reset-requested',total);
  }finally{
    try{await closeDevice(device,'reset-requested',true);}catch(error){if(!resetRequested)throw error;}
  }
  const sentBytes=concatenate(sent),statusBytes=concatenate(statuses);
  return Object.freeze({format:'opensp-r51-install-receipt-v1',image:Object.freeze({bytes:total,paddedBytes,sectors:route.sectors,sha256:imageSha256,crc32}),
    initialStatusHex:initialHex!,preflight:preflight!,ramVerified:ramVerified!,terminal:final!,separateStatusHex:separateHex!,
    guardedReset:Object.freeze({armToken:(crc32^0x52535141)>>>0,commitToken:(crc32^0x52535143)>>>0,
      armedStatusHex:armedStatusHex!,featureReportsSent:2 as const}),
    transport:Object.freeze({featureReportsSent:sent.length,featureReportPayloadSha256:await sha256(sentBytes),statusReportsRead:statuses.length,statusReportPayloadSha256:await sha256(statusBytes)}),
    flashWriteVerified:true,installationComplete:false,remainingCheck:'normal Roland USB return'});
}

/** Backward-compatible OpenSynth name. New integrations should call installApp1ViaR51. */
export const installOpenSynthViaR51=installApp1ViaR51;
