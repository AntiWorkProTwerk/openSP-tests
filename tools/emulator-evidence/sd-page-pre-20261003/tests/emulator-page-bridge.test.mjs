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
  querySelector(selector) {if (!this.nodes.has(selector)) this.nodes.set(selector, new Node()); return this.nodes.get(selector);}
  querySelectorAll() {return [];}
  replaceChildren(...children) {this.children = children; this.textContent = children.map(child => child.textContent).join('');}
  getContext() {return null;}
}
class Port extends EventTarget {
  requests = []; terminations = 0;
  postMessage(request) {this.requests.push(request);}
  terminate() {this.terminations++;}
  emit(id, type, fields = {}) {this.dispatchEvent(new MessageEvent('message', {data: {id, type, ...fields}}));}
  status(request, overrides) {this.emit(request.id, 'status', snapshot(overrides));}
}
function setup(t, loader, clock) {
  const ports = [], element = new Node(), document = new EventTarget();
  document.hidden = false; document.querySelector = () => null; document.createElement = () => new Node();
  element.querySelector('[data-format]').value = 'app1';
  const factory = () => {const port = new Port(); ports.push(port); return new EmulatorWorkerBridge(port);};
  const context = vm.createContext({copy, document, window: new EventTarget(), AbortController,
    setTimeout: clock?.setTimeout ?? setTimeout, clearTimeout: clock?.clearTimeout ?? clearTimeout,
    console, loadBridge: loader ?? (async () => ({createBrowserWorkerBridge: factory}))});
  const adapted = source.replace("import copy from '../content/emulator.json';", '')
    .replace("import('../lib/emulator/worker-rpc')", 'loadBridge()');
  vm.runInContext(`${stripTypeScriptTypes(adapted, {mode: 'transform'})}\nglobalThis.PageSession = BrowserSession;`, context);
  const session = new context.PageSession(element, () => {});
  t.after(() => session.close());
  const choose = async (name = 'local.bin', read = async () => Uint8Array.of(1, 2).buffer) => {
    element.querySelector('[data-file]').files = [{name, size: 2, arrayBuffer: read}];
    await session.readFile();
  };
  return {session, element, ports, choose, factory};
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
