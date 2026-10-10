import type {B2ImageBundle,ImagePin,ImageRole,LocalBinary} from './model.ts';
import {B2} from './model.ts';
import {allowOnlyFields,app1Metadata,copyBinary,hexDigest,integer,ownedBytes,readJsonFile,record,rejectDuplicateJsonKeys,shaText,text} from './data.ts';
import {P6S_IMAGE} from './authority.ts';
import {admitQualifiedP6SRestoration} from './release.ts';
import {ROOT_SEALED_LOCAL_BENCH_AUTHORITIES} from './root-seals-v1.ts';
import {BENCH_PROOF_SCOPES,inspectRootSoftwareBenchReview} from './root-review-v2.ts';
import type {RootReviewContract} from './root-review-v2.ts';
export {ROOT_SEALED_LOCAL_BENCH_AUTHORITIES} from './root-seals-v1.ts';
export {BENCH_PROOF_SCOPES} from './root-review-v2.ts';

export const LOCAL_BENCH_V1=Object.freeze({schema:'opensp-priority1-owner-test-eligibility-v1',version:1,
  scope:'root-authorized-first-owner-test-of-exact-priority1-image',priorCandidateHardwareProofRequired:false,
  publicReleaseQualifiedBySoftwareAdmission:false,freshDevicePreflightRequired:true,paddedSectorReadbackRequired:true,
  separatelyReopenedStatusRequired:true,eachWriteNormalAndColdDelChecksRequired:true,exactP6SRestorationRequired:true});
