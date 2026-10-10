import assert from 'node:assert/strict';
import test from 'node:test';
import {CortexMExceptions} from '../src/lib/emulator/exceptions.ts';
import {advanceWfiIdle} from '../src/lib/emulator/wfi-idle.ts';

const T = 0x01000000, VECTOR = 0x80000000, MSP = 0x20248000;
const CSR = 0xe000e010, RVR = 0xe000e014;

class FakeCPU {
  backendFailed = false;
  totalInstructions = 73;
  instructionsRun = 0;
  registers = new Map([['xpsr', T], ['pc', 0x1202], ['msp', MSP], ['psp', MSP + 4096],
    ['control', 0], ['primask', 0], ['basepri', 0], ['faultmask', 0], ['lr', 0x80000101]]);
  memory = new Map();
  registerWrites = 0;
  memoryReads = 0;
  memoryWrites = 0;
  readRegister(name) {
    assert.equal(this.backendFailed, false, 'no register reads after backend loss');
    if (name === 'sp') name = this.readRegister('xpsr') & 511 ? 'msp' : this.readRegister('control') & 2 ? 'psp' : 'msp';
    return this.registers.get(name) ?? 0;
  }
  writeRegister(name, value) {
    if (name === 'sp') name = this.readRegister('xpsr') & 511 ? 'msp' : this.readRegister('control') & 2 ? 'psp' : 'msp';
    this.registers.set(name, value >>> 0); this.registerWrites++;
  }
  readMemory(address, length) {
    assert.ok((address >= VECTOR && address + length <= VECTOR + 4096)
      || (address >= 0x20240000 && address + length <= 0x20250000));
    this.memoryReads++;
    return Uint8Array.from({length}, (_, index) => this.memory.get(address + index) ?? 0);
  }
  loadMemory(address, bytes) { this.memoryWrites++; bytes.forEach((value, index) => this.memory.set(address + index, value)); }
  step() { this.instructionsRun++; throw new Error('Idle qualification must not execute instructions'); }
}

function fixture() {
  const cpu = new FakeCPU();
  for (let exception = 2; exception < 48; exception++) {
    const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, 0x80002001 + exception * 8, true);
    cpu.loadMemory(VECTOR + exception * 4, bytes);
  }
  const clock = new CortexMExceptions(cpu, {vectorTable: VECTOR, externalInterrupts: 32});
  const owner = {cpu, generation: 4, state: 'paused'};
  const sleep = {cpu, generation: 4, metadata: {kind: 'wfi', address: 0x1200, resumePc: 0x1202}};
  const board = {powered: true, ticks: [], isPowered() {return this.powered;}, tick(value) {this.ticks.push(value);}};
  cpu.registerWrites = 0; cpu.memoryReads = 0; cpu.memoryWrites = 0;
  return {cpu, clock, owner, sleep, board};
}
function configure(clock, reload = 9, control = 7) {clock.writeMmio(RVR, reload); clock.writeMmio(CSR, control);}
function enabled(clock, exception, priority = 0x80, pending = true) {
  if (exception !== 2 && exception !== 3) clock.setPriority(exception, priority);
  if (exception >= 16) clock.setExternalEnabled(exception - 16, true);
  else if ([4, 5, 6, 12].includes(exception)) clock.setSystemEnabled(exception, true);
  if (pending) clock.pend(exception);
}
function readOnly(f, query) {
  const before = {status: structuredClone(f.clock.status()), registers: [...f.cpu.registers],
    writes: f.cpu.registerWrites, reads: f.cpu.memoryReads, memoryWrites: f.cpu.memoryWrites};
  const value = query();
  assert.deepEqual(f.clock.status(), before.status);
  assert.deepEqual([...f.cpu.registers], before.registers);
  assert.equal(f.cpu.registerWrites, before.writes);
  assert.equal(f.cpu.memoryReads, before.reads);
  assert.equal(f.cpu.memoryWrites, before.memoryWrites);
  assert.equal(f.cpu.instructionsRun, 0); assert.equal(f.cpu.totalInstructions, 73);
  return value;
}
function idle(f, counters = {ticks: 0, quanta: 0}, maxTicks = 1000000) {
  const result = advanceWfiIdle(f.sleep, f.owner, f.board, f.clock, counters, maxTicks);
  assert.equal(result.instructions, 0); assert.equal(f.cpu.instructionsRun, 0); assert.equal(f.cpu.totalInstructions, 73);
  return result;
}

