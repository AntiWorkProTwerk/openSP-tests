import assert from 'node:assert/strict';
import test from 'node:test';
import {ArmCPU} from '../src/lib/emulator/cpu.ts';
import {SPBoard} from '../src/lib/emulator/board.ts';
import {createSession} from '../src/lib/emulator/session.ts';
import {bindDisplayTransport, ownAudioFixtures} from '../src/lib/emulator/audio-session-binding.ts';
import {admitStockAudioRam} from '../src/lib/emulator/audio-maps.ts';
import {MappedDisplayBus} from '../src/lib/emulator/display-bus.ts';
import {CSR, EDMA, DREG, TCD_BASE, DMAMUX, DMA_CLOCK, DisplayBusFault}
  from '../src/lib/emulator/display-types.ts';

const SAI = 0x40384000, RX = 0x20008000, RX_BYTES = 2048;
const audioFixtures = (first = 1) => ({saiClockReady: true, externalClock: true,
  slotTicks: 8, rxFrame: Array.from({length: 16}, (_, n) => (0xabcd0000 | (first + n)) >>> 0)});

// These controlled callbacks never decode ARM or load a native/WASM engine.
// ArmCPU's queue/drain code, the import-routed Board and Session are real JS.
function recordingModule(plan) {
  const engines = [], events = [];
  let writeFailure, cacheFailure;
  class RecordingEngine {
    registers = new Map(); hooks = new Map(); chunks = []; stopped = false; inStart = false;
    constructor() {engines.push(this);}
    ctl_set_cpu_model() {}
    ctl_get_cpu_model() {return 7;}
    ctl_remove_cache(address, end) {
      events.push(['cache', address, end, this.inStart]);
      if (cacheFailure?.(address)) throw new Error('controlled drain cache failure');
    }
    reg_write_i32(register, value) {this.registers.set(register, value >>> 0);}
    reg_read_i32(register) {return this.registers.get(register) ?? 0;}
    mem_map() {}
    mem_read(address, length) {
      const bytes = new Uint8Array(length);
      for (const chunk of this.chunks) {
        const start = Math.max(address, chunk.address), end = Math.min(address + length, chunk.address + chunk.bytes.length);
        if (start < end) bytes.set(chunk.bytes.subarray(start - chunk.address, end - chunk.address), start - address);
      }
      return bytes;
    }
    mem_write(address, bytes) {
      events.push(['memoryWrite', address, bytes.length, this.inStart]);
      if (writeFailure?.(address, bytes)) throw new Error('controlled drain memory failure');
      this.chunks.push({address, bytes: bytes.slice()});
    }
    hook_add(type, callback) {this.hooks.set(type, callback); return {handle: type, callback: type};}
    hook_del() {}
    emu_stop() {this.stopped = true; events.push(['stop']);}
    emu_start(begin, until, timeout, count) {
      assert.equal(typeof plan, 'function', 'lifecycle cases must never start emulation');
      this.stopped = false; this.inStart = true; events.push(['start', count]);
      try {plan(this, begin, count);} finally {this.inStart = false;}
    }
    close() {this.closed = true; events.push(['close', engines.indexOf(this)]);}
  }
  const module = {Unicorn: RecordingEngine, ARCH_ARM: 1, MODE_THUMB: 2, CPU_ARM_CORTEX_M7: 7,
    HOOK_MEM_READ: 1, HOOK_MEM_WRITE: 2, HOOK_CODE: 3};
  ['PC', 'R0', 'MSP', 'PSP', 'CONTROL', 'BASEPRI', 'PRIMASK', 'FAULTMASK', 'LR', 'SP', 'XPSR', 'FPSCR',
    'R1', 'R2', 'R3', 'R12', ...Array.from({length: 32}, (_, n) => `S${n}`)]
    .forEach((name, n) => {module[`ARM_REG_${name}`] = 10 + n;});
  return {module, engines, events, failWrite: callback => {writeFailure = callback;},
    failCache: callback => {cacheFailure = callback;}};
}
function ordinaryHooks(engine, begin, count) {
  let address = begin & 0xfffffffe;
  for (let n = 0; n < count && !engine.stopped; n++) {
    engine.registers.set(10, address); engine.hooks.get(3)(0, address, 2);
    if (!engine.stopped) {address += 2; engine.registers.set(10, address);}
  }
}
function cpuAndBoard(options = {}) {
  const fake = recordingModule(options.plan), board = new SPBoard({onIrq: options.onIrq});
  const cpu = new ArmCPU(fake.module, {read: (a, w) => board.read(a, w), write: (a, v, w) => board.write(a, v, w),
    tick: cycles => board.tick(cycles), setMemoryCallbacks: (read, write) => board.setMemoryCallbacks(read, write)},
    {sdramBytes: options.sdramBytes ?? 0x11000});
  bindDisplayTransport(board, cpu, options.audio ?? audioFixtures());
  return {fake, board, cpu};
}
function configureRx(board) {
  for (const [offset, word] of [[0x8c, 16], [0x90, 0], [0x94, 0x10000], [0x98, 0x100f1f10], [0x9c, 0x1f1f0f00]])
    board.write(SAI + offset, word, 4);
  board.write(SAI + 0x88, 0x90000001, 4);
  board.write(DMA_CLOCK, 0xc00c0, 4); // Explicit SAI CG9 and DMA CG3; LPSPI remains off.
  const bytes = new Uint8Array(32), v = new DataView(bytes.buffer);
  v.setUint32(0, SAI + 0xa0, true); v.setUint16(6, 0x0101, true); v.setUint32(8, 32, true);
  v.setUint32(16, RX, true); v.setUint16(20, 2, true); v.setUint16(22, 64, true);
  v.setUint16(28, CSR.DREQ | CSR.INTMAJOR, true); v.setUint16(30, 64, true);
  for (let offset = 0; offset < 32; offset += 4) board.write(TCD_BASE + 4 * 32 + offset, v.getUint32(offset, true), 4);
  board.write(DMAMUX + 4 * 4, (0x80000000 | 19) >>> 0, 4);
  board.write(EDMA + DREG.SERQ, 4, 1);
}
function expectedRx(first = 1) {
  const bytes = new Uint8Array(RX_BYTES), v = new DataView(bytes.buffer);
  for (let n = 0; n < RX_BYTES / 2; n++) v.setUint16(n * 2, first + (n & 15), true);
  return bytes;
}

