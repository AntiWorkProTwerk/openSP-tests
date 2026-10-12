import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectStockUsbRouteImage} from '../src/lib/opensynth/usb-route.ts';
import {R51_WEBHID,R51WebHidError,attestFreshR51,installApp1ViaR51,installOpenSynthViaR51,parseR51Status,r51Command,r51Crc32}
  from '../src/lib/opensynth/r51-webhid.ts';
import {BrowserHidError,getAuthorizedR51Writer,requestR51Writer} from '../src/lib/opensynth/browser-hid.ts';

const fields=['version','state','error','length','received','crc32','maximum','capabilities','jedec','flash_status',
  'flash_error','programmed','flash_ready','flash_crc32','build_marker'];
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

class FakeR51{
  constructor({productName=R51_WEBHID.productName,alter}={}){
    this.vendorId=R51_WEBHID.vendorId;this.productId=R51_WEBHID.productId;this.productName=productName;
    this.collections=[{usagePage:R51_WEBHID.usagePage,usage:R51_WEBHID.usage}];this.opened=false;this.opens=0;this.closes=0;
    this.sent=[];this.reads=0;this.upload=[];this.expectedCrc=0;this.flash=new Uint8Array();this.alter=alter;
    this.armed=false;this.resetRequested=false;
    this.status=Object.fromEntries(fields.map(field=>[field,0]));
    Object.assign(this.status,{version:2,maximum:R51_WEBHID.maximum,capabilities:3,build_marker:R51_WEBHID.marker});
  }
  async open(){assert.equal(this.opened,false);this.opened=true;this.opens++;}
  async close(){assert.equal(this.opened,true);this.opened=false;this.closes++;}
  async receiveFeatureReport(id){
    assert.equal(this.opened,true);assert.equal(id,0);this.reads++;
    const current={...this.status};this.alter?.('status',current,this);
    const bytes=new Uint8Array(64);bytes.set(Buffer.from('SP51'));const view=new DataView(bytes.buffer);
    fields.forEach((field,index)=>view.setUint32(4+index*4,current[field]>>>0,true));return view;
  }
  async sendFeatureReport(id,value){
    assert.equal(this.opened,true);assert.equal(id,0);const bytes=new Uint8Array(value);assert.equal(bytes.length,64);this.sent.push(bytes.slice());
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),opcode=bytes[0],count=bytes[2];
    const argument=view.getUint32(4,true),payload=bytes.subarray(8,8+count);this.alter?.('command',{opcode,count,argument},this);
    if(opcode===5)Object.assign(this.status,{jedec:0xc22016,flash_status:0x40,flash_ready:1});
    else if(opcode===1){this.expectedCrc=view.getUint32(8,true);this.upload=[];Object.assign(this.status,{state:1,length:argument,received:0,crc32:0,programmed:0,flash_crc32:0});}
    else if(opcode===2){assert.equal(argument,this.upload.length);this.upload.push(...payload);this.status.received=this.upload.length;}
    else if(opcode===3){assert.equal(this.upload.length,this.status.length);this.status.crc32=r51Crc32(Uint8Array.from(this.upload));assert.equal(this.status.crc32,this.expectedCrc);this.status.state=2;}
    else if(opcode===6){assert.equal(argument,(this.expectedCrc^0x46534c48)>>>0);const end=Math.ceil(this.upload.length/4096)*4096;this.flash=new Uint8Array(end).fill(255);this.flash.set(this.upload);Object.assign(this.status,{state:6,programmed:end,flash_crc32:this.expectedCrc});}
    else if(opcode===13){assert.equal(argument,(this.expectedCrc^0x52535141)>>>0);this.armed=true;}
    else if(opcode===14){assert.equal(this.armed,true);assert.equal(argument,(this.expectedCrc^0x52535143)>>>0);this.resetRequested=true;}
    else throw new Error(`unexpected opcode ${opcode}`);
  }
}

async function rejects(action,code){
  await assert.rejects(action,error=>{assert.ok(error instanceof R51WebHidError);assert.equal(error.code,code);return true;});
}

test('R51 WebHID command and CRC use the 64-byte payload contract',()=>{
  assert.equal(r51Crc32(Buffer.from('123456789')),0xcbf43926);
  const report=r51Command(2,0x12345678,Uint8Array.of(9,8),2);
  assert.equal(report.length,64);assert.deepEqual([...report.subarray(0,10)],[2,1,2,0,0x78,0x56,0x34,0x12,9,8]);
  assert.throws(()=>r51Command(2,0,new Uint8Array(57)),{code:'payload-bounds'});
  assert.throws(()=>parseR51Status(new DataView(new ArrayBuffer(65))),{code:'report-framing'});
});

