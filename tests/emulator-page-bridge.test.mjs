import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {EmulatorWorkerBridge} from '../src/lib/emulator/worker-rpc.ts';

// Run the actual page controller against a small DOM and protocol port. No browser, worker or CPU runs.
const source = readFileSync(new URL('../src/scripts/emulator.ts', import.meta.url), 'utf8');
const copy = JSON.parse(readFileSync(new URL('../src/content/emulator.json', import.meta.url), 'utf8'));
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const hash = 'a'.repeat(64);
const snapshot = overrides => ({state: 'loaded', pc: 0x60080000, instructions: 0, firmwareHash: hash,
  display: Array(1024).fill(0), unknownMmio: [], ...overrides});

class Node extends EventTarget {
  value = ''; disabled = false; hidden = false; textContent = ''; isConnected = true;
  dataset = {}; attributes = new Map(); children = [];
  nodes = new Map();
  classList = {toggle() {}, remove() {}};
  setAttribute(name, value) {this.attributes.set(name, value);}
  removeAttribute(name) {this.attributes.delete(name);}
  querySelector(selector) {if (!this.nodes.has(selector)) this.nodes.set(selector, new Node()); return this.nodes.get(selector);}
  querySelectorAll() {return [];}
  replaceChildren(...children) {this.children = children; this.textContent = children.map(child => child.textContent).join('');}
  getContext() {return null;}
  click() {}
}
class Port extends EventTarget {
  requests = []; terminations = 0;
  postMessage(request) {this.requests.push(request);}
  terminate() {this.terminations++;}
  emit(id, type, fields = {}) {this.dispatchEvent(new MessageEvent('message', {data: {id, type, ...fields}}));}
  status(request, overrides) {this.emit(request.id, 'status', snapshot(overrides));}
}
function setup(t, loader, clock, updateLoader) {
  const ports = [], exports = [], element = new Node(), document = new EventTarget();
  document.hidden = false; document.querySelector = () => null; document.createElement = () => new Node();
  element.querySelector('[data-format]').value = 'app1';
  const factory = () => {const port = new Port(); ports.push(port); return new EmulatorWorkerBridge(port);};
  const context = vm.createContext({copy, document, window: new EventTarget(), AbortController,ArrayBuffer,Uint8Array,
    Blob:class{constructor(parts){exports.push(parts.join(''));}},URL:{createObjectURL:()=> 'blob:local-test',revokeObjectURL(){}},
    setTimeout: clock?.setTimeout ?? setTimeout, clearTimeout: clock?.clearTimeout ?? clearTimeout,
    console, loadBridge: loader ?? (async () => ({createBrowserWorkerBridge: factory})),
    loadUpdater: updateLoader ?? (() => Promise.reject(new Error('Unexpected updater import')))});
  const adapted = source.replace("import copy from '../content/emulator.json';", '')
    .replace("import('../lib/emulator/worker-rpc')", 'loadBridge()')
    .replaceAll("import('../lib/emulator/update-ui')", 'loadUpdater()');
  vm.runInContext(`${stripTypeScriptTypes(adapted, {mode: 'transform'})}\nglobalThis.PageSession = BrowserSession;`, context);
  const session = new context.PageSession(element, () => {});
  t.after(() => session.close());
  const choose = async (name = 'local.bin', read = async () => Uint8Array.of(1, 2).buffer) => {
    element.querySelector('[data-file]').files = [{name, size: 2, arrayBuffer: read}];
    await session.readFile();
  };
  return {session, element, ports, choose, factory, exports};
}
async function running(fixture) {
  await fixture.choose(); const task = fixture.session.start(); await flush();
  const port = fixture.ports[0], load = port.requests[0];
  port.emit(load.id, 'loaded', snapshot()); port.status(load); await flush();
  port.status(port.requests[1], {state: 'running', instructions: 10}); await task;
  return port;
}

test('the page waits for load and USB same-ID status while unsolicited replies only publish', async t => {
  const f = setup(t); await f.choose(); assert.equal(f.ports.length, 0);
  const starting = f.session.start(); await flush(); const port = f.ports[0], load = port.requests[0];
  port.emit(load.id, 'loaded', snapshot()); await flush();
  assert.equal(f.element.attributes.get('aria-busy'), 'true'); assert.deepEqual(port.requests.map(row => row.command), ['load']);
  port.status({id: 999}, {state: 'running', instructions: 100}); await flush();
  assert.equal(port.requests.length, 1);
  port.status(load); await flush(); assert.equal(port.requests[1].command, 'run');
  port.status(port.requests[1], {state: 'running', instructions: 10}); await starting;
  assert.equal(f.element.attributes.get('aria-busy'), 'false');
  const usb = f.session.perform('usb'); const request = port.requests[2];
  port.emit(request.id, 'usb', {report: Array(64).fill(0x53)});
  port.status({id: 0}, {state: 'running', instructions: 11});
  port.status({id: 999}, {state: 'paused', instructions: 12}); await flush();
  assert.equal(f.element.attributes.get('aria-busy'), 'true');
  assert.equal(f.element.querySelector('[data-usb-result]').textContent, copy.noReport);
  port.status(request, {state: 'paused', instructions: 12}); await usb;
  assert.equal(f.element.attributes.get('aria-busy'), 'false');
  assert.match(f.element.querySelector('[data-usb-result]').textContent, /^53 53/);
});

