const te = new TextEncoder();

export const STOCK_USB = Object.freeze({
  vendorId: 0x0582,
  productId: 0x02e7,
  configurationValue: 1,
  packetBytes: 512,
});

/** Revision-V stock handoff rebuilt with R51; its R50-equivalent alignment is physically proven. */
export const STOCK_R51_V = Object.freeze({
  stagePath: '/SP404REMOTE///ROLAND\\SP-404MKII/OS51B87E.BIN',
  writerBytes: 18_500,
  writerSha256: '6e72ed9487089f3014ccd161f3600eeb85979285890437cd34be4b51fda4ef26',
  carrierBytes: 26_112,
  carrierSha256: 'c082ec3733096a99ba55a7aada19388eea1ed0eef2f2d7ff148c5add99669831',
  carrierPackets: 51,
  packetBytes: 512,
  alignmentSafeFrames: 3,
  minimumInterpacketMs: 20,
  claimKey: 'opensp:stock-r51v:c082ec3733096a99ba55a7aada19388eea1ed0eef2f2d7ff148c5add99669831',
});

export const OPEN_SYNTH_P34_IMAGE = Object.freeze({
  bytes: 2_830_672,
  sha256: '00299601316516283cdda08b66893cee09d0375f9719759c9e13917503b5e864',
  crc32: 0x2b892d87,
  paddedBytes: 2_834_432,
  sectors: 692,
});

export const STOCK_R51 = Object.freeze({
  stagePath: '/SP404REMOTE///ROLAND\\SP-404MKII/OS342D87.BIN',
  r51Bytes: 2_830_672,
  r51Sha256: '00299601316516283cdda08b66893cee09d0375f9719759c9e13917503b5e864',
  carrierBytes: 5_632,
  carrierSha256: '65888c144d27cf286bf3d5ea323b4f95e2737ed8ed94dbabe027f586bdd0bda2',
  carrierPackets: 11,
  packetBytes: 512,
  minimumInterpacketMs: 20,
  triggerPrefixBytes: 16,
  minimumTriggerSplitMs: 100,
  claimKey: 'opensp:stock-p34x:65888c144d27cf286bf3d5ea323b4f95e2737ed8ed94dbabe027f586bdd0bda2',
});

export const STOCK_P34_PREFLIGHT = Object.freeze({
  carrierBytes: 2_560,
  carrierSha256: '773179fcb6713de25d368833d6d0be439e19a174080d5e2548c3a80256b704d7',
  carrierPackets: 5,
  packetBytes: 512,
  minimumInterpacketMs: 20,
  triggerPrefixBytes: 16,
  minimumTriggerSplitMs: 100,
});

export const STOCK_P34_DELTA = Object.freeze({
  stagePath: '/SP404REMOTE///ROLAND\\SP-404MKII/OD342D87.BIN',
  deltaBytes: 165_559,
  deltaSha256: '3e84b57f11a39ad16db0219cb2f9887c87c72ddc3c218c0f4d4742d60c6800fa',
  carrierBytes: 6_656,
  carrierSha256: '4e85b44a47cc014a9ccea122598c359938b38c818760c64bf4794a3aa21de3bd',
  carrierPackets: 13,
  packetBytes: 512,
  minimumInterpacketMs: 20,
  triggerPrefixBytes: 16,
  minimumTriggerSplitMs: 100,
  sourceSha256: '4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80',
  targetSha256: '00299601316516283cdda08b66893cee09d0375f9719759c9e13917503b5e864',
  claimKey: 'opensp:stock-p34z:4e85b44a47cc014a9ccea122598c359938b38c818760c64bf4794a3aa21de3bd',
});

export type StockClaimState = 'claimed' | 'stage-verified' | 'carrier-started' | 'carrier-complete' | 'r51-attested';
export type StockClaim = Readonly<{
  format:'opensp-stock-p34x-claim-v1';
  state:StockClaimState;
  createdAt:string;
  updatedAt:string;
  stagePath:string;
  r51Sha256:string;
  carrierSha256:string;
  retryAllowed:false;
}>;

export interface StockClaimStore {
  load(): string | null;
  save(value:string): void;
}

export type UsbEndpointLike = Readonly<{endpointNumber:number;direction:string;type:string;packetSize:number}>;
export type UsbAlternateLike = Readonly<{
  alternateSetting:number;
  interfaceClass:number;
  interfaceSubclass:number;
  interfaceProtocol:number;
  endpoints:ReadonlyArray<UsbEndpointLike>;
}>;
export type UsbInterfaceLike = Readonly<{interfaceNumber:number;alternates:ReadonlyArray<UsbAlternateLike>}>;
export type UsbConfigurationLike = Readonly<{configurationValue:number;interfaces:ReadonlyArray<UsbInterfaceLike>}>;
export interface StockUsbDevice {
  readonly vendorId:number;
  readonly productId:number;
  readonly configurations:ReadonlyArray<UsbConfigurationLike>;
}
export interface BrowserUsb {
  requestDevice(options:{filters:ReadonlyArray<{vendorId:number;productId:number}>}):Promise<StockUsbDevice>;
  getDevices?():Promise<ReadonlyArray<StockUsbDevice>>;
}

export interface StockSerialPort {
  readonly readable:ReadableStream<Uint8Array> | null;
  readonly writable:WritableStream<Uint8Array> | null;
  getInfo():Readonly<{usbVendorId?:number;usbProductId?:number}>;
  open(options:{baudRate:number;dataBits:8;stopBits:1;parity:'none';bufferSize:number;flowControl:'none'}):Promise<void>;
  close():Promise<void>;
  setSignals?(signals:{dataTerminalReady:boolean;requestToSend:boolean}):Promise<void>;
}
export interface BrowserSerial {
  requestPort(options:{filters:ReadonlyArray<{usbVendorId:number;usbProductId:number}>}):Promise<StockSerialPort>;
  getPorts?():Promise<ReadonlyArray<StockSerialPort>>;
}

export type StockSpeedAttestation = Readonly<{
  vendorId:number;
  productId:number;
  configurationValue:1;
  bulkInPacketSize:512;
  bulkOutPacketSize:512;
  usbOpened:false;
  usbClaimed:false;
}>;

export type OpenSynthP34Attestation = Readonly<{
  format:'opensp-p34-passive-session-v1';
  vendorId:0x0582;
  productId:0x02e7;
  session:number;
  sequence:number;
  nominalHz:number;
  features:number;
  profileId:0x05520001;
  pixelFormat:1|2;
  reconnect:number;
  buildMarker:0x4f534731;
  recordHex:string;
  serialWrites:0;
}>;

export type Spg1SessionExpectation = Readonly<{
  profileId:number;
  buildMarker:number;
  maximum:number;
  width:number;
  height:number;
  capacity:number;
  allowedFeaturesMask:number;
  allowedPixelFormats:ReadonlyArray<1|2>;
}>;

export type Spg1SessionAttestation = Readonly<{
  format:'opensp-spg1-passive-session-v1';
  vendorId:0x0582;
  productId:0x02e7;
  session:number;
  sequence:number;
  nominalHz:number;
  features:number;
  profileId:number;
  pixelFormat:1|2;
  reconnect:number;
  buildMarker:number;
  recordHex:string;
  serialWrites:0;
}>;

export const OPEN_SYNTH_P34_SESSION:Spg1SessionExpectation=Object.freeze({
  profileId:0x05520001,buildMarker:0x4f534731,maximum:1124,width:128,height:64,capacity:64,
  allowedFeaturesMask:23,allowedPixelFormats:Object.freeze([1,2] as const),
});

