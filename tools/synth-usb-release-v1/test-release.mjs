import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {admitQualifiedP6SRestoration,resolveQualifiedImage,inspectPatcherHandoff,inspectUnqualifiedCandidate,admitCandidate,P6S_IMAGE,P6S_EVIDENCE} from './release.ts';
import {loadRetainedP6SInputs,localFile,inspectLocalDelivery} from './inspect.mjs';
import {connectB2Writer,preflightB2Writer,writeB2Image,B2DeliveryError,B2} from './b2-driver.ts';
import {SynthUsbReleaseFlow} from './flow.ts';
import {ModelDevice,ModelHid} from './mock-b2.mjs';
import {encodeRetainedP6SEvidence,prepareEvidenceBundle} from './prepare-evidence.mjs';
import {readRetainedP6SEvidenceBundle,admitQualifiedP6SRestorationFromEvidenceBundle,EVIDENCE_BUNDLE_MAXIMUM} from './evidence-bundle.ts';
import {admitRootSealedLocalBenchCandidate,LOCAL_BENCH_V1,ROOT_SEALED_LOCAL_BENCH_AUTHORITIES} from './local-bench-v1.ts';

const synth=resolve(process.env.OPENSP_SYNTH_USB_EVIDENCE_ROOT??fileURLToPath(new URL('../../../sp404mk2-synth/',import.meta.url)));
const build=resolve(synth,'build/standalone-source-picker-v1/whole-02');
const restorePath=resolve(build,'restore-build/restore-p6s.disabled.bin');
const handoffPath=resolve(synth,'build/synth-release-patcher-v1/retained-inspection-01/PATCHER_HANDOFF.json');
const inputs=await loadRetainedP6SInputs(synth,restorePath);
const admission=await admitQualifiedP6SRestoration(inputs.restoration,inputs.evidenceFiles);
const handoffRaw=await readFile(handoffPath),candidateRaw=await readFile(resolve(build,'selected-build/candidate.disabled.bin'));
const candidate=localFile(candidateRaw);
const handoff=JSON.parse(handoffRaw);
const hash=body=>createHash('sha256').update(body).digest('hex');
const options=hid=>({hid,secureContext:true,callTimeoutMs:1000});

test('actual retained handoff and completed physical authority bind only the exact P6S restoration',async()=>{
  assert.equal(hash(handoffRaw),'9559fb8ed1b7ad4999ccd758d8680a7075db3d38a663144b2a12bb4e11011f04');
  const summary=await inspectPatcherHandoff(localFile(handoffRaw),candidate,inputs.restoration);
  assert.equal(summary.candidateUploadEnabled,false);assert.equal(summary.delivery,'DO_NOT_DELIVER');
  assert.equal(summary.sourceReceiptAuthenticatedByThisInspection,false);
  assert.equal(summary.candidate.sha256,'51cd22432612c1e9ffcea6fb4f714831b779a8a2765117aed4f253dce8968878');
  assert.equal(admission.restoration.sha256,P6S_IMAGE.sha256);assert.equal(admission.authenticatedEvidence.length,21);
  assert.equal(admission.browserWritePreviouslyQualified,true);assert.equal(admission.publicReleaseReady,false);
  assert.equal('candidate' in admission,false);assert(Object.isFrozen(admission));
  const offline=await inspectLocalDelivery({synthRoot:synth,restorationPath:restorePath,handoffPath,buildRoot:build});
  assert.equal(offline.deviceOperations,false);assert.equal(offline.newCandidateUsbUploadEnabled,false);
});

