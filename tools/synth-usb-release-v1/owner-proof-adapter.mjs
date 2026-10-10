import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {rejectDuplicateJsonKeys} from './data.ts';
const hash=body=>createHash('sha256').update(body).digest('hex');
const need=(value,why)=>{if(!value)throw Error(why);};
const inside=(root,path)=>{const child=relative(root,path);return !child.startsWith('..')&&!isAbsolute(child);};
const canonical=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>[key,canonical(row)])):value;

/** Normalize a frozen owner's exact_subject field while retaining every original receipt byte. No qualification is created. */
export async function adaptFrozenOwnerProof({synthRoot,rawPath,rawSha256,subject,role,output}) {
  need(['recording_flow','composition'].includes(role),'Owner adapter role differs');
  const root=await realpath(resolve(synthRoot)),path=resolve(rawPath);need(inside(root,path)&&await realpath(path)===path,'Owner receipt escapes or redirects');
  const body=await readFile(path);need(body.length<=512*1024&&hash(body)===rawSha256,'Pinned owner receipt differs or exceeds bound');
  const source=body.toString('utf8');rejectDuplicateJsonKeys(source);const raw=JSON.parse(source);
  const keys=['candidate_sha256','module_elf_sha256','module_sha256','source_contract_sha256'];
  need(raw.exact_subject&&Object.keys(raw.exact_subject).length===4&&keys.every(key=>/^[a-f0-9]{64}$/.test(raw.exact_subject[key]))&&JSON.stringify(canonical(raw.exact_subject))===JSON.stringify(canonical(subject)),'Owner exact subject differs');
  const references=Object.values(raw.artifacts??{}).concat(raw.files??[]),authenticatedOwnerArtifactPins=[];
  for(const pin of references){need(pin&&typeof pin.path==='string'&&/^[a-f0-9]{64}$/.test(pin.sha256),'Owner artifact pin differs');
    const artifact=resolve(root,pin.path);need(inside(root,artifact)&&await realpath(artifact)===artifact,'Owner artifact escapes or redirects');
    const bytes=await readFile(artifact);need(bytes.length<=64*1024*1024&&hash(bytes)===pin.sha256&&(pin.bytes===undefined||bytes.length===pin.bytes),'Actual owner artifact pin differs');
    authenticatedOwnerArtifactPins.push({path:relative(root,artifact),bytes:bytes.length,sha256:hash(bytes)});
  }
  const wrapper={schema:'opensp-pinned-owner-proof-subject-adapter-v1',version:1,status:'PINNED_FROZEN_OWNER_RECEIPT_NO_NEW_QUALIFICATION',subject:raw.exact_subject,role,
    sourceSubjectField:'exact_subject',ownerDeclaredStatus:raw.status,ownerDeclaredScope:raw.recording_flow_scope??raw.software_scope??raw.scope??null,
    ownerMeasurementSubject:raw.measurement_subject??raw.observation_subject??null,
    rawOwnerReceipt:{path:relative(root,path),bytes:body.length,sha256:rawSha256,encoding:'base64',base64:body.toString('base64')},
    authenticatedOwnerArtifactPins,newQualificationGranted:false,softwareEligibilityGranted:false,publicReleaseEligible:false,hardwareQualificationGranted:false,deviceOperations:false};
  const bytes=Buffer.from(JSON.stringify(wrapper,null,2)+'\n'),target=resolve(output);
  need(inside(root,target)&&await realpath(dirname(target))===dirname(target),'Owner wrapper output escapes or redirects');
  await writeFile(target,bytes,{flag:'wx'});return {wrapper,bytes:bytes.length,sha256:hash(bytes)};
}
