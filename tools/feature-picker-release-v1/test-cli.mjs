import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {run} from './run.mjs';

const opensp=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const synth=resolve(opensp,'../sp404mk2-synth');
const key=process.argv[2]??`review-${Date.now().toString(36)}`;
assert.match(key,/^[a-z0-9][a-z0-9_-]{0,18}$/);
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const official=resolve(synth,'../sp404mk2/firmware/v552/sp404mk2_sys_v552.zip');
const selection=resolve(synth,'build/source16-local-build-v1/runs/custom-combined-pad34-05/selection.json');
const report=resolve(synth,'build/source16-local-build-v1/runs/custom-combined-pad34-05/PACKAGE_REVALIDATION-1e5e1077def8.json');
const originalReport=await readFile(report),originalSelection=await readFile(selection),originalOfficial=await readFile(official);
const original=JSON.parse(originalReport),originalReceipt=await readFile(resolve(synth,original.package.receipt.path));
const originalCandidate=await readFile(resolve(synth,original.package.candidate.path));
const out=resolve(synth,'build/feature-picker-release-v1',key);
// New private test reports preserve every actual builder run.
const reportFixtures=resolve(synth,'build/source16-local-build-v1/runs',`picker-${key}-fixtures`);
await mkdir(out);
await mkdir(reportFixtures);
const options={mode:'stage',python:'python','synth-root':synth,selection,'official-base':official,'build-report':report};
const cases=[];
async function refuses(name,changed,match){
  const runKey=`${key}-${String(cases.length+1).padStart(2,'0')}`;
  await assert.rejects(run({...options,run:runKey,...changed}),match);
  cases.push({name,refused:true});
}
async function reportCase(name,mutate,match){
  const changed=structuredClone(original);
  await mutate(changed);
  const path=resolve(reportFixtures,`${cases.length+1}.json`);
  await writeFile(path,JSON.stringify(changed,null,2)+'\n',{flag:'wx'});
  await refuses(name,{'build-report':path},match);
}
const privatePin=async(name,raw)=>{
  const path=resolve(out,name);
  await writeFile(path,raw,{flag:'wx'});
  return {path:relative(synth,path).replaceAll('\\','/'),bytes:raw.length,sha256:digest(raw)};
};

await refuses('another valid selection cannot reuse the combined build',{
  selection:resolve(synth,'build/source16-local-build-v1/runs/custom-synth-pad3-02/selection.json')
},/exact exported selection/);
const badBase=Buffer.from(originalOfficial);badBase[badBase.length-1]^=1;
await privatePin('changed-official.zip',badBase);
await refuses('one changed official ZIP byte is refused',{
  mode:'plan','build-report':undefined,'official-base':resolve(out,'changed-official.zip')
},/Supply the pinned official/);
await privatePin('noncanonical-selection.json',Buffer.concat([originalSelection,Buffer.from('\n')]));
await refuses('valid JSON with noncanonical bytes is refused',{
  mode:'plan','build-report':undefined,selection:resolve(out,'noncanonical-selection.json')
},/exact bytes exported/);
await privatePin('oversized-selection.json',Buffer.alloc(32769,32));
await refuses('oversized selection is refused before normalization',{
  mode:'plan','build-report':undefined,selection:resolve(out,'oversized-selection.json')
},/32 KiB/);
await refuses('an existing stage is preserved',{run:'combined-stage-01'},/EEXIST/);
await refuses('programmatic run traversal is refused',{run:'../outside'},/run key/);
await refuses('a public JSON file cannot serve as a Source16 build report',{'build-report':selection},/Unsupported/);
await reportCase('native qualification cannot be enabled',row=>row.runtime_qualified=true,/qualification/);
await reportCase('a truncated compile cannot be advertised',row=>row.source.compile_unit_count=150,/151-unit/);
await reportCase('a substituted compiler ledger is refused',row=>row.compiler_ledger.sha256='0'.repeat(64),/mismatch/);
await reportCase('another genuine 151-object ledger cannot replace the selected family ledger',async row=>{
  const another=JSON.parse(await readFile(resolve(synth,'build/source16-local-build-v1/runs/custom-synth-pad3-02/LOCAL_BUILD_REPORT.json')));
  row.compiler_ledger=another.compiler_ledger;
},/compiler ledger differs/);
await reportCase('changed candidate bytes cannot retain their original pin',async row=>{
  const raw=Buffer.from(originalCandidate);raw[raw.length-1]^=1;
  const pin=await privatePin('changed-candidate.bin',raw);
  row.package.candidate={...pin,sha256:original.package.candidate.sha256};
},/mismatch/);
await reportCase('updated candidate and receipt hashes cannot replace native package replay',async row=>{
  const raw=Buffer.from(originalCandidate);raw[raw.length-2]^=1;
  row.package.candidate=await privatePin('repinned-candidate.bin',raw);
  const receipt=JSON.parse(originalReceipt);receipt.candidate.sha256=row.package.candidate.sha256;
  receipt.candidate.file.sha256=row.package.candidate.sha256;
  row.package.receipt=await privatePin('repinned-receipt.json',Buffer.from(JSON.stringify(receipt,null,2)+'\n'));
},/Supplied-file package replay differs/);
await reportCase('upload authorization is refused even after receipt repinning',async row=>{
  const receipt=JSON.parse(originalReceipt);receipt.upload_enabled=true;
  row.package.receipt=await privatePin('enabled-receipt.json',Buffer.from(JSON.stringify(receipt,null,2)+'\n'));
},/delivery authorization/);
await reportCase('a substituted source-family pin is refused',row=>row.source_family.sha256='0'.repeat(64),/mismatch/);
await reportCase('a hash-matching public file cannot become the private candidate',async row=>{
  const path=resolve(opensp,'src/content/features.json'),raw=await readFile(path);
  row.package.candidate={path,bytes:raw.length,sha256:digest(raw)};
},/escapes/);
assert.deepEqual(await readFile(report),originalReport);
assert.deepEqual(await readFile(selection),originalSelection);
assert.deepEqual(await readFile(official),originalOfficial);
assert.deepEqual(await readFile(resolve(synth,original.package.receipt.path)),originalReceipt);
assert.deepEqual(await readFile(resolve(synth,original.package.candidate.path)),originalCandidate);
await writeFile(resolve(out,'REPORT.json'),JSON.stringify({status:'PASS_REAL_CLI_REFUSALS',cases,
  original_inputs_unchanged:true,source_recompiled:false,device_operations:false,delivery:'DO_NOT_DELIVER'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PASS_REAL_CLI_REFUSALS',cases:cases.length,output:out}));