test('fresh R51 attestation performs two reads and no writes',async()=>{
  const fake=new FakeR51(),attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  assert.equal(attestation.bootEvidence,'power-cycle');assert.equal(attestation.status.state,0);assert.equal(attestation.statusReads,2);
  assert.equal(attestation.featureReportsSent,0);assert.equal(fake.reads,2);assert.equal(fake.sent.length,0);
  assert.equal(fake.opens,1);assert.equal(fake.closes,1);assert.equal(fake.opened,false);
  await rejects(()=>attestFreshR51(new FakeR51(),{powerCycleConfirmed:false,freshConnectionConfirmed:true}),'confirmation-required');
  await rejects(()=>attestFreshR51(new FakeR51({productName:'Roland SP-404MKII'}),{powerCycleConfirmed:true,freshConnectionConfirmed:true}),'device-identity');
});

test('fresh R51 attestation records the completed stock carrier',async()=>{
  const fake=new FakeR51(),attestation=await attestFreshR51(fake,{powerCycleConfirmed:false,stockCarrierConfirmed:true,freshConnectionConfirmed:true});
  assert.equal(attestation.bootEvidence,'stock-carrier');assert.equal(attestation.powerCycleConfirmed,false);
  assert.equal(attestation.stockCarrierConfirmed,true);assert.equal(fake.sent.length,0);
});

test('browser picker requests only the exact R51 collection and performs no I/O',async()=>{
  const fake=new FakeR51();let options;
  const selected=await requestR51Writer({requestDevice:async value=>{options=value;return [fake];}});
  assert.equal(selected,fake);assert.equal(fake.opens,0);assert.equal(fake.reads,0);assert.equal(fake.sent.length,0);
  assert.deepEqual(options,{filters:[{vendorId:0xcafe,productId:0x404f,usagePage:0xff00,usage:1}]});
  await assert.rejects(()=>requestR51Writer(undefined),error=>error instanceof BrowserHidError&&error.code==='unsupported');
  await assert.rejects(()=>requestR51Writer({requestDevice:async()=>[]}),error=>error instanceof BrowserHidError&&error.code==='selection');
});

test('an already-authorized exact R51 is reused without a picker or device I/O',async()=>{
  const fake=new FakeR51();let pickerCalls=0;
  const hid={getDevices:async()=>[fake],requestDevice:async()=>{pickerCalls++;return [fake];}};
  assert.equal(await getAuthorizedR51Writer(hid),fake);assert.equal(pickerCalls,0);
  assert.equal(fake.opens,0);assert.equal(fake.reads,0);assert.equal(fake.sent.length,0);
  assert.equal(await getAuthorizedR51Writer({requestDevice:hid.requestDevice}),undefined);
  await assert.rejects(()=>getAuthorizedR51Writer({...hid,getDevices:async()=>[fake,fake]}),
    error=>error instanceof BrowserHidError&&error.code==='selection');
});

test('R51 verifies APP1, arms reset, checks status again and requests one reset',async()=>{
  const bytes=candidate(),fake=new FakeR51(),attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true}),progress=[],journal=[];
  assert.equal(installOpenSynthViaR51,installApp1ViaR51);
  const receipt=await installApp1ViaR51(fake,bytes,{expectedSha256:sha(bytes),attestation,sleep:async()=>{},
    onBeforeCommit:evidence=>{assert.equal(fake.sent.filter(report=>report[0]===6).length,0);journal.push(evidence);},
    onProgress:event=>progress.push(event)});
  assert.deepEqual(fake.flash.subarray(0,bytes.length),bytes);assert.ok(fake.flash.subarray(bytes.length).every(value=>value===255));
  assert.equal(fake.sent.filter(report=>report[0]===6).length,1);assert.equal(fake.sent.filter(report=>report[0]===13).length,1);
  assert.equal(fake.sent.filter(report=>report[0]===14).length,1);assert.equal(fake.resetRequested,true);
  assert.equal(receipt.transport.featureReportsSent,Math.ceil(bytes.length/56)+6);assert.equal(receipt.terminal.state,6);
  assert.equal(receipt.flashWriteVerified,true);assert.equal(receipt.guardedReset.featureReportsSent,2);
  assert.equal(receipt.remainingCheck,'normal Roland USB return');
  assert.equal(fake.opens,3);assert.equal(fake.closes,3);assert.equal(fake.opened,false);
  assert.deepEqual([...new Set(progress.map(event=>event.phase))],
    ['preflight','upload','ram-verified','commit','flash-verified','separate-status','reset-armed','reset-requested']);
  assert.deepEqual(journal,[{imageSha256:sha(bytes),crc32:r51Crc32(bytes),bytes:bytes.length,
    paddedBytes:Math.ceil(bytes.length/4096)*4096,sectors:Math.ceil(bytes.length/4096)}]);
});