test('actual ArmCPU 4KiB SDRAM capacity maps only its owned end and the 0x9000 DTCM extent', () => {
  const f = cpuAndBoard();
  const rows = f.cpu.memoryMap, admission = admitStockAudioRam(rows), calls = [];
  assert.equal(rows.find(row => row.name === 'SDRAM').bytes, 0x11000);
  assert.deepEqual(admission.admittedRam, [{start: 0x80000000, bytes: 0x11000}, {start: 0x20000000, bytes: 0x9000}]);
  const bus = new MappedDisplayBus({read(a, n) {calls.push([a, n]); return new Uint8Array(n);}, write() {}},
    admission.mappedRam, admission.admittedRam, () => 0);
  bus.read(0x80010fff, 1); bus.read(0x20008ffe, 2, 2);
  for (const [address, bytes] of [[0x80010fff, 2], [0x80011000, 1], [0x20008fff, 2], [SAI, 1]])
    assert.throws(() => bus.read(address, bytes), DisplayBusFault);
  assert.deepEqual(calls, [[0x80010fff, 1], [0x20008ffe, 2]]);
  assert.equal(f.fake.events.some(event => event[0] === 'start'), false);
  f.board.disposeDisplayTransport(); f.cpu.close();
});

test('full RX major queues actual DTCM writes during Board tick and drains before earned IRQ4 service', () => {
  let f, pending = false; const observations = [];
  f = cpuAndBoard({plan: ordinaryHooks, onIrq(irq, asserted) {
    if (irq === 4) {
      pending = asserted;
      if (asserted) observations.push(['accepted', f.fake.engines[0].mem_read(RX + RX_BYTES - 2, 2)[0], f.fake.engines[0].inStart]);
    }
  }});
  f.cpu.writeMemory(RX, new Uint8Array(RX_BYTES).fill(0xff)); configureRx(f.board);
  f.cpu.onInstruction(() => {
    if (!pending) return;
    assert.deepEqual(f.fake.engines[0].mem_read(RX, RX_BYTES), expectedRx());
    assert.ok(f.board.read(0xe000e200, 4) & (1 << 4), 'normal Board IRQ path owns pending evidence');
    observations.push(['service', f.fake.engines[0].mem_read(RX + RX_BYTES - 2, 2)[0], f.fake.engines[0].inStart]);
    f.board.write(EDMA + DREG.CINT, 4, 1);
  });
  f.cpu.writeRegister('pc', 0x1000); const result = f.cpu.step(25000);
  assert.equal(result.reason, 'budget'); assert.equal(result.instructions, 25000);
  assert.deepEqual(observations, [['accepted', 0xff, true], ['service', 16, true]]);
  const writes = f.fake.events.filter(event => event[0] === 'memoryWrite' && event[1] >= RX && event[1] < RX + RX_BYTES && event[2] === 2);
  assert.equal(writes.length, 1024); assert.ok(writes.every(event => event[3] === false));
  assert.equal(f.board.displayTransportStatus().edma.errors, 0);
  assert.equal(f.board.displayTransportStatus().clocks.lpspiEnabled, false);
  assert.equal(f.board.status().ticks, 0, 'transport progressed with GPT disabled');
  assert.equal(f.board.status().frameCount, 0);
  f.board.disposeDisplayTransport(); f.cpu.close();
});

