import assert from 'node:assert/strict';
import test from 'node:test';
import { captureExceptionReturn, decodeThumbPcTransfer, applyPcTransferEffects } from '../src/lib/emulator/exception-return.ts';
import { CortexMExceptions, EXC_RETURN, ExceptionModelError } from '../src/lib/emulator/exceptions.ts';

const CODE = 0x80001000, DEST = 0x80002000, DATA = 0x20244000, MSP = 0x20248000, T = 0x01000000;
const hex = (value) => Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
const bytes = (values) => { const data = new Uint8Array(values.length * 4), view = new DataView(data.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true)); return data; };
const expectCode = (fn, code) => assert.throws(fn, error => error instanceof ExceptionModelError && error.code === code);
class Fixture {
  regs = new Map(Object.entries({ xpsr: T | 15, pc: CODE, control: 0, msp: MSP, psp: MSP + 0x1000,
    lr: EXC_RETURN.threadMsp, r0: DATA, r4: DATA, r5: 2, primask: 0, basepri: 0, faultmask: 0 }));
  memory = new Map(); writes = []; reads = [];
  readRegister(name) { if (name === 'sp') name = this.readRegister('xpsr') & 511 ? 'msp' : this.readRegister('control') & 2 ? 'psp' : 'msp'; return this.regs.get(name) ?? 0; }
  writeRegister(name, value) { this.writes.push({ name, value: value >>> 0 }); if (name === 'sp') name = this.readRegister('xpsr') & 511 ? 'msp' : this.readRegister('control') & 2 ? 'psp' : 'msp'; this.regs.set(name, value >>> 0); }
  readMemory(address, length) { this.reads.push({ address, length }); return Uint8Array.from({ length }, (_, index) => this.memory.get(address + index) ?? 0); }
  loadMemory(address, data) { data.forEach((value, index) => this.memory.set(address + index, value)); }
}
const forms = [
  { name: 'BX LR', code: '7047', source: null, loads: [], wb: null },
  { name: 'BX R4', code: '2047', source: null, loads: [], wb: null, register: 'r4' },
  { name: 'POP R4/PC', code: '10bd', source: MSP + 4, prefix: [0x12345678], loads: ['r4'], wb: ['sp', MSP + 8] },
  { name: 'POP PC', code: '00bd', source: MSP, loads: [], wb: ['sp', MSP + 4] },
  { name: 'POP.W R4/R8/PC', code: 'bde81081', source: MSP + 8, prefix: [11, 22], loads: ['r4', 'r8'], wb: ['sp', MSP + 12] },
  { name: 'LDMIA R4! R5/PC', code: 'b4e82080', source: DATA + 4, prefix: [123], loads: ['r5'], wb: ['r4', DATA + 8] },
  { name: 'LDMIA R0 R4/PC', code: '90e81080', source: DATA + 4, prefix: [123], loads: ['r4'], wb: null },
  { name: 'LDMDB R4! R5/PC', code: '34e92080', source: DATA - 4, prefix: [123], loads: ['r5'], wb: ['r4', DATA - 8] },
  { name: 'LDR positive immediate', code: 'd4f808f0', source: DATA + 8, loads: [], wb: null },
  { name: 'LDR negative immediate', code: '54f808fc', source: DATA - 8, loads: [], wb: null },
  { name: 'LDR pre-index writeback', code: '54f808ff', source: DATA + 8, loads: [], wb: ['r4', DATA + 8] },
  { name: 'LDR post-index positive', code: '54f804fb', source: DATA, loads: [], wb: ['r4', DATA + 4] },
  { name: 'LDR post-index negative', code: '54f804f9', source: DATA, loads: [], wb: ['r4', DATA - 4] },
  { name: 'LDR register shifted', code: '54f825f0', source: DATA + 8, loads: [], wb: null },
  { name: 'LDR positive literal', code: 'dff808f0', source: CODE + 12, loads: [], wb: null },
  { name: 'LDR negative literal', code: '5ff808f0', source: CODE - 4, loads: [], wb: null },
  { name: 'POP.W PC (LDR alias)', code: '5df804fb', source: MSP, loads: [], wb: ['sp', MSP + 4] },
];
function setup(cpu, form, target = EXC_RETURN.threadMsp) {
  cpu.loadMemory(CODE, hex(form.code));
  if (form.register) cpu.writeRegister(form.register, target);
  else if (form.source !== null) {
    const prefix = form.prefix ?? [];
    cpu.loadMemory(form.source - prefix.length * 4, bytes([...prefix, target]));
  } else cpu.writeRegister('lr', target);
  if (cpu.writes) cpu.writes = [];
}
for (const form of forms) test(`model ${form.name} captures strict token and only software-owned effects`, () => {
  const cpu = new Fixture(); setup(cpu, form);
  const plan = captureExceptionReturn(cpu, CODE, hex(form.code).length, 15);
  assert.equal(plan.target, EXC_RETURN.threadMsp);
  assert.deepEqual(plan.loads.map(item => item.name), form.loads);
  assert.deepEqual(plan.writeback ? [plan.writeback.name, plan.writeback.value] : null, form.wb);
  assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.loads));
  applyPcTransferEffects(cpu, plan);
  assert.equal(cpu.readRegister('pc'), CODE, 'The adapter never writes PC or consumes the hardware frame.');
  assert.equal(cpu.readRegister('xpsr'), T | 15);
  assert.equal(cpu.readRegister('r11'), 0, 'Unlisted callee-saved registers remain untouched.');
  assert.deepEqual(cpu.writes.map(item => item.name).sort(), [...form.loads, ...(form.wb ? [form.wb[0]] : [])].sort());
});

