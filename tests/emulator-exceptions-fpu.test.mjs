import assert from 'node:assert/strict';
import test from 'node:test';
import { CortexMExceptions, EXC_RETURN, ExceptionModelError } from '../src/lib/emulator/exceptions.ts';

const VECTOR = 0x80000000, MSP = 0x20248000, PSP = 0x20249000, T = 0x01000000;
const CPACR = 0xe000ed88, FPCCR = 0xe000ef34, FPCAR = 0xe000ef38, FPDSCR = 0xe000ef3c;
const wordBytes = (values) => {
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
};
const word = (cpu, address) => new DataView(cpu.readMemory(address, 4).buffer).getUint32(0, true);
const expectCode = (fn, code) => assert.throws(fn, (error) => error instanceof ExceptionModelError && error.code === code);

// Architectural register/memory model only. Executed M7 tests follow separately.
class Registers {
  registers = new Map(Object.entries({ xpsr: T, control: 0, msp: MSP, psp: PSP,
    primask: 0, basepri: 0, faultmask: 0, pc: 0x80001000, lr: 0x80001101, fpscr: 0x01000011 }));
  memory = new Map();
  writes = [];
  reads = [];
  rejectWrite = false;
  readRegister(name) {
    if (name === 'sp') name = this.readRegister('xpsr') & 511 ? 'msp' : this.readRegister('control') & 2 ? 'psp' : 'msp';
    return this.registers.get(name) ?? 0;
  }
  writeRegister(name, value) {
    if (name === 'sp') name = this.readRegister('xpsr') & 511 ? 'msp' : this.readRegister('control') & 2 ? 'psp' : 'msp';
    this.registers.set(name, value >>> 0);
  }
  readMemory(address, length) {
    this.reads.push({ address, length });
    return Uint8Array.from({ length }, (_, index) => this.memory.get(address + index) ?? 0xa5);
  }
  loadMemory(address, bytes) {
    if (this.rejectWrite) throw new Error('fixture memory-store failure');
    this.writes.push({ address, length: bytes.length });
    bytes.forEach((byte, index) => this.memory.set(address + index, byte));
  }
}
function fixture({ lazy = true, automatic = true, control = 4 } = {}) {
  const cpu = new Registers();
  for (let index = 0; index < 32; index++) cpu.writeRegister(`s${index}`, 0x3f800000 + index);
  const exceptions = new CortexMExceptions(cpu, { vectorTable: VECTOR, externalInterrupts: 32 });
  // ASPEN/LSPEN changes precede enabling CP10/11 and activating the context.
  exceptions.writeMmio(FPCCR, (automatic ? 0x80000000 : 0) | (lazy ? 0x40000000 : 0));
  exceptions.writeMmio(CPACR, 0x00f00000);
  cpu.writeRegister('control', control);
  for (const exception of [15, 16, 17]) cpu.loadMemory(VECTOR + exception * 4, wordBytes([0x80002001 + exception * 16]));
  cpu.writes = [];
  return { cpu, exceptions };
}
function pend(exceptions, exception, priority) {
  exceptions.setPriority(exception, priority);
  if (exception >= 16) exceptions.setExternalEnabled(exception - 16, true);
  exceptions.pend(exception);
}

test('eager extended frame stores core then S0-S15/FPSCR, preserving reserved words and S16-S31', () => {
  const { cpu, exceptions } = fixture({ lazy: false });
  cpu.writeRegister('msp', MSP + 4);
  pend(exceptions, 15, 0x80);
  const entry = exceptions.dispatchPending();
  assert.equal(entry.excReturn, EXC_RETURN.threadMspExtended);
  assert.equal(entry.frameBytes, 104);
  assert.equal(entry.stackPointer, MSP - 104);
  assert.equal(cpu.readRegister('control'), 0);
  assert.equal(word(cpu, entry.stackPointer + 28), T | 0x200);
  for (let index = 0; index < 16; index++) assert.equal(word(cpu, entry.stackPointer + 32 + index * 4), 0x3f800000 + index);
  assert.equal(word(cpu, entry.stackPointer + 96), 0x01000011);
  assert.equal(word(cpu, entry.stackPointer + 100), 0xa5a5a5a5);
  assert.equal(word(cpu, entry.stackPointer + 104), 0xa5a5a5a5);
  assert.deepEqual(cpu.writes, [{ address: MSP - 104, length: 32 }, { address: MSP - 72, length: 68 }]);
  cpu.writeRegister('s0', 123); cpu.writeRegister('s16', 456);
  cpu.loadMemory(entry.stackPointer + 32, wordBytes([789]));
  const returned = exceptions.returnFromException();
  assert.equal(returned.frameType, 'extended');
  assert.equal(cpu.readRegister('s0'), 789, 'Return consumes the guest FP frame, including edits.');
  assert.equal(cpu.readRegister('s16'), 456, 'Upper FP registers remain software-owned.');
  assert.equal(cpu.readRegister('fpscr'), 0x01000011);
  assert.equal(cpu.readRegister('control'), 4);
  assert.equal(cpu.readRegister('msp'), MSP + 4);
});

