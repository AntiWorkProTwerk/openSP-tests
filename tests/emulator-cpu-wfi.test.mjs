import assert from 'node:assert/strict';
import test from 'node:test';
import {ArmCPU} from '../src/lib/emulator/cpu.ts';

// This object only publishes controlled callbacks and register results. It does
// not decode or execute instructions and never imports a native/WASM engine.
const fixtures = [];
test.afterEach(() => {for (const f of fixtures.splice(0)) assert.equal(f.reads.length, 0, 'marker integration must never attempt an opcode read');});

function fixture(plan, CPU = ArmCPU, onTick) {
  let engine;
  const reads = [];
  const calls = [];
  const ticks = [];
  const bytes = new Map([[0x1000, 0x30], [0x1001, 0xbf]]);
  let markerFailure;
  let marker;
  let callbacks;
  class FakeEngine {
    registers = new Map([[10, 0x1000]]);
    hooks = new Map();
    attempt = 0;
    stopped = false;
    constructor() {engine = this;}
    ctl_set_cpu_model() {}
    ctl_get_cpu_model() {return 7;}
    ctl_remove_cache(...args) {calls.push(['cache', ...args]);}
    reg_write_i32(register, value) {calls.push(['writeRegister', register]); this.registers.set(register, value >>> 0);}
    reg_read_i32(register) {calls.push(['readRegister', register]); return this.registers.get(register) ?? 0;}
    mem_map() {}
    mem_read(address, length) {
      calls.push(['readMemory', address, length]); reads.push({address, length});
      throw new Error('unexpected fake opcode read');
    }
    mem_write(address, data) {calls.push(['writeMemory', address, data.length]); data.forEach((byte, index) => bytes.set(address + index, byte));}
    hook_add(type, callback) {this.hooks.set(type, callback); return {handle: type, callback: type};}
    hook_del() {calls.push(['hook_del']);}
    emu_stop() {calls.push(['stop']); this.stopped = true;}
    arm_wfi_event() {
      calls.push(['marker']); assert.equal(this, engine, 'getter receiver must be the actual engine');
      if (markerFailure) throw markerFailure;
      return marker;
    }
    emu_start(begin, until, timeout, count) {
      calls.push(['start', begin, until, timeout, count]); this.stopped = false; marker = undefined;
      this.registers.set(10, begin & 0xfffffffe);
      plan({
        attempt: ++this.attempt, count, begin,
        hook: (address = 0x1000, size = 2) => {this.registers.set(10, address); this.hooks.get(3)(0, address, size);},
        pc: value => this.registers.set(10, value >>> 0),
        stopped: () => this.stopped,
        event: value => {marker = value;},
      });
    }
    close() {calls.push(['close']);}
  }
  const module = {Unicorn: FakeEngine, ARCH_ARM: 1, MODE_THUMB: 2, CPU_ARM_CORTEX_M7: 7,
    HOOK_MEM_READ: 1, HOOK_MEM_WRITE: 2, HOOK_CODE: 3, ARM_REG_PC: 10, ARM_REG_R0: 11};
  const cpu = new CPU(module, {read: () => undefined, write() {}, tick: value => {ticks.push(value); onTick?.(value);},
    setMemoryCallbacks: (read, write) => {callbacks = {read, write};}});
  const f = {cpu, engine, reads, calls, ticks, bytes, callbacks,
    failMarker: value => {markerFailure = value;},
    missingGetter: () => {engine.arm_wfi_event = undefined;},
    discoveryFailure: value => Object.defineProperty(engine, 'arm_wfi_event', {get() {calls.push(['markerDiscovery']); throw value;}}),
  };
  fixtures.push(f); return f;
}

const wfiEvent = (address = 0x1000) => ({kind: 'wfi', address, resumePc: address + 2, size: 2});
const haltedWfi = ({hook, pc, stopped, event}) => {hook(); if (!stopped()) {pc(0x1002); event(wfiEvent());}};
const unmarkedExit = ({hook, pc, stopped}) => {hook(); if (!stopped()) pc(0x1002);};
const noSleep = result => {assert.equal(result.sleep, undefined);};

