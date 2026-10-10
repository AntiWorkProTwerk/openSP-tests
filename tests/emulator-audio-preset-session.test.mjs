import test from 'node:test';
import assert from 'node:assert/strict';
import {EmulatorSession, createSession} from '../src/lib/emulator/session.ts';
import {STOCK_AUDIO_PRESET} from '../src/lib/emulator/audio-preset.ts';
import {APP1_BASE, APP1_HANDOFF_STACK} from '../src/lib/emulator/image.ts';

// Register and sparse-memory callbacks only. Starting this engine always fails.
function recordingModule() {
  const engines = [];
  class RecordingEngine {
    registers = new Map(); chunks = []; starts = 0; closed = false;
    constructor() {engines.push(this);}
    ctl_set_cpu_model() {}
    ctl_get_cpu_model() {return 7;}
    ctl_remove_cache() {}
    reg_write_i32(register, value) {this.registers.set(register, value >>> 0);}
    reg_read_i32(register) {return this.registers.get(register) ?? 0;}
    mem_map() {}
    mem_write(address, bytes) {this.chunks.push({address, bytes: bytes.slice()});}
    mem_read(address, length) {
      const result = new Uint8Array(length);
      for (const chunk of this.chunks) {
        const start = Math.max(address, chunk.address), end = Math.min(address + length, chunk.address + chunk.bytes.length);
        if (start < end) result.set(chunk.bytes.subarray(start - chunk.address, end - chunk.address), start - address);
      }
      return result;
    }
    hook_add() {return {handle: 1, callback: 1};}
    hook_del() {}
    emu_stop() {}
    emu_start() {this.starts++; throw new Error('Preset lifecycle checks must never start emulation.');}
    close() {this.closed = true;}
  }
  const module = {Unicorn: RecordingEngine, ARCH_ARM: 1, MODE_THUMB: 2, CPU_ARM_CORTEX_M7: 7,
    HOOK_MEM_READ: 1, HOOK_MEM_WRITE: 2, HOOK_CODE: 3};
  ['PC', 'R0', 'MSP', 'PSP', 'CONTROL', 'BASEPRI', 'PRIMASK', 'FAULTMASK', 'LR', 'SP', 'XPSR', 'FPSCR',
    'R1', 'R2', 'R3', 'R12', ...Array.from({length: 32}, (_, n) => `S${n}`)]
    .forEach((name, n) => {module[`ARM_REG_${name}`] = 10 + n;});
  return {module, engines};
}

function metadata() {
  // Synthetic metadata exercises binding, not admission of pristine firmware bytes.
  return {bytes: Uint8Array.of(1, 2, 3, 4), format: 'app1', flashBase: APP1_BASE,
    entry: APP1_BASE | 1, stack: APP1_HANDOFF_STACK,
    sha256: '4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80',
    limits: [], checkpoint: 'resident-app1-handoff'};
}

test('invalid presets reject at constructor and factory entry before any CPU creation', async () => {
  let factories = 0;
  const cpuOptions = {factory: async () => {factories++; throw new Error('No CPU should be requested.');}};
  assert.throws(() => new EmulatorSession(metadata(), {format: 'app1', audioPreset: 'unknown', cpuOptions}), RangeError);
  await assert.rejects(createSession(new Uint8Array(), {format: 'app1', audioPreset: 'unknown', cpuOptions}), RangeError);
  assert.equal(factories, 0);
});

test('createSession captures the selected preset primitive before its first loader await', async () => {
  const fake = recordingModule();
  const options = {format: 'app1', audioPreset: STOCK_AUDIO_PRESET,
    cpuOptions: {factory: async () => fake.module, sdramBytes: 0x11000}};
  const pending = createSession(Uint8Array.of(1, 2, 3, 4), options);
  options.audioPreset = 'unknown';
  const session = await pending;
  try {
    assert.equal(session.board.displayTransportStatus().audio, undefined);
    assert.equal(fake.engines.length, 1);
    assert.equal(fake.engines[0].starts, 0);
  } finally {session.close();}
  assert.equal(fake.engines[0].closed, true);
});

test('ordinary reset rechecks the current image and retires inferred preset audio', async () => {
  const fake = recordingModule();
  const session = new EmulatorSession(metadata(), {format: 'app1', audioPreset: STOCK_AUDIO_PRESET,
    cpuOptions: {factory: async () => fake.module, sdramBytes: 0x11000}});
  try {
    await session.initialize();
    assert.deepEqual(session.board.displayTransportStatus().audio.fixtures.rxFrame, Array(16).fill(0));
    const first = fake.engines[0];
    await session.reset();
    assert.equal(first.closed, true);
    assert.notEqual(session.image.sha256, metadata().sha256);
    assert.equal(session.board.displayTransportStatus().audio, undefined);
    assert.equal(fake.engines.length, 2);
    assert.equal(fake.engines.every(engine => engine.starts === 0), true);
  } finally {session.close();}
  assert.equal(fake.engines.every(engine => engine.closed), true);
});
