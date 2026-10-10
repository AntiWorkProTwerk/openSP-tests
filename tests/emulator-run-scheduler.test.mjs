import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {WorkerRunScheduler, workerRunLimits} from '../src/lib/emulator/run-scheduler.ts';
import {STOCK_AUDIO_PRESET} from '../src/lib/emulator/audio-preset.ts';

const hash = 'a'.repeat(64), metadata = {kind: 'wfi', address: 0x1000, resumePc: 0x1002};
class FakeTimers {
  jobs = []; time = 0; onNow;
  set = (callback, delay) => {const job = {callback, delay, canceled: false, delivered: false}; this.jobs.push(job); return job;};
  clear = job => {if (job) job.canceled = true;};
  now = () => {const callback = this.onNow; this.onNow = undefined; callback?.(); return this.time;};
  active() {return this.jobs.filter(job => !job.canceled && !job.delivered);}
  fire() {const job = this.active()[0]; assert(job, 'A finite owned timer exists.'); job.delivered = true; this.time += job.delay; job.callback(); return job;}
  stale(job) {job.callback();}
}
class FakeSession {
  cpu = {backendFailed: false}; image = {sha256: hash}; state = 'loaded'; instructions = 0; pc = 0x1000;
  powered = true; mailboxCached = false; sleep = {waitingForInterrupt: false, idleTicks: 0, idleQuanta: 0};
  actions = []; requests = []; pauses = 0; onSnapshot; onPause;
  pause() {this.pauses++; if (['loaded', 'paused'].includes(this.state)) this.state = 'paused'; this.onPause?.();}
  snapshot() {this.onSnapshot?.(); return structuredClone({state: this.state, instructions: this.instructions, pc: this.pc,
    firmwareHash: this.image.sha256, powered: this.powered, cpuBackendFailed: this.cpu.backendFailed,
    mailboxCached: this.mailboxCached, sleep: this.sleep});}
  apply({instructions = 25000, reason = 'budget', waiting = false, ticks = 0, quanta = 0, idleReason = 'sleep', ...extra} = {}) {
    this.instructions += instructions; this.state = 'paused'; this.pc = waiting ? metadata.resumePc : 0x2000;
    this.sleep = {...this.sleep, waitingForInterrupt: waiting, idleTicks: this.sleep.idleTicks + ticks,
      idleQuanta: this.sleep.idleQuanta + quanta, ...(waiting ? {...metadata, lastIdle: {reason: idleReason, idleTicks: ticks,
        attemptedTicks: ticks}} : {})};
    return {instructions, totalInstructions: this.instructions, pc: this.pc, reason, ...(waiting ? {sleep: {...metadata}} : {}), ...extra};
  }
  step(count) {this.requests.push(count); return (this.actions.shift() ?? (session => session.apply({instructions: count})))(this);}
}
function fixture() {
  const timers = new FakeTimers(), session = new FakeSession(), publications = [], errors = [];
  const f = {timers, session, current: session, publications, errors, onPublish: undefined};
  f.scheduler = new WorkerRunScheduler({session: () => f.current, timers,
    publish(snapshot, diagnostics, running) {publications.push(structuredClone({snapshot, diagnostics, running})); f.onPublish?.();},
    error(error) {errors.push(String(error));}});
  return f;
}
const sleeping = (options = {}) => session => session.apply({instructions: 0, reason: 'stopped', waiting: true, ...options});
function park(f) {f.session.actions.push(sleeping()); assert(f.scheduler.start()); f.timers.fire(); assert.equal(f.scheduler.diagnostics().mode, 'parked');}