test('the page generic reset clears an old mailbox and needs no guest boot steps', async t => {
  const f = setup(t), port = await running(f);
  port.status({id: 0}, {state: 'running', instructions: 11, marker: 0x523d0001, heartbeat: 1, firmwareState: 2}); await flush();
  assert.match(f.element.querySelector('[data-diagnostic="marker"]').textContent, /523D0001/);
  const reset = f.session.perform('reset'); port.status(port.requests.at(-1)); await reset;
  assert.equal(f.element.querySelector('[data-diagnostic="marker"]').textContent, '—');
  assert.equal(f.element.dataset.state, 'paused');
  assert.deepEqual(port.requests.map(row => row.command), ['load', 'run', 'reset']);
  const resume = f.session.perform('run'); port.status(port.requests.at(-1), {state: 'running', instructions: 1}); await resume;
  assert.equal(f.element.dataset.state, 'running');
});

test('file replacement cancels a pending bridge import before worker creation', async t => {
  const importGate = deferred(); const f = setup(t, () => importGate.promise);
  await f.choose('first.bin'); const start = f.session.start();
  await f.choose('replacement.bin'); importGate.resolve({createBrowserWorkerBridge: f.factory}); await start;
  assert.equal(f.ports.length, 0); assert.equal(f.element.dataset.state, 'ready');
  assert.equal(f.element.attributes.get('aria-busy'), 'false');
  assert.match(f.element.querySelector('[data-firmware-name]').textContent, /replacement.bin/);
});

test('old load rejection and completion cannot change a replacement file or release its busy state', async t => {
  const f = setup(t); await f.choose('first.bin'); const oldStart = f.session.start(); await flush();
  const old = f.ports[0]; await f.choose('new.bin'); const newStart = f.session.start(); await flush(); await oldStart;
  old.emit(old.requests[0].id, 'error', {message: 'Stale load error'}); old.status(old.requests[0], {state: 'fault'}); await flush();
  assert.equal(old.terminations, 1); assert.equal(f.element.dataset.state, 'loading');
  assert.equal(f.element.attributes.get('aria-busy'), 'true'); assert.equal(f.element.querySelector('[data-session-error]').hidden, true);
  const current = f.ports[1], load = current.requests[0]; current.emit(load.id, 'loaded', snapshot()); current.status(load); await flush();
  current.status(current.requests[1], {state: 'running', instructions: 5}); await newStart;
  assert.equal(f.element.dataset.state, 'running'); assert.equal(f.element.attributes.get('aria-busy'), 'false');
});

for (const action of ['close', 'suspend']) test(`${action} cancels pending file reads and worker operations`, async t => {
  const f = setup(t), fileGate = deferred(); const read = f.choose('late.bin', () => fileGate.promise);
  f.session[action](); fileGate.resolve(Uint8Array.of(1).buffer); await read;
  assert.equal(f.element.dataset.state, 'empty'); assert.equal(f.ports.length, 0);
  if (action === 'close') return;
  const port = await running(f), pending = f.session.perform('pause'); f.session.suspend();
  port.status(port.requests.at(-1), {state: 'running', instructions: 999}); await pending;
  assert.equal(port.terminations, 1); assert.equal(f.element.dataset.state, 'ready');
  assert.equal(f.element.attributes.get('aria-busy'), 'false');
});

test('file read results and errors remain fresh across replacement', async t => {
  const f = setup(t), first = deferred(); const reading = f.choose('old.bin', () => first.promise);
  await f.choose('fresh.bin'); first.reject(new Error('Late local read failure')); await reading;
  assert.equal(f.element.dataset.state, 'ready'); assert.equal(f.element.querySelector('[data-session-error]').hidden, true);
  assert.match(f.element.querySelector('[data-firmware-name]').textContent, /fresh.bin/);
});

test('bridge observations preserve bounded command and USB ledgers without firmware bytes', async t => {
  const f = setup(t), port = await running(f);
  for (let index = 0; index < 260; index++) {
    const input = f.session.perform('input', {input: {control: 'VOLUME', value: 0.5}});
    port.status(port.requests.at(-1), {state: 'paused', instructions: 10}); await input;
  }
  const text = f.element.querySelector('[data-usb-report]'); text.value = Array(64).fill('00').join(' ');
  for (let index = 0; index < 70; index++) {
    f.session.usb(); const request = port.requests.at(-1);
    port.emit(request.id, 'usb', {report: Array(64).fill(0)}); port.status(request, {state: 'paused', instructions: 10}); await flush();
  }
  assert.equal(f.session.commandCount, 332); assert.equal(f.session.commands.length, 256);
  assert.equal(f.session.exchanges.length, 128);
  assert.equal(new Set(f.session.commands.map(row => row.id)).size, 256);
  assert.equal(JSON.stringify(f.session.commands).includes('image'), false);
});

