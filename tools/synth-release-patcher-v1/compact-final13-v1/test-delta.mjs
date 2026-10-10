import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FINAL13,P6S} from './pins.mjs';
import {hash,json} from './common.mjs';
import {checkedCompactArchive} from './source.mjs';
import {checkCompactReport,inspectCompactBuild} from './inspect.mjs';
import {inspectCompactHandoff} from './handoff.mjs';
import {runCompactPatcher} from './build.mjs';
import {inspectReferenceOwnerHandoff,authenticateReferenceArtifacts} from './owner-handoff.mjs';

const here=dirname(fileURLToPath(import.meta.url)),root=process.env.OPENSP_COMPACT_DELTA_ROOT,official=process.env.OPENSP_COMPACT_DELTA_OFFICIAL;
assert(root&&official,'Set OPENSP_COMPACT_DELTA_ROOT to retained synth evidence and OPENSP_COMPACT_DELTA_OFFICIAL to unchanged official firmware.');
const at=name=>resolve(root,name),sourceArchive=resolve(here,'source-final13.zip'),sourceArchiveRaw=await readFile(sourceArchive),admitted=checkedCompactArchive(sourceArchiveRaw);
const build=at('build/priority1-release-candidate-v1/final-package-07'),previous=at('build/priority1-release-candidate-v1/final-package-06'),restoration=at('build/sol-restore-source-v1/audited-build-04/restore-p6s.disabled.bin');
const ownerRaw=await readFile(at('diagnostics/synth_p6/priority1_release_candidate_v1/FINAL07_HANDOFF.json')),candidateRaw=await readFile(resolve(build,'candidate.disabled.bin')),restorationRaw=await readFile(restoration);
const report=json(await readFile(resolve(build,'REPORT.json'))),inputs={sourceArchiveRaw,officialRaw:await readFile(official),restorationRaw};
async function owned(fn){const base=await realpath(tmpdir()),dir=await mkdtemp(resolve(base,'opensp-final13-delta-'));try{return await fn(dir);}finally{const actual=await realpath(dir),child=relative(base,actual);assert(!isAbsolute(child)&&!child.includes('/')&&!child.includes('\\')&&child.startsWith('opensp-final13-delta-'));await rm(actual,{recursive:true});}}
async function handoff(dir){await runCompactPatcher({mode:'inspect','source-archive':sourceArchive,official,restoration,build,output:resolve(dir,'inspection')});return json(await readFile(resolve(dir,'inspection/COMPACT_HANDOFF.json')));}

