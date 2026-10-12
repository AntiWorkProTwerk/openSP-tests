import {inspectStockUsbRouteImage} from './usb-route.ts';

export const R50_WEBHID = Object.freeze({
  vendorId: 0xcafe,
  productId: 0x404f,
  productName: 'SP404 STOCK FLASH R50',
  usagePage: 0xff00,
  usage: 1,
  reportId: 0,
  marker: 0x52640001,
  maximum: 0x37f000,
  jedec: 0xc22016,
  flashStatus: 0x40,
});

export const B2_WEBHID = Object.freeze({
  vendorId: 0xcafe,
  productId: 0x4050,
  productName: 'SP404 USB BRIDGE B2',
  usagePage: 0xff00,
  usage: 1,
  reportId: 0,
  marker: 0x52420201,
  maximum: 0x37f000,
  expectedNormalIdentity: 'openSynthP34',
});

const STATUS_FIELDS = ['version','state','error','length','received','crc32','maximum','capabilities',
  'jedec','flash_status','flash_error','programmed','flash_ready','flash_crc32','build_marker'] as const;

export type R50Status = Readonly<Record<(typeof STATUS_FIELDS)[number], number> & {signature:'SP50'}>;
export type R50Collection = Readonly<{usagePage:number;usage:number}>;
export interface R50FeatureDevice {
  readonly vendorId:number;
  readonly productId:number;
  readonly productName:string;
  readonly collections:ReadonlyArray<R50Collection>;
  readonly opened:boolean;
  open():Promise<void>;
  close():Promise<void>;
  receiveFeatureReport(reportId:number):Promise<DataView>;
  sendFeatureReport(reportId:number,data:Uint8Array):Promise<void>;
}

export type R50FreshAttestation = Readonly<{
  format:'opensp-r50-fresh-attestation-v1';
  endpoint:Readonly<{vendorId:number;productId:number;productName:string;usagePage:number;usage:number}>;
  bootEvidence:'power-cycle'|'stock-carrier';
  powerCycleConfirmed:boolean;
  stockCarrierConfirmed:boolean;
  freshConnectionConfirmed:true;
  statusHex:string;
  confirmationStatusHex:string;
  status:R50Status;
  statusReads:2;
  featureReportsSent:0;
}>;

export type R50InstallReceipt = Readonly<{
  format:'opensp-r50-install-receipt-v1';
  image:Readonly<{bytes:number;paddedBytes:number;sectors:number;sha256:string;crc32:number}>;
  initialStatusHex:readonly[string,string];
  preflight:R50Status;
  ramVerified:R50Status;
  terminal:R50Status;
  separateStatusHex:readonly[string,string];
  transport:Readonly<{featureReportsSent:number;featureReportPayloadSha256:string;statusReportsRead:number;statusReportPayloadSha256:string}>;
  flashWriteVerified:true;
  installationComplete:false;
  remainingChecks:readonly['normal OpenSynth reboot','cold-DEL B2 return'];
}>;

export type B2Status = Readonly<Record<(typeof STATUS_FIELDS)[number], number> & {signature:'SP17'}>;
export type R50InstallCompletion = Readonly<{
  format:'opensp-r50-install-completion-v1';
  installReceipt:R50InstallReceipt;
  normalBoot:Readonly<{powerCycleConfirmed:true;identity:'openSynthP34'}>;
  coldDelBoot:Readonly<{
    powerCycleConfirmed:true;
    delHeldConfirmed:true;
    freshConnectionConfirmed:true;
    endpoint:Readonly<{vendorId:number;productId:number;productName:string;usagePage:number;usage:number}>;
    status:B2Status;
    statusHex:readonly[string,string];
    statusReads:2;
    featureReportsSent:0;
  }>;
  installationComplete:true;
}>;

export class R50WebHidError extends Error {
  readonly phase:string;
  readonly code:string;
  readonly evidence:unknown;
  readonly commitSent:boolean;
  constructor(phase:string,code:string,message:string,evidence?:unknown,commitSent=false){
    super(message);this.name='R50WebHidError';this.phase=phase;this.code=code;this.evidence=evidence;this.commitSent=commitSent;
  }
}