function pageClock() {
  const timers = new Map(); let sequence = 0;
  return {timers, setTimeout: (callback, milliseconds) => {const id = ++sequence; timers.set(id, {callback, milliseconds}); return id;},
    clearTimeout: id => timers.delete(id)};
}
test('a stalled bridge chunk times out before Worker creation and a late import cannot revive it', async t => {
  const gate = deferred(), clock = pageClock(), f = setup(t, () => gate.promise, clock);
  await f.choose(); const starting = f.session.start();
  const watch = [...clock.timers.values()].find(timer => timer.milliseconds === 45000); assert.ok(watch);
  watch.callback(); assert.equal(f.element.dataset.state, 'fault'); assert.equal(f.element.attributes.get('aria-busy'), 'false');
  assert.equal(clock.timers.size, 0); assert.match(f.element.querySelector('[data-session-error]').textContent, /runtime loading/);
  gate.resolve({createBrowserWorkerBridge: f.factory}); await starting;
  assert.equal(f.ports.length, 0); assert.equal(f.element.dataset.state, 'fault');
});

test('the run-publication watchdog closes only its owned bridge and leaves cached diagnostics', async t => {
  const clock = pageClock(), first = setup(t, undefined, clock), other = setup(t);
  const port = await running(first), independent = await running(other);
  const watch = [...clock.timers.values()].find(timer => timer.milliseconds === 15000); assert.ok(watch); watch.callback();
  assert.equal(port.terminations, 1); assert.equal(independent.terminations, 0);
  assert.equal(first.element.dataset.state, 'fault'); assert.equal(other.element.dataset.state, 'running');
  assert.equal(first.element.querySelector('[data-diagnostic="hash"]').textContent, hash);
  assert.match(first.element.querySelector('[data-session-error]').textContent, /while running/);
});

test('only the most recent export intent downloads and replacement discards an old trace', async t => {
  const f = setup(t), port = await running(f), downloads = [];
  f.session.download = trace => downloads.push(trace);
  const older = f.session.perform('trace'), newer = f.session.perform('trace');
  const [first, second] = port.requests.slice(-2);
  port.emit(first.id, 'trace', {trace: {scope: 'older'}}); await older;
  port.emit(second.id, 'trace', {trace: {scope: 'newer'}}); await newer;
  assert.deepEqual(downloads, [{scope: 'newer'}]);
  const cancelled = f.session.perform('trace'), request = port.requests.at(-1);
  await f.choose('replacement.bin'); port.emit(request.id, 'trace', {trace: {scope: 'retired'}}); await cancelled;
  assert.deepEqual(downloads, [{scope: 'newer'}]);
});