test('unrelated PC writers and Thread mode cannot become exception returns', () => {
  for (const code of ['f047', 'a746', '2744', '00bf', '00f000f8']) { // BLX LR, MOV PC,R4, ADD PC,R4, NOP, BL.
    const cpu = new Fixture(); cpu.writeRegister('r4', EXC_RETURN.threadMsp); cpu.loadMemory(CODE, hex(code));
    assert.equal(captureExceptionReturn(cpu, CODE, hex(code).length, 15), null);
  }
  const cpu = new Fixture(); setup(cpu, forms[0]); cpu.writeRegister('xpsr', T);
  assert.equal(captureExceptionReturn(cpu, CODE, 2, 0), null);
  expectCode(() => captureExceptionReturn(cpu, CODE, 2, 15), 'untracked-handler');
  cpu.writeRegister('pc', 0xfffffff8);
  assert.equal(captureExceptionReturn(cpu, CODE, 2, 0), null, 'A fetch address provides no origin proof.');
});

test('every supported raw basic/extended token remains exact; even/reserved values fail', () => {
  for (const token of Object.values(EXC_RETURN)) {
    const cpu = new Fixture(); setup(cpu, forms[0], token);
    assert.equal(captureExceptionReturn(cpu, CODE, 2, 15).target, token);
  }
  for (const token of [0xfffffff8, 0xffffffe8, 0xfffffff5, 0xf0000001]) {
    const cpu = new Fixture(); setup(cpu, forms[0], token);
    expectCode(() => captureExceptionReturn(cpu, CODE, 2, 15), 'invalid-exc-return');
  }
});

test('passing final IT instruction qualifies; skipped or nonfinal return never applies', () => {
  const cpu = new Fixture(); setup(cpu, forms[0]);
  const it = value => ((value & 3) << 25) | ((value & 0xfc) << 8);
  cpu.writeRegister('xpsr', T | 15 | 0x40000000 | it(8)); // Final EQ, Z1.
  assert.equal(captureExceptionReturn(cpu, CODE, 2, 15).target, EXC_RETURN.threadMsp);
  cpu.writeRegister('xpsr', T | 15 | it(8)); // EQ skipped, Z0.
  assert.equal(captureExceptionReturn(cpu, CODE, 2, 15), null);
  cpu.writeRegister('xpsr', T | 15 | 0x40000000 | it(4)); // EQ nonfinal.
  expectCode(() => captureExceptionReturn(cpu, CODE, 2, 15), 'unqualified-return-it');
});