test('lazy entry reserves the FP extension without storing it; unused return performs no FP reads', () => {
  const { cpu, exceptions } = fixture({ control: 6 });
  pend(exceptions, 15, 0x80);
  const entry = exceptions.dispatchPending();
  assert.equal(entry.excReturn, EXC_RETURN.threadPspExtended);
  assert.equal(entry.stackPointer, PSP - 104);
  assert.deepEqual(cpu.writes, [{ address: PSP - 104, length: 32 }]);
  assert.equal(exceptions.readMmio(FPCAR), PSP - 72);
  assert.equal(exceptions.readMmio(FPCCR) & 0x1b, 0x19); // THREAD, HFRDY, LSPACT; privileged origin.
  cpu.reads = [];
  exceptions.returnFromException();
  assert.deepEqual(cpu.reads, [{ address: PSP - 104, length: 32 }]);
  assert.equal(cpu.readRegister('s0'), 0x3f800000);
  assert.equal(cpu.readRegister('psp'), PSP);
  assert.equal(cpu.readRegister('control'), 6);
  assert.equal(exceptions.readMmio(FPCCR) & 1, 0);
  assert.equal(exceptions.status().floatingPoint.lazyReturns, 1);
});

test('lazy preservation saves the interrupted low FP state once and extended return restores it', () => {
  const { cpu, exceptions } = fixture();
  pend(exceptions, 15, 0x80); const entry = exceptions.dispatchPending();
  assert.equal(exceptions.preserveLazyState(), true);
  assert.equal(exceptions.preserveLazyState(), false);
  assert.equal(word(cpu, entry.stackPointer + 32), 0x3f800000);
  assert.equal(word(cpu, entry.stackPointer + 96), 0x01000011);
  assert.equal(word(cpu, entry.stackPointer + 100), 0xa5a5a5a5);
  cpu.writeRegister('s0', 0x40200000);
  exceptions.returnFromException();
  assert.equal(cpu.readRegister('s0'), 0x3f800000);
  assert.equal(exceptions.status().floatingPoint.lazySaves, 1);
  assert.equal(exceptions.status().floatingPoint.restoredFrames, 1);
});

test('nested basic handlers preserve the outer lazy address and LSPACT through return', () => {
  const { cpu, exceptions } = fixture();
  pend(exceptions, 16, 0x80); const outer = exceptions.dispatchPending();
  const address = exceptions.readMmio(FPCAR);
  pend(exceptions, 17, 0x20); const inner = exceptions.dispatchPending();
  assert.equal(inner.excReturn, EXC_RETURN.handlerMsp);
  assert.equal(inner.frameBytes, 32);
  assert.equal(exceptions.readMmio(FPCAR), address);
  exceptions.returnFromException();
  assert.equal(exceptions.readMmio(FPCCR) & 1, 1);
  assert.equal(cpu.readRegister('control') & 4, 0);
  assert.equal(cpu.readRegister('msp'), outer.stackPointer);
  exceptions.returnFromException();
  assert.equal(cpu.readRegister('control') & 4, 4);
  assert.equal(exceptions.readMmio(FPCCR) & 1, 0);
});

