import assert from 'node:assert/strict';
import test from 'node:test';
import { CortexMExceptions, EXC_RETURN, ExceptionModelError, isExceptionReturn } from '../src/lib/emulator/exceptions.ts';

const VECTOR = 0x80000000;
const MSP = 0x20248000;
const PSP = 0x20249000;
const T = 0x01000000;
const CSR = 0xe000e010;
const RVR = 0xe000e014;
const CVR = 0xe000e018;
const ICSR = 0xe000ed04;
const VTOR = 0xe000ed08;
const AIRCR = 0xe000ed0c;
const CCR = 0xe000ed14;
const SHPR3 = 0xe000ed20;
const FPCCR = 0xe000ef34;

// A banked register/memory fixture, without an instruction engine. Test results
// cover the dispatcher; compiled firmware/Unicorn integration has separate tests.
class CPUFixture {
  registers = new Map([
    ['xpsr', T], ['msp', MSP], ['psp', PSP], ['control', 0],
    ['primask', 0], ['basepri', 0], ['faultmask', 0], ['pc', 0x80001000], ['lr', 0x80000101],
  ]);
  memory = new Map();
  writes = [];
  readRegister(name) {
    if (name === 'sp') name = this.readRegister('xpsr') & 0x1ff ? 'msp' : this.readRegister('control') & 2 ? 'psp' : 'msp';
    if (name === 'ipsr') return this.readRegister('xpsr') & 0x1ff;
    return this.registers.get(name) ?? 0;
  }
  writeRegister(name, value) {
    if (name === 'sp') name = this.readRegister('xpsr') & 0x1ff ? 'msp' : this.readRegister('control') & 2 ? 'psp' : 'msp';
    this.registers.set(name, value >>> 0);
  }
  valid(address, length) {
    return (address >= VECTOR && address + length <= VECTOR + 4096) || (address >= 0x20240000 && address + length <= 0x20250000);
  }
  readMemory(address, length) {
    assert.ok(this.valid(address, length), 'fixture memory read must be mapped');
    return Uint8Array.from({ length }, (_, index) => this.memory.get(address + index) ?? 0);
  }
  loadMemory(address, bytes) {
    assert.ok(this.valid(address, bytes.length), 'fixture memory write must be mapped');
    this.writes.push({ address, length: bytes.length });
    bytes.forEach((byte, index) => this.memory.set(address + index, byte));
  }
  writeWord(address, value) { this.loadMemory(address, words([value])); }
  word(address) { return new DataView(this.readMemory(address, 4).buffer).getUint32(0, true); }
}

function words(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
}
function fixture(options = {}) {
  const cpu = new CPUFixture();
  for (let exception = 2; exception < 256; exception++) cpu.writeWord(VECTOR + exception * 4, 0x80002001 + exception * 8);
  for (let index = 0; index < 13; index++) cpu.writeRegister(`r${index}`, 0x10203040 + index * 0x01010101);
  const exceptions = new CortexMExceptions(cpu, { vectorTable: VECTOR, externalInterrupts: 32, ...options });
  cpu.writes = [];
  return { cpu, exceptions };
}
function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof ExceptionModelError && error.code === code);
}
function enable(exceptions, exception, priority = 0) {
  exceptions.setPriority(exception, priority);
  if (exception >= 16) exceptions.setExternalEnabled(exception - 16, true);
  exceptions.pend(exception);
}

test('external pending survives disable and delivery writes precisely the basic frame', () => {
  const { cpu, exceptions } = fixture();
  const before = ['r0', 'r1', 'r2', 'r3', 'r12', 'lr', 'pc', 'xpsr'].map((name) => cpu.readRegister(name));
  exceptions.pend(16);
  assert.equal(exceptions.dispatchPending(), null);
  assert.equal(exceptions.pendingCount, 1);
  exceptions.setExternalEnabled(0, true);
  const entered = exceptions.dispatchPending();
  assert.equal(entered.kind, 'entry');
  assert.equal(entered.excReturn, EXC_RETURN.threadMsp);
  assert.equal(entered.stackPointer, MSP - 32);
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => cpu.word(MSP - 32 + index * 4)), before);
  assert.deepEqual(cpu.writes, [{ address: MSP - 32, length: 32 }]);
  assert.equal(cpu.readRegister('xpsr'), T | 16);
  assert.equal(cpu.readRegister('lr'), EXC_RETURN.threadMsp);
  assert.equal(exceptions.pendingCount, 0);
  assert.equal(exceptions.readMmio(0xe000e300), 1);
});

