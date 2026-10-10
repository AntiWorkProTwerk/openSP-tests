import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePortableArgs,PORTABLE_CATALOG_SHA256,PORTABLE_KIT06_CATALOG_SHA256,REVIEWED_PORTABLE_CATALOG_SHA256S} from './portable-stage.mjs';

const args=['--private-root','PRIVATE','--evidence-root','EVIDENCE','--kit-root','KIT',
  '--dependency-catalog','CATALOG','--dependency-catalog-sha',PORTABLE_CATALOG_SHA256,
  '--profile','combined','--family','FAMILY','--family-sha','a'.repeat(64),'--anchor-sha','b'.repeat(64),
  '--official','OFFICIAL','--stage-root','PRIVATE_BUILD','--run','fresh-01'];
test('portable staging requires explicit external inputs and reviewed catalog admission',()=>{
  const options=parsePortableArgs(args);assert.equal(options.python,'python');assert.equal(options.profile,'combined');
});
test('kit06 catalog is additive and the original exported admission digest stays unchanged',()=>{
  assert.equal(PORTABLE_CATALOG_SHA256,'5a3fbbd3b96efc4993626f2d9a4ac619592c4ea6bb7f6fd14d21993da3ecc5cc');
  assert.equal(parsePortableArgs(args.map(v=>v===PORTABLE_CATALOG_SHA256?PORTABLE_KIT06_CATALOG_SHA256:v))['dependency-catalog-sha'],PORTABLE_KIT06_CATALOG_SHA256);
  assert.equal(REVIEWED_PORTABLE_CATALOG_SHA256S.length,2);
  assert.throws(()=>REVIEWED_PORTABLE_CATALOG_SHA256S.push('0'.repeat(64)),TypeError);
});
for(const [label,changed,match] of [
  ['duplicate root',[...args,'--private-root','OTHER'],/Duplicate/],
  ['unknown action',[...args,'--upload','yes'],/Invalid/],
  ['missing explicit kit',args.filter((_,i)=>![4,5].includes(i)),/every explicit/],
  ['arbitrary profile',args.map(value=>value==='combined'?'factory-128':value),/three reviewed/],
  ['run traversal',args.map(value=>value==='fresh-01'?'../old':value),/run key/],
  ['self-authored catalog',args.map(value=>value===PORTABLE_CATALOG_SHA256?'c'.repeat(64):value),/no reviewed admission/],
  ['malformed family digest',args.map(value=>value==='a'.repeat(64)?'bad':value),/digest/],
])test(`portable parser refuses ${label}`,()=>assert.throws(()=>parsePortableArgs(changed),match));
