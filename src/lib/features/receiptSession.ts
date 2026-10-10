import {inspectLocalBuildReceipt,readLocalBuildReceipt,MAX_RECEIPT_BYTES,type BuildReceiptInspection} from './buildReceipt.ts';
import {exportSelection,parseSelection,type Selection} from './selection.ts';

export type ReceiptSessionPhase='empty'|'reading'|'checking'|'inspected'|'invalid'|'error'|'unavailable';
export type ReceiptSessionSnapshot={phase:ReceiptSessionPhase;inspection:BuildReceiptInspection|null;message:string|null};
export type LocalReceiptFile={size:number;text:()=>Promise<string>};
export type ReceiptSessionOptions={inspect?:typeof inspectLocalBuildReceipt;hasSubtleCrypto?:()=>boolean};

const messages={
  tooLarge:'Build receipts must be 128 KiB or smaller.',
  unreadable:'The local receipt could not be read. Choose it again to retry.',
  malformed:'This receipt could not be checked. Choose a supported OpenSP build receipt JSON file.',
  unavailable:'This browser cannot check receipt hashes because Web Crypto is unavailable.',
  selection:'The current feature selection could not be checked.'
};

const empty=():ReceiptSessionSnapshot=>({phase:'empty',inspection:null,message:null});
const copyInspection=(inspection:BuildReceiptInspection|null):BuildReceiptInspection|null=>inspection?{
  ...inspection,
  issues:inspection.issues.map(issue=>({...issue})),
  summary:inspection.summary?{
    ...inspection.summary,
    candidate:inspection.summary.candidate?{...inspection.summary.candidate}:null,
    pendingGates:[...inspection.summary.pendingGates]
  }:null
}:null;
const copySnapshot=(snapshot:ReceiptSessionSnapshot):ReceiptSessionSnapshot=>({...snapshot,inspection:copyInspection(snapshot.inspection)});
const availableCrypto=()=>typeof globalThis.crypto?.subtle?.digest==='function';

/** Keep one local receipt inspection bound to the current canonical selection. */
export function createReceiptSession(initialSelection:Selection,options:ReceiptSessionOptions={}){
  const inspect=options.inspect??inspectLocalBuildReceipt;
  const hasSubtleCrypto=options.hasSubtleCrypto??availableCrypto;
  let selection=parseSelection(initialSelection),selectionKey=exportSelection(selection),generation=0;
  let selectionValid=true;
  let snapshot=empty();
  const listeners=new Set<(snapshot:ReceiptSessionSnapshot)=>void>();

  const publish=()=>{
    for(const listener of listeners)listener(copySnapshot(snapshot));
  };
  const set=(next:ReceiptSessionSnapshot)=>{snapshot=next;publish();};
  const invalidate=()=>{generation++;set(empty());};

  return {
    getSnapshot:()=>copySnapshot(snapshot),
    subscribe(listener:(snapshot:ReceiptSessionSnapshot)=>void){
      listeners.add(listener);listener(copySnapshot(snapshot));
      return ()=>{listeners.delete(listener);};
    },
    setSelection(next:Selection){
      let parsed:Selection,key:string;
      try{parsed=parseSelection(next);key=exportSelection(parsed);}catch{
        selectionValid=false;generation++;set({phase:'error',inspection:null,message:messages.selection});return;
      }
      if(selectionValid&&key===selectionKey)return;
      generation++;selectionValid=true;selection=parsed;selectionKey=key;set(empty());
    },
    async selectFile(file:LocalReceiptFile){
      const current=++generation,selectionAtStart=selection,selectionKeyAtStart=selectionKey;
      if(!selectionValid){set({phase:'error',inspection:null,message:messages.selection});return;}
      set({phase:'reading',inspection:null,message:null});
      if(!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX_RECEIPT_BYTES){
        if(current===generation)set({phase:'invalid',inspection:null,message:messages.tooLarge});
        return;
      }
      if(!hasSubtleCrypto()){
        if(current===generation)set({phase:'unavailable',inspection:null,message:messages.unavailable});
        return;
      }
      let text:string;
      try{text=await file.text();}catch{
        if(current===generation)set({phase:'error',inspection:null,message:messages.unreadable});
        return;
      }
      if(current!==generation||selectionKeyAtStart!==selectionKey)return;
      let value:unknown;
      try{value=readLocalBuildReceipt(text);}catch{
        if(current===generation)set({phase:'invalid',inspection:null,message:messages.malformed});
        return;
      }
      if(current!==generation||selectionKeyAtStart!==selectionKey)return;
      set({phase:'checking',inspection:null,message:null});
      try{
        const inspection=await inspect(selectionAtStart,value);
        if(current!==generation||selectionKeyAtStart!==selectionKey)return;
        set({phase:inspection.valid&&inspection.matchesSelection?'inspected':'invalid',inspection,message:inspection.valid&&inspection.matchesSelection?'The checker confirms receipt metadata for this selection. Package contents and device qualification remain unverified. Downloads, uploads and release approval stay disabled.':null});
      }catch{
        if(current!==generation||selectionKeyAtStart!==selectionKey)return;
        if(!hasSubtleCrypto())set({phase:'unavailable',inspection:null,message:messages.unavailable});
        else set({phase:'invalid',inspection:null,message:messages.malformed});
      }
    },
    cancel(){invalidate();},
    clear(){invalidate();}
  };
}