test('return restores only the hardware frame and retains handler r4-r11 and masks', () => {
  const { cpu, exceptions } = fixture();
  const oldR0 = cpu.readRegister('r0');
  enable(exceptions, 16);
  exceptions.dispatchPending();
  cpu.writeRegister('r0', 0xdeadbeef);
  cpu.writeRegister('r4', 0xcafebabe);
  cpu.writeRegister('r11', 0x55667788);
  cpu.writeRegister('primask', 1);
  cpu.writeRegister('basepri', 0x50);
  cpu.writeRegister('faultmask', 1);
  const returned = exceptions.returnFromException();
  assert.equal(returned.kind, 'return');
  assert.equal(cpu.readRegister('r0'), oldR0);
  assert.equal(cpu.readRegister('r4'), 0xcafebabe);
  assert.equal(cpu.readRegister('r11'), 0x55667788);
  assert.equal(cpu.readRegister('primask'), 1);
  assert.equal(cpu.readRegister('basepri'), 0x50);
  assert.equal(cpu.readRegister('faultmask'), 0);
  assert.equal(cpu.readRegister('msp'), MSP);
  assert.equal(cpu.readRegister('xpsr'), T);
  assert.equal((cpu.readRegister('pc') & ~1) >>> 0, 0x80001000);
  assert.equal(exceptions.activeException, 0);
});

test('Thread PSP entry stages PSP, runs Handler on MSP and restores CONTROL.SPSEL', () => {
  const { cpu, exceptions } = fixture();
  cpu.writeRegister('control', 3);
  enable(exceptions, 15);
  const entered = exceptions.dispatchPending();
  assert.equal(entered.stack, 'psp');
  assert.equal(entered.excReturn, EXC_RETURN.threadPsp);
  assert.equal(cpu.readRegister('msp'), MSP);
  assert.equal(cpu.readRegister('psp'), PSP - 32);
  assert.equal(cpu.readRegister('sp'), MSP);
  assert.equal(cpu.readRegister('control'), 1);
  exceptions.returnFromException();
  assert.equal(cpu.readRegister('psp'), PSP);
  assert.equal(cpu.readRegister('sp'), PSP);
  assert.equal(cpu.readRegister('control'), 3);
});

test('M7 aligns an initially four-byte-aligned stack and preserves IT/APSR in the frame', () => {
  const { cpu, exceptions } = fixture();
  const oldXpsr = (T | 0xa00f0000 | 0x0600a800) >>> 0;
  cpu.writeRegister('xpsr', oldXpsr);
  cpu.writeRegister('msp', MSP + 4);
  cpu.writeWord(MSP, 0xfacefeed); // Alignment padding has no architected contents.
  exceptions.writeMmio(CCR, 0);
  assert.ok(exceptions.readMmio(CCR) & 0x200);
  enable(exceptions, 15);
  const entered = exceptions.dispatchPending();
  assert.equal(entered.stackPointer % 8, 0);
  assert.equal(cpu.word(entered.stackPointer + 28), (oldXpsr | 0x200) >>> 0);
  assert.equal(cpu.word(MSP), 0xfacefeed);
  assert.equal(cpu.readRegister('xpsr'), ((oldXpsr & 0xf80f0000) | T | 15) >>> 0);
  exceptions.returnFromException();
  assert.equal(cpu.readRegister('xpsr'), oldXpsr);
  assert.equal(cpu.readRegister('msp'), MSP + 4);
});

test('RTOS can replace PSP and select a new task frame before EXC_RETURN', () => {
  const { cpu, exceptions } = fixture();
  cpu.writeRegister('control', 2);
  enable(exceptions, 14, 0xf0);
  exceptions.dispatchPending();
  const replacement = 0x2024a000;
  cpu.loadMemory(replacement, words([1, 2, 3, 4, 12, 0x80003001, 0x80004000, T | 0x80000000]));
  cpu.writeRegister('psp', replacement);
  cpu.writeRegister('r7', 99); // RTOS software restores its callee-saved context.
  exceptions.returnFromException(EXC_RETURN.threadPsp);
  assert.equal(cpu.readRegister('psp'), replacement + 32);
  assert.equal(cpu.readRegister('r0'), 1);
  assert.equal(cpu.readRegister('r12'), 12);
  assert.equal(cpu.readRegister('lr'), 0x80003001);
  assert.equal((cpu.readRegister('pc') & ~1) >>> 0, 0x80004000);
  assert.equal(cpu.readRegister('r7'), 99);
});

