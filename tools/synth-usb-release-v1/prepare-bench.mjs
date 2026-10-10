import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {checkedOfficialInput} from '../synth-release-patcher-v1/official.mjs';
import {B2} from './model.ts';
import {P6S_IMAGE} from './authority.ts';
import {inspectUnqualifiedCandidate} from './release.ts';
import {BENCH_ARTIFACT_IDS,BENCH_PROOF_SCOPES,LOCAL_BENCH_V1,inspectLocalBenchByteBindings} from './local-bench-v1.ts';
import {readRetainedP6SEvidenceBundle} from './evidence-bundle.ts';
import {ROOT_SOFTWARE_REVIEW_V2} from './root-review-v2.ts';

const hash=body=>createHash('sha256').update(body).digest('hex');
const filePin=body=>({bytes:body.length,sha256:hash(body)});
const need=(value,why)=>{if(!value)throw Error(why);};
const blob=body=>new Blob([body]);
const inside=(root,path)=>{const child=relative(root,path);return child===''||(!child.startsWith('..')&&!isAbsolute(child));};
async function read(path){const expected=resolve(path),actual=await realpath(expected);need(expected===actual,'Redirected bench input path');return readFile(actual);}
export async function newPrivateOutput(output) {
  const path=resolve(output),project=await realpath(fileURLToPath(new URL('../../',import.meta.url))),parent=await realpath(dirname(path));
  need(parent===dirname(path)&&!inside(project,path),'Use a new unredirected bench output outside the website checkout');
  await mkdir(path);return path;
}

