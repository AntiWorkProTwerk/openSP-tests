import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import * as legacy from '../src/lib/features/selection.ts';
import {blankSelection,defaultChoice,readSelection,exportSelection,validateSelection,sourceProfile,STORAGE_KEY} from '../src/lib/features/source-preview/selection.ts';
import {inspectSourceReceipt,selectionDigest,SOURCE_RECIPE,SOURCE_PROFILES} from '../src/lib/features/source-preview/receipt.ts';
import {readHelperConnection} from '../src/lib/features/helperConnection.ts';
const choose=(...ids)=>({...blankSelection(),features:ids.map(defaultChoice)});
test('P6S stays a separate unchanged feature version and browser selection',()=>{
 assert.equal(legacy.defaultChoice('synth').version,'p6s-1');assert.notEqual(legacy.STORAGE_KEY,STORAGE_KEY);
 const selected={...legacy.blankSelection(),features:[legacy.defaultChoice('synth')]};assert.equal(legacy.readSelection(legacy.exportSelection(selected)).features[0].version,'p6s-1');
 assert.throws(()=>readSelection(legacy.exportSelection(selected)),/registry|catalog|version|profile/);
});
test('Source selector maps exact core or optional-global profiles and refuses unsupported combinations',()=>{
 assert.equal(sourceProfile(choose('synth')),'full14-source-preview');assert.equal(sourceProfile(choose('synth','usb-recorder')),'full14-source-preview-global');
 assert.equal(choose('synth','usb-recorder').features[1].shortcut,null);assert.throws(()=>sourceProfile(choose('usb-recorder')),/recorder-only/);
 const custom=choose('synth');custom.features[0].shortcut.controls=['SHIFT','COPY'];assert.throws(()=>readSelection(JSON.stringify(custom)),/dispatcher port/);
 const overlapping=choose('synth','usb-recorder');overlapping.features[1].shortcut={...overlapping.features[0].shortcut,scope:'normal-ui'};assert.equal(validateSelection(overlapping).valid,false);
});
test('Source receipt and complete original ELF fixture match selection without granting installation',async()=>{
 // Original minimal bytes test the receipt contract; they are not native firmware.
 const bytes=new Uint8Array(52);bytes.set([0x7f,0x45,0x4c,0x46]);const selection=choose('synth'),pins=SOURCE_PROFILES['full14-source-preview'];
 const receipt={schema:'opensp-full14-source-module-build-receipt-v1',recipe:SOURCE_RECIPE,run_key:'fixture',source_profile:'full14-source-preview',selection_sha256:await selectionDigest(selection),source_report_sha256:pins.report,reference_module_sha256:pins.module,
 module:{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},compiler_units:113,APP1_emitted:false,device_operations:false,hardware_qualified:false,firmware_build_admitted:false,installation_eligible:false};
 assert.equal((await inspectSourceReceipt(selection,receipt,bytes)).installation_eligible,false);
 await assert.rejects(inspectSourceReceipt(selection,{...receipt,hardware_qualified:true},bytes),/qualification|installation/);
 await assert.rejects(inspectSourceReceipt(choose('synth','usb-recorder'),receipt,bytes),/selection|profile/);
});
test('Shared helper connection parser keeps the loopback capability out of the origin',()=>{
 const token='a'.repeat(43),connection=readHelperConnection('http://127.0.0.1:8080/#'+token);assert.equal(connection.origin,'http://127.0.0.1:8080');assert.equal(connection.capability,token);
 assert.throws(()=>readHelperConnection('https://example.com/#'+token),/exact loopback/);
});
