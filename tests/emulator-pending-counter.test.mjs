import assert from 'node:assert/strict';
import test from 'node:test';
import {CortexMExceptions} from '../src/lib/emulator/exceptions.ts';
import {CortexMExceptions as Original} from './fixtures/exceptions-before-wfi.ts';

// Scalar registers and owned RAM only. No CPU factory or instruction execution.
const RAM = 0x20000000, PC = RAM + 0x1000, T = 0x01000000;
const ISER = 0xe000e100, ICER = 0xe000e180, ISPR = 0xe000e200, ICPR = 0xe000e280;
const ICSR = 0xe000ed04, SHCSR = 0xe000ed24, STIR = 0xe000ef00;
const CSR = 0xe000e010, RVR = 0xe000e014, CVR = 0xe000e018;
class FakeCPU {
  registers = new Map([['xpsr', T], ['control', 0], ['basepri', 0], ['primask', 0],
    ['faultmask', 0], ['msp', RAM + 0xf000], ['psp', RAM + 0xe000], ['pc', PC], ['lr', PC + 0x101]]);
  memory = new Uint8Array(0x10000);
  memoryMap = [{address: RAM, bytes: 0x10000, permissions: 7}];
  calls = 0;
  failWrite = null;
  bank(name) {return name === 'sp' ? (this.registers.get('xpsr') & 511 ? 'msp' : this.registers.get('control') & 2 ? 'psp' : 'msp') : name;}
  readRegister(name) {this.calls++; return this.registers.get(this.bank(name)) ?? 0;}
  writeRegister(name, value) {this.calls++; if (name === this.failWrite) throw new Error('injected scalar write failure'); this.registers.set(this.bank(name), value >>> 0);}
  offset(address, length) {assert.ok(address >= RAM && address + length <= RAM + this.memory.length); return address - RAM;}
  readMemory(address, length) {this.calls++; const offset = this.offset(address, length); return this.memory.slice(offset, offset + length);}
  writeMemory(address, bytes) {this.calls++; this.memory.set(bytes, this.offset(address, bytes.length));}
  word(address, value) {new DataView(this.memory.buffer).setUint32(this.offset(address, 4), value, true);}
}
function bits(model) {
  const bytes = Array.from(model.pending); // Read independently; never mutate pending storage.
  assert.ok(bytes.every(value => value === 0 || value === 1));
  const list = bytes.flatMap((value, index) => value ? [index] : []);
  assert.equal(model.pendingCount, bytes.reduce((sum, value) => sum + value, 0));
  assert.deepEqual(model.status().pendingExceptions, list);
  return list;
}
function fixture(externalInterrupts = 35) {
  const make = Model => {
    const cpu = new FakeCPU();
    for (let exception = 2; exception < externalInterrupts + 16; exception++) cpu.word(RAM + exception * 4, PC + 1);
    for (let index = 0; index < 13; index++) cpu.registers.set(`r${index}`, index + 1);
    return {cpu, model: new Model(cpu, {vectorTable: RAM, externalInterrupts, priorityBits: 4})};
  };
  const a = make(Original), b = make(CortexMExceptions), transitions = [];
  const set = b.model.setPendingState.bind(b.model);
  b.model.setPendingState = (exception, asserted) => {
    const previous = Array.from(b.model.pending), previousCount = previous.reduce((sum, value) => sum + value, 0);
    set(exception, asserted);
    const expected = previous.slice(); expected[exception] = Number(asserted);
    assert.deepEqual(Array.from(b.model.pending), expected, 'only the requested pending byte changes');
    bits(b.model);
    transitions.push({exception, asserted, before: previousCount, after: b.model.pendingCount});
  };
  const check = expected => {
    assert.deepEqual(bits(a.model), expected); assert.deepEqual(bits(b.model), expected);
    assert.deepEqual(b.model.status(), a.model.status());
    assert.deepEqual([...b.cpu.registers], [...a.cpu.registers]);
    assert.deepEqual(b.cpu.memory, a.cpu.memory);
    for (let bank = 0; bank < Math.ceil(externalInterrupts / 32); bank++) {
      const first = 16 + bank * 32;
      const bitmap = expected.reduce((value, exception) => exception >= first && exception < first + 32 ? (value | (1 << (exception - first))) >>> 0 : value, 0);
      for (const f of [a, b]) {
        assert.equal(f.model.readMmio(ISPR + bank * 4), bitmap);
        assert.equal(f.model.readMmio(ICPR + bank * 4), bitmap);
      }
    }
    const flags = (expected.includes(2) ? 0x80000000 : 0) | (expected.includes(14) ? 0x10000000 : 0) | (expected.includes(15) ? 0x04000000 : 0);
    for (const f of [a, b]) assert.equal((f.model.readMmio(ICSR) & 0x94000000) >>> 0, flags >>> 0);
  };
  const step = (action, expected, errorCode) => {
    const invoke = f => {try {return {value: action(f)};} catch (error) {return {error: {name: error.name, code: error.code, message: error.message}};}};
    const old = invoke(a), next = invoke(b); assert.deepEqual(next, old);
    if (errorCode) assert.equal(next.error?.code ?? next.error?.message, errorCode);
    else assert.equal(next.error, undefined);
    check(expected); return next.value;
  };
  check([]); return {a, b, step, check, transitions};
}