const cardBytes=()=>new Uint8Array(256*1024).fill(0x5a).buffer;
async function card(f,slot=0,name='private-card.img',bytes=cardBytes()){
  f.element.querySelector(`[data-sd-file="${slot+1}"]`).files=[{name,size:bytes.byteLength,arrayBuffer:async()=>bytes}];
  await f.session.readCard(slot);
}
async function paused(f){
  const port=await running(f),pause=f.session.perform('pause');port.status(port.requests.at(-1),{state:'paused'});await pause;return port;
}
test('two admitted local cards are copied independently and sent only when Start is requested',async t=>{
  const f=setup(t),bytes=cardBytes();await card(f,0,'first.img',bytes);await card(f,1,'second.img',bytes);
  new Uint8Array(bytes)[0]=0;
  assert.equal(f.ports.length,0);assert.notEqual(f.session.cards[0].bytes,f.session.cards[1].bytes);
  assert.equal(new Uint8Array(f.session.cards[0].bytes)[0],0x5a);
  await f.choose();const start=f.session.start();await flush();const port=f.ports[0],load=port.requests[0];
  assert.equal(load.sd1.byteLength,262144);assert.equal(load.sd2.byteLength,262144);
  assert.equal(new Uint8Array(load.sd1)[0],0x5a);assert.notEqual(load.sd1,f.session.cards[0].bytes);
  port.emit(load.id,'loaded',snapshot());port.status(load);await flush();port.status(port.requests[1],{state:'running'});await start;
  assert.equal(JSON.stringify(f.session.commands).includes('private-card'),false);
  assert.equal(JSON.stringify(f.session.commands).includes('first.img'),false);
  assert.equal(JSON.stringify(f.session.commands).includes('"image":'),false);
  assert.equal(JSON.stringify(f.session.commands).includes('"bytes":'),false);
});
test('invalid card geometry is refused before reading and preserves the paused worker',async t=>{
  const f=setup(t),port=await paused(f);let reads=0;
  for(const size of [0,262143,262145,134217729]){
    f.element.querySelector('[data-sd-file="1"]').files=[{name:'bad.img',size,arrayBuffer:async()=>{reads++;return cardBytes();}}];
    await f.session.readCard(0);assert.match(f.element.querySelector('[data-sd-error="1"]').textContent,/256 KiB/);
  }
  assert.equal(reads,0);assert.equal(port.terminations,0);assert.equal(f.element.dataset.state,'paused');
});
test('admitted card changes stage until Apply cards succeeds and keep old NOR ownership',async t=>{
  const f=setup(t),old=await paused(f);await card(f);
  assert.equal(old.terminations,0);assert.equal(f.element.dataset.state,'paused');
  assert.equal(f.element.querySelector('[data-action="start"]').textContent,copy.applyCards);
  const apply=f.session.start();await flush();const replacement=f.ports[1],load=replacement.requests[0];
  assert.equal(old.terminations,0);assert.equal(f.session.bridge.closed,false);
  assert.equal(f.element.querySelector('[data-file]').disabled,true);
  await f.choose('ignored-during-apply.bin');assert.equal(old.terminations,0);assert.equal(f.session.name,'local.bin');
  replacement.emit(load.id,'loaded',snapshot({firmwareHash:'b'.repeat(64)}));await flush();assert.equal(old.terminations,0);
  replacement.status(load,{firmwareHash:'b'.repeat(64)});await flush();assert.equal(old.terminations,1);
  replacement.status(replacement.requests[1],{state:'running',firmwareHash:'b'.repeat(64)});await apply;
  assert.equal(f.session.bridge.closed,false);assert.equal(f.session.cardChanges(),false);
});
test('failed replacement load leaves the existing paused session available and supports retry',async t=>{
  const f=setup(t),old=await paused(f);await card(f);const apply=f.session.start();await flush();
  const candidate=f.ports[1];candidate.emit(candidate.requests[0].id,'error',{message:'Invalid replacement firmware'});await apply;
  assert.equal(candidate.terminations,1);assert.equal(old.terminations,0);assert.equal(f.element.dataset.state,'paused');
  assert.equal(f.element.querySelector('[data-file]').disabled,false);
  assert.equal(f.element.attributes.get('aria-busy'),'false');assert.equal(f.session.cardChanges(),true);
  const step=f.session.perform('step',{instructions:1});old.status(old.requests.at(-1),{state:'paused',instructions:11});await step;
  assert.equal(f.element.querySelector('[data-diagnostic="instructions"]').textContent,'11');
  const retry=f.session.start();await flush();const fresh=f.ports[2],load=fresh.requests[0];fresh.emit(load.id,'loaded',snapshot());fresh.status(load);await flush();fresh.status(fresh.requests[1],{state:'running'});await retry;
  assert.equal(old.terminations,1);assert.equal(f.session.cardChanges(),false);
});
test('read errors and mismatched buffer lengths preserve previous cards and active session',async t=>{
  const f=setup(t);await card(f);const old=await paused(f),accepted=f.session.cards[0].bytes;
  for(const read of [async()=>{throw Error('private detail');},async()=>new ArrayBuffer(1)]){
    f.element.querySelector('[data-sd-file="1"]').files=[{name:'replacement.img',size:262144,arrayBuffer:read}];
    await f.session.readCard(0);assert.equal(f.session.cards[0].bytes,accepted);assert.equal(old.terminations,0);
    assert.equal(f.element.querySelector('[data-sd-error="1"]').textContent,copy.sdReadError);
  }
});
test('new selection and remove cancel stale card reads without retaining their result',async t=>{
  const f=setup(t),gate=deferred();f.element.querySelector('[data-sd-file="1"]').files=[{name:'late.img',size:262144,arrayBuffer:()=>gate.promise}];
  const read=f.session.readCard(0);await card(f,0,'fresh.img');gate.resolve(cardBytes());await read;
  assert.equal(f.session.cards[0].name,'fresh.img');
  const second=deferred();f.element.querySelector('[data-sd-file="2"]').files=[{name:'late2.img',size:262144,arrayBuffer:()=>second.promise}];
  const reading=f.session.readCard(1);f.session.removeCard(1);second.resolve(cardBytes());await reading;
  assert.equal(f.session.cards[1],undefined);assert.equal(f.session.cardReads.size,0);
});
test('pending reads prevent Start and page suspension cancels their admission',async t=>{
  const f=setup(t),gate=deferred();await f.choose();f.element.querySelector('[data-sd-file="1"]').files=[{name:'late.img',size:262144,arrayBuffer:()=>gate.promise}];
  const read=f.session.readCard(0);await f.session.start();assert.equal(f.ports.length,0);
  assert.equal(f.element.querySelector('[data-action="start"]').disabled,true);
  f.session.suspend();gate.resolve(cardBytes());await read;assert.equal(f.session.cards[0],undefined);assert.equal(f.session.cardReads.size,0);
});
test('running sessions reject card changes and removal while reset preserves admitted cards',async t=>{
  const f=setup(t);await card(f);const port=await running(f),accepted=f.session.cards[0].bytes;
  await card(f,0,'ignored.img');f.session.removeCard(0);assert.equal(f.session.cards[0].bytes,accepted);
  assert.equal(f.element.querySelector('[data-sd-file="1"]').disabled,true);
  const reset=f.session.perform('reset');port.status(port.requests.at(-1));await reset;
  assert.equal(f.session.cards[0].bytes,accepted);assert.equal(f.session.cardChanges(),false);
});
test('removing an applied card remains staged and replaces the worker only on Apply cards',async t=>{
  const f=setup(t);await card(f);const old=await paused(f);f.session.removeCard(0);
  assert.equal(f.session.cardChanges(),true);assert.equal(old.terminations,0);
  const apply=f.session.start();await flush();const candidate=f.ports[1],load=candidate.requests[0];
  assert.equal(load.sd1,undefined);candidate.emit(load.id,'loaded',snapshot());candidate.status(load);await flush();candidate.status(candidate.requests[1],{state:'running'});await apply;
  assert.equal(old.terminations,1);assert.equal(f.session.cardChanges(),false);
});
test('a replacement import timeout and its late completion preserve the existing session',async t=>{
  const clock=pageClock(),gate=deferred();let replacement=false;
  const f=setup(t,()=>replacement?gate.promise:Promise.resolve({createBrowserWorkerBridge:f.factory}),clock);
  const old=await paused(f);await card(f);replacement=true;const apply=f.session.start();
  const watch=[...clock.timers.values()].find(timer=>timer.milliseconds===45000);assert.ok(watch);watch.callback();
  assert.equal(old.terminations,0);assert.equal(f.element.dataset.state,'paused');assert.equal(f.element.attributes.get('aria-busy'),'false');
  gate.resolve({createBrowserWorkerBridge:f.factory});await apply;assert.equal(f.ports.length,1);assert.equal(f.session.cardChanges(),true);
});
test('a faulted replacement snapshot cannot discard the prior virtual session',async t=>{
  const f=setup(t),old=await paused(f);await card(f);const apply=f.session.start();await flush();const candidate=f.ports[1],load=candidate.requests[0];
  candidate.emit(load.id,'loaded',snapshot({state:'fault',fault:'Initialization failed'}));candidate.status(load,{state:'fault',fault:'Initialization failed'});await apply;
  assert.equal(old.terminations,0);assert.equal(candidate.terminations,1);assert.equal(f.element.dataset.state,'paused');
});
test('card names and raw buffers are absent from the page trace envelope',async t=>{
  const f=setup(t,undefined,pageClock());await card(f,0,'private-sd-one.img');await card(f,1,'private-sd-two.img');await running(f);
  f.session.download({scope:'fake trace with zero guest execution'});
  assert.equal(f.exports.length,1);assert.equal(f.exports[0].includes('private-sd'),false);
  const payload=JSON.parse(f.exports[0]);assert.equal(payload.sourceFile.name,'local.bin');
  for(const row of payload.commands.retained){
    assert.equal(row.details?.sd1?.bytes,undefined);assert.equal(row.details?.sd2?.bytes,undefined);
    assert.equal(row.details?.sd1?.name,undefined);assert.equal(row.details?.sd2?.name,undefined);
  }
});
test('terminal initial load failures preserve existing recovery and cached-trace controls',async t=>{
  const f=setup(t);await f.choose();const starting=f.session.start();await flush();const port=f.ports[0];
  port.dispatchEvent(new Event('error'));await starting;
  assert.equal(port.terminations,1);assert.equal(f.element.dataset.state,'fault');
  assert.equal(f.element.querySelector('[data-action="reset"]').disabled,false);
  assert.equal(f.element.querySelector('[data-action="export"]').disabled,false);
  assert.equal(f.session.failure.command,'worker');assert.equal(f.session.commands[0].command,'load');
});
test('initial load publishes safe diagnostics while waiting for the matching trailing status',async t=>{
  const f=setup(t);await f.choose();const starting=f.session.start();await flush();const port=f.ports[0],load=port.requests[0];
  port.emit(load.id,'loaded',snapshot());await flush();
  assert.equal(f.element.querySelector('[data-diagnostic="hash"]').textContent,hash);
  assert.equal(f.element.attributes.get('aria-busy'),'true');assert.equal(f.element.dataset.state,'loading');
  assert.deepEqual(port.requests.map(request=>request.command),['load']);
  port.status({id:load.id+1},{state:'running',firmwareHash:'c'.repeat(64)});await flush();
  assert.equal(f.element.querySelector('[data-diagnostic="hash"]').textContent,hash);
  port.status(load);await flush();port.status(port.requests[1],{state:'running'});await starting;
  assert.equal(f.element.attributes.get('aria-busy'),'false');assert.equal(f.element.dataset.state,'running');
});
test('an old trace reply cannot release candidate-load busy state or expose its diagnostics',async t=>{
  const f=setup(t),old=await paused(f);await card(f);const pendingTrace=f.session.perform('trace'),trace=old.requests.at(-1);
  const applying=f.session.start();await flush();const candidate=f.ports[1],load=candidate.requests[0];
  candidate.emit(load.id,'loaded',snapshot({firmwareHash:'b'.repeat(64)}));
  old.emit(trace.id,'trace',{trace:{scope:'old paused session'}});await pendingTrace;
  assert.equal(f.element.attributes.get('aria-busy'),'true');assert.equal(f.session.preparing,true);
  assert.equal(f.element.querySelector('[data-action="start"]').disabled,true);assert.equal(f.element.querySelector('[data-sd-file="1"]').disabled,true);
  assert.equal(f.element.querySelector('[data-diagnostic="hash"]').textContent,hash);assert.equal(old.terminations,0);
  await f.session.start();assert.equal(f.ports.length,2);assert.deepEqual(candidate.requests.map(request=>request.command),['load']);
  candidate.status(load,{firmwareHash:'b'.repeat(64)});await flush();candidate.status(candidate.requests[1],{state:'running',firmwareHash:'b'.repeat(64)});await applying;
  assert.equal(old.terminations,1);assert.equal(f.element.attributes.get('aria-busy'),'false');assert.equal(f.element.querySelector('[data-diagnostic="hash"]').textContent,'b'.repeat(64));
});