test('nested FP handlers reserve independent frames after the previous lazy save', () => {
  const { cpu, exceptions } = fixture();
  pend(exceptions, 16, 0x80); const outer = exceptions.dispatchPending();
  exceptions.preserveLazyState(); cpu.writeRegister('s0', 0x40000000); cpu.writeRegister('control', 4);
  pend(exceptions, 17, 0x20); const inner = exceptions.dispatchPending();
  assert.equal(inner.excReturn, EXC_RETURN.handlerMspExtended);
  assert.equal(exceptions.readMmio(FPCAR), inner.stackPointer + 32);
  exceptions.preserveLazyState(); cpu.writeRegister('s0', 0x40400000);
  exceptions.returnFromException();
  assert.equal(cpu.readRegister('s0'), 0x40000000);
  assert.equal(cpu.readRegister('control') & 4, 4);
  exceptions.returnFromException();
  assert.equal(cpu.readRegister('s0'), 0x3f800000);
  assert.equal(cpu.readRegister('msp'), MSP);
  assert.equal(exceptions.status().floatingPoint.lazySaves, 2);
  assert.equal(word(cpu, outer.stackPointer + 32), 0x3f800000);
});

test('tail chaining retains the lazy frame until final unstack', () => {
  const { cpu, exceptions } = fixture();
  pend(exceptions, 16, 0x20); const entry = exceptions.dispatchPending();
  pend(exceptions, 17, 0x80);
  const chained = exceptions.returnFromException();
  assert.equal(chained.kind, 'tail-chain');
  assert.equal(chained.excReturn, EXC_RETURN.threadMspExtended);
  assert.equal(cpu.readRegister('msp'), entry.stackPointer);
  assert.equal(exceptions.readMmio(FPCCR) & 1, 1);
  assert.equal(cpu.writes.length, 1);
  exceptions.returnFromException();
  assert.equal(cpu.readRegister('msp'), MSP);
});

test('manual ASPEN=0 still stacks extended when software sets FPCA', () => {
  const { exceptions } = fixture({ automatic: false, lazy: false });
  pend(exceptions, 15, 0);
  assert.equal(exceptions.dispatchPending().excReturn, EXC_RETURN.threadMspExtended);
  assert.equal(exceptions.returnFromException().frameType, 'extended');
});

test('RTOS extended return reads the newly selected PSP rather than a saved host snapshot', () => {
  const { cpu, exceptions } = fixture({ lazy: false, control: 6 });
  pend(exceptions, 15, 0); exceptions.dispatchPending();
  const newSp = PSP + 0x100;
  cpu.loadMemory(newSp, wordBytes([1, 2, 3, 4, 12, 0x80001001, 0x80003000, T,
    ...Array.from({ length: 16 }, (_, index) => 0x40800000 + index), 0x00000010, 0xdeadbeef]));
  cpu.writeRegister('psp', newSp); cpu.writeRegister('s16', 42);
  exceptions.returnFromException(EXC_RETURN.threadPspExtended);
  assert.equal(cpu.readRegister('s0'), 0x40800000);
  assert.equal(cpu.readRegister('s15'), 0x4080000f);
  assert.equal(cpu.readRegister('s16'), 42);
  assert.equal(cpu.readRegister('fpscr'), 0x10);
  assert.equal(cpu.readRegister('psp'), newSp + 104);
});

test('basic return clears FPCA and leaves handler FP data untouched', () => {
  const { cpu, exceptions } = fixture({ control: 0 });
  pend(exceptions, 15, 0); exceptions.dispatchPending();
  cpu.writeRegister('control', 4); cpu.writeRegister('s0', 999);
  exceptions.returnFromException(EXC_RETURN.threadMsp);
  assert.equal(cpu.readRegister('control'), 0);
  assert.equal(cpu.readRegister('s0'), 999);
});

test('failed lazy store preserves LSPACT and frame ownership for an explicit error', () => {
  const { cpu, exceptions } = fixture();
  pend(exceptions, 15, 0); exceptions.dispatchPending();
  const address = exceptions.readMmio(FPCAR);
  cpu.rejectWrite = true;
  assert.throws(() => exceptions.preserveLazyState(), /memory-store failure/);
  assert.equal(exceptions.readMmio(FPCCR) & 1, 1);
  assert.equal(exceptions.readMmio(FPCAR), address);
  assert.equal(exceptions.status().floatingPoint.lazySaves, 0);
});

test('CPACR gates eager entry and lazy preserve; reserved/mismatched access fails explicitly', () => {
  for (const access of [0, 0x00a00000, 0x00400000]) {
    const { cpu, exceptions } = fixture({ lazy: false });
    exceptions.writeMmio(CPACR, access); pend(exceptions, 15, 0);
    expectCode(() => exceptions.dispatchPending(), access ? 'unpredictable-cpacr' : 'fpu-permission');
    assert.equal(cpu.writes.length, 0);
  }
  const { exceptions } = fixture();
  exceptions.writeMmio(CPACR, 0); pend(exceptions, 15, 0);
  assert.equal(exceptions.dispatchPending().frameType, 'extended');
  expectCode(() => exceptions.preserveLazyState(), 'fpu-permission');
  assert.equal(exceptions.readMmio(FPCCR) & 1, 1);
});

