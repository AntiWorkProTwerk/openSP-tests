import assert from 'node:assert/strict';
import test from 'node:test';
import {ArmCPU} from '../src/lib/emulator/cpu.ts';
import {SPBoard} from '../src/lib/emulator/board.ts';
import {CSR, DMA_CLOCK, DMAMUX, DREG, EDMA, LPSPI, SPI_CLOCK, SREG, TCD_BASE, TCR}
  from '../src/lib/emulator/display-types.ts';
import {bindDisplayTransport, DISPLAY_FIXTURES} from '../src/lib/emulator/audio-session-binding.ts';
import {createSession} from '../src/lib/emulator/session.ts';

// Controlled register/memory/hook callbacks only. This fake never decodes ARM,
// loads WASM or imports a native engine, and its lifecycle tests never start it.
function fakeModule(plan) {
  const engines = [], events = [];
  class RecordingEngine {
    registers = new Map(); hooks = new Map(); chunks = []; stopped = false; inStart = false;
    constructor() {engines.push(this);}
    ctl_set_cpu_model() {}
    ctl_get_cpu_model() {return 7;}
    ctl_remove_cache() {events.push(['cache']);}
    reg_write_i32(register, value) {this.registers.set(register, value >>> 0);}
    reg_read_i32(register) {return this.registers.get(register) ?? 0;}
    mem_map() {}
    mem_read(address, length) {
      const result = new Uint8Array(length);
      for (const chunk of this.chunks) {
        const start = Math.max(address, chunk.address), end = Math.min(address + length, chunk.address + chunk.bytes.length);
        if (start < end) result.set(chunk.bytes.subarray(start - chunk.address, end - chunk.address), start - address);
      }
      return result;
    }
    mem_write(address, bytes) {
      events.push(['memoryWrite', address, bytes.length, this.inStart]);
      this.chunks.push({address, bytes: bytes.slice()});
    }
    hook_add(type, callback) {this.hooks.set(type, callback); return {handle: type, callback: type};}
    hook_del() {}
    emu_stop() {this.stopped = true; events.push(['stop']);}
    emu_start(begin, until, timeout, count) {
      assert.equal(typeof plan, 'function', 'lifecycle fixtures must never enter emulation');
      this.stopped = false; this.inStart = true; events.push(['start', count]);
      try {plan(this, begin, count);} finally {this.inStart = false;}
    }
    close() {events.push(['close', engines.indexOf(this)]); this.closed = true;}
  }
  const module = {Unicorn: RecordingEngine, ARCH_ARM: 1, MODE_THUMB: 2, CPU_ARM_CORTEX_M7: 7,
    HOOK_MEM_READ: 1, HOOK_MEM_WRITE: 2, HOOK_CODE: 3};
  ['PC', 'R0', 'MSP', 'PSP', 'CONTROL', 'BASEPRI', 'PRIMASK', 'FAULTMASK', 'LR', 'SP', 'XPSR', 'FPSCR',
    'R1', 'R2', 'R3', 'R12', ...Array.from({length: 32}, (_, n) => `S${n}`)]
    .forEach((name, n) => {module[`ARM_REG_${name}`] = 10 + n;});
  return {module, engines, events};
}

function descriptor(source, destination, {size = 1, csr = CSR.DREQ, next = 0} = {}) {
  const bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
  view.setUint32(0, source, true); view.setUint16(6, size === 4 ? 0x0202 : 0, true);
  view.setUint32(8, size, true); view.setUint32(16, destination, true);
  view.setUint16(22, 1, true); view.setUint32(24, next, true);
  view.setUint16(28, csr, true); view.setUint16(30, 1, true);
  return bytes;
}
function normalTransfer(board, cpu) {
  const tx = 0x80000100, terminalWord = 0x80000104, rx = 0x80000200, sg = 0x80000300;
  cpu.writeMemory(tx, Uint8Array.of(0xae)); cpu.writeMemory(rx, Uint8Array.of(0xcc));
  const word = new Uint8Array(4); new DataView(word.buffer).setUint32(0, 7 | TCR.BYSW, true);
  cpu.writeMemory(terminalWord, word);
  cpu.writeMemory(sg, descriptor(terminalWord, LPSPI + SREG.TCR, {size: 4}));
  const publishTcd = (channel, bytes) => {
    const view = new DataView(bytes.buffer);
    for (let offset = 0; offset < 32; offset += 4) board.write(TCD_BASE + channel * 32 + offset, view.getUint32(offset, true), 4);
  };
  publishTcd(6, descriptor(tx, LPSPI + SREG.TDR + 3, {csr: CSR.ESG, next: sg}));
  publishTcd(7, descriptor(LPSPI + SREG.RDR + 3, rx, {csr: CSR.DREQ | CSR.INTMAJOR}));
  board.write(DMA_CLOCK, 0xc0, 4); board.write(SPI_CLOCK, 0xc0, 4);
  board.write(DMAMUX + 6 * 4, (0x80000000 | 80) >>> 0, 4);
  board.write(DMAMUX + 7 * 4, (0x80000000 | 79) >>> 0, 4);
  board.write(LPSPI + SREG.CFGR1, 1, 4); board.write(LPSPI + SREG.CR, 1, 4);
  board.write(LPSPI + SREG.DER, 3, 4); board.write(LPSPI + SREG.TCR, 7 | TCR.BYSW | TCR.CONT, 4);
  board.write(EDMA + DREG.ERQ, (1 << 6) | (1 << 7), 4);
  return rx;
}

