import {admitRootSealedLocalBenchCandidate} from './local-bench-v1.ts';
import {readRetainedP6SEvidenceBundle} from './evidence-bundle.ts';
import {SingleTakeBenchUsbFlow} from './bench-flow-v2.ts';
import type {B2Progress} from './model.ts';

const output = document.querySelector<HTMLPreElement>('#status')!;
const meter = document.querySelector<HTMLProgressElement>('#transfer-progress')!;
const progressLabel = document.querySelector<HTMLParagraphElement>('#transfer-label')!;
const cancelHelp = document.querySelector<HTMLParagraphElement>('#cancel-help')!;
const button = (id:string) => document.querySelector<HTMLButtonElement>('#'+id)!;
const checked = (id:string) => document.querySelector<HTMLInputElement>('#'+id)!.checked;
const reply = (id:string) => document.querySelector<HTMLTextAreaElement>('#'+id)!.value.trim();
const show = (value:unknown) => {output.textContent = typeof value === 'string' ? value : JSON.stringify(value,null,2);};
const file = async(label:string) => {
  const result = await fetch('/file/'+encodeURIComponent(label), {cache:'no-store'});
  if(!result.ok) throw Error('Local snapshot file could not be read: '+label);
  return result.blob();
};
let flow:SingleTakeBenchUsbFlow|undefined;
let busy = false;
function renderControls() {
  button('connect').disabled = busy || flow?.phase !== 'ready';
  button('write').disabled = busy || flow?.phase !== 'profile-confirmed';
  button('normal').disabled = busy || flow?.phase !== 'reboot-pending';
  button('cold').disabled = busy || flow?.phase !== 'normal-owner-reported';
  button('cancel').disabled = !flow?.cancelAvailable;
  button('download').disabled = busy || !flow?.receipt;
}
function progress(value:B2Progress) {
  const stage = {'preflight':'Checking B2 profile', 'ram-upload':'Uploading to RAM', 'ram-verified':'RAM verified; committing APP1',
    'flash-readback':'Programming and verifying sectors', 'separate-status':'Checking separately reopened status'}[value.stage];
  meter.hidden = false;
  if(value.totalBytes > 0) {meter.max = value.totalBytes; meter.value = value.completedBytes;}
  else meter.removeAttribute('value');
  progressLabel.textContent = `${stage}: ${value.completedBytes.toLocaleString()} / ${value.totalBytes.toLocaleString()} bytes`;
  cancelHelp.textContent = flow?.cancelAvailable ? 'Cancel stops host transfer. Staged RAM may remain; another attempt requires fresh writer checks.' :
    'Cancellation is locked after RAM verification. Keep power and USB connected while programming and readback continue.';
  renderControls();
}
async function action(task:()=>Promise<unknown>) {
  if(busy) return;
  busy = true;
  renderControls();
  try {show(await task());}
  catch(error) {show({message:error instanceof Error ? error.message : String(error),
    attemptReceipt:flow?.receipt ?? null, recovery:'Preserve this result. No automatic retry or device reset is performed.'});}
  finally {busy = false; renderControls();}
}

// Offline admission must finish before any HID picker. Empty/withdrawn registry remains authoritative.
await action(async() => {
  const result = await fetch('/map.json', {cache:'no-store'});
  if(!result.ok) throw Error('Transaction map unavailable');
  const map = await result.json() as {manifest:string;candidate:string;restoration:string;restoration_evidence_bundle:string;root_seal:string|null;software_evidence:Record<string,string>};
  const softwareEvidenceFiles = Object.fromEntries(await Promise.all(Object.entries(map.software_evidence).map(async([id,label]) => [id,await file(label)])));
  const evidence = await readRetainedP6SEvidenceBundle(await file(map.restoration_evidence_bundle));
  const admission = await admitRootSealedLocalBenchCandidate({ownerTestEligibilityManifest:await file(map.manifest), rootSeal:map.root_seal ? await file(map.root_seal) : undefined,
    candidate:await file(map.candidate), restoration:await file(map.restoration), softwareEvidenceFiles, restorationEvidenceFiles:evidence.evidenceFiles});
  flow = new SingleTakeBenchUsbFlow(admission);
  document.querySelector<HTMLSpanElement>('#expected-normal-title')!.textContent = flow.expectedNormalIdentity;
  return {status:'exact-root-sealed-image-admitted-for-first-owner-test', image:admission.candidate, publicReleaseReady:false, candidateHardwareQualified:false};
});
button('connect').onclick = () => void action(async() => {
  if(!flow || !checked('device-authorized') || !checked('del-title')) throw Error('Confirm root-authorized device access and the current USB BRIDGE B2 title first');
  return flow.connect();
});
button('write').onclick = () => void action(async() => {
  if(!flow || !checked('device-authorized') || !checked('del-title')) throw Error('Confirm root-authorized device access and the current USB BRIDGE B2 title first');
  const pending = flow.write({firstOwnerTest:true, currentColdDelTitle:'USB BRIDGE B2'}, {onProgress:progress});
  renderControls();
  return pending;
});
button('cancel').onclick = () => {
  if(flow?.cancel()) cancelHelp.textContent = 'Cancellation requested. Preserve the failure receipt and check fresh writer identity, profile and status before another attempt.';
  renderControls();
};
button('normal').onclick = () => void action(async() => {
  if(!flow || !['normal-power','normal-title','normal-sample','normal-synth','normal-exit','normal-record','normal-save'].every(checked)) throw Error('Complete and confirm every normal-boot check first');
  return flow.reportNormalBoot({fullPowerRemoval:true, title:flow.expectedNormalIdentity, knownSampleWorks:true, synthWorks:true, synthExitWorks:true,
    stoppedPatternRecordingWorks:true, chosenPadSavePlaybackWorks:true, exactReply:reply('normal-reply')});
});
button('cold').onclick = () => void action(async() => {
  if(!flow || !checked('cold-power') || !checked('cold-title')) throw Error('Confirm a separate full-power cold DEL boot and USB BRIDGE B2 title');
  return flow.confirmColdDel({fullPowerRemoval:true, title:'USB BRIDGE B2', exactReply:reply('cold-reply')});
});
button('download').onclick = () => void action(async() => {
  if(!flow) throw Error('No attempt');
  const receipt = await flow.downloadableReceipt(), url = URL.createObjectURL(new Blob([Uint8Array.from(receipt.bytes)]));
  const link = document.createElement('a');
  link.href = url; link.download = receipt.filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
  return {receiptFilename:receipt.filename, sha256:receipt.sha256};
});
