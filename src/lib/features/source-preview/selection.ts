import registryData from '../../../content/feature-source-preview/feature-registry.json' with {type:'json'};
import controlsData from '../../../content/feature-source-preview/physical-controls.json' with {type:'json'};
import catalogData from '../../../content/feature-source-preview/feature-catalog-manifest.json' with {type:'json'};

export const registry=registryData;
export const physicalControls=controlsData.controls;
export const catalogDigest=catalogData.catalogDigest;
export type FeatureId=typeof registry.features[number]['id'];
export type ShortcutScope='sampler-idle'|'normal-ui';
export type Shortcut={controls:string[];trigger:'press-last';scope:ShortcutScope;rearm:'release-all'};
export type FeatureChoice={id:string;version:string;shortcut:Shortcut|null};
export type Selection={schema:'opensp-feature-selection';version:2;registryRevision:string;catalogDigest:string;board:'sp-404mkii';profile:string;features:FeatureChoice[]};
export type Issue={code:string;message:string;feature?:string};
export const STORAGE_KEY='opensp.feature-selection.full14-source-preview.v1';
export const LEGACY_STORAGE_KEY='opensp.feature-selection.full14-source-preview.archived';
export const MAX_IMPORT_BYTES=32*1024;
const eligible=new Set(physicalControls.filter(c=>c.shortcut).map(c=>c.id));
const reservedControls=new Set(['DEL','EXIT']);
const exactKeys=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(v,k));
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const overlap=(a:string[],b:string[])=>a.every(c=>b.includes(c))||b.every(c=>a.includes(c));
export function rejectDuplicateJsonKeys(text:string){
  let at=0;
  const whitespace=()=>{while(/\s/.test(text[at]??''))at++;};
  const stringToken=()=>{const start=at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"')return JSON.parse(text.slice(start,at)) as string;}throw new SyntaxError('Unclosed string.');};
  const value=():void=>{
    whitespace();const char=text[at];
    if(char==='"'){stringToken();return;}
    if(char==='['){at++;whitespace();if(text[at]===']'){at++;return;}while(true){value();whitespace();if(text[at]===']'){at++;return;}if(text[at++]!==',')throw new SyntaxError('Invalid array.');}}
    if(char==='{'){
      at++;whitespace();const keys=new Set<string>();if(text[at]==='}'){at++;return;}
      while(true){whitespace();if(text[at]!=='"')throw new SyntaxError('Invalid object key.');const key=stringToken();if(keys.has(key))throw Error(`Duplicate JSON field: ${key}.`);keys.add(key);whitespace();if(text[at++]!==':')throw new SyntaxError('Invalid object field.');value();whitespace();if(text[at]==='}'){at++;return;}if(text[at++]!==',')throw new SyntaxError('Invalid object.');}
    }
    const start=at;while(at<text.length&&!/[\s,\]}]/.test(text[at]))at++;if(start===at)throw new SyntaxError('Invalid JSON value.');JSON.parse(text.slice(start,at));
  };
  value();whitespace();if(at!==text.length)throw new SyntaxError('Unexpected JSON content.');
}
export const controlLabel=(id:string)=>physicalControls.find(c=>c.id===id)?.label??id;
export const featureName=(id:string)=>registry.features.find(f=>f.id===id)?.name??id;
export const shortcutLabel=(shortcut:Shortcut|null)=>shortcut?shortcut.controls.map(controlLabel).join(' + '):'Shared feature chooser';
export const blankSelection=():Selection=>({schema:'opensp-feature-selection',version:2,registryRevision:registry.revision,catalogDigest,board:'sp-404mkii',profile:'roland-5.52-full14-source-preview',features:[]});
export const defaultChoice=(id:string):FeatureChoice=>{const f=registry.features.find(f=>f.id===id);if(!f||!f.shortcutScope)throw Error('Unknown feature or missing shortcut scope.');return {id:f.id,version:f.version,shortcut:f.id==='usb-recorder'?null:{controls:[...f.defaultControls],trigger:'press-last',scope:f.shortcutScope as ShortcutScope,rearm:'release-all'}};};