test('coalesced pend/clear, disabled sources and fresh status ownership', () => {
  const f = fixture(), s = f.step;
  s(({model}) => model.pend(14), [14]); s(({model}) => model.pend(14), [14]);
  s(({model}) => model.pend(16), [14, 16]); s(({model}) => model.clearPending(14), [16]);
  s(({model}) => model.clearPending(14), [16]);
  assert.equal(s(({model}) => model.hasDeliverablePending(), [16]), false);
  s(({model}) => model.setExternalEnabled(0, true), [16]);
  assert.equal(s(({model}) => model.hasDeliverablePending(), [16]), true);
  s(({model}) => model.setExternalEnabled(0, false), [16]);
  s(({model}) => model.status().pendingExceptions.splice(0), [16]);
  s(({model}) => model.clearPending(16), []);
  s(({model}) => model.pend(1), [], 'Unimplemented or reserved exception 1.');
});

test('NVIC banks, STIR and ICSR retain exact pending bitmaps', () => {
  const f = fixture(), s = f.step;
  s(({model}) => model.writeMmio(ISPR + 4, 0xffffffff), [48, 49, 50]);
  s(({model}) => model.writeMmio(ISPR + 4, 0xffffffff), [48, 49, 50]);
  s(({model}) => model.writeMmio(STIR, 34), [48, 49, 50]);
  s(({model}) => model.writeMmio(STIR, 35), [48, 49, 50]);
  s(({model}) => model.writeMmio(ISPR, 0x80000001), [16, 47, 48, 49, 50]);
  s(({model}) => model.writeMmio(ISER, 0xffffffff), [16, 47, 48, 49, 50]);
  s(({model}) => model.writeMmio(ICER, 0xffffffff), [16, 47, 48, 49, 50]);
  s(({model}) => model.writeMmio(0xe000e300, 0xffffffff), [16, 47, 48, 49, 50]);
  s(({model}) => model.writeMmio(ICPR + 4, 0xffffffff), [16, 47]);
  s(({model}) => model.writeMmio(ICPR, 0xffffffff), []);
  s(({model}) => model.writeMmio(ICSR, 0x94000000), [2, 14, 15]);
  s(({model}) => model.writeMmio(ICSR, 0x0a000000), [2]);
  s(({model}) => model.clearPending(2), []);
  s(({model}) => model.writeMmio(ICSR, 0x18000000), [], 'unpredictable-icsr');
});

