import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadBenchTransaction} from './prepare-bench.mjs';
import {admitRootSealedLocalBenchCandidate,inspectLocalBenchByteBindings,ROOT_SEALED_LOCAL_BENCH_AUTHORITIES} from './local-bench-v1.ts';
import {LocalBenchUsbFlow} from './bench-flow-v1.ts';
import {SingleTakeBenchUsbFlow} from './bench-flow-v2.ts';
import {inspectLocalDelivery} from './inspect.mjs';
import {admitQualifiedP6SRestoration} from './release.ts';
import {connectB2Writer,preflightB2Writer,writeB2Image} from './b2-driver.ts';
import {ModelDevice,ModelHid} from './mock-b2.mjs';

// Offline regression only: no real navigator, HID, server, compiler or registry mutation.
const synth='C:/Users/mryba/code/sp404mk2-synth';
const historical=synth+'/build/openSynth-n1-sealed-final07-v2-01';
const {inputs,map}=await loadBenchTransaction(historical);
const manifestRaw=await readFile(historical+'/OWNER_TEST_ELIGIBILITY.json');
const manifest=JSON.parse(manifestRaw);
const entry=JSON.parse(await readFile(historical+'/ROOT_BENCH_AUTHORITY_ENTRY.json'));
const oldV1=await readFile(synth+'/build/openSynth-n1-bench-core03-01/OWNER_TEST_ELIGIBILITY.json');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const rejection=/No root-sealed LOCALBENCH software authority/;
const options=hid=>({hid,secureContext:true,callTimeoutMs:100});

function unreadInputs(raw) {
  let reads=0;
  const forbidden={get size(){reads++;throw Error('Revoked authority must reject before reading this input');},arrayBuffer(){reads++;throw Error('Forbidden bytes read');}};
  const evidence=new Proxy({}, {get(){reads++;throw Error('Forbidden evidence access');},ownKeys(){reads++;throw Error('Forbidden evidence enumeration');}});
  return {inputs:{ownerTestEligibilityManifest:new Blob([raw]),rootSeal:forbidden,candidate:forbidden,restoration:forbidden,softwareEvidenceFiles:evidence,restorationEvidenceFiles:evidence},reads:()=>reads};
}

test('current withdrawn registry is pinned, frozen and empty; historical authority remains unchanged',async()=>{
  const registry=await readFile(new URL('./root-seals-v1.ts',import.meta.url));
  assert.equal(registry.length,634);assert.equal(hash(registry),'ca85db5362e557ed751491b07cb7c9ce98bb3c98480623b0685cc936d8db9f47');
  assert.equal(ROOT_SEALED_LOCAL_BENCH_AUTHORITIES.length,0);assert(Object.isFrozen(ROOT_SEALED_LOCAL_BENCH_AUTHORITIES));
  assert.equal(manifestRaw.length,entry.manifestBytes);assert.equal(hash(manifestRaw),entry.manifestSha256);
  assert.equal(entry.manifestSha256,'0131a8dc07bb52408659fc896845d97cc40644349e04fb78aa238fb0aefad14c');
  const seal=await readFile(historical+'/ROOT_BENCH_SEAL.json');assert.equal(seal.length,entry.rootSealBytes);assert.equal(hash(seal),entry.rootSealSha256);
  assert.equal(entry.rootSealSha256,'ce7e7162937004d5cacd74ba59cf7b88ebc744b5a3ffcaeb473e5690c24961ce');
  const priorRegistry=await readFile('C:/Users/mryba/code/sp404mk2/analysis/hardware/opensynth_n1_missing_pads_20261006/root-seals-before-withdrawal.ts');
  assert.equal(hash(priorRegistry),'bfdfbad83a19e39159c55e1c7241eb58f369c3a52f1de61a2382b3337fc3fae3');assert(priorRegistry.toString().includes(entry.manifestSha256));
});

test('actual historical approved V2 N1 manifest is refused before seal, candidate, restoration or proof reads',async()=>{
  assert.equal(manifest.software_eligible_for_owner_test,true);
  const review=JSON.parse(await inputs.softwareEvidenceFiles.root_review.text());assert.equal(review.version,2);assert.equal(review.decision,'APPROVED_FOR_FIRST_OWNER_TEST_ONLY');
  const watched=unreadInputs(manifestRaw);await assert.rejects(admitRootSealedLocalBenchCandidate(watched.inputs),rejection);assert.equal(watched.reads(),0);
});

