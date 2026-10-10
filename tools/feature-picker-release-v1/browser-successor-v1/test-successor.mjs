import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,relative,isAbsolute} from 'node:path';
import {blankSelection,defaultChoice,exportSelection} from '../../../src/lib/features/selection.ts';
import {canonicalLocalSelection,selectionConfiguration,readStandaloneReceipt,inspectStandaloneReceipt,heldB2Handoff} from '../../../src/lib/features/standaloneReceipt.ts';
import {readHelperConnection,createHelperClient} from '../../../src/lib/features/localBuildConnection.ts';
import {checkedSiteOrigin,parseServerArgs,fixedStandaloneRuntime,startLocalBuildServer,executeStandaloneBuild} from './local-server.mjs';
import {inspectBuildForBrowser} from './receipt.mjs';

const selection=blankSelection();selection.features=[defaultChoice('synth')];const canonical=exportSelection(selection);
test('closed helper options refuse caller source/hash/macro/command authority',()=>{for(const key of ['authority','source','macro','command','compiler-sha256'])assert.throws(()=>parseServerArgs([`--${key}`,'anything']));});
test('approved exact site origins only',()=>{assert.equal(checkedSiteOrigin('http://127.0.0.1:4321'),'http://127.0.0.1:4321');assert.equal(checkedSiteOrigin('https://opensp.fyi'),'https://opensp.fyi');for(const text of ['http://example.test','http://localhost:4321/path','https://opensp.fyi.evil.test','http://user@127.0.0.1:4321'])assert.throws(()=>checkedSiteOrigin(text));});
test('canonical selection rejects alternate bytes and unsupported profiles',()=>{assert.equal(canonicalLocalSelection(canonical).features[0].id,'synth');assert.throws(()=>canonicalLocalSelection(canonical.trim()));assert.throws(()=>canonicalLocalSelection(canonical.replace('roland-5.52','stock')));});
test('collision, reserved key and subset chord refusals use actual exporter',()=>{
 const s=blankSelection();s.features=[defaultChoice('synth'),defaultChoice('usb-recorder')];s.features[1].shortcut={...s.features[1].shortcut,controls:[...s.features[0].shortcut.controls]};assert.throws(()=>exportSelection(s));s.features=[defaultChoice('synth')];s.features[0].shortcut.controls=['SHIFT','DEL'];assert.throws(()=>exportSelection(s));
});
test('ordered shortcuts bind configuration and marker',async()=>{const a=await selectionConfiguration(selection),b=structuredClone(selection);b.features[0].shortcut.controls.reverse();const c=await selectionConfiguration(b);assert.notEqual(a.sha256,c.sha256);assert.notEqual(a.marker,c.marker);assert.equal(a.bytes.length,128);});
test('bounded receipt parser refuses duplicate fields and oversize text',()=>{assert.throws(()=>readStandaloneReceipt('{"version":1,"version":1}'));assert.throws(()=>readStandaloneReceipt(' '.repeat(32769)));});
test('browser connection is exact loopback and its capability stays out of URLs',async()=>{
 const capability='A'.repeat(43),connection=`http://127.0.0.1:45123/#${capability}`;assert.equal(readHelperConnection(connection).capability,capability);
 for(const text of [`https://127.0.0.1:45123/#${capability}`,`http://example.test:45123/#${capability}`,`http://127.0.0.1:45123/path#${capability}`,`http://user@127.0.0.1:45123/#${capability}`])assert.throws(()=>readHelperConnection(text));
 let observed;const client=createHelperClient(connection,async(url,options)=>{observed={url,options};return new Response(JSON.stringify({schema:'opensp-local-feature-helper-v1',recipe:'standalone-source16-selected-v1',source_archive:{bytes:1032317,sha256:'3abb90aafe7ecc1ca669a3f3e35885ddbf3803200db96768ef43fdd16b424117'},jobs:[],public_ready:false,browser_upload_enabled:false,device_operations:false}));});
 await client.state();assert(!observed.url.includes(capability));assert.equal(observed.options.headers['X-OpenSP-Capability'],capability);assert.equal(observed.options.credentials,'omit');assert.equal(observed.options.referrerPolicy,'no-referrer');
 const wrong=createHelperClient(connection,async()=>new Response(JSON.stringify({schema:'compact-p6j2'})));await assert.rejects(wrong.state());
});

