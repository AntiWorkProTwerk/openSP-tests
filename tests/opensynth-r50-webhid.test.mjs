import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectStockUsbRouteImage} from '../src/lib/opensynth/usb-route.ts';
import {B2_WEBHID,R50_WEBHID,R50WebHidError,attestFreshR50,completeR50OpenSynthInstall,installOpenSynthViaR50,parseB2Status,parseR50Status,r50Command,r50Crc32} from '../src/lib/opensynth/r50-webhid.ts';

const fields=['version','state','error','length','received','crc32','maximum','capabilities','jedec','flash_status','flash_error','programmed','flash_ready','flash_crc32','build_marker'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function candidate(){
  const b2=0x288000,bytes=new Uint8Array(b2+0x1000),view=new DataView(bytes.buffer),h=b2+0x200;
  view.setUint32(0,0xbffef287,true);bytes.set(Buffer.from('SPUAFW10'),h);
  for(const [offset,value] of [[8,2],[12,0x1000],[16,0x80000000],[20,0x400],[24,0x400],[28,0x20243000],
    [32,0x32425053],[36,0x800],[40,0x2023f000],[44,0],[48,0x800],[52,0x800]])view.setUint32(h+offset,value,true);
  view.setUint32(b2+0x400,0x20243000,true);view.setUint32(b2+0x800,0x52420201,true);
  for(let offset=b2+0x804;offset<bytes.length;offset++)bytes[offset]=(offset*29+17)&255;
  inspectStockUsbRouteImage(bytes);return bytes;
}

class FakeR50{
  constructor({productName=R50_WEBHID.productName,alter}={}){
    this.vendorId=R50_WEBHID.vendorId;this.productId=R50_WEBHID.productId;this.productName=productName;
    this.collections=[{usagePage:R50_WEBHID.usagePage,usage:R50_WEBHID.usage}];this.opened=false;this.opens=0;this.closes=0;
    this.sent=[];this.reads=0;this.upload=[];this.expectedCrc=0;this.flash=new Uint8Array();this.alter=alter;
    this.status=Object.fromEntries(fields.map(field=>[field,0]));Object.assign(this.status,{version:2,maximum:R50_WEBHID.maximum,capabilities:1,build_marker:R50_WEBHID.marker});
  }
  async open(){assert.equal(this.opened,false);this.opened=true;this.opens++;}
  async close(){assert.equal(this.opened,true);this.opened=false;this.closes++;}
  async receiveFeatureReport(id){
    assert.equal(this.opened,true);assert.equal(id,0);this.reads++;
    const current={...this.status};this.alter?.('status',current,this);
    const bytes=new Uint8Array(64);bytes.set(Buffer.from('SP50'));const view=new DataView(bytes.buffer);
    fields.forEach((field,index)=>view.setUint32(4+index*4,current[field]>>>0,true));return view;
  }
  async sendFeatureReport(id,value){
    assert.equal(this.opened,true);assert.equal(id,0);const bytes=new Uint8Array(value);assert.equal(bytes.length,64);this.sent.push(bytes.slice());
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),opcode=bytes[0],count=bytes[2],argument=view.getUint32(4,true),payload=bytes.subarray(8,8+count);
    this.alter?.('command',{opcode,count,argument},this);
    if(opcode===5)Object.assign(this.status,{jedec:0xc22016,flash_status:0x40,flash_ready:1});
    else if(opcode===1){this.expectedCrc=view.getUint32(8,true);this.upload=[];Object.assign(this.status,{state:1,length:argument,received:0,crc32:0,programmed:0,flash_crc32:0});}
    else if(opcode===2){assert.equal(argument,this.upload.length);this.upload.push(...payload);this.status.received=this.upload.length;}
    else if(opcode===3){assert.equal(this.upload.length,this.status.length);this.status.crc32=r50Crc32(Uint8Array.from(this.upload));assert.equal(this.status.crc32,this.expectedCrc);this.status.state=2;}
    else if(opcode===6){assert.equal(argument,(this.expectedCrc^0x46534c48)>>>0);const end=Math.ceil(this.upload.length/4096)*4096;this.flash=new Uint8Array(end).fill(255);this.flash.set(this.upload);Object.assign(this.status,{state:6,programmed:end,flash_crc32:this.expectedCrc});}
    else throw new Error(`unexpected opcode ${opcode}`);
  }
}