test('a failed pre-COMMIT journal stops before the only flash command',async()=>{
  const bytes=candidate(),fake=new FakeR51(),attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  await rejects(()=>installApp1ViaR51(fake,bytes,{expectedSha256:sha(bytes),attestation,sleep:async()=>{},
    onBeforeCommit:()=>{throw new Error('storage unavailable');}}),'journal-failure');
  assert.equal(fake.sent.filter(report=>report[0]===6).length,0);
  assert.equal(fake.status.state,2);assert.equal(fake.opened,false);
});

test('wrong image, stale writer and failed chip profile stop before BEGIN',async()=>{
  const original=candidate(),wrong=original.slice();wrong[0x288220]^=1;
  let fake=new FakeR51(),attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  await assert.rejects(()=>installOpenSynthViaR51(fake,wrong,{expectedSha256:sha(wrong),attestation}),TypeError);assert.equal(fake.sent.length,0);
  fake=new FakeR51();attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});fake.status.state=6;
  await rejects(()=>installOpenSynthViaR51(fake,original,{expectedSha256:sha(original),attestation}),'writer-not-fresh');assert.equal(fake.sent.length,0);
  fake=new FakeR51({alter:(kind,status)=>{if(kind==='status'&&status.flash_ready===1)status.jedec=0xef4016;}});
  attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  await rejects(()=>installOpenSynthViaR51(fake,original,{expectedSha256:sha(original),attestation,sleep:async()=>{}}),'chip-profile');
  assert.deepEqual(fake.sent.map(report=>report[0]),[5]);
});

test('post-COMMIT failure never retries COMMIT or reaches the reset commands',async()=>{
  const bytes=candidate(),fake=new FakeR51({alter:(kind,status,device)=>{if(kind==='status'&&device.status.state===6)status.flash_crc32^=1;}});
  const attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  await assert.rejects(()=>installOpenSynthViaR51(fake,bytes,{expectedSha256:sha(bytes),attestation,sleep:async()=>{}}),error=>{
    assert.ok(error instanceof R51WebHidError);assert.equal(error.code,'flash-result');assert.equal(error.commitSent,true);return true;
  });
  assert.equal(fake.sent.filter(report=>report[0]===6).length,1);assert.equal(fake.sent.filter(report=>report[0]===13).length,0);
  assert.equal(fake.sent.filter(report=>report[0]===14).length,0);assert.equal(fake.opened,false);
});

test('a changed terminal status after reset arm blocks the reset request',async()=>{
  const bytes=candidate(),fake=new FakeR51({alter:(kind,status,device)=>{
    if(kind==='status'&&device.armed)status.flash_crc32^=1;
  }}),attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  await assert.rejects(()=>installOpenSynthViaR51(fake,bytes,{expectedSha256:sha(bytes),attestation,sleep:async()=>{}}),error=>{
    assert.ok(error instanceof R51WebHidError);assert.equal(error.code,'flash-result');assert.equal(error.commitSent,true);return true;
  });
  assert.equal(fake.sent.filter(report=>report[0]===13).length,1);assert.equal(fake.sent.filter(report=>report[0]===14).length,0);
  assert.equal(fake.resetRequested,false);assert.equal(fake.opened,false);
});

test('a checksum mismatch and malformed saved attestation fail before device I/O',async()=>{
  const bytes=candidate(),fake=new FakeR51(),attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  await rejects(()=>installApp1ViaR51(fake,bytes,{expectedSha256:'0'.repeat(64),attestation}),'image-hash');
  const malformed=attestation.statusHex.slice(0,32)+'gg'+attestation.statusHex.slice(34);
  await rejects(()=>installApp1ViaR51(fake,bytes,{expectedSha256:sha(bytes),attestation:{...attestation,
    statusHex:malformed,confirmationStatusHex:malformed}}),'attestation-status');
  assert.equal(fake.opens,1);assert.equal(fake.sent.length,0);
});