test('healthy approved same-attempt marker exit publishes sleep without CPU restart', () => {
  const f = fixture(haltedWfi);
  const result = f.cpu.step(4);
  assert.deepEqual(result.sleep, {kind: 'wfi', address: 0x1000, resumePc: 0x1002});
  assert.equal(result.reason, 'stopped'); assert.equal(result.instructions, 1);
  assert.equal(result.totalInstructions, 1); assert.deepEqual(f.ticks, [1]);
  assert.deepEqual(f.reads, []); assert.equal(f.calls.filter(call => call[0] === 'marker').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'start').length, 1);
});

test('ordinary hook path adds no memory or condition-register reads; read-only marker query follows budget return', () => {
  let f; f = fixture(({hook, pc}) => {
    hook(0x1000); assert.equal(f.reads.length, 0);
    hook(0x1002); assert.equal(f.reads.length, 0); pc(0x1004);
  });
  const result = f.cpu.step(2);
  assert.equal(result.reason, 'budget'); noSleep(result);
  assert.deepEqual(f.reads, []); assert.equal(f.calls.filter(call => call[0] === 'marker').length, 1);
  assert.ok(f.calls.filter(call => call[0] === 'readRegister').every(call => call[1] === 10));
});

test('exact count budget ending on a real-WFI marker retains executed-WFI evidence and unchanged budget result', () => {
  const f = fixture(haltedWfi); const result = f.cpu.step(1);
  assert.equal(result.reason, 'budget'); assert.equal(result.instructions, 1); assert.equal(result.totalInstructions, 1);
  assert.deepEqual(result.sleep, {kind: 'wfi', address: 0x1000, resumePc: 0x1002});
  assert.deepEqual(f.reads, []); assert.equal(f.calls.filter(call => call[0] === 'marker').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'start').length, 1);
});

test('count stop before next callback preserves approved count and stays excluded', () => {
  const f = fixture(({hook, pc}) => {hook(); pc(0x1002); hook(0x1002);});
  const result = f.cpu.step(1); assert.equal(result.instructions, 1); noSleep(result);
  assert.equal(f.reads.length, 0);
});

for (const until of [0, 0x1002]) test(`explicit until ${until} is excluded`, () => {
  const f = fixture(haltedWfi); noSleep(f.cpu.step(4, {until})); assert.equal(f.reads.length, 0);
});

test('explicit stop in callback neither approves/counts nor queries marker', () => {
  const f = fixture(haltedWfi); f.cpu.onInstruction(() => f.cpu.stop());
  const result = f.cpu.step(4); noSleep(result); assert.equal(result.instructions, 0);
  assert.deepEqual(f.ticks, []); assert.equal(f.reads.length, 0);
});

test('explicit stop after an approved hook is excluded even at matching next PC', () => {
  let f; f = fixture(({hook, pc}) => {hook(); pc(0x1002); f.cpu.stop();});
  const result = f.cpu.step(4); assert.equal(result.instructions, 1); noSleep(result);
  assert.equal(f.reads.length, 0);
});

test('ordinary callback failure keeps original fault handling', () => {
  const f = fixture(haltedWfi); f.cpu.onInstruction(() => {throw new Error('finite callback failure');});
  const result = f.cpu.step(4); assert.equal(result.reason, 'fault'); noSleep(result);
  assert.match(result.fault, /finite callback failure/); assert.equal(f.reads.length, 0);
});

test('ordinary backend error excludes classification without terminal tagging', () => {
  const f = fixture(({hook}) => {hook(); throw new Error('finite fake guest error');});
  const result = f.cpu.step(4); assert.equal(result.reason, 'fault'); noSleep(result);
  assert.equal(result.backendLost, undefined); assert.equal(f.reads.length, 0);
});

test('injected terminal backend error excludes classification and all later engine calls', () => {
  const f = fixture(({hook}) => {hook(); throw new WebAssembly.RuntimeError('injected fake terminal');});
  const result = f.cpu.step(4); assert.equal(result.backendLost, true); noSleep(result);
  const count = f.calls.length; f.cpu.step(4); f.cpu.stop(); f.cpu.close();
  assert.equal(f.calls.length, count); assert.equal(f.reads.length, 0);
});

test('pending device write without helper evidence stays stopped after drain', () => {
  let f; f = fixture(({hook, pc}) => {hook(); f.callbacks.write(0x1000, Uint8Array.of(0x30, 0xbf)); pc(0x1002);});
  const result = f.cpu.step(4); noSleep(result); assert.equal(f.reads.length, 0);
  assert.ok(f.calls.some(call => call[0] === 'cache'));
});

