import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReceiptSession} from '../src/lib/features/receiptSession.ts';
import {blankSelection,defaultChoice,exportSelection} from '../src/lib/features/selection.ts';
import {MAX_RECEIPT_BYTES} from '../src/lib/features/buildReceipt.ts';

const sha='a'.repeat(64),configSha='584d93e828b9b7100806ce1cc57c54dee4ee3f10f8dc3f1980b6dcd39b2b024a';
const selected=()=>({...blankSelection(),features:[defaultChoice('synth'),defaultChoice('usb-recorder')]});
const pin=(path='fixture/data.json',bytes=123,sha256=sha)=>({path,bytes,sha256});
function receipt(){
  const selection=selected(),canonical=exportSelection(selection),intent=createHash('sha256').update(canonical).digest('hex');
  return {
    schema:'opensp-local-usb-build-receipt',version:3,status:'DISABLED_PROVISIONAL_PACKAGE_VERIFIED',delivery:'DO_NOT_DELIVER',device_io:false,upload_enabled:false,release_eligible:false,
    selection:{...pin('profile/selection.json',Buffer.byteLength(canonical),intent),schema:selection.schema,version:2,intent_sha256:intent,feature_mask:3,registry_revision:selection.registryRevision,catalog_digest:selection.catalogDigest,features:structuredClone(selection.features)},
    catalog:{registry:pin('catalog/registry.json',6206,'ef1e3e306d755c08b3ca693e1fc5e829bf61367b49ef666e6440ad51925dbb17'),physical_controls:pin('catalog/controls.json',6233,'c40ffaeb094c290eb22a88d8155ff8d484337b7a78e7f7094a8330a87cad6957'),manifest:pin(),catalog_digest:selection.catalogDigest,registry_revision:selection.registryRevision},
    source_family:{manifest:pin(),source_family_sha256:sha,source_manifest:pin(),source_manifest_sha256:sha,profile_key:'combined-default',family_key:'combined_default',profile_manifest:pin(),profile_manifest_sha256:sha,status:'SYNTHETIC_UNQUALIFIED'},
    configuration:{file:pin('profile/config.bin',128,configSha),bytes:128,sha256:configSha,embedded_sha256:configSha,embedded_address:0x6035d4e0,policy_id:'50544B32',feature_mask:3,intent_sha256:intent,spg1_session_marker:0x9d60c73a,marker_algorithm:'CRC32(SPG1CFG1||LE32(policy_id)||config[0:124])',normal_config_marker:0x9d60c73a,expected_chooser_label:'SYNTH P6 9D60C73A'},
    module:{elf:pin(),binary:pin('module/module.bin',325984),manifest:pin(),manifest_sha256:sha,xip:[0x60310000,0x6035f960],section_audit:pin(),config_section:pin('profile/config.bin',128,configSha),writable_intervals:[{name:'.bss',address:0x83832310,size:32552}],ordinary_bss:{start:0x83832310,end:0x83832310+32552,bytes:32552},arena:null,arena_bytes:142392,spare_bytes:212,runtime_ownership:{requested_capacity_bytes:142392,qualified:false,fixed_interval:{start:null,end:null,reason:'Dynamic allocation is unqualified.'}}},
    recipe:{native_recipe:pin(),ordered_trace:pin(),complete_plan:pin(),stock_app1_model:pin(),patch_chain_audit:pin()},
    candidate:{file:pin('candidate.disabled.bin',3012960),bytes:3012960,sha256:sha,crc32:123,padded_bytes:3014656,sectors:736,identity:'SYNTH P6K2!',title_bytes_hex:'53594e54482050364b32212000'},restore:pin('restore/p6s.bin',2741144),
    b2_writer:{marker:0x52420201,protocol:2,maximum:0x37f000,jedec:0xc22016,flash_status:0x40,flash_ready:1,flash_error:0,error:0,bridge_tail:pin('b2/tail.bin',17412,'b0b1697152804f8a5770e4931a36b9e44c518f8431474534621cd102fdb94cb2'),delivery_helper_path:'contract/delivery.py'},
    identity_contract:{checker_path:'contract/identity.py',handoff_path:'contract/handoff.json',qualification_report_path:'contract/report.json',physical_truth_established_by_checker:false,receipts_present:false},
    device_evidence:{storage_receipt_present:false,normal_receipt_present:false,del_receipt_present:false,full_padded_readback_required:true,separate_status_required:true,normal_reboot_required:true,post_del_required:true},
    controlled_bench:{status:'BLOCKED_RUNTIME_OWNERSHIP',offline_gates:{selected_shortcut_route:true,session_marker_route:true,synth_safe_refusal:true,source_profile:false,runtime_ownership:false,runtime_budget:false},fresh_b2_preflight_required:true,fresh_b2_preflight_receipt:null,owner_confirmation_required:true,owner_confirmed:false,first_test_eligible:false,write_authorized:false},
    public_release:{eligible:false,required_receipts:['full padded storage readback','normal reboot']},pending_release_gates:['capture_save_playback_reentry_workflow','runtime_budget_and_interrupt_safety']
  };
}
const asFile=(value,size=new TextEncoder().encode(value).byteLength)=>({size,text:async()=>value});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const fakeInspection=(id='test')=>({valid:true,matchesSelection:true,issues:[],summary:{status:'DISABLED_PACKAGE_VERIFIED',profileKey:id,selectionSha256:'a'.repeat(64),configurationSha256:'b'.repeat(64),configurationMarker:1,candidate:null,pendingGates:[]},sourceFamilyVerified:false,artifactVerified:false,downloadReady:false,uploadReady:false,releaseReady:false});
const inspectOptions=inspect=>({inspect,hasSubtleCrypto:()=>true});

