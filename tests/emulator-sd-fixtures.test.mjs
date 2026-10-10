import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {ownSdFixtures, describeSdFixture, safeSdStatus} from '../src/lib/emulator/sd-fixtures.ts';
import {VIRTUAL_SD_GEOMETRY as G} from '../src/lib/emulator/usdhc.ts';
import {EmulatorWorkerBridge} from '../src/lib/emulator/worker-rpc.ts';
import {validateApp1ResetContract} from '../src/lib/emulator/image.ts';
import {WorkerRunScheduler} from '../src/lib/emulator/run-scheduler.ts';
import {STOCK_AUDIO_PRESET} from '../src/lib/emulator/audio-preset.ts';

const workerModuleUrl = 'https://emulator.test/assets/emulator-worker.js';

const bytes = (seed = 0) => Uint8Array.from({length: G.minimumImageBytes}, (_, i) => (seed + i * 13) & 255);
const status = cards => ({state: 'loaded', pc: 0x60080000, instructions: 0, firmwareHash: 'a'.repeat(64),
  cpuBackendFailed: false, mailboxCached: false, unknownMmio: [], unknownMmioOverflow: 0,
  sd1: describeSdFixture(cards.sd1), sd2: describeSdFixture(cards.sd2)});
const flush = () => new Promise(resolve => setImmediate(resolve));
const hasBuffer = value => value instanceof ArrayBuffer || ArrayBuffer.isView(value) ||
  value && typeof value === 'object' && Object.values(value).some(hasBuffer);

// The inspected production message handler uses real fixture validation and fake
// session/image boundaries. Its fake step throws; no guest instruction can run.
function protocolFixture() {
  let script = stripTypeScriptTypes(readFileSync(new URL('../src/scripts/emulator-worker.ts', import.meta.url), 'utf8'));
  for (const [original, substitute] of [
    ["import {WorkerRunScheduler} from '../lib/emulator/run-scheduler.ts';", ''],
    ['import.meta.url', 'workerModuleUrl'],
    ["await import('../lib/emulator/sd-fixtures')", 'await modules.sd()'],
    ["await import('../lib/emulator/audio-preset')", 'await modules.audioPreset()'],
    ["await import('../lib/emulator/session')", 'await modules.session()'],
    ["await import('../lib/emulator/image')", 'await modules.image()'],
  ]) {assert.equal(script.split(original).length, 2); script = script.replace(original, substitute);}
  let listener;
  const sessions = [], replies = [], requests = [];
  class Port extends EventTarget {
    terminations = 0;
    postMessage(request, transfer = []) {
      requests.push({id: request.id, command: request.command, transfers: transfer.length});
      listener({data: structuredClone(request, {transfer})});
    }
    terminate() {this.terminations++;}
  }
  const port = new Port();
  const scope = {addEventListener(type, callback) {assert.equal(type, 'message'); listener = callback;},
    postMessage(reply) {replies.push(structuredClone(reply)); port.dispatchEvent(new MessageEvent('message', {data: structuredClone(reply)}));}};
  new vm.Script(script).runInNewContext({self: scope, ArrayBuffer, Uint8Array, performance, setTimeout, clearTimeout, WorkerRunScheduler, URL, workerModuleUrl,
    modules: {async sd() {return {ownSdFixtures};}, async audioPreset() {return {STOCK_AUDIO_PRESET};}, async image() {return {validateApp1ResetContract};},
      async session() {return {async createSession(image, options) {
        const cards = {sd1: options.sd1, sd2: options.sd2};
        const session = {cards, options, image, pauses: 0, closed: 0, resets: 0, state: 'loaded',
          pause() {this.pauses++;}, close() {this.closed++;}, step() {throw new Error('Fake session must never execute guest code');},
          async reset() {this.resets++;}, snapshot() {return status(cards);}, trace() {return {scope: 'fake session metadata', ...status(cards)};}};
        sessions.push(session); return session;
      }};}}});
  const dispatch = async request => {
    const start = replies.length; port.postMessage(request);
    for (let turn = 0; turn < 30 && !replies.slice(start).some(reply => reply.id === request.id); turn++) await flush();
    const own = replies.slice(start).filter(reply => reply.id === request.id);
    assert.ok(own.length, 'Finite protocol command must receive a reply'); return own;
  };
  return {port, sessions, replies, requests, dispatch};
}
const load = (id, cards = {}) => ({id, command: 'load', image: new ArrayBuffer(4), format: 'app1', ...cards});