test('probe timeout stops before BEGIN',async()=>{
  const bytes=candidate(),fake=new FakeR51({alter:(kind,status)=>{if(kind==='status')status.flash_ready=0;}});
  const attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true}),delays=[];
  await rejects(()=>installApp1ViaR51(fake,bytes,{expectedSha256:sha(bytes),attestation,maximumProbePolls:2,
    sleep:async milliseconds=>{delays.push(milliseconds);}}),'probe-timeout');
  assert.deepEqual(fake.sent.map(report=>report[0]),[5]);assert.deepEqual(delays,[50,50]);assert.equal(fake.opened,false);
});

test('an upload checkpoint mismatch stops before VERIFY and COMMIT',async()=>{
  const bytes=candidate(),fake=new FakeR51({alter:(kind,status)=>{
    if(kind==='status'&&status.state===1)status.received--;
  }}),attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  await rejects(()=>installApp1ViaR51(fake,bytes,{expectedSha256:sha(bytes),attestation,sleep:async()=>{}}),'chunk-result');
  assert.equal(fake.sent.some(report=>report[0]===3||report[0]===6),false);assert.equal(fake.opened,false);
});

test('invalid post-COMMIT status contracts preserve commit uncertainty',async()=>{
  const bytes=candidate();
  for(const phase of ['commit','separate-status','reset-armed']){
    const fake=new FakeR51({alter:(kind,status,device)=>{
      if(kind==='status'&&status.state===6&&
        ((phase==='commit')||(phase==='separate-status'&&device.opens===3)||(phase==='reset-armed'&&device.armed)))status.version=1;
    }}),attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
    await assert.rejects(()=>installApp1ViaR51(fake,bytes,{expectedSha256:sha(bytes),attestation,sleep:async()=>{}}),error=>{
      assert.ok(error instanceof R51WebHidError);assert.equal(error.phase,phase);
      assert.equal(error.code,'writer-contract');assert.equal(error.commitSent,true);return true;
    });
    assert.equal(fake.sent.filter(report=>report[0]===6).length,1);
    assert.equal(fake.sent.some(report=>report[0]===14),false);assert.equal(fake.opened,false);
  }
});

test('flash timeout preserves COMMIT evidence and never requests reset',async()=>{
  const bytes=candidate(),fake=new FakeR51({alter:(kind,status)=>{if(kind==='status'&&status.state===6)status.state=5;}});
  const attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  await assert.rejects(()=>installApp1ViaR51(fake,bytes,{expectedSha256:sha(bytes),attestation,maximumFlashPolls:2,sleep:async()=>{}}),error=>{
    assert.equal(error.code,'flash-timeout');assert.equal(error.commitSent,true);return true;
  });
  assert.equal(fake.sent.filter(report=>report[0]===6).length,1);
  assert.equal(fake.sent.some(report=>report[0]===13||report[0]===14),false);assert.equal(fake.opened,false);
});

test('a transport failure while reading the armed status blocks reset and preserves COMMIT evidence',async()=>{
  const bytes=candidate(),fake=new FakeR51(),read=fake.receiveFeatureReport.bind(fake);
  fake.receiveFeatureReport=async id=>{if(fake.armed)throw new Error('disconnected');return read(id);};
  const attestation=await attestFreshR51(fake,{powerCycleConfirmed:true,freshConnectionConfirmed:true});
  await assert.rejects(()=>installApp1ViaR51(fake,bytes,{expectedSha256:sha(bytes),attestation,sleep:async()=>{}}),error=>{
    assert.equal(error.phase,'reset-armed');assert.equal(error.code,'transport-read');assert.equal(error.commitSent,true);return true;
  });
  assert.equal(fake.sent.filter(report=>report[0]===13).length,1);
  assert.equal(fake.sent.some(report=>report[0]===14),false);assert.equal(fake.opened,false);
});

test('module does not discover navigator.hid or expose a device picker',async()=>{
  const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../src/lib/opensynth/r51-webhid.ts',import.meta.url),'utf8'));
  assert.equal(source.includes('navigator.hid'),false);assert.equal(source.includes('requestDevice'),false);
});
