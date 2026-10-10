import copy from '../content/feature-source-preview-full15/features.json';
import {blankSelection,defaultChoice,defaultSynthShortcut,readSelection,exportSelection,validateSelection,featureName,sourceShortcutLabel,STORAGE_KEY,MAX_IMPORT_BYTES} from '../lib/features/source-preview-full15/selection';
const root=document.querySelector<HTMLElement>('[data-feature-picker]');
if(root){
 const find=<T extends HTMLElement>(selector:string)=>{const element=root.querySelector<T>(selector);if(!element)throw Error('Missing source-picker control.');return element;};
 let selection=blankSelection(),revision=0;
 const error=find<HTMLElement>('[data-import-error]'),status=find<HTMLElement>('[data-save-status]');
 const message=(text:string)=>{error.textContent=text;error.hidden=!text;};
 try{const saved=localStorage.getItem(STORAGE_KEY);if(saved)selection=readSelection(saved);}catch(e){message(e instanceof Error?e.message:'Saved source choices could not be loaded.');}
 root.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,button').forEach(control=>{if(!control.matches('[data-upload],[data-build],[data-selectable="false"]'))control.disabled=false;});
 const render=()=>{
  find<HTMLSelectElement>('[data-profile]').value=selection.profile;
  const result=validateSelection(selection);
  root.querySelectorAll<HTMLInputElement>('[data-choice]').forEach(control=>control.checked=selection.features.some(feature=>feature.id===control.dataset.choice));
  root.querySelectorAll<HTMLFieldSetElement>('[data-shortcut]').forEach(field=>{
   const choice=selection.features.find(feature=>feature.id===field.dataset.shortcut);field.hidden=!choice;if(!choice)return;
   field.querySelector<HTMLSelectElement>('[data-entry]')!.value=choice.shortcut?'chord':'chooser';
   if(choice.id==='usb-recorder'){const entry=field.querySelector<HTMLSelectElement>('[data-entry]')!;entry.disabled=true;entry.value='chooser';}
   field.querySelector<HTMLElement>('[data-chord-fields]')!.hidden=!choice.shortcut;
   if(choice.shortcut)field.querySelectorAll<HTMLSelectElement>('[data-chord-feature]').forEach(control=>control.value=choice.shortcut!.controls[Number(control.dataset.position)]??'');
   field.querySelector<HTMLElement>('[data-shortcut-preview]')!.textContent=sourceShortcutLabel(choice.id,choice.shortcut);
  });
  find<HTMLElement>('[data-empty-shortcuts]').hidden=selection.features.length>0;
  find<HTMLElement>('[data-selection-count]').textContent=selection.features.length?`${selection.features.length} source feature${selection.features.length===1?'':'s'} selected`:copy.emptySummary;
  find<HTMLUListElement>('[data-selection-list]').replaceChildren(...selection.features.map(feature=>{const row=document.createElement('li'),name=document.createElement('span'),keys=document.createElement('small');name.textContent=featureName(feature.id);keys.textContent=sourceShortcutLabel(feature.id,feature.shortcut);row.append(name,keys);return row;}));
  const issues=document.createElement('ul');issues.setAttribute('data-validation-errors','');
  for(const issue of result.errors){const item=document.createElement('li');item.textContent=issue.message;issues.append(item);}
  find<HTMLElement>('[data-validation]').replaceChildren(...(result.errors.length?[issues]:[]));
  find<HTMLButtonElement>('[data-export]').disabled=!result.valid||!selection.features.length;
  find<HTMLButtonElement>('[data-build]').disabled=!result.sourceBuildReady;
  find<HTMLElement>('[data-build-state]').textContent=result.sourceBuildReady?'Source module build available':selection.features.length?'Fix the selection before building':'Select source features to build';
 };
 const update=()=>{revision++;message('');render();try{localStorage.setItem(STORAGE_KEY,JSON.stringify(selection));status.textContent=copy.saved;}catch{status.textContent=copy.storageUnavailable;}};
 root.querySelectorAll<HTMLInputElement>('[data-choice]').forEach(control=>control.addEventListener('change',()=>{const id=control.dataset.choice!;if(control.checked&&!selection.features.some(feature=>feature.id===id))selection.features.push(defaultChoice(id));else if(!control.checked)selection.features=selection.features.filter(feature=>feature.id!==id);update();}));
 root.querySelectorAll<HTMLSelectElement>('[data-entry]').forEach(control=>control.addEventListener('change',()=>{const feature=selection.features.find(value=>value.id===control.dataset.entry);if(!feature)return;feature.shortcut=control.value==='chooser'?null:feature.id==='usb-recorder'?{controls:['SHIFT','REMAIN'],trigger:'press-last',scope:'normal-ui',rearm:'release-all'}:defaultSynthShortcut();update();}));
 root.querySelectorAll<HTMLSelectElement>('[data-chord-feature]').forEach(control=>control.addEventListener('change',()=>{const feature=selection.features.find(value=>value.id===control.dataset.chordFeature);if(!feature?.shortcut)return;feature.shortcut.controls=Array.from(root.querySelectorAll<HTMLSelectElement>(`[data-chord-feature="${feature.id}"]`)).map(value=>value.value).filter(Boolean);update();}));
 find<HTMLInputElement>('[data-import]').addEventListener('change',async event=>{const input=event.currentTarget as HTMLInputElement,file=input.files?.[0],current=++revision;input.value='';if(!file)return;try{if(file.size>MAX_IMPORT_BYTES)throw Error('Configuration files must be 32 KiB or smaller.');const text=await file.text();if(current===revision){selection=readSelection(text);update();}}catch(e){if(current===revision)message(e instanceof Error?e.message:'Source configuration import failed.');}});
 find<HTMLButtonElement>('[data-reset]').addEventListener('click',()=>{selection=blankSelection();update();});
 find<HTMLButtonElement>('[data-export]').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([exportSelection(selection)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='opensp-full15-synth-shortcut-source-selection.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 find<HTMLButtonElement>('[data-build]').addEventListener('click',()=>{if(!validateSelection(selection).sourceBuildReady)return;update();location.href='/features/source-preview-full15/local-build/';});
 render();find<HTMLElement>('[data-no-script]').hidden=true;root.dataset.ready='true';
}