/** Snapshot a real package and exact proof files. Missing qualifying roles remain explicit holds. */
export async function collectBenchProposal({packageRoot,sourceKitRoot,sourceArchive,sourceHandoff,official,restoration,evidenceBundle,proofPaths={}}) {
  const root=await realpath(resolve(packageRoot)),kit=await realpath(resolve(sourceKitRoot));
  const paths={official_input:official,source_archive:sourceArchive,source_handoff:sourceHandoff,
    source_authority:resolve(kit,'BUILD_AUTHORITY.json'),toolchain_authority:resolve(kit,'TOOLCHAIN_AUTHORITY.json'),source_contract:resolve(kit,'inputs/module-plan.json'),
    builder_entry:resolve(kit,'build_candidate.py'),build_report:resolve(root,'REPORT.json'),module_elf:resolve(root,'module/module.elf'),module_bin:resolve(root,'module/module.bin'),
    module_map:resolve(root,'module/module.map'),elf_map:resolve(root,'module/ELF_MAP.json'),recipe:resolve(root,'recipe.json'),source_app1:resolve(root,'source_APP1.private.bin'),
    compiler_ledger:resolve(root,'module/compiler-ledger.json'),read_boundary:resolve(root,'READ_BOUNDARY.json'),bridge_elf:resolve(root,'b2/usb_bridge_b2.elf'),
    bridge_tail:resolve(root,'b2/tail.bin'),bridge_hook:resolve(root,'b2/hook.bin'),b2_contract:resolve(kit,'inputs/b2-contract.json')};
  const bytes={};for(const id of BENCH_ARTIFACT_IDS)bytes[id]=await read(paths[id]);
  const report=JSON.parse(bytes.build_report),authority=JSON.parse(bytes.source_authority),plan=JSON.parse(bytes.source_contract),handoff=JSON.parse(bytes.source_handoff);
  checkedOfficialInput(bytes.official_input);
  need(authority.schema==='opensp-priority1-compact-build-authority-v1'&&report.authority_sha256===hash(bytes.source_authority)&&handoff.authority_sha256===hash(bytes.source_authority),'Actual source authority binding differs');
  need(report.source_contract_sha256===hash(bytes.source_contract)&&authority.source_contract_sha256===hash(bytes.source_contract)&&handoff.source_contract_sha256===hash(bytes.source_contract),'Actual source contract binding differs');
  need(handoff.archive.bytes===bytes.source_archive.length&&handoff.archive.sha256===hash(bytes.source_archive)&&handoff.entry_sha256===hash(bytes.builder_entry),'Source archive/entry binding differs');
  need(authority.toolchain_authority_sha256===hash(bytes.toolchain_authority),'Toolchain authority binding differs');
  let sourceAuthorityFiles=0;for(const [label,pin] of Object.entries(authority.files)){
    const path=resolve(kit,label);need(inside(kit,path),'Source authority input escapes source kit');
    const body=await read(path);need(body.length===pin.bytes&&hash(body)===pin.sha256,'Actual source authority file differs: '+label);sourceAuthorityFiles++;
  }
  let builtSources=0;for(const [label,digest] of Object.entries(plan.inputs)){
    const path=resolve(root,'module/source',label);need(inside(resolve(root,'module/source'),path),'Module source path escapes');
    need(hash(await read(path))===digest,'Built module source differs: '+label);builtSources++;
  }
  const ledger=JSON.parse(bytes.compiler_ledger);need(ledger.compile_units===plan.compile_commands.length&&ledger.compile_units===report.compile_units&&ledger.undefined_symbols.length===0,'Compiler ledger unit/undefined-symbol binding differs');
  const recipe=JSON.parse(bytes.recipe);need(Array.isArray(recipe.patches)&&recipe.patches.length===report.native_patches,'Actual native recipe patch count differs');
  let objects=0,stackReceipts=0;for(const [name,digest] of Object.entries(ledger.objects)){
    need(basename(name)===name&&hash(await read(resolve(root,'module/objects',name)))===digest,'Actual compiler object differs');objects++;
  }
  need(objects===ledger.compile_units,'Actual object count differs');
  for(const [name,digest] of Object.entries(ledger.stack_receipts)){need(basename(name)===name&&hash(await read(resolve(root,'module/objects',name)))===digest,'Actual stack receipt differs');stackReceipts++;}
  for(const [label,digest] of Object.entries(ledger.actual_dependency_inputs)){
    const path=resolve(root,'module/source',label);need(inside(resolve(root,'module/source'),path)&&plan.inputs[label]===digest&&hash(await read(path))===digest,'Actual compiler dependency differs');
  }
  const candidateBytes=await read(resolve(root,'candidate.disabled.bin')),restoreBytes=await read(restoration),bundleBytes=await read(evidenceBundle);
  const restoreEvidence=await readRetainedP6SEvidenceBundle(blob(bundleBytes));
  need(hash(restoreBytes)===P6S_IMAGE.sha256&&restoreBytes.length===P6S_IMAGE.bytes,'Exact P6S fallback differs');
  const envelope=await inspectUnqualifiedCandidate(blob(candidateBytes),'openSynth N1');
  const artifacts=Object.fromEntries(BENCH_ARTIFACT_IDS.map(id=>[id,filePin(bytes[id])]));
  const proofs={},proof_files={};for(const role of Object.keys(BENCH_PROOF_SCOPES)){
    const paths=proofPaths[role]??[];need(Array.isArray(paths)&&paths.length<=16,'Proof configuration differs: '+role);proofs[role]=[];
    for(let index=0;index<paths.length;index++){const id=`${role}-${String(index+1).padStart(2,'0')}`;bytes[id]=await read(paths[index]);proof_files[id]=filePin(bytes[id]);proofs[role].push(id);}
  }
  need(Object.keys(proofPaths).every(role=>Object.hasOwn(BENCH_PROOF_SCOPES,role)),'Unsupported qualification proof role');
  const manifest={schema:LOCAL_BENCH_V1.schema,version:1,scope:LOCAL_BENCH_V1.scope,status:'HELD_SOFTWARE_PROOFS_OR_ROOT_REVIEW_REQUIRED',identity:'openSynth N1',policy_id:'50544E31',
    candidate:envelope.image,restoration:{role:'restoration',format:'spuafw10-abi2',...P6S_IMAGE},writer:{...B2},artifacts,proof_files,proofs,root_review:null,
    software_eligible_for_owner_test:false,hardware_qualified:false,public_release_eligible:false,candidate_upload_enabled:false,prior_candidate_hardware_proof_required:false};
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),softwareEvidenceFiles=Object.fromEntries(Object.entries(bytes).map(([id,body])=>[id,blob(body)]));
  const inputs={ownerTestEligibilityManifest:blob(manifestBytes),candidate:blob(candidateBytes),restoration:blob(restoreBytes),softwareEvidenceFiles,restorationEvidenceFiles:restoreEvidence.evidenceFiles};
  const inspection=await inspectLocalBenchByteBindings(inputs);
  return {manifest,manifestBytes,bytes,candidateBytes,restoreBytes,bundleBytes,inputs,inspection,
    staticCounts:{sourceAuthorityFiles,builtSources,objects,stackReceipts,nativePatches:recipe.patches.length,toolFilesDeclared:authority.tool_files.length,compilerCalls:0},
    producerCompilationProvenance:{retainedCurrentTransactionUnits:report.retained_current_transaction_units??null,newlyCompiledUnits:report.newly_compiled_units??null,
      freshSuccessorModuleLink:report.fresh_successor_module_link??null,singleNormalEntryEndToEndExecution:report.single_normal_entry_end_to_end_execution??null,
      phaseInputReadsBeforeAuditHook:report.phase_input_reads_before_audit_hook??null,auditScope:report.audit_scope??null},
    limitations:['Actual source/tool/module/image receipt and root review retain the compiler provenance/read-tracing limits.','No actual linked audio, memory/runtime, recording/composition result is inferred from these static byte checks.']};
}

