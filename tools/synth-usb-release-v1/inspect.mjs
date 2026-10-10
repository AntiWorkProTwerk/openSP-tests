import {readFile,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {admitQualifiedP6SRestoration,inspectPatcherHandoff,P6S_EVIDENCE} from './release.ts';

export const localFile=body=>new Blob([body]);
async function fixedRead(path) {
  const expected=resolve(path),actual=await realpath(expected);
  if(actual!==expected)throw Error('Owner-local input has a redirected path.');
  return readFile(actual);
}
export async function loadRetainedP6SInputs(synthRoot,restorationPath) {
  const root=await realpath(resolve(synthRoot)),evidenceFiles={};
  for(const pin of P6S_EVIDENCE)evidenceFiles[pin.id]=localFile(await fixedRead(resolve(root,pin.path)));
  const restoration=localFile(await fixedRead(restorationPath));
  return {restoration,evidenceFiles};
}

export async function inspectLocalDelivery({synthRoot,restorationPath,handoffPath,buildRoot}) {
  const inputs=await loadRetainedP6SInputs(synthRoot,restorationPath);
  const admission=await admitQualifiedP6SRestoration(inputs.restoration,inputs.evidenceFiles);
  let handoff;
  if(handoffPath||buildRoot) {
    if(!handoffPath||!buildRoot)throw Error('Handoff and build root must be supplied together.');
    handoff=await inspectPatcherHandoff(localFile(await fixedRead(handoffPath)),
      localFile(await fixedRead(resolve(buildRoot,'selected-build/candidate.disabled.bin'))),
      localFile(await fixedRead(resolve(buildRoot,'restore-build/restore-p6s.disabled.bin'))));
  }
  return {schema:'opensp-synth-usb-offline-inspection-v1',version:1,
    status:'PASS_EXACT_P6S_RESTORATION_AUTHORITY_CANDIDATES_HELD',restoration:admission.restoration,
    authenticatedEvidence:admission.authenticatedEvidence,heldPatcherInspection:handoff??null,
    exactP6SCompatibleB2TestEligible:true,newCandidateUsbUploadEnabled:false,
    freshDeviceIdentityAndProfileRequired:true,eachNewWriteRebootChecksPending:true,
    stockFirstInstallSupported:false,publicReleaseReady:false,deviceOperations:false,firmwareRebuilt:false,
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args={};
  for(let index=2;index<process.argv.length;index+=2) {
    const key=process.argv[index],value=process.argv[index+1];
    if(!['--synth-root','--restoration','--handoff','--build-root'].includes(key)||!value||args[key])throw Error('Invalid or duplicate offline inspection argument.');
    args[key]=value;
  }
  if(!args['--synth-root']||!args['--restoration'])throw Error('Supply --synth-root and --restoration.');
  process.stdout.write(JSON.stringify(await inspectLocalDelivery({synthRoot:args['--synth-root'],restorationPath:args['--restoration'],handoffPath:args['--handoff'],buildRoot:args['--build-root']}),null,2)+'\n');
}