test('privileged-only CPACR checks the interrupted entry and the restored Thread context', () => {
  const entering = fixture({ lazy: false });
  entering.exceptions.writeMmio(CPACR, 0x00500000);
  entering.cpu.writeRegister('control', 5); pend(entering.exceptions, 15, 0);
  expectCode(() => entering.exceptions.dispatchPending(), 'fpu-permission');
  assert.equal(entering.cpu.writes.length, 0);
  const returning = fixture({ lazy: false });
  pend(returning.exceptions, 15, 0); returning.exceptions.dispatchPending();
  returning.exceptions.writeMmio(CPACR, 0x00500000); returning.cpu.writeRegister('control', 1);
  expectCode(() => returning.exceptions.returnFromException(), 'fpu-permission');
  assert.equal(returning.exceptions.activeException, 15);
});

test('lazy unused return skips FP permissions and memory even with handler FPCA set', () => {
  const { cpu, exceptions } = fixture();
  pend(exceptions, 15, 0); const entry = exceptions.dispatchPending();
  // Software can alter these architectural registers without executing VFP.
  cpu.writeRegister('control', 4); exceptions.writeMmio(CPACR, 0); cpu.reads = [];
  exceptions.returnFromException();
  assert.deepEqual(cpu.reads, [{ address: entry.stackPointer, length: 32 }]);
  assert.equal(cpu.readRegister('control'), 4);
  assert.equal(cpu.readRegister('s0'), 0x3f800000);
});

test('lazy FPCCR records origin privilege and masked fault readiness', () => {
  const { cpu, exceptions } = fixture();
  exceptions.setSystemEnabled(4, true); exceptions.setPriority(4, 0x20);
  exceptions.setSystemEnabled(5, true); exceptions.setPriority(5, 0x80);
  exceptions.setSystemEnabled(12, true); exceptions.setPriority(12, 0x30);
  cpu.writeRegister('basepri', 0x40); cpu.writeRegister('control', 5);
  pend(exceptions, 15, 0); exceptions.dispatchPending();
  assert.equal(exceptions.readMmio(FPCCR) & 0x17b, 0x13b); // MON/MM/HF ready, USER/THREAD/lazy.
});

test('FP core MMIO masks reserved bits and rejects unsafe automatic-policy changes', () => {
  const { cpu, exceptions } = fixture({ control: 0 });
  exceptions.writeMmio(FPCAR, 0x20248007); assert.equal(exceptions.readMmio(FPCAR), 0x20248000);
  exceptions.writeMmio(FPDSCR, 0xffffffff); assert.equal(exceptions.readMmio(FPDSCR), 0x07c00000);
  expectCode(() => exceptions.writeMmio(FPCCR, 0), 'unsafe-fpccr-change');
  exceptions.writeMmio(CPACR, 0); cpu.writeRegister('control', 4);
  expectCode(() => exceptions.writeMmio(FPCCR, 0), 'unsafe-fpccr-change');
  cpu.writeRegister('control', 0); exceptions.writeMmio(FPCCR, 0x3fffffff);
  assert.equal(exceptions.readMmio(FPCCR), 0x17b);
});

test('overlapping software-activated lazy context is refused without corrupting the outer frame', () => {
  const { cpu, exceptions } = fixture();
  pend(exceptions, 16, 0x80); exceptions.dispatchPending();
  const address = exceptions.readMmio(FPCAR), sp = cpu.readRegister('msp');
  cpu.writeRegister('control', 4); pend(exceptions, 17, 0x20);
  expectCode(() => exceptions.dispatchPending(), 'overlapping-lazy-context');
  assert.equal(exceptions.readMmio(FPCAR), address);
  assert.equal(cpu.readRegister('msp'), sp);
});