test('internal executable write followed by an unmarked retry stays unclassified', () => {
  const f = fixture(({hook, pc, attempt}) => {hook(); if (attempt === 2) pc(0x1002);});
  f.cpu.onInstruction(() => {if (f.engine.attempt === 1) f.cpu.writeMemory(0x1000, Uint8Array.of(0x30, 0xbf));});
  const result = f.cpu.step(4); noSleep(result); assert.equal(result.instructions, 1);
  assert.equal(f.engine.attempt, 2); assert.equal(f.reads.length, 0);
});

test('internal cache invalidation followed by an unmarked retry stays unclassified', () => {
  const f = fixture(({hook, pc, attempt}) => {hook(); if (attempt === 2) pc(0x1002);});
  f.cpu.onInstruction(() => {if (f.engine.attempt === 1) f.cpu.synchronizeInstructionState(0x1000, 2);});
  const result = f.cpu.step(4); noSleep(result); assert.equal(result.instructions, 1);
  assert.equal(f.engine.attempt, 2); assert.equal(f.reads.length, 0);
});

test('64 no-progress preparation guard remains a healthy bounded fault', () => {
  const f = fixture(({hook}) => hook());
  f.cpu.onInstruction(() => f.cpu.synchronizeInstructionState(0x1000, 2));
  const result = f.cpu.step(4); assert.equal(result.reason, 'fault'); noSleep(result);
  assert.match(result.fault, /64 internal restarts/); assert.equal(f.engine.attempt, 64);
  assert.equal(result.instructions, 0); assert.equal(result.backendLost, undefined);
});

test('stale approved metadata from a prior public call cannot classify an empty return', () => {
  const f = fixture(({hook, pc, attempt, event}) => {if (attempt === 1) {hook(); event(wfiEvent());} pc(0x1002);});
  assert.ok(f.cpu.step(4).sleep); const priorReads = f.reads.length;
  const result = f.cpu.step(4); noSleep(result); assert.equal(result.instructions, 0);
  assert.equal(f.reads.length, priorReads);
});

test('empty final internal attempt cannot reuse a previous attempted hook', () => {
  const f = fixture(({hook, pc, attempt, event}) => {if (attempt === 1) {hook(); event(wfiEvent());} pc(0x1002);});
  f.cpu.onInstruction(() => f.cpu.synchronizeInstructionState(0x1000, 2));
  noSleep(f.cpu.step(4)); assert.equal(f.reads.length, 0);
});

test('callback PC changes exclude a subsequently matching return', () => {
  const f = fixture(haltedWfi); f.cpu.onInstruction(() => f.cpu.writeRegister('pc', 0x1010));
  noSleep(f.cpu.step(4)); assert.equal(f.reads.length, 0);
});

for (const [name, opcode] of [['NOP', 0xbf00], ['WFE', 0xbf20]]) test(`${name} remains plain stopped`, () => {
  const f = fixture(unmarkedExit); f.bytes.set(0x1000, opcode & 255); f.bytes.set(0x1001, opcode >>> 8);
  const result = f.cpu.step(4); noSleep(result); assert.equal(result.reason, 'stopped');
  assert.equal(f.reads.length, 0); assert.equal(f.calls.filter(call => call[0] === 'marker').length, 1);
});

test('wide approved instruction remains unclassified without marker query', () => {
  const f = fixture(({hook, pc}) => {hook(0x1000, 4); pc(0x1004);});
  noSleep(f.cpu.step(4)); assert.equal(f.reads.length, 0);
});

test('PC mismatch is rejected before marker query', () => {
  const f = fixture(({hook, pc}) => {hook(); pc(0x1004);});
  noSleep(f.cpu.step(4)); assert.equal(f.reads.length, 0);
});

for (const address of [0x10000000, 0x40000000, 0x1001]) test(`unmapped/nonexecutable/unaligned ${address} is excluded before marker query`, () => {
  const f = fixture(({hook, pc}) => {hook(address); pc(address + 2);});
  noSleep(f.cpu.step(4)); assert.equal(f.reads.length, 0);
});

test('absent execution marker leaves a healthy plain stop', () => {
  const f = fixture(unmarkedExit);
  const result = f.cpu.step(4); noSleep(result); assert.equal(result.reason, 'stopped');
  assert.equal(result.backendLost, undefined);
});