/** Strict v2 intent import. It never imports code, addresses, receipts or upload commands. */
export function parseSelection(value:unknown):Selection{
  if(!object(value))throw Error('Use an OpenSP feature-selection version 2 configuration.');
  if(value.schema==='opensp-feature-selection'&&value.version===1)throw Error('Version 1 selections are archived and cannot be reinterpreted. Create a new version 2 selection.');
  if(!exactKeys(value,['schema','version','registryRevision','catalogDigest','board','profile','features'])||value.schema!=='opensp-feature-selection'||value.version!==2||value.board!=='sp-404mkii'||typeof value.profile!=='string'||typeof value.registryRevision!=='string'||typeof value.catalogDigest!=='string'||!Array.isArray(value.features))throw Error('Use an OpenSP feature-selection version 2 configuration.');
  if(value.features.length>registry.features.length)throw Error('The configuration contains too many features.');
  const choices:FeatureChoice[]=value.features.map(entry=>{
    if(!object(entry)||!exactKeys(entry,['id','version','shortcut'])||typeof entry.id!=='string'||typeof entry.version!=='string')throw Error('Each feature needs an ID, version and shortcut.');
    let shortcut:Shortcut|null=null;
    if(entry.shortcut!==null){
      const s=entry.shortcut;
      if(!object(s)||!exactKeys(s,['controls','trigger','scope','rearm'])||!Array.isArray(s.controls)||s.controls.length<2||s.controls.length>3||!s.controls.every(c=>typeof c==='string')||s.trigger!=='press-last'||(s.scope!=='sampler-idle'&&s.scope!=='normal-ui')||s.rearm!=='release-all')throw Error('Shortcuts need two or three named SP controls, a final press, a supported feature scope and release-all rearming. Use null for the shared chooser.');
      shortcut={controls:[...s.controls] as string[],trigger:'press-last',scope:s.scope,rearm:'release-all'};
    }
    return {id:entry.id,version:entry.version,shortcut};
  });
  const selection:Selection={schema:'opensp-feature-selection',version:2,registryRevision:value.registryRevision,catalogDigest:value.catalogDigest,board:'sp-404mkii',profile:value.profile,features:choices};
  const result=validateSelection(selection);
  if(result.errors.length)throw Error(result.errors.map(e=>e.message).join(' '));
  return selection;
}

export function readSelection(text:string):Selection{
  if(new TextEncoder().encode(text).byteLength>MAX_IMPORT_BYTES)throw Error('Configuration files must be 32 KiB or smaller.');
  try{rejectDuplicateJsonKeys(text);return parseSelection(JSON.parse(text));}catch(error){if(error instanceof SyntaxError)throw Error('The file is not valid JSON. Export a configuration from OpenSP and try again.');throw error;}
}