test('fixture admission copies only an exact view and isolates both slots', () => {
  const backing = new Uint8Array(G.minimumImageBytes + 32);
  const view = backing.subarray(16, -16); view.set(bytes(7));
  const original = view.slice(), cards = ownSdFixtures({sd1: view, sd2: view});
  assert.deepEqual(cards.sd1, original); assert.deepEqual(cards.sd2, original);
  assert.notEqual(cards.sd1.buffer, backing.buffer); assert.notEqual(cards.sd1.buffer, cards.sd2.buffer);
  view.fill(0); cards.sd1.fill(1); assert.deepEqual(cards.sd2, original);
});

test('ArrayBuffer fixture admission owns bytes and exposes safe geometry metadata', () => {
  const input = bytes(77), cards = ownSdFixtures({sd2: input.buffer}); input.fill(0);
  assert.equal(cards.sd2[0], 77); assert.equal(cards.sd1, undefined);
  const metadata = describeSdFixture(cards.sd2);
  assert.deepEqual(metadata, {profile: G.profile, imageBytes: G.minimumImageBytes, readOnly: true});
  assert.equal(hasBuffer(metadata), false); assert.equal(describeSdFixture(undefined), undefined);
  assert.deepEqual(ownSdFixtures({}), {});
});

test('typed-array subclass copy hooks cannot substitute a caller backing buffer', () => {
  class HostileView extends Uint8Array {slice() {throw new Error('Caller copy hook must not run');}}
  const input = new HostileView(G.minimumImageBytes); input[0] = 89;
  const owned = ownSdFixtures({sd1: input}).sd1; input[0] = 0;
  assert.equal(owned[0], 89); assert.equal(owned.constructor, Uint8Array);
});

test('SD diagnostics keep only admitted metadata, including nested diagnostics', () => {
  const metadata = describeSdFixture(bytes());
  const raw = {...metadata, image: bytes(71), backup: bytes(99).buffer,
    unsupported: [{reason: 'fixture refusal', count: 1, image: bytes(7)}]};
  assert.deepEqual(safeSdStatus(raw), {...metadata, unsupported: [{reason: 'fixture refusal', count: 1}]});
  assert.equal(hasBuffer(safeSdStatus(raw)), false);
  for (const malformed of [null, bytes(), {...metadata, imageBytes: 512}, {...metadata, readOnly: false},
    {...metadata, pendingCommand: 64}, {...metadata, unsupported: [{reason: 'fixture', count: bytes()}]}]) {
    assert.throws(() => safeSdStatus(malformed), /Invalid SD metadata/);
  }
});

test('bad fixture types, detached buffers and shared-backed views reject without content disclosure', () => {
  const detached = new ArrayBuffer(G.minimumImageBytes); structuredClone(detached, {transfer: [detached]});
  for (const input of [null, [], {image: bytes()}, new Uint16Array(G.minimumImageBytes / 2),
    new SharedArrayBuffer(G.minimumImageBytes), new Uint8Array(new SharedArrayBuffer(G.minimumImageBytes)), detached]) {
    assert.throws(() => ownSdFixtures({sd1: input}), /sd1 requires/);
  }
});

test('fixture capacity rejects underflow, overflow and partial geometry without padding', () => {
  for (const size of [0, 512, G.minimumImageBytes - 1, G.minimumImageBytes + 1, G.maximumImageBytes + G.capacityUnitBytes]) {
    assert.throws(() => ownSdFixtures({sd2: new Uint8Array(size)}), /exact 256 KiB capacity units/);
  }
  const maximum = new Uint8Array(G.maximumImageBytes);
  assert.deepEqual(describeSdFixture(maximum), {profile: G.profile, imageBytes: G.maximumImageBytes, readOnly: true});
});