test('kit13 authenticates exact archive entry authority plan and corrected pattern106 source',()=>{
  assert.equal(admitted.members.size,358);assert.equal(admitted.plan.compile_commands.length,109);assert.equal(Object.keys(admitted.plan.inputs).length,310);
  assert.equal(hash(admitted.members.get('build_candidate.py')),FINAL13.entry_sha256);assert.deepEqual(admitted.plan.component_join,FINAL13.component_join);
  assert.equal(admitted.plan.inputs['priority1-additions/sp_p6_pattern_transport_v552.c'],FINAL13.component_join.pattern_chain_idle_source_sha256);
});
test('only the declared pattern source differs across the sealed module plans',async()=>{
  const old=json(await readFile(at('build/priority1-release-candidate-v1/source-review-kit-12/source-kit/inputs/module-plan.json')));
  assert.deepEqual(Object.keys(old.inputs),Object.keys(admitted.plan.inputs));assert.deepEqual(admitted.plan.compile_commands,old.compile_commands);assert.deepEqual(admitted.plan.link_command,old.link_command);
  assert.deepEqual(Object.keys(old.inputs).filter(name=>old.inputs[name]!==admitted.plan.inputs[name]),['priority1-additions/sp_p6_pattern_transport_v552.c']);
});
test('actual objects preserve108 hashes and change only unit106',async()=>{
  const changed=[];for(let index=0;index<109;index++){const name=`module/objects/unit-${String(index).padStart(3,'0')}.o`;if(hash(await readFile(resolve(previous,name)))!==hash(await readFile(resolve(build,name))))changed.push(index);}
  assert.deepEqual(changed,[106]);
});
test('exact frozen owner handoff authenticates all30 actual artifact pins without qualification',async()=>{
  const result=await authenticateReferenceArtifacts(ownerRaw,root);assert.equal(result.reference_owner_handoff_sha256,FINAL13.reference_owner_handoff_sha256);assert.equal(result.reference_artifacts_checked,30);assert.equal(result.current_transaction_reuse_rows,108);assert.equal(result.successful_compile_command_rows,1);assert.equal(result.software_eligible_for_owner_test,false);assert.equal(result.canonical_entry_completed,false);
});
test('changed owner receipt refuses before any artifact paths are read',()=>{
  const changed=Buffer.from(ownerRaw);changed[changed.length-2]^=1;assert.throws(()=>inspectReferenceOwnerHandoff(changed),/no code-owned admission/);
});
test('historical kit12 is refused by kit13 admission',async()=>{
  const raw=await readFile(at('build/priority1-release-candidate-v1/source-review-kit-12/source-review-kit.zip'));assert.throws(()=>checkedCompactArchive(raw),/no code-owned/);
});
test('historical final06 is refused by final07 build admission',async()=>{await assert.rejects(inspectCompactBuild(previous,inputs),/source\/configuration/);});
test('actual final07 complete replay preserves109 units202 patches and108reuse1compile scope',async()=>{
  const result=await inspectCompactBuild(build,inputs);assert.equal(result.objects_checked,109);assert.equal(result.module_source_files_checked,310);assert.equal(result.native_patches_replayed,202);assert.equal(result.current_transaction_reuse_rows,108);assert.equal(result.successful_compile_command_rows,1);assert.equal(result.fresh_compile_execution_attested,false);assert.equal(result.report_sha256,FINAL13.reference_report_sha256);assert.equal(result.candidate.sha256,FINAL13.candidate.sha256);assert.equal(result.candidate.sectors,722);assert.equal(result.restoration.sha256,P6S.sha256);assert.equal(result.restoration.sectors,670);
});
test('normal inspect producer binds the frozen owner reference and invokes no compiler',()=>owned(async dir=>{
  let called=false;const output=resolve(dir,'inspection'),result=await runCompactPatcher({mode:'inspect','source-archive':sourceArchive,official,restoration,build,output},{execute:()=>{called=true;throw Error('No compiler allowed');}});
  assert.equal(called,false);assert.equal(result.canonical_entry_completed,false);const value=json(await readFile(resolve(output,'COMPACT_HANDOFF.json')));assert.equal(value.reference_owner_handoff_sha256,FINAL13.reference_owner_handoff_sha256);assert.equal(value.current_transaction_reuse_rows,108);assert.equal(value.successful_compile_command_rows,1);assert.equal(inspectCompactHandoff(Buffer.from(JSON.stringify(value)),candidateRaw,restorationRaw).delivery,'DO_NOT_DELIVER');
}));
test('changed final07 candidate is refused by the emitted handoff',()=>owned(async dir=>{
  const value=await handoff(dir),changed=Buffer.from(candidateRaw);changed[106]^=1;assert.throws(()=>inspectCompactHandoff(Buffer.from(JSON.stringify(value)),changed,restorationRaw),/candidate bytes/);
}));
test('final07 handoff refuses promoted upload and joined-route qualification',()=>owned(async dir=>{
  const value=await handoff(dir),promoted={...value,upload_enabled:true};assert.throws(()=>inspectCompactHandoff(Buffer.from(JSON.stringify(promoted)),candidateRaw,restorationRaw),/promotes/);
  const route=structuredClone(value);route.component_join.pattern_normal_route_qualified=true;assert.throws(()=>inspectCompactHandoff(Buffer.from(JSON.stringify(route)),candidateRaw,restorationRaw),/borrows join/);
}));
test('108 reused units cannot be relabelled a fresh109 canonical entry',()=>owned(async dir=>{
  const value=await handoff(dir),changed={...value,canonical_entry_completed:true,source_recompiled_in_this_patcher:true,fresh_compile_execution_attested:true,compilation_observation:'109_SUCCESSFUL_CURRENT_CHILD_COMMAND_ROWS'};assert.throws(()=>inspectCompactHandoff(Buffer.from(JSON.stringify(changed)),candidateRaw,restorationRaw),/compile or reuse row scope/);
}));
test('kit13 report refuses stale pattern-index review and source bindings',()=>{
  for(const key of ['pattern_chain_idle_source_sha256','pattern_chain_idle_source_review_sha256']){const changed=structuredClone(report);changed.component_join[key]='0'.repeat(64);assert.throws(()=>checkCompactReport(changed),/component joins/);}
});