export const BENCH_ARTIFACT_IDS=Object.freeze(['official_input','source_archive','source_handoff','source_authority','toolchain_authority','source_contract','builder_entry','build_report','module_elf','module_bin','module_map','elf_map','recipe','source_app1','compiler_ledger','read_boundary','bridge_elf','bridge_tail','bridge_hook','b2_contract'] as const);
export const KNOWN_BENCH_HOLDS=Object.freeze({
  '9b754c96e69f141d419049eccdb4be7375b5bd1ad8880670edee24a850f241d8':'Core-package-03 manual recording depends on a running internal pattern clock; stopped-pattern recording is defective.',
  'dcdb25738f1f40cf517175592eddd28b465e2bbb17ca0dfd05ebdde6da18e1fe':'Final-package-05 Synth button translator rejects PATTERN SELECT20 before the chooser opens; exact pattern/composition software review is blocked.',
  '26cb4f1d99696eb0cda014a74f34719836eb2aa02fe2995966038907b8ee95b8':'Final-package-06 pattern guard rejects authentic constructor idle indices -1; exact pattern/composition software review is blocked.',
});
export interface LocalBenchInputsV1 {
  readonly ownerTestEligibilityManifest:LocalBinary;
  readonly rootSeal?:LocalBinary;
  readonly candidate:LocalBinary;
  readonly restoration:LocalBinary;
  readonly softwareEvidenceFiles:Readonly<Record<string,LocalBinary>>;
  readonly restorationEvidenceFiles:Readonly<Record<string,LocalBinary>>;
}
export interface AdmittedLocalBenchCandidate extends B2ImageBundle {
  readonly candidate:ImagePin;
  readonly schema:'opensp-root-sealed-localbench-candidate-admission-v1';
  readonly scope:typeof LOCAL_BENCH_V1.scope;
  readonly authenticatedEvidence:readonly {readonly id:string;readonly bytes:number;readonly sha256:string}[];
  readonly manifestSha256:string;
  readonly rootSealSha256:string;
  readonly publicReleaseReady:false;
  readonly stockFirstInstallSupported:false;
  readonly candidateHardwareQualified:false;
  readonly firstOwnerTestOnly:true;
  readonly rootReviewContract:RootReviewContract;
}
const admitted=new WeakMap<object,{candidate:Uint8Array<ArrayBuffer>;restoration:Uint8Array<ArrayBuffer>}>();
function need(value:unknown,why:string):asserts value {if(!value)throw new TypeError(why);}
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const same=(left:unknown,right:unknown)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const proofRoles=Object.keys(BENCH_PROOF_SCOPES);
interface FilePin {readonly bytes:number;readonly sha256:string;}
function pin(value:unknown,name:string):FilePin {
  const row=record(value,name);allowOnlyFields(row,new Set(['bytes','sha256']),name);
  return Object.freeze({bytes:integer(row.bytes,`${name}.bytes`,1,4*1024*1024),sha256:shaText(row.sha256,`${name}.sha256`)});
}
async function readPinned(file:LocalBinary|undefined,expected:FilePin,name:string) {
  need(file&&typeof file.arrayBuffer==='function'&&file.size===expected.bytes,`${name} size differs`);
  const bytes=ownedBytes(new Uint8Array(await file!.arrayBuffer()));
  need(bytes.length===expected.bytes&&await hexDigest(bytes)===expected.sha256,`${name} digest differs`);return bytes;
}
function jsonBytes(bytes:Uint8Array,name:string) {
  need(bytes.length<=1024*1024,`${name} JSON exceeds its bound`);
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rejectDuplicateJsonKeys(source);return record(JSON.parse(source),name);
}
function imagePin(value:unknown,role:ImageRole):ImagePin {
  const row=record(value,role);allowOnlyFields(row,new Set(['role','format','abi','bytes','sha256','crc32','padded_bytes','sectors','expected_normal_identity','expected_cold_del_marker']),role);
  need(row.role===role&&row.format==='spuafw10-abi2'&&row.abi===2&&row.expected_cold_del_marker===B2.marker,`${role} format/role/marker differs`);
  const result={role,format:'spuafw10-abi2' as const,abi:2 as const,bytes:integer(row.bytes,'image bytes',1,B2.maximum),sha256:shaText(row.sha256,'image SHA'),
    crc32:integer(row.crc32,'image CRC'),padded_bytes:integer(row.padded_bytes,'padded bytes',1,B2.maximum),sectors:integer(row.sectors,'sectors',1,B2.maximum/4096),
    expected_normal_identity:text(row.expected_normal_identity,'normal identity',64),expected_cold_del_marker:B2.marker};
  need(result.padded_bytes===Math.ceil(result.bytes/4096)*4096&&result.sectors*4096===result.padded_bytes,'Image padding differs');return Object.freeze(result);
}
function subjectFor(candidate:ImagePin,artifacts:Record<string,FilePin>) {
  return {candidate_sha256:candidate.sha256,module_elf_sha256:artifacts.module_elf.sha256,module_sha256:artifacts.module_bin.sha256,source_contract_sha256:artifacts.source_contract.sha256};
}