test('RPC load transfers copied cards while subscribers receive no backing bytes', async () => {
  const fake = protocolFixture(), bridge = new EmulatorWorkerBridge(fake.port), observations = [];
  bridge.subscribe(event => observations.push(event));
  const card = bytes(55), original = card.slice();
  await bridge.load(Uint8Array.of(1, 2, 3, 4), {format: 'app1', sd1: card, sd2: card.buffer});
  card.fill(0); await flush();
  assert.deepEqual(fake.sessions[0].cards.sd1, original); assert.deepEqual(fake.sessions[0].cards.sd2, original);
  assert.notEqual(fake.sessions[0].cards.sd1.buffer, fake.sessions[0].cards.sd2.buffer);
  assert.equal(fake.requests[0].transfers, 3); assert.equal(card.byteLength, G.minimumImageBytes);
  const request = observations.find(event => event.type === 'request');
  assert.deepEqual(request.details.sd1, {profile: G.profile, imageBytes: G.minimumImageBytes, readOnly: true});
  assert.equal(Object.hasOwn(request.details, 'image'), false); assert.equal(hasBuffer(observations), false);
  assert.equal(hasBuffer(bridge.latestDiagnostics), false); assert.equal(hasBuffer(await bridge.trace()), false);
  await bridge.restart(); assert.equal(fake.sessions[0].resets, 1);
  assert.deepEqual(fake.sessions[0].cards.sd1, original); bridge.close();
});

test('invalid RPC card replacement sends nothing and preserves earlier session state', async () => {
  const fake = protocolFixture(), bridge = new EmulatorWorkerBridge(fake.port), observations = [];
  bridge.subscribe(event => observations.push(event));
  await bridge.load(Uint8Array.of(1, 2, 3, 4), {format: 'app1', sd1: bytes(9)}); await flush();
  const requests = fake.requests.length, events = observations.length, snapshot = bridge.latestDiagnostics;
  for (const invalid of [new Uint8Array(512), null, {image: bytes()}, new Uint8Array(new SharedArrayBuffer(G.minimumImageBytes))]) {
    await assert.rejects(bridge.load(Uint8Array.of(1), {format: 'app1', sd2: invalid}), {code: 'invalid-argument'});
  }
  await flush(); assert.equal(fake.requests.length, requests); assert.equal(observations.length, events);
  assert.deepEqual(bridge.latestDiagnostics, snapshot); assert.equal(fake.sessions[0].closed, 0); assert.equal(bridge.closed, false);
  bridge.close();
});

test('pre-cancelled card load does not detach the caller or reach the Worker', async () => {
  const fake = protocolFixture(), bridge = new EmulatorWorkerBridge(fake.port), cancellation = new AbortController();
  const card = bytes(99); cancellation.abort();
  await assert.rejects(bridge.load(Uint8Array.of(1), {format: 'app1', sd1: card, signal: cancellation.signal}), {code: 'cancelled'});
  assert.equal(card[0], 99); assert.equal(card.byteLength, G.minimumImageBytes); assert.equal(fake.requests.length, 0); bridge.close();
});

test('two RPC Workers and both slots retain separate local ownership', async () => {
  const first = protocolFixture(), second = protocolFixture();
  const bridge1 = new EmulatorWorkerBridge(first.port), bridge2 = new EmulatorWorkerBridge(second.port);
  const card = bytes(33);
  await Promise.all([bridge1.load(Uint8Array.of(1), {format: 'app1', sd1: card, sd2: bytes(88)}),
    bridge2.load(Uint8Array.of(1), {format: 'app1', sd1: card})]);
  first.sessions[0].cards.sd1.fill(0);
  assert.equal(first.sessions[0].cards.sd2[0], 88); assert.equal(second.sessions[0].cards.sd1[0], 33);
  card.fill(1); assert.equal(second.sessions[0].cards.sd1[0], 33); bridge1.close(); bridge2.close();
});

