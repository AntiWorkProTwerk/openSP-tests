import assert from 'node:assert/strict';
import test from 'node:test';
import {EmulatorWorkerBridge, EmulatorWorkerRpcError, createBrowserWorkerBridge} from '../src/lib/emulator/worker-rpc.ts';
import {VirtualFirmwareUpdater} from '../src/lib/emulator/update.ts';

// These EventTarget ports inject protocol responses only. No CPU or WASM runs.
const hash = 'a'.repeat(64);
const marker = 0x523d0001;
const diagnostics = overrides => ({state: 'paused', pc: 0x80000500, instructions: 100,
  firmwareHash: hash, marker, heartbeat: 1, firmwareState: 2,
  cpuBackendFailed: false, mailboxCached: false, unknownMmio: [], unknownMmioOverflow: 0,
  flash: {lastError: ''}, ...overrides});
const entry = overrides => diagnostics({state: 'loaded', instructions: 0, pc: 0x60080000,
  firmwareState: undefined, heartbeat: undefined, ...overrides});
const flush = () => new Promise(resolve => setImmediate(resolve));

class ProtocolWorker extends EventTarget {
  requests = [];
  terminations = 0;
  listeners = new Map();
  handler;
  postMessage(request, transfer) {
    this.requests.push({request, transfer});
    this.handler?.(request);
  }
  emit(reply) {this.dispatchEvent(new MessageEvent('message', {data: reply}));}
  status(request, overrides) {this.emit({id: request.id, type: 'status', ...diagnostics(overrides)});}
  terminate() {this.terminations++;}
  addEventListener(type, listener, options) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) + 1);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) - 1);
    super.removeEventListener(type, listener, options);
  }
}
const setup = options => {
  const worker = new ProtocolWorker();
  return {worker, bridge: new EmulatorWorkerBridge(worker, options)};
};
const rejectsCode = (action, code) => assert.rejects(action, error => {
  assert.ok(error instanceof EmulatorWorkerRpcError); assert.equal(error.code, code); return true;
});

test('load copies local bytes and awaits loaded plus the same-ID status', async () => {
  const {worker, bridge} = setup();
  const bytes = Uint8Array.of(1, 2, 3, 4);
  let resolved = false;
  const loading = bridge.load(bytes, {format: 'app1', name: 'local.bin'}).then(value => {resolved = true; return value;});
  const {request, transfer} = worker.requests[0];
  assert.equal(request.command, 'load'); assert.equal(request.format, 'app1');
  assert.equal(request.name, 'local.bin'); assert.deepEqual(new Uint8Array(request.image), bytes);
  assert.notEqual(request.image, bytes.buffer); assert.equal(transfer[0], request.image);
  new Uint8Array(request.image)[0] = 7; assert.equal(bytes[0], 1);
  worker.emit({id: request.id, type: 'loaded', ...entry()});
  await flush(); assert.equal(resolved, false);
  worker.status(request, entry());
  assert.equal((await loading).state, 'loaded'); assert.equal(bridge.latestDiagnostics.instructions, 0);
  bridge.close();
});

test('USB waits for its own report and status despite interleaved run publications', async () => {
  const {worker, bridge} = setup();
  const running = bridge.run(); worker.status(worker.requests[0].request, {state: 'running'}); await running;
  const report = Array(64).fill(0); report[0] = 5;
  let complete = false;
  const exchange = bridge.transport(report).then(value => {complete = true; return value;});
  const request = worker.requests[1].request;
  report[0] = 99; assert.equal(request.report[0], 5);
  worker.emit({id: 0, type: 'status', ...diagnostics({state: 'running', instructions: 101})});
  await flush(); assert.equal(complete, false); assert.equal(bridge.latestDiagnostics.instructions, 101);
  const response = Array.from({length: 64}, (_, index) => index);
  worker.emit({id: request.id, type: 'usb', report: response});
  await flush(); assert.equal(complete, false);
  worker.status(request, {instructions: 102});
  assert.deepEqual(await exchange, response);
  worker.emit({id: 0, type: 'status', ...diagnostics({state: 'running', instructions: 103})});
  assert.equal(bridge.latestDiagnostics.instructions, 103);
  bridge.close();
});