const env={sourceArchive:process.env.OPENSP_STANDALONE_ARCHIVE,build:process.env.OPENSP_STANDALONE_BUILD,official:process.env.OPENSP_STANDALONE_OFFICIAL,python:process.env.OPENSP_STANDALONE_PYTHON,tools:process.env.OPENSP_STANDALONE_TOOLS};
test('actual retained 151+27 source transaction → receipt → byte admission → held handoff', {skip:!Object.values(env).every(Boolean)},async t=>{
 const fixture=await inspectBuildForBrowser({...env,runKey:'retained-review'}),s=canonicalLocalSelection(fixture.selectionRaw.toString('utf8'));
 const valid=await inspectStandaloneReceipt(s,fixture.receipt,fixture.candidate);assert.equal(valid.candidateVerified,true);assert.equal(valid.sourceExecutionAuthenticated,false);assert.equal(heldB2Handoff(valid).upload_authorized,false);assert.equal(fixture.receipt.source_recompiled_this_request,false);
 const config=await selectionConfiguration(s);assert.deepEqual(Buffer.from(config.bytes),await readFile(resolve(env.build,'selected-build/config.bin')));
 await t.test('changing selected intent invalidates the actual receipt',async()=>{const changed=structuredClone(s);changed.features[0].shortcut=null;await assert.rejects(inspectStandaloneReceipt(changed,fixture.receipt,fixture.candidate));});
 for(const [name,alter]of [
  ['runtime promotion',r=>r.runtime_qualified=true],['physical promotion',r=>r.hardware_qualified=true],['public promotion',r=>r.public_ready=true],['upload promotion',r=>r.browser_upload_enabled=true],
  ['caller source authority',r=>r.source.authority_sha256='0'.repeat(64)],['source recipe substitution',r=>r.recipe='compact-p6j2'],['config marker substitution',r=>r.configuration.session_marker='00000000'],
  ['ownership collision',r=>r.candidate.writable_intervals[1].address=r.candidate.writable_intervals[0].address],['config bounds',r=>r.configuration.address=0x84000000],['writer upper bound',r=>r.candidate.bytes=0x37f001],['restoration substitution',r=>r.restoration.sha256=r.candidate.sha256],['extra source grant',r=>r.source.macro='ANY']]){
  await t.test(name,async()=>{const receipt=structuredClone(fixture.receipt);alter(receipt);await assert.rejects(inspectStandaloneReceipt(s,receipt,fixture.candidate));});
 }
 const awaitedMetadata=await inspectStandaloneReceipt(s,fixture.receipt);
 await t.test('changed candidate bytes and absent candidate refuse byte handoff',async()=>{const corrupt=Buffer.from(fixture.candidate);corrupt[256]^=1;await assert.rejects(inspectStandaloneReceipt(s,fixture.receipt,corrupt));assert.throws(()=>heldB2Handoff(awaitedMetadata),/Inspect the complete candidate/);});
 const parent=await mkdtemp(resolve(tmpdir(),'opensp-picker-successor-'));let helper,release;
 try{
  const runtime=await fixedStandaloneRuntime({'source-archive':env.sourceArchive,python:env.python,'toolchain-root':env.tools,official:env.official,'output-root':parent,'site-origin':'http://127.0.0.1:4321','existing-build':env.build});
  await t.test('new output cannot modify installed tools or retained evidence',async()=>{const options={'source-archive':env.sourceArchive,python:env.python,'toolchain-root':env.tools,official:env.official,'output-root':resolve(env.tools,'bin'),'site-origin':'http://127.0.0.1:4321'};await assert.rejects(fixedStandaloneRuntime(options));await assert.rejects(fixedStandaloneRuntime({...options,'output-root':env.build,'existing-build':env.build}));});
  let executions=0;const pending=new Promise(resolve=>release=resolve);
  helper=await startLocalBuildServer({fixedRuntime:runtime,executeBuild:async()=>{executions++;await pending;throw Error('Owned inert failure; no compiler child.');}});
  const headers={Origin:runtime.origin,'X-OpenSP-Capability':helper.capability,'Content-Type':'application/json'};
  const request=(path,options={})=>fetch(helper.origin+path,{...options,headers:{...headers,...options.headers}});
  await t.test('actual helper stages retained proof with no compiler, then serves exact bytes',async()=>{const state=await(await request('/v1/state')).json();assert.equal(state.jobs[0].phase,'checked');assert.equal(state.jobs[0].receipt.source_recompiled_this_request,false);const bytes=Buffer.from(await(await request('/v1/jobs/retained-proof/artifact/candidate')).arrayBuffer());assert.deepEqual(bytes,fixture.candidate);assert.equal(executions,0);});
  await t.test('origin and capability must both match',async()=>{assert.equal((await request('/v1/state',{headers:{Origin:'http://example.test'}})).status,400);assert.equal((await request('/v1/state',{headers:{'X-OpenSP-Capability':'wrong'}})).status,400);});
  await t.test('extra authority, path traversal, duplicate keys and stale canonical bytes refuse before child',async()=>{for(const body of [JSON.stringify({run_key:'refuse',selection:canonical,source_authority:'any'}),JSON.stringify({run_key:'../outside',selection:canonical}),JSON.stringify({run_key:'refuse',selection:canonical.trim()}),' {"run_key":"a","run_key":"b","selection":""}'])assert.equal((await request('/v1/build',{method:'POST',body})).status,400);assert.equal(executions,0);});
  await t.test('unknown artifact roles and arbitrary filesystem query refuse',async()=>{assert.notEqual((await request('/v1/jobs/retained-proof/artifact/private')).status,200);assert.equal((await request('/v1/state?path=outside')).status,400);});
  await t.test('single actual job owns the builder, failed phase never gains a receipt',async()=>{assert.equal((await request('/v1/build',{method:'POST',body:JSON.stringify({run_key:'inert-failure',selection:canonical})})).status,202);assert.equal((await request('/v1/build',{method:'POST',body:JSON.stringify({run_key:'second',selection:canonical})})).status,400);release();for(let i=0;i<20;i++){const result=await(await request('/v1/jobs/inert-failure')).json();if(result.phase==='failed')break;await new Promise(accept=>setTimeout(accept,5));}const result=await(await request('/v1/jobs/inert-failure')).json();assert.equal(result.phase,'failed');assert.equal(result.receipt,null);assert.equal((await request('/v1/jobs/inert-failure/artifact/candidate')).status,400);assert.equal(executions,1);});
  await t.test('new production child seam reaches actual launcher refusal with no compiler',async()=>{
   const inert=resolve(parent,'owned-inert-input.bin'),selectionPath=resolve(parent,'child-selection.json'),output=resolve(parent,'actual-child-refusal');await writeFile(inert,Buffer.alloc(32));await writeFile(selectionPath,canonical);
   await assert.rejects(executeStandaloneBuild({...runtime,official:inert},{selectionPath,output}),/standalone builder refused/);
   const refusal=JSON.parse(await readFile(resolve(output,'REFUSAL_REPORT.json'),'utf8')),stderr=await readFile(resolve(output,'launcher.stderr.log'),'utf8');
   assert.equal(refusal.child_exit_status,1);assert.equal(refusal.selected_candidate_created,false);assert.equal(refusal.partial_source_materialization,false);assert(stderr.includes('Expected the pinned official v5.52 ZIP or unchanged APP1'));await assert.rejects(access(resolve(output,'build')));await assert.rejects(access(resolve(output,'LOCAL_BUILD_REPORT.json')));
  });
 }finally{
  release?.();await helper?.close();const child=relative(resolve(tmpdir()),parent);assert(!isAbsolute(child)&&!child.startsWith('..')&&child.startsWith('opensp-picker-successor-'));await rm(parent,{recursive:true,force:true});
 }
});