export type StockArtifacts = Readonly<{r51:Uint8Array<ArrayBuffer>;carrier:Uint8Array<ArrayBuffer>}>;
export type StockR51VArtifacts = Readonly<{writer:Uint8Array<ArrayBuffer>;carrier:Uint8Array<ArrayBuffer>}>;
export type StockDeltaArtifacts = Readonly<{delta:Uint8Array<ArrayBuffer>;carrier:Uint8Array<ArrayBuffer>}>;
export type StockBootstrapProgress = Readonly<{
  phase:'stage'|'stage-readback'|'carrier';
  completed:number;
  total:number;
}>;
export type StockBootstrapReceipt = Readonly<{
  format:'opensp-stock-p34x-bootstrap-v1';
  r51Sha256:string;
  carrierSha256:string;
  stagePath:string;
  stageReadbackVerified:true;
  carrierPackets:number;
  carrierBytes:number;
  carrierComplete:true;
  triggerWrites:readonly [16,496];
  fullSpeedPacketSafe:true;
  retryAllowed:false;
  remainingCheck:'fresh OpenSynth P34 passive attestation';
}>;
export type StockR51VReceipt = Readonly<{
  format:'opensp-stock-r51v-bootstrap-v1';
  writerSha256:string;
  carrierSha256:string;
  stagePath:string;
  stageReadbackVerified:true;
  alignmentSafeFrames:3;
  carrierPackets:51;
  carrierBytes:26112;
  carrierComplete:true;
  fullPacketWrites:true;
  retryAllowed:false;
  remainingCheck:'fresh R51 WebHID attestation';
}>;
export type StockPreflightReceipt = Readonly<{
  format:'opensp-stock-p34w-preflight-v1';
  imageSha256:string;
  carrierSha256:string;
  stagePath:string;
  stageReadbackVerified:true;
  carrierPackets:5;
  carrierBytes:2560;
  carrierComplete:true;
  flashWritePath:false;
  retryAllowed:false;
  remainingCheck:'fresh stock serial identity after diagnostic reset';
}>;
export type StockQualifiedInstallReceipt = Readonly<{
  format:'opensp-stock-p34-qualified-install-v1';
  preflight:StockPreflightReceipt;
  install:StockBootstrapReceipt;
  attestation:OpenSynthP34Attestation;
  oneAction:true;
  permissionPickers:1;
}>;
export type StockDeltaInstallReceipt = Readonly<{
  format:'opensp-stock-p34z-delta-install-v1';
  deltaSha256:string;
  carrierSha256:string;
  stagePath:string;
  stageReadbackVerified:true;
  carrierPackets:13;
  carrierBytes:6656;
  carrierComplete:true;
  sourceSha256:string;
  targetSha256:string;
  retryAllowed:false;
  remainingCheck:'fresh OpenSynth P34 passive attestation';
}>;

export class StockBootstrapError extends Error {
  readonly phase:string;
  readonly code:string;
  readonly mutationStarted:boolean;
  readonly carrierStarted:boolean;
  constructor(phase:string,code:string,message:string,mutationStarted=false,carrierStarted=false){
    super(message);this.name='StockBootstrapError';this.phase=phase;this.code=code;
    this.mutationStarted=mutationStarted;this.carrierStarted=carrierStarted;
  }
}

function fail(phase:string,code:string,message:string,mutationStarted=false,carrierStarted=false):never{
  throw new StockBootstrapError(phase,code,message,mutationStarted,carrierStarted);
}
function need(value:unknown,phase:string,code:string,message:string,mutationStarted=false,carrierStarted=false):asserts value{
  if(!value)fail(phase,code,message,mutationStarted,carrierStarted);
}
function same(a:Uint8Array,b:Uint8Array):boolean{
  if(a.length!==b.length)return false;
  let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
}
function concat(...parts:ReadonlyArray<Uint8Array>):Uint8Array<ArrayBuffer>{
  const length=parts.reduce((sum,item)=>sum+item.length,0),result=new Uint8Array(length);
  let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
function hex(value:string):Uint8Array<ArrayBuffer>{
  need(value.length%2===0,'offline','hex','Internal protocol hex has an odd length.');
  const result=new Uint8Array(value.length/2);for(let i=0;i<result.length;i++)result[i]=Number.parseInt(value.slice(i*2,i*2+2),16);return result;
}
function u32(value:number):Uint8Array<ArrayBuffer>{
  const result=new Uint8Array(4);new DataView(result.buffer).setUint32(0,value,true);return result;
}
function sleep(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms));}
export async function sha256(bytes:Uint8Array):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',bytes.slice().buffer);return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

function exactHighSpeedDataInterface(device:StockUsbDevice):UsbAlternateLike | undefined{
  const configuration=device.configurations.find(item=>item.configurationValue===STOCK_USB.configurationValue);
  if(!configuration)return undefined;
  const candidates=configuration.interfaces.flatMap(item=>item.alternates).filter(alternate=>
    alternate.alternateSetting===0&&alternate.interfaceClass===0x0a&&alternate.interfaceSubclass===0&&alternate.interfaceProtocol===0);
  if(candidates.length!==1)return undefined;
  const alternate=candidates[0],bulk=alternate.endpoints.filter(endpoint=>endpoint.type==='bulk');
  if(bulk.length!==2)return undefined;
  const input=bulk.find(endpoint=>endpoint.direction==='in'),output=bulk.find(endpoint=>endpoint.direction==='out');
  return input?.packetSize===512&&output?.packetSize===512?alternate:undefined;
}

/** Read only the selected stock device's descriptors; never open or claim it. */
export function attestStockHighSpeed(device:StockUsbDevice):StockSpeedAttestation{
  need(device?.vendorId===STOCK_USB.vendorId&&device?.productId===STOCK_USB.productId,'speed','device-identity',
    'Select the Roland SP-404MKII stock USB serial device (0582:02E7). Nothing was written.');
  const data=exactHighSpeedDataInterface(device);
  need(data,'speed','not-high-speed',
    'The stock SP did not expose 512-byte bulk endpoints. The protected stock bootstrap is refused at full speed. Nothing was written.');
  return Object.freeze({vendorId:device.vendorId,productId:device.productId,configurationValue:1,
    bulkInPacketSize:512,bulkOutPacketSize:512,usbOpened:false,usbClaimed:false});
}

export async function requestStockHighSpeed(usb:BrowserUsb|undefined):Promise<Readonly<{device:StockUsbDevice;attestation:StockSpeedAttestation}>>{
  if(!usb)fail('speed','unsupported','The stock USB bootstrap needs a desktop Chromium browser with WebUSB.');
  let device:StockUsbDevice;
  try{device=await usb.requestDevice({filters:[{vendorId:STOCK_USB.vendorId,productId:STOCK_USB.productId}]});}
  catch(error){
    const name=error instanceof DOMException?error.name:(error as {name?:string})?.name;
    if(name==='NotFoundError')fail('speed','cancelled','No stock SP was selected. Nothing was written.');
    fail('speed','picker',`The stock USB descriptor check failed: ${error instanceof Error?error.message:String(error)}`);
  }
  return Object.freeze({device:device!,attestation:attestStockHighSpeed(device!)});
}

/** Reuse one already-authorized stock device without opening it or showing a picker. */
export async function getAuthorizedStockHighSpeed(usb:BrowserUsb|undefined):Promise<Readonly<{device:StockUsbDevice;attestation:StockSpeedAttestation}>|undefined>{
  if(!usb?.getDevices)return undefined;
  const devices=(await usb.getDevices()).filter(device=>device.vendorId===STOCK_USB.vendorId&&device.productId===STOCK_USB.productId);
  need(devices.length<=1,'speed','duplicate','More than one authorized stock SP-404MKII is connected. Nothing was written.');
  if(!devices.length)return undefined;
  return Object.freeze({device:devices[0],attestation:attestStockHighSpeed(devices[0])});
}

/** Wait for the verified APP1 reset to return through the normal Roland USB identity. */
export async function waitForNormalUsb(
  usb:BrowserUsb|undefined,
  options:Readonly<{timeoutMs?:number;pollMs?:number;sleep?:(milliseconds:number)=>Promise<void>}> = {},
):Promise<StockSpeedAttestation>{
  need(usb?.getDevices,'normal-return','unsupported','The browser cannot observe the normal Roland USB return automatically.');
  const timeoutMs=options.timeoutMs??45_000,pollMs=options.pollMs??250,pause=options.sleep??sleep;
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=120_000&&Number.isSafeInteger(pollMs)&&pollMs>0&&pollMs<=5_000,
    'normal-return','bounds','The normal-return wait must stay within its fixed bounds.');
  const deadline=performance.now()+timeoutMs;
  while(performance.now()<deadline){
    const devices=(await usb!.getDevices!()).filter(device=>device.vendorId===STOCK_USB.vendorId&&device.productId===STOCK_USB.productId);
    need(devices.length<=1,'normal-return','duplicate','More than one authorized Roland normal USB device is connected.');
    if(devices.length===1)return attestStockHighSpeed(devices[0]);
    await pause(pollMs);
  }
  fail('normal-return','timeout','The verified reset was sent, but the normal Roland USB device did not return before the bounded timeout. Do not retry the flash; power-cycle once if needed.');
}