for(const pin of P6S_EVIDENCE)test(`authority rejects altered retained ${pin.id} bytes`,async()=>{
  const bytes=new Uint8Array(await inputs.evidenceFiles[pin.id].arrayBuffer());bytes[bytes.length-1]^=1;
  await assert.rejects(admitQualifiedP6SRestoration(inputs.restoration,{...inputs.evidenceFiles,[pin.id]:localFile(bytes)}),/digest differs/);
});
test('missing or extra evidence, selected Source16 bytes, forged/cloned admission and candidate roles are refused',async()=>{
  const missing={...inputs.evidenceFiles};delete missing[P6S_EVIDENCE[0].id];
  await assert.rejects(admitQualifiedP6SRestoration(inputs.restoration,missing),/evidence set/);
  await assert.rejects(admitQualifiedP6SRestoration(inputs.restoration,{...inputs.evidenceFiles,extra:inputs.restoration}),/evidence set/);
  await assert.rejects(admitQualifiedP6SRestoration(candidate,inputs.evidenceFiles),/exact hardware-working P6S/);
  assert.throws(()=>resolveQualifiedImage({...admission},'restoration'),/Only this module/);
  assert.throws(()=>resolveQualifiedImage(admission,'candidate'),/Only this module/);
  assert.throws(()=>new SynthUsbReleaseFlow({...admission}),/Only this module/);
  assert.throws(()=>admitCandidate(handoff),/root-sealed LOCALBENCH software/);
  const exposed=resolveQualifiedImage(admission,'restoration').bytes;exposed[0]^=1;
  assert.equal(resolveQualifiedImage(admission,'restoration').bytes[0],0x87);
});
for(const flag of ['public_ready','release_ready','upload_ready','browser_upload_enabled','native_hardware_qualified','compact_recording_candidate_admitted','writer_authority_granted'])
  test(`held patcher handoff cannot promote ${flag}`,async()=>{
    await assert.rejects(inspectPatcherHandoff(localFile(JSON.stringify({...handoff,[flag]:true})),candidate,inputs.restoration),/promotes held/);
  });