test('Run uses one public25000 slice per timer and only one outstanding timer', () => {
  const f = fixture(); assert(f.scheduler.start()); assert.equal(f.session.requests.length, 0);
  for (let i = 0; i < 3; i++) {assert.equal(f.timers.active().length, 1); f.timers.fire();}
  assert.deepEqual(f.session.requests, [25000, 25000, 25000]); assert.equal(f.scheduler.running, true);
});
test('Budget WFI retains scheduling without inventing idle work', () => {
  const f = fixture(); f.session.actions.push(session => session.apply({waiting: true})); f.scheduler.start(); f.timers.fire();
  assert.equal(f.scheduler.diagnostics().mode, 'runnable'); assert.equal(f.session.sleep.idleTicks, 0);
  f.timers.fire(); assert.equal(f.session.instructions, 50000);
});
test('Partial instruction progress at quantum-limit continues a matching WFI', () => {
  const f = fixture(); f.session.actions.push(sleeping({instructions: 64, idleReason: 'quantum-limit'})); f.scheduler.start(); f.timers.fire();
  assert.equal(f.scheduler.running, true); assert.equal(f.scheduler.diagnostics().zeroInstructionCalls, 0); f.timers.fire();
  assert.equal(f.session.instructions, 25064);
});
test('Positive paired quantum-limit progress continues without adding instructions', () => {
  const f = fixture(); f.session.actions.push(sleeping({ticks: 192, quanta: 64, idleReason: 'quantum-limit'})); f.scheduler.start(); f.timers.fire();
  assert.equal(f.session.instructions, 0); assert.equal(f.scheduler.diagnostics().idleTicks, 192); assert.equal(f.scheduler.running, true);
});
test('A far supported SysTick interval can pass17 clipped fake quanta', () => {
  const f = fixture(); for (let i = 0; i < 17; i++) f.session.actions.push(sleeping({ticks: 1000000, quanta: 1}));
  f.scheduler.start(); for (let i = 0; i < 17; i++) f.timers.fire();
  assert.equal(f.session.instructions, 0); assert.equal(f.scheduler.diagnostics().zeroInstructionCalls, 17);
  f.timers.fire(); assert.equal(f.session.instructions, 25000); assert.equal(f.scheduler.diagnostics().zeroInstructionCalls, 0);
});
test('No-event sleep parks and100 ms heartbeats execute no additional steps', () => {
  const f = fixture(); park(f); const instructions = f.session.instructions;
  for (let i = 0; i < 5; i++) {assert.equal(f.timers.active()[0].delay, 100); f.timers.fire();}
  assert.equal(f.session.requests.length, 1); assert.equal(f.session.instructions, instructions);
  assert(f.publications.every(row => row.running)); assert.equal(f.publications.length, 6);
});
test('Executing WFI before a no-event wait still parks', () => {
  const f = fixture(); f.session.actions.push(sleeping({instructions: 1})); f.scheduler.start(); f.timers.fire();
  assert.equal(f.scheduler.diagnostics().mode, 'parked'); f.timers.fire(); assert.deepEqual(f.session.requests, [25000]);
});
test('An owned input completion rearms a parked timer once', () => {
  const f = fixture(); park(f); const ticket = f.scheduler.captureInput(); assert(f.scheduler.rearmAfterInput(ticket));
  assert.equal(f.timers.active().length, 1); assert.equal(f.timers.active()[0].delay, 0);
  assert.equal(f.scheduler.rearmAfterInput(ticket), false); f.timers.fire(); assert.equal(f.session.requests.length, 2);
});
test('Reading status or trace cannot rearm a parked session', () => {
  const f = fixture(); park(f); f.session.snapshot(); f.scheduler.diagnostics(); f.timers.fire(); assert.equal(f.session.requests.length, 1);
});
test('An input ticket becomes stale after pause and a later Run', () => {
  const f = fixture(); park(f); const ticket = f.scheduler.captureInput(); f.scheduler.stop('pause'); f.scheduler.start();
  assert.equal(f.scheduler.rearmAfterInput(ticket), false); assert.equal(f.timers.active().length, 1);
});
test('USB suspends timer execution and guarded completion resumes it once', () => {
  const f = fixture(); park(f); const ticket = f.scheduler.suspendForUsb(); assert(ticket); assert.equal(f.timers.active().length, 0);
  assert.equal(f.scheduler.running, false); assert(f.scheduler.resumeAfterUsb(ticket)); assert.equal(f.timers.active()[0].delay, 0);
  assert.equal(f.scheduler.resumeAfterUsb(ticket), false); f.timers.fire(); assert.equal(f.session.requests.length, 2);
});
test('A paused session issues no automatic USB resume ticket', () => {
  const f = fixture(); assert.equal(f.scheduler.suspendForUsb(), undefined); assert.equal(f.scheduler.resumeAfterUsb(), false);
});
test('Pause, load, reset and manual step invalidate USB completion', () => {
  for (const reason of ['pause', 'load', 'reset', 'step']) {
    const f = fixture(); f.scheduler.start(); const ticket = f.scheduler.suspendForUsb(); f.scheduler.stop(reason);
    assert.equal(f.scheduler.resumeAfterUsb(ticket), false); assert.equal(f.timers.active().length, 0);
  }
});
test('Nested cancellation during USB suspension cannot mint a newer resume token', () => {
  const f = fixture(); f.scheduler.start(); f.session.onPause = () => {f.session.onPause = undefined; f.scheduler.stop('pause');};
  assert.equal(f.scheduler.suspendForUsb(), undefined); assert.equal(f.scheduler.running, false);
});
test('USB cannot resume a replaced CPU, image, hash, session or powered-off guest', () => {
  for (const change of [f => {f.current = new FakeSession();}, f => {f.session.cpu = {backendFailed: false};},
    f => {f.session.image = {sha256: hash};}, f => {f.session.image.sha256 = 'b'.repeat(64);},
    f => {f.session.powered = false;}, f => {f.session.cpu.backendFailed = true;}, f => {f.session.state = 'halted';}]) {
    const f = fixture(); f.scheduler.start(); const ticket = f.scheduler.suspendForUsb(); change(f);
    assert.equal(f.scheduler.resumeAfterUsb(ticket), false); assert.equal(f.timers.active().length, 0);
  }
});
test('Canceled timer delivery never clears the timer owned by a newer Run', () => {
  const f = fixture(); f.scheduler.start(); const old = f.timers.active()[0]; f.scheduler.stop('pause'); f.scheduler.start();
  const fresh = f.timers.active()[0]; f.timers.stale(old); assert.equal(f.session.requests.length, 0);
  assert.deepEqual(f.timers.active(), [fresh]); f.timers.fire(); assert.equal(f.session.requests.length, 1);
});
test('Lifecycle cancellation prevents parked callbacks from publishing again', () => {
  for (const reason of ['pause', 'load', 'reset', 'step']) {
    const f = fixture(); park(f); const old = f.timers.active()[0], publications = f.publications.length; f.scheduler.stop(reason); f.timers.stale(old);
    assert.equal(f.session.requests.length, 1); assert.equal(f.publications.length, publications); assert.equal(f.timers.active().length, 0);
  }
});
test('Unannounced ownership replacement abandons only old scheduled work', () => {
  for (const change of [f => {f.current = new FakeSession();}, f => {f.session.cpu = {backendFailed: false};},
    f => {f.session.image = {sha256: hash};}, f => {f.session.image.sha256 = 'b'.repeat(64);}]) {
    const f = fixture(); f.scheduler.start(); change(f); const pauses = f.current.pauses; f.timers.fire();
    assert.equal(f.session.requests.length, 0); assert.equal(f.current.pauses, pauses); assert.equal(f.scheduler.running, false);
  }
});
test('Snapshot cancellation before a slice leaves the newer owner untouched', () => {
  const f = fixture(); f.scheduler.start(); f.session.onSnapshot = () => {f.session.onSnapshot = undefined; f.current = new FakeSession();};
  f.timers.fire(); assert.equal(f.session.requests.length, 0); assert.equal(f.current.pauses, 0); assert.equal(f.scheduler.running, false);
});
test('Replacement during a fake step publishes no stale result', () => {
  const f = fixture(); f.session.actions.push(session => {const result = session.apply(); f.current = new FakeSession(); return result;});
  f.scheduler.start(); f.timers.fire(); assert.equal(f.publications.length, 0); assert.equal(f.current.pauses, 0); assert.equal(f.scheduler.running, false);
});
test('A publication callback that pauses cancels the next runnable callback', () => {
  const f = fixture(); f.onPublish = () => f.scheduler.stop('pause'); f.scheduler.start(); f.timers.fire();
  assert.equal(f.timers.active().length, 0); assert.equal(f.scheduler.running, false);
});
test('Nested newer Run during start admission keeps its own timer', () => {
  const f = fixture(); f.session.onPause = () => {f.session.onPause = undefined; assert(f.scheduler.start());};
  assert.equal(f.scheduler.start(), false); assert.equal(f.scheduler.running, true); assert.equal(f.timers.active().length, 1);
  f.timers.fire(); assert.equal(f.session.requests.length, 1);
});
test('Nested newer Run during rejected start snapshot is not stopped', () => {
  const f = fixture(); f.session.onSnapshot = () => {f.session.onSnapshot = undefined; assert(f.scheduler.start());};
  assert.equal(f.scheduler.start(), false); assert.equal(f.scheduler.running, true); assert.equal(f.timers.active().length, 1);
});
test('Nested newer Run during terminal publication keeps its first publication', () => {
  const f = fixture(); f.session.actions.push(session => session.apply({instructions: 1, reason: 'stopped'}));
  f.onPublish = () => {f.onPublish = undefined; assert(f.scheduler.start());}; f.scheduler.start(); f.timers.fire();
  assert.equal(f.publications.length, 1); f.timers.fire(); assert.equal(f.publications.length, 2); assert.equal(f.scheduler.running, true);
});
test('Cancellation during the clock callback prevents stale rescheduling', () => {
  const f = fixture(); f.scheduler.start(); f.timers.onNow = () => f.scheduler.stop('pause'); f.timers.fire();
  assert.equal(f.scheduler.running, false); assert.equal(f.timers.active().length, 0);
});
test('Fault, plain stopped, backend loss, cached mailbox and power loss stop Run', () => {
  for (const action of [session => session.apply({instructions: 1, reason: 'fault'}),
    session => session.apply({instructions: 1, reason: 'stopped'}), session => session.apply({backendLost: true}),
    session => {const r = session.apply(); session.cpu.backendFailed = true; return r;},
    session => {const r = session.apply(); session.mailboxCached = true; return r;},
    session => {const r = session.apply(); session.powered = false; return r;}]) {
    const f = fixture(); f.session.actions.push(action); f.scheduler.start(); f.timers.fire();
    assert.equal(f.scheduler.running, false); assert.equal(f.timers.active().length, 0);
  }
});
test('Stopped WFI requires matching paused metadata and resume PC', () => {
  for (const change of [session => {session.state = 'loaded';}, session => {session.sleep.resumePc = 0x1004;},
    session => {session.sleep.waitingForInterrupt = false;}, session => {session.pc = 0x3000;}]) {
    const f = fixture(); f.session.actions.push(session => {const r = sleeping({ticks: 1, quanta: 1})(session); change(session); return r;});
    f.scheduler.start(); f.timers.fire(); assert.equal(f.scheduler.running, false); assert.equal(f.timers.active().length, 0);
  }
});
test('Invalid delta and cumulative idle pairs are rejected before more work', () => {
  for (const values of [{ticks: 1, quanta: 0}, {ticks: 0, quanta: 1}, {ticks: 1, quanta: 64},
    {ticks: 1000001, quanta: 1}, {ticks: 64000001, quanta: 64}, {ticks: 65, quanta: 65}]) {
    const f = fixture(); f.session.actions.push(sleeping(values)); f.scheduler.start(); f.timers.fire();
    assert.equal(f.scheduler.running, false); assert.equal(f.errors.length, 1); assert.equal(f.timers.active().length, 0);
  }
  const f = fixture(); f.session.sleep.idleTicks = 1; f.session.sleep.idleQuanta = 64;
  f.scheduler.start(); f.timers.fire(); assert.equal(f.session.requests.length, 0); assert.equal(f.errors.length, 1);
});
test('Instruction-count, total, PC and partial-budget mismatches fail accounting', () => {
  for (const change of [r => {r.instructions = 25001;}, r => {r.totalInstructions++;}, r => {r.pc++;},
    r => {r.instructions--;}, r => {r.instructions = 0;}]) {
    const f = fixture(); f.session.actions.push(session => {const r = session.apply(); change(r); return r;});
    f.scheduler.start(); f.timers.fire(); assert.equal(f.scheduler.running, false); assert.equal(f.errors.length, 1);
  }
});
test('32 idle-only callback admissions pause before a33rd CPU slice', () => {
  const f = fixture(); for (let i = 0; i < 40; i++) f.session.actions.push(sleeping({ticks: 1, quanta: 1}));
  f.scheduler.start(); for (let i = 0; i < 33; i++) f.timers.fire();
  assert.equal(f.session.requests.length, 32); assert.equal(f.scheduler.running, false);
  assert.equal(f.scheduler.diagnostics().stopReason, 'work-limit'); assert.equal(f.session.sleep.waitingForInterrupt, true);
  assert.equal(f.errors.length, 0); assert.equal(f.publications.at(-1).running, false);
});
test('Worst-case idle reservation remains within fixed quanta and tick caps', () => {
  const f = fixture(); for (let i = 0; i < 40; i++) f.session.actions.push(sleeping({ticks: 64000000, quanta: 64, idleReason: 'quantum-limit'}));
  f.scheduler.start(); for (let i = 0; i < 33; i++) f.timers.fire();
  assert.equal(f.session.requests.length, 32); assert.equal(f.session.sleep.idleTicks, workerRunLimits.idleTicks);
  assert.equal(f.session.sleep.idleQuanta, workerRunLimits.idleQuanta); assert.equal(f.scheduler.diagnostics().stopReason, 'work-limit');
});
test('Malformed parked counters or changed sleep state stop heartbeat publication', () => {
  for (const change of [session => {session.sleep.idleTicks = NaN;}, session => {session.sleep.waitingForInterrupt = false;},
    session => {session.pc++;}, session => {session.instructions++;}, session => {session.sleep.idleTicks = 1; session.sleep.idleQuanta = 1;}]) {
    const f = fixture(); park(f); const count = f.publications.length; change(f.session); f.timers.fire();
    assert.equal(f.scheduler.running, false); assert.equal(f.session.requests.length, 1); assert(f.publications.length <= count + 1);
  }
});
test('Thrown snapshot and step callbacks stop with bounded error delivery', () => {
  const f = fixture(); f.scheduler.start(); f.session.onSnapshot = () => {throw Error('fake snapshot failure');}; f.timers.fire();
  assert.equal(f.errors.length, 1); assert.equal(f.session.requests.length, 0); assert.equal(f.timers.active().length, 0);
  const g = fixture(); g.session.actions.push(() => {throw Error('fake step failure');}); g.scheduler.start(); g.timers.fire();
  assert.equal(g.errors.length, 1); assert.equal(g.session.requests.length, 1); assert.equal(g.timers.active().length, 0);
});
test('Failure delivery cannot close a CPU or image replaced during pause', () => {
  for (const change of [session => {session.cpu = {backendFailed: false};}, session => {session.image = {sha256: hash};},
    session => {session.image.sha256 = 'b'.repeat(64);}]) {
    const f = fixture(); f.session.actions.push(() => {throw Error('old fake step failed');}); f.scheduler.start();
    f.session.onPause = () => {f.session.onPause = undefined; change(f.session);}; f.timers.fire();
    assert.equal(f.errors.length, 0); assert.equal(f.scheduler.running, false); assert.equal(f.timers.active().length, 0);
  }
});
test('Terminal publication clock cannot write a timestamp for a replaced CPU', () => {
  const f = fixture(); f.session.actions.push(session => session.apply({instructions: 1, reason: 'stopped'}));
  f.onPublish = () => {f.onPublish = undefined; f.timers.onNow = () => {f.session.cpu = {backendFailed: false};};};
  f.scheduler.start(); f.timers.fire(); assert.equal(f.publications.length, 1);
  assert(f.scheduler.start()); f.timers.fire(); assert.equal(f.publications.length, 2);
});
test('Replacement during publication or its clock clears only the old run intent', () => {
  for (const setup of [f => {f.onPublish = () => {f.current = new FakeSession();};},
    f => {f.timers.onNow = () => {f.session.cpu = {backendFailed: false};};},
    f => {f.onPublish = () => {f.timers.onNow = () => {f.session.image.sha256 = 'b'.repeat(64);};};}]) {
    const f = fixture(); f.scheduler.start(); setup(f); const pauses = f.session.pauses; f.timers.fire();
    assert.equal(f.scheduler.running, false); assert.equal(f.timers.active().length, 0); assert.equal(f.errors.length, 0);
    assert.equal(f.session.pauses, pauses);
  }
});