function crc32(bytes:Uint8Array):number{
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}

function validSpg1Expectation(expected:Spg1SessionExpectation):boolean{
  return !!expected&&[expected.profileId,expected.buildMarker,expected.maximum,expected.width,expected.height,
    expected.capacity,expected.allowedFeaturesMask].every(value=>Number.isSafeInteger(value)&&value>=0&&value<=0xffffffff)&&
    expected.width<=0xffff&&expected.height<=0xffff&&expected.capacity<=0xffff&&
    Array.isArray(expected.allowedPixelFormats)&&expected.allowedPixelFormats.length>0&&
    expected.allowedPixelFormats.every(value=>value===1||value===2);
}

/** Parse one complete passive SPG1 SESSION record against caller-supplied firmware identity pins. */
export function parseSpg1Session(raw:Uint8Array,expected:Spg1SessionExpectation):Spg1SessionAttestation|undefined{
  if(!validSpg1Expectation(expected))return undefined;
  if(raw.length!==68||raw[0]!==0x53||raw[1]!==0x50||raw[2]!==0x47||raw[3]!==0x31)return undefined;
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  const version=raw[4],kind=raw[5],flags=view.getUint16(6,true),size=view.getUint16(8,true),header=view.getUint16(10,true);
  const session=view.getUint32(12,true),sequence=view.getUint32(16,true),nominalHz=view.getUint32(28,true);
  const features=view.getUint32(32,true),profileId=view.getUint32(36,true),clock=view.getUint32(40,true);
  const maximum=view.getUint32(44,true),width=view.getUint16(48,true),height=view.getUint16(50,true);
  const pixelFormat=view.getUint16(52,true),capacity=view.getUint16(54,true),reconnect=view.getUint32(56,true);
  const buildMarker=view.getUint32(60,true),expectedCrc=view.getUint32(64,true);
  if(version!==1||kind!==1||flags!==0||size!==32||header!==32||session===0||sequence===0||
    (features&~expected.allowedFeaturesMask)!==0||profileId!==expected.profileId||clock!==nominalHz||maximum!==expected.maximum||
    width!==expected.width||height!==expected.height||!expected.allowedPixelFormats.includes(pixelFormat as 1|2)||
    capacity!==expected.capacity||buildMarker!==expected.buildMarker||crc32(raw.subarray(0,64))!==expectedCrc)return undefined;
  return Object.freeze({format:'opensp-spg1-passive-session-v1',vendorId:0x0582,productId:0x02e7,session,sequence,nominalHz,
    features,profileId,pixelFormat:pixelFormat as 1|2,reconnect,buildMarker,
    recordHex:Array.from(raw,value=>value.toString(16).padStart(2,'0')).join(''),serialWrites:0});
}

/** Parse one complete passive SPG1 SESSION record from exact OpenSynth P34. */
export function parseOpenSynthP34Session(raw:Uint8Array):OpenSynthP34Attestation|undefined{
  const parsed=parseSpg1Session(raw,OPEN_SYNTH_P34_SESSION);if(!parsed)return undefined;
  return Object.freeze({...parsed,format:'opensp-p34-passive-session-v1',profileId:0x05520001 as const,buildMarker:0x4f534731 as const});
}

/** Reopen the already authorized normal serial port and passively observe a pinned SPG1 firmware identity. */
export async function waitForSpg1Session(
  serial:BrowserSerial|undefined,
  expected:Spg1SessionExpectation,
  options:Readonly<{timeoutMs?:number;pollMs?:number;sleep?:(milliseconds:number)=>Promise<void>}> = {},
):Promise<Spg1SessionAttestation>{
  need(validSpg1Expectation(expected),'spg1-return','identity-pins','The passive return identity pins are invalid.');
  need(serial?.getPorts,'spg1-return','unsupported','The browser cannot observe the rebooted firmware serial stream automatically.');
  const timeoutMs=options.timeoutMs??20_000,pollMs=options.pollMs??50,pause=options.sleep??sleep;
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=180_000&&Number.isSafeInteger(pollMs)&&pollMs>0&&pollMs<=1_000,
    'spg1-return','bounds','The passive return wait must stay within its fixed bounds.');
  const deadline=performance.now()+timeoutMs;
  let port:StockSerialPort|undefined;
  while(performance.now()<deadline){
    const ports=(await serial!.getPorts!()).filter(item=>{
      const info=item.getInfo();return info.usbVendorId===STOCK_USB.vendorId&&info.usbProductId===STOCK_USB.productId;
    });
    need(ports.length<=1,'spg1-return','duplicate','More than one authorized Roland normal serial port is available.');
    if(ports.length===1){port=ports[0];break;}
    await pause(pollMs);
  }
  need(port,'spg1-return','serial-timeout','Normal USB returned, but its authorized serial port did not appear. Do not retry the flash.');
  try{await port.open({baudRate:115200,dataBits:8,stopBits:1,parity:'none',bufferSize:65_536,flowControl:'none'});}
  catch(error){fail('spg1-return','serial-open',`The rebooted firmware serial port could not be opened: ${error instanceof Error?error.message:String(error)} Do not retry the flash.`);}
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,pump:Promise<void>|undefined;
  let buffer=new Uint8Array(0),attestation:Spg1SessionAttestation|undefined,pumpError:unknown,ended=false;
  try{
    await port.setSignals?.({dataTerminalReady:false,requestToSend:false});
    await pause(100);
    await port.setSignals?.({dataTerminalReady:true,requestToSend:false});
    need(port.readable,'spg1-return','serial-stream','The rebooted firmware serial stream is unavailable. Do not retry the flash.');
    reader=port.readable.getReader();
    pump=(async()=>{try{
      while(true){
        const next=await reader!.read();if(next.done){ended=true;return;}if(!next.value?.length)continue;
        buffer=concat(buffer,next.value);if(buffer.length>8192)buffer=buffer.slice(-4096);
        for(let offset=0;offset+68<=buffer.length;offset++){
          const parsed=parseSpg1Session(buffer.subarray(offset,offset+68),expected);
          if(parsed){attestation=parsed;return;}
        }
      }
    }catch(error){pumpError=error;}})();
    while(performance.now()<deadline&&!attestation&&!pumpError&&!ended)await pause(pollMs);
    if(pumpError)fail('spg1-return','serial-read',`The passive firmware identity read failed: ${pumpError instanceof Error?pumpError.message:String(pumpError)} Do not retry the flash.`);
    need(attestation,'spg1-return','identity-timeout','Normal USB returned, but the pinned passive firmware identity was not observed. Do not retry the flash; check the SP screen.');
    return attestation;
  }finally{
    try{await reader?.cancel();}catch{/* Detach can close the reader first. */}
    try{await pump;}catch{/* pumpError was handled above. */}
    try{reader?.releaseLock();}catch{/* A failed open may leave no lock. */}
    try{await port.close();}catch{/* Identity evidence remains read-only if detach wins. */}
  }
}

/** Passively attest the exact OpenSynth P34 identity after a verified reset. */
export async function waitForOpenSynthP34(
  serial:BrowserSerial|undefined,
  options:Readonly<{timeoutMs?:number;pollMs?:number;sleep?:(milliseconds:number)=>Promise<void>}> = {},
):Promise<OpenSynthP34Attestation>{
  const parsed=await waitForSpg1Session(serial,OPEN_SYNTH_P34_SESSION,options);
  return Object.freeze({...parsed,format:'opensp-p34-passive-session-v1',profileId:0x05520001 as const,buildMarker:0x4f534731 as const});
}

export function assertStockPort(port:StockSerialPort):void{
  const info=port?.getInfo();need(info?.usbVendorId===STOCK_USB.vendorId&&info?.usbProductId===STOCK_USB.productId,
    'serial','device-identity','Select the Roland SP-404MKII stock serial port (0582:02E7). Nothing was written.');
}

