import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSelection,defaultChoice,defaultSynthShortcut,readSelection,exportSelection,shortcutConfiguration,sourceProfile,validateSelection,STORAGE_KEY} from '../src/lib/features/source-preview-full15/selection.ts';
import * as full14 from '../src/lib/features/source-preview/selection.ts';
import * as p6s from '../src/lib/features/selection.ts';
import {selectionDigest,inspectSourceReceipt,SOURCE_RECIPE,SOURCE_PROFILES} from '../src/lib/features/source-preview-full15/receipt.ts';
const chosen=(global=false)=>({...blankSelection(),features:(global?['synth','usb-recorder']:['synth']).map(defaultChoice)});
test('Full15 combined intent is explicitly versioned and separate from Full14/P6S',()=>{
 assert.equal(p6s.defaultChoice('synth').version,'p6s-1');assert.notEqual(STORAGE_KEY,full14.STORAGE_KEY);assert.notEqual(STORAGE_KEY,p6s.STORAGE_KEY);assert.match(STORAGE_KEY,/v2$/);
 assert.equal(full14.sourceProfile({...full14.blankSelection(),features:['synth','usb-recorder'].map(full14.defaultChoice)}),'full14-source-preview-global');
 assert.throws(()=>readSelection(full14.exportSelection({...full14.blankSelection(),features:[full14.defaultChoice('synth')]})),/registry|catalog|version|profile/);
});
test('The same picker routes Synth-only or combined features with a chosen Synth chord',()=>{
 const core=chosen();assert.equal(shortcutConfiguration(core),null);assert.equal(sourceProfile(core),'full15-synth-shortcut-source-preview');
 const global=chosen(true);global.features[0].shortcut={...defaultSynthShortcut(),controls:['COPY','SHIFT','PAD_2']};
 assert.equal(sourceProfile(global),'full15-shortcut-optional-global-source-preview');assert.equal(validateSelection(global).sourceBuildReady,true);
 const config=shortcutConfiguration(readSelection(exportSelection(global)));assert.deepEqual(config,{schema:'opensynth.full15-shortcut-selection/v1',feature:'synth',controls:[36,43,2],trigger:2});
 global.features.reverse();assert.deepEqual(shortcutConfiguration(global),config);assert.equal(global.features.find(feature=>feature.id==='usb-recorder').shortcut,null);
});
test('Reserved Synth chords, recorder hardware shortcuts and recorder-only builds are refused',()=>{
 const selection=chosen();selection.features[0].shortcut={...defaultSynthShortcut(),controls:['SHIFT','PAD_13']};assert.throws(()=>readSelection(JSON.stringify(selection)),/stock Utility/);
 selection.features[0].shortcut.controls=['EXIT','COPY'];assert.throws(()=>readSelection(JSON.stringify(selection)),/reserved/);
 const global=chosen(true);global.features[1].shortcut={controls:['SHIFT','REMAIN'],trigger:'press-last',scope:'normal-ui',rearm:'release-all'};assert.throws(()=>readSelection(JSON.stringify(global)),/starts on the PC/);
 assert.throws(()=>sourceProfile({...blankSelection(),features:[defaultChoice('usb-recorder')]}),/requires Synth/);
});
test('Receipts bind global mask/PC start/config and preserve source-only limits',async()=>{
 const selection=chosen(true),pins=SOURCE_PROFILES[sourceProfile(selection)];
 // Original minimal ELF fixture for metadata/byte checks; no firmware.
 const elf=new Uint8Array(52);elf.set([0x7f,0x45,0x4c,0x46]);const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',elf))].map(value=>value.toString(16).padStart(2,'0')).join('');
 const config={schema:'opensynth.full15-shortcut-global-config/v1',config_bytes:128,explicit_marker:0,feature_mask:3,optional_global:true,shortcut:null,trigger:23,recorder_controls_mask:0,recorder_trigger:0,generated_source_sha256:'a'.repeat(64),blob_sha256:'b'.repeat(64),native_setter_executed:false};
 const receipt={schema:'opensp-full15-selected-source-build-receipt-v2',recipe:SOURCE_RECIPE,run_key:'fixture',source_profile:sourceProfile(selection),selection_sha256:await selectionDigest(selection),source_report_sha256:pins.report,source_successor_sha256:pins.successor,source_composition_sha256:pins.composition,reference_module_sha256:pins.module,module:{bytes:elf.length,sha256:digest},compiler_units:129,fresh_object_count:129,inherited_object_count:0,reference_build_counts:{compiler_units:129,fresh_object_count:129,inherited_object_count:0},shortcut:null,explicit_marker:0,optional_global:true,feature_mask:3,config,APP1_emitted:false,device_operations:false,hardware_qualified:false,native_route_qualified:false,firmware_build_admitted:false,installation_eligible:false};
 assert.equal((await inspectSourceReceipt(selection,receipt,elf)).feature_mask,3);
 await assert.rejects(inspectSourceReceipt(selection,{...receipt,optional_global:false},elf),/receipt/);
 await assert.rejects(inspectSourceReceipt(selection,{...receipt,config:{...config,recorder_controls_mask:1}},elf),/config|shortcut/);
 await assert.rejects(inspectSourceReceipt(selection,{...receipt,native_route_qualified:true},elf),/qualification/);await assert.rejects(inspectSourceReceipt(selection,{...receipt,installation_eligible:true},elf),/qualification/);
});
