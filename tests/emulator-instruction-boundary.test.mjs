import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {CortexMExceptions, EXC_RETURN} from '../src/lib/emulator/exceptions.ts';
import {createInstructionBoundaryHandler} from '../src/lib/emulator/instruction-boundary.ts';

// Plain scalar/RAM fixtures only. No CPU factory, engine, firmware or device.
// Synthetic valid instructions are decoded, never executed.
const RAM = 0x20000000, RAM_BYTES = 0x10000, ADDRESS = RAM + 0x1000;
const T = 0x01000000, ICSR = 0xe000ed04, ISER = 0xe000e100;
const ICER = 0xe000e180, ISPR = 0xe000e200, IPR = 0xe000e400;
const NOP = [0x00, 0xbf], BX_LR = [0x70, 0x47], ISB = [0xbf, 0xf3, 0x6f, 0x8f];

class FakeCPU {
  backendFailed = false;
  registers = new Map([['xpsr', T], ['control', 0], ['basepri', 0],
    ['primask', 0], ['faultmask', 0], ['msp', RAM + 0xf000],
    ['psp', RAM + 0xe000], ['pc', ADDRESS], ['lr', ADDRESS + 0x101]]);
  memory = new Uint8Array(RAM_BYTES);
  memoryMap = [{address: RAM, bytes: RAM_BYTES, permissions: 7}];
  calls = [];
  completed = [];
  callbacks = [];
  stopped = 0;
  failWhen = null;
  onStop = null;
  operation(kind, detail) {
    const call = {kind, detail};
    this.calls.push(call);
    assert.equal(this.backendFailed, false, 'no fake API call may follow backend loss');
    if (this.failWhen?.(call)) throw new Error('injected fake API failure');
  }
  bank(name) {
    return name === 'sp' ? (this.registers.get('xpsr') & 511 ? 'msp'
      : this.registers.get('control') & 2 ? 'psp' : 'msp') : name;
  }
  readRegister(name) {this.operation('readRegister', name); return this.registers.get(this.bank(name)) ?? 0;}
  writeRegister(name, value) {this.operation('writeRegister', name); this.registers.set(this.bank(name), value >>> 0);}
  range(address, length) {
    assert.ok(Number.isInteger(address) && Number.isInteger(length) && length >= 0);
    assert.ok(address >= RAM && address + length <= RAM + RAM_BYTES, 'fake memory must be mapped RAM');
    return address - RAM;
  }
  readMemory(address, length) {
    this.operation('readMemory', {address, length});
    const offset = this.range(address, length); return this.memory.slice(offset, offset + length);
  }
  writeMemory(address, bytes) {
    this.operation('writeMemory', {address, length: bytes.length});
    this.memory.set(bytes, this.range(address, bytes.length));
  }
  loadMemory(address, bytes) {this.writeMemory(address, bytes);}
  put(address, bytes) {this.memory.set(bytes, this.range(address, bytes.length));}
  word(address, value) {
    const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); this.put(address, bytes);
  }
  stop() {this.operation('stop', null); this.onStop?.(); this.stopped++;}
  onInstruction(callback) {this.callbacks.push(callback);}
  boundary(address = ADDRESS, size = 2) {
    for (const callback of this.callbacks) callback(address, size);
  }
  completeMaskWrite(name, value) {
    this.writeRegister(name, value); this.completed.push({kind: 'mask-write', name, value});
  }
  completeISB() {this.completed.push({kind: 'isb'});}
  clearCalls() {this.calls = [];}
}