export async function requestStockPort(serial:BrowserSerial|undefined):Promise<StockSerialPort>{
  if(!serial)fail('serial','unsupported','The stock USB bootstrap needs a desktop Chromium browser with Web Serial.');
  let port:StockSerialPort;
  try{port=await serial.requestPort({filters:[{usbVendorId:STOCK_USB.vendorId,usbProductId:STOCK_USB.productId}]});}
  catch(error){
    const name=error instanceof DOMException?error.name:(error as {name?:string})?.name;
    if(name==='NotFoundError')fail('serial','cancelled','No stock SP serial port was selected. Nothing was written.');
    fail('serial','picker',`The stock serial picker failed: ${error instanceof Error?error.message:String(error)}`);
  }
  assertStockPort(port!);return port!;
}

/** Reuse one already-authorized stock serial port without showing a picker. */
export async function getAuthorizedStockPort(serial:BrowserSerial|undefined):Promise<StockSerialPort|undefined>{
  if(!serial?.getPorts)return undefined;
  const ports=(await serial.getPorts()).filter(port=>{
    const info=port.getInfo();return info.usbVendorId===STOCK_USB.vendorId&&info.usbProductId===STOCK_USB.productId;
  });
  need(ports.length<=1,'serial','duplicate','More than one authorized stock SP-404MKII serial port is connected. Nothing was written.');
  if(!ports.length)return undefined;
  assertStockPort(ports[0]);return ports[0];
}

export async function fetchPinnedStockArtifacts(fetcher:typeof fetch,r51Url:string,carrierUrl:string):Promise<StockArtifacts>{
  async function get(url:string,bytes:number,expected:string,label:string):Promise<Uint8Array<ArrayBuffer>>{
    const response=await fetcher(url,{cache:'no-store'});need(response.ok,'artifacts','download',`${label} could not be loaded. Nothing was written.`);
    const body=new Uint8Array(await response.arrayBuffer());need(body.length===bytes,'artifacts','length',`${label} has the wrong length. Nothing was written.`);
    need(await sha256(body)===expected,'artifacts','sha256',`${label} failed its fixed checksum. Nothing was written.`);return body;
  }
  const [r51,carrier]=await Promise.all([
    get(r51Url,STOCK_R51.r51Bytes,STOCK_R51.r51Sha256,'The OpenSynth P34 image'),
    get(carrierUrl,STOCK_R51.carrierBytes,STOCK_R51.carrierSha256,'The stock carrier'),
  ]);
  return Object.freeze({r51,carrier});
}

/** Fetch the exact R51 writer and Revision-V carrier used by the stock handoff. */
export async function fetchPinnedStockR51VArtifacts(
  fetcher:typeof fetch,writerUrl:string,carrierUrl:string,
):Promise<StockR51VArtifacts>{
  async function get(url:string,bytes:number,expected:string,label:string):Promise<Uint8Array<ArrayBuffer>>{
    const response=await fetcher(url,{cache:'no-store',credentials:'same-origin'});
    need(response.ok,'artifacts','fetch',`${label} could not be loaded (${response.status}). Nothing was written.`);
    const body=new Uint8Array(await response.arrayBuffer());
    need(body.length===bytes&&await sha256(body)===expected,'artifacts','identity',`${label} changed. Nothing was written.`);
    return body;
  }
  const [writer,carrier]=await Promise.all([
    get(writerUrl,STOCK_R51_V.writerBytes,STOCK_R51_V.writerSha256,'The R51 writer'),
    get(carrierUrl,STOCK_R51_V.carrierBytes,STOCK_R51_V.carrierSha256,'The Revision-V carrier'),
  ]);
  return Object.freeze({writer,carrier});
}

/** Fetch the exact full P34 APP1 image accepted by the guarded R51 writer. */
export async function fetchPinnedOpenSynthP34(fetcher:typeof fetch,imageUrl:string):Promise<Uint8Array<ArrayBuffer>>{
  const response=await fetcher(imageUrl,{cache:'no-store',credentials:'same-origin'});
  need(response.ok,'artifacts','fetch',`The OpenSynth P34 image could not be loaded (${response.status}). Nothing was written.`);
  const image=new Uint8Array(await response.arrayBuffer());
  need(image.length===OPEN_SYNTH_P34_IMAGE.bytes&&await sha256(image)===OPEN_SYNTH_P34_IMAGE.sha256,
    'artifacts','identity','The pinned OpenSynth P34 image changed. Nothing was written.');
  return image;
}

/** Pin the locally built OpenSynth image and fetch only the distributable carrier. */
export async function fetchPinnedStockCarrier(fetcher:typeof fetch,image:Uint8Array,carrierUrl:string):Promise<StockArtifacts>{
  need(image.length===STOCK_R51.r51Bytes&&await sha256(image)===STOCK_R51.r51Sha256,
    'artifacts','image-identity','The locally built OpenSynth image changed. Nothing was written.');
  const response=await fetcher(carrierUrl,{cache:'no-store',credentials:'same-origin'});
  need(response.ok,'artifacts','fetch',`The stock carrier could not be loaded (${response.status}).`);
  const carrier=new Uint8Array(await response.arrayBuffer());
  need(carrier.length===STOCK_R51.carrierBytes&&await sha256(carrier)===STOCK_R51.carrierSha256,
    'artifacts','identity','The pinned stock carrier changed. Nothing was written.');
  const pinnedImage=new Uint8Array(image.length);pinnedImage.set(image);
  return Object.freeze({r51:pinnedImage,carrier});
}

export async function fetchPinnedStockDelta(
  fetcher:typeof fetch,deltaUrl:string,carrierUrl:string,
):Promise<StockDeltaArtifacts>{
  async function get(url:string,bytes:number,expected:string,label:string):Promise<Uint8Array<ArrayBuffer>>{
    const response=await fetcher(url,{cache:'no-store',credentials:'same-origin'});
    need(response.ok,'artifacts','fetch',`${label} could not be loaded (${response.status}). Nothing was written.`);
    const body=new Uint8Array(await response.arrayBuffer());
    need(body.length===bytes&&await sha256(body)===expected,'artifacts','identity',`${label} changed. Nothing was written.`);
    return body;
  }
  const [delta,carrier]=await Promise.all([
    get(deltaUrl,STOCK_P34_DELTA.deltaBytes,STOCK_P34_DELTA.deltaSha256,'The OpenSynth delta'),
    get(carrierUrl,STOCK_P34_DELTA.carrierBytes,STOCK_P34_DELTA.carrierSha256,'The stock delta carrier'),
  ]);
  return Object.freeze({delta,carrier});
}

function parseClaim(raw:string|null):StockClaim|undefined{
  if(!raw)return undefined;
  let value:unknown;try{value=JSON.parse(raw);}catch{fail('claim','invalid','The saved one-shot stock claim is damaged. Do not retry this SP from the browser.');}
  const claim=value as Partial<StockClaim>;
  need(claim.format==='opensp-stock-p34x-claim-v1'&&['claimed','stage-verified','carrier-started','carrier-complete','r51-attested'].includes(String(claim.state))&&
    claim.stagePath===STOCK_R51.stagePath&&claim.r51Sha256===STOCK_R51.r51Sha256&&claim.carrierSha256===STOCK_R51.carrierSha256&&claim.retryAllowed===false,
    'claim','invalid','The saved one-shot stock claim does not match this installer. Do not retry this SP from the browser.');
  return Object.freeze(claim as StockClaim);
}
function saveClaim(store:StockClaimStore,state:StockClaimState,prior?:StockClaim):StockClaim{
  const now=new Date().toISOString(),claim:StockClaim=Object.freeze({format:'opensp-stock-p34x-claim-v1',state,
    createdAt:prior?.createdAt??now,updatedAt:now,stagePath:STOCK_R51.stagePath,r51Sha256:STOCK_R51.r51Sha256,
    carrierSha256:STOCK_R51.carrierSha256,retryAllowed:false});
  store.save(JSON.stringify(claim));return claim;
}

