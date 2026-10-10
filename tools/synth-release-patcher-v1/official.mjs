import {createHash} from 'node:crypto';

export const hash = body => createHash('sha256').update(body).digest('hex');
export const OFFICIAL_INPUTS = Object.freeze([
  Object.freeze({kind:'official-v552-app1',bytes:2652672,sha256:'4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80'}),
  Object.freeze({kind:'official-v552-zip',bytes:1966465,sha256:'ffe5cbbbc971383bcbef34959ea32cb36470d3c9eadad296f52bc4ea6a3cb3c5'}),
]);

/** Authenticate the complete supplied input before a compiler or output exists. */
export function checkedOfficialInput(raw) {
  const sha256=hash(raw),pin=OFFICIAL_INPUTS.find(value=>value.bytes===raw.length&&value.sha256===sha256);
  if(!pin)throw Error('Supply the unchanged official Roland v5.52 ZIP or SP404MKII_APP1.bin. This input has no reviewed identity.');
  return {...pin,official_app1_bytes:OFFICIAL_INPUTS[0].bytes,official_app1_sha256:OFFICIAL_INPUTS[0].sha256};
}

export function crc32(raw) {
  let crc=0xffffffff;
  for(const byte of raw){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
