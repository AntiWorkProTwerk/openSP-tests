import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildFirmware,extractEntry,parsePatch,PatchError} from '../src/lib/opensynth/patcher.ts';
import {inspectStockUsbRouteImage} from '../src/lib/opensynth/usb-route.ts';
import {diff,encode,indexOf,storedRuns,officialWindowsInRuns,hashAt,MIN_COPY,FORMAT} from '../tools/opensynth-patcher/make-patch.mjs';
import {zip} from './opensynth-zip.mjs';

const sha=body=>createHash('sha256').update(body).digest('hex');
const u8=body=>new Uint8Array(body);

/** Synthetic official/target pair; no Roland bytes are involved. */
function fixture(){
  const official=randomBytes(64*1024);
  const target=Buffer.concat([official.subarray(0,20000),Buffer.from('openSynth original code'.repeat(40)),official.subarray(30000,50000),official.subarray(5000,9000),randomBytes(777),official.subarray(60000,60009)]);
  const header={format:FORMAT,zipEntry:'SP404MKII_APP1.bin',input:{name:'SP404MKII_APP1.bin',bytes:official.length,sha256:sha(official)},output:{name:'SP404MKII_APP1.bin',bytes:target.length,sha256:sha(target)}};
  const patch=encode(header,diff(official,target));
  return {official,target,patch,pin:sha(patch)};
}

test('rebuilds the target from a raw APP1, a deflated ZIP and a stored ZIP',async()=>{
  const {official,target,patch,pin}=fixture();
  for(const input of [official,zip('sp404mk2_sys_v552/SP404MKII_APP1.bin',official),zip('x/SP404MKII_APP1.bin',official,0)]){
    const stages=new Set();
    const result=await buildFirmware(u8(patch),u8(input),pin,stage=>stages.add(stage));
    assert.deepEqual(Buffer.from(result.output),target);
    assert.equal(result.sha256,sha(target));
    assert.equal(result.name,'SP404MKII_APP1.bin');
    assert.deepEqual([...stages],['verifying','patching','checking']);
  }
});

test('moved and short official runs are copied, never stored',()=>{
  const {official,patch}=fixture();
  const runs=storedRuns(patch);
  assert.equal(officialWindowsInRuns(indexOf(official),runs),0);
  // Only the original text and the random tail are stored.
  assert.ok(runs.reduce((n,r)=>n+r.length,0)<=40*23+777);
});

test('refuses a wrong file with a visitor-facing message',async()=>{
  const {official,patch,pin}=fixture();
  const changed=Buffer.from(official);changed[100]^=1;
  const refused=code=>error=>error instanceof PatchError&&error.code===code;
  await assert.rejects(buildFirmware(u8(patch),u8(changed),pin),refused('wrong-file'));
  await assert.rejects(buildFirmware(u8(patch),u8(zip('x/SP404MKII_APP1.bin',changed)),pin),refused('wrong-file'));
  await assert.rejects(buildFirmware(u8(patch),u8(official.subarray(1)),pin),refused('wrong-file'));
  await assert.rejects(buildFirmware(u8(patch),u8(zip('x/SP404MKII_APP0.bin',official)),pin),refused('zip-entry'));
  await assert.rejects(extractEntry(u8(zip('x/SP404MKII_APP1.bin',official).subarray(0,500)),'SP404MKII_APP1.bin'),PatchError);
});

test('refuses a damaged or substituted patch instead of saving a wrong file',async()=>{
  const {official,patch,pin}=fixture();
  await assert.rejects(buildFirmware(u8(patch),u8(official),'0'.repeat(64)),error=>error.code==='patch-damaged');
  const tampered=Buffer.from(patch),run=storedRuns(tampered)[0];run[0]^=1;
  await assert.rejects(buildFirmware(u8(tampered),u8(official),sha(tampered)),error=>error.code==='output-mismatch');
  assert.throws(()=>parsePatch(u8(patch.subarray(0,patch.length-1))),PatchError);
  assert.throws(()=>parsePatch(u8(Buffer.concat([patch,Buffer.from([0])]))),PatchError);
});