export async function writeBenchProposal(options,output,{rootReviewVersion=1}={}) {
  need(rootReviewVersion===1||rootReviewVersion===2,'Unsupported held root review template version');
  const proposal=await collectBenchProposal(options),path=await newPrivateOutput(output),files={};await mkdir(resolve(path,'evidence'));
  for(const [id,body] of Object.entries(proposal.bytes)){const name=`evidence/${id}.bin`;await writeFile(resolve(path,name),body,{flag:'wx'});files[id]=name;}
  for(const [name,body] of [['OWNER_TEST_ELIGIBILITY.json',proposal.manifestBytes],['candidate.disabled.bin',proposal.candidateBytes],['restoration-p6s.bin',proposal.restoreBytes],['P6S_EVIDENCE.json',proposal.bundleBytes]])await writeFile(resolve(path,name),body,{flag:'wx'});
  await writeFile(resolve(path,'INPUT_FILES.json'),JSON.stringify({schema:'opensp-localbench-input-files-v1',version:1,manifest:'OWNER_TEST_ELIGIBILITY.json',candidate:'candidate.disabled.bin',restoration:'restoration-p6s.bin',restoration_evidence_bundle:'P6S_EVIDENCE.json',software_evidence:files,root_seal:null},null,2)+'\n',{flag:'wx'});
  const result={schema:'opensp-localbench-proposal-review-v1',status:'HELD_EXACT_IMAGE_PROPOSAL_NO_TRANSFER_AUTHORITY',subject:proposal.inspection.subject,
    manifest:filePin(proposal.manifestBytes),candidate:proposal.inspection.candidate,staticCounts:proposal.staticCounts,producerCompilationProvenance:proposal.producerCompilationProvenance,blockers:proposal.inspection.blockers,limitations:proposal.limitations,
    softwareEligibleForOwnerTest:false,rootSealCreated:false,deviceOperations:false,firmwareRebuilt:false};
  const template={schema:'opensp-priority1-root-software-bench-review-v1',version:1,subject:proposal.inspection.subject,
    checks:Object.fromEntries(Object.entries(BENCH_PROOF_SCOPES).map(([role,scope])=>[role,{scope,conclusion:'UNREVIEWED_HELD',receipt_ids:proposal.manifest.proofs[role],limitations:['Root must review actual exact-image qualifying receipts for this scope.']} ])),
    decision:'HELD_QUALIFYING_PROOFS_REQUIRED',public_release_eligible:false,same_candidate_prior_hardware_required:false};
  if(rootReviewVersion===2){template.schema=ROOT_SOFTWARE_REVIEW_V2.schema;template.version=2;template.first_owner_test_scope=ROOT_SOFTWARE_REVIEW_V2.firstOwnerTestScope;template.repeat_qualified=false;
    template.checks.recording_flow.scope=ROOT_SOFTWARE_REVIEW_V2.recordingScope;}
  await writeFile(resolve(path,'ROOT_SOFTWARE_REVIEW.template.json'),JSON.stringify(template,null,2)+'\n',{flag:'wx'});
  await writeFile(resolve(path,'PROPOSAL_REVIEW.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}

export async function loadBenchTransaction(directory) {
  const root=await realpath(resolve(directory)),map=JSON.parse(await read(resolve(root,'INPUT_FILES.json')));
  need(map.schema==='opensp-localbench-input-files-v1'&&map.version===1,'Bench file-map schema differs');
  const owned=async label=>{const path=resolve(root,label);need(inside(root,path),'Bench file map escapes transaction');return read(path);};
  const softwareEvidenceFiles={};for(const [id,label] of Object.entries(map.software_evidence))softwareEvidenceFiles[id]=blob(await owned(label));
  const restoration=blob(await owned(map.restoration)),bundle=await readRetainedP6SEvidenceBundle(blob(await owned(map.restoration_evidence_bundle)));
  return {root,map,inputs:{ownerTestEligibilityManifest:blob(await owned(map.manifest)),candidate:blob(await owned(map.candidate)),restoration,
    rootSeal:map.root_seal?blob(await owned(map.root_seal)):undefined,softwareEvidenceFiles,restorationEvidenceFiles:bundle.evidenceFiles}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const flags={};for(let index=2;index<process.argv.length;index+=2){const key=process.argv[index],value=process.argv[index+1];need(['--package-root','--source-kit','--source-archive','--source-handoff','--official','--restoration','--evidence-bundle','--proof-config','--root-review-version','--output'].includes(key)&&value&&!flags[key],'Invalid/duplicate bench preparation argument');flags[key]=value;}
  for(const key of ['--package-root','--source-kit','--source-archive','--source-handoff','--official','--restoration','--evidence-bundle','--output'])need(flags[key],'Missing bench preparation argument: '+key);
  const proofPaths=flags['--proof-config']?JSON.parse(await read(flags['--proof-config'])):{};
  process.stdout.write(JSON.stringify(await writeBenchProposal({packageRoot:flags['--package-root'],sourceKitRoot:flags['--source-kit'],sourceArchive:flags['--source-archive'],sourceHandoff:flags['--source-handoff'],official:flags['--official'],restoration:flags['--restoration'],evidenceBundle:flags['--evidence-bundle'],proofPaths},flags['--output'],{rootReviewVersion:Number(flags['--root-review-version']??1)}),null,2)+'\n');
}