for (const failure of ['write', 'cache']) test(`actual queued RX ${failure} failure prevents next IRQ listener and retains earlier accepted RAM`, () => {
  let f, pending = false, services = 0;
  f = cpuAndBoard({plan: ordinaryHooks, onIrq(irq, asserted) {if (irq === 4) pending = asserted;}});
  f.cpu.writeMemory(RX, new Uint8Array(RX_BYTES).fill(0xff)); configureRx(f.board);
  const failingAddress = RX + RX_BYTES - 2;
  if (failure === 'write') f.fake.failWrite(address => address === failingAddress);
  else f.fake.failCache(address => address === failingAddress);
  f.cpu.onInstruction(() => {if (pending) services++;});
  f.cpu.writeRegister('pc', 0x1000); const result = f.cpu.step(25000);
  assert.equal(result.reason, 'fault'); assert.match(result.fault, /controlled drain/);
  assert.equal(pending, true); assert.equal(services, 0);
  assert.deepEqual(f.fake.engines[0].mem_read(RX, RX_BYTES - 2), expectedRx().slice(0, -2));
  assert.deepEqual(f.fake.engines[0].mem_read(failingAddress, 2), failure === 'write' ? Uint8Array.of(0xff, 0xff) : Uint8Array.of(16, 0));
  f.board.disposeDisplayTransport(); f.cpu.close();
});

test('two actual Board/CPU owners retain separate FIFOs, DTCM writes and IRQ levels', () => {
  const a = cpuAndBoard({plan: ordinaryHooks, audio: audioFixtures(1)});
  const b = cpuAndBoard({plan: ordinaryHooks, audio: audioFixtures(101)});
  for (const f of [a, b]) {f.cpu.writeMemory(RX, new Uint8Array(RX_BYTES).fill(0xff)); configureRx(f.board); f.cpu.writeRegister('pc', 0x1000);}
  a.cpu.step(25000);
  assert.deepEqual(a.fake.engines[0].mem_read(RX, RX_BYTES), expectedRx(1));
  assert.deepEqual(b.fake.engines[0].mem_read(RX, RX_BYTES), new Uint8Array(RX_BYTES).fill(0xff));
  assert.equal(b.board.displayTransportStatus().phases, 0);
  assert.equal(b.board.read(0xe000e200, 4) & (1 << 4), 0);
  b.cpu.step(25000); assert.deepEqual(b.fake.engines[0].mem_read(RX, RX_BYTES), expectedRx(101));
  for (const f of [a, b]) {f.board.disposeDisplayTransport(); f.cpu.close();}
});

