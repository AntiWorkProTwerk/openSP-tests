import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import usb from '../src/content/releases/synth-usb.json' with {type:'json'};
import patch from '../src/content/releases/synth-patch.json' with {type:'json'};

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return ((crc^0xffffffff)>>>0).toString(16).toUpperCase().padStart(8,'0');
}
const asset=item=>readFile(new URL(`../public${item.url}`,import.meta.url));

test('published R51 route assets match their pinned byte identities',async()=>{
  assert.equal(usb.format,'opensp-stock-r51-browser-route-v1');
  const [carrier,r51,app1]=await Promise.all([asset(usb.carrier),asset(usb.r51),asset(usb.app1)]);
  for(const [item,bytes] of [[usb.carrier,carrier],[usb.r51,r51],[usb.app1,app1]]){
    assert.equal(bytes.length,item.bytes);assert.equal(sha256(bytes),item.sha256);
    if(item.crc32)assert.equal(crc32(bytes),item.crc32);
  }
  assert.equal(usb.carrier.bytes,26112);assert.equal(usb.carrier.packets,51);
  assert.equal(usb.carrier.sha256,'c082ec3733096a99ba55a7aada19388eea1ed0eef2f2d7ff148c5add99669831');
  assert.equal(usb.carrier.bytes,usb.carrier.packets*usb.carrier.packetBytes);
  assert.equal(usb.carrier.packetBytes,512);assert.equal(usb.carrier.alignmentSafeFrames,3);
  assert.deepEqual(usb.carrier.triggerWrites,[512]);assert.equal(usb.carrier.highSpeedRequired,true);
  assert.equal(usb.r51.bytes,18500);
  assert.equal(usb.r51.sha256,'6e72ed9487089f3014ccd161f3600eeb85979285890437cd34be4b51fda4ef26');
  assert.equal(usb.stock.stagePath,'/SP404REMOTE///ROLAND\\SP-404MKII/OS51B87E.BIN');
  assert.equal(usb.app1.bytes,patch.output.bytes);assert.equal(usb.app1.sha256,patch.output.sha256);
  assert.equal(usb.app1.paddedBytes,Math.ceil(app1.length/4096)*4096);
  assert.equal(usb.app1.sectors,usb.app1.paddedBytes/4096);assert.equal(usb.app1.flashOffset,0x80000);
  assert.deepEqual(usb.writer.resetOpcodes,[13,14]);assert.equal(usb.writer.buildMarker,0x52650001);
  assert.equal(usb.writer.statusSignature,'SP51');assert.equal(usb.writer.statusVersion,2);
  assert.equal(usb.retryAllowed,false);
});

test('published P34 APP1 retains the exact qualified image identity',async()=>{
  const app1=await asset(usb.app1);
  assert.equal(app1.length,2830672);
  assert.equal(sha256(app1),'00299601316516283cdda08b66893cee09d0375f9719759c9e13917503b5e864');
  assert.equal(crc32(app1),'2B892D87');
});
