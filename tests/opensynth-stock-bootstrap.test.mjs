import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {STOCK_P34_DELTA,STOCK_P34_PREFLIGHT,STOCK_R51,STOCK_R51_V,StockBootstrapError,__test,attestStockHighSpeed,bootstrapStockToR51,bootstrapStockToR51SerialOnly,bootstrapStockToR51VSerialOnly,
  getAuthorizedStockHighSpeed,getAuthorizedStockPort,markStockR51Attested,parseOpenSynthP34Session,parseSpg1Session,requestStockHighSpeed,requestStockPort,
  installStockP34DeltaSerialOnly,preflightStockP34SerialOnly,qualifyAndInstallStockP34,waitForNormalUsb,waitForOpenSynthP34,waitForSpg1Session} from '../src/lib/opensynth/stock-bootstrap.ts';

const bytes=hex=>Uint8Array.from(hex.match(/../g)?.map(value=>Number.parseInt(value,16))??[]);
const hexOf=value=>Buffer.from(value).toString('hex');
const sha=value=>createHash('sha256').update(value).digest('hex');
const legacyPreflightCarrierUrl=new URL('../../sp404mk2/analysis/v552/stock_usb_bootstrap/stock_task_handoff_r50/build_carrier_w_p34_staged/packet_sequence.bin',import.meta.url);
const concat=(...parts)=>Uint8Array.from(parts.flatMap(part=>[...part]));
const u32=value=>{const raw=new Uint8Array(4);new DataView(raw.buffer).setUint32(0,value,true);return raw;};
const encode5=value=>Uint8Array.of((value>>28)&0x7f,(value>>21)&0x7f,(value>>14)&0x7f,(value>>7)&0x7f,value&0x7f);
const wrap=(magic,payload)=>concat(bytes(magic),new Uint8Array(8),u32(payload.length),payload);
const ack=(result,errno=0)=>wrap('13e06006',concat(bytes('f0417a7a'),encode5(result),encode5(errno),Uint8Array.of(0xf7)));
const data=(handle,body)=>wrap('13e06006',concat(bytes('f0417a02'),encode5(handle),Uint8Array.of(0x40),encode5(body.length).subarray(1),body,Uint8Array.of(0xf7)));
const startup=()=>concat(
  wrap('13e06b05',bytes('7e00000000000000ffffffff00020000000b33')),
  wrap('13e00005',bytes('010000ffff00000000')),
  wrap('13e00005',bytes('010000ffff00000000')),
);

function stockDevice(packetSize=512){
  return {vendorId:0x0582,productId:0x02e7,configurations:[{configurationValue:1,interfaces:[
    {interfaceNumber:0,alternates:[{alternateSetting:0,interfaceClass:2,interfaceSubclass:2,interfaceProtocol:0,
      endpoints:[{endpointNumber:1,direction:'in',type:'interrupt',packetSize:16}]}]},
    {interfaceNumber:1,alternates:[{alternateSetting:0,interfaceClass:10,interfaceSubclass:0,interfaceProtocol:0,
      endpoints:[{endpointNumber:2,direction:'in',type:'bulk',packetSize},{endpointNumber:3,direction:'out',type:'bulk',packetSize}]}]},
  ]}]};
}