type Waiter={resolve:(value:Uint8Array|undefined)=>void;reject:(error:unknown)=>void;timer:ReturnType<typeof setTimeout>};
class BrowserStockLink{
  private readonly reader:ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer:WritableStreamDefaultWriter<Uint8Array>;
  private readonly queue:Uint8Array[]=[];
  private readonly waiters:Waiter[]=[];
  private pumpError:unknown;
  private ended=false;
  private readonly pumpPromise:Promise<void>;
  private constructor(private readonly port:StockSerialPort,reader:ReadableStreamDefaultReader<Uint8Array>,writer:WritableStreamDefaultWriter<Uint8Array>){
    this.reader=reader;this.writer=writer;this.pumpPromise=this.pump();
  }
  static async open(port:StockSerialPort):Promise<BrowserStockLink>{
    assertStockPort(port);
    await port.open({baudRate:115200,dataBits:8,stopBits:1,parity:'none',bufferSize:65_536,flowControl:'none'});
    await port.setSignals?.({dataTerminalReady:true,requestToSend:true});
    need(port.readable&&port.writable,'serial','streams','The stock serial port did not expose readable and writable streams.');
    return new BrowserStockLink(port,port.readable.getReader(),port.writable.getWriter());
  }
  private async pump():Promise<void>{
    try{
      while(true){const {value,done}=await this.reader.read();if(done)break;if(value?.length)this.push(value.slice());}
    }catch(error){this.pumpError=error;for(const waiter of this.waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(error);}}
    finally{this.ended=true;for(const waiter of this.waiters.splice(0)){clearTimeout(waiter.timer);waiter.resolve(undefined);}}
  }
  private push(value:Uint8Array):void{
    const waiter=this.waiters.shift();if(waiter){clearTimeout(waiter.timer);waiter.resolve(value);}else this.queue.push(value);
  }
  async write(value:Uint8Array):Promise<void>{
    if(this.pumpError)throw this.pumpError;await this.writer.write(value);
  }
  async nextChunk(timeoutMs:number):Promise<Uint8Array|undefined>{
    if(this.queue.length)return this.queue.shift();if(this.pumpError)throw this.pumpError;if(this.ended)return undefined;
    return new Promise((resolve,reject)=>{
      const waiter={} as Waiter;waiter.resolve=resolve;waiter.reject=reject;
      waiter.timer=setTimeout(()=>{const index=this.waiters.indexOf(waiter);if(index>=0)this.waiters.splice(index,1);resolve(undefined);},timeoutMs);
      this.waiters.push(waiter);
    });
  }
  async close():Promise<void>{
    try{await this.reader.cancel();}catch{/* A detach can close the reader first. */}
    try{await this.pumpPromise;}catch{/* pumpError is surfaced by protocol reads. */}
    this.reader.releaseLock();this.writer.releaseLock();await this.port.close();
  }
}

const MAGIC_REQ=hex('1360e006'),MAGIC_RSP=hex('13e06006');
const SYSEX_REQ=hex('f0417a03'),SYSEX_DATA=hex('f0417a02'),SYSEX_ACK=hex('f0417a7a');
const TAG_READ=hex('9e010000'),TAG_WRITE=hex('66020000'),TAG_NEUTRAL=new Uint8Array(4);
const WAKEUP=hex('1260e005fe6600007045c503');
const INIT=hex('1360e005000000009026c23909000000010000ffff00000000');
const PREP_READ_ONLY=hex('1260e005fb00000000000003'),PREP_IMPORT=hex('1260e005fb11000000000003');
const EXEC=hex('1260e005fc00000000000003'),TEARDOWN=hex('1260e0059d020000206e5001');

function midi7Encode3(value:number):Uint8Array<ArrayBuffer>{
  need(Number.isInteger(value)&&value>=0&&value<=0x1fffff,'protocol','integer','File-service length is outside its three-byte bound.');
  return Uint8Array.of((value>>>14)&0x7f,(value>>>7)&0x7f,value&0x7f);
}
function midi7Encode5(value:number):Uint8Array<ArrayBuffer>{
  need(Number.isInteger(value)&&value>=-0x80000000&&value<=0x7fffffff,'protocol','integer','File-service value is outside signed 32 bits.');
  return Uint8Array.of((value>>28)&0x7f,(value>>21)&0x7f,(value>>14)&0x7f,(value>>7)&0x7f,value&0x7f);
}
function midi7Decode5(value:Uint8Array):number{
  need(value.length===5&&value.every(item=>(item&0x80)===0)&&((value[0]<=7)||(value[0]>=0x78)),
    'protocol','midi7','Stock returned a noncanonical signed value.');
  const raw=((((value[0]<<28)>>>0)|(value[1]<<21)|(value[2]<<14)|(value[3]<<7)|value[4])>>>0);
  return raw>0x7fffffff?raw-0x1_0000_0000:raw;
}
function outer(sysex:Uint8Array,txid:number,tag:Uint8Array):Uint8Array<ArrayBuffer>{return concat(MAGIC_REQ,tag,u32(txid),u32(sysex.length),sysex);}
function pathBytes(path:string):Uint8Array<ArrayBuffer>{
  const raw=te.encode(path);need(raw.length>0&&raw.length<=126&&!path.includes('..')&&
    (path===STOCK_R51.stagePath||path===STOCK_R51_V.stagePath||path===STOCK_P34_DELTA.stagePath),
    'protocol','path','The stock staging path is outside the reviewed destination.');return raw;
}
function openFile(path:string,txid:number,write=false):Uint8Array<ArrayBuffer>{
  const raw=concat(pathBytes(path),Uint8Array.of(0)),mode=write?hex('0c02'):hex('0000');
  return outer(concat(SYSEX_REQ,Uint8Array.of(0),new Uint8Array(3),mode,new Uint8Array(4),Uint8Array.of(raw.length),raw,Uint8Array.of(0xf7)),txid,write?TAG_WRITE:TAG_READ);
}
function closeFile(handle:number,txid:number):Uint8Array<ArrayBuffer>{
  return outer(concat(SYSEX_REQ,Uint8Array.of(3),midi7Encode5(handle),new Uint8Array(6),Uint8Array.of(0xf7)),txid,TAG_READ);
}
function readFile(handle:number,txid:number,count:number):Uint8Array<ArrayBuffer>{
  need(count>=1&&count<=20*1024,'protocol','read-count','Stock read count exceeds its reviewed buffer.');
  return outer(concat(SYSEX_REQ,Uint8Array.of(4),midi7Encode5(handle),midi7Encode5(count),Uint8Array.of(0,0xf7)),txid,TAG_NEUTRAL);
}
function writeFile(handle:number,txid:number,data:Uint8Array):Uint8Array<ArrayBuffer>{
  need(data.length>0&&data.length<=20*1024,'protocol','write-count','Stock write exceeds its reviewed buffer.');
  return outer(concat(SYSEX_REQ,Uint8Array.of(6),midi7Encode5(handle),Uint8Array.of(0x40,0),midi7Encode3(data.length),data,Uint8Array.of(0xf7)),txid,TAG_WRITE);
}
function responseSysex(frame:Uint8Array):Uint8Array{
  need(frame.length>=16&&same(frame.subarray(0,4),MAGIC_RSP),'protocol','response','Stock returned an invalid response wrapper.');
  const length=new DataView(frame.buffer,frame.byteOffset,frame.byteLength).getUint32(12,true);
  need(frame.length===16+length,'protocol','response-length','Stock response length differs from its wrapper.');
  const sysex=frame.subarray(16);need(sysex.length>=5&&sysex.at(-1)===0xf7,'protocol','response-sysex','Stock returned invalid response data.');return sysex;
}
function parseAck(frame:Uint8Array):Readonly<{result:number;errno:number}>{
  const sysex=responseSysex(frame);need(sysex.length===15&&same(sysex.subarray(0,4),SYSEX_ACK),'protocol','ack','Stock returned a non-ACK response.');
  return Object.freeze({result:midi7Decode5(sysex.subarray(4,9)),errno:midi7Decode5(sysex.subarray(9,14))});
}
function parseData(frame:Uint8Array):Readonly<{handle:number;final:boolean;data:Uint8Array}>{
  const sysex=responseSysex(frame);need(sysex.length>=15&&same(sysex.subarray(0,4),SYSEX_DATA),'protocol','data','Stock returned a non-data response.');
  need((sysex[9]&0x80)===0&&[0,0x40].includes(sysex[9]&0x70),'protocol','data-flags','Stock returned unsupported data flags.');
  const encoded=Uint8Array.of(sysex[9]&0x0f,...sysex.subarray(10,14)),declared=midi7Decode5(encoded),data=sysex.subarray(14,-1);
  need(declared===data.length,'protocol','data-length','Stock readback length differs from its payload.');
  return Object.freeze({handle:midi7Decode5(sysex.subarray(4,9)),final:(sysex[9]&0x40)!==0,data:data.slice()});
}