// Byte sequences are assembled from tools/fixtures/emulator-exceptions-fpu.S.
const handler = new Uint8Array([0x00, 0xee, 0x10, 0x0a, 0x08, 0xee, 0x10, 0x1a, 0x70, 0x47, 0xfe, 0xe7]);
const skipped = new Uint8Array([0x00, 0x22, 0x18, 0xbf, 0x00, 0xee, 0x10, 0x0a, 0x00, 0xbf, 0xfe, 0xe7]);
const memoryOps = new Uint8Array([0x90, 0xed, 0x00, 0x0a, 0x80, 0xed, 0x01, 0x0a,
  0x2d, 0xed, 0x02, 0x8a, 0xbd, 0xec, 0x02, 0x8a, 0xf1, 0xee, 0x10, 0x1a,
  0xe1, 0xee, 0x10, 0x1a, 0x00, 0xbf, 0xfe, 0xe7]);
async function realFixture({ lazy = true, automatic = true, attach = true } = {}) {
  const { createCPU } = await import('../src/lib/emulator/cpu.ts');
  const cpu = await createCPU({ read: () => undefined, write() {}, tick() {} });
  cpu.writeRegister('control', 0); cpu.writeRegister('xpsr', T); cpu.writeRegister('msp', MSP);
  const exceptions = new CortexMExceptions(cpu, { vectorTable: VECTOR, externalInterrupts: 32 });
  exceptions.writeMmio(FPCCR, (automatic ? 0x80000000 : 0) | (lazy ? 0x40000000 : 0));
  exceptions.writeMmio(CPACR, 0x00f00000);
  cpu.loadMemory(VECTOR + 15 * 4, wordBytes([0x80002001]));
  cpu.loadMemory(0x80002000, handler);
  cpu.loadMemory(0x80001000, new Uint8Array([0x01, 0x35, 0xfe, 0xe7]));
  cpu.writeRegister('pc', 0x80001001);
  if (attach) cpu.onInstruction((address, size) => exceptions.beforeInstruction(address, size));
  return { cpu, exceptions };
}
for (const lazy of [false, true]) test(`real M7 ${lazy ? 'lazy' : 'eager'} handler FP use restores low registers and leaves S16 software-owned`, async () => {
  const { cpu, exceptions } = await realFixture({ lazy });
  try {
    cpu.writeRegister('control', 4); cpu.writeRegister('s0', 0x3fc00000); cpu.writeRegister('s16', 0x41000000);
    cpu.writeRegister('r0', 0x40200000); cpu.writeRegister('r1', 0x40800000); cpu.writeRegister('r5', 0);
    exceptions.pend(15); const entry = exceptions.dispatchPending();
    const ran = cpu.step(2); exceptions.afterExecution();
    assert.equal(ran.reason, 'budget', ran.fault); assert.equal(ran.instructions, 2);
    assert.equal(ran.pc, 0x80002008);
    assert.equal(cpu.readRegister('s0'), 0x40200000);
    assert.equal(cpu.readRegister('s16'), 0x40800000);
    assert.equal(word(cpu, entry.stackPointer + 32), 0x3fc00000);
    assert.equal(exceptions.status().floatingPoint.lazySaves, lazy ? 1 : 0);
    exceptions.returnFromException();
    assert.equal(cpu.readRegister('s0'), 0x3fc00000);
    assert.equal(cpu.readRegister('s16'), 0x40800000);
    assert.equal(cpu.readRegister('control'), 4);
    assert.equal(cpu.readRegister('msp'), MSP);
    assert.equal(cpu.step(1).reason, 'budget'); exceptions.afterExecution();
    assert.equal(cpu.readRegister('r5'), 1);
  } finally { cpu.close(); }
});

test('real M7 IT-skipped VFP does not consume an outstanding lazy context', async () => {
  const { cpu, exceptions } = await realFixture();
  try {
    cpu.loadMemory(0x80002000, skipped); cpu.writeRegister('control', 4);
    cpu.writeRegister('s0', 0x3fc00000); cpu.writeRegister('r0', 0x40200000);
    exceptions.pend(15); exceptions.dispatchPending();
    const addresses = []; cpu.onInstruction((address) => addresses.push(address));
    const ran = cpu.step(4); exceptions.afterExecution();
    assert.equal(ran.reason, 'budget', ran.fault);
    assert.deepEqual(addresses, [0x80002000, 0x80002002, 0x80002008, 0x8000200a]);
    assert.equal(cpu.readRegister('s0'), 0x3fc00000);
    assert.equal(cpu.readRegister('control'), 0);
    assert.equal(exceptions.readMmio(FPCCR) & 1, 1);
    assert.equal(exceptions.status().floatingPoint.lazySaves, 0);
    exceptions.returnFromException();
    assert.equal(cpu.readRegister('s0'), 0x3fc00000);
  } finally { cpu.close(); }
});