test('SHCSR replaces its four bits and preserves unrelated requests', () => {
  const f = fixture(), s = f.step;
  s(({model}) => model.pend(2), [2]); s(({model}) => model.pend(14), [2, 14]);
  s(({model}) => model.pend(50), [2, 14, 50]);
  s(({model}) => model.writeMmio(SHCSR, 0x0007f000), [2, 4, 5, 6, 11, 14, 50]);
  s(({model}) => model.writeMmio(SHCSR, 0x0007f000), [2, 4, 5, 6, 11, 14, 50]);
  s(({model}) => model.writeMmio(SHCSR, 0x00002000), [2, 4, 14, 50]);
  s(({model}) => model.setSystemEnabled(4, true), [2, 4, 14, 50]);
  s(({model}) => model.writeMmio(SHCSR, 0), [2, 14, 50]);
  assert.equal(f.transitions.filter(row => [4, 5, 6, 11].includes(row.exception)).length, 16);
});

test('held line, active clear and deassert preserve latched request semantics', () => {
  const f = fixture(), s = f.step;
  s(({model}) => model.setExternalEnabled(0, true), []);
  s(({model}) => model.setExternalLine(0, true), [16]);
  s(({model}) => model.clearPending(16), [16]);
  assert.equal(s(({model}) => model.dispatchPending(), []).exceptionNumber, 16);
  s(({model}) => model.clearPending(16), []);
  s(({model}) => model.pend(16), [16]); s(({model}) => model.clearPending(16), [16]);
  s(({model}) => model.setExternalLine(0, false), [16]);
  s(({model}) => model.clearPending(16), []);
  assert.equal(s(({model}) => model.returnFromException(), []).kind, 'return');
});

test('held self and higher-priority tail chains preserve per-transition counts', () => {
  const f = fixture(), s = f.step;
  s(({model}) => model.setExternalEnabled(0, true), []);
  s(({model}) => model.setPriority(16, 0x80), []);
  s(({model}) => model.setExternalLine(0, true), [16]);
  s(({model}) => model.dispatchPending(), []);
  const selfReturnStart = f.transitions.length;
  assert.equal(s(({model}) => model.returnFromException(), []).kind, 'tail-chain');
  assert.deepEqual(f.transitions.slice(selfReturnStart), [
    {exception: 16, asserted: true, before: 0, after: 1},
    {exception: 16, asserted: false, before: 1, after: 0},
  ]);
  s(({model}) => model.setExternalEnabled(1, true), []);
  s(({model}) => model.setPriority(17, 0x20), []);
  s(({model}) => model.pend(17), [17]);
  const higherReturnStart = f.transitions.length;
  assert.equal(s(({model}) => model.returnFromException(), [16]).exceptionNumber, 17);
  assert.deepEqual(f.transitions.slice(higherReturnStart), [
    {exception: 16, asserted: true, before: 1, after: 2},
    {exception: 17, asserted: false, before: 2, after: 1},
  ]);
  s(({model}) => model.setExternalLine(0, false), [16]);
  assert.equal(s(({model}) => model.returnFromException(), []).exceptionNumber, 16);
  s(({model}) => model.returnFromException(), []);
});

test('entry failures preserve pending before consumption', () => {
  const f = fixture(), s = f.step;
  s(({model}) => model.pend(14), [14]);
  s(({cpu}) => cpu.word(RAM + 14 * 4, 0), [14]);
  s(({model}) => model.dispatchPending(), [14], 'non-thumb-vector');
  s(({cpu}) => cpu.word(RAM + 14 * 4, PC + 1), [14]);
  s(({cpu}) => {cpu.failWrite = 'pc';}, [14]);
  s(({model}) => model.dispatchPending(), [14], 'injected scalar write failure');
});