test('older correlated responses resolve their caller without overwriting newer diagnostics', async () => {
  const {worker, bridge} = setup();
  const older = bridge.snapshot(), newer = bridge.snapshot();
  const [first, second] = worker.requests.map(row => row.request);
  assert.notEqual(first.id, second.id);
  worker.status(second, {instructions: 200}); assert.equal((await newer).instructions, 200);
  worker.status(first, {instructions: 100}); assert.equal((await older).instructions, 100);
  assert.equal(bridge.latestDiagnostics.instructions, 200);
  const copy = bridge.latestDiagnostics; copy.unknownMmio.push({address: 123});
  assert.deepEqual(bridge.latestDiagnostics.unknownMmio, []);
  bridge.close();
});

test('retired duplicate, unknown and paused unsolicited replies cannot replace diagnostics', async () => {
  const {worker, bridge} = setup();
  const result = bridge.snapshot(); const request = worker.requests[0].request;
  worker.status(request, {instructions: 10}); await result;
  worker.status(request, {instructions: 999});
  worker.emit({id: 9999, type: 'status', ...diagnostics({instructions: 888})});
  worker.emit({id: 0, type: 'status', ...diagnostics({instructions: 777})});
  assert.equal(bridge.latestDiagnostics.instructions, 10); assert.equal(bridge.ignoredResponses, 3);
  assert.equal(bridge.closed, false); bridge.close();
});

test('a delayed run acknowledgment cannot reverse a newer pause intent', async () => {
  const {worker, bridge} = setup();
  const run = bridge.run(), pause = bridge.pause();
  const [running, paused] = worker.requests.map(row => row.request);
  worker.status(paused, {instructions: 200}); await pause;
  worker.status(running, {state: 'running', instructions: 100}); await run;
  worker.emit({id: 0, type: 'status', ...diagnostics({state: 'running', instructions: 300})});
  assert.equal(bridge.latestDiagnostics.state, 'paused'); assert.equal(bridge.latestDiagnostics.instructions, 200);
  bridge.close();
});

test('an already-aborted control request does not change an active run intent', async () => {
  const {worker, bridge} = setup();
  const running = bridge.run(); worker.status(worker.requests[0].request, {state: 'running'}); await running;
  const signal = new AbortController(); signal.abort();
  await rejectsCode(bridge.pause({signal: signal.signal}), 'cancelled');
  assert.equal(worker.requests.length, 1);
  worker.emit({id: 0, type: 'status', ...diagnostics({state: 'running', instructions: 101})});
  assert.equal(bridge.latestDiagnostics.instructions, 101); bridge.close();
});

test('duplicate USB primaries reject the unsettled call and close the ambiguous connection', async () => {
  const {worker, bridge} = setup();
  const result = bridge.transport(); const request = worker.requests[0].request;
  worker.emit({id: request.id, type: 'usb', report: Array(64).fill(0)});
  worker.emit({id: request.id, type: 'usb', report: Array(64).fill(1)});
  await rejectsCode(result, 'protocol-error'); assert.equal(worker.terminations, 1); assert.equal(bridge.closed, true);
});

for (const response of [
  {type: 'status', ...diagnostics()},
  {type: 'usb', report: Array(63).fill(0)},
  {type: 'usb', report: [...Array(63).fill(0), 256]},
]) test(`USB rejects invalid correlated ${response.type}/${response.report?.length ?? 'order'} replies`, async () => {
  const {worker, bridge} = setup();
  const result = bridge.transport(); worker.emit({id: worker.requests[0].request.id, ...response});
  await rejectsCode(result, 'protocol-error'); assert.equal(worker.terminations, 1);
});

test('matching remote errors reject only their request and leave diagnostics available', async () => {
  const {worker, bridge} = setup();
  const failed = bridge.input({control: 'unknown', value: 1});
  const good = bridge.snapshot();
  worker.emit({id: worker.requests[0].request.id, type: 'error', message: 'Injected unsupported control'});
  worker.status(worker.requests[1].request, {unknownMmioOverflow: 17});
  await rejectsCode(failed, 'remote-error'); assert.equal((await good).unknownMmioOverflow, 17);
  assert.equal(bridge.closed, false); assert.equal(worker.terminations, 0); bridge.close();
});

test('asynchronous run errors reject pending work and preserve the latest healthy observation', async () => {
  const {worker, bridge} = setup();
  const initial = bridge.snapshot(); worker.status(worker.requests[0].request, {instructions: 88}); await initial;
  const pending = bridge.trace();
  worker.emit({id: 0, type: 'error', message: 'Injected asynchronous worker error'});
  await rejectsCode(pending, 'remote-error'); assert.equal(bridge.latestDiagnostics.instructions, 88);
  assert.equal(worker.terminations, 1); assert.equal(bridge.closed, true);
});