function fixture() {
  const cpu = new FakeCPU();
  for (let exception = 2; exception < 48; exception++) cpu.word(RAM + exception * 4, ADDRESS + 1);
  cpu.put(ADDRESS, NOP); cpu.put(ADDRESS + 2, NOP);
  for (let index = 0; index < 13; index++) cpu.registers.set(`r${index}`, index + 1);
  const exceptions = new CortexMExceptions(cpu, {vectorTable: RAM, externalInterrupts: 32, priorityBits: 4});
  const events = [], returns = [];
  let fpuCalls = 0;
  const beforeInstruction = exceptions.beforeInstruction.bind(exceptions);
  exceptions.beforeInstruction = (address, size) => {fpuCalls++; events.push('fpu'); return beforeInstruction(address, size);};
  const actions = {
    interrupt() {events.push('interrupt');},
    exceptionReturn(transfer) {events.push('return'); returns.push(transfer);},
  };
  const callback = createInstructionBoundaryHandler(cpu, exceptions, actions);
  cpu.onInstruction(callback);
  cpu.onStop = () => {assert.ok(events.at(-1) === 'interrupt' || events.at(-1) === 'return'); events.push('stop');};
  return {cpu, exceptions, events, returns, callback, fpuCalls: () => fpuCalls};
}
function pending(f, exception = 14, priority = 0x80, enabled = true) {
  f.exceptions.setPriority(exception, priority);
  if (exception >= 16) f.exceptions.setExternalEnabled(exception - 16, enabled);
  f.exceptions.pend(exception);
}
function active(f, exception = 14, priority = 0x40) {
  pending(f, exception, priority);
  assert.equal(f.exceptions.dispatchPending()?.exceptionNumber, exception);
  f.cpu.clearCalls(); f.events.length = 0;
}
function snapshot(f) {
  return {registers: [...f.cpu.registers], memory: [...f.cpu.memory], model: f.exceptions.status()};
}
function noWrites(cpu) {
  assert.ok(cpu.calls.every(call => call.kind === 'readRegister' || call.kind === 'readMemory'));
}
function noStop(f, boundaries = 1) {
  for (let count = 0; count < boundaries; count++) f.cpu.boundary();
  assert.equal(f.cpu.stopped, 0); assert.equal(f.returns.length, 0); assert.equal(f.fpuCalls(), boundaries);
}

test('empty pending query performs no CPU calls and changes no state', () => {
  const f = fixture(), before = snapshot(f);
  f.cpu.failWhen = () => true;
  assert.equal(f.exceptions.hasDeliverablePending(), false);
  assert.deepEqual(f.cpu.calls, []); assert.deepEqual(snapshot(f), before);
});
test('deliverable pending query is repeatable and read only', () => {
  const f = fixture(); pending(f); const before = snapshot(f);
  assert.equal(f.exceptions.hasDeliverablePending(), true);
  assert.equal(f.exceptions.hasDeliverablePending(), true);
  noWrites(f.cpu); assert.ok(f.cpu.calls.every(call => call.kind === 'readRegister'));
  assert.deepEqual(snapshot(f), before);
});
for (const [mask, blocked] of [['basepri', 0x60], ['primask', 1], ['faultmask', 1]]) {
  test(`${mask} blocks the query and lowering it admits the same pending request`, () => {
    const f = fixture(); pending(f); f.cpu.registers.set(mask, blocked); const before = snapshot(f);
    assert.equal(f.exceptions.hasDeliverablePending(), false);
    assert.deepEqual(snapshot(f), before); noWrites(f.cpu);
    f.cpu.completeMaskWrite(mask, 0);
    assert.equal(f.exceptions.hasDeliverablePending(), true);
    assert.deepEqual(f.exceptions.status().pendingExceptions, [14]);
  });
}
test('BASEPRI leaves a more urgent configurable request deliverable', () => {
  const f = fixture(); pending(f, 14, 0x40); f.cpu.registers.set('basepri', 0x60);
  assert.equal(f.exceptions.hasDeliverablePending(), true);
});
test('an active exception cannot preempt itself', () => {
  const f = fixture(); active(f); pending(f, 14, 0x40);
  assert.equal(f.exceptions.hasDeliverablePending(), false);
});
test('an active exception blocks equal and less urgent candidates', () => {
  for (const priority of [0x40, 0x60]) {
    const f = fixture(); active(f); pending(f, 15, priority);
    assert.equal(f.exceptions.hasDeliverablePending(), false);
  }
});
test('a more urgent candidate can preempt an active exception', () => {
  const f = fixture(); active(f); pending(f, 15, 0x20);
  assert.equal(f.exceptions.hasDeliverablePending(), true);
});
test('disabled external pending source stays queued without becoming deliverable', () => {
  const f = fixture(); pending(f, 16, 0x20, false); const before = snapshot(f);
  assert.equal(f.exceptions.hasDeliverablePending(), false); assert.deepEqual(snapshot(f), before);
});
test('equal-priority external tie is delivered by exception number', () => {
  const f = fixture(); pending(f, 17, 0x40); pending(f, 16, 0x40);
  assert.equal(f.exceptions.hasDeliverablePending(), true);
  assert.equal(f.exceptions.dispatchPending()?.exceptionNumber, 16);
  assert.deepEqual(f.exceptions.status().pendingExceptions, [17]);
});
test('equal-priority system tie selects PendSV before SysTick', () => {
  const f = fixture(); pending(f, 15, 0x80); pending(f, 14, 0x80);
  assert.equal(f.exceptions.dispatchPending()?.exceptionNumber, 14);
  assert.deepEqual(f.exceptions.status().pendingExceptions, [15]);
});
test('priority grouping controls preemption independently of encoded tie order', () => {
  const f = fixture(); f.exceptions.setPriorityGrouping(4); active(f, 14, 0x50); pending(f, 15, 0x40);
  assert.equal(f.exceptions.hasDeliverablePending(), false);
  f.exceptions.setPriorityGrouping(0); assert.equal(f.exceptions.hasDeliverablePending(), true);
});

