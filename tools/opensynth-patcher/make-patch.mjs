// Build the openSynth browser patch from the official v5.52 APP1 and a finished openSynth APP1.
//
// The patch is a list of copy and data operations. Every run of 8 or more bytes
// that also occurs anywhere in Roland's image becomes a copy from the visitor's
// own file, so the stored data holds only bytes that are absent from Roland's
// image: openSynth module code and data, hook instructions and toolchain runtime.
//
//   node tools/opensynth-patcher/make-patch.mjs --official STOCK_APP1.bin --target OPENSYNTH_APP1.bin \
//     [--out public/opensynth/patch/opensynth-v552.ospatch] [--meta src/content/releases/synth-patch.json] [--build LABEL]
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {OFFICIAL_INPUTS} from '../synth-release-patcher-v1/official.mjs';

export const FORMAT='opensynth-binpatch/1';
export const MAGIC=Buffer.from('OSPATCH1','latin1');
/** Shortest stock run that is always copied, never stored. */
export const MIN_COPY=8;
const BITS=22,MASK=(1<<BITS)-1,CHAIN=512;
export const sha256=body=>createHash('sha256').update(body).digest('hex');

export function hashAt(b,i){
  return (Math.imul(b[i]|b[i+1]<<8|b[i+2]<<16|b[i+3]<<24,0x9e3779b1)^Math.imul(b[i+4]|b[i+5]<<8|b[i+6]<<16|b[i+7]<<24,0x85ebca77))>>>(32-BITS);
}

/** Hash chains over every MIN_COPY-byte window of the source. */
export function indexOf(source){
  const head=new Int32Array(MASK+1).fill(-1),next=new Int32Array(source.length).fill(-1);
  for(let i=0;i+MIN_COPY<=source.length;i++){const h=hashAt(source,i);next[i]=head[h];head[h]=i;}
  return {source,head,next};
}

function matchLength(a,ai,b,bi){let n=0;while(ai+n<a.length&&bi+n<b.length&&a[ai+n]===b[bi+n])n++;return n;}

/** Longest source match for data[i..]; `exhaustive` walks the whole chain when nothing reached MIN_COPY. */
function bestMatch(index,data,i,hint){
  const {source,head,next}=index;
  let best=0,from=-1;
  if(hint>=0&&hint<source.length){const n=matchLength(source,hint,data,i);if(n>best){best=n;from=hint;}}
  if(i+MIN_COPY>data.length)return {best,from};
  let k=0;
  for(let s=head[hashAt(data,i)];s>=0;s=next[s],k++){
    if(k>=CHAIN&&best>=MIN_COPY)break;
    const n=matchLength(source,s,data,i);
    if(n>best){best=n;from=s;}
  }
  return {best,from};
}

/** True when data[i..i+MIN_COPY] occurs anywhere in the indexed source. */
export function occursInSource(index,data,i){
  const {source,head,next}=index;
  for(let s=head[hashAt(data,i)];s>=0;s=next[s])if(matchLength(source,s,data,i)>=MIN_COPY)return true;
  return false;
}

/** Return [['c',from,length] | ['d',Buffer]] operations that rebuild target from source. */
export function diff(source,target,index=indexOf(source)){
  const ops=[];let i=0,literal=0,previous=-1;
  const flush=()=>{if(i>literal)ops.push(['d',Buffer.from(target.subarray(literal,i))]);};
  while(i<target.length){
    const {best,from}=bestMatch(index,target,i,previous);
    if(best>=MIN_COPY){flush();ops.push(['c',from,best]);i+=best;literal=i;previous=from+best;}
    else{i++;previous=-1;}
  }
  flush();
  return ops;
}

/** Serialise the header and operations into the binary patch format. */
export function encode(header,ops){
  const json=Buffer.from(JSON.stringify(header),'utf8'),parts=[MAGIC,u32(json.length),json];
  for(const op of ops){
    if(op[0]==='c')parts.push(Buffer.from([1]),u32(op[1]),u32(op[2]));
    else parts.push(Buffer.from([2]),u32(op[1].length),op[1]);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}
function u32(v){const b=Buffer.alloc(4);b.writeUInt32LE(v);return b;}

/** Every stored data run in an encoded patch, for audits. */
export function storedRuns(patch){
  const view=Buffer.from(patch.buffer,patch.byteOffset,patch.byteLength);let p=8;const length=view.readUInt32LE(p);p+=4+length;const runs=[];
  for(;;){const op=view[p++];if(op===0)break;if(op===1){p+=8;continue;}if(op!==2)throw Error('Unknown op '+op);const n=view.readUInt32LE(p);p+=4;runs.push(view.subarray(p,p+n));p+=n;}
  return runs;
}

/** Count MIN_COPY-byte windows of stored data that also occur in the official image. */
export function officialWindowsInRuns(index,runs){
  let found=0;
  for(const run of runs)for(let i=0;i+MIN_COPY<=run.length;i++)if(occursInSource(index,run,i))found++;
  return found;
}

export function makePatch(official,target,build){
  const app1=OFFICIAL_INPUTS.find(pin=>pin.kind==='official-v552-app1');
  if(official.length!==app1.bytes||sha256(official)!==app1.sha256)throw Error('--official must be the unchanged official v5.52 SP404MKII_APP1.bin');
  const index=indexOf(official),ops=diff(official,target,index);
  const header={format:FORMAT,zipEntry:'SP404MKII_APP1.bin',
    input:{name:'SP404MKII_APP1.bin',bytes:official.length,sha256:app1.sha256},
    output:{name:'SP404MKII_APP1.bin',bytes:target.length,sha256:sha256(target)}};
  const patch=encode(header,ops),runs=storedRuns(patch);
  const overlap=officialWindowsInRuns(index,runs);
  if(overlap)throw Error(`Stored data contains ${overlap} ${MIN_COPY}-byte windows from the official image`);
  const storedBytes=runs.reduce((n,r)=>n+r.length,0);
  const meta={schema:1,format:FORMAT,build:build??null,
    patch:{url:'/opensynth/patch/opensynth-v552.ospatch',bytes:patch.length,sha256:sha256(patch)},
    input:header.input,zip:OFFICIAL_INPUTS.find(pin=>pin.kind==='official-v552-zip'),output:header.output,
    storedBytes,copiedBytes:target.length-storedBytes,operations:ops.length,minimumCopy:MIN_COPY};
  return {patch,meta,ops};
}

function main(){
  const args={};
  for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
  for(const key of ['official','target'])if(!args[key])throw Error(`Missing --${key}`);
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const out=args.out??path.join(root,'public/opensynth/patch/opensynth-v552.ospatch');
  const metaPath=args.meta??path.join(root,'src/content/releases/synth-patch.json');
  const {patch,meta}=makePatch(readFileSync(args.official),readFileSync(args.target),args.build);
  mkdirSync(path.dirname(out),{recursive:true});
  writeFileSync(out,patch);
  writeFileSync(metaPath,JSON.stringify(meta,null,2)+'\n');
  console.log(JSON.stringify(meta,null,2));
}

if(process.argv[1]===fileURLToPath(import.meta.url))main();