class FakeB2{
  constructor({productName=B2_WEBHID.productName,alter}={}){
    this.vendorId=B2_WEBHID.vendorId;this.productId=B2_WEBHID.productId;this.productName=productName;
    this.collections=[{usagePage:B2_WEBHID.usagePage,usage:B2_WEBHID.usage}];this.opened=false;this.opens=0;this.closes=0;
    this.sent=[];this.reads=0;this.alter=alter;this.status=Object.fromEntries(fields.map(field=>[field,0]));
    Object.assign(this.status,{version:2,maximum:B2_WEBHID.maximum,capabilities:1,build_marker:B2_WEBHID.marker});
  }
  async open(){assert.equal(this.opened,false);this.opened=true;this.opens++;}
  async close(){assert.equal(this.opened,true);this.opened=false;this.closes++;}
  async receiveFeatureReport(id){
    assert.equal(this.opened,true);assert.equal(id,0);this.reads++;const current={...this.status};this.alter?.(current,this);
    const bytes=new Uint8Array(64);bytes.set(Buffer.from('SP17'));const view=new DataView(bytes.buffer);
    fields.forEach((field,index)=>view.setUint32(4+index*4,current[field]>>>0,true));return view;
  }
  async sendFeatureReport(){this.sent.push(true);throw new Error('completion attestation must not write');}
}

async function rejects(action,code){
  await assert.rejects(action,error=>{assert.ok(error instanceof R50WebHidError);assert.equal(error.code,code);return true;});
}

test('R50 WebHID command and CRC use the 64-byte payload contract',()=>{
  assert.equal(r50Crc32(Buffer.from('123456789')),0xcbf43926);
  const report=r50Command(2,0x12345678,Uint8Array.of(9,8),2);
  assert.equal(report.length,64);assert.deepEqual([...report.subarray(0,10)],[2,1,2,0,0x78,0x56,0x34,0x12,9,8]);
  assert.throws(()=>r50Command(2,0,new Uint8Array(57)),{code:'payload-bounds'});
  assert.throws(()=>parseR50Status(new DataView(new ArrayBuffer(65))),{code:'report-framing'});
});

test('fresh R50 attestation performs two reads, zero writes and closes the handle',async()=>{
  const fake=new FakeR50(),attestation=await attestFreshR50(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  assert.equal(attestation.status.state,0);assert.equal(attestation.statusReads,2);assert.equal(attestation.featureReportsSent,0);
  assert.equal(fake.reads,2);assert.equal(fake.sent.length,0);assert.equal(fake.opens,1);assert.equal(fake.closes,1);assert.equal(fake.opened,false);
  await rejects(()=>attestFreshR50(new FakeR50(),{powerCycleConfirmed:false,freshConnectionConfirmed:true}),'confirmation-required');
  await rejects(()=>attestFreshR50(new FakeR50({productName:'Roland SP-404MKII'}),{powerCycleConfirmed:true,freshConnectionConfirmed:true}),'device-identity');
});

test('guarded R50 WebHID flow uploads exact B2 bytes, commits once and reopens for two terminal reads',async()=>{
  const bytes=candidate(),fake=new FakeR50(),attestation=await attestFreshR50(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true}),progress=[];
  const receipt=await installOpenSynthViaR50(fake,bytes,{expectedSha256:sha(bytes),attestation,sleep:async()=>{},onProgress:event=>progress.push(event)});
  assert.deepEqual(fake.flash.subarray(0,bytes.length),bytes);assert.ok(fake.flash.subarray(bytes.length).every(value=>value===255));
  assert.equal(fake.sent.filter(report=>report[0]===6).length,1);assert.equal(fake.sent.filter(report=>report[0]===2).length,Math.ceil(bytes.length/56));
  assert.equal(receipt.transport.featureReportsSent,Math.ceil(bytes.length/56)+4);assert.equal(receipt.terminal.state,6);
  assert.equal(receipt.flashWriteVerified,true);assert.equal(receipt.installationComplete,false);assert.deepEqual(receipt.remainingChecks,['normal OpenSynth reboot','cold-DEL B2 return']);
  assert.equal(fake.opens,3);assert.equal(fake.closes,3);assert.equal(fake.opened,false);
  assert.deepEqual([...new Set(progress.map(event=>event.phase))],['preflight','upload','ram-verified','commit','flash-verified','separate-status']);
});