test('Board callback rebind and disposal cancel a partial RX minor while retaining its accepted prefix', () => {
  for (const action of ['rebind', 'dispose']) {
    const f = cpuAndBoard(); configureRx(f.board);
    let reached = false;
    for (let n = 0; n < 1000; n++) {
      f.board.tick(1);
      if (f.board.displayTransportStatus().edma.audio.partialMinors.some(row => row.channel === 4 && row.beat === 3)) {reached = true; break;}
    }
    assert.equal(reached, true, 'finite ordinary ticks reach one partial minor');
    assert.deepEqual(f.fake.engines[0].mem_read(RX, 6), expectedRx().slice(0, 6));
    const writes = f.fake.events.filter(event => event[0] === 'memoryWrite').length;
    if (action === 'rebind') {
      f.board.setMemoryCallbacks(f.cpu.readMemory.bind(f.cpu), f.cpu.queueDeviceWrite.bind(f.cpu));
      assert.deepEqual(f.board.displayTransportStatus().edma.audio.partialMinors, []);
    } else f.board.disposeDisplayTransport();
    f.board.tick(100);
    assert.deepEqual(f.fake.engines[0].mem_read(RX, 6), expectedRx().slice(0, 6));
    assert.equal(f.fake.events.filter(event => event[0] === 'memoryWrite').length, writes);
    assert.equal(f.fake.events.some(event => event[0] === 'start'), false);
    f.board.disposeDisplayTransport(); f.cpu.close();
  }
});

test('actual Session owns audio input through reset, disposes before close and never starts its fake engine', async () => {
  const fake = recordingModule(), input = audioFixtures(21);
  const session = await createSession(Uint8Array.of(1, 2, 3, 4), {format: 'app1', audioFixtures: input,
    cpuOptions: {factory: async () => fake.module, sdramBytes: 0x11000}});
  input.rxFrame.fill(0); input.externalClock = false;
  assert.deepEqual(session.board.displayTransportStatus().audio.fixtures.rxFrame, audioFixtures(21).rxFrame);
  assert.equal(session.board.displayTransportStatus().audio.fixtures.externalClock, true);
  const first = fake.engines[0], close = first.close.bind(first);
  first.close = () => {assert.equal(session.board.displayTransportStatus(), undefined); close();};
  await session.reset();
  assert.equal(first.closed, true); assert.equal(fake.engines.length, 2);
  assert.deepEqual(session.board.displayTransportStatus().audio.fixtures.rxFrame, audioFixtures(21).rxFrame);
  const status = session.board.displayTransportStatus();
  assert.deepEqual(session.snapshot().displayTransport, status);
  assert.deepEqual(session.board.displayTransportStatus(), status, 'snapshot remains passive');
  session.close(); assert.equal(session.board.displayTransportStatus(), undefined);
  assert.equal(fake.engines[1].closed, true);
  assert.equal(fake.events.some(event => event[0] === 'start'), false);
});

test('optional audio binding validates finite owned inputs and leaves default legacy RX/display available', async () => {
  const fixture = audioFixtures(9), owned = ownAudioFixtures(fixture); fixture.rxFrame.fill(0);
  assert.deepEqual(owned.rxFrame, audioFixtures(9).rxFrame); assert.ok(Object.isFrozen(owned.rxFrame));
  for (const bad of [null, {...audioFixtures(), slotTicks: 0}, {...audioFixtures(), rxFrame: [1]}, {...audioFixtures(), externalClock: undefined}])
    assert.throws(() => ownAudioFixtures(bad), RangeError);
  const fake = recordingModule();
  const session = await createSession(Uint8Array.of(1, 2, 3, 4), {format: 'app1', cpuOptions: {factory: async () => fake.module}});
  assert.equal(session.board.displayTransportStatus().audio, undefined);
  session.board.write(SAI + 0x94, 0x10000, 4); session.board.write(SAI + 0x98, 0x10000000, 4);
  session.board.write(SAI + 0x88, 0x90000000, 4);
  assert.equal(session.board.injectAudioRx([0x12345678]), 1);
  assert.equal(session.board.read(SAI + 0xa0, 4), 0x12345678);
  assert.equal(fake.events.some(event => event[0] === 'start'), false); session.close();
});


test('createSession owns audio fixtures before its first await, including caller mutation while pending', async () => {
  const fake = recordingModule(), input = audioFixtures(41);
  const pending = createSession(Uint8Array.of(1, 2, 3, 4), {format: 'app1', audioFixtures: input,
    cpuOptions: {factory: async () => fake.module, sdramBytes: 0x11000}});
  input.rxFrame.fill(0); input.externalClock = false; input.slotTicks = 999;
  const session = await pending;
  const owned = session.board.displayTransportStatus().audio.fixtures;
  assert.deepEqual(owned.rxFrame, audioFixtures(41).rxFrame);
  assert.equal(owned.externalClock, true); assert.equal(owned.slotTicks, 8);
  assert.equal(fake.events.some(event => event[0] === 'start'), false);
  session.close();
});
