import {readSelection,exportSelection,sourceProfile,type Selection} from './selection.ts';
export const SOURCE_RECIPE='opensp-full14-source-preview-module-builder-v1';
export const SOURCE_PROFILES={
 'full14-source-preview':{report:'cdd541175b66767192ab8fd170cdd43c1f7128abeb1e183a25572b9944f477fa',module:'fea923ee6932a28b83549489114166e7c30cef3ad4c3ad83533997fb5ffdfb09'},
 'full14-source-preview-global':{report:'d482999e86c4ec8c98b39ee6a537f0f4628a5566ec277326748bd89175b4139f',module:'829bcaf6c2478947aa2d0d4404baa9b853111201883333f51441bb67f36f6617'}
} as const;
export type SourceReceipt={schema:'opensp-full14-source-module-build-receipt-v1';recipe:typeof SOURCE_RECIPE;run_key:string;source_profile:keyof typeof SOURCE_PROFILES;selection_sha256:string;source_report_sha256:string;reference_module_sha256:string;module:{bytes:number;sha256:string};compiler_units:number;APP1_emitted:false;device_operations:false;hardware_qualified:false;firmware_build_admitted:false;installation_eligible:false};
export async function selectionDigest(selection:Selection){
 const canonical=exportSelection(readSelection(exportSelection(selection)));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function inspectSourceReceipt(selection:Selection,value:unknown,moduleBytes?:Uint8Array){
 const receipt=value as SourceReceipt,profile=sourceProfile(selection),pins=SOURCE_PROFILES[profile];
 if(!receipt||receipt.schema!=='opensp-full14-source-module-build-receipt-v1'||receipt.recipe!==SOURCE_RECIPE||receipt.source_profile!==profile||receipt.selection_sha256!==await selectionDigest(selection)||receipt.source_report_sha256!==pins.report||receipt.reference_module_sha256!==pins.module||receipt.compiler_units!==113||!receipt.module||!Number.isSafeInteger(receipt.module.bytes)||receipt.module.bytes<52||receipt.module.bytes>2*1024*1024||!/^[0-9a-f]{64}$/.test(receipt.module.sha256)||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(receipt.run_key))throw Error('The source-module receipt does not match this exact selection and source profile.');
 for(const flag of ['APP1_emitted','device_operations','hardware_qualified','firmware_build_admitted','installation_eligible'] as const)if(receipt[flag]!==false)throw Error('This source preview cannot grant firmware installation or hardware qualification.');
 if(moduleBytes){
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(moduleBytes)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  if(moduleBytes.length!==receipt.module.bytes||hash!==receipt.module.sha256||moduleBytes[0]!==0x7f||moduleBytes[1]!==0x45||moduleBytes[2]!==0x4c||moduleBytes[3]!==0x46)throw Error('The module bytes do not match the source receipt.');
 }
 return receipt;
}