test('real V1 N1 preparation cannot bypass withdrawal or open a device picker',async()=>{
  assert.equal(hash(oldV1),'258021914c5f83ea2ddc22ea3b2916e04ad9187137ef4b92bcc17cc7468cae71');
  const watched=unreadInputs(oldV1),hid=new ModelHid();
  await assert.rejects(async()=>{const admission=await admitRootSealedLocalBenchCandidate(watched.inputs);await new LocalBenchUsbFlow(admission).connect(options(hid));},rejection);
  assert.equal(watched.reads(),0);assert.equal(hid.calls.length,0);assert.equal(hid.device.opens,0);assert.deepEqual(hid.device.commands,[]);
});

test('replayed historical entry, approval booleans and V1/V2 flow-shaped objects confer no authority',async()=>{
  const watched=unreadInputs(manifestRaw),hid=new ModelHid();
  await assert.rejects(async()=>{const admission=await admitRootSealedLocalBenchCandidate({...watched.inputs,rootAuthority:entry,softwareEligibleForOwnerTest:true});await new SingleTakeBenchUsbFlow(admission).connect(options(hid));},rejection);
  const forged={candidate:manifest.candidate,restoration:manifest.restoration,manifestSha256:entry.manifestSha256,rootSealSha256:entry.rootSealSha256,rootReviewContract:{version:2,firstOwnerTestScope:'single-stopped-pattern-take-save-playback-exit',repeatQualified:false}};
  assert.throws(()=>new SingleTakeBenchUsbFlow(forged),/not admitted/);assert.throws(()=>new LocalBenchUsbFlow({...forged,rootReviewContract:{version:1}}),/not admitted/);
  assert.equal(watched.reads(),0);assert.equal(hid.calls.length,0);assert.equal(hid.device.opens,0);
});

for(const version of [1,2])test(`actual V${version} browser entry refuses old N1 approval in a Node DOM model before Connect`,async()=>{
  const previous=new Map(['document','fetch','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const elements=new Map(),hid=new ModelHid();
  const html=await readFile(new URL(`./bench-site-v${version}.html`,import.meta.url),'utf8');
  for(const tag of html.matchAll(/<button\b([^>]*)>/g)){const id=tag[1].match(/\bid="([^"]+)"/)?.[1];if(id)elements.set(id,{disabled:/\bdisabled\b/.test(tag[1]),textContent:'',checked:false,value:''});}
  const element=id=>{if(!elements.has(id))elements.set(id,{disabled:false,textContent:'',checked:false,value:''});return elements.get(id);};
  const blobs=new Map([[map.manifest,inputs.ownerTestEligibilityManifest],[map.candidate,inputs.candidate],[map.restoration,inputs.restoration],[map.root_seal,inputs.rootSeal],
    [map.restoration_evidence_bundle,new Blob([await readFile(historical+'/'+map.restoration_evidence_bundle)])],...Object.entries(map.software_evidence).map(([id,label])=>[label,inputs.softwareEvidenceFiles[id]])]);
  try {
    Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:selector=>element(selector.slice(1))}});
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hid}});
    Object.defineProperty(globalThis,'fetch',{configurable:true,value:async url=>url==='/map.json'?{ok:true,json:async()=>map}:{ok:blobs.has(decodeURIComponent(url.slice(6))),blob:async()=>blobs.get(decodeURIComponent(url.slice(6)))}});
    await import(`./bench-browser-v${version}.ts?withdrawal-node-model`);
    assert.match(element('status').textContent,rejection);assert.equal(element('connect').disabled,true);assert.equal(element('write').disabled,true);assert.equal(element('download').disabled,true);
    element('connect').onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(element('status').textContent,'No admitted image');
    assert.equal(hid.calls.length,0);assert.equal(hid.device.opens,0);assert.deepEqual(hid.device.commands,[]);
  }finally{for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});