test('PRIMASK distinguishes asynchronous wake from delivery without mutation', () => {
  const f = fixture(); enabled(f.clock, 15); f.cpu.writeRegister('primask', 1);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), true);
  assert.equal(readOnly(f, () => f.clock.hasDeliverablePending()), false);
  const result = idle(f); assert.equal(result.reason, 'wake'); assert.equal(result.deliverable, false);
  assert.equal(result.idleTicks, 0); assert.deepEqual(f.board.ticks, []); assert.equal(f.clock.pendingCount, 1);
});

for (const exception of [2, 14, 15, 16, 47]) test(`asynchronous source ${exception} can wake while PRIMASK is set`, () => {
  const f = fixture(); enabled(f.clock, exception); f.cpu.writeRegister('primask', 1);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), true);
});
for (const exception of [3, 4, 5, 6, 11, 12]) test(`unqualified synchronous source ${exception} is excluded from wake`, () => {
  const f = fixture(); enabled(f.clock, exception);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), false);
});

test('excluded higher-priority SVC does not hide an eligible external wake', () => {
  const f = fixture(); enabled(f.clock, 11, 0); enabled(f.clock, 16, 0x80);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), true);
  assert.equal(f.clock.dispatchPending().exceptionNumber, 11);
});
test('disabled external request remains pending without waking', () => {
  const f = fixture(); f.clock.pend(16);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), false);
  f.clock.setExternalEnabled(0, true);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), true);
});
test('BASEPRI preserves quantized priority and group masking', () => {
  const f = fixture(); enabled(f.clock, 15, 0x80); f.cpu.writeRegister('basepri', 0x6f);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), false);
  f.clock.setPriority(15, 0x50); assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), true);
  f.cpu.writeRegister('basepri', 0x0f); f.clock.setPriority(15, 0xf0);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), true);
  f.clock.setPriorityGrouping(5); f.cpu.writeRegister('basepri', 0x70); f.clock.setPriority(15, 0x40);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), false);
});
test('FAULTMASK allows NMI while blocking configurable wake sources', () => {
  const f = fixture(); enabled(f.clock, 15, 0); f.cpu.writeRegister('faultmask', 1);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), false);
  enabled(f.clock, 2); f.cpu.writeRegister('basepri', 0x10); f.cpu.writeRegister('primask', 1);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), true);
});
test('active source, equal group and lower priority do not preempt for wake', () => {
  const f = fixture(); enabled(f.clock, 16, 0x40); f.clock.dispatchPending();
  f.clock.pend(16); assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), false);
  enabled(f.clock, 15, 0x50); assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), false);
  f.clock.setPriority(15, 0x40); assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), false);
  f.clock.setPriority(15, 0x30); assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), true);
});
test('active NMI blocks a second pending NMI', () => {
  const f = fixture(); enabled(f.clock, 2); f.clock.dispatchPending(); f.clock.pend(2);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), false);
});
test('excluded active HardFault still constrains wake priority', () => {
  const f = fixture(); enabled(f.clock, 3); f.clock.dispatchPending(); enabled(f.clock, 15, 0);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), false);
  enabled(f.clock, 2); assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), true);
});
test('queries preserve tie ordering for later delivery', () => {
  const f = fixture(); enabled(f.clock, 15, 0x80); enabled(f.clock, 14, 0x80); enabled(f.clock, 16, 0x80);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), true);
  assert.equal(f.clock.dispatchPending().exceptionNumber, 14);
});