test('registered ordinary boundary reaches FPU preparation without stopping or writing', () => {
  const f = fixture(), before = snapshot(f); noStop(f); noWrites(f.cpu);
  assert.deepEqual(snapshot(f), before); assert.deepEqual(f.events, ['fpu']);
});
test('deliverable boundary publishes interrupt metadata before stop and leaves pending state intact', () => {
  const f = fixture(); pending(f); const before = snapshot(f); f.cpu.boundary();
  assert.deepEqual(f.events, ['interrupt', 'stop']); assert.equal(f.fpuCalls(), 0); assert.equal(f.returns.length, 0);
  assert.equal(f.cpu.stopped, 1); assert.deepEqual(snapshot(f), before);
  assert.ok(!f.cpu.calls.some(call => call.kind === 'readMemory'));
});
for (const [mask, blocked] of [['basepri', 0x60], ['primask', 1], ['faultmask', 1]]) {
  test(`next boundary observes a completed fake ${mask} lowering and ISB`, () => {
    const f = fixture(); pending(f); f.cpu.registers.set(mask, blocked); noStop(f);
    f.cpu.completeMaskWrite(mask, 0); f.cpu.completeISB();
    assert.deepEqual(f.cpu.completed, [{kind: 'mask-write', name: mask, value: 0}, {kind: 'isb'}]);
    f.cpu.boundary(); assert.deepEqual(f.events, ['fpu', 'interrupt', 'stop']);
    assert.equal(f.cpu.stopped, 1); assert.equal(f.fpuCalls(), 1);
  });
}
test('ICSR software pending and clear writes are observed by the next boundary', () => {
  const f = fixture(); f.exceptions.setPriority(14, 0x80);
  f.exceptions.writeMmio(ICSR, 1 << 28); f.cpu.boundary();
  assert.deepEqual(f.events, ['interrupt', 'stop']);
  f.exceptions.writeMmio(ICSR, 1 << 27); f.cpu.boundary();
  assert.deepEqual(f.events, ['interrupt', 'stop', 'fpu']); assert.equal(f.cpu.stopped, 1);
});
test('NVIC pending enable and disable writes affect the next registered callback', () => {
  const f = fixture(); f.exceptions.writeMmio(IPR, 0x40, 1); f.exceptions.writeMmio(ISPR, 1);
  noStop(f); f.exceptions.writeMmio(ISER, 1); f.cpu.boundary();
  assert.deepEqual(f.events, ['fpu', 'interrupt', 'stop']);
  f.exceptions.writeMmio(ICER, 1); f.cpu.boundary();
  assert.deepEqual(f.events, ['fpu', 'interrupt', 'stop', 'fpu']); assert.equal(f.cpu.stopped, 1);
});
test('NVIC priority write can admit an already pending enabled request', () => {
  const f = fixture(); f.cpu.registers.set('basepri', 0x60);
  f.exceptions.writeMmio(IPR, 0x80, 1); f.exceptions.writeMmio(ISER, 1); f.exceptions.writeMmio(ISPR, 1);
  noStop(f); f.exceptions.writeMmio(IPR, 0x40, 1); f.cpu.boundary();
  assert.deepEqual(f.events, ['fpu', 'interrupt', 'stop']);
});
test('SHPR priority write admits an already pending system request', () => {
  const f = fixture(); pending(f); f.cpu.registers.set('basepri', 0x60); noStop(f);
  f.exceptions.writeMmio(0xe000ed22, 0x40, 1); f.cpu.boundary();
  assert.deepEqual(f.events, ['fpu', 'interrupt', 'stop']);
});
for (const mode of ['masked', 'disabled', 'active']) {
  test(`${mode} pending request does not cause an endless stop at ordinary boundaries`, () => {
    const f = fixture();
    if (mode === 'masked') {pending(f); f.cpu.registers.set('basepri', 0x60);}
    if (mode === 'disabled') pending(f, 16, 0x40, false);
    if (mode === 'active') {active(f); pending(f, 14, 0x40);}
    noStop(f, 4); assert.ok(f.exceptions.status().pendingExceptions.length > 0);
  });
}
test('valid BX raw return token is captured before FPU preparation without applying it', () => {
  const f = fixture(); active(f); f.cpu.put(ADDRESS, BX_LR); const before = snapshot(f); f.cpu.boundary();
  assert.deepEqual(f.events, ['return', 'stop']); assert.equal(f.fpuCalls(), 0); assert.equal(f.cpu.stopped, 1);
  assert.equal(f.returns[0].target, EXC_RETURN.threadMsp); assert.equal(f.returns[0].kind, 'bx');
  assert.deepEqual(snapshot(f), before);
});
test('deliverable pending request takes precedence over a valid return transfer', () => {
  const f = fixture(); active(f); f.cpu.put(ADDRESS, BX_LR); pending(f, 15, 0x20); f.cpu.boundary();
  assert.deepEqual(f.events, ['interrupt', 'stop']); assert.equal(f.returns.length, 0); assert.equal(f.fpuCalls(), 0);
  assert.ok(!f.cpu.calls.some(call => call.kind === 'readMemory'));
});
test('mapped ordinary BX branch remains ordinary and reaches FPU preparation', () => {
  const f = fixture(); active(f); f.cpu.put(ADDRESS, BX_LR); f.cpu.registers.set('lr', ADDRESS + 0x101);
  const before = snapshot(f); noStop(f); assert.deepEqual(snapshot(f), before); assert.deepEqual(f.events, ['fpu']);
});
test('valid non-branch boundary in an active handler remains ordinary', () => {
  const f = fixture(); active(f); noStop(f); assert.deepEqual(f.events, ['fpu']);
});