const updateUiHash='b'.repeat(64);
const updateUiBytes=()=>new Uint8Array(2048).fill(0x3d).buffer;
const updateUiManifest=()=>({usb_marker:'523E0001',usb_install:{bytes:2048,sha256:updateUiHash},privateNote:'omit-this-manifest-note'});
function updateUiTools(execute){
  return {
    parseVirtualUpdateManifest(raw){
      const marker=Number.parseInt(raw.usb_marker,16);
      return {profile:({'523D0001':'R13','523E0001':'R14','523F0001':'R15'})[raw.usb_marker.toUpperCase()],
        expectedMarker:marker,expectedSha256:raw.usb_install.sha256,length:raw.usb_install.bytes};
    },
    VirtualApp1Update:class{
      constructor(bridge){this.bridge=bridge;}
      update(bytes,manifest,options){return execute(this.bridge,bytes,manifest,options);}
    },
  };
}
function updateUiReceipt(manifest){
  const status=(marker,state)=>({signature:marker===0x523d0001?'SP13':'SP14',version:2,state,error:0,
    length:state?2048:0,received:state?2048:0,crc32:state?0x12345678:0,maximum:65536,capabilities:1,
    jedec:state?0xc22016:0,flash_status:state?0x40:0,flash_error:0,programmed:state===6?4096:0,
    flash_ready:state?1:0,flash_crc32:state===6?0x12345678:0,build_marker:marker});
  const before=status(0x523d0001,0),old=snapshot({state:'paused',instructions:10,marker:0x523d0001,firmwareState:2});
  return {scope:'virtual APP1 update',image:{sha256:manifest.expectedSha256,length:2048,paddedLength:4096,crc32:0x12345678,expectedMarker:manifest.expectedMarker},
    before,beforeSnapshot:old,preflight:{profile:{name:'R13',signature:'SP13',maximum:65536,markers:[0x523d0001]},status:before,diagnostics:{},geometry:{}},
    ramVerified:status(0x523d0001,2),flashVerified:status(0x523d0001,6),separateStatus:status(0x523d0001,6),beforeResetSnapshot:old,
    flashReadback:{verifiedBytes:4096,imageCrc32:0x12345678,tail:'FF',evidence:'Finite protocol fake only'},bootStatus:status(manifest.expectedMarker,0),
    snapshot:snapshot({state:'paused',instructions:100,marker:manifest.expectedMarker,firmwareState:2,firmwareHash:manifest.expectedSha256,heartbeat:1,cpuBackendFailed:false,mailboxCached:false}),
    phases:[{phase:'boot-verified',completedBytes:2048,totalBytes:2048}]};
}
async function stageUpdateUi(f){
  f.element.querySelector('[data-update-image]').files=[{name:'next-app1.bin',size:2048,arrayBuffer:async()=>updateUiBytes()}];
  await f.session.readUpdateFile('image');
  const raw=JSON.stringify(updateUiManifest());
  f.element.querySelector('[data-update-manifest]').files=[{name:'manifest.json',size:raw.length,text:async()=>raw}];
  await f.session.readUpdateFile('manifest');
}