test('historical structural inspection preserves past review and explicitly grants no current transfer/public/hardware authority',async()=>{
  const inspection=await inspectLocalBenchByteBindings(inputs);
  assert.equal(inspection.candidate.sha256,'7881b5c18e4cdd83a405349109c05822b23bd6e38f1df37b264eafe558756f48');
  assert.equal(inspection.rootReviewedSoftwareEligible,true);assert.equal(inspection.rootReviewContract.version,2);
  assert.equal(inspection.transferAuthorityGranted,false);assert.equal(inspection.publicReleaseEligible,false);assert.equal(inspection.hardwareQualified,false);
  await assert.rejects(admitRootSealedLocalBenchCandidate(inputs),rejection);
});

test('current offline delivery inspector enables no N1 candidate and makes no stock-first/public claim',async()=>{
  const result=await inspectLocalDelivery({synthRoot:synth,restorationPath:historical+'/restoration-p6s.bin'});
  assert.equal(result.newCandidateUsbUploadEnabled,false);assert.equal(result.stockFirstInstallSupported,false);assert.equal(result.publicReleaseReady,false);assert.equal(result.deviceOperations,false);
  assert.equal(result.restoration.sha256,'7f9917ffb0871cca25b1ce5d281ac5c2bf790ae6b8278b04a5ffef8e3c06fd60');assert.equal(result.authenticatedEvidence.length,21);
});

test('unadmitted N1 snapshot cannot send even profile opcode on an already opened model session',async()=>{
  const hid=new ModelHid(),session=await connectB2Writer(options(hid));
  await assert.rejects(preflightB2Writer(session,{candidate:manifest.candidate,restoration:manifest.restoration},'candidate'),/Only this module/);
  assert.deepEqual(hid.device.commands,[]);assert.equal(session.terminal,true);assert.equal(hid.device.opened,false);
  await assert.rejects(preflightB2Writer(session,{},'candidate'),/closed or terminal/);assert.deepEqual(hid.device.commands,[]);
});

test('profile failure closes the model session and prevents reuse, forged preflight and all upload/commit commands',async()=>{
  const restore=await admitQualifiedP6SRestoration(inputs.restoration,inputs.restorationEvidenceFiles);
  const device=new ModelDevice();device.fault='profile';const hid=new ModelHid(device),session=await connectB2Writer(options(hid));
  await assert.rejects(preflightB2Writer(session,restore,'restoration'),/flash profile/);
  assert.equal(session.terminal,true);assert.equal(device.opened,false);assert.deepEqual(device.commands,[5]);assert.equal(device.received,0);assert.equal(device.programmed,0);
  await assert.rejects(preflightB2Writer(session,restore,'restoration'),/closed or terminal/);
  await assert.rejects(writeB2Image(session,restore,'restoration',{}),/fresh preflight/);assert.deepEqual(device.commands,[5]);
});

test('profile command timeout is terminal and cannot advance to upload or commit',async()=>{
  const restore=await admitQualifiedP6SRestoration(inputs.restoration,inputs.restorationEvidenceFiles);
  class TimeoutDevice extends ModelDevice {async sendFeatureReport(id,body){await super.sendFeatureReport(id,body);return new Promise(()=>{});}}
  const device=new TimeoutDevice(),session=await connectB2Writer(options(new ModelHid(device)));
  await assert.rejects(preflightB2Writer(session,restore,'restoration'),/feature write exceeded its 100 ms bound/);
  assert.equal(session.terminal,true);assert.equal(device.opened,false);assert.deepEqual(device.commands,[5]);assert.equal(device.received,0);assert.equal(device.programmed,0);
  await assert.rejects(preflightB2Writer(session,restore,'restoration'),/closed or terminal/);assert.deepEqual(device.commands,[5]);
});

test('malformed initial status and normal Roland descriptors fail before profile or APP1 commands',async()=>{
  const stock=new ModelDevice();stock.vendorId=0x0582;stock.productId=0x01fb;stock.productName='SP-404MKII';
  await assert.rejects(connectB2Writer(options(new ModelHid(stock))),/not the identified/);assert.equal(stock.opens,0);assert.deepEqual(stock.commands,[]);
  const malformed=new ModelDevice();malformed.fault='malformed-body';await assert.rejects(connectB2Writer(options(new ModelHid(malformed))),/wrong length/);
  assert.equal(malformed.opened,false);assert.deepEqual(malformed.commands,[]);
});