test('actual reduced SDRAM map owns the admitted extent and explicit fixture inputs', () => {
  const calls = [], board = {configureDisplayTransport: value => calls.push(value)};
  const row = {name: 'SDRAM', address: 0x80000000, bytes: 0x10000, permissions: 7};
  bindDisplayTransport(board, {memoryMap: [row]}); row.bytes = 0x04000000;
  assert.deepEqual(calls, [{mappedRam: {start: 0x80000000, bytes: 0x10000},
    admittedRam: [{start: 0x80000000, bytes: 0x10000}], fixtures: {...DISPLAY_FIXTURES}}]);
  for (const memoryMap of [[], [row, row], [{...row, address: 0x81000000}], [{...row, bytes: 0x10001}], [{...row, permissions: 1}]])
    assert.throws(() => bindDisplayTransport(board, {memoryMap}), /SDRAM|mapping/);
  assert.equal(calls.length, 1);
});

test('RX accepted during Board tick drains outside emulation before next earned-IRQ listener', () => {
  const f = fakeModule((engine, begin, count) => {
    let address = begin & 0xfffffffe;
    for (let n = 0; n < count && !engine.stopped; n++) {
      engine.registers.set(10, address); engine.hooks.get(3)(0, address, 2);
      if (!engine.stopped) {address += 2; engine.registers.set(10, address);}
    }
  });
  let cpu, rx, pending = false; const observations = [];
  const board = new SPBoard({onIrq(irq, asserted) {
    if (irq === 7) {
      pending = asserted;
      if (asserted) observations.push(['acceptedIrq', f.engines[0].mem_read(rx, 1)[0], f.engines[0].inStart]);
    }
  }});
  cpu = new ArmCPU(f.module, {read: (a, w) => board.read(a, w), write: (a, v, w) => board.write(a, v, w),
    tick: ticks => board.tick(ticks), setMemoryCallbacks: (read, write) => board.setMemoryCallbacks(read, write)}, {sdramBytes: 0x10000});
  bindDisplayTransport(board, cpu); rx = normalTransfer(board, cpu);
  cpu.onInstruction(() => {
    if (pending) {
      observations.push(['serviceIrq', f.engines[0].mem_read(rx, 1)[0], f.engines[0].inStart]);
      board.write(EDMA + DREG.CINT, 7, 1);
    }
  });
  cpu.writeRegister('pc', 0x1000); const result = cpu.step(16);
  assert.equal(result.reason, 'budget'); assert.equal(result.instructions, 16);
  assert.deepEqual(observations, [['acceptedIrq', 0xcc, true], ['serviceIrq', 0, true]]);
  assert.ok(f.events.some(event => event[0] === 'memoryWrite' && event[1] === rx && event[2] === 1 && event[3] === false));
  assert.equal(board.displayTransportStatus().edma.errors, 0);
  assert.equal(board.displayTransportStatus().diagnostics.length, 0);
  assert.equal(board.status().frameCount, 0, 'disconnected OLED routing does not fabricate frames');
  board.disposeDisplayTransport(); cpu.close();
});

const dataOnlyImage = () => Uint8Array.of(1, 2, 3, 4);
async function lifecycle() {
  const f = fakeModule();
  const session = await createSession(dataOnlyImage(), {format: 'app1', cpuOptions: {factory: async () => f.module, sdramBytes: 0x10000}});
  return {f, session};
}