function expectFailureEndsCalls(f, trigger, pattern = /injected fake API failure/) {
  f.cpu.put(ADDRESS, ISB);
  f.cpu.failWhen = trigger; f.cpu.clearCalls();
  assert.throws(() => f.cpu.boundary(ADDRESS, 4), pattern);
  assert.equal(f.cpu.stopped, 0); assert.equal(f.returns.length, 0);
  assert.equal(f.cpu.calls.length, f.cpu.failureIndex + 1);
}
test('query register API error ends the callback before decoder FPU or stop calls', () => {
  const f = fixture(); pending(f);
  expectFailureEndsCalls(f, call => {
    if (call.kind !== 'readRegister') return false;
    f.cpu.failureIndex = f.cpu.calls.length - 1; return true;
  });
  assert.deepEqual(f.events, []); assert.equal(f.fpuCalls(), 0);
});
test('return capture memory API error ends the callback immediately', () => {
  const f = fixture(); active(f);
  expectFailureEndsCalls(f, call => {
    if (call.kind !== 'readMemory') return false;
    f.cpu.failureIndex = f.cpu.calls.length - 1; return true;
  });
  assert.deepEqual(f.events, []); assert.equal(f.fpuCalls(), 0);
});
test('FPU preparation memory API error ends the ordinary callback immediately', () => {
  const f = fixture();
  expectFailureEndsCalls(f, call => {
    if (call.kind !== 'readMemory') return false;
    f.cpu.failureIndex = f.cpu.calls.length - 1; return true;
  });
  assert.deepEqual(f.events, ['fpu']); assert.equal(f.fpuCalls(), 1);
});
test('backend already unavailable causes zero API action or model calls', () => {
  const f = fixture(); f.cpu.backendFailed = true;
  assert.throws(() => f.cpu.boundary(), /healthy CPU backend/);
  assert.deepEqual(f.cpu.calls, []); assert.deepEqual(f.events, []); assert.equal(f.fpuCalls(), 0);
});
test('fake backend loss reported by an API error permits no later API calls', () => {
  const f = fixture(); pending(f);
  expectFailureEndsCalls(f, call => {
    if (call.kind !== 'readRegister') return false;
    f.cpu.failureIndex = f.cpu.calls.length - 1; f.cpu.backendFailed = true; return true;
  });
  assert.deepEqual(f.events, []); assert.equal(f.fpuCalls(), 0);
});
test('backend loss detected after the pending query prevents decoder actions and stop', () => {
  const f = fixture(), query = f.exceptions.hasDeliverablePending.bind(f.exceptions);
  f.exceptions.hasDeliverablePending = () => {const result = query(); f.cpu.backendFailed = true; return result;};
  assert.throws(() => f.cpu.boundary(), /healthy CPU backend/);
  assert.deepEqual(f.cpu.calls, []); assert.deepEqual(f.events, []); assert.equal(f.fpuCalls(), 0);
});
test('backend loss detected after FPU preparation causes no later API calls', () => {
  const f = fixture(), before = f.exceptions.beforeInstruction.bind(f.exceptions);
  f.exceptions.beforeInstruction = (address, size) => {const result = before(address, size); f.cpu.backendFailed = true; return result;};
  assert.throws(() => f.cpu.boundary(), /healthy CPU backend/);
  assert.deepEqual(f.cpu.calls, []); assert.deepEqual(f.events, ['fpu']); assert.equal(f.cpu.stopped, 0);
});
test('interrupt metadata API error ends before stop', () => {
  const f = fixture(); pending(f);
  const callback = createInstructionBoundaryHandler(f.cpu, f.exceptions, {
    interrupt() {throw new Error('injected fake action failure');},
    exceptionReturn() {assert.fail('unexpected return');},
  });
  assert.throws(() => callback(ADDRESS, 2), /injected fake action failure/);
  assert.equal(f.cpu.stopped, 0); assert.equal(f.fpuCalls(), 0);
  assert.ok(f.cpu.calls.every(call => call.kind === 'readRegister'));
});
test('production session source registers the tested handler factory without constructing a session', () => {
  const source = readFileSync(new URL('../src/lib/emulator/session.ts', import.meta.url), 'utf8');
  assert.match(source, /cpu\.onInstruction\(createInstructionBoundaryHandler\(cpu, this\.exceptions,/);
  assert.match(source, /interrupt:\s*\(\)\s*=>\s*\{this\.yieldForInterrupt = true;\}/);
  assert.match(source, /exceptionReturn:\s*transfer\s*=>\s*\{this\.returnTransfer = transfer;\}/);
  assert.doesNotMatch(source, /interruptRequested/);
});