test('handoff refuses duplicate fields, future/compact schema grafts, extra authority, changed selection and byte metadata',async()=>{
  await assert.rejects(inspectPatcherHandoff(localFile(handoffRaw.toString().replace('"version": 1','"version": 1, "version": 1')),candidate,inputs.restoration),/duplicate fields/);
  for(const changed of [{recipe:'compact-p6n1'}, {unknown_authority:true}, {canonical_selection_sha256:'0'.repeat(64)},
    {source_authority_sha256:'0'.repeat(64)}, {candidate:{...handoff.candidate,padded_bytes:handoff.candidate.padded_bytes-4096}},
    {candidate_role:'historical-fixed-synth-only-source16'}]) {
    await assert.rejects(inspectPatcherHandoff(localFile(JSON.stringify({...handoff,...changed})),candidate,inputs.restoration),/differ|unsupported/);
  }
  await assert.rejects(inspectPatcherHandoff(localFile(handoffRaw),inputs.restoration,inputs.restoration),/metadata differ/);
});
test('transport section remains byte-identical to the source used in the physical WebHID trial',async()=>{
  const source=await readFile(resolve(synth,'diagnostics/synth_p6/browser_usb_delivery_v1/adapter.ts'),'utf8');
  const port=await readFile(new URL('./b2-driver.ts',import.meta.url),'utf8');
  const provenance=JSON.parse(await readFile(new URL('./DRIVER_PROVENANCE.json',import.meta.url)));
  assert.equal(hash(source),provenance.sourceSha256);
  const section=source.slice(source.indexOf('function flattenCollections('));
  assert(port.endsWith(section));assert.equal(hash(section),provenance.transportSectionSha256);
  assert(!port.includes('admitB2UpdateFiles'));assert(!port.includes('admitB2P6SRoundtripTestFiles'));
});
test('normal Roland endpoint, malformed framing and wrong profile are rejected before any APP1 command',async()=>{
  const stock=new ModelDevice();stock.vendorId=0x0582;stock.productId=0x01fb;stock.productName='SP-404MKII';
  await assert.rejects(connectB2Writer(options(new ModelHid(stock))),/not the identified/);assert.equal(stock.opens,0);
  const malformed=new ModelDevice();malformed.fault='malformed-body';
  await assert.rejects(connectB2Writer(options(new ModelHid(malformed))),/wrong length/);assert.equal(malformed.commands.length,0);
  const bad=new ModelDevice();bad.fault='profile';const session=await connectB2Writer(options(new ModelHid(bad)));
  await assert.rejects(preflightB2Writer(session,admission,'restoration'),/flash profile/);assert.deepEqual(bad.commands,[5]);
});
test('forged restoration token cannot even send the profile opcode',async()=>{
  const hid=new ModelHid(),session=await connectB2Writer(options(hid));
  await assert.rejects(preflightB2Writer(session,{...admission},'restoration'),/Only this module/);
  assert.equal(hid.device.commands.length,0);
});
test('exact P6S protocol model verifies padded extent and independently reopened status while boot stays pending',async()=>{
  const hid=new ModelHid(),session=await connectB2Writer(options(hid));
  const profile=await preflightB2Writer(session,admission,'restoration');
  const result=await writeB2Image(session,admission,'restoration',profile);
  assert.equal(result.readback.verifiedPaddedBytes,2744320);assert.equal(result.readback.sectors,670);
  assert.equal(result.observedStatuses.separate.flashCrc32,0xba6967b2);assert.equal(result.reboot.normalBoot,'not-confirmed');
  assert.equal(result.readback.hostDownloadedFlashBytes,false);assert.equal(hid.device.opens,2);assert.equal(hid.device.opened,false);
  assert.equal(hash(hid.device.image),P6S_IMAGE.sha256);assert.equal(hid.device.commands.filter(op=>op===6).length,1);
});
for(const [fault,stage,committed,readback] of [['ram-crc','ram-crc',false,false],['short-padding','sector-readback',true,false],['separate-status','separate-status',true,true],['commit-timeout','flash-commit',true,false]])
  test(`protocol failure ${fault} preserves stage and write uncertainty without retry`,async()=>{
    const device=new ModelDevice();device.fault=fault;const hid=new ModelHid(device);
    const session=await connectB2Writer({...options(hid),callTimeoutMs:fault==='commit-timeout'?20:1000});
    const profile=await preflightB2Writer(session,admission,'restoration');
    await assert.rejects(writeB2Image(session,admission,'restoration',profile),error=>{
      assert(error instanceof B2DeliveryError);assert.equal(error.stage,stage);assert.equal(error.commitMayHaveBeenAccepted,committed);
      assert.equal(error.deviceReadbackReported,readback);assert.equal(error.separateStatusVerified,false);return true;
    });
    assert.equal(device.commands.filter(op=>op===6).length,committed?1:0);assert(session.terminal);
    await assert.rejects(writeB2Image(session,admission,'restoration',profile),/fresh preflight|single-use/);
  });