test('crafted frame restoration uses the architecture alignment OR, not addition', () => {
  const { cpu, exceptions } = fixture();
  enable(exceptions, 15);
  exceptions.dispatchPending();
  const replacement = 0x2024a004;
  cpu.loadMemory(replacement, words([0, 0, 0, 0, 0, 0, 0x80004000, T | 0x200]));
  cpu.writeRegister('psp', replacement);
  exceptions.returnFromException(EXC_RETURN.threadPsp);
  assert.equal(cpu.readRegister('psp'), replacement + 32);
});

test('higher group priority nests; returning Handler restores the preempted frame', () => {
  const { cpu, exceptions } = fixture();
  enable(exceptions, 16, 0x80);
  exceptions.dispatchPending();
  cpu.writeRegister('r0', 1234);
  cpu.writeRegister('pc', 0x80002400);
  enable(exceptions, 17, 0x20);
  const entered = exceptions.dispatchPending();
  assert.equal(entered.excReturn, EXC_RETURN.handlerMsp);
  assert.deepEqual(exceptions.status().activeExceptions, [16, 17]);
  assert.equal(cpu.readRegister('msp'), MSP - 64);
  assert.equal(exceptions.readMmio(0xe000e300), 3);
  exceptions.returnFromException();
  assert.equal(exceptions.activeException, 16);
  assert.equal(cpu.readRegister('r0'), 1234);
  assert.equal((cpu.readRegister('pc') & ~1) >>> 0, 0x80002400);
  assert.equal(cpu.readRegister('lr'), EXC_RETURN.threadMsp);
  exceptions.returnFromException();
  assert.equal(cpu.readRegister('msp'), MSP);
});

test('subpriority chooses a pending winner but cannot preempt the same priority group', () => {
  const { exceptions } = fixture();
  exceptions.setPriorityGrouping(5); // Two preempt bits, two implemented subpriority bits.
  enable(exceptions, 16, 0x70);
  exceptions.dispatchPending();
  enable(exceptions, 17, 0x40);
  assert.equal(exceptions.dispatchPending(), null);
  const chained = exceptions.returnFromException();
  assert.equal(chained.kind, 'tail-chain');
  assert.equal(chained.exceptionNumber, 17);
  exceptions.returnFromException();
  enable(exceptions, 17, 0x50);
  enable(exceptions, 18, 0x40);
  assert.equal(exceptions.dispatchPending().exceptionNumber, 18);
});

test('equal priorities use the lower exception number, including SysTick before IRQ0', () => {
  const { exceptions } = fixture();
  enable(exceptions, 17);
  enable(exceptions, 16);
  enable(exceptions, 15);
  assert.equal(exceptions.dispatchPending().exceptionNumber, 15);
});

test('BASEPRI uses group priority and zero disables the threshold', () => {
  const { cpu, exceptions } = fixture();
  exceptions.setPriorityGrouping(5);
  cpu.writeRegister('basepri', 0x70); // Entire group 0x40 is masked.
  enable(exceptions, 16, 0x40);
  assert.equal(exceptions.dispatchPending(), null);
  enable(exceptions, 17, 0x30);
  assert.equal(exceptions.dispatchPending().exceptionNumber, 17);
  exceptions.returnFromException();
  cpu.writeRegister('basepri', 0);
  assert.equal(exceptions.dispatchPending().exceptionNumber, 16);
});

test('PRIMASK allows HardFault and NMI; FAULTMASK allows NMI only', () => {
  const { cpu, exceptions } = fixture();
  cpu.writeRegister('primask', 1);
  enable(exceptions, 15);
  assert.equal(exceptions.dispatchPending(), null);
  exceptions.pend(3);
  assert.equal(exceptions.dispatchPending().exceptionNumber, 3);
  cpu.writeRegister('faultmask', 1);
  exceptions.pend(2);
  assert.equal(exceptions.dispatchPending().exceptionNumber, 2);
  exceptions.returnFromException();
  assert.equal(cpu.readRegister('faultmask'), 1); // NMI does not clear it.
  assert.equal(exceptions.activeException, 3);
  exceptions.returnFromException();
  assert.equal(cpu.readRegister('faultmask'), 0);
  assert.equal(exceptions.pendingCount, 1);
  const other = fixture();
  other.cpu.writeRegister('faultmask', 1);
  other.exceptions.pend(3);
  assert.equal(other.exceptions.dispatchPending(), null);
});