for (const type of ['error', 'messageerror']) test(`native ${type} events close pending RPCs and detach listeners`, async () => {
  const {worker, bridge} = setup();
  const first = bridge.snapshot(), second = bridge.trace();
  const event = new Event(type, {cancelable: true});
  Object.defineProperty(event, 'message', {value: 'Injected event; no engine crash'});
  worker.dispatchEvent(event);
  const code = type === 'error' ? 'worker-error' : 'message-error';
  await rejectsCode(first, code); await rejectsCode(second, code);
  assert.equal(worker.terminations, 1);
  assert.deepEqual([...worker.listeners.values()], [0, 0, 0]);
  if (type === 'error') assert.equal(event.defaultPrevented, true);
});

test('timeout closes the owned worker and late replies cannot resurrect it', async () => {
  const {worker, bridge} = setup({requestTimeoutMs: 1});
  const pending = bridge.snapshot(); const id = worker.requests[0].request.id;
  await rejectsCode(pending, 'timeout');
  worker.emit({id, type: 'status', ...diagnostics()});
  assert.equal(bridge.latestDiagnostics, undefined); assert.equal(worker.terminations, 1);
  await rejectsCode(bridge.snapshot(), 'closed');
});

test('a primary load reply without its trailing status still times out', async () => {
  const {worker, bridge} = setup({loadTimeoutMs: 1});
  const loading = bridge.load(Uint8Array.of(1), {format: 'app1'});
  worker.emit({id: worker.requests[0].request.id, type: 'loaded', ...entry()});
  await rejectsCode(loading, 'timeout');
  assert.equal(bridge.latestDiagnostics.instructions, 0); assert.equal(worker.terminations, 1);
});

for (const [method, response] of [
  ['snapshot', {type: 'status', ...diagnostics({firmwareHash: 'missing'})}],
  ['trace', {type: 'trace'}],
]) test(`${method} rejects missing or malformed correlated evidence`, async () => {
  const {worker, bridge} = setup();
  const result = bridge[method](); worker.emit({id: worker.requests[0].request.id, ...response});
  await rejectsCode(result, 'protocol-error'); assert.equal(worker.terminations, 1);
});

test('already-aborted calls are not sent; in-flight abort rejects all work and terminates', async () => {
  const {worker, bridge} = setup();
  const before = new AbortController(); before.abort();
  await rejectsCode(bridge.snapshot({signal: before.signal}), 'cancelled');
  assert.equal(worker.requests.length, 0); assert.equal(bridge.closed, false);
  const active = new AbortController();
  const first = bridge.snapshot({signal: active.signal}), second = bridge.trace();
  active.abort();
  await rejectsCode(first, 'cancelled'); await rejectsCode(second, 'cancelled');
  assert.equal(worker.terminations, 1); assert.equal(bridge.closed, true);
});

test('close is idempotent, removes abort listeners and rejects all pending calls', async () => {
  const {worker, bridge} = setup();
  const signal = new AbortController();
  const first = bridge.snapshot({signal: signal.signal}), second = bridge.transport();
  bridge.close('Explicit owned-worker termination'); bridge.close(); signal.abort();
  await rejectsCode(first, 'closed'); await rejectsCode(second, 'closed');
  assert.equal(worker.terminations, 1); assert.deepEqual([...worker.listeners.values()], [0, 0, 0]);
  assert.equal(bridge.closedError.message, 'Explicit owned-worker termination');
});

test('send failures reject and terminate without retaining listeners', async () => {
  const {worker, bridge} = setup();
  worker.handler = () => {throw new Error('Injected postMessage rejection');};
  await rejectsCode(bridge.snapshot(), 'post-message'); assert.equal(worker.terminations, 1);
  assert.deepEqual([...worker.listeners.values()], [0, 0, 0]);
});