class FileSession{
  private buffer=new Uint8Array(0);
  private readonly pending:Uint8Array[]=[];
  constructor(private readonly link:BrowserStockLink){}
  async send(packet:Uint8Array):Promise<void>{await this.link.write(packet);}
  private extract():void{
    while(this.buffer.length>=16){
      need(same(this.buffer.subarray(0,4),MAGIC_RSP),'protocol','unexpected-bytes','Unexpected bytes preceded a stock response.');
      const length=new DataView(this.buffer.buffer,this.buffer.byteOffset,this.buffer.byteLength).getUint32(12,true);
      need(length<=20*1024+256,'protocol','response-bound','Stock response exceeded the file-service bound.');
      if(this.buffer.length<16+length)return;
      this.pending.push(this.buffer.slice(0,16+length));this.buffer=this.buffer.slice(16+length);
    }
  }
  async frame(timeoutMs:number):Promise<Uint8Array>{
    const deadline=performance.now()+timeoutMs;
    while(performance.now()<deadline){
      this.extract();if(this.pending.length)return this.pending.shift()!;
      const chunk=await this.link.nextChunk(Math.min(50,Math.max(1,deadline-performance.now())));if(chunk)this.buffer=concat(this.buffer,chunk);
    }
    fail('protocol','timeout','Stock did not return a complete response before the bounded timeout.');
  }
  async ack(timeoutMs=5000):Promise<Readonly<{result:number;errno:number}>>{const result=parseAck(await this.frame(timeoutMs));await this.quiet();return result;}
  async quiet(durationMs=50):Promise<void>{
    this.extract();need(this.pending.length===0&&this.buffer.length===0,'protocol','queued-response','Stock returned an unexpected queued response.');
    need(!(await this.link.nextChunk(durationMs)),'protocol','late-response','Stock returned an unexpected delayed response.');
  }
  async startupControl():Promise<void>{
    let raw=new Uint8Array(0);const deadline=performance.now()+250;
    while(performance.now()<deadline){const chunk=await this.link.nextChunk(raw.length?50:Math.max(1,deadline-performance.now()));if(!chunk){if(raw.length)break;continue;}raw=concat(raw,chunk);need(raw.length<=512,'protocol','startup-bound','Stock startup response exceeded 512 bytes.');}
    const expected=[hex('7e00000000000000ffffffff00020000000b33'),hex('010000ffff00000000'),hex('010000ffff00000000')],actual:Uint8Array[]=[];
    let offset=0;while(offset<raw.length){
      need(raw.length-offset>=16&&raw[offset]===0x13&&raw[offset+1]===0xe0&&raw[offset+3]===0x05,
        'protocol','startup-frame','Stock startup control framing differs.');
      const length=new DataView(raw.buffer,raw.byteOffset+offset,raw.byteLength-offset).getUint32(12,true);
      need(length<=64&&offset+16+length<=raw.length,'protocol','startup-length','Stock startup control response is truncated or oversized.');
      actual.push(raw.slice(offset+16,offset+16+length));offset+=16+length;
    }
    need(actual.length===expected.length&&actual.every((item,index)=>same(item,expected[index])),
      'protocol','startup-contract','Stock startup control response differs from the reviewed contract.');
  }
  async setup():Promise<void>{
    await this.send(WAKEUP);await sleep(50);await this.send(INIT);await sleep(50);await this.startupControl();
    await this.send(PREP_READ_ONLY);await sleep(20);await this.quiet();
  }
  async finish():Promise<void>{await this.send(EXEC);await sleep(20);await this.send(TEARDOWN);}
}

async function withFileSession<T>(port:StockSerialPort,body:(session:FileSession)=>Promise<T>):Promise<T>{
  const link=await BrowserStockLink.open(port);try{return await body(new FileSession(link));}finally{await link.close();}
}

async function stageFreshR51(port:StockSerialPort,image:Uint8Array,claim:()=>void,onProgress?:(event:StockBootstrapProgress)=>void,path:string=STOCK_R51.stagePath):Promise<'created'|'existing'>{
  return withFileSession(port,async session=>{
    await session.setup();await session.send(openFile(path,0x30000001));const absent=await session.ack();
    if(absent.result>0){
      await session.send(closeFile(absent.result,0x30000004));const closed=await session.ack();
      need(closed.result===0,'stage','existing-close','The existing OpenSynth staging file could not be closed. Nothing was written.');
      await session.finish();return 'existing';
    }
    need(absent.result===-1&&absent.errno===2,'stage','path-probe',
      'The reserved OpenSynth file returned an unexpected result. Nothing was written.');
    claim();await session.send(PREP_IMPORT);await sleep(20);await session.quiet();
    await session.send(openFile(path,0x30000002,true));const opened=await session.ack();
    need(opened.result>0,'stage','create','Stock did not create the reserved OpenSynth file.',true);
    const handle=opened.result;onProgress?.({phase:'stage',completed:0,total:image.length});
    let offset=0,txid=0x30000100;
    while(offset<image.length){
      const part=image.subarray(offset,Math.min(image.length,offset+20*1024));
      await session.send(writeFile(handle,txid++,part));const written=await session.ack(8000);
      need(written.result===part.length,'stage','write-ack','Stock did not commit an exact OpenSynth file chunk. Do not retry.',true);
      offset+=part.length;onProgress?.({phase:'stage',completed:offset,total:image.length});
    }
    await session.send(closeFile(handle,0x30000004));const closed=await session.ack();
    need(closed.result===0,'stage','close','Stock did not close the OpenSynth file cleanly. Do not retry.',true);
    await session.finish();
    return 'created';
  });
}

async function readbackR51(port:StockSerialPort,image:Uint8Array,onProgress?:(event:StockBootstrapProgress)=>void,path:string=STOCK_R51.stagePath):Promise<void>{
  await withFileSession(port,async session=>{
    await session.setup();await session.send(openFile(path,0x31000001));const opened=await session.ack();
    need(opened.result>0,'stage-readback','open','The staged OpenSynth file could not be reopened.');const handle=opened.result;
    onProgress?.({phase:'stage-readback',completed:0,total:image.length});
    let offset=0,txid=0x31000100;
    while(offset<image.length){
      const count=Math.min(20*1024,image.length-offset);
      await session.send(readFile(handle,txid++,count));const reply=parseData(await session.frame(8000));await session.quiet();
      need(reply.handle===handle&&reply.final&&same(reply.data,image.subarray(offset,offset+count)),
        'stage-readback','mismatch','Fresh-session OpenSynth readback differs. Do not run the carrier.',true);
      offset+=count;onProgress?.({phase:'stage-readback',completed:offset,total:image.length});
    }
    await session.send(readFile(handle,0x31000003,1));const eof=parseAck(await session.frame(3000));await session.quiet();
    need(eof.result===0,'stage-readback','trailing-data','The staged OpenSynth file contains trailing data. Do not run the carrier.',true);
    await session.send(closeFile(handle,0x31000004));const closed=await session.ack();
    need(closed.result===0,'stage-readback','close','The OpenSynth readback handle did not close cleanly. Do not run the carrier.',true);
    await session.finish();
  });
}