test('tail chain preserves the frame and handler register values until final unstack', () => {
  const { cpu, exceptions } = fixture();
  const oldR0 = cpu.readRegister('r0');
  enable(exceptions, 16, 0x20);
  exceptions.dispatchPending();
  const originalFrame = cpu.readMemory(MSP - 32, 32);
  cpu.writeRegister('r0', 0x12345678);
  enable(exceptions, 17, 0x80);
  assert.equal(exceptions.dispatchPending(), null);
  const chained = exceptions.returnFromException();
  assert.equal(chained.kind, 'tail-chain');
  assert.equal(cpu.readRegister('r0'), 0x12345678);
  assert.equal(cpu.readRegister('msp'), MSP - 32);
  assert.equal(cpu.writes.length, 1);
  assert.deepEqual(cpu.readMemory(MSP - 32, 32), originalFrame);
  exceptions.returnFromException();
  assert.equal(cpu.readRegister('r0'), oldR0);
  assert.equal(cpu.readRegister('msp'), MSP);
  assert.equal(exceptions.status().tailChains, 1);
});

test('a held external level re-pends; deassertion permits final return', () => {
  const { exceptions } = fixture();
  exceptions.setExternalEnabled(0, true);
  exceptions.setExternalLine(0, true);
  exceptions.clearPending(16);
  assert.equal(exceptions.pendingCount, 1);
  exceptions.dispatchPending();
  exceptions.clearPending(16);
  assert.equal(exceptions.pendingCount, 0);
  assert.equal(exceptions.returnFromException().kind, 'tail-chain');
  exceptions.setExternalLine(0, false);
  assert.equal(exceptions.returnFromException().kind, 'return');
});

test('a rising level during an active IRQ remains active and pending while held', () => {
  const { exceptions } = fixture();
  enable(exceptions, 16);
  exceptions.dispatchPending();
  exceptions.setExternalLine(0, true);
  assert.equal(exceptions.pendingCount, 1);
  exceptions.clearPending(16);
  assert.equal(exceptions.pendingCount, 1);
  exceptions.setExternalLine(0, false);
  exceptions.clearPending(16);
  assert.equal(exceptions.pendingCount, 0);
  assert.equal(exceptions.returnFromException().kind, 'return');
});

test('SysTick reload is a separate edge; ticks and wrap count are deterministic', () => {
  const { exceptions } = fixture();
  exceptions.writeMmio(RVR, 3);
  exceptions.writeMmio(CVR, 123);
  exceptions.writeMmio(CSR, 7);
  assert.equal(exceptions.advanceSysTick(0), 0);
  assert.equal(exceptions.advanceSysTick(1), 0);
  assert.equal(exceptions.readMmio(CVR), 3);
  assert.equal(exceptions.advanceSysTick(2), 0);
  assert.equal(exceptions.readMmio(CVR), 1);
  assert.equal(exceptions.advanceSysTick(1), 1);
  assert.equal(exceptions.readMmio(CVR), 0);
  assert.equal(exceptions.readMmio(CSR), 0x10007);
  assert.equal(exceptions.readMmio(CSR), 7);
  assert.equal(exceptions.pendingCount, 1);
  assert.equal(exceptions.advanceSysTick(40), 10);
  assert.equal(exceptions.pendingCount, 1); // Multiple wraps coalesce.
  assert.equal(exceptions.status().systick.sourceTicks, 44);
  assert.match(exceptions.status().systick.timing, /no physical/);
});

test('SysTick zero reload has no event; CVR clears COUNTFLAG independently of pending', () => {
  const { exceptions } = fixture();
  exceptions.writeMmio(CSR, 7);
  assert.equal(exceptions.advanceSysTick(10000), 0);
  assert.equal(exceptions.readMmio(CSR), 7);
  exceptions.writeMmio(RVR, 0x1000001);
  assert.equal(exceptions.readMmio(RVR), 1);
  assert.equal(exceptions.advanceSysTick(2), 1);
  exceptions.writeMmio(CVR, 0);
  assert.equal(exceptions.readMmio(CSR), 7);
  assert.equal(exceptions.pendingCount, 1);
  exceptions.writeMmio(ICSR, 1 << 25);
  assert.equal(exceptions.pendingCount, 0);
});