test('argument bounds reject before posting and do not close a healthy bridge', async () => {
  const {worker, bridge} = setup();
  for (const invalid of [[], Array(65).fill(0), [...Array(63).fill(0), -1]]) await rejectsCode(bridge.transport(invalid), 'invalid-argument');
  for (const invalid of [0, 1000001, 1.5]) await rejectsCode(bridge.step(invalid), 'invalid-argument');
  await rejectsCode(bridge.load(new Uint8Array(0), {format: 'app1'}), 'invalid-argument');
  await rejectsCode(bridge.snapshot({timeoutMs: 0}), 'invalid-argument');
  assert.equal(worker.requests.length, 0); assert.equal(bridge.closed, false); bridge.close();
  assert.throws(() => new EmulatorWorkerBridge(worker, {bootSliceInstructions: 1000001}), {code: 'invalid-argument'});
  assert.throws(() => createBrowserWorkerBridge(), {code: 'invalid-argument'});
});

test('step/input/run/pause/trace use distinct IDs and expected reply shapes', async () => {
  const {worker, bridge} = setup();
  worker.handler = request => request.command === 'trace'
    ? worker.emit({id: request.id, type: 'trace', trace: {scope: 'protocol fake'}})
    : worker.status(request, {state: request.command === 'run' ? 'running' : 'paused', instructions: 123});
  assert.equal((await bridge.step(17)).instructions, 123);
  await bridge.input({control: 'SHIFT', value: 1}); await bridge.run(); await bridge.pause();
  assert.deepEqual(await bridge.trace(), {scope: 'protocol fake'});
  assert.deepEqual(worker.requests.map(row => row.request.command), ['step', 'input', 'run', 'pause', 'trace']);
  assert.equal(worker.requests[0].request.instructions, 17);
  assert.deepEqual(worker.requests[1].request.input, {control: 'SHIFT', value: 1});
  assert.equal(new Set(worker.requests.map(row => row.request.id)).size, 5); bridge.close();
});

test('reset steps from a cleared mailbox and ignores header marker as readiness', async () => {
  const {worker, bridge} = setup({bootInstructions: 21, bootSliceInstructions: 7});
  let instructions = 0;
  const nor = {identity: 'retained fake NOR'};
  let volatileGeneration = 0;
  worker.handler = request => {
    if (request.command === 'reset') {volatileGeneration++; worker.status(request, entry());}
    else if (request.command === 'step') {
      instructions += request.instructions;
      worker.status(request, instructions < 14
        ? {instructions, marker, firmwareState: undefined, heartbeat: undefined}
        : {instructions, marker, firmwareState: 2, heartbeat: 0});
    } else assert.fail(`Unexpected command ${request.command}`);
  };
  await bridge.reset();
  assert.equal(volatileGeneration, 1); assert.equal(nor.identity, 'retained fake NOR');
  assert.deepEqual(worker.requests.map(row => row.request.command), ['reset', 'step', 'step']);
  assert.equal(bridge.latestDiagnostics.instructions, 14); assert.equal(bridge.latestDiagnostics.heartbeat, 0);
  bridge.close();
});

test('reset rejects stale mailbox fields even when reset instruction count is zero', async () => {
  const {worker, bridge} = setup();
  worker.handler = request => worker.status(request, entry({firmwareState: 2, heartbeat: 50}));
  await rejectsCode(bridge.reset(), 'reset-contract');
  assert.deepEqual(worker.requests.map(row => row.request.command), ['reset']); bridge.close();
});

for (const [overrides, code] of [
  [{cpuBackendFailed: true, mailboxCached: true}, 'engine-failed'],
  [{state: 'fault', fault: 'Injected guest stop'}, 'guest-stopped'],
  [{instructions: 0}, 'boot-no-progress'],
]) test(`bounded reset rejects injected ${code} without accepting a ready marker`, async () => {
  const {worker, bridge} = setup({bootInstructions: 3, bootSliceInstructions: 3});
  worker.handler = request => worker.status(request, request.command === 'reset' ? entry() : {instructions: 3, ...overrides});
  await rejectsCode(bridge.reset(), code); assert.equal(worker.requests.length, 2); bridge.close();
});

test('mailbox boot instruction budget is exact and does not fall back to an image header', async () => {
  const {worker, bridge} = setup({bootInstructions: 4, bootSliceInstructions: 3});
  let instructions = 0;
  worker.handler = request => {
    if (request.command === 'reset') worker.status(request, entry());
    else {instructions += request.instructions; worker.status(request, {instructions, firmwareState: undefined, heartbeat: undefined});}
  };
  await rejectsCode(bridge.reset(), 'boot-budget');
  assert.deepEqual(worker.requests.filter(row => row.request.command === 'step').map(row => row.request.instructions), [3, 1]);
  assert.equal(bridge.latestDiagnostics.marker, marker); assert.equal(bridge.latestDiagnostics.firmwareState, undefined);
  bridge.close();
});