test('future processor wrap is query-only and respects PRIMASK', () => {
  const f = fixture(); configure(f.clock); f.cpu.writeRegister('primask', 1);
  assert.equal(readOnly(f, () => f.clock.processorTicksToWfiWake()), 10);
  assert.equal(f.clock.pendingCount, 0);
});
test('positive current stays the distance after reload becomes zero', () => {
  const f = fixture(); configure(f.clock); f.clock.advanceSysTick(1); f.clock.writeMmio(RVR, 0);
  assert.equal(readOnly(f, () => f.clock.processorTicksToWfiWake()), 9);
  f.clock.advanceSysTick(9); f.clock.clearPending(15);
  assert.equal(readOnly(f, () => f.clock.processorTicksToWfiWake()), null);
});
for (const control of [0, 1, 3, 4, 5, 6]) test(`control ${control} has no eligible processor SysTick wake event`, () => {
  const f = fixture(); configure(f.clock, 9, control);
  assert.equal(readOnly(f, () => f.clock.processorTicksToWfiWake()), null);
});
test('zero current and reload have no event; positive current overrides changed reload', () => {
  const f = fixture(); configure(f.clock, 0); assert.equal(readOnly(f, () => f.clock.processorTicksToWfiWake()), null);
  configure(f.clock, 19); f.clock.advanceSysTick(5); f.clock.writeMmio(RVR, 2);
  assert.equal(readOnly(f, () => f.clock.processorTicksToWfiWake()), 15);
});
test('future event observes BASEPRI, FAULTMASK and active priority', () => {
  const f = fixture(); configure(f.clock); f.clock.setPriority(15, 0x80); f.cpu.writeRegister('basepri', 0x80);
  assert.equal(readOnly(f, () => f.clock.processorTicksToWfiWake()), null);
  f.cpu.writeRegister('basepri', 0); f.cpu.writeRegister('faultmask', 1);
  assert.equal(readOnly(f, () => f.clock.processorTicksToWfiWake()), null);
  f.cpu.writeRegister('faultmask', 0); enabled(f.clock, 16, 0x80); f.clock.dispatchPending();
  assert.equal(readOnly(f, () => f.clock.processorTicksToWfiWake()), null);
  f.clock.setPriority(15, 0x70); assert.equal(readOnly(f, () => f.clock.processorTicksToWfiWake()), 10);
});
test('prospective timer query does not let another pending winner hide SysTick eligibility', () => {
  const f = fixture(); configure(f.clock); enabled(f.clock, 2);
  assert.equal(readOnly(f, () => f.clock.processorTicksToWfiWake()), 10);
});
test('timer queries preserve COUNTFLAG and source ticks', () => {
  const f = fixture(); configure(f.clock); f.clock.advanceSysTick(10); f.clock.clearPending(15);
  assert.equal(f.clock.status().systick.countFlag, true);
  assert.equal(readOnly(f, () => f.clock.processorTicksToWfiWake()), 10);
  assert.equal(readOnly(f, () => f.clock.hasWfiWakePending()), false);
});
test('full-event source counter overflow is rejected before board advancement', () => {
  const f = fixture(); configure(f.clock); f.clock.advanceSysTick(Number.MAX_SAFE_INTEGER - 1); f.clock.clearPending(15);
  const before = structuredClone(f.clock.status());
  assert.throws(() => f.clock.processorTicksToWfiWake(), /safe integer/);
  const result = idle(f); assert.equal(result.reason, 'fault'); assert.equal(result.idleTicks, 0);
  assert.deepEqual(f.board.ticks, []); assert.deepEqual(f.clock.status(), before);
});
test('untracked handler context is refused by both wake queries', () => {
  const f = fixture(); configure(f.clock); enabled(f.clock, 15); f.cpu.writeRegister('xpsr', T | 14);
  assert.throws(() => f.clock.hasWfiWakePending(), /IPSR/);
  assert.throws(() => f.clock.processorTicksToWfiWake(), /IPSR/);
});