test('SysTick gates interrupt requests, enable, and selected clock independently', () => {
  const { exceptions } = fixture();
  exceptions.writeMmio(RVR, 1);
  exceptions.writeMmio(CSR, 5);
  assert.equal(exceptions.advanceSysTick(2), 1);
  assert.equal(exceptions.pendingCount, 0);
  exceptions.writeMmio(CSR, 3); // External source.
  assert.equal(exceptions.advanceSysTick(2), 0);
  assert.equal(exceptions.advanceSysTick(2, 'external'), 1);
  assert.equal(exceptions.pendingCount, 1);
  exceptions.writeMmio(CSR, 0);
  assert.equal(exceptions.advanceSysTick(1000, 'external'), 0);
  const noExternal = fixture({ systickCalibration: 0xc0000000 });
  noExternal.exceptions.writeMmio(CSR, 3);
  assert.equal(noExternal.exceptions.readMmio(CSR), 7);
});

test('bulk SysTick advancement matches independently stepped edges across reload changes', () => {
  const { exceptions } = fixture();
  exceptions.writeMmio(CSR, 7);
  let seed = 0x12345678;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  let referenceCurrent = 0;
  let reload = 0;
  let totalWraps = 0;
  for (let batch = 0; batch < 200; batch++) {
    if (batch % 3 === 0) {
      reload = random() % 43;
      exceptions.writeMmio(RVR, reload);
    }
    if (batch % 7 === 0) {
      referenceCurrent = 0;
      exceptions.writeMmio(CVR, 0);
    }
    const ticks = random() % 201;
    let wraps = 0;
    // Reference follows individual input edges, including the zero-to-reload edge.
    for (let edge = 0; edge < ticks; edge++) {
      if (referenceCurrent === 0) referenceCurrent = reload;
      else {
        referenceCurrent--;
        if (referenceCurrent === 0) wraps++;
      }
    }
    assert.equal(exceptions.advanceSysTick(ticks), wraps, `batch ${batch} wraps`);
    assert.equal(exceptions.readMmio(CVR), referenceCurrent, `batch ${batch} current`);
    totalWraps += wraps;
  }
  assert.ok(totalWraps > 1000);
});

test('NVIC set/clear aliases preserve other bits; priority bytes mask unimplemented bits', () => {
  const { exceptions } = fixture({ externalInterrupts: 35 });
  exceptions.writeMmio(0xe000e100, 3);
  exceptions.writeMmio(0xe000e180, 1);
  assert.equal(exceptions.readMmio(0xe000e100), 2);
  assert.equal(exceptions.readMmio(0xe000e180), 2);
  exceptions.writeMmio(0xe000e200, 3);
  exceptions.writeMmio(0xe000e280, 2);
  assert.equal(exceptions.readMmio(0xe000e200), 1);
  exceptions.writeMmio(0xe000e104, 0xffffffff);
  assert.equal(exceptions.readMmio(0xe000e104), 7);
  assert.equal(exceptions.readMmio(0xe000e008), undefined);
  exceptions.writeMmio(0xe000e400, 0xf18e2b0f);
  assert.equal(exceptions.readMmio(0xe000e400), 0xf0802000);
  exceptions.writeMmio(0xe000e401, 0xab, 1);
  assert.equal(exceptions.readMmio(0xe000e401, 1), 0xa0);
  exceptions.writeMmio(SHPR3, 0xfeabcd12);
  assert.equal(exceptions.readMmio(SHPR3), 0xf0a00010);
  exceptions.writeMmio(0xe000ef00, 34);
  assert.equal(exceptions.readMmio(0xe000e204), 4);
  assert.equal(exceptions.readMmio(0xe000e004), 1);
});

test('AIRCR needs its key; VTOR masks implementation alignment; ICSR reports and clears pending', () => {
  const { exceptions } = fixture({ externalInterrupts: 160 });
  exceptions.writeMmio(AIRCR, 5 << 8);
  assert.equal(exceptions.readMmio(AIRCR), 0xfa050000);
  exceptions.writeMmio(AIRCR, 0x05fa0500);
  assert.equal(exceptions.readMmio(AIRCR), 0xfa050500);
  exceptions.writeMmio(VTOR, VECTOR + 0x3ff);
  assert.equal(exceptions.readMmio(VTOR), VECTOR);
  exceptions.writeMmio(ICSR, (1 << 26) | (1 << 28));
  assert.equal((exceptions.readMmio(ICSR) >>> 12) & 0x1ff, 14);
  assert.ok(exceptions.readMmio(ICSR) & (1 << 11));
  exceptions.writeMmio(ICSR, (1 << 25) | (1 << 27));
  assert.equal(exceptions.pendingCount, 0);
  assert.equal(exceptions.readMmio(0xe000ef00), 0);
  expectCode(() => exceptions.writeMmio(AIRCR, 0x05fa0004), 'unmodeled-reset');
});