for (const [name, overrides] of [
  ['missing heartbeat', {heartbeat: undefined}], ['missing backend health', {cpuBackendFailed: undefined}],
  ['missing cache health', {mailboxCached: undefined}], ['unexpected running state', {state: 'running'}],
]) test(`mailbox readiness rejects ${name}`, async () => {
  const {worker, bridge} = setup({bootInstructions: 1, bootSliceInstructions: 1});
  worker.handler = request => worker.status(request, request.command === 'reset' ? entry() : {instructions: 1, ...overrides});
  await rejectsCode(bridge.reset(), 'boot-budget');
  assert.equal(worker.requests.length, 2); assert.equal(bridge.closed, false); bridge.close();
});

test('whole reset boot deadline bounds a missing step reply and cleans pending requests', async () => {
  const {worker, bridge} = setup({bootTimeoutMs: 1, requestTimeoutMs: 5000});
  worker.handler = request => {if (request.command === 'reset') worker.status(request, entry());};
  await rejectsCode(bridge.reset(), 'boot-timeout');
  assert.equal(worker.requests.at(-1).request.command, 'step'); assert.equal(worker.terminations, 1);
  assert.equal(bridge.latestDiagnostics.instructions, 0);
});

test('reset has exclusive access; cancellation leaves no parallel request queued', async () => {
  const {worker, bridge} = setup();
  const controller = new AbortController(); const resetting = bridge.reset({signal: controller.signal});
  await rejectsCode(bridge.step(1), 'reset-busy'); await rejectsCode(bridge.transport(), 'reset-busy');
  await rejectsCode(bridge.snapshot(), 'reset-busy'); await rejectsCode(bridge.reset(), 'reset-busy');
  assert.equal(worker.requests.length, 1);
  controller.abort(); await rejectsCode(resetting, 'cancelled'); assert.equal(worker.terminations, 1);
});

test('bound update adapter runs VirtualFirmwareUpdater inspect over virtual feature payloads', async () => {
  const {worker, bridge} = setup();
  const status = Array(64).fill(0);
  status.splice(0, 4, ...Buffer.from('SP13'));
  const bytes = Uint8Array.from(status), view = new DataView(bytes.buffer);
  // version, state, error, length, received, CRC, capacity, capability, JEDEC,
  // flash status/error, programmed, ready, flash CRC and executed marker.
  [2, 0, 0, 0, 0, 0, 65536, 1, 0, 0, 0, 0, 0, 0, marker]
    .forEach((value, index) => view.setUint32(4 + index * 4, value, true));
  worker.handler = request => {
    assert.equal(request.command, 'usb'); assert.equal(request.report, undefined);
    worker.emit({id: request.id, type: 'usb', report: Array.from(bytes)}); worker.status(request);
  };
  const updater = new VirtualFirmwareUpdater(bridge.asUpdateBridge());
  const result = await updater.inspect();
  assert.equal(result.profile.name, 'R13'); assert.equal(result.status.build_marker, marker);
  assert.equal(bridge.latestDiagnostics.firmwareState, 2); bridge.close();
});

test('a bound adapter signal cancels an outstanding update-host transport and closes its worker', async () => {
  const {worker, bridge} = setup();
  const cancellation = new AbortController();
  const updater = new VirtualFirmwareUpdater(bridge.asUpdateBridge({signal: cancellation.signal}));
  const inspecting = updater.inspect();
  await flush(); assert.equal(worker.requests[0].request.command, 'usb');
  cancellation.abort();
  await assert.rejects(inspecting, {code: 'transport-failure'});
  assert.equal(bridge.closedError.code, 'cancelled'); assert.equal(worker.terminations, 1);
  worker.emit({id: worker.requests[0].request.id, type: 'usb', report: Array(64).fill(0)});
  assert.equal(bridge.latestDiagnostics, undefined);
});

