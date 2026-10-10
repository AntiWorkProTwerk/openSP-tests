import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {P6S_EVIDENCE} from './authority.ts';
import {readRetainedP6SEvidenceBundle,EVIDENCE_BUNDLE_MAXIMUM} from './evidence-bundle.ts';

/** Encode reviewed actual files. The result includes evidence only, with no firmware or selected-build authority. */
export async function encodeRetainedP6SEvidence(synthRoot) {
  const root=await realpath(resolve(synthRoot)),files=[];
  for(const pin of P6S_EVIDENCE){
    const expected=resolve(root,pin.path),actual=await realpath(expected);
    if(actual!==expected)throw Error('Retained evidence has a redirected input path.');
    const body=await readFile(actual);files.push({id:pin.id,bytes:pin.bytes,sha256:pin.sha256,base64:body.toString('base64')});
  }
  const bytes=Buffer.from(JSON.stringify({schema:'opensp-retained-p6s-evidence-files-v1',version:1,scope:'exact-historical-p6s-only',
    firmwareIncluded:false,candidateAuthorityGranted:false,files},null,2)+'\n');
  if(bytes.length>EVIDENCE_BUNDLE_MAXIMUM)throw Error('Reviewed evidence exceeds the fixed bundle bound.');
  const checked=await readRetainedP6SEvidenceBundle(new Blob([bytes]));
  return {bytes,sha256:checked.bundleSha256};
}

export async function prepareEvidenceBundle(synthRoot,output) {
  const project=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
  const expected=resolve(output),parent=await realpath(dirname(expected)),child=relative(project,expected);
  if(parent!==dirname(expected)||child===''||(!child.startsWith('..')&&!isAbsolute(child)))throw Error('Evidence bundle output must be outside the website checkout with an unredirected parent.');
  const bundle=await encodeRetainedP6SEvidence(synthRoot);
  await writeFile(expected,bundle.bytes,{flag:'wx'});
  return {schema:'opensp-owner-local-evidence-bundle-preparation-v1',bytes:bundle.bytes.length,sha256:bundle.sha256,
    retainedEvidenceFiles:P6S_EVIDENCE.length,firmwareIncluded:false,candidateAuthorityGranted:false,deviceOperations:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args={};for(let index=2;index<process.argv.length;index+=2){const key=process.argv[index],value=process.argv[index+1];
    if(!['--synth-root','--output'].includes(key)||!value||args[key])throw Error('Invalid or duplicate evidence preparation argument.');args[key]=value;}
  if(!args['--synth-root']||!args['--output'])throw Error('Supply --synth-root and a new --output outside the website checkout.');
  process.stdout.write(JSON.stringify(await prepareEvidenceBundle(args['--synth-root'],args['--output']),null,2)+'\n');
}