test('M7 VECTPENDING reflects BASEPRI/FAULTMASK but ignores PRIMASK', () => {
  const { cpu, exceptions } = fixture();
  enable(exceptions, 16, 0x80);
  cpu.writeRegister('primask', 1);
  assert.equal((exceptions.readMmio(ICSR) >>> 12) & 0x1ff, 16);
  cpu.writeRegister('basepri', 0x80);
  assert.equal((exceptions.readMmio(ICSR) >>> 12) & 0x1ff, 0);
  exceptions.pend(3);
  assert.equal((exceptions.readMmio(ICSR) >>> 12) & 0x1ff, 3);
  cpu.writeRegister('faultmask', 1);
  assert.equal((exceptions.readMmio(ICSR) >>> 12) & 0x1ff, 0);
  exceptions.pend(2);
  assert.equal((exceptions.readMmio(ICSR) >>> 12) & 0x1ff, 2);
  expectCode(() => exceptions.writeMmio(ICSR, (1 << 25) | (1 << 26)), 'unpredictable-icsr');
});

test('configurable fault enables and SHCSR active/pending state remain distinct', () => {
  const { exceptions } = fixture();
  exceptions.pend(4);
  assert.equal(exceptions.dispatchPending(), null);
  exceptions.writeMmio(0xe000ed24, (1 << 16) | (1 << 13));
  assert.equal(exceptions.readMmio(0xe000ed24), (1 << 16) | (1 << 13));
  exceptions.dispatchPending();
  assert.equal(exceptions.readMmio(0xe000ed24), (1 << 16) | 1);
  exceptions.returnFromException();
  assert.equal(exceptions.readMmio(0xe000ed24), 1 << 16);
});

test('invalid vector stops before staging a frame or consuming pending state', () => {
  const { cpu, exceptions } = fixture();
  cpu.writeWord(VECTOR + 15 * 4, 0x80002000);
  cpu.writes = [];
  enable(exceptions, 15);
  expectCode(() => exceptions.dispatchPending(), 'non-thumb-vector');
  assert.equal(cpu.readRegister('msp'), MSP);
  assert.deepEqual(cpu.writes, []);
  assert.equal(exceptions.pendingCount, 1);
  assert.equal(exceptions.activeException, 0);
});

test('invalid return tokens are strict; fetch normalization is explicit', () => {
  const { exceptions } = fixture();
  enable(exceptions, 15);
  exceptions.dispatchPending();
  expectCode(() => exceptions.returnFromException(0xfffffff8), 'invalid-exc-return');
  expectCode(() => exceptions.returnFromException(0xfffffff5), 'invalid-exc-return');
  expectCode(() => exceptions.returnFromException(0xf0000001), 'invalid-exc-return');
  assert.equal(exceptions.activeException, 15);
  assert.equal(exceptions.returnFromException(0xfffffff8, { fromFetch: true }).kind, 'return');
  assert.ok(isExceptionReturn(0xfffffff8));
  assert.ok(isExceptionReturn(0xf0000001));
  assert.equal(isExceptionReturn(0x80002001), false);
});

test('archived integer-only option still rejects extended, active and lazy FPU frames', () => {
  for (const control of [4, 6]) {
    const { cpu, exceptions } = fixture({ floatingPoint: false });
    cpu.writeRegister('control', control);
    enable(exceptions, 15);
    expectCode(() => exceptions.dispatchPending(), 'fpu-frame');
    assert.deepEqual(cpu.writes, []);
  }
  const lazy = fixture({ floatingPoint: false });
  lazy.exceptions.writeMmio(FPCCR, 0xc0000001);
  enable(lazy.exceptions, 15);
  expectCode(() => lazy.exceptions.dispatchPending(), 'fpu-frame');
  const returning = fixture({ floatingPoint: false });
  enable(returning.exceptions, 15);
  returning.exceptions.dispatchPending();
  for (const token of [0xffffffe1, 0xffffffe9, 0xffffffed]) expectCode(() => returning.exceptions.returnFromException(token), 'fpu-frame');
});