test('virtual update stays disabled before load and bounds file reads before importing tools',async t=>{
  let imports=0,reads=0;
  const f=setup(t,undefined,pageClock(),async()=>{imports++;return updateUiTools(()=>assert.fail('Unexpected update'));});
  assert.equal(f.element.querySelector('[data-update-image]').disabled,true);
  assert.equal(f.element.querySelector('[data-update-form] button[type="submit"]').disabled,true);
  await f.session.readUpdateFile('manifest');await f.session.updateApp1();assert.equal(imports,0);assert.equal(f.ports.length,0);
  const port=await paused(f),requests=port.requests.length;
  for(const [kind,size] of [['image',0],['image',65540],['manifest',131073]]){
    f.element.querySelector(`[data-update-${kind}]`).files=[{name:'too-large',size,arrayBuffer:async()=>{reads++;return updateUiBytes();},text:async()=>{reads++;return '{}';}}];
    await f.session.readUpdateFile(kind);assert.equal(f.session.updateError.code,'file-size');
  }
  assert.equal(reads,0);assert.equal(imports,0);assert.equal(port.requests.length,requests);assert.equal(port.terminations,0);
  f.element.querySelector('[data-update-manifest]').files=[{name:'invalid.json',size:25,text:async()=>'{ private-manifest-value }'}];
  await f.session.readUpdateFile('manifest');assert.equal(f.session.updateError.message,'The package manifest must contain valid JSON.');assert.equal(imports,0);
});