test('one idle call advances both models once and wakes without dispatch or instructions', () => {
  const f = fixture(); configure(f.clock); const result = idle(f, {ticks: 12, quanta: 2});
  assert.equal(result.reason, 'wake'); assert.equal(result.deliverable, true); assert.equal(result.sleep, undefined);
  assert.equal(result.idleTicks, 10); assert.equal(result.attemptedTicks, 10);
  assert.deepEqual(result.counters, {ticks: 22, quanta: 3}); assert.deepEqual(f.board.ticks, [10]);
  assert.equal(f.clock.status().systick.sourceTicks, 10); assert.equal(f.clock.pendingCount, 1);
  assert.equal(f.clock.status().delivered, 0); assert.equal(f.cpu.registerWrites, 0);
});
test('PRIMASK permits event wake while delivery remains blocked', () => {
  const f = fixture(); configure(f.clock); f.cpu.writeRegister('primask', 1);
  const result = idle(f); assert.equal(result.reason, 'wake'); assert.equal(result.deliverable, false); assert.equal(result.idleTicks, 10);
});
test('distant event consumes at most one million ticks and retains owned sleep', () => {
  const f = fixture(); configure(f.clock, 0xffffff); const result = idle(f);
  assert.equal(result.reason, 'sleep'); assert.equal(result.sleep, f.sleep); assert.equal(result.idleTicks, 1000000);
  assert.deepEqual(f.board.ticks, [1000000]); assert.equal(f.clock.pendingCount, 0);
  assert.equal(f.clock.status().systick.current, 0xffffff - 1000000 + 1);
});
test('paused reuse advances a chosen smaller quantum without a helper loop', () => {
  const f = fixture(); configure(f.clock, 9); const first = idle(f, {ticks: 0, quanta: 0}, 4);
  assert.equal(first.reason, 'sleep'); const second = idle(f, first.counters, 4);
  assert.equal(second.reason, 'sleep'); const third = idle(f, second.counters, 4);
  assert.equal(third.reason, 'wake'); assert.deepEqual(f.board.ticks, [4, 4, 2]);
  assert.deepEqual(third.counters, {ticks: 10, quanta: 3});
});
test('no eligible event retains sleep with no advancement', () => {
  const f = fixture(); const result = idle(f, {ticks: 17, quanta: 3});
  assert.equal(result.reason, 'sleep'); assert.equal(result.sleep, f.sleep); assert.equal(result.idleTicks, 0);
  assert.deepEqual(result.counters, {ticks: 17, quanta: 3}); assert.deepEqual(f.board.ticks, []);
});
for (const [name, change] of [
  ['CPU replacement', f => {f.owner.cpu = new FakeCPU();}],
  ['exception CPU replacement', f => {f.clock = {...f.clock, cpu: new FakeCPU()};}],
  ['reset generation', f => {f.owner.generation++;}],
  ['closed session', f => {f.owner.state = 'closed';}],
  ['faulted session', f => {f.owner.state = 'fault';}],
  ['unpaused session', f => {f.owner.state = 'loaded';}],
  ['power off', f => {f.board.powered = false;}],
  ['backend loss', f => {f.cpu.backendFailed = true;}],
  ['changed PC', f => {f.cpu.registers.set('pc', 0x1204);}],
  ['inconsistent metadata', f => {f.sleep.metadata.resumePc = 0x1204;}],
]) test(`${name} invalidates sleep before model effects`, () => {
  const f = fixture(); configure(f.clock); change(f); const result = idle(f);
  assert.equal(result.reason, 'stopped'); assert.equal(result.sleep, undefined); assert.equal(result.idleTicks, 0);
  assert.deepEqual(f.board.ticks, []); assert.equal(f.clock.status?.().systick.sourceTicks ?? 0, 0);
});
test('generation change in a query stops before advancement', () => {
  const f = fixture(); configure(f.clock); const original = f.clock.processorTicksToWfiWake.bind(f.clock);
  f.clock.processorTicksToWfiWake = () => {const ticks = original(); f.owner.generation++; return ticks;};
  assert.equal(idle(f).reason, 'stopped'); assert.deepEqual(f.board.ticks, []);
});
test('backend loss in a query performs no later register, model or instruction calls', () => {
  const f = fixture(); configure(f.clock); f.clock.hasWfiWakePending = () => {f.cpu.backendFailed = true; return true;};
  assert.equal(idle(f).reason, 'stopped'); assert.deepEqual(f.board.ticks, []); assert.equal(f.clock.status().systick.sourceTicks, 0);
});
test('reset during board callback stops before touching the former CPU clock', () => {
  const f = fixture(); configure(f.clock); f.board.tick = value => {f.board.ticks.push(value); f.owner.generation++;};
  const result = idle(f); assert.equal(result.reason, 'stopped'); assert.equal(result.attemptedTicks, 10);
  assert.equal(result.idleTicks, 0); assert.equal(f.clock.status().systick.sourceTicks, 0);
});
test('ordinary board failure records attempt without claiming paired-clock completion', () => {
  const f = fixture(); configure(f.clock); f.board.tick = value => {f.board.ticks.push(value); throw new Error('fake board refusal');};
  const result = idle(f); assert.equal(result.reason, 'fault'); assert.equal(result.attemptedTicks, 10);
  assert.equal(result.idleTicks, 0); assert.equal(result.sleep, undefined); assert.equal(f.clock.status().systick.sourceTicks, 0);
});
test('idle counter overflow and invalid event distance stop before callbacks', () => {
  const f = fixture(); configure(f.clock);
  for (const counters of [{ticks: Number.MAX_SAFE_INTEGER, quanta: 0}, {ticks: 0, quanta: Number.MAX_SAFE_INTEGER}]) {
    const result = idle(f, counters); assert.equal(result.reason, 'fault'); assert.equal(result.attemptedTicks, 0);
  }
  f.clock.processorTicksToWfiWake = () => 0; assert.equal(idle(f).reason, 'fault'); assert.deepEqual(f.board.ticks, []);
});
test('invalid quantum and ledger values are refused without effects', () => {
  const f = fixture(); configure(f.clock);
  for (const ticks of [0, -1, 1.5, 1000001, NaN, Infinity]) assert.throws(() => idle(f, {ticks: 0, quanta: 0}, ticks), /quantum/);
  for (const counters of [{ticks: -1, quanta: 0}, {ticks: 0, quanta: 0.5}]) assert.throws(() => idle(f, counters), /counters/);
  assert.deepEqual(f.board.ticks, []);
});