test('held return failure re-pends once before vector/frame validation', () => {
  const f = fixture(), s = f.step;
  s(({model}) => model.setExternalEnabled(0, true), []);
  s(({model}) => model.setPriority(16, 0x80), []);
  s(({model}) => model.setExternalLine(0, true), [16]); s(({model}) => model.dispatchPending(), []);
  s(({cpu}) => cpu.word(RAM + 16 * 4, 0), []);
  s(({model}) => model.returnFromException(), [16], 'non-thumb-vector');
  s(({model}) => model.returnFromException(), [16], 'non-thumb-vector');
  s(({cpu}) => cpu.word(RAM + 16 * 4, PC + 1), [16]);
  s(({model}) => model.returnFromException(), []);
  s(({cpu}) => cpu.registers.set('basepri', 0x80), []);
  s(({cpu}) => cpu.word(cpu.registers.get('msp') + 28, 0), []);
  s(({model}) => model.returnFromException(), [16], 'invalid-thumb-state');
  s(({model}) => model.returnFromException(), [16], 'invalid-thumb-state');
  s(({cpu}) => cpu.word(cpu.registers.get('msp') + 28, T), [16]);
  s(({model}) => model.setExternalLine(0, false), [16]);
  s(({model}) => model.returnFromException(), [16]);
  s(({model}) => model.clearPending(16), []);
});

test('SysTick wraps coalesce and source/control changes preserve pending', () => {
  const f = fixture(), s = f.step;
  s(({model}) => model.writeMmio(RVR, 3), []); s(({model}) => model.writeMmio(CSR, 7), []);
  assert.equal(s(({model}) => model.advanceSysTick(3), []), 0);
  assert.equal(s(({model}) => model.advanceSysTick(1), [15]), 1);
  assert.equal(s(({model}) => model.advanceSysTick(20), [15]), 5);
  s(({model}) => model.readMmio(CSR), [15]); s(({model}) => model.writeMmio(CVR, 0), [15]);
  s(({model}) => model.clearPending(15), []); s(({model}) => model.writeMmio(CSR, 5), []);
  assert.equal(s(({model}) => model.advanceSysTick(8), []), 2);
  assert.equal(f.b.model.status().systick.countFlag, true);
  s(({model}) => model.writeMmio(CSR, 7), []);
  assert.equal(s(({model}) => model.advanceSysTick(8, 'external'), []), 0);
  s(({model}) => model.writeMmio(CSR, 0), []);
  assert.equal(s(({model}) => model.advanceSysTick(8), []), 0);
});

test('masks, active priority and grouping queries leave the count unchanged', () => {
  const f = fixture(), s = f.step;
  s(({model}) => model.setPriority(14, 0x40), []); s(({model}) => model.pend(14), [14]);
  s(({model}) => model.dispatchPending(), []);
  s(({model}) => model.setExternalEnabled(0, true), []); s(({model}) => model.setPriority(16, 0x80), []);
  s(({model}) => model.pend(16), [16]);
  assert.equal(s(({model}) => model.hasDeliverablePending(), [16]), false);
  s(({model}) => model.setPriorityGrouping(7), [16]);
  s(({model}) => model.setPriorityGrouping(0), [16]);
  s(({model}) => model.setPriority(16, 0x20), [16]);
  for (const [name, value] of [['basepri', 0x20], ['primask', 1], ['faultmask', 1]]) {
    s(({cpu}) => cpu.registers.set(name, value), [16]);
    assert.equal(s(({model}) => model.hasDeliverablePending(), [16]), false);
    s(({cpu}) => cpu.registers.set(name, 0), [16]);
    assert.equal(s(({model}) => model.hasDeliverablePending(), [16]), true);
  }
});

test('empty guard reads neither CPU nor pending storage and fresh instances remain separate', () => {
  const f = fixture(), other = fixture();
  const cpu = f.b.cpu, model = f.b.model, pending = model.pending, calls = cpu.calls;
  model.pending = new Proxy(pending, {get() {throw new Error('pending storage scanned by empty query');}});
  try {assert.equal(model.hasDeliverablePending(), false); assert.equal(model.pendingCount, 0); assert.equal(cpu.calls, calls);}
  finally {model.pending = pending;}
  f.step(({model}) => model.pend(14), [14]); other.check([]);
  f.step(({model}) => model.clearPending(14), []); other.check([]);
});