function workerFixture() {
  const source = fs.readFileSync(new URL('../src/scripts/emulator-worker.ts', import.meta.url), 'utf8');
  let script = stripTypeScriptTypes(source);
  const schedulerImport = "import {WorkerRunScheduler} from '../lib/emulator/run-scheduler.ts';";
  assert.equal(script.split(schedulerImport).length, 2); script = script.replace(schedulerImport, '');
  assert(!script.includes("from '../lib/emulator/run-scheduler.ts'"), 'Only the scheduler module boundary is injected.');
  const workerModuleUrl = 'https://emulator.test/assets/emulator-worker.js';
  assert.equal(script.split('import.meta.url').length, 2);
  script = script.replace('import.meta.url', 'workerModuleUrl');
  for (const [name, injected] of [['session', 'loadSession'], ['image', 'loadImage'], ['sd-fixtures', 'loadSdFixtures'], ['audio-preset', 'loadAudioPreset']]) {
    const expression = `await import('../lib/emulator/${name}')`;
    assert.equal(script.split(expression).length, 2); script = script.replace(expression, `await testModules.${injected}()`);
  }
  const timers = new FakeTimers(), sent = [], session = new FakeSession(); let listener;
  session.reset = async () => {session.cpu = {backendFailed: false}; session.instructions = 0; session.state = 'loaded';};
  session.close = () => {session.state = 'closed';}; session.setInput = () => {};
  session.usbReport = () => new Uint8Array(64); session.trace = () => session.snapshot();
  const scope = {postMessage(message) {sent.push(structuredClone(message));}, addEventListener(name, callback) {assert.equal(name, 'message'); listener = callback;}};
  new vm.Script(script, {filename: 'private-worker-wfi-fake.js'}).runInNewContext({self: scope, ArrayBuffer, Uint8Array,
    performance: {now: timers.now}, setTimeout: timers.set, clearTimeout: timers.clear, WorkerRunScheduler, URL, workerModuleUrl,
    testModules: {async loadSession() {return {async createSession() {return session;}};}, async loadSdFixtures() {return {ownSdFixtures: () => ({})};},
      async loadImage() {return {validateApp1ResetContract: target => target};}, async loadAudioPreset() {return {STOCK_AUDIO_PRESET};}}});
  async function dispatch(request) {
    const start = sent.length; listener({data: request});
    for (let i = 0; i < 20 && !sent.slice(start).some(row => row.id === request.id); i++) await new Promise(resolve => setImmediate(resolve));
    const rows = sent.slice(start).filter(row => row.id === request.id); assert(rows.length); return rows;
  }
  return {timers, sent, session, dispatch};
}
test('Guarded private worker recipe acknowledges Run and continues valid sleep', async () => {
  const f = workerFixture(); await f.dispatch({id: 1, command: 'load', image: new ArrayBuffer(4), format: 'app1'});
  f.session.actions.push(sleeping({ticks: 1000000, quanta: 1}));
  assert.equal((await f.dispatch({id: 2, command: 'run'}))[0].state, 'running'); f.timers.fire();
  assert.equal(f.timers.active().length, 1); assert.equal(f.sent.at(-1).state, 'running'); assert.deepEqual(f.session.requests, [25000]);
});
test('Private worker parking preserves status/trace semantics and rearms after input', async () => {
  const f = workerFixture(); await f.dispatch({id: 1, command: 'load', image: new ArrayBuffer(4), format: 'app1'});
  f.session.actions.push(sleeping()); await f.dispatch({id: 2, command: 'run'}); f.timers.fire();
  await f.dispatch({id: 3, command: 'status'}); await f.dispatch({id: 4, command: 'trace'});
  assert.equal(f.timers.active()[0].delay, 100); assert.equal(f.session.requests.length, 1);
  await f.dispatch({id: 5, command: 'input', input: {control: 'SHIFT', value: 1}}); assert.equal(f.timers.active()[0].delay, 0);
  f.timers.fire(); assert.equal(f.session.requests.length, 2);
});
test('Private worker pause/manual/reset controls cancel scheduling and generic reset adds no boot', async () => {
  const f = workerFixture(); await f.dispatch({id: 1, command: 'load', image: new ArrayBuffer(4), format: 'app1'});
  await f.dispatch({id: 2, command: 'run'}); await f.dispatch({id: 3, command: 'pause'}); assert.equal(f.timers.active().length, 0);
  await f.dispatch({id: 4, command: 'step', instructions: 1}); assert.deepEqual(f.session.requests, [1]);
  await f.dispatch({id: 5, command: 'run'}); const reset = await f.dispatch({id: 6, command: 'reset'});
  assert.equal(f.timers.active().length, 0); assert.equal(reset[0].state, 'loaded'); assert.equal(reset[0].instructions, 0);
  assert.deepEqual(f.session.requests, [1]);
});