// Record attempted calls before refusing them: a swallowed fixture assertion
// must not hide an API access after nested ownership/backend invalidation.
for (const stage of ['isPowered', 'readRegister']) {
  for (const [name, mutate] of [
    ['CPU replacement', f => {f.owner.cpu = new FakeCPU();}],
    ['clock CPU replacement', f => {f.clock.cpu = new FakeCPU();}],
    ['generation change', f => {f.owner.generation++;}],
    ['state change', f => {f.owner.state = 'closed';}],
    ['backend loss', f => {f.cpu.backendFailed = true;}],
  ]) test(`${stage} callback ${name} stops before later owned APIs`, () => {
    const f = fixture(); configure(f.clock);
    const attempted = {register: 0, powered: 0, query: 0, tick: 0};
    const originalRead = f.cpu.readRegister.bind(f.cpu);
    f.cpu.readRegister = name => {
      attempted.register++;
      const value = originalRead(name);
      if (stage === 'readRegister') mutate(f);
      return value;
    };
    f.board.isPowered = () => {
      attempted.powered++;
      if (stage === 'isPowered') mutate(f);
      return true;
    };
    f.clock.hasWfiWakePending = () => {attempted.query++; throw new Error('unreachable clock query');};
    f.board.tick = () => {attempted.tick++; throw new Error('unreachable board advancement');};
    const result = idle(f);
    assert.equal(result.reason, 'stopped'); assert.equal(result.sleep, undefined);
    assert.equal(result.attemptedTicks, 0); assert.equal(result.idleTicks, 0);
    assert.deepEqual(result.counters, {ticks: 0, quanta: 0});
    assert.equal(attempted.register, stage === 'isPowered' ? 0 : 1);
    assert.equal(attempted.powered, stage === 'isPowered' ? 1 : 2); assert.equal(attempted.query, 0); assert.equal(attempted.tick, 0);
    assert.equal(f.cpu.registerWrites, 0);
  });
}