test('virtual update file revisions keep the latest binary and manifest with copied bytes',async t=>{
  const f=setup(t,undefined,pageClock(),async()=>updateUiTools(()=>assert.fail('Unexpected update')));await paused(f);
  const staleImage=deferred(),fresh=updateUiBytes();
  f.element.querySelector('[data-update-image]').files=[{name:'old.bin',size:2048,arrayBuffer:()=>staleImage.promise}];
  const oldImage=f.session.readUpdateFile('image');
  f.element.querySelector('[data-update-image]').files=[{name:'fresh.bin',size:2048,arrayBuffer:async()=>fresh}];
  await f.session.readUpdateFile('image');new Uint8Array(fresh)[0]=0;staleImage.resolve(new Uint8Array(2048).fill(0x11).buffer);await oldImage;
  assert.equal(f.session.updateImage.name,'fresh.bin');assert.equal(f.session.updateImage.bytes[0],0x3d);
  const staleManifest=deferred();
  f.element.querySelector('[data-update-manifest]').files=[{name:'old.json',size:100,text:()=>staleManifest.promise}];
  const oldManifest=f.session.readUpdateFile('manifest'),raw=JSON.stringify(updateUiManifest());
  f.element.querySelector('[data-update-manifest]').files=[{name:'fresh.json',size:raw.length,text:async()=>raw}];
  await f.session.readUpdateFile('manifest');staleManifest.resolve('invalid stale JSON');await oldManifest;
  assert.equal(f.session.updateManifest.expectedSha256,updateUiHash);assert.equal(f.session.updateManifest.privateNote,undefined);
  assert.equal(f.session.updateReads.size,0);assert.equal(f.session.updateError,undefined);
  assert.equal(f.element.querySelector('[data-update-form] button[type="submit"]').disabled,false);
});

test('an active virtual update blocks controls and boot, format and card replacement',async t=>{
  const gate=deferred(),entered=deferred();let pin;
  const f=setup(t,undefined,pageClock(),async()=>updateUiTools((_bridge,_bytes,manifest)=>{pin=manifest;entered.resolve();return gate.promise;}));
  const port=await paused(f);await stageUpdateUi(f);const image=f.session.image,requests=port.requests.length,pending=f.session.updateApp1();await entered.promise;
  for(const selector of ['[data-file]','[data-format]','[data-sd-file="1"]','[data-sd-file="2"]','[data-usb-report]','[data-action="step"]','[data-action="reset"]','[data-action="start"]'])assert.equal(f.element.querySelector(selector).disabled,true);
  assert.equal(f.element.querySelector('[data-action="cancel-update"]').disabled,false);
  for(const command of ['step','run','reset','usb','input','trace'])await f.session.perform(command);
  await f.session.start();f.session.usb();await f.choose('blocked.bin');let cardReads=0;
  f.element.querySelector('[data-sd-file="1"]').files=[{name:'blocked.img',size:262144,arrayBuffer:async()=>{cardReads++;return cardBytes();}}];
  await f.session.readCard(0);
  const event=new Event('change');Object.defineProperty(event,'target',{value:{matches:selector=>selector==='[data-format]'}});f.element.dispatchEvent(event);
  assert.equal(f.session.image,image);assert.equal(f.session.name,'local.bin');assert.equal(cardReads,0);
  assert.equal(port.requests.length,requests);assert.equal(port.terminations,0);
  gate.resolve(updateUiReceipt(pin));await pending;
});

test('a full virtual receipt commits the source and exports metadata while generic Reset only recreates CPU',async t=>{
  let port;
  const data=[2,1,56,0,0,0,0,0,...Array(56).fill(213)];
  const f=setup(t,undefined,pageClock(),async()=>updateUiTools(async(bridge,_bytes,manifest,options)=>{
    options.onProgress({phase:'upload',completedBytes:56,totalBytes:2048});
    const exchange=bridge.transport(data,{signal:options.signal}),request=port.requests.at(-1);
    port.emit(request.id,'usb',{report:Array(64).fill(0)});port.status(request,{state:'paused',instructions:10});await exchange;
    return updateUiReceipt(manifest);
  }));
  f.element.querySelector('[data-format]').value='flash';
  port=await paused(f);await stageUpdateUi(f);const prior=f.session.image,verifiedWorker=f.session.bridge;
  assert.equal(port.requests[0].format,'flash');
  await f.session.updateApp1();assert.notEqual(f.session.image,prior);assert.equal(f.session.image.byteLength,2048);
  assert.equal(new Uint8Array(f.session.image)[0],0x3d);assert.equal(f.session.name,'next-app1.bin');assert.equal(f.session.sourceHash,updateUiHash);
  assert.equal(f.session.updateReceipt.bootStatus.build_marker,0x523e0001);assert.equal(f.session.snapshot.firmwareHash,updateUiHash);
  assert.equal(f.element.querySelector('[data-format]').value,'app1');assert.equal(f.session.bridge,verifiedWorker);assert.equal(port.terminations,0);
  assert.match(f.element.querySelector('[data-update-receipt]').textContent,/Separate completion status verified/);
  f.session.download({scope:'Finite page fake',usb:{reports:[data]},safeObservation:true});
  const exported=JSON.parse(f.exports[0]);assert.equal(exported.sourceFile.sha256,updateUiHash);assert.equal(exported.virtualUpdate.receipt.image.length,2048);
  assert.equal(exported.sourceFile.format,'app1');
  assert.equal(exported.trace.usb,'Virtual updater report payloads omitted.');assert.equal(exported.trace.safeObservation,true);
  const usb=exported.commands.retained.filter(row=>row.command==='usb');assert.equal(usb.length,1);assert.deepEqual(usb[0].details,{virtualUpdate:true});
  assert.equal(exported.usbExchanges.length,0);assert.equal(f.exports[0].includes('omit-this-manifest-note'),false);
  const image=f.session.image,requests=port.requests.length,reset=f.session.perform('reset'),request=port.requests.at(-1);
  assert.equal(request.command,'reset');assert.equal(request.target,undefined);
  port.status(request,{state:'loaded',instructions:0,firmwareHash:updateUiHash});await reset;
  assert.equal(port.requests.length,requests+1);assert.equal(f.session.image,image);assert.equal(f.session.sourceHash,updateUiHash);
  assert.equal(f.session.bridge,verifiedWorker);assert.equal(port.terminations,0);assert.equal(f.element.querySelector('[data-format]').value,'app1');
});