const fail=(phase:string,code:string,message:string,evidence?:unknown,commitSent=false):never=>{
  throw new R50WebHidError(phase,code,message,evidence,commitSent);
};
function need(condition:unknown,phase:string,code:string,message:string,evidence?:unknown,commitSent=false):asserts condition{
  if(!condition)fail(phase,code,message,evidence,commitSent);
}
const bytesOf=(view:DataView)=>new Uint8Array(view.buffer,view.byteOffset,view.byteLength).slice();
const hex=(bytes:Uint8Array)=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
const same=(left:Uint8Array,right:Uint8Array)=>left.length===right.length&&left.every((value,index)=>value===right[index]);
const sleepDefault=(milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds));
const crcTable=Uint32Array.from({length:256},(_,start)=>{let crc=start;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);return crc>>>0;});

export function r50Crc32(bytes:Uint8Array):number{
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

export function r50Command(opcode:number,argument=0,payload=new Uint8Array(),dataLength=0):Uint8Array{
  need(Number.isInteger(opcode)&&opcode>=0&&opcode<=255&&Number.isInteger(argument)&&argument>=0&&argument<=0xffffffff,
    'packet','command-bounds','R50 opcode or argument is outside the feature-report contract.');
  need(payload instanceof Uint8Array&&payload.length<=56&&Number.isInteger(dataLength)&&dataLength>=0&&dataLength<=56,
    'packet','payload-bounds','R50 payload is outside the 56-byte feature-report contract.');
  const report=new Uint8Array(64);report[0]=opcode;report[1]=1;report[2]=dataLength;
  new DataView(report.buffer).setUint32(4,argument,true);report.set(payload,8);return report;
}

export function parseR50Status(view:DataView,phase='status'):Readonly<{raw:Uint8Array;status:R50Status}>{
  const raw=bytesOf(view);
  need(raw.length===64,phase,'report-framing','R50 WebHID must return exactly 64 payload bytes without a report-ID prefix.');
  need(String.fromCharCode(...raw.subarray(0,4))==='SP50',phase,'status-signature','The feature report is not an SP50 status.',hex(raw.subarray(0,8)));
  const words=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  const values=Object.fromEntries(STATUS_FIELDS.map((name,index)=>[name,words.getUint32(4+index*4,true)])) as Record<(typeof STATUS_FIELDS)[number],number>;
  const status=Object.freeze({signature:'SP50' as const,...values});
  need(status.version===2&&status.maximum===R50_WEBHID.maximum&&status.capabilities===1&&status.build_marker===R50_WEBHID.marker,
    phase,'writer-contract','The connected writer is not the frozen R50 contract.',status);
  return Object.freeze({raw,status});
}

export function parseB2Status(view:DataView,phase='b2-status'):Readonly<{raw:Uint8Array;status:B2Status}>{
  const raw=bytesOf(view);
  need(raw.length===64,phase,'report-framing','B2 WebHID must return exactly 64 payload bytes without a report-ID prefix.');
  need(String.fromCharCode(...raw.subarray(0,4))==='SP17',phase,'status-signature','The feature report is not an SP17 status.',hex(raw.subarray(0,8)));
  const words=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  const values=Object.fromEntries(STATUS_FIELDS.map((name,index)=>[name,words.getUint32(4+index*4,true)])) as Record<(typeof STATUS_FIELDS)[number],number>;
  const status=Object.freeze({signature:'SP17' as const,...values});
  need(status.version===2&&status.maximum===B2_WEBHID.maximum&&status.capabilities===1&&status.build_marker===B2_WEBHID.marker,
    phase,'writer-contract','The connected DEL-boot writer is not the retained B2 contract.',status);
  return Object.freeze({raw,status});
}

function requireFresh(status:R50Status,phase:string):void{
  need(status.state===0&&status.error===0&&status.length===0&&status.received===0&&status.crc32===0&&
    status.jedec===0&&status.flash_status===0&&status.flash_error===0&&status.programmed===0&&status.flash_ready===0&&status.flash_crc32===0,
    phase,'writer-not-fresh','R50 must be freshly idle after a real power cycle.',status);
}
function requireHealthy(status:R50Status,phase:string,commitSent=false):void{
  need(status.error===0&&status.flash_error===0&&status.state!==7,phase,'firmware-rejected','R50 rejected the operation; preserve status and do not retry.',status,commitSent);
}
function requireProfile(status:R50Status,phase:string):void{
  requireHealthy(status,phase);
  need(status.flash_ready===1&&status.jedec===R50_WEBHID.jedec&&status.flash_status===R50_WEBHID.flashStatus,
    phase,'chip-profile','R50 did not report the required C22016/status40 profile.',status);
}
function terminal(status:R50Status,length:number,crc32:number,paddedBytes:number,phase:string):void{
  requireHealthy(status,phase,true);
  need(status.state===6&&status.length===length&&status.received===length&&status.crc32===crc32&&
    status.programmed===paddedBytes&&status.flash_crc32===crc32&&status.flash_ready===1&&
    status.jedec===R50_WEBHID.jedec&&status.flash_status===R50_WEBHID.flashStatus,
    phase,'flash-result','R50 did not preserve complete full-sector readback evidence.',status,true);
}

export function assertR50Device(device:R50FeatureDevice):void{
  need(device&&device.vendorId===R50_WEBHID.vendorId&&device.productId===R50_WEBHID.productId&&device.productName===R50_WEBHID.productName,
    'endpoint','device-identity','Select the exact SP404 STOCK FLASH R50 device.');
  need(device.collections.some(collection=>collection.usagePage===R50_WEBHID.usagePage&&collection.usage===R50_WEBHID.usage),
    'endpoint','usage-identity','R50 must expose the vendor FF00/1 collection.');
}

export function assertB2Device(device:R50FeatureDevice):void{
  need(device&&device.vendorId===B2_WEBHID.vendorId&&device.productId===B2_WEBHID.productId&&device.productName===B2_WEBHID.productName,
    'b2-endpoint','device-identity','Select the exact SP404 USB BRIDGE B2 device.');
  need(device.collections.some(collection=>collection.usagePage===B2_WEBHID.usagePage&&collection.usage===B2_WEBHID.usage),
    'b2-endpoint','usage-identity','B2 must expose the vendor FF00/1 collection.');
}

async function readStatus(device:R50FeatureDevice,phase:string,statusPayloads?:Uint8Array[]):Promise<Readonly<{raw:Uint8Array;status:R50Status}>>{
  let view:DataView;try{view=await device.receiveFeatureReport(R50_WEBHID.reportId);}catch(error){
    fail(phase,'transport-read',`R50 feature-report read failed: ${error instanceof Error?error.message:String(error)}`,undefined,phase==='commit'||phase==='separate-status');
  }
  const parsed=parseR50Status(view!,phase);statusPayloads?.push(parsed.raw);return parsed;
}
async function send(device:R50FeatureDevice,report:Uint8Array,phase:string,sent:Uint8Array[],commitSent=false):Promise<void>{
  try{await device.sendFeatureReport(R50_WEBHID.reportId,report);}catch(error){
    fail(phase,'transport-write',`R50 feature-report write failed: ${error instanceof Error?error.message:String(error)}`,undefined,commitSent);
  }
  sent.push(report.slice());
}
async function openDevice(device:R50FeatureDevice,phase:string,commitSent=false):Promise<void>{
  try{await device.open();}catch(error){fail(phase,'transport-open',`R50 open failed: ${error instanceof Error?error.message:String(error)}`,undefined,commitSent);}
}
async function closeDevice(device:R50FeatureDevice,phase:string,commitSent=false):Promise<void>{
  try{await device.close();}catch(error){fail(phase,'transport-close',`R50 close failed: ${error instanceof Error?error.message:String(error)}`,undefined,commitSent);}
}

export async function attestFreshR50(device:R50FeatureDevice,confirmation:Readonly<{
  powerCycleConfirmed:boolean;
  stockCarrierConfirmed?:boolean;
  freshConnectionConfirmed:boolean;
}>):Promise<R50FreshAttestation>{
  assertR50Device(device);
  const bootEvidence=confirmation.powerCycleConfirmed?'power-cycle':confirmation.stockCarrierConfirmed?'stock-carrier':undefined;
  need(bootEvidence&&confirmation.freshConnectionConfirmed,'attestation','confirmation-required',
    'A real power cycle or completed stock carrier, plus a fresh connection, must be confirmed.');
  need(!device.opened,'attestation','already-open','Close other R50 clients before attestation.');
  await openDevice(device,'attestation');
  try{
    const first=await readStatus(device,'attestation'),second=await readStatus(device,'attestation');
    requireFresh(first.status,'attestation');requireFresh(second.status,'attestation');
    need(same(first.raw,second.raw),'attestation','status-changed','The two fresh R50 status reads differ.');
    return Object.freeze({format:'opensp-r50-fresh-attestation-v1',endpoint:Object.freeze({vendorId:device.vendorId,productId:device.productId,
      productName:device.productName,usagePage:R50_WEBHID.usagePage,usage:R50_WEBHID.usage}),bootEvidence,
      powerCycleConfirmed:bootEvidence==='power-cycle',stockCarrierConfirmed:bootEvidence==='stock-carrier',freshConnectionConfirmed:true,
      statusHex:hex(first.raw),confirmationStatusHex:hex(second.raw),status:first.status,statusReads:2,featureReportsSent:0});
  }finally{await closeDevice(device,'attestation');}
}

export type R50InstallOptions=Readonly<{
  expectedSha256:string;
  attestation:R50FreshAttestation;
  maximumProbePolls?:number;
  maximumFlashPolls?:number;
  sleep?:(milliseconds:number)=>Promise<void>;
  onProgress?:(event:Readonly<{phase:'preflight'|'upload'|'ram-verified'|'commit'|'flash-verified'|'separate-status';completedBytes:number;totalBytes:number}>)=>void;
}>;

export async function installOpenSynthViaR50(device:R50FeatureDevice,candidate:Uint8Array,options:R50InstallOptions):Promise<R50InstallReceipt>{
  assertR50Device(device);need(!device.opened,'setup','already-open','Close other R50 clients before installation.');
  need(options.attestation?.format==='opensp-r50-fresh-attestation-v1'&&
    ((options.attestation.bootEvidence==='power-cycle'&&options.attestation.powerCycleConfirmed===true&&options.attestation.stockCarrierConfirmed===false)||
     (options.attestation.bootEvidence==='stock-carrier'&&options.attestation.powerCycleConfirmed===false&&options.attestation.stockCarrierConfirmed===true))&&
    options.attestation.freshConnectionConfirmed===true&&options.attestation.featureReportsSent===0&&
    options.attestation.statusReads===2&&options.attestation.endpoint.vendorId===device.vendorId&&
    options.attestation.endpoint.productId===device.productId&&options.attestation.endpoint.productName===device.productName&&
    options.attestation.endpoint.usagePage===R50_WEBHID.usagePage&&options.attestation.endpoint.usage===R50_WEBHID.usage,
    'setup','attestation','The install requires this endpoint’s completed zero-write R50 attestation.');
  const attestedRaw=Uint8Array.from(options.attestation.statusHex.match(/../g)?.map(value=>Number.parseInt(value,16))??[]);
  const attestedConfirmation=Uint8Array.from(options.attestation.confirmationStatusHex.match(/../g)?.map(value=>Number.parseInt(value,16))??[]);
  need(same(attestedRaw,attestedConfirmation)&&attestedRaw.length===64,'setup','attestation-status','The R50 attestation status pair is invalid.');
  requireFresh(parseR50Status(new DataView(attestedRaw.buffer),'setup').status,'setup');
  need(candidate instanceof Uint8Array,'image','image-bytes','OpenSynth must be supplied as raw bytes.');
  const image=candidate.slice(),route=inspectStockUsbRouteImage(image);
  need(typeof options.expectedSha256==='string'&&/^[a-f0-9]{64}$/i.test(options.expectedSha256),'image','image-pin','Pin OpenSynth with a complete SHA-256.');
  const imageSha256=await sha256(image);
  need(imageSha256===options.expectedSha256.toLowerCase(),'image','image-hash','OpenSynth bytes differ from the pinned patch result.',{expected:options.expectedSha256,actual:imageSha256});
  const crc32=r50Crc32(image),paddedBytes=route.paddedBytes,total=image.length;
  const maximumProbePolls=options.maximumProbePolls??200,maximumFlashPolls=options.maximumFlashPolls??1800;
  need(Number.isSafeInteger(maximumProbePolls)&&maximumProbePolls>0&&maximumProbePolls<=10000&&
    Number.isSafeInteger(maximumFlashPolls)&&maximumFlashPolls>0&&maximumFlashPolls<=10000,
    'setup','poll-bounds','R50 poll bounds must be positive and bounded.');
  const sleep=options.sleep??sleepDefault,sent:Uint8Array[]=[],statuses:Uint8Array[]=[];
  const progress=(phase:Parameters<NonNullable<R50InstallOptions['onProgress']>>[0]['phase'],completedBytes:number)=>options.onProgress?.({phase,completedBytes,totalBytes:total});
  let preflight:R50Status|undefined,ramVerified:R50Status|undefined,final:R50Status|undefined;
  let initialHex:readonly[string,string]|undefined,separateHex:readonly[string,string]|undefined,commitSent=false;
  await openDevice(device,'preflight');
  try{
    const initialA=await readStatus(device,'preflight',statuses),initialB=await readStatus(device,'preflight',statuses);
    requireFresh(initialA.status,'preflight');requireFresh(initialB.status,'preflight');
    need(same(initialA.raw,initialB.raw),'preflight','status-changed','The two pre-write R50 status reads differ.');
    initialHex=Object.freeze([hex(initialA.raw),hex(initialB.raw)] as const);
    progress('preflight',0);await send(device,r50Command(5),'preflight',sent);
    for(let poll=0;poll<maximumProbePolls;poll++){
      const current=(await readStatus(device,'preflight',statuses)).status;requireHealthy(current,'preflight');
      if(current.flash_ready===1){requireProfile(current,'preflight');preflight=current;break;}
      need(current.flash_ready===0,'preflight','probe-ready','R50 returned an invalid flash-ready value.',current);
      await sleep(50);
    }
    need(preflight,'preflight','probe-timeout','R50 chip/profile preflight timed out; BEGIN was not sent.');
    const crcPayload=new Uint8Array(4);new DataView(crcPayload.buffer).setUint32(0,crc32,true);
    await send(device,r50Command(1,total,crcPayload),'upload',sent);
    let nextCheckpoint=65536;
    for(let offset=0;offset<total;offset+=56){
      const part=image.subarray(offset,Math.min(total,offset+56));await send(device,r50Command(2,offset,part,part.length),'upload',sent);
      const received=offset+part.length;
      if(received>=nextCheckpoint||received===total){
        const status=(await readStatus(device,'upload',statuses)).status;requireHealthy(status,'upload');
        need(status.state===1&&status.length===total&&status.received===received,'upload','chunk-result','R50 did not acknowledge the ordered upload extent.',status);
        progress('upload',received);while(nextCheckpoint<=received)nextCheckpoint+=65536;
      }
    }
    await send(device,r50Command(3),'ram-verified',sent);ramVerified=(await readStatus(device,'ram-verified',statuses)).status;
    requireProfile(ramVerified,'ram-verified');need(ramVerified.state===2&&ramVerified.length===total&&ramVerified.received===total&&ramVerified.crc32===crc32,
      'ram-verified','ram-result','R50 RAM CRC or extent verification failed.',ramVerified);progress('ram-verified',total);
    progress('commit',0);await send(device,r50Command(6,(crc32^0x46534c48)>>>0),'commit',sent,true);commitSent=true;
    for(let poll=0;poll<maximumFlashPolls;poll++){
      const status=(await readStatus(device,'commit',statuses)).status;requireHealthy(status,'commit',true);
      if(status.state===6){terminal(status,total,crc32,paddedBytes,'commit');final=status;break;}
      need(status.state===4||status.state===5,'commit','commit-state','R50 entered an unexpected post-COMMIT state.',status,true);
      progress('commit',Math.min(status.programmed,total));await sleep(100);
    }
    need(final,'commit','flash-timeout','R50 flash completion timed out. COMMIT was sent; do not retry.',undefined,true);
    progress('flash-verified',total);
  }catch(error){
    if(error instanceof R50WebHidError)throw error;
    fail(commitSent?'commit':'transport','transport-failure',error instanceof Error?error.message:String(error),undefined,commitSent);
  }finally{await closeDevice(device,commitSent?'commit':'transport',commitSent);}

  await openDevice(device,'separate-status',true);
  try{
    const separateA=await readStatus(device,'separate-status',statuses),separateB=await readStatus(device,'separate-status',statuses);
    terminal(separateA.status,total,crc32,paddedBytes,'separate-status');terminal(separateB.status,total,crc32,paddedBytes,'separate-status');
    need(same(separateA.raw,separateB.raw),'separate-status','status-changed','The two separately reopened terminal status reads differ.',undefined,true);
    final=separateB.status;separateHex=Object.freeze([hex(separateA.raw),hex(separateB.raw)] as const);progress('separate-status',total);
  }finally{await closeDevice(device,'separate-status',true);}
  const sentBytes=concatenate(sent),statusBytes=concatenate(statuses);
  return Object.freeze({format:'opensp-r50-install-receipt-v1',image:Object.freeze({bytes:total,paddedBytes,sectors:route.sectors,sha256:imageSha256,crc32}),
    initialStatusHex:initialHex!,preflight:preflight!,ramVerified:ramVerified!,terminal:final!,separateStatusHex:separateHex!,
    transport:Object.freeze({featureReportsSent:sent.length,featureReportPayloadSha256:await sha256(sentBytes),statusReportsRead:statuses.length,statusReportPayloadSha256:await sha256(statusBytes)}),
    flashWriteVerified:true,installationComplete:false,remainingChecks:Object.freeze(['normal OpenSynth reboot','cold-DEL B2 return'] as const)});
}

export async function completeR50OpenSynthInstall(
  device:R50FeatureDevice,
  installReceipt:R50InstallReceipt,
  confirmation:Readonly<{
    normalPowerCycleConfirmed:boolean;
    normalIdentity:string;
    coldDelPowerCycleConfirmed:boolean;
    delHeldConfirmed:boolean;
    freshConnectionConfirmed:boolean;
  }>,
):Promise<R50InstallCompletion>{
  assertB2Device(device);
  need(installReceipt?.format==='opensp-r50-install-receipt-v1'&&installReceipt.flashWriteVerified===true&&
    installReceipt.installationComplete===false&&installReceipt.terminal.state===6&&
    installReceipt.remainingChecks.length===2&&installReceipt.remainingChecks[0]==='normal OpenSynth reboot'&&
    installReceipt.remainingChecks[1]==='cold-DEL B2 return',
    'completion','install-receipt','A completed R50 flash/readback receipt is required.');
  need(confirmation.normalPowerCycleConfirmed&&confirmation.normalIdentity===B2_WEBHID.expectedNormalIdentity,
    'completion','normal-boot','Confirm a real normal power cycle and the exact openSynthP34 screen identity.');
  need(confirmation.coldDelPowerCycleConfirmed&&confirmation.delHeldConfirmed&&confirmation.freshConnectionConfirmed,
    'completion','cold-del-confirmation','Confirm a separate cold DEL-held power cycle and fresh B2 connection.');
  need(!device.opened,'completion','already-open','Close other B2 clients before completion attestation.');
  await openDevice(device,'completion');
  try{
    let firstView:DataView,secondView:DataView;
    try{
      firstView=await device.receiveFeatureReport(B2_WEBHID.reportId);
      secondView=await device.receiveFeatureReport(B2_WEBHID.reportId);
    }catch(error){
      fail('completion','transport-read',`B2 feature-report read failed: ${error instanceof Error?error.message:String(error)}`);
    }
    const first=parseB2Status(firstView!,'completion'),second=parseB2Status(secondView!,'completion');
    const idle=(status:B2Status)=>status.state===0&&status.error===0&&status.length===0&&status.received===0&&status.crc32===0&&
      status.flash_error===0&&status.programmed===0&&status.flash_crc32===0;
    need(idle(first.status)&&idle(second.status),'completion','writer-not-fresh','B2 must be freshly idle after the cold DEL-held power cycle.',
      {first:first.status,second:second.status});
    need(same(first.raw,second.raw),'completion','status-changed','The two fresh B2 status reads differ.');
    return Object.freeze({format:'opensp-r50-install-completion-v1',installReceipt,
      normalBoot:Object.freeze({powerCycleConfirmed:true,identity:B2_WEBHID.expectedNormalIdentity}),
      coldDelBoot:Object.freeze({powerCycleConfirmed:true,delHeldConfirmed:true,freshConnectionConfirmed:true,
        endpoint:Object.freeze({vendorId:device.vendorId,productId:device.productId,productName:device.productName,
          usagePage:B2_WEBHID.usagePage,usage:B2_WEBHID.usage}),status:second.status,
        statusHex:Object.freeze([hex(first.raw),hex(second.raw)] as const),statusReads:2,featureReportsSent:0}),
      installationComplete:true});
  }finally{await closeDevice(device,'completion');}
}