function crc32(value){
  let crc=0xffffffff;for(const byte of value){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}

function p34Session(){
  const raw=new Uint8Array(68),view=new DataView(raw.buffer);raw.set(Buffer.from('SPG1'));
  raw[4]=1;raw[5]=1;view.setUint16(8,32,true);view.setUint16(10,32,true);view.setUint32(12,0x12345678,true);
  view.setUint32(16,7,true);view.setBigUint64(20,1234n,true);view.setUint32(28,0,true);
  view.setUint32(32,23,true);view.setUint32(36,0x05520001,true);view.setUint32(40,0,true);
  view.setUint32(44,1124,true);view.setUint16(48,128,true);view.setUint16(50,64,true);view.setUint16(52,2,true);
  view.setUint16(54,64,true);view.setUint32(56,3,true);view.setUint32(60,0x4f534731,true);
  view.setUint32(64,crc32(raw.subarray(0,64)),true);return raw;
}

test('stock descriptor picker proves exact high-speed bulk endpoints without opening USB',async()=>{
  const device=stockDevice(),calls=[];
  device.open=()=>{throw new Error('must not open')};device.claimInterface=()=>{throw new Error('must not claim')};
  const result=await requestStockHighSpeed({requestDevice:async options=>{calls.push(options);return device;}});
  assert.deepEqual(calls,[{filters:[{vendorId:0x0582,productId:0x02e7}]}]);
  assert.deepEqual(result.attestation,{vendorId:0x0582,productId:0x02e7,configurationValue:1,
    bulkInPacketSize:512,bulkOutPacketSize:512,usbOpened:false,usbClaimed:false});
});

test('full-speed, malformed and cancelled stock descriptor checks stop before serial I/O',async()=>{
  assert.throws(()=>attestStockHighSpeed(stockDevice(64)),error=>error instanceof StockBootstrapError&&error.code==='not-high-speed');
  assert.throws(()=>attestStockHighSpeed({...stockDevice(),productId:0x0281}),error=>error instanceof StockBootstrapError&&error.code==='device-identity');
  await assert.rejects(()=>requestStockHighSpeed({requestDevice:async()=>{const error=new Error('cancel');error.name='NotFoundError';throw error;}}),
    error=>error instanceof StockBootstrapError&&error.code==='cancelled');
});

test('stock serial picker is pinned to 0582:02E7',async()=>{
  const port={getInfo:()=>({usbVendorId:0x0582,usbProductId:0x02e7})};let options;
  assert.equal(await requestStockPort({requestPort:async value=>{options=value;return port;}}),port);
  assert.deepEqual(options,{filters:[{usbVendorId:0x0582,usbProductId:0x02e7}]});
  await assert.rejects(()=>requestStockPort({requestPort:async()=>({getInfo:()=>({usbVendorId:0x0582,usbProductId:0x0281})})}),
    error=>error instanceof StockBootstrapError&&error.code==='device-identity');
});

test('already-authorized stock USB and serial identities are reused without pickers',async()=>{
  const device=stockDevice(),port={getInfo:()=>({usbVendorId:0x0582,usbProductId:0x02e7})};
  let usbPicks=0,serialPicks=0;
  const usb={getDevices:async()=>[device],requestDevice:async()=>{usbPicks++;return device;}};
  const serial={getPorts:async()=>[port],requestPort:async()=>{serialPicks++;return port;}};
  assert.equal((await getAuthorizedStockHighSpeed(usb)).device,device);
  assert.equal(await getAuthorizedStockPort(serial),port);assert.equal(usbPicks,0);assert.equal(serialPicks,0);
  assert.equal(await getAuthorizedStockHighSpeed({requestDevice:usb.requestDevice}),undefined);
  assert.equal(await getAuthorizedStockPort({requestPort:serial.requestPort}),undefined);
  await assert.rejects(()=>getAuthorizedStockHighSpeed({...usb,getDevices:async()=>[device,device]}),
    error=>error instanceof StockBootstrapError&&error.code==='duplicate');
  await assert.rejects(()=>getAuthorizedStockPort({...serial,getPorts:async()=>[port,port]}),
    error=>error instanceof StockBootstrapError&&error.code==='duplicate');
});

test('browser file-service packets preserve the bounded stock transport',async()=>{
  const image=new Uint8Array(await readFile(new URL('../public/opensynth/usb/opensynth-p34-app1.bin',import.meta.url)));
  const chunk=image.subarray(0,20*1024);
  const records=[
    [__test.openFile(STOCK_R51.stagePath,0x30000001),78],
    [__test.openFile(STOCK_R51.stagePath,0x30000002,true),78],
    [__test.writeFile(7,0x30000100,chunk),chunk.length+32],
    [__test.readFile(7,0x31000100,chunk.length),33],
    [__test.closeFile(7,0x30000004),33],
  ];
  for(const [raw,length] of records)assert.equal(raw.length,length);
});

test('normal USB return is detected from an authorized exact stock endpoint',async()=>{
  const normal=stockDevice();let polls=0;
  const attestation=await waitForNormalUsb({requestDevice:async()=>normal,getDevices:async()=>++polls===1?[]:[normal]},
    {timeoutMs:100,pollMs:1,sleep:async()=>{}});
  assert.equal(polls,2);assert.equal(attestation.vendorId,0x0582);assert.equal(attestation.bulkInPacketSize,512);
});

test('normal USB return refuses duplicate devices and has a bounded timeout',async()=>{
  const normal=stockDevice();
  await assert.rejects(()=>waitForNormalUsb({requestDevice:async()=>normal,getDevices:async()=>[normal,normal]},
    {timeoutMs:100,pollMs:1,sleep:async()=>{}}),error=>error instanceof StockBootstrapError&&error.code==='duplicate');
  await assert.rejects(()=>waitForNormalUsb({requestDevice:async()=>normal,getDevices:async()=>[]},
    {timeoutMs:1,pollMs:1,sleep:async()=>{}}),error=>error instanceof StockBootstrapError&&error.code==='timeout');
  await assert.rejects(()=>waitForNormalUsb(undefined),error=>error instanceof StockBootstrapError&&error.code==='unsupported');
});

test('passive OpenSynth return requires the exact P34 SPG1 session and sends nothing',async()=>{
  const record=p34Session(),writes=[],signals=[];let opened=0,closed=0;
  const port={getInfo:()=>({usbVendorId:0x0582,usbProductId:0x02e7}),readable:null,writable:null,
    async open(){opened++;this.readable=new ReadableStream({start(controller){controller.enqueue(Uint8Array.of(9,8,7));
      controller.enqueue(record.subarray(0,19));controller.enqueue(record.subarray(19));controller.close();}});
      this.writable=new WritableStream({write(value){writes.push(value);}});},
    async setSignals(value){signals.push(value);},
    async close(){closed++;this.readable=null;this.writable=null;}};
  const attestation=await waitForOpenSynthP34({requestPort:async()=>port,getPorts:async()=>[port]},
    {timeoutMs:100,pollMs:1,sleep:async()=>{}});
  assert.equal(attestation.format,'opensp-p34-passive-session-v1');assert.equal(attestation.session,0x12345678);
  assert.equal(attestation.profileId,0x05520001);assert.equal(attestation.buildMarker,0x4f534731);
  assert.equal(attestation.serialWrites,0);assert.equal(writes.length,0);assert.equal(opened,1);assert.equal(closed,1);
  assert.deepEqual(signals,[
    {dataTerminalReady:false,requestToSend:false},
    {dataTerminalReady:true,requestToSend:false},
  ]);
});

test('generic passive return accepts caller-pinned SPG1 firmware identity and sends nothing',async()=>{
  const record=p34Session(),view=new DataView(record.buffer),writes=[];
  view.setUint32(36,0x10203040,true);view.setUint32(60,0x41424344,true);
  view.setUint32(64,crc32(record.subarray(0,64)),true);
  const expected={profileId:0x10203040,buildMarker:0x41424344,maximum:1124,width:128,height:64,capacity:64,
    allowedFeaturesMask:23,allowedPixelFormats:[2]};
  assert.equal(parseSpg1Session(record,expected)?.profileId,0x10203040);
  assert.equal(parseSpg1Session(record,{...expected,buildMarker:0x41424345}),undefined);
  const port={getInfo:()=>({usbVendorId:0x0582,usbProductId:0x02e7}),readable:null,writable:null,
    async open(){this.readable=new ReadableStream({start(controller){controller.enqueue(record);controller.close();}});
      this.writable=new WritableStream({write(value){writes.push(value);}});},async setSignals(){},
    async close(){this.readable=null;this.writable=null;}};
  const attestation=await waitForSpg1Session({requestPort:async()=>port,getPorts:async()=>[port]},expected,
    {timeoutMs:100,pollMs:1,sleep:async()=>{}});
  assert.equal(attestation.format,'opensp-spg1-passive-session-v1');assert.equal(attestation.buildMarker,0x41424344);
  assert.equal(attestation.serialWrites,0);assert.equal(writes.length,0);
});

test('passive OpenSynth return rejects damaged identity and duplicate ports',async()=>{
  const damaged=p34Session();damaged[60]^=1;
  assert.equal(parseOpenSynthP34Session(damaged),undefined);
  const port={getInfo:()=>({usbVendorId:0x0582,usbProductId:0x02e7}),readable:null,writable:null,
    async open(){this.readable=new ReadableStream({start(controller){controller.enqueue(damaged);controller.close();}});},async close(){}};
  await assert.rejects(()=>waitForOpenSynthP34({requestPort:async()=>port,getPorts:async()=>[port]},
    {timeoutMs:100,pollMs:1,sleep:async()=>{}}),error=>error instanceof StockBootstrapError&&error.code==='identity-timeout');
  await assert.rejects(()=>waitForOpenSynthP34({requestPort:async()=>port,getPorts:async()=>[port,port]},
    {timeoutMs:100,pollMs:1,sleep:async()=>{}}),error=>error instanceof StockBootstrapError&&error.code==='duplicate');
});

test('published stock bootstrap artifacts are exact and bounded',async()=>{
  const r51=await readFile(new URL('../public/opensynth/usb/opensynth-p34-app1.bin',import.meta.url));
  const carrier=await readFile(new URL('../public/opensynth/usb/stock-carrier-p34-x1.oscarrier',import.meta.url));
  assert.equal(r51.length,STOCK_R51.r51Bytes);assert.equal(sha(r51),STOCK_R51.r51Sha256);
  assert.equal(carrier.length,STOCK_R51.carrierBytes);assert.equal(sha(carrier),STOCK_R51.carrierSha256);
  assert.equal(carrier.length/STOCK_R51.packetBytes,STOCK_R51.carrierPackets);
});

test('published stock delta route is exact and carries no full firmware image',async()=>{
  const delta=await readFile(new URL('../public/opensynth/usb/opensynth-p34-from-stock-v552.osdelta',import.meta.url));
  const carrier=await readFile(new URL('../public/opensynth/usb/stock-carrier-p34-z1.oscarrier',import.meta.url));
  assert.equal(delta.length,STOCK_P34_DELTA.deltaBytes);assert.equal(sha(delta),STOCK_P34_DELTA.deltaSha256);
  assert.equal(carrier.length,STOCK_P34_DELTA.carrierBytes);assert.equal(sha(carrier),STOCK_P34_DELTA.carrierSha256);
  assert.equal(carrier.length/STOCK_P34_DELTA.packetBytes,STOCK_P34_DELTA.carrierPackets);
  assert.ok(delta.length<200_000);assert.notEqual(sha(delta),STOCK_P34_DELTA.targetSha256);
});

class FakeStockPort{
  constructor(image,carrier,existing=false){this.image=image;this.carrier=carrier;this.existing=existing;this.sessions=0;this.writes=[];this.signals=[];this.readable=null;this.writable=null;}
  getInfo(){return {usbVendorId:0x0582,usbProductId:0x02e7};}
  async open(){
    const session=this.sessions++,self=this;let controller,readOffset=0;
    this.readable=new ReadableStream({start(value){controller=value;}});
    this.writable=new WritableStream({write(chunk){const raw=Uint8Array.from(chunk);self.writes.push({session,raw});
      if(session===2)return;
      if(hexOf(raw.subarray(0,4))==='1360e005'&&raw.length===25){controller.enqueue(startup());return;}
      if(hexOf(raw.subarray(0,4))!=='1360e006')return;
      const txid=new DataView(raw.buffer,raw.byteOffset,raw.byteLength).getUint32(8,true);
      if(txid===0x30000001)controller.enqueue(self.existing?ack(7):ack(-1,2));
      else if(txid===0x30000002)controller.enqueue(ack(7));
      else if(txid>=0x30000100&&txid<0x30001000)controller.enqueue(ack(raw.length-32));
      else if(txid===0x30000004||txid===0x31000004)controller.enqueue(ack(0));
      else if(txid===0x31000001)controller.enqueue(ack(7));
      else if(txid>=0x31000100&&txid<0x31001000){const part=self.image.subarray(readOffset,readOffset+20*1024);readOffset+=part.length;controller.enqueue(data(7,part));}
      else if(txid===0x31000003)controller.enqueue(ack(0));
    }});
    this.controller=controller;
  }
  async setSignals(value){this.signals.push(value);}
  async close(){try{this.controller?.close();}catch{}this.readable=null;this.writable=null;}
}

test('stock-to-P34 browser flow stages once, verifies in a fresh session and packet-safely splits the trigger',async()=>{
  const image=new Uint8Array(await readFile(new URL('../public/opensynth/usb/opensynth-p34-app1.bin',import.meta.url)));
  const carrier=new Uint8Array(await readFile(new URL('../public/opensynth/usb/stock-carrier-p34-x1.oscarrier',import.meta.url)));
  const port=new FakeStockPort(image,carrier),progress=[];
  let stored=null;const store={load:()=>stored,save:value=>{stored=value;}};
  const receipt=await bootstrapStockToR51SerialOnly(port,{r51:image,carrier},store,{onProgress:event=>progress.push(event)});
  assert.equal(receipt.carrierComplete,true);assert.equal(receipt.stageReadbackVerified,true);assert.equal(receipt.retryAllowed,false);
  assert.equal(receipt.fullSpeedPacketSafe,true);assert.deepEqual(receipt.triggerWrites,[16,496]);
  assert.equal(port.sessions,3);const writes=port.writes.filter(item=>item.session===2);assert.equal(writes.length,12);
  assert.deepEqual(writes.map(item=>item.raw.length),[...Array(10).fill(512),16,496]);
  assert.equal(hexOf(writes[10].raw.subarray(0,4)),'01000000');
  assert.equal(sha(Buffer.concat(writes.map(item=>Buffer.from(item.raw)))),STOCK_R51.carrierSha256);
  assert.equal(JSON.parse(stored).state,'carrier-complete');assert.equal(markStockR51Attested(store).state,'r51-attested');
  assert.ok(progress.some(item=>item.phase==='stage-readback'&&item.completed===image.length));
});

test('R51 Revision-V flow reproduces the proven alignment with three safe frames and full packets',async()=>{
  const writer=new Uint8Array(await readFile(new URL('../public/opensynth/usb/stock-r51-v1.osr51',import.meta.url)));
  const carrier=new Uint8Array(await readFile(new URL('../public/opensynth/usb/stock-carrier-r51-v1.oscarrier',import.meta.url)));
  assert.equal(writer.length,STOCK_R51_V.writerBytes);assert.equal(sha(writer),STOCK_R51_V.writerSha256);
  assert.equal(carrier.length,STOCK_R51_V.carrierBytes);assert.equal(sha(carrier),STOCK_R51_V.carrierSha256);
  const port=new FakeStockPort(writer,carrier),progress=[];let stored=null;
  const receipt=await bootstrapStockToR51VSerialOnly(port,{writer,carrier},{load:()=>stored,save:value=>{stored=value;}},
    {onProgress:event=>progress.push(event)});
  assert.equal(receipt.stageReadbackVerified,true);assert.equal(receipt.alignmentSafeFrames,3);
  assert.equal(receipt.fullPacketWrites,true);assert.equal(receipt.carrierComplete,true);
  const writes=port.writes.filter(item=>item.session===2);assert.equal(writes.length,54);
  assert.deepEqual(writes.map(item=>item.raw.length),Array(54).fill(512));
  for(const frame of writes.slice(0,3)){assert.equal(frame.raw[0],0x14);assert.equal(frame.raw.slice(1).some(Boolean),false);}
  assert.equal(sha(Buffer.concat(writes.slice(3).map(item=>Buffer.from(item.raw)))),STOCK_R51_V.carrierSha256);
  assert.equal(JSON.parse(stored).state,'carrier-complete');
  assert.ok(progress.some(item=>item.phase==='stage-readback'&&item.completed===writer.length));
  await assert.rejects(()=>bootstrapStockToR51VSerialOnly(new FakeStockPort(writer,carrier),{writer,carrier},
    {load:()=>stored,save:()=>{}}),error=>error instanceof StockBootstrapError&&error.code==='already-attempted');
});

test('R51 Revision-V resumes only an exact verified-stage claim',async()=>{
  const writer=new Uint8Array(await readFile(new URL('../public/opensynth/usb/stock-r51-v1.osr51',import.meta.url)));
  const carrier=new Uint8Array(await readFile(new URL('../public/opensynth/usb/stock-carrier-r51-v1.oscarrier',import.meta.url)));
  const claim={format:'opensp-stock-r51v-claim-v1',state:'stage-verified',stagePath:STOCK_R51_V.stagePath,
    writerSha256:STOCK_R51_V.writerSha256,carrierSha256:STOCK_R51_V.carrierSha256,retryAllowed:false};
  let stored=JSON.stringify(claim);const port=new FakeStockPort(writer,carrier,true);
  const receipt=await bootstrapStockToR51VSerialOnly(port,{writer,carrier},{load:()=>stored,save:value=>{stored=value;}});
  assert.equal(receipt.carrierComplete,true);assert.equal(port.sessions,2);assert.equal(port.writes.filter(item=>item.session===1).length,54);
  for(const changed of [
    {...claim,stagePath:'/changed'},
    {...claim,writerSha256:'0'.repeat(64)},
    {...claim,carrierSha256:'0'.repeat(64)},
    {...claim,retryAllowed:true},
  ]){
    const rejected=new FakeStockPort(writer,carrier,true);
    await assert.rejects(()=>bootstrapStockToR51VSerialOnly(rejected,{writer,carrier},
      {load:()=>JSON.stringify(changed),save:()=>{}}),error=>error instanceof StockBootstrapError&&error.code==='already-attempted');
    assert.equal(rejected.sessions,0);assert.equal(rejected.writes.length,0);
  }
});

test('stock delta browser flow stages, reads back and sends the Z carrier once',async()=>{
  const delta=new Uint8Array(await readFile(new URL('../public/opensynth/usb/opensynth-p34-from-stock-v552.osdelta',import.meta.url)));
  const carrier=new Uint8Array(await readFile(new URL('../public/opensynth/usb/stock-carrier-p34-z1.oscarrier',import.meta.url)));
  const port=new FakeStockPort(delta,carrier),progress=[];let stored=null;
  const store={load:()=>stored,save:value=>{stored=value;}};
  const receipt=await installStockP34DeltaSerialOnly(port,{delta,carrier},store,{onProgress:event=>progress.push(event)});
  assert.equal(receipt.carrierComplete,true);assert.equal(receipt.stageReadbackVerified,true);
  assert.equal(receipt.sourceSha256,STOCK_P34_DELTA.sourceSha256);assert.equal(receipt.targetSha256,STOCK_P34_DELTA.targetSha256);
  assert.equal(port.sessions,3);const writes=port.writes.filter(item=>item.session===2);
  assert.deepEqual(writes.map(item=>item.raw.length),[...Array(12).fill(512),16,496]);
  assert.equal(sha(Buffer.concat(writes.map(item=>Buffer.from(item.raw)))),STOCK_P34_DELTA.carrierSha256);
  assert.equal(JSON.parse(stored).state,'carrier-complete');
  assert.ok(progress.some(item=>item.phase==='stage-readback'&&item.completed===delta.length));
  await assert.rejects(()=>installStockP34DeltaSerialOnly(new FakeStockPort(delta,carrier),{delta,carrier},store),
    error=>error instanceof StockBootstrapError&&error.code==='already-attempted');
});

test('one qualification action runs W, requires returned stock, adopts the verified stage for X, and proves P34',
  {skip:!existsSync(legacyPreflightCarrierUrl)&&'legacy W fixture is maintained in the firmware repository'},async()=>{
  const image=new Uint8Array(await readFile(new URL('../public/opensynth/usb/opensynth-p34-app1.bin',import.meta.url)));
  const preflightCarrier=new Uint8Array(await readFile(legacyPreflightCarrierUrl));
  const installCarrier=new Uint8Array(await readFile(new URL('../public/opensynth/usb/stock-carrier-p34-x1.oscarrier',import.meta.url)));
  assert.equal(preflightCarrier.length,STOCK_P34_PREFLIGHT.carrierBytes);assert.equal(sha(preflightCarrier),STOCK_P34_PREFLIGHT.carrierSha256);
  const first=new FakeStockPort(image,preflightCarrier),returned=new FakeStockPort(image,installCarrier,true);
  const session=p34Session(),p34={readable:null,writable:null,getInfo:()=>({usbVendorId:0x0582,usbProductId:0x02e7}),
    async open(){this.readable=new ReadableStream({start(controller){controller.enqueue(session);controller.close();}});},
    async setSignals(){},async close(){this.readable=null;}};
  const serial={requestPort:async()=>first,getPorts:async()=>returned.sessions>=3?[p34]:[returned]};
  let wStored=null,xStored=null;
  const receipt=await qualifyAndInstallStockP34(serial,first,image,preflightCarrier,installCarrier,
    {load:()=>wStored,save:value=>{wStored=value;}},{load:()=>xStored,save:value=>{xStored=value;}},
    {resetDelayMs:1000,sleep:async()=>{},attestationTimeoutMs:100});
  assert.equal(receipt.preflight.flashWritePath,false);assert.equal(receipt.install.carrierComplete,true);
  assert.equal(receipt.attestation.profileId,0x05520001);assert.equal(receipt.oneAction,true);assert.equal(receipt.permissionPickers,1);
  assert.equal(JSON.parse(wStored).state,'carrier-complete');assert.equal(JSON.parse(xStored).state,'carrier-complete');
  const writes=first.writes.filter(item=>item.session===2);
  assert.deepEqual(writes.map(item=>item.raw.length),[512,512,512,512,16,496]);
  assert.equal(sha(Buffer.concat(writes.map(item=>Buffer.from(item.raw)))),STOCK_P34_PREFLIGHT.carrierSha256);
  await assert.rejects(()=>preflightStockP34SerialOnly(new FakeStockPort(image,preflightCarrier),image,preflightCarrier,{load:()=>wStored,save:()=>{}}),
    error=>error instanceof StockBootstrapError&&error.code==='already-attempted');
});

test('an exact existing staged file is adopted after full readback, while a sealed carrier claim prevents a repeat',async()=>{
  const image=new Uint8Array(await readFile(new URL('../public/opensynth/usb/opensynth-p34-app1.bin',import.meta.url)));
  const carrier=new Uint8Array(await readFile(new URL('../public/opensynth/usb/stock-carrier-p34-x1.oscarrier',import.meta.url)));
  const adopted=new FakeStockPort(image,carrier,true);let stored=null;
  const receipt=await bootstrapStockToR51SerialOnly(adopted,{r51:image,carrier},{load:()=>stored,save:value=>{stored=value;}});
  assert.equal(receipt.carrierComplete,true);assert.equal(JSON.parse(stored).state,'carrier-complete');
  assert.ok(!adopted.writes.some(item=>item.raw.length>=12&&new DataView(item.raw.buffer,item.raw.byteOffset,item.raw.byteLength).getUint32(8,true)===0x30000002));
  assert.ok(!adopted.writes.some(item=>hexOf(item.raw)==='1260e005fb11000000000003'));
  const claim={format:'opensp-stock-p34x-claim-v1',state:'carrier-started',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    stagePath:STOCK_R51.stagePath,r51Sha256:STOCK_R51.r51Sha256,carrierSha256:STOCK_R51.carrierSha256,retryAllowed:false};
  const port=new FakeStockPort(image,carrier),device=stockDevice();
  await assert.rejects(()=>bootstrapStockToR51(port,device,attestStockHighSpeed(device),{r51:image,carrier},{load:()=>JSON.stringify(claim),save:()=>{}}),
    error=>error instanceof StockBootstrapError&&error.code==='already-attempted');
  assert.equal(port.sessions,0);
});

test('an existing staged file with any changed byte stops before the carrier',async()=>{
  const image=new Uint8Array(await readFile(new URL('../public/opensynth/usb/opensynth-p34-app1.bin',import.meta.url)));
  const changed=image.slice();changed[changed.length-1]^=1;
  const carrier=new Uint8Array(await readFile(new URL('../public/opensynth/usb/stock-carrier-p34-x1.oscarrier',import.meta.url)));
  const port=new FakeStockPort(changed,carrier,true);let stored=null;
  await assert.rejects(()=>bootstrapStockToR51SerialOnly(port,{r51:image,carrier},{load:()=>stored,save:value=>{stored=value;}}),
    error=>error instanceof StockBootstrapError&&error.code==='mismatch');
  assert.equal(stored,null);assert.equal(port.sessions,2);
  assert.equal(port.writes.some(item=>item.session===2),false);
});

test('a claim persistence failure stops before stock import or file creation',async()=>{
  const image=new Uint8Array(await readFile(new URL('../public/opensynth/usb/opensynth-p34-app1.bin',import.meta.url)));
  const carrier=new Uint8Array(await readFile(new URL('../public/opensynth/usb/stock-carrier-p34-x1.oscarrier',import.meta.url)));
  const port=new FakeStockPort(image,carrier),device=stockDevice();
  await assert.rejects(()=>bootstrapStockToR51(port,device,attestStockHighSpeed(device),{r51:image,carrier},
    {load:()=>null,save:()=>{throw new Error('claim unavailable');}}),/claim unavailable/);
  const packets=port.writes.map(item=>item.raw);
  assert.ok(packets.some(raw=>raw.length>=12&&new DataView(raw.buffer,raw.byteOffset,raw.byteLength).getUint32(8,true)===0x30000001));
  assert.ok(!packets.some(raw=>raw.length>=12&&new DataView(raw.buffer,raw.byteOffset,raw.byteLength).getUint32(8,true)===0x30000002));
  assert.ok(!packets.some(raw=>hexOf(raw)==='1260e005fb11000000000003'));
});