// The shipped patch is checked against the real stock image when it is available locally.
// The stock image is read from the sp404mk2 workspace only; it is never copied into this repository.
const stockPath=process.env.OPENSP_STOCK_APP1??fileURLToPath(new URL('../../sp404mk2/firmware/v552/extracted/sp404mk2_sys_v552/SP404MKII_APP1.bin',import.meta.url));
const stockZip=process.env.OPENSP_OFFICIAL_ZIP??fileURLToPath(new URL('../../sp404mk2/firmware/v552/sp404mk2_sys_v552.zip',import.meta.url));
const meta=JSON.parse(readFileSync(new URL('../src/content/releases/synth-patch.json',import.meta.url),'utf8'));
const shipped=readFileSync(new URL('../public'+meta.patch.url,import.meta.url));
const noStock=!existsSync(stockPath)&&'set OPENSP_STOCK_APP1 to the official v5.52 SP404MKII_APP1.bin';

test('shipped patch matches its pins and targets the official v5.52 APP1',()=>{
  assert.equal(shipped.length,meta.patch.bytes);
  assert.equal(sha(shipped),meta.patch.sha256);
  const {header}=parsePatch(u8(shipped));
  assert.equal(header.input.sha256,'4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80');
  assert.equal(header.output.sha256,meta.output.sha256);
});

test('shipped patch contains no run of Roland bytes',{skip:noStock},()=>{
  const stock=readFileSync(stockPath);
  assert.equal(sha(stock),meta.input.sha256);
  const index=indexOf(stock);
  // Every stored data run: no 8-byte window may occur anywhere in the stock image.
  assert.equal(officialWindowsInRuns(index,storedRuns(shipped)),0);
  // The whole operation stream, opcodes and offsets included: no 16-byte run may occur in the stock image.
  // (The JSON header is skipped: it names the update file, SP404MKII_APP1.bin, which the stock image also contains.)
  let longest=0;
  for(let i=12+shipped.readUInt32LE(8);i+MIN_COPY<=shipped.length;i++){
    for(let s=index.head[hashAt(shipped,i)];s>=0;s=index.next[s]){
      let n=0;while(s+n<stock.length&&i+n<shipped.length&&stock[s+n]===shipped[i+n])n++;
      if(n>longest)longest=n;
      if(longest>=16)break;
    }
    if(longest>=16)break;
  }
  assert.ok(longest<16,`patch file shares a ${longest}-byte run with the stock image`);
});

test('shipped patch rebuilds the pinned openSynth APP1 from the real APP1 and ZIP',{skip:noStock},async()=>{
  const inputs=[readFileSync(stockPath),...(existsSync(stockZip)?[readFileSync(stockZip)]:[])];
  for(const input of inputs){
    const result=await buildFirmware(u8(shipped),u8(input),meta.patch.sha256);
    assert.equal(result.sha256,meta.output.sha256);
    assert.equal(result.output.length,meta.output.bytes);
    const route=inspectStockUsbRouteImage(result.output);
    assert.equal(route.format,'stock-derived-b2-spuafw10-abi2');
    assert.equal(route.bytes,result.output.length);
    assert.ok(route.sectors>0&&route.paddedBytes<=0x37f000);
  }
});

test('USB route envelope rejects changed B2 metadata',{skip:noStock},async()=>{
  const result=await buildFirmware(u8(shipped),u8(readFileSync(stockPath)),meta.patch.sha256);
  for(const offset of [0,0x288200,0x288208,0x288220,0x288230,0x288238]){
    const changed=result.output.slice();changed[offset]^=1;
    assert.throws(()=>inspectStockUsbRouteImage(changed),TypeError);
  }
});