test('production Worker validates both cards before pause, module creation or old-session replacement', async () => {
  const fake = protocolFixture(); await fake.dispatch(load(1, {sd1: bytes(22).buffer}));
  const prior = fake.sessions[0], pauses = prior.pauses;
  for (const card of [new ArrayBuffer(512), null, {image: bytes()}, new Uint8Array(new SharedArrayBuffer(G.minimumImageBytes))]) {
    const result = await fake.dispatch(load(2, {sd2: card}));
    assert.equal(result[0].type, 'error'); assert.match(result[0].message, /sd2 requires/);
    assert.equal(fake.sessions.length, 1); assert.equal(prior.closed, 0); assert.equal(prior.pauses, pauses);
  }
  const result = await fake.dispatch({id: 3, command: 'status'});
  assert.equal(result[0].sd1.imageBytes, G.minimumImageBytes); assert.equal(hasBuffer(result), false);
});

test('production Worker replacement admits owned slots and retains them on reset', async () => {
  const fake = protocolFixture(); await fake.dispatch(load(1));
  const card = bytes(101), original = card.slice();
  const replies = await fake.dispatch(load(2, {sd1: card.buffer, sd2: bytes(202)})); card.fill(0);
  assert.deepEqual(replies.map(reply => reply.type), ['loaded', 'status']);
  assert.equal(fake.sessions[0].closed, 1); assert.deepEqual(fake.sessions[1].cards.sd1, original);
  assert.equal(fake.sessions[1].cards.sd2[0], 202); assert.equal(hasBuffer(replies), false);
  await fake.dispatch({id: 3, command: 'reset'}); assert.deepEqual(fake.sessions[1].cards.sd1, original);
  assert.equal(fake.sessions[1].resets, 1);
});

test('subscriber mutation cannot change transferred cards or another subscriber metadata', async () => {
  const fake = protocolFixture(), bridge = new EmulatorWorkerBridge(fake.port), events = [];
  bridge.subscribe(event => {if (event.type === 'request') {event.details.sd1.imageBytes = 1; event.details.sd1.readOnly = false;}});
  bridge.subscribe(event => events.push(event));
  await bridge.load(Uint8Array.of(1), {format: 'app1', sd1: bytes(123)}); await flush();
  assert.equal(events[0].details.sd1.imageBytes, G.minimumImageBytes); assert.equal(events[0].details.sd1.readOnly, true);
  assert.equal(fake.sessions[0].cards.sd1[0], 123); assert.equal(hasBuffer(events), false); bridge.close();
});

test('reply snapshots and traces discard unexpected raw SD content before subscribers or callers see it', async () => {
  const fake = protocolFixture(), bridge = new EmulatorWorkerBridge(fake.port), observations = [];
  bridge.subscribe(event => observations.push(event));
  await bridge.load(Uint8Array.of(1), {format: 'app1', sd1: bytes()});
  const current = fake.sessions[0], metadata = describeSdFixture(current.cards.sd1);
  current.snapshot = () => ({...status(current.cards), sd1: {...metadata, image: current.cards.sd1}});
  current.trace = () => ({scope: 'injected unexpected SD content', sd1: {...metadata, image: current.cards.sd1.buffer}});
  assert.equal(hasBuffer(await bridge.snapshot()), false); assert.equal(hasBuffer(await bridge.trace()), false);
  await flush(); assert.equal(hasBuffer(observations), false); assert.equal(hasBuffer(bridge.latestDiagnostics), false); bridge.close();
});

test('invalid SD reply diagnostics terminate with safe cached evidence', async () => {
  const fake = protocolFixture(), bridge = new EmulatorWorkerBridge(fake.port), observations = [];
  bridge.subscribe(event => observations.push(event));
  await bridge.load(Uint8Array.of(1), {format: 'app1', sd1: bytes()});
  fake.sessions[0].snapshot = () => ({...status({}), sd1: {imageBytes: bytes(), image: bytes()}});
  await assert.rejects(bridge.snapshot(), error => {assert.equal(error.code, 'protocol-error'); assert.equal(hasBuffer(error.evidence), false); return true;});
  await flush(); assert.equal(hasBuffer(observations), false); assert.equal(bridge.closed, true); assert.equal(fake.port.terminations, 1);
});
