import {readSelection,exportSelection,sourceProfile,featureName,sourceShortcutLabel,STORAGE_KEY,type Selection} from '../lib/features/source-preview/selection.ts';
import {createSourceHelperClient} from '../lib/features/source-preview/helper.ts';
import {selectionDigest,inspectSourceReceipt,type SourceReceipt} from '../lib/features/source-preview/receipt.ts';
const root=document.querySelector<HTMLElement>('[data-source-preview-build]');
if(root){
 const find=<T extends HTMLElement>(selector:string)=>{const element=root.querySelector<T>(selector);if(!element)throw Error('Missing source-build control.');return element;};
 const selectionInput=find<HTMLInputElement>('[data-source-selection]'),connect=find<HTMLButtonElement>('[data-source-connect]'),build=find<HTMLButtonElement>('[data-source-build]'),latest=find<HTMLButtonElement>('[data-source-latest]'),saveReceipt=find<HTMLButtonElement>('[data-source-save-receipt]'),saveModule=find<HTMLButtonElement>('[data-source-save-module]');
 let selection:Selection|null=null,client:ReturnType<typeof createSourceHelperClient>|null=null,busy=false,revision=0,receipt:SourceReceipt|null=null,moduleBytes:Uint8Array<ArrayBuffer>|null=null;
 const error=(message:string)=>{const element=find<HTMLElement>('[data-source-error]');element.textContent=message;element.hidden=!message;};
 const status=(selector:string,message:string)=>find<HTMLElement>(selector).textContent=message;
 const controls=()=>{selectionInput.disabled=busy;connect.disabled=busy;build.disabled=busy||!selection||!client;latest.disabled=busy||!selection||!client;saveReceipt.disabled=busy||!receipt;saveModule.disabled=busy||!moduleBytes;};
 const clear=()=>{revision++;receipt=null;moduleBytes=null;find<HTMLElement>('[data-source-proof]').hidden=true;status('[data-source-result-status]','No matching source build inspected.');controls();};
 const setSelection=(text:string)=>{const parsed=readSelection(text);sourceProfile(parsed);selection=parsed;clear();error('');status('[data-source-selection-status]',sourceProfile(parsed));find<HTMLUListElement>('[data-source-selection-list]').replaceChildren(...parsed.features.map(feature=>{const item=document.createElement('li'),name=document.createElement('span'),keys=document.createElement('small');name.textContent=featureName(feature.id);keys.textContent=sourceShortcutLabel(feature.id,feature.shortcut);item.append(name,keys);return item;}));controls();};
 async function inspectJob(runKey:string,current:number){
  if(!client||!selection)throw Error('Connect the source helper and choose features first.');const chosen=selection;
  const [receiptResponse,moduleResponse]=await Promise.all([client.artifact(runKey,'receipt'),client.artifact(runKey,'module')]);
  if(Number(receiptResponse.headers.get('Content-Length'))>32768||Number(moduleResponse.headers.get('Content-Length'))>2*1024*1024)throw Error('The source artifact exceeds its bound.');
  const metadata=await receiptResponse.json(),bytes=new Uint8Array(await moduleResponse.arrayBuffer());if(current!==revision)return;
  const result=await inspectSourceReceipt(chosen,metadata,bytes);if(current!==revision)return;receipt=result;moduleBytes=bytes;
  const proof=find<HTMLDListElement>('[data-source-proof]');proof.replaceChildren();
  for(const [name,value]of [['Profile',result.source_profile],['Selection SHA256',result.selection_sha256],['Module bytes',String(result.module.bytes)],['Module SHA256',result.module.sha256],['Reference source report',result.source_report_sha256]]){const term=document.createElement('dt'),definition=document.createElement('dd');term.textContent=name;definition.textContent=value;proof.append(term,definition);}
  proof.hidden=false;status('[data-source-result-status]','The selected source module and complete ELF bytes match their receipt. Firmware installation remains disabled.');controls();
 }
 selectionInput.addEventListener('change',async()=>{const file=selectionInput.files?.[0],current=++revision;selectionInput.value='';if(!file)return;try{if(file.size>32768)throw Error('Source configuration must be 32 KiB or smaller.');const text=await file.text();if(current===revision)setSelection(text);}catch(e){if(current===revision)error(e instanceof Error?e.message:'Source import failed.');}});
 connect.addEventListener('click',async()=>{busy=true;controls();error('');const current=++revision;try{const helper=createSourceHelperClient(find<HTMLInputElement>('[data-source-connection]').value.trim());await helper.state();if(current!==revision)return;client=helper;status('[data-source-helper-status]','Connected to the matching Full14 source helper.');}catch(e){client=null;error(e instanceof Error?e.message:'Source helper connection failed.');}finally{busy=false;controls();}});
 build.addEventListener('click',async()=>{
  if(!selection||!client)return;const chosen=selection,helper=client;clear();const current=revision;busy=true;controls();error('');
  try{const hash=await selectionDigest(chosen),runKey=`source-${hash.slice(0,12)}-${Date.now().toString(36)}`,job=await helper.build(runKey,exportSelection(chosen));if(job.run_key!==runKey||job.phase!=='building')throw Error('The helper did not accept this exact source request.');status('[data-source-helper-status]','Compiling the selected source module locally.');
   for(let poll=0;poll<1200;poll++){if(current!==revision)return;await new Promise(accept=>setTimeout(accept,1000));const result=await helper.job(runKey);if(result.run_key!==runKey)throw Error('The helper returned another source run.');if(result.phase==='failed')throw Error(result.message??'Source compilation refused.');if(result.phase==='checked'){await inspectJob(runKey,current);if(current===revision)status('[data-source-helper-status]','Selected source module finished. No firmware or device command was emitted.');return;}if(!['building','checking'].includes(result.phase))throw Error('The helper returned an unsupported phase.');}
   throw Error('The source helper is still running. Keep its terminal open and inspect the result later.');
  }catch(e){if(current===revision)error(e instanceof Error?e.message:'Source build failed.');}finally{busy=false;controls();}
 });
 latest.addEventListener('click',async()=>{if(!selection||!client)return;busy=true;controls();error('');const current=++revision;try{const hash=await selectionDigest(selection),state=await client.state(),job=state.jobs.filter((value:{phase:string;receipt?:SourceReceipt})=>value.phase==='checked'&&value.receipt?.selection_sha256===hash).at(-1);if(!job)throw Error('The helper has no completed source build matching these choices.');await inspectJob(job.run_key,current);}catch(e){if(current===revision)error(e instanceof Error?e.message:'Source inspection failed.');}finally{busy=false;controls();}});
 const download=(bytes:BlobPart,name:string,type:string)=>{const url=URL.createObjectURL(new Blob([bytes],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 saveReceipt.addEventListener('click',()=>{if(receipt)download(JSON.stringify(receipt,null,2)+'\n',receipt.run_key+'-source-receipt.json','application/json');});
 saveModule.addEventListener('click',()=>{if(receipt&&moduleBytes)download(moduleBytes,receipt.run_key+'-non-installable.elf','application/octet-stream');});
 find<HTMLInputElement>('[data-source-connection]').disabled=false;const command=find<HTMLElement>('[data-source-helper-command]');command.textContent=command.textContent?.replace('LOCAL_PREVIEW_ORIGIN',location.origin)??'';
 try{const saved=localStorage.getItem(STORAGE_KEY);if(saved)setSelection(saved);}catch(e){error(e instanceof Error?e.message:'Saved source selection could not be loaded.');}
 window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY&&event.newValue){try{setSelection(event.newValue);}catch{selection=null;clear();error('The changed source selection is unsupported. Return to the Full14 picker.');}}});
 controls();find<HTMLElement>('[data-source-no-script]').hidden=true;
}