test('disconnect invalidates an actual fresh preflight and sends no upload command',async()=>{
  const hid=new ModelHid(),session=await connectB2Writer(options(hid));const profile=await preflightB2Writer(session,admission,'restoration');
  hid.disconnect();await assert.rejects(writeB2Image(session,admission,'restoration',profile),/terminal|closed/);
  assert.deepEqual(hid.device.commands,[5]);
});
test('flow requires explicit Write, exports attempt-bound pending receipt, then separate owner and fresh DEL checks',async()=>{
  const flow=new SynthUsbReleaseFlow(admission),hid=new ModelHid();
  assert.throws(()=>flow.reportNormalBoot({}),/completed storage attempt/);
  await flow.connect(options(hid));assert.deepEqual(hid.device.commands,[5]);
  await assert.rejects(flow.write({unchangedP6S:false,currentColdDelTitle:'USB BRIDGE B2'}),/Explicit/);
  assert.equal(flow.phase,'profile-confirmed');
  const storage=await flow.write({unchangedP6S:true,currentColdDelTitle:'USB BRIDGE B2'});
  assert.equal(storage.status,'storage-readback-verified-reboot-pending');assert.equal(storage.normalBootConfirmed,false);
  assert.equal(storage.coldDelConfirmed,false);assert.equal(storage.physicalTransportAuthenticatedByThisReceipt,false);
  assert.deepEqual(hid.device.commands.slice(0,2),[5,5]);
  const download=await flow.downloadableReceipt();assert.equal(hash(download.bytes),download.sha256);
  await assert.rejects(flow.confirmColdDel({}),/normal boot/);
  assert.throws(()=>flow.reportNormalBoot({fullPowerRemoval:true,title:'SYNTH P6S!',knownSampleWorks:true,synthWorks:true,exitReentryCycles:1,exactReply:'works'}),/two EXIT/);
  const normal=flow.reportNormalBoot({fullPowerRemoval:true,title:'SYNTH P6S!',knownSampleWorks:true,synthWorks:true,exitReentryCycles:2,exactReply:'SYNTH P6S!; sample, Synth and re-entry work'});
  assert.equal(normal.normalBoot.evidenceKind,'owner-reported');assert.equal(normal.attemptId,storage.attemptId);
  const fresh=new ModelHid();const final=await flow.confirmColdDel({fullPowerRemoval:true,title:'USB BRIDGE B2',exactReply:'USB BRIDGE B2 is showing'},options(fresh));
  assert.equal(fresh.calls.length,1);assert.deepEqual(fresh.device.commands,[5]);assert.equal(fresh.device.opened,false);
  assert.equal(final.coldDelConfirmed,true);assert.equal(final.candidateUploadEnabled,false);assert.equal(final.publicReleaseReady,false);
  assert.equal(final.attemptId,storage.attemptId);assert.equal(flow.phase,'completed-owner-and-browser-checks');
  await assert.rejects(flow.write({unchangedP6S:true,currentColdDelTitle:'USB BRIDGE B2'}),/Connect/);
});
test('flow downloads a commit-uncertain failure receipt and never offers boot confirmation or retry',async()=>{
  const flow=new SynthUsbReleaseFlow(admission),device=new ModelDevice();device.fault='commit-timeout';
  await flow.connect({...options(new ModelHid(device)),callTimeoutMs:20});
  await assert.rejects(flow.write({unchangedP6S:true,currentColdDelTitle:'USB BRIDGE B2'}),/exceeded its 20 ms bound/);
  const download=await flow.downloadableReceipt(),receipt=JSON.parse(new TextDecoder().decode(download.bytes));
  assert.equal(hash(download.bytes),download.sha256);assert.equal(receipt.status,'failed-preserve-device-state');
  assert.equal(receipt.failure.stage,'flash-commit');assert.equal(receipt.failure.commitMayHaveBeenAccepted,true);
  assert.equal(receipt.failure.deviceReadbackReported,false);assert.equal(receipt.normalBootConfirmed,false);
  assert.equal(receipt.coldDelConfirmed,false);assert.equal(receipt.automaticRetryAllowed,false);assert.equal(flow.phase,'terminal');
  assert.throws(()=>flow.reportNormalBoot({}),/completed storage attempt/);assert.equal(device.commands.filter(op=>op===6).length,1);
});
test('future-candidate envelope inspection derives actual bytes while granting no transfer authority',async()=>{
  const envelope=await inspectUnqualifiedCandidate(candidate,'Historical Source16 selected build');
  assert.equal(envelope.image.sha256,handoff.candidate.sha256);assert.equal(envelope.image.crc32,handoff.candidate.crc32);
  assert.equal(envelope.image.padded_bytes,handoff.candidate.padded_bytes);assert.equal(envelope.writerEnvelopeCompatible,true);
  assert.equal(envelope.browserUploadEnabled,false);assert.equal(envelope.runtimeQualified,false);assert.equal(envelope.hardwareQualified,false);
  assert.throws(()=>resolveQualifiedImage(envelope,'candidate'),/Only this module/);
});
test('unqualified envelope inspection refuses malformed ABI2 intervals and extent without requesting a device',async()=>{
  const changed=Uint8Array.from(candidateRaw);new DataView(changed.buffer).setUint32(0x288000+0x218,0x800,true);
  await assert.rejects(inspectUnqualifiedCandidate(localFile(changed),'SYNTH P6N1!'),/bridge header/);
  await assert.rejects(inspectUnqualifiedCandidate(localFile(new Uint8Array(B2.maximum+1)),'SYNTH P6N1!'),/APP1 extent/);
});
test('single owner-local evidence bundle authenticates the exact21 files without firmware or candidate authority',async()=>{
  const bundle=await encodeRetainedP6SEvidence(synth),decoded=await readRetainedP6SEvidenceBundle(localFile(bundle.bytes));
  assert.equal(decoded.bundleSha256,bundle.sha256);assert.equal(Object.keys(decoded.evidenceFiles).length,21);
  assert.equal(decoded.firmwareIncluded,false);assert.equal(decoded.candidateAuthorityGranted,false);
  const admitted=await admitQualifiedP6SRestorationFromEvidenceBundle(inputs.restoration,localFile(bundle.bytes));
  assert.equal(admitted.restoration.sha256,P6S_IMAGE.sha256);assert.equal(admitted.candidateUploadEnabled,false);
  await assert.rejects(admitQualifiedP6SRestorationFromEvidenceBundle(candidate,localFile(bundle.bytes)),/exact hardware-working P6S/);
});
test('evidence bundle refuses changed bytes, duplicate IDs/JSON, encoding drift and authority flags',async()=>{
  const encoded=await encodeRetainedP6SEvidence(synth),original=JSON.parse(encoded.bytes);
  for(const change of [
    value=>value.files[0].base64=Buffer.from('altered'.padEnd(value.files[0].bytes,'x')).toString('base64'),
    value=>value.files[1]=value.files[0],
    value=>value.files[0].base64=value.files[0].base64.slice(1),
    value=>value.candidateAuthorityGranted=true,
    value=>value.files.push({id:'firmware',base64:'AA=='}),
  ]){const changed=structuredClone(original);change(changed);await assert.rejects(readRetainedP6SEvidenceBundle(localFile(JSON.stringify(changed))),/digest|duplicate|encoding|authority|exact21/);}
  await assert.rejects(readRetainedP6SEvidenceBundle(localFile(encoded.bytes.toString().replace('"version": 1','"version": 1, "version": 1'))),/duplicate fields/);
  await assert.rejects(readRetainedP6SEvidenceBundle(localFile(new Uint8Array(EVIDENCE_BUNDLE_MAXIMUM+1))),/1 MiB/);
  await assert.rejects(prepareEvidenceBundle(synth,resolve('public','must-not-write-evidence.json')),/outside the website/);
});
test('LOCALBENCH first-test gate requires a root software seal, keeps physical/public qualification separate and admits no absent candidate',async()=>{
  assert.equal(LOCAL_BENCH_V1.priorCandidateHardwareProofRequired,false);assert.equal(LOCAL_BENCH_V1.publicReleaseQualifiedBySoftwareAdmission,false);
  assert.equal(ROOT_SEALED_LOCAL_BENCH_AUTHORITIES.length,0);assert(Object.isFrozen(ROOT_SEALED_LOCAL_BENCH_AUTHORITIES));
  let candidateReads=0;
  const unread={size:1,arrayBuffer(){candidateReads++;throw Error('Absent candidate must not be read');}};
  const forged=localFile(JSON.stringify({schema:LOCAL_BENCH_V1.schema,software_eligible_for_owner_test:true,public_release_eligible:false,root_sealed:true}));
  await assert.rejects(admitRootSealedLocalBenchCandidate({ownerTestEligibilityManifest:forged,candidate:unread,restoration:inputs.restoration,
    softwareEvidenceFiles:{},restorationEvidenceFiles:inputs.evidenceFiles}),/No root-sealed LOCALBENCH software authority/);
  assert.equal(candidateReads,0);
});