test('reserved and unpredictable multiple-load/LDR forms are refused as model errors', () => {
  for (const code of ['b4e83080', 'bfe82080', 'b4e80080', 'b4e820a0', 'b4e820c0', '54f80df0', '54f80ff0', '54f804f8', '54f804fe']) {
    const cpu = new Fixture(); cpu.loadMemory(CODE, hex(code));
    expectCode(() => captureExceptionReturn(cpu, CODE, 4, 15), 'unqualified-return-encoding');
  }
});

test('general LDM writeback through restored or banked registers remains explicitly unqualified', () => {
  for (const code of ['b0e81080', 'bce81080', 'bee81080', '3de91080']) {
    const cpu = new Fixture(); cpu.loadMemory(CODE, hex(code));
    const n = parseInt(code.slice(0, 2), 16) & 15, base = n === 13 ? MSP : DATA;
    if (n !== 13) cpu.writeRegister(n === 14 ? 'lr' : `r${n}`, base);
    const start = code.startsWith('3d') ? base - 8 : base;
    cpu.loadMemory(start, bytes([123, EXC_RETURN.threadMsp]));
    expectCode(() => captureExceptionReturn(cpu, CODE, 4, 15), 'unqualified-return-writeback');
  }
});

test('unaligned or device-memory PC loads refuse prediction without reading device backing', () => {
  const cpu = new Fixture(); cpu.loadMemory(CODE, hex('d4f800f0')); cpu.writeRegister('r4', DATA + 1); cpu.reads = [];
  expectCode(() => captureExceptionReturn(cpu, CODE, 4, 15), 'unaligned-return-memory');
  for (const location of [0x40000000, 0xa0000000, 0xe000ed04]) {
    cpu.writeRegister('r4', location); cpu.reads = [];
    expectCode(() => captureExceptionReturn(cpu, CODE, 4, 15), 'unqualified-return-memory');
    assert.deepEqual(cpu.reads, [{ address: CODE, length: 4 }]);
  }
});

test('stale instruction, memory, register or mode plans fail before software writes', () => {
  for (const change of [cpu => cpu.loadMemory(CODE, hex('00bf')), cpu => cpu.loadMemory(DATA + 8, bytes([EXC_RETURN.threadPsp])),
    cpu => cpu.writeRegister('r4', DATA + 4), cpu => cpu.writeRegister('xpsr', T), cpu => cpu.writeRegister('pc', CODE + 4)]) {
    const cpu = new Fixture(); setup(cpu, forms[8]); const plan = captureExceptionReturn(cpu, CODE, 4, 15);
    change(cpu); cpu.writes = [];
    expectCode(() => applyPcTransferEffects(cpu, plan), 'stale-return-transfer'); assert.deepEqual(cpu.writes, []);
  }
});

test('injected JavaScript read failure cannot produce a partial software transfer', () => {
  const cpu = new Fixture(); setup(cpu, forms[2]);
  const read = cpu.readMemory.bind(cpu);
  cpu.readMemory = (address, length) => { if (address === MSP) throw new Error('injected fixture read failure'); return read(address, length); };
  assert.throws(() => captureExceptionReturn(cpu, CODE, 2, 15), /injected fixture read failure/);
  assert.deepEqual(cpu.writes, []); assert.equal(cpu.readRegister('msp'), MSP); assert.equal(cpu.readRegister('xpsr'), T | 15);
});

test('software POP then hardware unstack restores frame registers and preserves loaded R4', () => {
  const cpu = new Fixture(); cpu.writeRegister('xpsr', T); cpu.writeRegister('pc', DEST); cpu.writeRegister('r0', 77);
  cpu.loadMemory(0x80000000 + 15 * 4, bytes([CODE | 1]));
  const exceptions = new CortexMExceptions(cpu, { vectorTable: 0x80000000 }); exceptions.pend(15); exceptions.dispatchPending();
  const hardwareSp = cpu.readRegister('msp');
  cpu.loadMemory(CODE, hex('10bd')); cpu.loadMemory(hardwareSp - 8, bytes([123, EXC_RETURN.threadMsp]));
  cpu.writeRegister('msp', hardwareSp - 8);
  const plan = captureExceptionReturn(cpu, CODE, 2, exceptions.activeException);
  applyPcTransferEffects(cpu, plan); assert.equal(cpu.readRegister('msp'), hardwareSp);
  exceptions.returnFromException(plan.target);
  assert.equal(cpu.readRegister('r4'), 123); assert.equal(cpu.readRegister('r0'), 77);
  assert.equal(cpu.readRegister('msp'), MSP); assert.equal(cpu.readRegister('xpsr'), T);
});