test('real M7 automatic FP activation applies modeled FPDSCR; manual ASPEN retains FPCA=0', async () => {
  for (const automatic of [true, false]) {
    const { cpu, exceptions } = await realFixture({ automatic });
    try {
      exceptions.writeMmio(FPDSCR, 0x00400000);
      cpu.writeRegister('fpscr', 0x00800000); cpu.writeRegister('r0', 0x3fc00000);
      const ran = cpu.step(2, { entry: 0x80002001 }); exceptions.afterExecution();
      assert.equal(ran.reason, 'budget', ran.fault);
      assert.equal(ran.instructions, 2, 'Manual FPCA normalization also runs between adjacent FP instructions.');
      assert.equal(cpu.readRegister('control') & 4, automatic ? 4 : 0);
      assert.equal(cpu.readRegister('fpscr') & 0x07c00000, automatic ? 0x00400000 : 0x00800000);
      exceptions.pend(15);
      assert.equal(exceptions.dispatchPending().frameType, automatic ? 'extended' : 'basic');
    } finally { cpu.close(); }
  }
});

test('real M7 VLDR/VSTR/VPUSH/VPOP/VMRS/VMSR are recognized FP instructions', async () => {
  const { cpu, exceptions } = await realFixture({ attach: false });
  try {
    cpu.loadMemory(0x80002000, memoryOps); cpu.loadMemory(0x20244000, wordBytes([0x3fc00000, 0]));
    cpu.writeRegister('r0', 0x20244000); cpu.writeRegister('s16', 0x40200000); cpu.writeRegister('s17', 0x40800000);
    const recognized = new Set();
    const detach = cpu.onInstruction((address, size) => { if (exceptions.beforeInstruction(address, size)) recognized.add(address); });
    const ran = cpu.step(6, { entry: 0x80002001 }); exceptions.afterExecution(); detach();
    assert.equal(ran.reason, 'budget', ran.fault);
    assert.equal(recognized.size, 6, 'The first instruction can be hooked again after FPCA retranslation.');
    assert.equal(word(cpu, 0x20244004), 0x3fc00000);
    assert.equal(cpu.readRegister('s16'), 0x40200000); assert.equal(cpu.readRegister('s17'), 0x40800000);
    assert.equal(cpu.readRegister('msp'), MSP); assert.equal(cpu.readRegister('control') & 4, 4);
  } finally { cpu.close(); }
});

test('real M7 first FP context applies FPDSCR rounding during arithmetic', async () => {
  const { cpu, exceptions } = await realFixture();
  try {
    // VMOV s0,r0; VMOV s1,r1; VADD s2,s0,s1; VMOV r2,s2; NOP; B self.
    cpu.loadMemory(0x80002000, new Uint8Array([0x00, 0xee, 0x10, 0x0a, 0x00, 0xee, 0x90, 0x1a,
      0x30, 0xee, 0x20, 0x1a, 0x11, 0xee, 0x10, 0x2a, 0x00, 0xbf, 0xfe, 0xe7]));
    exceptions.writeMmio(FPDSCR, 0x00400000); // Round toward +infinity.
    cpu.writeRegister('r0', 0x3f800000); cpu.writeRegister('r1', 0x33800000); // 1 + 2^-24.
    const ran = cpu.step(4, { entry: 0x80002001 }); exceptions.afterExecution();
    assert.equal(ran.reason, 'budget', ran.fault); assert.equal(ran.instructions, 4);
    assert.equal(cpu.readRegister('r2'), 0x3f800001, 'Rounding must affect the arithmetic, not just a final status write.');
    assert.equal(cpu.readRegister('control') & 4, 4);
  } finally { cpu.close(); }
});

test('real M7 modeled CPACR denial stops before the FP instruction changes context', async () => {
  const { cpu, exceptions } = await realFixture();
  try {
    exceptions.writeMmio(CPACR, 0); cpu.writeRegister('s0', 0x3fc00000); cpu.writeRegister('r0', 0x40200000);
    const ran = cpu.step(1, { entry: 0x80002001 }); exceptions.afterExecution();
    assert.equal(ran.reason, 'fault'); assert.match(ran.fault, /CPACR denies/);
    assert.equal(ran.instructions, 0); assert.equal(cpu.readRegister('s0'), 0x3fc00000);
    assert.equal(cpu.readRegister('control') & 4, 0);
  } finally { cpu.close(); }
});
