import assert from 'node:assert/strict';
import {B2} from './model.ts';
import {crc32} from './data.ts';

// Host protocol model only. It has no physical-device or flash authority.
export class ModelDevice {
  vendorId=B2.vendorId;productId=B2.productId;productName=B2.productName;
  collections=[{usagePage:B2.usagePage,usage:B2.usage,featureReports:[{reportId:0,items:[{reportSize:8,reportCount:64}]}]}];
  opened=false;opens=0;closes=0;commands=[];state=0;length=0;received=0;crc=0;programmed=0;flashCrc=0;
  jedec=0;flashStatus=0;ready=0;image=new Uint8Array();fault='';
  async open(){this.opened=true;this.opens++;}
  async close(){this.opened=false;this.closes++;}
  async sendFeatureReport(id,body){
    assert.equal(id,0);const bytes=new Uint8Array(body);assert.equal(bytes.length,64);
    const opcode=bytes[0],length=bytes[2],arg=new DataView(bytes.buffer,bytes.byteOffset).getUint32(4,true);
    this.commands.push(opcode);
    if(opcode===5){this.jedec=this.fault==='profile'?0xdead:B2.jedec;this.flashStatus=B2.flashStatus;this.ready=1;}
    else if(opcode===1){this.state=1;this.length=arg;this.image=new Uint8Array(arg);this.crc=new DataView(bytes.buffer,bytes.byteOffset).getUint32(8,true);}
    else if(opcode===2){assert.equal(arg,this.received);assert(length>0&&length<=56);this.image.set(bytes.subarray(8,8+length),arg);this.received+=length;}
    else if(opcode===3){this.state=2;this.crc=crc32(this.image);if(this.fault==='ram-crc')this.crc^=1;}
    else if(opcode===6){
      assert.equal(arg,(this.crc^0x46534c48)>>>0);
      if(this.fault==='commit-timeout')return new Promise(()=>{});
      this.state=6;this.programmed=Math.ceil(this.length/4096)*4096;this.flashCrc=this.crc;
      if(this.fault==='short-padding')this.programmed-=4096;
    }else assert.fail('Unbounded opcode exposed');
  }
  async receiveFeatureReport(id){
    assert.equal(id,0);assert(this.opened);
    const bytes=new Uint8Array(64);bytes.set([0x53,0x50,0x31,0x37]);
    const fields=[2,this.state,0,this.length,this.received,this.state===1?0:this.crc,B2.maximum,1,this.jedec,this.flashStatus,0,this.programmed,this.ready,this.flashCrc,B2.marker];
    if(this.fault==='separate-status'&&this.opens===2)fields[13]^=1;
    if(this.fault==='malformed-body')return new DataView(new ArrayBuffer(65));
    const view=new DataView(bytes.buffer);fields.forEach((value,index)=>view.setUint32(4+4*index,value,true));return view;
  }
}
export class ModelHid {
  device;calls=[];listener;
  constructor(device=new ModelDevice()){this.device=device;}
  async requestDevice(options){this.calls.push(options);return [this.device];}
  addEventListener(type,listener){assert.equal(type,'disconnect');this.listener=listener;}
  removeEventListener(type,listener){assert.equal(type,'disconnect');if(this.listener===listener)this.listener=undefined;}
  disconnect(){this.listener?.({device:this.device});}
}