for (const form of forms) test(`real M7 benign ${form.name} matches decoded software loads/writeback`, async () => {
  const { createCPU } = await import('../src/lib/emulator/cpu.ts');
  const cpu = await createCPU({ read: () => undefined, write() {}, tick() {} });
  try {
    cpu.writeRegister('xpsr', T | 15); cpu.writeRegister('control', 0); cpu.writeRegister('msp', MSP);
    cpu.writeRegister('r0', DATA); cpu.writeRegister('r4', DATA); cpu.writeRegister('r5', 2);
    setup(cpu, form, DEST | 1); cpu.loadMemory(DEST, hex('00bffee7')); cpu.writeRegister('pc', CODE | 1);
    let plan; cpu.onInstruction((address, size) => { plan = decodeThumbPcTransfer(cpu, address, size); });
    const ran = cpu.step(1);
    assert.equal(ran.reason, 'budget', ran.fault); assert.equal(ran.instructions, 1);
    assert.equal(ran.pc, DEST); assert.equal(plan.target, (DEST | 1) >>> 0);
    for (const item of plan.loads) assert.equal(cpu.readRegister(item.name), item.value);
    if (plan.writeback) assert.equal(cpu.readRegister(plan.writeback.name), plan.writeback.value);
    assert.equal(cpu.readRegister('ipsr'), 15, 'This test performs an ordinary branch and no exception return.');
  } finally { cpu.close(); }
});

test('real M7 omits the skipped IT BX and captures its passing final BX', async () => {
  const { createCPU } = await import('../src/lib/emulator/cpu.ts');
  for (const condition of ['18', '08']) { // IT NE skipped / IT EQ passes after MOVS r0,#0.
    const cpu = await createCPU({ read: () => undefined, write() {}, tick() {} });
    try {
      cpu.writeRegister('xpsr', T | 15); cpu.writeRegister('control', 0); cpu.writeRegister('msp', MSP);
      cpu.writeRegister('r4', DEST | 1); cpu.loadMemory(CODE, hex(`0022${condition}bf204700bffee7`));
      cpu.loadMemory(DEST, hex('00bffee7')); const transfers = [];
      cpu.onInstruction((address, size) => { const plan = decodeThumbPcTransfer(cpu, address, size); if (plan) transfers.push(plan); });
      const ran = cpu.step(3, { entry: CODE | 1 }); assert.equal(ran.reason, 'budget', ran.fault);
      assert.equal(transfers.length, condition === '08' ? 1 : 0);
      if (condition === '08') assert.equal(ran.pc, DEST);
    } finally { cpu.close(); }
  }
});

test('real M7 stop-before-transfer leaves a fresh immutable plan for software application', async () => {
  const { createCPU } = await import('../src/lib/emulator/cpu.ts');
  const cpu = await createCPU({ read: () => undefined, write() {}, tick() {} });
  try {
    cpu.writeRegister('xpsr', T | 15); cpu.writeRegister('control', 0); cpu.writeRegister('msp', MSP);
    setup(cpu, forms[2], (DEST | 1) >>> 0); cpu.loadMemory(DEST, hex('00bffee7'));
    let plan; cpu.onInstruction((address, size) => { plan = decodeThumbPcTransfer(cpu, address, size); cpu.stop(); });
    const ran = cpu.step(1, { entry: CODE | 1 });
    assert.equal(ran.reason, 'stopped'); assert.equal(ran.instructions, 0); assert.equal(ran.pc, CODE);
    applyPcTransferEffects(cpu, plan);
    assert.equal(cpu.readRegister('r4'), 0x12345678); assert.equal(cpu.readRegister('msp'), MSP + 8);
    assert.equal(cpu.readRegister('pc'), CODE); assert.equal(cpu.readRegister('ipsr'), 15);
  } finally { cpu.close(); }
});