test('browser factory starts on demand and cleans up a worker when setup validation fails', () => {
  const original = globalThis.Worker;
  const created = [];
  class FactoryWorker extends ProtocolWorker {
    constructor(url, options) {super(); this.url = url; this.options = options; created.push(this);}
  }
  globalThis.Worker = FactoryWorker;
  try {
    assert.equal(created.length, 0);
    const bridge = createBrowserWorkerBridge();
    assert.equal(created.length, 1); assert.match(created[0].url.pathname, /\/src\/scripts\/emulator-worker\.ts$/);
    assert.deepEqual(created[0].options, {type: 'module'}); assert.equal(created[0].requests.length, 0);
    bridge.close(); assert.equal(created[0].terminations, 1);
    assert.throws(() => createBrowserWorkerBridge({requestTimeoutMs: 0}), {code: 'invalid-argument'});
    assert.equal(created[1].terminations, 1);
  } finally {if (original === undefined) delete globalThis.Worker; else globalThis.Worker = original;}
});

test('generic restart accepts stock diagnostics and sends no mailbox boot steps', async () => {
  const {worker, bridge} = setup();
  worker.handler = request => worker.status(request, entry({marker: undefined, cpuBackendFailed: undefined, mailboxCached: undefined}));
  const snapshot = await bridge.restart();
  assert.equal(snapshot.state, 'loaded'); assert.equal(snapshot.instructions, 0);
  assert.equal(snapshot.marker, undefined);
  assert.deepEqual(worker.requests.map(row => row.request.command), ['reset']);
  bridge.close();
});

test('explicit APP1 reset contracts are copied and forwarded through the bound update bridge', async () => {
  const {worker, bridge} = setup({bootInstructions: 1, bootSliceInstructions: 1});
  const contract = {length: 1234, sha256: 'b'.repeat(64), expectedCurrentSha256: hash};
  const resetting = bridge.asUpdateBridge().reset(contract);
  const request = worker.requests[0].request;
  assert.deepEqual(request.target, contract); assert.notEqual(request.target, contract);
  contract.length = 999; assert.equal(request.target.length, 1234);
  worker.status(request, entry()); await flush();
  worker.status(worker.requests[1].request, {instructions: 1}); await resetting;
  assert.deepEqual(worker.requests.map(row => row.request.command), ['reset', 'step']); bridge.close();
});

test('explicit reset targets reject unsupported fields and retain bound cancellation options', async () => {
  const {worker, bridge} = setup();
  const base = {length: 4, sha256: hash, expectedCurrentSha256: hash};
  for (const target of [{}, {...base, length: 3}, {...base, length: 0x37f001}, {...base, sha256: 'bad'},
    {...base, expectedCurrentSha256: 'bad'}, {...base, selector: 'unknown'}, {...base, extra: true}]) {
    await rejectsCode(bridge.asUpdateBridge().reset(target), 'invalid-argument');
  }
  assert.equal(worker.requests.length, 0);
  const cancellation = new AbortController();
  const pending = bridge.asUpdateBridge({signal: cancellation.signal}).reset(base);
  cancellation.abort(); await rejectsCode(pending, 'cancelled'); assert.equal(worker.terminations, 1);
});

test('legacy reset call options and no-target bound reset preserve the mailbox boot contract', async () => {
  for (const bound of [false, true]) {
    const {worker, bridge} = setup({bootInstructions: 1, bootSliceInstructions: 1});
    worker.handler = request => worker.status(request, request.command === 'reset' ? entry() : {instructions: 1});
    if (bound) await bridge.asUpdateBridge({timeoutMs: 1000}).reset(); else await bridge.reset({timeoutMs: 1000});
    assert.equal(worker.requests[0].request.target, undefined);
    assert.deepEqual(worker.requests.map(row => row.request.command), ['reset', 'step']); bridge.close();
  }
});

test('generic restart requires a zero-instruction loaded acknowledgment and excludes new calls', async () => {
  const {worker, bridge} = setup();
  const restarting = bridge.restart();
  await rejectsCode(bridge.run(), 'reset-busy'); await rejectsCode(bridge.restart(), 'reset-busy');
  worker.status(worker.requests[0].request, {state: 'paused', instructions: 1});
  await rejectsCode(restarting, 'reset-contract');
  const pending = bridge.snapshot(), queuedReset = bridge.restart();
  worker.status(worker.requests[1].request); await pending;
  worker.status(worker.requests[2].request, entry()); await queuedReset;
  assert.equal(bridge.closed, false); bridge.close();
});