test('PC observation with power-off generation invalidation stops before clock queries or advancement', () => {
  const f = fixture(); configure(f.clock);
  const attempted = {register: 0, query: 0, tick: 0};
  const originalRead = f.cpu.readRegister.bind(f.cpu);
  f.cpu.readRegister = name => {
    attempted.register++;
    const value = originalRead(name);
    f.board.powered = false; f.owner.generation++;
    return value;
  };
  f.clock.hasWfiWakePending = () => {attempted.query++; throw new Error('unreachable query after power loss');};
  f.board.tick = () => {attempted.tick++; throw new Error('unreachable advancement after power loss');};
  const result = idle(f); assert.equal(result.reason, 'stopped');
  assert.deepEqual(attempted, {register: 1, query: 0, tick: 0});
  assert.equal(result.attemptedTicks, 0); assert.equal(result.idleTicks, 0);
});

test('isPowered callback power loss stops before the captured CPU PC read', () => {
  const f = fixture(); configure(f.clock); let reads = 0, queries = 0;
  f.cpu.readRegister = () => {reads++; throw new Error('unreachable old CPU read');};
  f.clock.hasWfiWakePending = () => {queries++; throw new Error('unreachable clock query');};
  f.board.isPowered = () => {f.board.powered = false; return false;};
  assert.equal(idle(f).reason, 'stopped'); assert.equal(reads, 0); assert.equal(queries, 0);
});

test('clock failure after partial mutation preserves attempted ticks without claiming paired completion', () => {
  const f = fixture(); configure(f.clock); const original = f.clock.advanceSysTick.bind(f.clock);
  f.clock.advanceSysTick = ticks => {original(ticks); throw new Error('finite partial clock failure');};
  const result = idle(f, {ticks: 7, quanta: 2});
  assert.equal(result.reason, 'fault'); assert.equal(result.sleep, undefined);
  assert.equal(result.attemptedTicks, 10); assert.equal(result.idleTicks, 0);
  assert.deepEqual(result.counters, {ticks: 7, quanta: 2}); assert.deepEqual(f.board.ticks, [10]);
  assert.equal(f.clock.status().systick.sourceTicks, 10); assert.equal(f.clock.pendingCount, 1);
});

test('final wake query failure retains completed paired idle accounting', () => {
  const f = fixture(); configure(f.clock); const original = f.clock.hasWfiWakePending.bind(f.clock); let queries = 0;
  f.clock.hasWfiWakePending = () => {if (++queries === 2) throw new Error('finite final query failure'); return original();};
  const result = idle(f, {ticks: 7, quanta: 2});
  assert.equal(result.reason, 'fault'); assert.equal(result.sleep, undefined);
  assert.equal(result.attemptedTicks, 10); assert.equal(result.idleTicks, 10);
  assert.deepEqual(result.counters, {ticks: 17, quanta: 3}); assert.deepEqual(f.board.ticks, [10]);
  assert.equal(f.clock.status().systick.sourceTicks, 10);
});

test('final wake query ownership invalidation retains completed ticks without later delivery queries', () => {
  const f = fixture(); configure(f.clock); const original = f.clock.hasWfiWakePending.bind(f.clock);
  let queries = 0, deliveryQueries = 0;
  f.clock.hasWfiWakePending = () => {if (++queries === 2) {f.owner.generation++; return true;} return original();};
  f.clock.hasDeliverablePending = () => {deliveryQueries++; throw new Error('unreachable stale delivery query');};
  const result = idle(f, {ticks: 7, quanta: 2});
  assert.equal(result.reason, 'stopped'); assert.equal(result.sleep, undefined); assert.equal(deliveryQueries, 0);
  assert.equal(result.attemptedTicks, 10); assert.equal(result.idleTicks, 10);
  assert.deepEqual(result.counters, {ticks: 17, quanta: 3}); assert.deepEqual(f.board.ticks, [10]);
});