test('a matching local receipt exposes metadata while keeping every delivery grant false',async()=>{
  const session=createReceiptSession(selected()),text=JSON.stringify(receipt());
  await session.selectFile(asFile(text));
  const result=session.getSnapshot();
  assert.equal(result.phase,'inspected');assert.equal(result.inspection.valid,true);assert.equal(result.inspection.matchesSelection,true);
  for(const key of ['sourceFamilyVerified','artifactVerified','downloadReady','uploadReady','releaseReady'])assert.equal(result.inspection[key],false,key);
  assert.match(result.message,/metadata/);assert.match(result.message,/remain unverified/);assert.match(result.message,/stay disabled/);
  assert.ok(!JSON.stringify(result).includes('profile/selection.json'));assert.ok(!JSON.stringify(result).includes('contract/identity.py'));
});

test('receipt size is checked before reading its contents',async()=>{
  let read=false;const session=createReceiptSession(selected());
  await session.selectFile({size:MAX_RECEIPT_BYTES+1,text:async()=>{read=true;return '{}';}});
  assert.equal(read,false);assert.equal(session.getSnapshot().phase,'invalid');assert.equal(session.getSnapshot().message,'Build receipts must be 128 KiB or smaller.');
});

test('crypto unavailability and read or parse errors use fixed text without echoing file data',async()=>{
  let read=false;const blocked=createReceiptSession(selected(),{hasSubtleCrypto:()=>false});
  await blocked.selectFile({size:2,text:async()=>{read=true;return '{}';}});
  assert.equal(read,false);assert.equal(blocked.getSnapshot().phase,'unavailable');assert.doesNotMatch(blocked.getSnapshot().message,/private|path|C:\\|secret/i);

  const rejected=createReceiptSession(selected());
  await rejected.selectFile({size:4,text:async()=>{throw Error('C:\\private\\secret.json');}});
  assert.equal(rejected.getSnapshot().phase,'error');assert.equal(rejected.getSnapshot().message,'The local receipt could not be read. Choose it again to retry.');

  const malformed=createReceiptSession(selected());
  await malformed.selectFile(asFile('{"path":"C:\\private\\secret.json",'));
  assert.equal(malformed.getSnapshot().phase,'invalid');assert.equal(malformed.getSnapshot().message,'This receipt could not be checked. Choose a supported OpenSP build receipt JSON file.');
  assert.doesNotMatch(JSON.stringify(malformed.getSnapshot()),/private|secret\.json|C:\\|"path"/i);
});

