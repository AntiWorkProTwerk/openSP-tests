import {deflateRawSync} from 'node:zlib';

/** A single-entry ZIP matching the layout of Roland's update archive. */
export function zip(name,data,method=8){
  const body=method===8?deflateRawSync(data):data,file=Buffer.from(name);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);
  local.writeUInt32LE(body.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(file.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(method,10);
  central.writeUInt32LE(body.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(file.length,28);
  const offset=local.length+file.length+body.length,end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);
  end.writeUInt32LE(central.length+file.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([local,file,body,central,file,end]);
}

