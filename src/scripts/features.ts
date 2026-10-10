import copy from '../content/features.json';
import {blankSelection,defaultChoice,readSelection,exportSelection,validateSelection,featureName,shortcutLabel,STORAGE_KEY,LEGACY_STORAGE_KEY,MAX_IMPORT_BYTES} from '../lib/features/selection';
import {createReceiptSession} from '../lib/features/receiptSession';

const root=document.querySelector<HTMLElement>('[data-feature-picker]');
if(root){
  const find=<T extends HTMLElement>(selector:string)=>{const node=root.querySelector<T>(selector);if(!node)throw Error('Missing feature picker control: '+selector);return node;};
  const profile=find<HTMLSelectElement>('[data-profile]'),status=find<HTMLElement>('[data-save-status]'),error=find<HTMLElement>('[data-import-error]'),validation=find<HTMLElement>('[data-validation]'),list=find<HTMLUListElement>('[data-selection-list]'),exportButton=find<HTMLButtonElement>('[data-export]');
  let selection=blankSelection();
  let persistent=true;
  let archivedV1=false;
  let importRevision=0;
  try{const saved=localStorage.getItem(STORAGE_KEY);if(saved)selection=readSelection(saved);else archivedV1=localStorage.getItem(LEGACY_STORAGE_KEY)!==null;}catch(e){persistent=false;error.textContent=e instanceof Error?`Saved choices could not be loaded: ${e.message}`:'Saved choices could not be loaded.';error.hidden=false;}
  root.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,button').forEach(c=>{if(!c.matches('[data-build],[data-upload],[data-receipt-clear],[data-selectable="false"]'))c.disabled=false;});
  const receiptSession=createReceiptSession(selection),receiptInput=find<HTMLInputElement>('[data-receipt]'),receiptClear=find<HTMLButtonElement>('[data-receipt-clear]');
  receiptSession.subscribe(snapshot=>{
    find<HTMLElement>('[data-receipt-status]').textContent=snapshot.message??(snapshot.phase==='reading'?'Reading the local receipt.':snapshot.phase==='checking'?'Checking receipt metadata against your choices.':snapshot.phase==='invalid'?'This receipt does not match the current configuration or supported package contract.':copy.receiptEmpty);
    const issues=find<HTMLUListElement>('[data-receipt-issues]');
    issues.replaceChildren(...(snapshot.inspection?.issues??[]).map(issue=>{const li=document.createElement('li');li.textContent=issue.message;return li;}));
    issues.hidden=!issues.children.length;
    receiptClear.disabled=snapshot.phase==='empty';
    find<HTMLElement>('[data-receipt-result]').setAttribute('aria-busy',String(snapshot.phase==='reading'||snapshot.phase==='checking'));
  });
  receiptInput.addEventListener('change',event=>{const file=(event.currentTarget as HTMLInputElement).files?.[0];receiptInput.value='';if(file)void receiptSession.selectFile(file);});
  receiptClear.addEventListener('click',()=>{receiptSession.clear();receiptInput.value='';});
  const message=(text:string)=>{error.textContent=text;error.hidden=!text;};
  if(archivedV1)message('A version 1 selection is still saved in this browser. Version 1 cannot be reinterpreted; choose features again to create a version 2 selection.');
  const render=()=>{
    profile.value=selection.profile;
    const result=validateSelection(selection);
    root.querySelectorAll<HTMLInputElement>('[data-choice]').forEach(c=>c.checked=selection.features.some(f=>f.id===c.dataset.choice));
    root.querySelectorAll<HTMLFieldSetElement>('[data-shortcut]').forEach(field=>{const choice=selection.features.find(f=>f.id===field.dataset.shortcut);field.hidden=!choice;if(!choice)return;const mode=field.querySelector<HTMLSelectElement>('[data-entry]')!;mode.value=choice.shortcut?'chord':'chooser';field.querySelector<HTMLElement>('[data-chord-fields]')!.hidden=!choice.shortcut;if(choice.shortcut)field.querySelectorAll<HTMLSelectElement>('[data-chord-feature]').forEach(c=>c.value=choice.shortcut!.controls[Number(c.dataset.position)]??'');field.querySelector<HTMLElement>('[data-shortcut-preview]')!.textContent=shortcutLabel(choice.shortcut);});
    find<HTMLElement>('[data-empty-shortcuts]').hidden=selection.features.length>0;
    find<HTMLElement>('[data-selection-count]').textContent=selection.features.length?`${selection.features.length} ${selection.features.length===1?'feature':'features'} selected`:copy.emptySummary;
    list.replaceChildren(...selection.features.map(f=>{const li=document.createElement('li'),name=document.createElement('span'),shortcut=document.createElement('small');name.textContent=featureName(f.id);shortcut.textContent=shortcutLabel(f.shortcut);li.append(name,shortcut);return li;}));
    const errors=document.createElement('ul');errors.setAttribute('data-validation-errors','');for(const issue of result.errors){const li=document.createElement('li');li.textContent=issue.message;errors.append(li);}
    const blockers=document.createElement('ul');blockers.setAttribute('data-build-blockers','');for(const issue of result.blockers){const li=document.createElement('li');li.textContent=issue.message;blockers.append(li);}
    validation.replaceChildren(...(result.errors.length?[errors]:[]),...(result.blockers.length?[blockers]:[]));
    exportButton.disabled=!result.valid||!selection.features.length;
  };
  const persist=()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(selection));persistent=true;status.textContent=copy.saved;}catch{persistent=false;status.textContent=copy.storageUnavailable;}};
  const update=()=>{importRevision++;receiptSession.setSelection(selection);message('');render();persist();};
  profile.addEventListener('change',()=>{selection.profile=profile.value;update();});
  root.querySelectorAll<HTMLInputElement>('[data-choice]').forEach(c=>c.addEventListener('change',()=>{const id=c.dataset.choice!;if(c.checked&&!selection.features.some(f=>f.id===id))selection.features.push(defaultChoice(id));else if(!c.checked)selection.features=selection.features.filter(f=>f.id!==id);update();}));
  root.querySelectorAll<HTMLSelectElement>('[data-entry]').forEach(c=>c.addEventListener('change',()=>{const f=selection.features.find(f=>f.id===c.dataset.entry);if(f){f.shortcut=c.value==='chooser'?null:defaultChoice(f.id).shortcut;update();}}));
  root.querySelectorAll<HTMLSelectElement>('[data-chord-feature]').forEach(c=>c.addEventListener('change',()=>{const f=selection.features.find(f=>f.id===c.dataset.chordFeature);if(!f?.shortcut)return;const fields=root.querySelectorAll<HTMLSelectElement>(`[data-chord-feature="${f.id}"]`);f.shortcut.controls=Array.from(fields).map(c=>c.value).filter(Boolean);update();}));
  find<HTMLInputElement>('[data-import]').addEventListener('change',async event=>{
    const input=event.currentTarget as HTMLInputElement,file=input.files?.[0],revision=++importRevision;
    input.value='';if(!file)return;message('');
    try{
      if(file.size>MAX_IMPORT_BYTES)throw Error('Configuration files must be 32 KiB or smaller.');
      const text=await file.text();if(revision!==importRevision)return;
      const candidate=readSelection(text);selection=candidate;update();
      status.textContent=persistent?'Configuration imported and saved in this browser.':`Configuration imported. ${copy.storageUnavailable}`;
    }catch(e){if(revision===importRevision)message(e instanceof Error?e.message:'The configuration could not be imported.');}
  });
  find<HTMLButtonElement>('[data-reset]').addEventListener('click',()=>{selection=blankSelection();update();status.textContent='Choices reset.';});
  exportButton.addEventListener('click',()=>{try{const text=exportSelection(selection),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='opensp-feature-selection-v2.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Configuration exported. It is a feature plan, not a firmware file.';}catch(e){message(e instanceof Error?e.message:'The configuration could not be exported.');}});
  render();if(!persistent)status.textContent=copy.storageUnavailable;
  find<HTMLElement>('[data-no-script]').hidden=true;
  root.dataset.ready='true';
}