test('invalid stacked state/context and unsupported non-base Thread return remain failures', () => {
  const { cpu, exceptions } = fixture();
  enable(exceptions, 16, 0x80);
  exceptions.dispatchPending();
  enable(exceptions, 17, 0x20);
  exceptions.dispatchPending();
  expectCode(() => exceptions.returnFromException(EXC_RETURN.threadMsp), 'invalid-return-context');
  exceptions.writeMmio(CCR, 1);
  expectCode(() => exceptions.returnFromException(EXC_RETURN.threadMsp), 'non-base-thread-return');
  const thread = fixture();
  expectCode(() => thread.exceptions.returnFromException(EXC_RETURN.threadMsp), 'return-in-thread');
  enable(thread.exceptions, 15);
  thread.exceptions.dispatchPending();
  thread.cpu.writeWord(MSP - 4, 0);
  expectCode(() => thread.exceptions.returnFromException(), 'invalid-thumb-state');
  thread.cpu.writeWord(MSP - 4, T | 16);
  expectCode(() => thread.exceptions.returnFromException(), 'invalid-return-context');
  cpu.writeRegister('xpsr', T | 18);
  expectCode(() => exceptions.dispatchPending(), 'untracked-handler');
});

test('reserved/unimplemented IDs, unsupported widths and unprivileged core writes are rejected', () => {
  const { cpu, exceptions } = fixture();
  assert.throws(() => exceptions.pend(7), RangeError);
  assert.throws(() => exceptions.pend(48), RangeError);
  assert.throws(() => exceptions.setExternalEnabled(-1, true), RangeError);
  assert.throws(() => exceptions.setPriority(2, 0), RangeError);
  assert.throws(() => exceptions.setPriorityGrouping(8), RangeError);
  assert.throws(() => exceptions.advanceSysTick(-1), RangeError);
  expectCode(() => exceptions.readMmio(0xe000e101), 'invalid-mmio-width');
  expectCode(() => exceptions.readMmio(CSR, 1), 'invalid-mmio-width');
  expectCode(() => exceptions.writeMmio(0xe000e401, 0, 2), 'invalid-mmio-width');
  assert.equal(exceptions.writeMmio(0x40000000, 0), false);
  exceptions.writeMmio(CCR, 2);
  cpu.writeRegister('control', 1);
  expectCode(() => exceptions.writeMmio(0xe000e100, 1), 'unprivileged-mmio');
  assert.equal(exceptions.writeMmio(0xe000ef00, 0), true);
  assert.equal(exceptions.pendingCount, 1);
});

test('CPU writeMemory alternative and constructor option validation', () => {
  const cpu = new CPUFixture();
  cpu.writeMemory = cpu.loadMemory.bind(cpu);
  cpu.loadMemory = undefined;
  const exceptions = new CortexMExceptions(cpu, { externalInterrupts: 1 });
  assert.equal(exceptions.vectorTableAlignment, 128);
  for (const options of [{ externalInterrupts: 0 }, { externalInterrupts: 241 }, { priorityBits: 0 }, { priorityBits: 9 }, { vectorTableAlignment: 300 }, { vectorTableAlignment: 128 }]) {
    assert.throws(() => new CortexMExceptions(cpu, options), RangeError);
  }
});

test('real Cortex-M7 WASM handler edits its frame and callee-saved state remains software-owned', async () => {
  const { createCPU } = await import('../src/lib/emulator/cpu.ts');
  const cpu = await createCPU({ read: () => undefined, write() {}, tick() {} });
  try {
    assert.equal(cpu.cpuModel, 10, 'The engine must read back Cortex-M7.');
    cpu.loadMemory(VECTOR + 15 * 4, words([0x80002001]));
    // MOVS r0,#42; MOVS r4,#7; STR r0,[sp]; BX lr.
    // The store intentionally changes the stacked r0, as a real handler can.
    cpu.loadMemory(0x80002000, new Uint8Array([0x2a, 0x20, 0x07, 0x24, 0x00, 0x90, 0x70, 0x47]));
    cpu.loadMemory(0x80001000, new Uint8Array([0x01, 0x35, 0xfe, 0xe7]));
    cpu.writeRegister('xpsr', T);
    cpu.writeRegister('control', 0);
    cpu.writeRegister('msp', MSP);
    cpu.writeRegister('r0', 3);
    cpu.writeRegister('r4', 4);
    cpu.writeRegister('r5', 0);
    cpu.writeRegister('pc', 0x80001001);
    const exceptions = new CortexMExceptions(cpu, { vectorTable: VECTOR, externalInterrupts: 32 });
    exceptions.pend(15);
    exceptions.dispatchPending();
    assert.equal(cpu.readRegister('ipsr'), 15);
    const ran = cpu.step(3);
    assert.equal(ran.reason, 'budget', ran.fault);
    assert.equal(ran.pc, 0x80002006);
    assert.equal(cpu.readRegister('msp'), MSP - 32);
    exceptions.returnFromException();
    assert.equal(cpu.readRegister('r0'), 42, 'Return consumes the edited guest frame.');
    assert.equal(cpu.readRegister('r4'), 7, 'Hardware does not restore r4.');
    assert.equal(cpu.readRegister('msp'), MSP);
    assert.equal(cpu.readRegister('ipsr'), 0);
    const resumed = cpu.step(1);
    assert.equal(resumed.reason, 'budget', resumed.fault);
    assert.equal(cpu.readRegister('r5'), 1, 'Instruction execution resumes at the interrupted PC.');
  } finally { cpu.close(); }
});