test('the most recently selected file wins when an earlier File.text resolves late',async()=>{
  const firstText=deferred(),secondText=deferred(),entered=new Map(),pending=new Map();
  const inspect=(_selection,value)=>{const task=deferred();pending.set(value.id,task);entered.get(value.id)?.();return task.promise;};
  const waitFor=id=>new Promise(resolve=>entered.set(id,resolve));
  const session=createReceiptSession(selected(),inspectOptions(inspect));
  const first=session.selectFile({size:15,text:()=>firstText.promise});
  const secondStarted=waitFor('second');
  const second=session.selectFile({size:16,text:()=>secondText.promise});
  secondText.resolve('{"id":"second"}');await secondStarted;
  pending.get('second').resolve(fakeInspection('second'));await second;
  firstText.resolve('{"id":"first"}');await first;
  const result=session.getSnapshot();assert.equal(result.phase,'inspected');assert.equal(result.inspection.summary.profileKey,'second');
  assert.equal(pending.has('first'),false);
});

test('changing the selection clears a completed summary and ignores an older inspection',async()=>{
  const selection=selected(),other=selected();other.features[0].shortcut=null;
  const session=createReceiptSession(selection,inspectOptions(async()=>fakeInspection('old')));
  await session.selectFile(asFile('{"id":"old"}'));
  assert.equal(session.getSnapshot().phase,'inspected');
  session.setSelection(other);
  assert.equal(session.getSnapshot().phase,'empty');assert.equal(session.getSnapshot().inspection,null);

  const inspection=deferred(),started=deferred();
  const pendingSession=createReceiptSession(selection,inspectOptions(()=>{started.resolve();return inspection.promise;}));
  const processing=pendingSession.selectFile(asFile('{"id":"old"}'));
  await started.promise;pendingSession.setSelection(other);
  assert.equal(pendingSession.getSnapshot().phase,'empty');
  inspection.resolve(fakeInspection('old'));await processing;
  assert.equal(pendingSession.getSnapshot().phase,'empty');assert.equal(pendingSession.getSnapshot().inspection,null);
});

test('cancel and clear discard pending file reads and their late results',async()=>{
  const read=deferred(),session=createReceiptSession(selected(),inspectOptions(async()=>fakeInspection()));
  const pending=session.selectFile({size:10,text:()=>read.promise});
  session.cancel();assert.equal(session.getSnapshot().phase,'empty');
  read.resolve('{"id":"late"}');await pending;assert.equal(session.getSnapshot().phase,'empty');
  await session.selectFile(asFile('{"id":"done"}'));assert.equal(session.getSnapshot().phase,'inspected');
  session.clear();assert.equal(session.getSnapshot().phase,'empty');assert.equal(session.getSnapshot().inspection,null);
});

test('subscribers receive safe snapshots and can unsubscribe',async()=>{
  const session=createReceiptSession(selected()),phases=[];
  const unsubscribe=session.subscribe(value=>phases.push(value.phase));
  await session.selectFile(asFile('{'));unsubscribe();session.clear();
  assert.deepEqual(phases,['empty','reading','invalid']);
});

test('invalid choices cannot inspect against the last valid selection and can recover',async()=>{
  let reads=0,checks=0;
  const session=createReceiptSession(selected(),inspectOptions(async()=>{checks++;return fakeInspection();}));
  const invalid=selected();invalid.features[1].shortcut=structuredClone(invalid.features[0].shortcut);
  session.setSelection(invalid);
  assert.equal(session.getSnapshot().phase,'error');
  await session.selectFile({size:2,text:async()=>{reads++;return '{}';}});
  assert.equal(reads,0);assert.equal(checks,0);assert.equal(session.getSnapshot().inspection,null);
  session.setSelection(selected());assert.equal(session.getSnapshot().phase,'empty');
  await session.selectFile(asFile('{}'));assert.equal(checks,1);assert.equal(session.getSnapshot().phase,'inspected');
});