test('ordinary marker-getter error leaves a healthy plain stop', () => {
  const f = fixture(haltedWfi); f.failMarker(new Error('finite fake marker error'));
  const result = f.cpu.step(4); noSleep(result); assert.equal(result.reason, 'stopped');
  assert.equal(result.backendLost, undefined);
});

test('injected terminal marker-getter failure tags backend loss and blocks further calls', () => {
  const f = fixture(haltedWfi); f.failMarker(new WebAssembly.RuntimeError('injected fake marker terminal'));
  const result = f.cpu.step(4); noSleep(result); assert.equal(result.reason, 'fault');
  assert.equal(result.backendLost, true); assert.equal(result.pc, 0x1002);
  const count = f.calls.length; const later = f.cpu.step(4); f.cpu.stop(); f.cpu.close();
  assert.equal(later.pc, 0x1002); assert.equal(later.backendLost, true);
  assert.equal(f.calls.length, count);
});

test('a new approved attempt uses the actual mapped high address', () => {
  const address = 0x80001000;
  const f = fixture(({hook, pc, event}) => {hook(address); pc(address + 2); event(wfiEvent(address));});
  f.bytes.set(address, 0x30); f.bytes.set(address + 1, 0xbf);
  assert.deepEqual(f.cpu.step(4).sleep, {kind: 'wfi', address, resumePc: address + 2});
});


// The original 36-case runner is retained byte-for-byte under before/. This
// derivative replaces opcode-read oracles with explicit fake helper-event data.
test('exact two-start budget records the last approved WFI without adding starts or restarting', () => {
  const f = fixture(({hook, pc, event}) => {hook(0x1000); hook(0x1002); pc(0x1004); event(wfiEvent(0x1002));});
  f.bytes.set(0x1000, 0); f.bytes.set(0x1001, 0xbf);
  f.bytes.set(0x1002, 0x30); f.bytes.set(0x1003, 0xbf);
  const result = f.cpu.step(2);
  assert.equal(result.reason, 'budget'); assert.equal(result.instructions, 2); assert.equal(result.totalInstructions, 2);
  assert.deepEqual(result.sleep, {kind: 'wfi', address: 0x1002, resumePc: 0x1004});
  assert.deepEqual(f.ticks, [1, 1]); assert.equal(f.engine.attempt, 1);
});

test('callback attempts beyond the requested count are stopped and cannot publish WFI metadata', () => {
  const f = fixture(({hook, pc}) => {hook(0x1000); hook(0x1002); hook(0x1004); pc(0x1004);});
  f.bytes.set(0x1002, 0x30); f.bytes.set(0x1003, 0xbf);
  const result = f.cpu.step(2);
  assert.equal(result.reason, 'budget'); assert.equal(result.instructions, 2); assert.equal(result.totalInstructions, 2);
  noSleep(result); assert.equal(f.reads.length, 0); assert.deepEqual(f.ticks, [1, 1]);
});

test('exact-budget WFI metadata cannot leak into a later zero-progress call at the same PC', () => {
  const f = fixture(({hook, pc, attempt, event}) => {if (attempt === 1) {hook(); event(wfiEvent());} pc(0x1002);});
  const first = f.cpu.step(1); assert.equal(first.reason, 'budget'); assert.ok(first.sleep);
  const second = f.cpu.step(1); noSleep(second); assert.equal(second.instructions, 0);
  assert.equal(second.totalInstructions, 1); assert.equal(f.reads.length, 0); assert.equal(f.calls.filter(call => call[0] === 'marker').length, 1);
});

test('exact budget still excludes callback PC changes', () => {
  const f = fixture(haltedWfi); f.cpu.onInstruction(() => f.cpu.writeRegister('pc', 0x1010));
  const result = f.cpu.step(1); assert.equal(result.reason, 'budget'); noSleep(result); assert.equal(f.reads.length, 0);
});

test('exact budget still excludes configured until', () => {
  const f = fixture(haltedWfi); const result = f.cpu.step(1, {until: 0x1002});
  assert.equal(result.reason, 'budget'); noSleep(result); assert.equal(f.reads.length, 0);
});

test('exact-budget marker ambiguity preserves budget and counts without sleep metadata', () => {
  const f = fixture(haltedWfi); f.failMarker(new Error('finite fake budget marker error'));
  const result = f.cpu.step(1); assert.equal(result.reason, 'budget'); noSleep(result);
  assert.equal(result.instructions, 1); assert.equal(result.backendLost, undefined);
});