test('real M7 VFP execution sets FPCA and the archived integer-only option refuses it', async () => {
  const { createCPU } = await import('../src/lib/emulator/cpu.ts');
  const cpu = await createCPU({ read: () => undefined, write() {}, tick() {} });
  try {
    // Same assembled VMOV/VADD fixture as tools/test-emulator-cpu.mjs, including
    // its terminating loop. Leaving the translation block open is a separate
    // preserved failed fixture in tools/emulator-evidence/exception-fpu-boundary.json.
    cpu.loadMemory(0x80001000, new Uint8Array([
      0x00, 0xee, 0x10, 0x0a, 0x00, 0xee, 0x90, 0x1a,
      0x30, 0xee, 0x20, 0x1a, 0x11, 0xee, 0x10, 0x2a, 0x00, 0xbf, 0xfe, 0xe7,
    ]));
    cpu.writeRegister('r0', 0x3fc00000);
    cpu.writeRegister('r1', 0x40200000);
    cpu.writeRegister('control', 0);
    cpu.writeRegister('xpsr', T);
    cpu.writeRegister('msp', MSP);
    const result = cpu.step(4, { entry: 0x80001001 });
    assert.equal(result.reason, 'budget', result.fault);
    assert.equal(cpu.readRegister('control'), 4);
    assert.equal(cpu.readRegister('r2'), 0x40800000);
    const exceptions = new CortexMExceptions(cpu, { vectorTable: VECTOR, externalInterrupts: 32, floatingPoint: false });
    exceptions.pend(15);
    expectCode(() => exceptions.dispatchPending(), 'fpu-frame');
    assert.equal(cpu.readRegister('msp'), MSP);
    assert.equal(exceptions.pendingCount, 1);
  } finally { cpu.close(); }
});

test('real M7 POP to EXC_RETURN exposes a fetch token after software stack restoration', async () => {
  const { createCPU } = await import('../src/lib/emulator/cpu.ts');
  const cpu = await createCPU({ read: () => undefined, write() {}, tick() {} });
  try {
    cpu.loadMemory(VECTOR + 15 * 4, words([0x80002001]));
    cpu.loadMemory(0x80001000, new Uint8Array([0x01, 0x35, 0xfe, 0xe7]));
    // PUSH {r4,lr}; MOVS r4,#7; POP {r4,pc}; B self.
    cpu.loadMemory(0x80002000, new Uint8Array([0x10, 0xb5, 0x07, 0x24, 0x10, 0xbd, 0xfe, 0xe7]));
    cpu.writeRegister('control', 0);
    cpu.writeRegister('xpsr', T);
    cpu.writeRegister('msp', MSP);
    cpu.writeRegister('r4', 4);
    cpu.writeRegister('r5', 0);
    cpu.writeRegister('pc', 0x80001001);
    const exceptions = new CortexMExceptions(cpu, { vectorTable: VECTOR, externalInterrupts: 32 });
    exceptions.pend(15);
    exceptions.dispatchPending();
    const result = cpu.step(3);
    assert.equal(result.instructions, 3);
    assert.equal(result.reason, 'fault');
    assert.equal(result.pc, 0xfffffff8);
    assert.match(result.fault, /UC_ERR_EXCEPTION/);
    assert.equal(cpu.readRegister('msp'), MSP - 32, 'POP completed its software stack adjustment.');
    assert.equal(cpu.readRegister('r4'), 4, 'POP restored the software-saved r4.');
    assert.equal(cpu.readRegister('ipsr'), 15, 'The engine did not consume the basic frame.');
    const restored = exceptions.returnFromException(result.pc, { fromFetch: true });
    assert.equal(restored.excReturn, EXC_RETURN.threadMsp);
    assert.equal(cpu.readRegister('msp'), MSP);
    assert.equal(cpu.readRegister('ipsr'), 0);
    assert.equal(cpu.step(1).reason, 'budget');
    assert.equal(cpu.readRegister('r5'), 1);
  } finally { cpu.close(); }
});