/** Validate actual byte relationships and proof references. This inspection grants no transfer authority. */
export async function inspectLocalBenchByteBindings(inputs:LocalBenchInputsV1) {
  const receipt=await readJsonFile(inputs.ownerTestEligibilityManifest,'LOCALBENCH manifest'),value=receipt.value;
  allowOnlyFields(value,new Set(['schema','version','scope','status','identity','policy_id','candidate','restoration','writer','artifacts','proof_files','proofs','root_review','software_eligible_for_owner_test','hardware_qualified','public_release_eligible','candidate_upload_enabled','prior_candidate_hardware_proof_required']), 'LOCALBENCH manifest');
  need(value.schema===LOCAL_BENCH_V1.schema&&value.version===1&&value.scope===LOCAL_BENCH_V1.scope,'LOCALBENCH schema or scope differs');
  need(value.hardware_qualified===false&&value.public_release_eligible===false&&value.candidate_upload_enabled===false&&value.prior_candidate_hardware_proof_required===false,'LOCALBENCH promotes public/physical/delivery authority');
  need(value.software_eligible_for_owner_test===false||value.software_eligible_for_owner_test===true,'LOCALBENCH software eligibility is invalid');
  need(value.status===(value.software_eligible_for_owner_test?'ROOT_REVIEWED_SOFTWARE_ELIGIBLE_SEAL_REQUIRED':'HELD_SOFTWARE_PROOFS_OR_ROOT_REVIEW_REQUIRED'),'LOCALBENCH status differs');
  need(value.identity==='openSynth N1'&&value.policy_id==='50544E31','LOCALBENCH N1 identity or policy differs');
  const writer=record(value.writer,'writer');allowOnlyFields(writer,new Set(Object.keys(B2)),'writer');
  need(Object.entries(B2).every(([key,item])=>writer[key]===item),'LOCALBENCH specific B2 profile contract differs');
  const candidate=imagePin(value.candidate,'candidate'),restoration=imagePin(value.restoration,'restoration');
  need(candidate.expected_normal_identity===value.identity,'Candidate declared identity differs');
  need(Object.entries(P6S_IMAGE).every(([key,item])=>(restoration as unknown as Record<string,unknown>)[key]===item),'Restoration is not exact P6S');
  const artifactRows=record(value.artifacts,'artifacts');allowOnlyFields(artifactRows,new Set(BENCH_ARTIFACT_IDS),'artifacts');
  need(Object.keys(artifactRows).length===BENCH_ARTIFACT_IDS.length,'LOCALBENCH artifact set differs');
  const artifacts:Record<string,FilePin>={};for(const id of BENCH_ARTIFACT_IDS)artifacts[id]=pin(artifactRows[id],id);
  const proofRows=record(value.proof_files,'proof files'),proofPins:Record<string,FilePin>={};
  for(const [id,row] of Object.entries(proofRows)){need(/^[a-z][a-z0-9_-]{0,63}$/.test(id)&&!BENCH_ARTIFACT_IDS.includes(id as never),'Proof ID differs or shadows an artifact');proofPins[id]=pin(row,id);}
  need(Object.keys(proofPins).length<=64,'Too many LOCALBENCH proof files');
  const proofs=record(value.proofs,'proof roles');allowOnlyFields(proofs,new Set(proofRoles),'proof roles');
  need(Object.keys(proofs).length===proofRoles.length,'LOCALBENCH proof roles differ');
  const expectedIds=[...BENCH_ARTIFACT_IDS,...Object.keys(proofPins),...(value.root_review===null?[]:['root_review'])];
  need(Object.keys(inputs.softwareEvidenceFiles).length===expectedIds.length&&Object.keys(inputs.softwareEvidenceFiles).every(id=>expectedIds.includes(id)),'LOCALBENCH evidence set differs');
  const evidence:Record<string,Uint8Array<ArrayBuffer>>={},authenticated=[];
  for(const [id,filePin] of Object.entries({...artifacts,...proofPins})){
    evidence[id]=await readPinned(inputs.softwareEvidenceFiles[id],filePin,id);authenticated.push(Object.freeze({id,...filePin}));
  }
  const candidateBytes=await copyBinary(inputs.candidate,'Bench candidate'),restoreBytes=await copyBinary(inputs.restoration,'Bench restoration');
  for(const [body,image] of [[candidateBytes,candidate],[restoreBytes,restoration]] as const){
    const metadata=app1Metadata(body,2,image.role);need(body.length===image.bytes&&await hexDigest(body)===image.sha256&&metadata.crc32===image.crc32&&metadata.paddedBytes===image.padded_bytes,`${image.role} bytes/header differ`);
  }
  const header=new DataView(candidateBytes.buffer,0x288000,candidateBytes.length-0x288000),payloadOffset=0x288000+header.getUint32(0x230,true);
  need(await hexDigest(candidateBytes.subarray(payloadOffset))===artifacts.module_bin.sha256,'Actual candidate appended module differs');
  const source=ownedBytes(evidence.source_app1),hook=evidence.bridge_hook,tail=ownedBytes(evidence.bridge_tail);
  need(source.length===2652672&&hook.length===4&&tail.length===header.getUint32(0x224,true),'Native/bridge component extents differ');
  source.set(hook,0);source.set(new TextEncoder().encode('openSynth N1\0'),0x160560);
  need(await hexDigest(source)===await hexDigest(candidateBytes.subarray(0,source.length)),'Native APP1 front differs from its exact source, hook or identity');
  const tailView=new DataView(tail.buffer);tailView.setUint32(0x208,2,true);tailView.setUint32(0x20c,candidateBytes.length-0x288000,true);
  for(let index=0;index<8;index++)tailView.setUint32(0x220+4*index,header.getUint32(0x220+4*index,true),true);
  need(await hexDigest(tail)===await hexDigest(candidateBytes.subarray(0x288000,0x288000+tail.length)),'Wrapped bridge tail differs from its actual source-built bytes');
  for(const [begin,end] of [[source.length,0x288000],[0x288000+tail.length,payloadOffset]]){
    for(let offset=begin;offset<end;offset++)need(candidateBytes[offset]===0xff,'Unowned APP1 gap is not erased padding');
  }
  need(evidence.module_elf[0]===0x7f&&evidence.module_elf[1]===0x45&&evidence.module_elf[2]===0x4c&&evidence.module_elf[3]===0x46,'Module is not an ELF');
  need(new TextDecoder().decode(candidateBytes.subarray(0x160560,0x16056d))==='openSynth N1\0','Actual N1 Utility identity field differs');
  const report=jsonBytes(evidence.build_report,'build report');
  need(report.schema==='opensp-priority1-compact-candidate-build-v1'&&report.identity===value.identity&&report.policy_id===value.policy_id,'Actual build report identity differs');
  for(const [field,expected] of Object.entries({authority_sha256:artifacts.source_authority.sha256,source_contract_sha256:artifacts.source_contract.sha256,module_elf_sha256:artifacts.module_elf.sha256,module_sha256:artifacts.module_bin.sha256,recipe_sha256:artifacts.recipe.sha256,source_APP1_sha256:artifacts.source_app1.sha256,candidate_sha256:candidate.sha256,candidate_bytes:candidate.bytes,candidate_crc32:candidate.crc32.toString(16).toUpperCase().padStart(8,'0'),padded_bytes:candidate.padded_bytes,restoration_sha256:restoration.sha256,restoration_bytes:restoration.bytes,restoration_crc32:'BA6967B2'}))need(report[field]===expected,`Build report ${field} differs`);
  const subject=subjectFor(candidate,artifacts),blockers:string[]=[],usedProofs=new Set<string>();
  if(Object.hasOwn(KNOWN_BENCH_HOLDS,candidate.sha256))blockers.push(KNOWN_BENCH_HOLDS[candidate.sha256 as keyof typeof KNOWN_BENCH_HOLDS]);
  for(const role of proofRoles){
    const ids=proofs[role];need(Array.isArray(ids)&&ids.length<=16&&ids.every(id=>typeof id==='string'&&Object.hasOwn(proofPins,id))&&new Set(ids).size===ids.length,`Proof references differ: ${role}`);
    if(ids.length===0)blockers.push(`Missing exact qualifying proof: ${role}`);
    for(const id of ids){usedProofs.add(id as string);const proof=jsonBytes(evidence[id as string],id as string);
      if(proof.subject===undefined)blockers.push(`Qualifying receipt lacks the exact machine-bound subject: ${id}`);
      else need(same(proof.subject,subject),`Qualifying receipt subject differs: ${id}`);
    }
  }
  need(Object.keys(proofPins).every(id=>usedProofs.has(id)),'Unreferenced proof file differs');
  let rootReview:Record<string,unknown>|undefined,rootReviewContract:RootReviewContract|undefined;
  if(value.root_review!==null){
    const reviewPin=pin(value.root_review,'root_review'),body=await readPinned(inputs.softwareEvidenceFiles.root_review,reviewPin,'root_review');
    authenticated.push(Object.freeze({id:'root_review',...reviewPin}));rootReview=jsonBytes(body,'root review');
    rootReviewContract=inspectRootSoftwareBenchReview(rootReview,subject,proofs);
  }else blockers.push('Root software review has not been provided');
  need(!value.software_eligible_for_owner_test||blockers.length===0,'Manifest claims software eligibility with missing concrete proofs/root review');
  return {manifest:value,manifestSha256:receipt.sha256,manifestBytes:receipt.bytes.length,candidate,restoration,subject,
    authenticatedEvidence:Object.freeze(authenticated),blockers:Object.freeze(blockers),rootReviewedSoftwareEligible:blockers.length===0&&!!rootReview,rootReviewContract,
    transferAuthorityGranted:false,publicReleaseEligible:false,hardwareQualified:false,candidateBytes,restorationBytes:restoreBytes};
}