function validateCatalogSelection(selection:Selection){
  const errors:Issue[]=[],blockers:Issue[]=[];
  const add=(code:string,message:string,feature?:string)=>errors.push({code,message,feature});
  if(selection.schema!=='opensp-feature-selection'||selection.version!==2)add('selection-version','Only OpenSP feature-selection version 2 is supported.');
  if(selection.registryRevision!==registry.revision)add('registry-version','This configuration uses another feature registry revision. Create a new plan using the current feature versions.');
  if(selection.catalogDigest!==catalogDigest)add('catalog-digest','This configuration uses another feature catalog. Create a new plan using the current catalog.');
  const profile=registry.profiles.find(p=>p.id===selection.profile);
  if(!profile)add('profile','Choose one of the listed firmware bases.');
  else if(!profile.supported)blockers.push({code:'profile-unqualified',message:'No selected-feature adapter is qualified for this firmware base.'});
  const seen=new Set<string>();
  for(const choice of selection.features){
    const f=registry.features.find(f=>f.id===choice.id);
    if(!f){add('feature-id','The configuration contains an unregistered feature.');continue;}
    if(seen.has(f.id))add('duplicate-feature',`${f.name} is selected more than once.`,f.id);
    seen.add(f.id);
    if(!f.selectable)add('outside-release',`${f.name} is planned for a later release and cannot be included in this configuration.`,f.id);
    if(choice.version!==f.version)add('feature-version',`${f.name} uses another feature version. Create a new selection for the current version.`,f.id);
    if(!f.profiles.some(p=>p===selection.profile))blockers.push({code:'feature-profile',message:`${f.name} has no qualified adapter for this firmware base.`,feature:f.id});
    if(!f.deliveryReady)blockers.push({code:'feature-unready',message:f.blocker,feature:f.id});
    const s=choice.shortcut;
    if(!s)continue;
    if(s.trigger!=='press-last'||s.scope!==f.shortcutScope||s.rearm!=='release-all')add('shortcut-mode',`${f.name}: use its registered ${f.shortcutScope??'feature-specific'} shortcut scope, press-last trigger and release-all rearming.`,f.id);
    if(s.controls.length<2||s.controls.length>3||s.controls.some(c=>!eligible.has(c)))add('shortcut-controls',`${f.name}: choose two or three mapped SP buttons or pads.`,f.id);
    if(new Set(s.controls).size!==s.controls.length)add('shortcut-duplicate',`${f.name}: choose a different control in each shortcut position.`,f.id);
    if(s.controls.some(c=>reservedControls.has(c)))add('reserved-control',`${f.name}: DEL and EXIT are reserved for update entry and leaving a feature. Choose other controls.`,f.id);
    if(s.controls.includes('SHIFT')&&s.controls.includes('PAD_13'))add('reserved-utility',`${f.name}: SHIFT + PAD 13 opens stock Utility. Choose another shortcut.`,f.id);
  }
  for(let i=0;i<selection.features.length;i++)for(let j=i+1;j<selection.features.length;j++){
    const a=selection.features[i],b=selection.features[j];
    if(a.shortcut&&b.shortcut&&overlap(a.shortcut.controls,b.shortcut.controls))add('shortcut-overlap',`${featureName(a.id)} and ${featureName(b.id)} have matching or overlapping shortcuts. Change one shortcut or use the shared chooser.`,b.id);
    const fa=registry.features.find(f=>f.id===a.id),fb=registry.features.find(f=>f.id===b.id);
    if(fa&&fb&&fa.exclusiveResources.some(r=>fb.exclusiveResources.some(q=>q===r)))blockers.push({code:'resource-conflict',message:`${fa.name} and ${fb.name} currently replace the same Generator entry. A shared firmware dispatcher must resolve that conflict.`,feature:b.id});
  }
  if(selection.features.length)blockers.push({code:'composition-unverified',message:'No hash-pinned composed APP1 image, linked memory report or matched USB delivery receipt exists for this selection.'});
  return {valid:errors.length===0,errors,blockers,buildReady:false,uploadReady:false,memoryKnown:false};
}

export function exportSelection(selection:Selection):string{
  const normalized=parseSelection(selection);
  normalized.features.sort((a,b)=>a.id.localeCompare(b.id,'en'));
  return JSON.stringify(normalized,null,2)+'\n';
}

export function validateSelection(selection:Selection){
 const result=validateCatalogSelection(selection);
 for(const choice of selection.features){
  if(choice.id==='synth'&&choice.shortcut&&JSON.stringify(choice.shortcut.controls)!==JSON.stringify(['SHIFT','RECORD_SETTING']))
   result.errors.push({code:'unsupported-full14-shortcut',feature:choice.id,message:'Custom openSynth shortcuts require the Full14 dispatcher port. Use the native SHIFT + RECORD SETTING entry for this source preview.'});
  if(choice.id==='usb-recorder'&&choice.shortcut)
   result.errors.push({code:'unsupported-full14-shortcut',feature:choice.id,message:'This optional global source preview uses the PC recorder. Hardware recorder shortcuts require the Full14 dispatcher port.'});
 }
 if(selection.features.length&&!selection.features.some(f=>f.id==='synth'))
  result.errors.push({code:'unregistered-recorder-only-profile',feature:'usb-recorder',message:'A recorder-only Full14 source profile is not registered. Select openSynth with the optional recorder, or use the historical feature preview.'});
 return {...result,valid:result.errors.length===0,sourceBuildReady:result.errors.length===0&&selection.profile==='roland-5.52-full14-source-preview'&&selection.features.some(f=>f.id==='synth')};
}
export function sourceProfile(selection:Selection){
 const result=validateSelection(selection);if(!result.sourceBuildReady)throw Error(result.errors.map(error=>error.message).join(' ')||'Select openSynth to build this source preview.');
 return selection.features.some(f=>f.id==='usb-recorder')?'full14-source-preview-global':'full14-source-preview';
}
export function sourceShortcutLabel(id:string,shortcut:Shortcut|null){
 if(id==='usb-recorder'&&!shortcut)return 'PC recorder';
 if(id==='synth'&&!shortcut)return 'Native generator chooser';
 return shortcutLabel(shortcut);
}