test('virtual cancellation rejects late callbacks and runtime failure closes the owned worker while admission stays editable',async t=>{
  const gate=deferred(),entered=deferred();let options,pin;
  const f=setup(t,undefined,pageClock(),async()=>updateUiTools((_bridge,_bytes,manifest,call)=>{options=call;pin=manifest;entered.resolve();return gate.promise;}));
  const port=await paused(f);await stageUpdateUi(f);const oldImage=f.session.image,oldSnapshot=JSON.stringify(f.session.snapshot),oldCommands=JSON.stringify(f.session.commands);
  const pending=f.session.updateApp1();await entered.promise;options.onProgress({phase:'commit',completedBytes:2048,totalBytes:2048});f.session.cancelUpdate();
  assert.equal(options.signal.aborted,true);assert.equal(port.terminations,1);assert.equal(f.element.dataset.state,'ready');assert.equal(f.session.image,oldImage);
  assert.match(f.element.querySelector('[data-firmware-name]').textContent,/selected for next Start/);
  assert.equal(JSON.stringify(f.session.snapshot),oldSnapshot);assert.equal(JSON.stringify(f.session.commands),oldCommands);
  assert.equal(f.session.failure.command,'update');const stopped=f.element.querySelector('[data-update-phase]').textContent;
  options.onProgress({phase:'boot-verified',completedBytes:2048,totalBytes:2048});gate.resolve(updateUiReceipt(pin));await pending;
  assert.equal(f.session.updateReceipt,undefined);assert.equal(f.session.image,oldImage);assert.equal(f.element.querySelector('[data-update-phase]').textContent,stopped);
  f.session.download({usb:{reports:[Array(64).fill(213)]}});
  const cancelledTrace=JSON.parse(f.exports[0]);assert.equal(cancelledTrace.trace.usb,'Virtual updater report payloads omitted.');assert.equal(cancelledTrace.virtualUpdate.failure.code,'cancelled');
  await f.session.updateApp1();assert.equal(port.terminations,1);
  for(const phase of ['image','preflight']){
    let calls=0;
    const g=setup(t,undefined,pageClock(),async()=>updateUiTools((_bridge,_bytes,manifest)=>{
      if(++calls===1)throw Object.assign(new Error('Finite rejection'),{phase,code:'fake-rejection'});return updateUiReceipt(manifest);
    }));
    const owned=await paused(g);await stageUpdateUi(g);const old=g.session.image;
    await g.session.updateApp1();assert.equal(g.session.image,old);assert.equal(g.session.updateError.phase,phase);
    assert.equal(owned.terminations,phase==='image'?0:1);assert.equal(g.session.loaded,phase==='image');
    await g.session.updateApp1();assert.equal(calls,phase==='image'?2:1);
  }
});

test('removal, pagehide and a bounded tools timeout retire late virtual updater imports',async t=>{
  for(const action of ['close','suspend']){
    const gate=deferred();let imports=0,constructors=0;
    const module=updateUiTools(()=>assert.fail('Retired updater cannot run'));
    const Constructor=module.VirtualApp1Update;module.VirtualApp1Update=class extends Constructor{constructor(bridge){super(bridge);constructors++;}};
    const f=setup(t,undefined,pageClock(),()=>++imports===1?Promise.resolve(module):gate.promise);
    const port=await paused(f);await stageUpdateUi(f);const pending=f.session.updateApp1(),job=f.session.updateJob;
    f.session[action]();assert.equal(job.controller.signal.aborted,true);assert.equal(port.terminations,1);
    gate.resolve(module);await pending;assert.equal(constructors,0);assert.equal(f.session.updateReceipt,undefined);assert.equal(f.session.updateJob,undefined);
    assert.equal(f.session.image===undefined,action==='close');
  }
  const gate=deferred(),clock=pageClock();let imports=0,constructors=0;
  const module=updateUiTools(()=>assert.fail('Timed-out updater cannot run'));
  const Constructor=module.VirtualApp1Update;module.VirtualApp1Update=class extends Constructor{constructor(bridge){super(bridge);constructors++;}};
  const f=setup(t,undefined,clock,()=>++imports===1?Promise.resolve(module):gate.promise),port=await paused(f);await stageUpdateUi(f);
  const pending=f.session.updateApp1();await flush();const timer=[...clock.timers.values()].find(row=>row.milliseconds===45000);assert.ok(timer);timer.callback();await pending;
  assert.equal(f.session.updateError.code,'tools-timeout');assert.equal(f.session.loaded,true);assert.equal(port.terminations,0);assert.equal(f.session.updateJob,undefined);
  gate.resolve(module);await flush();assert.equal(constructors,0);assert.equal(f.session.updateReceipt,undefined);
});
