import {admitRootSealedLocalBenchCandidate} from './local-bench-v1.ts';
import {readRetainedP6SEvidenceBundle} from './evidence-bundle.ts';
import {LocalBenchUsbFlow} from './bench-flow-v1.ts';

const output=document.querySelector<HTMLPreElement>('#status')!;
const button=(id:string)=>document.querySelector<HTMLButtonElement>('#'+id)!;
const checked=(id:string)=>document.querySelector<HTMLInputElement>('#'+id)!.checked;
const reply=(id:string)=>document.querySelector<HTMLTextAreaElement>('#'+id)!.value.trim();
const show=(value:unknown)=>{output.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);};
const file=async(label:string)=>{const result=await fetch('/file/'+encodeURIComponent(label),{cache:'no-store'});if(!result.ok)throw Error('Local snapshot file could not be read: '+label);return result.blob();};
let flow:LocalBenchUsbFlow|undefined;
async function action(task:()=>Promise<unknown>){try{show(await task());}catch(error){show(error instanceof Error?error.message:String(error));}finally{button('download').disabled=!flow?.receipt;}}

// Offline admission occurs before any browser HID request. A held transaction cannot connect.
await action(async()=>{
  const result=await fetch('/map.json',{cache:'no-store'});if(!result.ok)throw Error('Transaction map unavailable');
  const map=await result.json() as {manifest:string;candidate:string;restoration:string;restoration_evidence_bundle:string;root_seal:string|null;software_evidence:Record<string,string>};
  const softwareEvidenceFiles=Object.fromEntries(await Promise.all(Object.entries(map.software_evidence).map(async([id,label])=>[id,await file(label)])));
  const evidence=await readRetainedP6SEvidenceBundle(await file(map.restoration_evidence_bundle));
  const admission=await admitRootSealedLocalBenchCandidate({ownerTestEligibilityManifest:await file(map.manifest),rootSeal:map.root_seal?await file(map.root_seal):undefined,
    candidate:await file(map.candidate),restoration:await file(map.restoration),softwareEvidenceFiles,restorationEvidenceFiles:evidence.evidenceFiles});
  flow=new LocalBenchUsbFlow(admission);button('connect').disabled=false;
  return {status:'exact-root-sealed-image-admitted-for-first-owner-test',image:admission.candidate,publicReleaseReady:false,candidateHardwareQualified:false};
});
button('connect').onclick=()=>{button('connect').disabled=true;void action(async()=>{if(!flow)throw Error('No admitted image');const profile=await flow.connect();button('write').disabled=false;return profile;});};
button('write').onclick=()=>void action(async()=>{
  if(!flow||!checked('device-authorized')||!checked('del-title'))throw Error('Confirm root-authorized device access and the current USB BRIDGE B2 title first');
  button('write').disabled=true;const receipt=await flow.write({firstOwnerTest:true,currentColdDelTitle:'USB BRIDGE B2'},{onProgress:show});button('normal').disabled=false;return receipt;
});
button('normal').onclick=()=>void action(async()=>{
  if(!flow||!['normal-power','normal-title','normal-sample','normal-synth','normal-reentry','normal-record','normal-save','normal-repeat','normal-pattern'].every(checked))throw Error('Complete and confirm every normal-boot check first');
  const receipt=flow.reportNormalBoot({fullPowerRemoval:true,title:'openSynth N1',knownSampleWorks:true,synthWorks:true,exitReentryCycles:2,
    stoppedPatternRecordingWorks:true,chosenPadSavePlaybackWorks:true,repeatedRecordingWorks:true,patternAndClickWork:true,exactReply:reply('normal-reply')});
  button('normal').disabled=true;button('cold').disabled=false;return receipt;
});
button('cold').onclick=()=>void action(async()=>{
  if(!flow||!checked('cold-power')||!checked('cold-title'))throw Error('Confirm a separate full-power cold DEL boot and USB BRIDGE B2 title');
  button('cold').disabled=true;return flow.confirmColdDel({fullPowerRemoval:true,title:'USB BRIDGE B2',exactReply:reply('cold-reply')});
});
button('download').onclick=()=>void action(async()=>{
  if(!flow)throw Error('No attempt');const receipt=await flow.downloadableReceipt(),url=URL.createObjectURL(new Blob([Uint8Array.from(receipt.bytes)]));
  const link=document.createElement('a');link.href=url;link.download=receipt.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {receiptFilename:receipt.filename,sha256:receipt.sha256};
});