test('injected exact-budget terminal marker error preserves counts and coherent cached PC', () => {
  const f = fixture(haltedWfi); f.failMarker(new WebAssembly.RuntimeError('injected fake budget marker terminal'));
  const result = f.cpu.step(1); assert.equal(result.reason, 'fault'); noSleep(result);
  assert.equal(result.instructions, 1); assert.equal(result.backendLost, true); assert.equal(result.pc, 0x1002);
  const calls = f.calls.length; const later = f.cpu.step(1); f.cpu.stop(); f.cpu.close();
  assert.equal(later.pc, 0x1002); assert.equal(f.calls.length, calls);
});

// Marker-specific finite FFI/data oracles. No native engine is loaded.
test('missing optional capability preserves healthy plain stop', () => {
  const f = fixture(haltedWfi); f.missingGetter(); const r = f.cpu.step(4);
  noSleep(r); assert.equal(r.reason, 'stopped'); assert.equal(r.backendLost, undefined);
  assert.equal(f.calls.filter(c => c[0] === 'marker').length, 0);
});

for (const value of [null, false, 'private sentinel', [], {},
  {kind: 'wfe', address: 0x1000, resumePc: 0x1002, size: 2},
  {...wfiEvent(), size: 4}, {...wfiEvent(), address: '4096'},
  {...wfiEvent(), address: -1}, {...wfiEvent(), address: 0x100000000},
  {...wfiEvent(), resumePc: 4098.5}, {...wfiEvent(), resumePc: NaN},
  {...wfiEvent(), resumePc: Infinity}, wfiEvent(0x1002),
  {...wfiEvent(), resumePc: 0x1004}]) {
  test(`malformed or stale marker ${JSON.stringify(value)} is not admitted`, () => {
    const f = fixture(({hook, pc, event}) => {hook(); pc(0x1002); event(value);});
    const r = f.cpu.step(1); noSleep(r); assert.equal(r.reason, 'budget');
    assert.equal(r.instructions, 1); assert.equal(r.backendLost, undefined);
  });
}

test('extra event fields are never published or evaluated', () => {
  let extraReads = 0;
  const value = {...wfiEvent(), ownerPrivate: 'private extra sentinel'};
  Object.defineProperty(value, 'extraGetter', {get() {extraReads++; throw new Error('private accessor');}, enumerable: true});
  const f = fixture(({hook, pc, event}) => {hook(); pc(0x1002); event(value);});
  const r = f.cpu.step(1); assert.deepEqual(r.sleep, {kind: 'wfi', address: 0x1000, resumePc: 0x1002});
  assert.equal(extraReads, 0); assert.equal(JSON.stringify(r).includes('private extra sentinel'), false);
});

test('marker admission does not depend on post-call opcode bytes', () => {
  const f = fixture(haltedWfi); f.bytes.set(0x1000, 0); f.bytes.set(0x1001, 0);
  assert.deepEqual(f.cpu.step(4).sleep, {kind: 'wfi', address: 0x1000, resumePc: 0x1002});
});

for (const terminal of [false, true]) test(`optional method discovery failure terminal=${terminal} is guarded`, () => {
  const f = fixture(haltedWfi);
  f.discoveryFailure(terminal ? new WebAssembly.RuntimeError('injected fake discovery terminal') : new Error('finite fake discovery error'));
  const r = f.cpu.step(1); noSleep(r); assert.equal(r.instructions, 1); assert.equal(r.pc, 0x1002);
  assert.equal(r.reason, terminal ? 'fault' : 'budget'); assert.equal(r.backendLost, terminal ? true : undefined);
  assert.equal(f.calls.filter(c => c[0] === 'markerDiscovery').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'marker').length, 0);
  if (terminal) {const n = f.calls.length; f.cpu.step(1); f.cpu.stop(); f.cpu.close(); assert.equal(f.calls.length, n);}
});

