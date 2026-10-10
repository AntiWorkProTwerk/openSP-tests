import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadBenchTransaction,newPrivateOutput} from './prepare-bench.mjs';
import {inspectLocalBenchByteBindings,LOCAL_BENCH_V1} from './local-bench-v1.ts';

const hash=body=>createHash('sha256').update(body).digest('hex');
const pin=body=>({bytes:body.length,sha256:hash(body)});
const need=(value,why)=>{if(!value)throw Error(why);};

/** Root-only preparation action. Emits a reviewed seal/entry; never installs registry authority or touches a device. */
export async function createRootSoftwareBenchSeal({transaction,rootReview,rootReviewSha256,output}) {
  need(/^[a-f0-9]{64}$/.test(rootReviewSha256),'Supply the exact independently reviewed root-document SHA-256');
  const loaded=await loadBenchTransaction(transaction),reviewRaw=await readFile(resolve(rootReview));
  need(hash(reviewRaw)===rootReviewSha256,'Root software review changed or has the wrong approved digest');
  const originalRaw=Buffer.from(await loaded.inputs.ownerTestEligibilityManifest.arrayBuffer()),manifest=JSON.parse(originalRaw);
  manifest.root_review=pin(reviewRaw);manifest.software_eligible_for_owner_test=true;manifest.status='ROOT_REVIEWED_SOFTWARE_ELIGIBLE_SEAL_REQUIRED';
  const manifestRaw=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  const inputs={...loaded.inputs,ownerTestEligibilityManifest:new Blob([manifestRaw]),
    softwareEvidenceFiles:{...loaded.inputs.softwareEvidenceFiles,root_review:new Blob([reviewRaw])}};
  const inspection=await inspectLocalBenchByteBindings(inputs);
  need(inspection.rootReviewedSoftwareEligible&&inspection.blockers.length===0,'Concrete software qualification/root review is incomplete');
  const seal={schema:'opensp-priority1-root-software-bench-seal-v1',version:1,manifest:pin(manifestRaw),root_review:pin(reviewRaw),
    subject:inspection.subject,scope:LOCAL_BENCH_V1.scope,public_release_eligible:false,candidate_hardware_qualified:false,device_operations_authorized_by_this_file:false};
  const sealRaw=Buffer.from(JSON.stringify(seal,null,2)+'\n'),entry={manifestBytes:manifestRaw.length,manifestSha256:hash(manifestRaw),rootSealBytes:sealRaw.length,rootSealSha256:hash(sealRaw)};
  // All checks precede creating a new output. The caller must separately review and install this exact static entry.
  const target=await newPrivateOutput(output);await mkdir(resolve(target,'evidence'));
  const map=structuredClone(loaded.map);map.root_seal='ROOT_BENCH_SEAL.json';map.software_evidence.root_review='ROOT_SOFTWARE_REVIEW.json';
  for(const [id,label] of Object.entries(loaded.map.software_evidence))await writeFile(resolve(target,label),Buffer.from(await loaded.inputs.softwareEvidenceFiles[id].arrayBuffer()),{flag:'wx'});
  for(const [name,body] of [[map.candidate,Buffer.from(await loaded.inputs.candidate.arrayBuffer())],[map.restoration,Buffer.from(await loaded.inputs.restoration.arrayBuffer())],
    [map.restoration_evidence_bundle,await readFile(resolve(loaded.root,loaded.map.restoration_evidence_bundle))],
    [map.manifest,manifestRaw],[map.root_seal,sealRaw],['ROOT_SOFTWARE_REVIEW.json',reviewRaw],['ROOT_BENCH_AUTHORITY_ENTRY.json',Buffer.from(JSON.stringify(entry,null,2)+'\n')],
    ['INPUT_FILES.json',Buffer.from(JSON.stringify(map,null,2)+'\n')]])await writeFile(resolve(target,name),body,{flag:'wx'});
  return {schema:'opensp-root-bench-seal-preparation-receipt-v1',status:'ROOT_SEAL_BYTES_PREPARED_REGISTRY_INSTALLATION_PENDING',subject:inspection.subject,entry,
    softwareProofRoles:Object.keys(manifest.proofs),registryAutomaticallyInstalled:false,candidateUploadAdmittedByThisCli:false,
    publicReleaseEligible:false,candidateHardwareQualified:false,deviceOperations:false,firmwareRebuilt:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args={};for(let index=2;index<process.argv.length;index+=2){const key=process.argv[index],value=process.argv[index+1];
    need(['--transaction','--root-review','--root-review-sha256','--output'].includes(key)&&value&&!args[key],'Invalid/duplicate root seal argument');args[key]=value;}
  for(const key of ['--transaction','--root-review','--root-review-sha256','--output'])need(args[key],'Missing root seal argument: '+key);
  process.stdout.write(JSON.stringify(await createRootSoftwareBenchSeal({transaction:args['--transaction'],rootReview:args['--root-review'],rootReviewSha256:args['--root-review-sha256'],output:args['--output']}),null,2)+'\n');
}