test('generic restart queues behind earlier page input and trace calls without requiring a mailbox', async () => {
  const {worker, bridge} = setup();
  const input = bridge.input({control: 'PAD 1', value: 0}), trace = bridge.trace(), reset = bridge.restart();
  const [first, second, third] = worker.requests.map(row => row.request);
  worker.status(first, {instructions: 10}); worker.emit({id: second.id, type: 'trace', trace: {scope: 'before reset'}});
  worker.status(third, entry({marker: undefined}));
  await input; await trace; assert.equal((await reset).instructions, 0);
  assert.deepEqual(worker.requests.map(row => row.request.command), ['input', 'trace', 'reset']);
  assert.equal(bridge.latestDiagnostics.marker, undefined); bridge.close();
});

test('observers are isolated copies and throws cannot corrupt load or USB settlement', async () => {
  const {worker, bridge} = setup();
  const observed = [];
  bridge.subscribe(event => {
    if (event.type === 'snapshot') event.snapshot.unknownMmio.push({address: 99});
    if (event.type === 'request') event.details.format = 'changed';
    throw new Error('Injected observer failure');
  });
  bridge.subscribe(event => observed.push(event));
  const load = bridge.load(Uint8Array.of(1), {format: 'flash'});
  const loading = worker.requests[0].request;
  worker.emit({id: loading.id, type: 'loaded', ...entry()});
  await flush(); assert.equal(bridge.closed, false);
  worker.status(loading, entry()); await load;
  const usb = bridge.transport(); const request = worker.requests[1].request;
  worker.emit({id: request.id, type: 'usb', report: Array(64).fill(0)});
  worker.status(request); await usb; await flush();
  assert.equal(worker.requests[0].request.format, 'flash');
  assert.equal(observed[0].details.format, 'flash');
  assert.equal(Object.hasOwn(observed[0].details, 'image'), false);
  assert.ok(observed.filter(event => event.type === 'snapshot').every(event => event.snapshot.unknownMmio.length === 0));
  assert.deepEqual(bridge.latestDiagnostics.unknownMmio, []);
  assert.equal(bridge.closed, false); bridge.close();
});

test('snapshot observers see only accepted IDs and unsubscribe suppresses queued deliveries', async () => {
  const {worker, bridge} = setup();
  const events = [];
  const unsubscribe = bridge.subscribe(event => events.push(event));
  const older = bridge.snapshot(), newer = bridge.snapshot();
  const [first, second] = worker.requests.map(row => row.request);
  worker.status(second, {instructions: 200}); await newer;
  worker.status(first, {instructions: 100}); await older;
  worker.status(second, {instructions: 999});
  worker.emit({id: 9999, type: 'status', ...diagnostics()});
  worker.emit({id: 0, type: 'status', ...diagnostics()});
  await flush();
  assert.deepEqual(events.filter(event => event.type === 'snapshot').map(event => event.snapshot.instructions), [200]);
  const pending = bridge.snapshot(); worker.status(worker.requests.at(-1).request); unsubscribe(); unsubscribe();
  await pending; await flush(); assert.equal(events.length, 3);
  bridge.close(); await flush(); assert.equal(events.length, 3);
});

test('terminal observers receive copied errors once and cannot interfere with shutdown', async () => {
  const {worker, bridge} = setup();
  const errors = [];
  bridge.subscribe(event => {if (event.type === 'terminal') {event.error.message = 'changed'; throw new Error('observer');}});
  bridge.subscribe(event => {if (event.type === 'terminal') errors.push(event.error);});
  const pending = bridge.snapshot(); bridge.close('Owned close'); bridge.close('Repeated close');
  await rejectsCode(pending, 'closed'); await flush();
  assert.equal(errors.length, 1); assert.equal(errors[0].message, 'Owned close');
  assert.equal(bridge.closedError.message, 'Owned close'); assert.equal(worker.terminations, 1);
});

for (const malformed of [{display: [0]}, {displayOn: 'yes'}, {limitations: [1]}, {unknownMmio: [{}]}]) {
  test(`malformed observational ${Object.keys(malformed)[0]} fields reject before publication`, async () => {
    const {worker, bridge} = setup(); const observations = [];
    bridge.subscribe(event => observations.push(event));
    const pending = bridge.snapshot(); worker.status(worker.requests[0].request, malformed);
    await rejectsCode(pending, 'protocol-error'); await flush();
    assert.equal(observations.some(event => event.type === 'snapshot'), false);
    assert.equal(worker.terminations, 1);
  });
}