for (const terminal of [false, true]) test(`returned scalar accessor failure terminal=${terminal} is guarded`, () => {
  const value = {...wfiEvent()}; let attempts = 0;
  Object.defineProperty(value, 'address', {get() {attempts++; throw terminal ? new WebAssembly.RuntimeError('injected fake scalar terminal') : new Error('finite fake scalar error');}});
  const f = fixture(({hook, pc, event}) => {hook(); pc(0x1002); event(value);});
  const r = f.cpu.step(1); noSleep(r); assert.equal(attempts, 1); assert.equal(r.pc, 0x1002);
  assert.equal(r.reason, terminal ? 'fault' : 'budget'); assert.equal(r.backendLost, terminal ? true : undefined);
  if (terminal) {const n = f.calls.length; f.cpu.step(1); f.cpu.stop(); f.cpu.close(); assert.equal(f.calls.length, n);}
});

// Additional fixtures use controlled JavaScript callbacks only. No ARM decoding,
// native engine, WASM import, guest firmware or browser participates.
function dmaThenFreshMarker(CPU = ArmCPU, mode = 'fresh', finalTick) {
  let f;
  f = fixture(({attempt, hook, pc, event, stopped}) => {
    if (attempt === 1) {
      hook(0x1000);
      pc(0x1002);
      event(wfiEvent(0x1000));
      hook(0x1002); // The queued device write stops before approving this hook.
      assert.equal(stopped(), true);
    } else {
      if (mode === 'empty') {pc(0x1002); return;}
      hook(0x1002);
      pc(0x1004);
      if (mode !== 'unmarked') event(wfiEvent(0x1002));
    }
  }, CPU, () => {
    if (f.engine.attempt === 1) f.callbacks.write(0x80001000, Uint8Array.of(0x5a));
    else finalTick?.(f);
  });
  return f;
}

test('fresh final-attempt fake WFI survives an earlier ordinary DMA drain', () => {
  const f = dmaThenFreshMarker();
  const result = f.cpu.step(4);
  assert.equal(result.instructions, 2); assert.equal(result.totalInstructions, 2);
  assert.equal(result.reason, 'stopped'); assert.equal(result.pc, 0x1004);
  assert.deepEqual(result.sleep, {kind: 'wfi', address: 0x1002, resumePc: 0x1004});
  assert.equal(f.engine.attempt, 2); assert.deepEqual(f.ticks, [1, 1]);
  assert.equal(f.bytes.get(0x80001000), 0x5a);
  const events = f.calls.map(call => call[0]);
  const starts = events.flatMap((kind, index) => kind === 'start' ? [index] : []);
  const write = f.calls.findIndex(call => call[0] === 'writeMemory' && call[1] === 0x80001000);
  assert.ok(starts[0] < write && write < starts[1], 'DMA write drains between native attempts');
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 1);
});

test('final-attempt pending DMA write preserves its validated marker after successful drain', () => {
  let f;
  f = fixture(({hook, pc, event}) => {hook(); pc(0x1002); event(wfiEvent());}, ArmCPU,
    () => f.callbacks.write(0x80001000, Uint8Array.of(0x5a)));
  const result = f.cpu.step(4);
  assert.equal(result.instructions, 1); assert.deepEqual(result.sleep, {kind: 'wfi', address: 0x1000, resumePc: 0x1002});
  assert.equal(f.bytes.get(0x80001000), 0x5a);
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 1);
});

test('a stale fake marker from the drained attempt cannot classify the final unmarked attempt', () => {
  const f = dmaThenFreshMarker(ArmCPU, 'unmarked');
  const result = f.cpu.step(4);
  assert.equal(result.instructions, 2); noSleep(result);
  assert.equal(f.engine.attempt, 2);
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 1);
});

test('an empty final attempt cannot use earlier approved instructions or a stale fake marker', () => {
  const f = dmaThenFreshMarker(ArmCPU, 'empty');
  const result = f.cpu.step(4);
  assert.equal(result.instructions, 1); noSleep(result);
  assert.equal(f.engine.attempt, 2);
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 0);
});

test('explicit stop in a fresh final attempt remains excluded after an earlier DMA drain', () => {
  const f = dmaThenFreshMarker();
  f.cpu.onInstruction(() => {if (f.engine.attempt === 2) f.cpu.stop();});
  const result = f.cpu.step(4);
  assert.equal(result.instructions, 1); noSleep(result);
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 0);
});

test('earlier callback PC changes remain excluded across the private DMA retry', () => {
  const f = dmaThenFreshMarker();
  f.cpu.onInstruction(() => {if (f.engine.attempt === 1) f.cpu.writeRegister('pc', 0x1010);});
  const result = f.cpu.step(4);
  assert.equal(result.instructions, 2); noSleep(result);
  assert.equal(f.engine.attempt, 2);
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 0);
});