// Observe attempts before callbacks run. A swallowed assertion cannot hide a
// clock query after a power callback changed the resume PC.
for (const scenario of [
  {name: 'first admission power observation', phase: 'initial', observation: 1,
    expected: {wake: 0, event: 0, delivery: 0, board: 0, systick: 0}, completed: 0},
  {name: 'final admission power observation', phase: 'initial', observation: 2,
    expected: {wake: 0, event: 0, delivery: 0, board: 0, systick: 0}, completed: 0},
  {name: 'power observation after an existing wake', phase: 'after-initial-wake-query', observation: 2, existingWake: true,
    expected: {wake: 1, event: 0, delivery: 0, board: 0, systick: 0}, completed: 0},
  {name: 'power observation after the first wake query', phase: 'after-initial-wake-query', observation: 2,
    expected: {wake: 1, event: 0, delivery: 0, board: 0, systick: 0}, completed: 0},
  {name: 'power observation after the event query', phase: 'after-event-query', observation: 2,
    expected: {wake: 1, event: 1, delivery: 0, board: 0, systick: 0}, completed: 0},
  {name: 'power observation after board advancement', phase: 'after-board-tick', observation: 2,
    expected: {wake: 1, event: 1, delivery: 0, board: 1, systick: 0}, completed: 0},
  {name: 'power observation after paired clock advancement', phase: 'after-clock-tick', observation: 2,
    expected: {wake: 1, event: 1, delivery: 0, board: 1, systick: 1}, completed: 10},
  {name: 'power observation after the final wake query', phase: 'after-final-wake-query', observation: 2,
    expected: {wake: 2, event: 1, delivery: 0, board: 1, systick: 1}, completed: 10},
  {name: 'power observation after the delivery query', phase: 'after-delivery-query', observation: 2,
    expected: {wake: 2, event: 1, delivery: 1, board: 1, systick: 1}, completed: 10},
]) test(`${scenario.name} PC mutation stops before later owned APIs`, () => {
  const f = fixture(); configure(f.clock);
  if (scenario.existingWake) enabled(f.clock, 15);
  const attempted = {wake: 0, event: 0, delivery: 0, board: 0, systick: 0};
  const observations = new Map(); let phase = 'initial', mutations = 0;
  const originalWake = f.clock.hasWfiWakePending.bind(f.clock);
  const originalEvent = f.clock.processorTicksToWfiWake.bind(f.clock);
  const originalDelivery = f.clock.hasDeliverablePending.bind(f.clock);
  const originalAdvance = f.clock.advanceSysTick.bind(f.clock);
  f.board.isPowered = () => {
    const seen = (observations.get(phase) ?? 0) + 1; observations.set(phase, seen);
    if (phase === scenario.phase && seen === scenario.observation) {
      f.cpu.registers.set('pc', 0x1204); mutations++;
    }
    return true;
  };
  f.clock.hasWfiWakePending = () => {
    attempted.wake++;
    const pending = originalWake();
    phase = attempted.wake === 1 ? 'after-initial-wake-query' : 'after-final-wake-query';
    return pending;
  };
  f.clock.processorTicksToWfiWake = () => {
    attempted.event++;
    const next = originalEvent(); phase = 'after-event-query'; return next;
  };
  f.clock.hasDeliverablePending = () => {
    attempted.delivery++;
    const deliverable = originalDelivery(); phase = 'after-delivery-query'; return deliverable;
  };
  f.board.tick = ticks => {attempted.board++; f.board.ticks.push(ticks); phase = 'after-board-tick';};
  f.clock.advanceSysTick = ticks => {
    attempted.systick++;
    const wraps = originalAdvance(ticks); phase = 'after-clock-tick'; return wraps;
  };
  const result = idle(f, {ticks: 7, quanta: 2});
  assert.equal(mutations, 1, 'the selected power callback must exercise the PC change');
  assert.equal(result.reason, 'stopped'); assert.equal(result.detail, 'Resume PC changed');
  assert.equal(result.sleep, undefined); assert.equal(result.deliverable, false);
  assert.deepEqual(attempted, scenario.expected);
  assert.equal(result.idleTicks, scenario.completed);
  assert.equal(result.attemptedTicks, scenario.expected.board ? 10 : 0);
  assert.deepEqual(result.counters, {ticks: 7 + scenario.completed, quanta: 2 + Number(scenario.completed > 0)});
  assert.equal(f.clock.status().systick.sourceTicks, scenario.expected.systick ? 10 : 0);
  assert.equal(f.cpu.registerWrites, 0);
});
