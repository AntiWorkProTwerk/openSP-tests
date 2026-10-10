import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {inspectLocalBuildReceipt,readLocalBuildReceipt,MAX_RECEIPT_BYTES} from '../src/lib/features/buildReceipt.ts';
import {blankSelection,defaultChoice,exportSelection} from '../src/lib/features/selection.ts';
import configVectors from './fixtures/features-config-vectors.json' with {type:'json'};

const sha='a'.repeat(64),otherSha='b'.repeat(64);
const configSha='584d93e828b9b7100806ce1cc57c54dee4ee3f10f8dc3f1980b6dcd39b2b024a';
// Config and marker are cross-language vectors from the existing SPCF Python
// consumer. Everything else below is synthetic metadata, not device evidence.
const selected=()=>({...blankSelection(),features:[defaultChoice('synth'),defaultChoice('usb-recorder')]});
const pin=(path='fixture/data.json',bytes=123,sha256=sha)=>({path,bytes,sha256});
function fixture(){
  const s=selected(),canonical=exportSelection(s),intent=createHash('sha256').update(canonical).digest('hex');
  return {
    schema:'opensp-local-usb-build-receipt',version:3,status:'DISABLED_PROVISIONAL_PACKAGE_VERIFIED',delivery:'DO_NOT_DELIVER',device_io:false,upload_enabled:false,release_eligible:false,
    selection:{...pin('profile/selection.json',Buffer.byteLength(canonical),intent),schema:s.schema,version:2,intent_sha256:intent,feature_mask:3,registry_revision:s.registryRevision,catalog_digest:s.catalogDigest,features:structuredClone(s.features)},
    catalog:{registry:pin('catalog/registry.json',6206,'ef1e3e306d755c08b3ca693e1fc5e829bf61367b49ef666e6440ad51925dbb17'),physical_controls:pin('catalog/controls.json',6233,'c40ffaeb094c290eb22a88d8155ff8d484337b7a78e7f7094a8330a87cad6957'),manifest:pin(),catalog_digest:s.catalogDigest,registry_revision:s.registryRevision},
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
const disabled=result=>{for(const key of ['sourceFamilyVerified','artifactVerified','downloadReady','uploadReady','releaseReady'])assert.equal(result[key],false,key);};
test('cross-language config vector matches the exact current selection and stays disabled',async()=>{
  const result=await inspectLocalBuildReceipt(selected(),fixture());assert.deepEqual(result.issues,[]);assert.equal(result.valid,true);assert.equal(result.matchesSelection,true);disabled(result);
  assert.equal(result.summary.configurationSha256,configSha);assert.equal(result.summary.configurationMarker,0x9d60c73a);assert.equal(result.summary.profileKey,'combined-default');
  assert.ok(!JSON.stringify(result).includes('profile/'));assert.ok(!JSON.stringify(result).includes('contract/'));
});
test('a verified metadata status never verifies binary content or enables delivery',async()=>{const r=fixture();r.status='DISABLED_PACKAGE_VERIFIED';const result=await inspectLocalBuildReceipt(selected(),r);assert.equal(result.valid,true);disabled(result);});
test('pending and failed receipts may describe the configuration without a candidate',async()=>{for(const status of ['DISABLED_PENDING_UPSTREAM','FAILED']){const r=fixture();r.status=status;r.candidate=null;r.restore=null;const result=await inspectLocalBuildReceipt(selected(),r);assert.equal(result.valid,true);assert.equal(result.summary.candidate,null);disabled(result);}});
test('canonical feature order is normalized, shortcut order remains meaningful',async()=>{const s=selected();s.features.reverse();assert.equal((await inspectLocalBuildReceipt(s,fixture())).valid,true);s.features.find(f=>f.id==='synth').shortcut.controls.reverse();assert.equal((await inspectLocalBuildReceipt(s,fixture())).valid,false);});
test('matching receipt hash cannot hide different shortcut contents',async()=>{const r=fixture();r.selection.features[0].shortcut.controls=['SHIFT','PAD_1'];const result=await inspectLocalBuildReceipt(selected(),r);assert.ok(result.issues.some(i=>i.code==='selection-features'));disabled(result);});
test('changing both intent pins does not hide a stale compiled config',async()=>{const s=selected();s.features[0].shortcut.controls=['SHIFT','PAD_1'];const r=fixture(),bytes=exportSelection(s),digest=createHash('sha256').update(bytes).digest('hex');Object.assign(r.selection,{features:structuredClone(s.features),sha256:digest,intent_sha256:digest,bytes:Buffer.byteLength(bytes)});r.configuration.intent_sha256=digest;const result=await inspectLocalBuildReceipt(s,r);assert.ok(result.issues.some(i=>i.code==='configuration-identity'));});
function vectorFixture(vector){
  const s=vector.selection,r=fixture(),canonical=exportSelection(s),marker=parseInt(vector.markerHex,16);
  assert.equal(createHash('sha256').update(canonical).digest('hex'),vector.selectionSha256);
  Object.assign(r.selection,{bytes:Buffer.byteLength(canonical),sha256:vector.selectionSha256,intent_sha256:vector.intentSha256,feature_mask:vector.featureMask,features:structuredClone(s.features)});
  Object.assign(r.configuration,{sha256:vector.configurationSha256,embedded_sha256:vector.configurationSha256,intent_sha256:vector.intentSha256,feature_mask:vector.featureMask,policy_id:vector.policyId,spg1_session_marker:marker,normal_config_marker:marker,expected_chooser_label:vector.expectedChooserLabel});
  r.configuration.file.sha256=r.module.config_section.sha256=vector.configurationSha256;
  const base=vector.featureMask===1?'synth-only':vector.featureMask===2?'global-only':'combined';
  r.source_family.profile_key=base+(vector.id.includes('-custom')||vector.id==='combined-shared-chooser'?'-custom':'-default');r.source_family.family_key=r.source_family.profile_key.replaceAll('-','_');
  return r;
}
for(const vector of configVectors.vectors)test(`Python SPCF vector: ${vector.id}`,async()=>{
  const s=vector.selection,r=vectorFixture(vector),marker=parseInt(vector.markerHex,16);
  const result=await inspectLocalBuildReceipt(s,r);assert.deepEqual(result.issues,[]);assert.equal(result.summary.configurationMarker,marker);disabled(result);
});
for(const vector of configVectors.vectors.filter(v=>['synth-only-custom','global-only-custom'].includes(v.id))){
  for(const [name,key]of [['default label',vector.featureMask===1?'synth-only-default':'global-only-default'],['other feature mask',vector.featureMask===1?'global-only-custom':'synth-only-custom'],['combined label','combined-custom'],['unknown custom label','other-custom']])test(`${vector.id} refuses ${name}`,async()=>{
    const r=vectorFixture(vector);r.source_family.profile_key=key;r.source_family.family_key=key.replaceAll('-','_');
    const result=await inspectLocalBuildReceipt(vector.selection,r);assert.ok(result.issues.some(i=>i.code==='profile-selection'));disabled(result);
  });
}
for(const vector of configVectors.vectors.filter(v=>['synth-only-default','recorder-only-default','global-only-default'].includes(v.id)))test(`${vector.id} refuses a custom profile label for default intent`,async()=>{
  const r=vectorFixture(vector),key=vector.featureMask===1?'synth-only-custom':'global-only-custom';
  r.source_family.profile_key=key;r.source_family.family_key=key.replaceAll('-','_');
  const result=await inspectLocalBuildReceipt(vector.selection,r);assert.ok(result.issues.some(i=>i.code==='profile-selection'));disabled(result);
});
test('consistently recomputed marker cannot conceal a changed profile policy',async()=>{
  const r=fixture();r.configuration.policy_id='50544B33';r.configuration.spg1_session_marker=r.configuration.normal_config_marker=0xae9f3209;r.configuration.expected_chooser_label='SYNTH P6 AE9F3209';
  const result=await inspectLocalBuildReceipt(selected(),r);assert.ok(result.issues.some(issue=>issue.code==='configuration-policy'));assert.ok(!result.issues.some(issue=>issue.code==='configuration-marker'));disabled(result);
});
test('profile key cannot relabel a combined receipt as synth-only even when normalized',async()=>{const r=fixture();r.source_family.profile_key='synth-only-default';r.source_family.family_key='synth_only_default';assert.ok((await inspectLocalBuildReceipt(selected(),r)).issues.some(i=>i.code==='profile-selection'));});
test('profile family key and default/custom classification are bound',async()=>{
  for(const mutate of [r=>r.source_family.family_key='another_family',r=>{r.source_family.profile_key='combined-custom';r.source_family.family_key='combined_custom';}]){const r=fixture();mutate(r);assert.ok((await inspectLocalBuildReceipt(selected(),r)).issues.some(i=>i.code==='profile-selection'));}
});
for(const [name,mutate]of [
  ['wrong receipt schema',r=>r.schema='opensp-first-test-readiness'],['old receipt version',r=>r.version=2],['unknown status',r=>r.status='READY'],['upload claim',r=>r.upload_enabled=true],['device claim',r=>r.device_io=true],['release claim',r=>r.release_eligible=true],['delivery claim',r=>r.delivery='READY_TO_WRITE'],['extra readiness flag',r=>r.write_authorized=true],['private first-test grant',r=>r.controlled_bench.first_test_eligible=true],['owner grant',r=>r.controlled_bench.owner_confirmed=true],['bench write grant',r=>r.controlled_bench.write_authorized=true],['public grant',r=>r.public_release.eligible=true],['storage evidence claim',r=>r.device_evidence.storage_receipt_present=true],['reboot evidence claim',r=>r.device_evidence.normal_receipt_present=true],['DEL evidence claim',r=>r.device_evidence.del_receipt_present=true],['checker physical claim',r=>r.identity_contract.physical_truth_established_by_checker=true],['missing release gates',r=>r.pending_release_gates=[]],['private gate path',r=>r.pending_release_gates=['C:\\private\\receipt.json']],
  ['stale catalog',r=>r.catalog.catalog_digest=otherSha],['wrong catalog file pin',r=>r.catalog.registry.sha256=otherSha],['wrong control map pin',r=>r.catalog.physical_controls.sha256=otherSha],['wrong intent hash',r=>r.selection.sha256=otherSha],['wrong feature mask',r=>r.configuration.feature_mask=1],['wrong config size',r=>r.configuration.bytes=124],['stale embedded config',r=>r.configuration.embedded_sha256=otherSha],['stale config section',r=>r.module.config_section.sha256=otherSha],['wrong config marker',r=>r.configuration.spg1_session_marker++],['wrong normal marker',r=>r.configuration.normal_config_marker=0x52420201],['wrong chooser label',r=>r.configuration.expected_chooser_label='SYNTH P6'],['wrong marker algorithm',r=>r.configuration.marker_algorithm='SHA256(image)'],['stale module family',r=>r.source_family.source_manifest.sha256=r.source_family.source_manifest_sha256=otherSha],['config outside module',r=>r.configuration.embedded_address=0x60310000-1],['config crossing module end',r=>r.configuration.embedded_address=r.module.xip[1]-127],['missing linked module',r=>delete r.module],['bad source pin',r=>r.source_family.manifest.sha256='bad'],['unsafe profile key',r=>r.source_family.profile_key='../private'],['overlapping writable sections',r=>r.module.writable_intervals.push({...r.module.writable_intervals[0]})],['wrong arena capacity',r=>r.module.runtime_ownership.requested_capacity_bytes=1],
  ['oversize APP1',r=>r.candidate.bytes=r.candidate.file.bytes=0x37f001],['zero APP1',r=>r.candidate.bytes=r.candidate.file.bytes=0],['raw pin length mismatch',r=>r.candidate.file.bytes++],['raw pin hash mismatch',r=>r.candidate.file.sha256=otherSha],['partial padding',r=>r.candidate.padded_bytes--],['wrong sector count',r=>r.candidate.sectors++],['candidate shorter than module',r=>{r.candidate.bytes=r.candidate.file.bytes=1024;r.candidate.padded_bytes=4096;r.candidate.sectors=1;}],['missing restore',r=>r.restore=null],['negative CRC',r=>r.candidate.crc32=-1],['wrong title bytes',r=>r.candidate.title_bytes_hex='0'.repeat(26)],['missing candidate with verified status',r=>r.candidate=null],['pending status with candidate',r=>r.status='DISABLED_PENDING_UPSTREAM'],['unknown writer marker',r=>r.b2_writer.marker=0x52420001],['wrong writer maximum',r=>r.b2_writer.maximum=0xffffffff],['wrong bridge tail',r=>r.b2_writer.bridge_tail.sha256=otherSha],['wrong JEDEC',r=>r.b2_writer.jedec++],['writer error',r=>r.b2_writer.error=1],['absolute pin path',r=>r.module.elf.path='/private/module.elf'],['Windows pin path',r=>r.module.elf.path='C:\\private\\module.elf'],['traversal pin path',r=>r.module.elf.path='module/../../private'],['UNC pin path',r=>r.module.elf.path='\\\\host\\private'],['recipe pin missing',r=>delete r.recipe.complete_plan]
])test(`refuses ${name}`,async()=>{const r=fixture();mutate(r);const result=await inspectLocalBuildReceipt(selected(),r);assert.equal(result.valid,false);assert.equal(result.matchesSelection,false);assert.equal(result.summary,null);assert.ok(result.issues.length);disabled(result);});
test('arbitrary JSON inputs yield bounded errors without throwing or echoing raw paths',async()=>{for(const value of [null,[],0,true,'private/path',{}, {schema:'opensp-local-usb-build-receipt',version:3}]){const result=await inspectLocalBuildReceipt(selected(),value);assert.equal(result.valid,false);disabled(result);assert.ok(!JSON.stringify(result).includes('private/path'));}});
test('receipt parsing rejects malformed, oversized and duplicate fields at any depth',()=>{
  assert.throws(()=>readLocalBuildReceipt('{'),/valid bounded JSON/);assert.throws(()=>readLocalBuildReceipt(' '.repeat(MAX_RECEIPT_BYTES+1)),/128 KiB/);assert.throws(()=>readLocalBuildReceipt('{"version":2,"version":3}'),/duplicate JSON fields/);assert.throws(()=>readLocalBuildReceipt('{"configuration":{"sha256":"a","sha256":"b"}}'),/duplicate JSON fields/);assert.deepEqual(readLocalBuildReceipt(JSON.stringify(fixture())),fixture());
});
test('an actual local disabled receipt matches without copying private package data into the site',{skip:!process.env.OPENSP_TEST_LOCAL_BUILD_RECEIPT},async()=>{
  const r=readLocalBuildReceipt(readFileSync(process.env.OPENSP_TEST_LOCAL_BUILD_RECEIPT,'utf8')),result=await inspectLocalBuildReceipt(selected(),r);assert.deepEqual(result.issues,[]);assert.equal(result.valid,true);disabled(result);assert.equal(result.summary.configurationSha256,configSha);
});