async function sendCarrier(
  port:StockSerialPort,carrier:Uint8Array,carrierPackets:number=STOCK_R51.carrierPackets,
  onProgress?:(event:StockBootstrapProgress)=>void,
  options:Readonly<{safeFrames?:number;splitTrigger?:boolean}>={},
):Promise<void>{
  assertStockPort(port);await port.open({baudRate:115200,dataBits:8,stopBits:1,parity:'none',bufferSize:65_536,flowControl:'none'});
  let writer:WritableStreamDefaultWriter<Uint8Array>|undefined,complete=false;
  try{
    await port.setSignals?.({dataTerminalReady:true,requestToSend:true});await sleep(50);
    need(port.writable,'carrier','stream','The stock serial writer is unavailable.',true,true);writer=port.writable.getWriter();
    const safeFrames=options.safeFrames??0,splitTrigger=options.splitTrigger??true;
    need(Number.isSafeInteger(safeFrames)&&safeFrames>=0&&safeFrames<=63,'carrier','safe-frame-count',
      'The parser alignment frame count is outside its reviewed bound.',true,true);
    for(let index=0;index<safeFrames;index++){
      const frame=new Uint8Array(STOCK_R51.packetBytes);frame[0]=0x14;
      await writer.write(frame);await sleep(STOCK_R51.minimumInterpacketMs);
    }
    for(let index=0;index<carrierPackets;index++){
      const offset=index*STOCK_R51.packetBytes,packet=carrier.subarray(offset,offset+STOCK_R51.packetBytes);
      need(packet.length===STOCK_R51.packetBytes,'carrier','packet','The pinned carrier is not an exact 512-byte packet sequence.',true,true);
      if(splitTrigger&&index+1===carrierPackets){
        const prefix=packet.subarray(0,STOCK_R51.triggerPrefixBytes),payload=packet.subarray(STOCK_R51.triggerPrefixBytes);
        need(prefix.length===16&&payload.length===496&&prefix[0]===1,'carrier','trigger-layout',
          'The pinned carrier trigger no longer has the packet-safe parser split.',true,true);
        await writer.write(prefix);await sleep(STOCK_R51.minimumTriggerSplitMs);await writer.write(payload);
      }else await writer.write(packet);
      onProgress?.({phase:'carrier',completed:index+1,total:carrierPackets});
      if(index+1<carrierPackets)await sleep(STOCK_R51.minimumInterpacketMs);
    }
    complete=true;
  }catch(error){
    if(error instanceof StockBootstrapError)throw error;
    fail('carrier','transport',`The one-shot carrier became uncertain: ${error instanceof Error?error.message:String(error)} Do not retry.`,true,true);
  }finally{
    writer?.releaseLock();try{await port.close();}catch(error){if(!complete)throw error;}
  }
}

/** Stage/read back R51 to establish the proven parser phase, then send Revision V once. */
export async function bootstrapStockToR51VSerialOnly(
  port:StockSerialPort,
  artifacts:StockR51VArtifacts,
  store:StockClaimStore,
  options:Readonly<{onProgress?:(event:StockBootstrapProgress)=>void}>={},
):Promise<StockR51VReceipt>{
  assertStockPort(port);
  need(artifacts.writer.length===STOCK_R51_V.writerBytes&&await sha256(artifacts.writer)===STOCK_R51_V.writerSha256&&
    artifacts.carrier.length===STOCK_R51_V.carrierBytes&&await sha256(artifacts.carrier)===STOCK_R51_V.carrierSha256,
    'artifacts','identity','The pinned R51 stock-bootstrap artifacts changed. Nothing was written.');
  let prior:unknown;
  try{const raw=store.load();prior=raw?JSON.parse(raw):undefined;}catch{
    fail('claim','invalid','The saved R51 stock-bootstrap claim is damaged. Do not retry from this browser.');
  }
  const saved=prior as {format?:string;state?:string;stagePath?:string;writerSha256?:string;carrierSha256?:string;retryAllowed?:boolean}|undefined;
  const state=saved?.state;
  if(prior)need(saved?.format==='opensp-stock-r51v-claim-v1'&&state==='stage-verified'&&
    saved.stagePath===STOCK_R51_V.stagePath&&saved.writerSha256===STOCK_R51_V.writerSha256&&
    saved.carrierSha256===STOCK_R51_V.carrierSha256&&saved.retryAllowed===false,
    'claim','already-attempted',`This browser already sealed the R51 stock route as ${String(state)}. Do not resend the carrier.`);
  const save=(next:string)=>store.save(JSON.stringify({format:'opensp-stock-r51v-claim-v1',state:next,
    stagePath:STOCK_R51_V.stagePath,writerSha256:STOCK_R51_V.writerSha256,
    carrierSha256:STOCK_R51_V.carrierSha256,retryAllowed:false,updatedAt:new Date().toISOString()}));
  if(!prior)await stageFreshR51(port,artifacts.writer,()=>save('claimed'),options.onProgress,STOCK_R51_V.stagePath);
  await readbackR51(port,artifacts.writer,options.onProgress,STOCK_R51_V.stagePath);
  save('stage-verified');save('carrier-started');
  await sendCarrier(port,artifacts.carrier,STOCK_R51_V.carrierPackets,options.onProgress,
    {safeFrames:STOCK_R51_V.alignmentSafeFrames,splitTrigger:false});
  save('carrier-complete');
  return Object.freeze({format:'opensp-stock-r51v-bootstrap-v1',writerSha256:STOCK_R51_V.writerSha256,
    carrierSha256:STOCK_R51_V.carrierSha256,stagePath:STOCK_R51_V.stagePath,stageReadbackVerified:true,
    alignmentSafeFrames:3,carrierPackets:51,carrierBytes:26112,carrierComplete:true,fullPacketWrites:true,
    retryAllowed:false,remainingCheck:'fresh R51 WebHID attestation'});
}

async function bootstrapStockToR51Core(
  port:StockSerialPort,
  artifacts:StockArtifacts,
  store:StockClaimStore,
  options:Readonly<{onProgress?:(event:StockBootstrapProgress)=>void}>={},
):Promise<StockBootstrapReceipt>{
  assertStockPort(port);
  need(artifacts.r51.length===STOCK_R51.r51Bytes&&await sha256(artifacts.r51)===STOCK_R51.r51Sha256&&
    artifacts.carrier.length===STOCK_R51.carrierBytes&&await sha256(artifacts.carrier)===STOCK_R51.carrierSha256,
    'artifacts','identity','The pinned stock bootstrap artifacts changed. Nothing was written.');
  let claim=parseClaim(store.load());
  if(claim&&claim.state!=='stage-verified')fail('claim','already-attempted',
    `This browser already sealed the stock route as ${claim.state}. The Revision X carrier is one-shot and cannot be retried.`);
  if(!claim){
    const staged=await stageFreshR51(port,artifacts.r51,()=>{claim=saveClaim(store,'claimed');},options.onProgress);
    await readbackR51(port,artifacts.r51,options.onProgress);
    if(staged==='existing')claim=saveClaim(store,'claimed');
    claim=saveClaim(store,'stage-verified',claim);
  }else{
    await readbackR51(port,artifacts.r51,options.onProgress);
  }
  claim=saveClaim(store,'carrier-started',claim);
  await sendCarrier(port,artifacts.carrier,STOCK_R51.carrierPackets,options.onProgress);
  saveClaim(store,'carrier-complete',claim);
  return Object.freeze({format:'opensp-stock-p34x-bootstrap-v1',r51Sha256:STOCK_R51.r51Sha256,
    carrierSha256:STOCK_R51.carrierSha256,stagePath:STOCK_R51.stagePath,stageReadbackVerified:true,
    carrierPackets:STOCK_R51.carrierPackets,carrierBytes:STOCK_R51.carrierBytes,carrierComplete:true,
    triggerWrites:[16,496] as const,fullSpeedPacketSafe:true,
    retryAllowed:false,remainingCheck:'fresh OpenSynth P34 passive attestation'});
}

/** Run the packet-safe stock route using only the authorized Web Serial port. */
export async function bootstrapStockToR51SerialOnly(
  port:StockSerialPort,
  artifacts:StockArtifacts,
  store:StockClaimStore,
  options:Readonly<{onProgress?:(event:StockBootstrapProgress)=>void}>={},
):Promise<StockBootstrapReceipt>{
  return bootstrapStockToR51Core(port,artifacts,store,options);
}