/** Only an exact root-installed manifest/seal pair can create a private first-test transfer token. */
export async function admitRootSealedLocalBenchCandidate(inputs:LocalBenchInputsV1):Promise<AdmittedLocalBenchCandidate> {
  const manifest=await readJsonFile(inputs.ownerTestEligibilityManifest,'LOCALBENCH owner-test eligibility');
  if(manifest.value.schema!==LOCAL_BENCH_V1.schema)throw new TypeError('LOCALBENCH owner-test eligibility schema differs');
  const authority=ROOT_SEALED_LOCAL_BENCH_AUTHORITIES.find(row=>row.manifestBytes===manifest.bytes.length&&row.manifestSha256===manifest.sha256);
  if(!authority)throw new TypeError('No root-sealed LOCALBENCH software authority exists for this exact manifest');
  const sealBytes=await readPinned(inputs.rootSeal,{bytes:authority.rootSealBytes,sha256:authority.rootSealSha256},'root seal'),seal=jsonBytes(sealBytes,'root seal');
  allowOnlyFields(seal,new Set(['schema','version','manifest','root_review','subject','scope','public_release_eligible','candidate_hardware_qualified','device_operations_authorized_by_this_file']),'root seal');
  need(seal.schema==='opensp-priority1-root-software-bench-seal-v1'&&seal.version===1&&same(seal.manifest,{bytes:manifest.bytes.length,sha256:manifest.sha256})&&seal.scope===LOCAL_BENCH_V1.scope,'Registered root seal manifest/scope differs');
  need(seal.public_release_eligible===false&&seal.candidate_hardware_qualified===false&&seal.device_operations_authorized_by_this_file===false,'Root seal promotes physical/public/device authority');
  const inspection=await inspectLocalBenchByteBindings(inputs);
  need(inspection.manifestSha256===manifest.sha256&&inspection.manifestBytes===manifest.bytes.length,'Root-registered manifest changed during admission');
  need(inspection.rootReviewedSoftwareEligible&&inspection.manifest.software_eligible_for_owner_test===true&&same(seal.subject,inspection.subject)&&same(seal.root_review,inspection.manifest.root_review),'Root seal qualification/subject differs');
  const restore=await admitQualifiedP6SRestoration(inputs.restoration,inputs.restorationEvidenceFiles);
  const admission:AdmittedLocalBenchCandidate=Object.freeze({schema:'opensp-root-sealed-localbench-candidate-admission-v1',scope:LOCAL_BENCH_V1.scope,
    candidate:inspection.candidate,restoration:restore.restoration,manifestSha256:inspection.manifestSha256,rootSealSha256:authority.rootSealSha256,
    authenticatedEvidence:Object.freeze([...inspection.authenticatedEvidence,...restore.authenticatedEvidence.map(row=>Object.freeze({...row,id:'p6s-'+row.id}))]),
    publicReleaseReady:false,stockFirstInstallSupported:false,candidateHardwareQualified:false,firstOwnerTestOnly:true,rootReviewContract:inspection.rootReviewContract!});
  admitted.set(admission,{candidate:inspection.candidateBytes,restoration:inspection.restorationBytes});return admission;
}

export function resolveBenchImage(bundle:B2ImageBundle,role:ImageRole) {
  const files=admitted.get(bundle);need(files,'LOCALBENCH transfer token was not admitted by the root-sealed module');
  const candidate=(bundle as AdmittedLocalBenchCandidate).candidate;
  return {pin:role==='candidate'?candidate:bundle.restoration,bytes:ownedBytes(files![role])};
}