test('a final cache preparation yield cannot publish a matching fake WFI marker', () => {
  const f = dmaThenFreshMarker(ArmCPU, 'fresh', owned => owned.cpu.synchronizeInstructionState(0x1002, 2));
  const result = f.cpu.step(2);
  assert.equal(result.instructions, 2); noSleep(result);
  assert.equal(result.reason, 'budget'); assert.equal(f.engine.attempt, 2);
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 0);
});

function queuedWriteMarker(marker = wfiEvent(), mode = 'queued') {
  let f;
  f = fixture(({hook, pc, event}) => {hook(); pc(0x1002); if (marker !== undefined) event(marker);}, ArmCPU, () => {
    if (mode === 'internal-write') f.cpu.writeMemory(0x80001000, Uint8Array.of(0x5a));
    else f.callbacks.write(0x80001000, Uint8Array.of(0x5a));
    if (mode === 'invalidate') f.cpu.synchronizeInstructionState(0x1000, 2);
  });
  return f;
}

test('same-attempt WFI is published only after exact queued write and cache effects finish', () => {
  const f = queuedWriteMarker(); const getter = f.engine.arm_wfi_event;
  f.engine.arm_wfi_event = function () {
    assert.equal(this, f.engine); assert.equal(f.bytes.get(0x80001000), 0x5a);
    assert.ok(f.calls.some(call => call[0] === 'cache' && call[1] === 0x80001000));
    return getter.call(this);
  };
  const result = f.cpu.step(4);
  assert.deepEqual(result.sleep, {kind: 'wfi', address: 0x1000, resumePc: 0x1002});
  assert.equal(result.reason, 'stopped'); assert.equal(result.instructions, 1);
  assert.equal(f.engine.attempt, 1); assert.deepEqual(f.ticks, [1]);
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 1);
});

test('a mismatched marker after a successful queued-write drain remains unclassified', () => {
  const f = queuedWriteMarker(wfiEvent(0x1002)); const result = f.cpu.step(4);
  noSleep(result); assert.equal(result.reason, 'stopped'); assert.equal(result.instructions, 1);
  assert.equal(f.bytes.get(0x80001000), 0x5a); assert.equal(f.engine.attempt, 1);
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 1);
});

test('absent helper evidence after a successful queued-write drain remains unclassified', () => {
  const f = queuedWriteMarker(null); const result = f.cpu.step(4);
  noSleep(result); assert.equal(result.reason, 'stopped'); assert.equal(result.instructions, 1);
  assert.equal(f.bytes.get(0x80001000), 0x5a);
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 1);
});

for (const terminal of [false, true]) test(`failed queued-write drain terminal=${terminal} cannot consult marker or publish sleep`, () => {
  const f = queuedWriteMarker();
  f.engine.mem_write = () => {throw terminal ? new WebAssembly.RuntimeError('controlled drain terminal') : new Error('controlled drain failure');};
  const result = f.cpu.step(4); noSleep(result);
  assert.equal(result.reason, 'fault'); assert.equal(result.instructions, 1);
  assert.equal(result.backendLost, terminal ? true : undefined); assert.equal(f.bytes.has(0x80001000), false);
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 0);
  if (terminal) {
    const calls = f.calls.length; f.cpu.step(4); f.cpu.stop(); f.cpu.close();
    assert.equal(f.calls.length, calls);
  }
});

test('failed post-write cache drain preserves accepted RAM effects but excludes marker and sleep', () => {
  const f = queuedWriteMarker(); f.engine.ctl_remove_cache = () => {throw new Error('controlled cache drain failure');};
  const result = f.cpu.step(4); noSleep(result);
  assert.equal(result.reason, 'fault'); assert.equal(f.bytes.get(0x80001000), 0x5a);
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 0);
});

for (const mode of ['internal-write', 'invalidate']) test(`successful queued-write drain keeps the ${mode} exclusion`, () => {
  const f = queuedWriteMarker(wfiEvent(), mode); const result = f.cpu.step(1);
  noSleep(result); assert.equal(result.reason, 'budget'); assert.equal(result.instructions, 1);
  assert.equal(f.bytes.get(0x80001000), 0x5a); assert.equal(f.engine.attempt, 1);
  assert.equal(f.calls.filter(call => call[0] === 'marker').length, 0);
});