/** Stage the distributable delta and run its stock-v5.52-verified APP1 installer once. */
export async function installStockP34DeltaSerialOnly(
  port:StockSerialPort,
  artifacts:StockDeltaArtifacts,
  store:StockClaimStore,
  options:Readonly<{onProgress?:(event:StockBootstrapProgress)=>void}>={},
):Promise<StockDeltaInstallReceipt>{
  assertStockPort(port);
  need(artifacts.delta.length===STOCK_P34_DELTA.deltaBytes&&
    await sha256(artifacts.delta)===STOCK_P34_DELTA.deltaSha256&&
    artifacts.carrier.length===STOCK_P34_DELTA.carrierBytes&&
    await sha256(artifacts.carrier)===STOCK_P34_DELTA.carrierSha256,
    'artifacts','identity','The pinned stock delta artifacts changed. Nothing was written.');
  let prior:unknown;
  try{const raw=store.load();prior=raw?JSON.parse(raw):undefined;}catch{fail('claim','invalid','The saved delta-install claim is damaged. Do not retry from this browser.');}
  const state=(prior as {format?:string;state?:string}|undefined)?.state;
  if(prior){
    need((prior as {format?:string}).format==='opensp-stock-p34z-claim-v1'&&state==='stage-verified',
      'claim','already-attempted',`This browser already sealed the delta route as ${String(state)}. Do not resend the carrier.`);
  }
  const save=(next:string)=>store.save(JSON.stringify({format:'opensp-stock-p34z-claim-v1',state:next,
    stagePath:STOCK_P34_DELTA.stagePath,deltaSha256:STOCK_P34_DELTA.deltaSha256,
    carrierSha256:STOCK_P34_DELTA.carrierSha256,retryAllowed:false,updatedAt:new Date().toISOString()}));
  if(!prior){
    await stageFreshR51(port,artifacts.delta,()=>save('claimed'),options.onProgress,STOCK_P34_DELTA.stagePath);
  }
  await readbackR51(port,artifacts.delta,options.onProgress,STOCK_P34_DELTA.stagePath);
  save('stage-verified');
  save('carrier-started');
  await sendCarrier(port,artifacts.carrier,STOCK_P34_DELTA.carrierPackets,options.onProgress);
  save('carrier-complete');
  return Object.freeze({format:'opensp-stock-p34z-delta-install-v1',deltaSha256:STOCK_P34_DELTA.deltaSha256,
    carrierSha256:STOCK_P34_DELTA.carrierSha256,stagePath:STOCK_P34_DELTA.stagePath,
    stageReadbackVerified:true,carrierPackets:13,carrierBytes:6656,carrierComplete:true,
    sourceSha256:STOCK_P34_DELTA.sourceSha256,targetSha256:STOCK_P34_DELTA.targetSha256,
    retryAllowed:false,remainingCheck:'fresh OpenSynth P34 passive attestation'});
}

/** Validate the exact staged P34 file in stock context without any flash write path. */
export async function preflightStockP34SerialOnly(
  port:StockSerialPort,
  image:Uint8Array,
  carrier:Uint8Array,
  store:StockClaimStore,
  options:Readonly<{onProgress?:(event:StockBootstrapProgress)=>void}>={},
):Promise<StockPreflightReceipt>{
  assertStockPort(port);
  need(image.length===STOCK_R51.r51Bytes&&await sha256(image)===STOCK_R51.r51Sha256,
    'artifacts','image-identity','The OpenSynth P34 image changed. Nothing was written.');
  need(carrier.length===STOCK_P34_PREFLIGHT.carrierBytes&&await sha256(carrier)===STOCK_P34_PREFLIGHT.carrierSha256,
    'artifacts','preflight-identity','The Revision W preflight carrier changed. Nothing was written.');
  need(store.load()===null,'preflight-claim','already-attempted',
    'This preflight store already records an attempt. The carrier is one-shot and cannot be retried.');
  let claimSaved=false;
  const save=(state:string)=>{
    const value=JSON.stringify({format:'opensp-stock-p34w-preflight-v1',state,stagePath:STOCK_R51.stagePath,
      imageSha256:STOCK_R51.r51Sha256,carrierSha256:STOCK_P34_PREFLIGHT.carrierSha256,retryAllowed:false});
    store.save(value);claimSaved=true;
  };
  const staged=await stageFreshR51(port,image,()=>save('claimed'),options.onProgress);
  await readbackR51(port,image,options.onProgress);
  if(staged==='existing')save('claimed');
  else need(claimSaved,'preflight-claim','missing','The preflight claim was not saved before staging.');
  save('stage-verified');save('carrier-started');
  await sendCarrier(port,carrier,STOCK_P34_PREFLIGHT.carrierPackets,options.onProgress);
  save('carrier-complete');
  return Object.freeze({format:'opensp-stock-p34w-preflight-v1',imageSha256:STOCK_R51.r51Sha256,
    carrierSha256:STOCK_P34_PREFLIGHT.carrierSha256,stagePath:STOCK_R51.stagePath,
    stageReadbackVerified:true,carrierPackets:5,carrierBytes:2560,carrierComplete:true,
    flashWritePath:false,retryAllowed:false,remainingCheck:'fresh stock serial identity after diagnostic reset'});
}

/** Run the no-flash W preflight, direct X install, and passive P34 proof from one action. */
export async function qualifyAndInstallStockP34(
  serial:BrowserSerial|undefined,
  initialPort:StockSerialPort,
  image:Uint8Array,
  preflightCarrier:Uint8Array,
  installCarrier:Uint8Array,
  preflightStore:StockClaimStore,
  installStore:StockClaimStore,
  options:Readonly<{resetDelayMs?:number;onProgress?:(event:StockBootstrapProgress)=>void;
    sleep?:(milliseconds:number)=>Promise<void>;attestationTimeoutMs?:number}>={},
):Promise<StockQualifiedInstallReceipt>{
  const pause=options.sleep??sleep,resetDelayMs=options.resetDelayMs??5_000;
  need(Number.isSafeInteger(resetDelayMs)&&resetDelayMs>=1_000&&resetDelayMs<=30_000,
    'qualified-install','reset-delay','The W reset delay must stay within its fixed bounds.');
  const preflight=await preflightStockP34SerialOnly(initialPort,image,preflightCarrier,preflightStore,{onProgress:options.onProgress});
  await pause(resetDelayMs);
  const returned=await getAuthorizedStockPort(serial);
  need(returned,'qualified-install','stock-return','Revision W completed, but the authorized stock serial port did not return. Do not send Revision X.');
  const installImage=new Uint8Array(image.length);installImage.set(image);
  const pinnedInstallCarrier=new Uint8Array(installCarrier.length);pinnedInstallCarrier.set(installCarrier);
  const install=await bootstrapStockToR51SerialOnly(returned,{r51:installImage,carrier:pinnedInstallCarrier},installStore,{onProgress:options.onProgress});
  const attestation=await waitForOpenSynthP34(serial,{timeoutMs:options.attestationTimeoutMs??180_000,sleep:pause});
  return Object.freeze({format:'opensp-stock-p34-qualified-install-v1',preflight,install,attestation,oneAction:true,permissionPickers:1});
}

/** Compatibility entry point retaining the former read-only high-speed check. */
export async function bootstrapStockToR51(
  port:StockSerialPort,
  usbDevice:StockUsbDevice,
  attestation:StockSpeedAttestation,
  artifacts:StockArtifacts,
  store:StockClaimStore,
  options:Readonly<{onProgress?:(event:StockBootstrapProgress)=>void}>={},
):Promise<StockBootstrapReceipt>{
  const repeated=attestStockHighSpeed(usbDevice);
  need(JSON.stringify(repeated)===JSON.stringify(attestation),'speed','attestation-changed','The stock high-speed descriptor changed before the protected bootstrap. Nothing was written.');
  return bootstrapStockToR51Core(port,artifacts,store,options);
}

export function markStockR51Attested(store:StockClaimStore):StockClaim|undefined{
  const claim=parseClaim(store.load());if(!claim)return undefined;
  need(claim.state==='carrier-complete'||claim.state==='r51-attested','claim','state','R51 cannot be marked attested before the carrier completes.');
  return claim.state==='r51-attested'?claim:saveClaim(store,'r51-attested',claim);
}

export const __test=Object.freeze({midi7Encode3,midi7Encode5,midi7Decode5,openFile,closeFile,readFile,writeFile,parseAck,parseData});