test('wrong image, stale writer and failed profile stop before BEGIN',async()=>{
  const original=candidate();
  const wrong=original.slice();wrong[0x288220]^=1;
  let fake=new FakeR50(),attestation=await attestFreshR50(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  await assert.rejects(()=>installOpenSynthViaR50(fake,wrong,{expectedSha256:sha(wrong),attestation}),TypeError);assert.equal(fake.sent.length,0);
  fake=new FakeR50();attestation=await attestFreshR50(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});fake.status.state=6;
  await rejects(()=>installOpenSynthViaR50(fake,original,{expectedSha256:sha(original),attestation}),'writer-not-fresh');assert.equal(fake.sent.length,0);
  fake=new FakeR50({alter:(kind,status)=>{if(kind==='status'&&status.flash_ready===1)status.jedec=0xef4016;}});
  attestation=await attestFreshR50(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  await rejects(()=>installOpenSynthViaR50(fake,original,{expectedSha256:sha(original),attestation,sleep:async()=>{}}),'chip-profile');
  assert.deepEqual(fake.sent.map(report=>report[0]),[5]);
});

test('post-COMMIT failure is marked uncertain and never retries COMMIT',async()=>{
  const bytes=candidate(),fake=new FakeR50({alter:(kind,status,device)=>{if(kind==='status'&&device.status.state===6)status.flash_crc32^=1;}});
  const attestation=await attestFreshR50(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  await assert.rejects(()=>installOpenSynthViaR50(fake,bytes,{expectedSha256:sha(bytes),attestation,sleep:async()=>{}}),error=>{
    assert.ok(error instanceof R50WebHidError);assert.equal(error.code,'flash-result');assert.equal(error.commitSent,true);return true;
  });
  assert.equal(fake.sent.filter(report=>report[0]===6).length,1);assert.equal(fake.opened,false);
});

test('normal screen plus fresh cold-DEL B2 attestation completes the install without writes',async()=>{
  const bytes=candidate(),r50=new FakeR50(),attestation=await attestFreshR50(r50,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  const receipt=await installOpenSynthViaR50(r50,bytes,{expectedSha256:sha(bytes),attestation,sleep:async()=>{}}),b2=new FakeB2();
  const complete=await completeR50OpenSynthInstall(b2,receipt,{normalPowerCycleConfirmed:true,normalIdentity:'openSynthP29',
    coldDelPowerCycleConfirmed:true,delHeldConfirmed:true,freshConnectionConfirmed:true});
  assert.equal(complete.installationComplete,true);assert.equal(complete.normalBoot.identity,'openSynthP29');
  assert.equal(complete.coldDelBoot.status.build_marker,0x52420201);assert.equal(complete.coldDelBoot.statusReads,2);
  assert.equal(complete.coldDelBoot.featureReportsSent,0);assert.equal(b2.reads,2);assert.equal(b2.sent.length,0);
  assert.equal(b2.opens,1);assert.equal(b2.closes,1);assert.equal(b2.opened,false);
});

test('completion rejects missing reboot evidence and stale or wrong B2 before it can pass',async()=>{
  const bytes=candidate(),r50=new FakeR50(),attestation=await attestFreshR50(r50,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  const receipt=await installOpenSynthViaR50(r50,bytes,{expectedSha256:sha(bytes),attestation,sleep:async()=>{}});
  const confirmation={normalPowerCycleConfirmed:true,normalIdentity:'openSynthP29',coldDelPowerCycleConfirmed:true,delHeldConfirmed:true,freshConnectionConfirmed:true};
  await rejects(()=>completeR50OpenSynthInstall(new FakeB2(),receipt,{...confirmation,normalIdentity:'openSynthP28'}),'normal-boot');
  await rejects(()=>completeR50OpenSynthInstall(new FakeB2({productName:'SP404 USB BRIDGE B1'}),receipt,confirmation),'device-identity');
  const stale=new FakeB2();stale.status.state=6;
  await rejects(()=>completeR50OpenSynthInstall(stale,receipt,confirmation),'writer-not-fresh');assert.equal(stale.sent.length,0);
  const changed=new FakeB2({alter:(status,device)=>{if(device.reads===2)status.flash_status=0x40;}});
  await rejects(()=>completeR50OpenSynthInstall(changed,receipt,confirmation),'status-changed');assert.equal(changed.sent.length,0);
  assert.throws(()=>parseB2Status(new DataView(new ArrayBuffer(64))),{code:'status-signature'});
});

test('module never discovers navigator.hid or exposes a public device picker',async()=>{
  const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../src/lib/opensynth/r50-webhid.ts',import.meta.url),'utf8'));
  assert.equal(source.includes('navigator.hid'),false);assert.equal(source.includes('requestDevice'),false);
});