test('Session reset disposes before closing CPU and binds a fresh transport to actual mapped SDRAM', async () => {
  const {f, session} = await lifecycle();
  const close = f.engines[0].close.bind(f.engines[0]);
  f.engines[0].close = () => {assert.equal(session.board.displayTransportStatus(), undefined); close();};
  await session.reset();
  const fresh = session.board.displayTransportStatus();
  assert.ok(fresh); assert.equal(fresh.phases, 0);
  assert.equal(session.cpu.memoryMap.find(row => row.name === 'SDRAM').bytes, 0x10000);
  assert.equal(f.engines.length, 2); assert.equal(f.engines[0].closed, true);
  const snapshot = session.snapshot(); assert.deepEqual(snapshot.displayTransport, fresh);
  assert.deepEqual(session.board.displayTransportStatus(), fresh, 'snapshot is passive');
  session.close(); assert.equal(session.board.displayTransportStatus(), undefined);
  assert.equal(session.state, 'closed'); assert.equal(f.events.filter(event => event[0] === 'start').length, 0);
});

test('Session close releases CPU in finally even if private disposal throws', async () => {
  const {f, session} = await lifecycle();
  session.board.disposeDisplayTransport = () => {throw new Error('controlled private disposal failure');};
  assert.throws(() => session.close(), /controlled private disposal failure/);
  assert.equal(f.engines[0].closed, true); assert.equal(session.state, 'closed');
});

test('close during awaited reset cannot rebind a newly returned CPU or transport', async () => {
  const f = fakeModule(); let calls = 0, release, started;
  const waiting = new Promise(resolve => {started = resolve;});
  const session = await createSession(dataOnlyImage(), {format: 'app1', cpuOptions: {factory: async () => {
    if (++calls === 1) return f.module;
    started(); return new Promise(resolve => {release = resolve;});
  }}});
  const resetting = session.reset(); await waiting;
  session.close(); release(f.module);
  await assert.rejects(resetting, /Session ownership changed/);
  assert.equal(session.state, 'closed'); assert.equal(session.board.displayTransportStatus(), undefined);
  assert.equal(f.engines.length, 2); assert.equal(f.engines[1].closed, true);
  assert.equal(f.events.filter(event => event[0] === 'start').length, 0);
});

test('late CPU from superseded reset leaves the newer callback pair and transport untouched', async () => {
  const f = fakeModule(); let calls = 0, releaseOld, started;
  const waiting = new Promise(resolve => {started = resolve;});
  const session = await createSession(dataOnlyImage(), {format: 'app1', cpuOptions: {factory: async () => {
    if (++calls !== 2) return f.module;
    started(); return new Promise(resolve => {releaseOld = resolve;});
  }}});
  const oldReset = session.reset(); await waiting;
  await session.reset();
  const currentCpu = session.cpu, currentStatus = session.board.displayTransportStatus();
  const read = session.board.readMemoryCallback, write = session.board.writeMemoryCallback;
  releaseOld(f.module); await assert.rejects(oldReset, /Session ownership changed/);
  assert.equal(session.cpu, currentCpu); assert.equal(currentCpu.backendFailed, false);
  assert.equal(session.board.readMemoryCallback, read); assert.equal(session.board.writeMemoryCallback, write);
  assert.deepEqual(session.board.displayTransportStatus(), currentStatus);
  assert.equal(f.engines.at(-1).closed, true, 'superseded CPU is released');
  assert.equal(f.engines[1].closed, undefined, 'current CPU remains open');
  session.close();
});

test('queued close after CPU return cannot be overwritten by reset await continuation', async () => {
  const {f, session} = await lifecycle();
  const makeCPU = session.makeCPU.bind(session);
  session.makeCPU = async () => {
    const cpu = await makeCPU(); queueMicrotask(() => session.close()); return cpu;
  };
  await assert.rejects(session.reset(), /Session ownership changed before private display reset boot/);
  assert.equal(session.state, 'closed'); assert.equal(session.board.displayTransportStatus(), undefined);
  assert.equal(f.engines.length, 2); assert.equal(f.engines[1].closed, true);
  assert.equal(f.events.filter(event => event[0] === 'start').length, 0);
});

test('failed initialize and failed binding release private transport and the newly constructed CPU', async () => {
  const f = fakeModule();
  const original = SPBoard.prototype.configureDisplayTransport;
  let disposed = false;
  SPBoard.prototype.configureDisplayTransport = function (options) {
    original.call(this, options);
    const dispose = this.disposeDisplayTransport.bind(this);
    this.disposeDisplayTransport = () => {disposed = true; dispose();};
    throw new Error('controlled binding failure');
  };
  try {
    await assert.rejects(createSession(dataOnlyImage(), {format: 'app1', cpuOptions: {factory: async () => f.module}}), /controlled binding failure/);
    assert.equal(disposed, true); assert.equal(f.engines[0].closed, true);
    assert.equal(f.events.filter(event => event[0] === 'start').length, 0);
  } finally {SPBoard.prototype.configureDisplayTransport = original;}
});
