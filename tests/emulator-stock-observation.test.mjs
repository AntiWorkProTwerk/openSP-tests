import assert from 'node:assert/strict';
import test from 'node:test';
import {observeStockList, observeCompletedStockCheckpoint, retainStockCheckpoint, STOCK_SHA256} from '../tools/stock-list-observation.ts';

// Synthetic scalar/RAM fixtures only. No CPU factory, engine or guest image.
const OCRAM = 0x20200000, OCRAM_END = 0x202c0000;
const SDRAM = 0x80000000, SDRAM_END = 0x84000000;
const HEAD = 0x202bcf30, TIMER = 0x202bcf20, TASK = 0x20210000;
const NODE = TASK + 76, CURSOR = 0x20220000;
const CURRENT = 0x202bbbfc, SELECTED = 0x202bbc00;
const GUARD = 0x202bbbf8, SDRAM_GUARD = 0x80245764;
const SECRET = 'private-fake-adapter-error-must-not-be-retained';
const FORBIDDEN = new Set(['step', 'writeMemory', 'writeRegister', 'loadMemory', 'stop', 'close',
  'onInstruction', 'queueDeviceWrite', 'synchronizeInstructionState']);
const MASKS = {basepri: 0x60, primask: 1, faultmask: 0, control: 2};

function context(patch = {}) {
  const {scalars = {}, ...rest} = patch;
  return {firmwareSha256: STOCK_SHA256, wholeStockImage: true, scatterVerified: true,
    state: 'paused', reason: 'budget', sliceInstructions: 250000,
    cpuBackendFailed: false, mailboxCached: false,
    scalars: {pc: 0xd912, xpsr: 0x81000000, lr: 0x40f3, sp: 0x2020077c,
      r0: NODE, r1: CURSOR, r2: 0x80000002, r3: HEAD, r4: 0x80000064,
      r5: 0x80000064, r7: 100, ...scalars}, ...rest};
}

function fixture(ctx = context(), options = {}) {
  const memory = new Map(), registers = {...MASKS, ...options.registers};
  const access = [], forbidden = [];
  const putByte = (address, value) => memory.set(address, value & 255);
  const putWord = (address, value) => {
    for (let index = 0; index < 4; index++) putByte(address + index, value >>> (index * 8));
  };
  putWord(TIMER, 0xfffffffc); putWord(TIMER + 4, 2);
  putWord(HEAD, ctx.scalars.r1); putWord(HEAD + 4, ctx.scalars.r0);
  for (const [index, value] of [ctx.scalars.r1, HEAD, 0x80000066, 0xe000e011, 0x40000000].entries()) {
    putWord(ctx.scalars.r0 + index * 4, value);
  }
  if (ctx.scalars.r1 !== ctx.scalars.r0 && ctx.scalars.r1 !== HEAD) {
    for (const [index, value] of [HEAD, ctx.scalars.r0, 0x80000065].entries()) putWord(ctx.scalars.r1 + index * 4, value);
  }
  const task = options.taskPointer ?? TASK;
  putWord(CURRENT, task); putWord(SELECTED, 0xe000e010);
  putWord(GUARD, 1); putWord(SDRAM_GUARD, 2);
  putByte(task + 35, 4); putByte(task + 96, 2);
  // A value next to the sentinel must never become a cursor deadline read.
  putWord(HEAD + 8, 0xf00dcafe);
  const target = {
    backendFailed: options.backendFailed ?? false,
    memoryMap: options.memoryMap ?? [
      {name: 'OCRAM', address: OCRAM, bytes: OCRAM_END - OCRAM, permissions: 7},
      {name: 'SDRAM', address: SDRAM, bytes: SDRAM_END - SDRAM, permissions: 7},
    ],
    readRegister(name) {
      access.push({kind: 'register', name});
      options.onRegister?.(name, target, access);
      return registers[name];
    },
    readMemory(address, length) {
      access.push({kind: 'memory', address, bytes: length});
      const override = options.onMemory?.(address, length, target, access);
      if (override !== undefined) return override;
      return Uint8Array.from({length}, (_, index) => memory.get(address + index) ?? 0);
    },
  };
  const cpu = new Proxy(target, {get(object, property, receiver) {
    if (FORBIDDEN.has(property)) {
      forbidden.push(property);
      assert.fail(`The passive observer accessed forbidden CPU API ${property}`);
    }
    return Reflect.get(object, property, receiver);
  }});
  return {cpu, target, memory, registers, access, forbidden, putByte, putWord, ctx,
    observe: () => observeStockList(cpu, ctx)};
}

const memoryReads = f => f.access.filter(call => call.kind === 'memory');
const registerReads = f => f.access.filter(call => call.kind === 'register');
const includesAddress = (range, address) => address >= range.address && address < range.address + range.bytes;
const byteSet = ranges => new Set(ranges.flatMap(range => Array.from({length: range.bytes}, (_, index) => range.address + index)));
function allowedRanges(ctx, task = TASK, derived = true) {
  return [{address: TIMER, bytes: 8}, {address: HEAD, bytes: 8},
    {address: ctx.scalars.r0, bytes: 20}, {address: ctx.scalars.r1, bytes: ctx.scalars.r1 === HEAD ? 8 : 12},
    {address: CURRENT, bytes: 4}, {address: SELECTED, bytes: 4},
    {address: GUARD, bytes: 4}, {address: SDRAM_GUARD, bytes: 4},
    ...(derived ? [{address: task + 35, bytes: 1}, {address: task + 96, bytes: 1}] : [])];
}

function assertPassive(f, result, {task = TASK, derived = true, complete = false} = {}) {
  const reads = memoryReads(f), allowed = byteSet(allowedRanges(f.ctx, task, derived));
  assert.deepEqual(f.forbidden, []);
  const requested = reads.reduce((sum, read) => sum + read.bytes, 0);
  assert.ok(requested <= 66, `Attempted ${requested} RAM bytes`);
  assert.ok(result.requestedBytes <= 66); assert.ok(result.distinctBytes <= 66);
  for (const read of reads) {
    assert.ok(Number.isSafeInteger(read.address) && read.address >= 0 && read.address <= 0xffffffff);
    assert.ok(Number.isSafeInteger(read.bytes) && read.bytes > 0);
    assert.ok(f.target.memoryMap.some(region => ['OCRAM', 'SDRAM'].includes(region.name) && (region.permissions & 1) &&
      read.address >= region.address && read.address + read.bytes <= region.address + region.bytes));
    const canonical = read.address >= OCRAM && read.address + read.bytes <= OCRAM_END ||
      read.address >= SDRAM && read.address + read.bytes <= SDRAM_END;
    assert.ok(canonical);
    for (let address = read.address; address < read.address + read.bytes; address++) {
      assert.ok(allowed.has(address), `Read unplanned byte 0x${address.toString(16)}`);
    }
  }
  if (complete) {
    assert.deepEqual(byteSet(reads), allowed);
    assert.equal(requested, allowed.size, 'Each authorized byte is fetched at most once');
    assert.equal(result.requestedBytes, requested); assert.equal(result.distinctBytes, allowed.size);
    assert.ok(result.ranges.every(range => range.completed));
  }
  const inspect = value => {
    assert.ok(!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value), 'Raw backing bytes leaked into result');
    if (typeof value === 'string') assert.ok(!value.includes(SECRET));
    if (value && typeof value === 'object') for (const item of Object.values(value)) inspect(item);
  };
  inspect(result);
}

test('the local diagnostic observer uses the pinned stock identity and reads exactly the finite source fields', () => {
  assert.equal(STOCK_SHA256, '4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80');
  const f = fixture(), result = f.observe();
  assert.equal(result.status, 'observed'); assert.deepEqual(result.registers, MASKS);
  assert.deepEqual(registerReads(f).map(read => read.name).sort(), Object.keys(MASKS).sort());
  assert.deepEqual(Object.keys(result.fields).sort(), ['timerState', 'listHead', 'insertionNode', 'cursor',
    'currentTask', 'selectedTask', 'guard202BBBF8', 'guard80245764', 'currentTaskState', 'currentTaskFlags'].sort());
  assert.deepEqual(result.fields.timerState, {address: TIMER, bytes: 8, values: {tickLow: 0xfffffffc, tickHigh: 2}});
  assert.deepEqual(result.fields.insertionNode, {address: NODE, bytes: 20,
    values: {next: CURSOR, previous: HEAD, deadline: 0x80000066, callback: 0xe000e011, callbackArgument: 0x40000000}});
  assert.deepEqual(result.fields.currentTaskState.values, {state: 4});
  assert.deepEqual(result.fields.currentTaskFlags.values, {flags: 2});
  assertPassive(f, result, {complete: true}); assert.equal(result.distinctBytes, 66);
});

test('eligibility failures cause no register or RAM adapter calls', () => {
  const patches = [
    {firmwareSha256: '0'.repeat(64)}, {firmwareSha256: STOCK_SHA256.toUpperCase()},
    {wholeStockImage: false}, {scatterVerified: false}, {state: 'running'}, {state: 'fault'},
    {reason: 'stopped'}, {reason: 'fault'}, {sliceInstructions: 249999}, {sliceInstructions: 250001},
    {sliceInstructions: 250000.5}, {cpuBackendFailed: true}, {mailboxCached: true},
    {scalars: {pc: 0xd910}}, {scalars: {pc: 0xd924}}, {scalars: {pc: 0xd913}},
    {scalars: {r3: HEAD + 4}},
  ];
  for (const patch of patches) {
    const f = fixture(context(patch)), result = f.observe();
    assert.ok(['ineligible', 'unavailable'].includes(result.status), JSON.stringify(patch));
    assert.deepEqual(f.access, []); assert.deepEqual(result.fields, {}); assert.equal(result.requestedBytes, 0);
  }
});

test('every existing checkpoint scalar must be an uncoerced uint32', () => {
  for (const scalar of Object.keys(context().scalars)) for (const value of [-1, 0x100000000, 1.5, NaN, Infinity, '100', undefined]) {
    const f = fixture(context({scalars: {[scalar]: value}})), result = f.observe();
    assert.equal(result.status, 'ineligible', `${scalar}=${String(value)}`); assert.deepEqual(f.access, []);
  }
});

test('both source PC endpoints admit live masks without requiring a particular mask value', () => {
  for (const pc of [0xd912, 0xd922]) {
    const registers = {basepri: 0, primask: 0, faultmask: 1, control: 3};
    const f = fixture(context({scalars: {pc}}), {registers}), result = f.observe();
    assert.equal(result.status, 'observed'); assert.deepEqual(result.registers, registers);
    assertPassive(f, result, {complete: true});
  }
});

test('a failed backend cannot qualify through its cached program counter', () => {
  const f = fixture(context(), {backendFailed: true}), result = f.observe();
  assert.equal(result.status, 'unavailable'); assert.deepEqual(f.access, []);
  assert.equal(result.requestedBytes, 0); assert.deepEqual(result.fields, {});
});

test('task/list pointers must be aligned and their complete spans must fit canonical OCRAM', () => {
  for (const scalar of ['r0', 'r1']) for (const address of [OCRAM - 4, OCRAM_END, 0x20210001, 0xfffffffc,
    scalar === 'r0' ? OCRAM_END - 16 : OCRAM_END - 8]) {
    const f = fixture(context({scalars: {[scalar]: address}})), result = f.observe();
    assert.ok(['ineligible', 'partial', 'unavailable'].includes(result.status));
    assert.ok(!memoryReads(f).some(read => includesAddress(read, address)));
    assertPassive(f, result, {derived: false});
  }
});

test('a broad mapping cannot admit source pointers outside canonical OCRAM', () => {
  const f = fixture(context({scalars: {r0: OCRAM_END + 4}}), {memoryMap: [
    {name: 'OCRAM', address: OCRAM, bytes: 0x200000, permissions: 7},
    {name: 'SDRAM', address: SDRAM, bytes: SDRAM_END - SDRAM, permissions: 7},
  ]});
  const result = f.observe(); assert.notEqual(result.status, 'observed');
  assert.ok(!memoryReads(f).some(read => read.address >= OCRAM_END && read.address < SDRAM));
});

test('actual named readable OCRAM and SDRAM mappings are required', () => {
  const maps = [
    [{name: 'MMIO', address: OCRAM, bytes: OCRAM_END - OCRAM, permissions: 7},
      {name: 'SDRAM', address: SDRAM, bytes: SDRAM_END - SDRAM, permissions: 7}],
    [{name: 'OCRAM', address: OCRAM, bytes: OCRAM_END - OCRAM, permissions: 2},
      {name: 'SDRAM', address: SDRAM, bytes: SDRAM_END - SDRAM, permissions: 7}],
    [{name: 'OCRAM', address: OCRAM, bytes: OCRAM_END - OCRAM, permissions: 7},
      {name: 'SDRAM', address: SDRAM, bytes: 0x10000, permissions: 7}],
    [{name: 'OCRAM', address: OCRAM, bytes: OCRAM_END - OCRAM, permissions: 7},
      {name: 'SDRAM', address: SDRAM, bytes: SDRAM_END - SDRAM, permissions: 2}],
    [{name: 'OCRAM', address: OCRAM, bytes: 0xb0000, permissions: 7},
      {name: 'SDRAM', address: SDRAM, bytes: SDRAM_END - SDRAM, permissions: 7}],
  ];
  for (const memoryMap of maps) {
    const f = fixture(context(), {memoryMap}), result = f.observe();
    assert.notEqual(result.status, 'observed'); assertPassive(f, result, {derived: false});
  }
});

test('an aliased insertion node and cursor share their captured words', () => {
  const f = fixture(context({scalars: {r1: NODE}})), result = f.observe();
  assert.equal(result.status, 'observed'); assert.equal(result.fields.cursor.bytes, 12);
  assert.deepEqual(result.fields.cursor.values, {next: NODE, previous: HEAD, deadline: 0x80000066});
  assert.equal(memoryReads(f).filter(read => includesAddress(read, NODE)).length, 1);
  assert.equal(result.distinctBytes, 54); assertPassive(f, result, {complete: true});
});

test('a sentinel cursor reuses exactly its two head links without reading a deadline', () => {
  const f = fixture(context({scalars: {r1: HEAD}})), result = f.observe();
  assert.equal(result.status, 'observed'); assert.equal(result.fields.cursor.bytes, 8);
  assert.deepEqual(result.fields.cursor.values, result.fields.listHead.values);
  assert.equal(Object.hasOwn(result.fields.cursor.values, 'deadline'), false);
  assert.ok(!memoryReads(f).some(read => includesAddress(read, HEAD + 8)));
  assertPassive(f, result, {complete: true}); assert.equal(result.distinctBytes, 54);
});

test('fixed adjacent roots and overlapping or adjacent node/cursor spans coalesce without gaps', () => {
  for (const r1 of [NODE + 8, NODE + 20]) {
    const f = fixture(context({scalars: {r1}})), result = f.observe();
    assert.equal(result.status, 'observed'); assertPassive(f, result, {complete: true});
    assert.equal(memoryReads(f).filter(read => includesAddress(read, GUARD) || includesAddress(read, SELECTED)).length, 1);
    assert.equal(memoryReads(f).filter(read => includesAddress(read, NODE) || includesAddress(read, r1 + 8)).length, 1);
  }
  const f = fixture(), result = f.observe();
  assert.ok(!memoryReads(f).some(read => includesAddress(read, TIMER + 8)), 'Timer/head gap was read');
  assertPassive(f, result, {complete: true});
});

test('task byte addresses come from the captured current-task pointer, not R0 or selected task', () => {
  const task = 0x20230000, f = fixture(context(), {taskPointer: task}), result = f.observe();
  assert.equal(result.status, 'observed');
  assert.equal(result.fields.currentTask.values.pointer, task);
  assert.equal(result.fields.currentTaskState.address, task + 35);
  assert.equal(result.fields.currentTaskFlags.address, task + 96);
  assertPassive(f, result, {task, complete: true});
  assert.ok(!memoryReads(f).some(read => includesAddress(read, 0xe000e010)));
});

test('invalid current-task pointers or either derived range yield partial evidence and no derived reads', () => {
  for (const task of [0, OCRAM - 4, OCRAM_END, TASK + 1, 0xffffffa0, OCRAM_END - 96]) {
    const f = fixture(context(), {taskPointer: task}), result = f.observe();
    assert.equal(result.status, 'partial');
    assert.equal(result.fields.currentTask.values.pointer, task);
    assert.equal(result.fields.currentTaskState, undefined); assert.equal(result.fields.currentTaskFlags, undefined);
    assertPassive(f, result, {derived: false});
  }
});

test('derived bytes already captured by a source field are reused without extra reads', () => {
  const task = NODE - 32, f = fixture(context(), {taskPointer: task}), result = f.observe();
  assert.equal(result.status, 'observed'); assert.equal(result.fields.currentTaskState.address, NODE + 3);
  assert.equal(memoryReads(f).filter(read => includesAddress(read, NODE + 3)).length, 1);
  assertPassive(f, result, {task, complete: true}); assert.equal(result.distinctBytes, 65);
});

test('captured list links, callback and callback argument remain opaque values', () => {
  const f = fixture();
  f.putWord(NODE, 0xffffffff); f.putWord(NODE + 4, 0x40000000);
  f.putWord(NODE + 12, 0xe000e011); f.putWord(NODE + 16, 0x60080001);
  const result = f.observe(); assert.equal(result.status, 'observed');
  assert.equal(result.fields.insertionNode.values.next, 0xffffffff);
  assert.equal(result.fields.insertionNode.values.callback, 0xe000e011);
  assert.equal(result.fields.insertionNode.values.callbackArgument, 0x60080001);
  assertPassive(f, result, {complete: true});
});

test('register errors stop immediately without exposing adapter error text', () => {
  const f = fixture(context(), {onRegister: name => {if (name === 'primask') throw new Error(SECRET);}});
  const result = f.observe(); assert.ok(['partial', 'unavailable'].includes(result.status));
  assert.deepEqual(registerReads(f).map(read => read.name), ['basepri', 'primask']);
  assert.equal(result.registers.basepri, MASKS.basepri); assert.deepEqual(memoryReads(f), []);
  assert.equal(typeof result.error?.operation, 'string'); assert.equal(typeof result.error?.code, 'string');
  assertPassive(f, result, {derived: false});
});

test('invalid mask values are not silently truncated or captured', () => {
  for (const value of [-1, 0x100000000, 1.5, NaN, Infinity, '96']) {
    const f = fixture(context(), {registers: {basepri: value}}), result = f.observe();
    assert.ok(['partial', 'unavailable'].includes(result.status)); assert.equal(result.registers.basepri, undefined);
    assert.equal(f.access.length, 1); assert.deepEqual(memoryReads(f), []);
    assertPassive(f, result, {derived: false});
  }
});

test('a backend failure set during a register read stops all later adapter calls', () => {
  const f = fixture(context(), {onRegister: (name, cpu) => {if (name === 'primask') cpu.backendFailed = true;}});
  const result = f.observe(); assert.ok(['partial', 'unavailable'].includes(result.status));
  assert.deepEqual(registerReads(f).map(read => read.name), ['basepri', 'primask']);
  assert.deepEqual(memoryReads(f), []); assert.equal(result.registers.basepri, MASKS.basepri);
  assertPassive(f, result, {derived: false});
});

test('memory errors and short or non-byte results stop at the first failed read', () => {
  for (const mode of ['throw', 'short', 'wrong-type']) {
    const f = fixture(context(), {onMemory: (_address, length) => {
      if (mode === 'throw') throw new Error(SECRET);
      return mode === 'short' ? new Uint8Array(length - 1) : new Uint32Array(length);
    }});
    const result = f.observe(); assert.ok(['partial', 'unavailable'].includes(result.status));
    assert.equal(memoryReads(f).length, 1); assert.deepEqual(result.registers, MASKS);
    assert.deepEqual(result.fields, {}); assert.equal(typeof result.error?.code, 'string');
    assertPassive(f, result, {derived: false});
  }
});

test('a later memory failure preserves captured scalar fields and stops subsequent reads', () => {
  const f = fixture(context(), {onMemory: (_address, _length, _cpu, access) => {
    if (access.filter(call => call.kind === 'memory').length === 2) throw new Error(SECRET);
  }});
  const result = f.observe(); assert.ok(['partial', 'unavailable'].includes(result.status));
  assert.equal(memoryReads(f).length, 2); assert.ok(Object.keys(result.fields).length > 0);
  assert.deepEqual(result.registers, MASKS); assertPassive(f, result, {derived: false});
});

test('a backend failure during memory read stops before another range is requested', () => {
  const f = fixture(context(), {onMemory: (_address, _length, cpu) => {cpu.backendFailed = true;}});
  const result = f.observe(); assert.ok(['partial', 'unavailable'].includes(result.status));
  assert.equal(memoryReads(f).length, 1); assertPassive(f, result, {derived: false});
});

test('observations own their scalar results and keep CPU/context instances independent', () => {
  const left = fixture(), right = fixture(context(), {registers: {basepri: 0x40}, taskPointer: 0x20230000});
  right.putWord(TIMER, 1234);
  const before = structuredClone(left.ctx), leftMemory = [...left.memory], leftMap = structuredClone(left.target.memoryMap);
  const first = left.observe(), retained = structuredClone(first), second = right.observe();
  assert.equal(first.status, 'observed'); assert.equal(second.status, 'observed');
  assert.equal(first.registers.basepri, 0x60); assert.equal(second.registers.basepri, 0x40);
  assert.equal(first.fields.timerState.values.tickLow, 0xfffffffc); assert.equal(second.fields.timerState.values.tickLow, 1234);
  assert.deepEqual(left.ctx, before); assert.deepEqual([...left.memory], leftMemory); assert.deepEqual(left.target.memoryMap, leftMap);
  left.putWord(TIMER, 5678); left.registers.basepri = 0x20;
  const next = left.observe(); assert.equal(next.fields.timerState.values.tickLow, 5678); assert.equal(next.registers.basepri, 0x20);
  assert.deepEqual(first, retained); assert.notEqual(first.fields.timerState, next.fields.timerState);
  assertPassive(right, second, {task: 0x20230000, complete: true});
});

const hexWord = value => `0x${value.toString(16).padStart(8, '0')}`;
function callerFixture(options = {}) {
  const f = fixture(context(), options), total = 20266151;
  f.target.totalInstructions = total;
  const checkpoint = {state: 'paused', firmwareHash: STOCK_SHA256, format: 'app1',
    instructions: total, pc: hexWord(f.ctx.scalars.pc), cpuBackendFailed: false,
    mailboxCached: false, powered: true,
    architecture: {available: true, xpsr: hexWord(f.ctx.scalars.xpsr), registers:
      Object.fromEntries(Object.entries(f.ctx.scalars).filter(([name]) => !['pc', 'xpsr'].includes(name))
        .map(([name, value]) => [name, hexWord(value)]))},
    frames: 0, flash: {commandCount: 5},
    exceptions: {pending: [14, 15], active: [], timer: {enabled: true, value: 1234}},
    pendingInterrupts: [14, 15]};
  const step = {reason: 'budget', instructions: 250000, totalInstructions: total, pc: f.ctx.scalars.pc};
  const history = {cpu: f.cpu, previousTotalInstructions: total - 250000, requestedSliceInstructions: 250000,
    image: {sha256: STOCK_SHA256, format: 'app1', bytes: 2652672, suppliedHandoff: true,
      reconstructedRuntimeSubstitution: false},
    scatter: {passed: true, checkpointReached: true, checkpoint: '0x60080622',
      regionChecks: Array.from({length: 12}, (_, index) => ({index, matches: true,
        actualSha256: index.toString(16).repeat(64), expectedSha256: index.toString(16).repeat(64)}))}};
  const session = {cpu: f.cpu, state: 'paused'};
  return {f, session, checkpoint, step, history,
    observe: () => observeCompletedStockCheckpoint(session, checkpoint, step, history),
    retain: () => retainStockCheckpoint(session, checkpoint, step, history)};
}

function denied(mutate, label) {
  const c = callerFixture(); mutate(c);
  assert.equal(c.observe(), undefined, label);
  assert.deepEqual(c.f.access, [], label);
  if (c.foreign) assert.deepEqual(c.foreign.access, [], label);
}

test('completed-checkpoint admission reads only masks and finite RAM after using retained scalar evidence', () => {
  const c = callerFixture(), before = structuredClone(c.checkpoint), result = c.observe();
  assert.equal(result.status, 'observed'); assert.deepEqual(result.scalars, c.f.ctx.scalars);
  assert.deepEqual(c.checkpoint, before);
  assert.deepEqual(registerReads(c.f).map(call => call.name), ['basepri', 'primask', 'faultmask', 'control']);
  assertPassive(c.f, result, {complete: true});
});

test('the wrapper binds the same healthy paused CPU, snapshot and live counter before any adapter call', () => {
  const cases = [
    ['different history CPU', c => {c.foreign = fixture(); c.history.cpu = c.foreign.cpu;}],
    ['replaced session CPU', c => {c.foreign = fixture(); c.foreign.target.totalInstructions = c.step.totalInstructions; c.session.cpu = c.foreign.cpu;}],
    ['running session', c => {c.session.state = 'running';}],
    ['loaded session', c => {c.session.state = 'loaded';}],
    ['faulted session', c => {c.session.state = 'fault';}],
    ['running snapshot', c => {c.checkpoint.state = 'running';}],
    ['failed current CPU', c => {c.f.target.backendFailed = true;}],
    ['failed snapshot backend', c => {c.checkpoint.cpuBackendFailed = true;}],
    ['cached mailbox', c => {c.checkpoint.mailboxCached = true;}],
    ['unpowered snapshot', c => {c.checkpoint.powered = false;}],
    ['snapshot fault', c => {c.checkpoint.fault = 'guest fault';}],
    ['null fault is not absent', c => {c.checkpoint.fault = null;}],
    ['advanced live counter', c => {c.f.target.totalInstructions++;}],
  ];
  for (const [label, mutate] of cases) denied(mutate, label);
});

test('whole-image identity requires exact stock bytes, handoff and no reconstructed runtime substitution', () => {
  const cases = [
    ['different image hash', c => {c.history.image.sha256 = '0'.repeat(64);}],
    ['noncanonical image hash', c => {c.history.image.sha256 = STOCK_SHA256.toUpperCase();}],
    ['different retained firmware', c => {c.checkpoint.firmwareHash = '1'.repeat(64);}],
    ['flash image', c => {c.history.image.format = 'flash';}],
    ['different snapshot format', c => {c.checkpoint.format = 'flash';}],
    ['wrong occupied length', c => {c.history.image.bytes--; }],
    ['missing supplied handoff', c => {c.history.image.suppliedHandoff = false;}],
    ['substituted runtime', c => {c.history.image.reconstructedRuntimeSubstitution = true;}],
    ['unknown substitution status', c => {delete c.history.image.reconstructedRuntimeSubstitution;}],
  ];
  for (const [label, mutate] of cases) denied(mutate, label);
});

test('scatter admission requires twelve distinct matching region identities at the original checkpoint', () => {
  const cases = [
    ['failed scatter', c => {c.history.scatter.passed = false;}],
    ['unreached checkpoint', c => {c.history.scatter.checkpointReached = false;}],
    ['different scatter checkpoint', c => {c.history.scatter.checkpoint = '0x60080624';}],
    ['noncanonical checkpoint', c => {c.history.scatter.checkpoint = '0X60080622';}],
    ['missing region', c => {c.history.scatter.regionChecks.pop();}],
    ['additional region', c => {c.history.scatter.regionChecks.push({...c.history.scatter.regionChecks[0]});}],
    ['duplicated index', c => {c.history.scatter.regionChecks[11].index = 10;}],
    ['invalid lower index', c => {c.history.scatter.regionChecks[0].index = -1;}],
    ['invalid upper index', c => {c.history.scatter.regionChecks[11].index = 12;}],
    ['fractional index', c => {c.history.scatter.regionChecks[0].index = 0.5;}],
    ['unverified region', c => {c.history.scatter.regionChecks[0].matches = false;}],
    ['uppercase actual hash', c => {c.history.scatter.regionChecks[10].actualSha256 = 'A'.repeat(64);}],
    ['short actual hash', c => {c.history.scatter.regionChecks[0].actualSha256 = '0'.repeat(63);}],
    ['nonhex actual hash', c => {c.history.scatter.regionChecks[0].actualSha256 = 'g'.repeat(64);}],
    ['region hash mismatch', c => {c.history.scatter.regionChecks[0].expectedSha256 = '1'.repeat(64);}],
  ];
  for (const [label, mutate] of cases) denied(mutate, label);
});

test('slice and history counters must describe the same completed ordinary 250000-start interval', () => {
  const cases = [
    ['short requested slice', c => {c.history.requestedSliceInstructions = 249999;}],
    ['faulted step', c => {c.step.reason = 'fault';}],
    ['stopped step', c => {c.step.reason = 'stopped';}],
    ['short completed slice', c => {c.step.instructions = 249999;}],
    ['oversized completed slice', c => {c.step.instructions = 250001;}],
    ['zero completed slice', c => {c.step.instructions = 0;}],
    ['stale previous counter', c => {c.history.previousTotalInstructions++;}],
    ['stale step total', c => {c.step.totalInstructions++;}],
    ['stale snapshot total', c => {c.checkpoint.instructions++;}],
    ['negative previous counter', c => {c.history.previousTotalInstructions = -1;}],
    ['unsafe addition', c => {c.history.previousTotalInstructions = Number.MAX_SAFE_INTEGER;}],
    ['fractional snapshot counter', c => {c.checkpoint.instructions += 0.5;}],
    ['string live counter', c => {c.f.target.totalInstructions = String(c.step.totalInstructions);}],
    ['unavailable live counter', c => {delete c.f.target.totalInstructions;}],
    ['different step PC', c => {c.step.pc += 2;}],
    ['string step PC', c => {c.step.pc = c.checkpoint.pc;}],
    ['odd matched PC', c => {c.step.pc++; c.checkpoint.pc = hexWord(c.step.pc);}],
    ['outside matched PC', c => {c.step.pc = 0xd924; c.checkpoint.pc = hexWord(c.step.pc);}],
    ['unexpected head', c => {c.checkpoint.architecture.registers.r3 = hexWord(HEAD + 4);}],
  ];
  for (const [label, mutate] of cases) denied(mutate, label);
});

test('every retained architecture scalar must parse from canonical lowercase eight-digit hex', () => {
  for (const name of Object.keys(context().scalars)) {
    for (const value of ['0X00000000', '0x0000D912', '0xd912', '0x100000000', '0xzzzzzzzz', 0xd912, null, undefined]) {
      denied(c => {
        if (name === 'pc') c.checkpoint.pc = value;
        else if (name === 'xpsr') c.checkpoint.architecture.xpsr = value;
        else c.checkpoint.architecture.registers[name] = value;
      }, `${name}=${String(value)}`);
    }
  }
  denied(c => {c.checkpoint.architecture.available = false;}, 'unavailable architecture');
  denied(c => {c.checkpoint.architecture = undefined;}, 'missing architecture');
  denied(c => {c.checkpoint.architecture.registers = undefined;}, 'missing registers');
});

test('observation output excludes unrelated retained architecture properties', () => {
  const c = callerFixture();
  c.checkpoint.architecture.registers.r9 = '0x00000000';
  c.checkpoint.architecture.registers.privateExtra = new Uint8Array([1, 2, 3]);
  c.checkpoint.architecture.privateExtra = SECRET;
  const result = c.observe(); assert.equal(result.status, 'observed');
  assert.deepEqual(Object.keys(result.scalars).sort(), Object.keys(context().scalars).sort());
  assert.equal(Object.hasOwn(result.scalars, 'r9'), false);
  assertPassive(c.f, result, {complete: true});
});

test('adapter failures remain explicit observations without dropping the ordinary compact checkpoint', () => {
  const c = callerFixture({onRegister: () => {throw new Error(SECRET);}}), retained = c.retain();
  assert.equal(retained.listObservation.status, 'unavailable');
  assert.equal(typeof retained.listObservation.error.code, 'string');
  assert.equal(retained.pc, c.checkpoint.pc); assert.equal(retained.reason, c.step.reason);
  assert.equal(retained.totalInstructions, c.checkpoint.instructions); assert.equal(retained.state, 'paused');
  assert.equal(retained.mailboxCached, false); assert.deepEqual(retained.exceptions, c.checkpoint.exceptions);
  assert.deepEqual(retained.pendingInterrupts, c.checkpoint.pendingInterrupts);
  assert.deepEqual(memoryReads(c.f), []); assertPassive(c.f, retained.listObservation, {derived: false});
});

test('all forty ordinary compact records survive with observation admission limited to thirty-six list checkpoints', () => {
  const c = callerFixture(), records = [], snapshots = [], exceptions = [], pending = [];
  const firstPCs = [0xdef4, 0xd49a, 0x436, 0xfb2c];
  const listPCs = [0xd920, 0xd91c, 0xd918, 0xd914, 0xd922, 0xd91e, 0xd91a, 0xd916, 0xd912];
  const begin = 19016151;
  for (let index = 0; index < 40; index++) {
    const pc = index < 4 ? firstPCs[index] : listPCs[(index - 4) % listPCs.length];
    const total = begin + (index + 1) * 250000;
    const checkpoint = {...c.checkpoint, pc: hexWord(pc), instructions: total,
      exceptions: {sample: index, pending: [14, 15]}, pendingInterrupts: [14, 15],
      frames: index, flash: {commandCount: index + 1}};
    const step = {...c.step, pc, totalInstructions: total};
    const history = {...c.history, previousTotalInstructions: total - 250000};
    c.f.target.totalInstructions = total;
    const callStart = c.f.access.length;
    const retained = retainStockCheckpoint(c.session, checkpoint, step, history);
    const calls = c.f.access.slice(callStart);
    assert.equal(retained.pc, checkpoint.pc); assert.equal(retained.architecture, checkpoint.architecture);
    assert.equal(retained.reason, 'budget'); assert.equal(retained.totalInstructions, total);
    assert.equal(retained.displayFrames, index); assert.equal(retained.flashCommandCount, index + 1);
    assert.equal(retained.cpuBackendFailed, false); assert.equal(retained.powered, true);
    assert.equal(retained.state, checkpoint.state); assert.equal(retained.mailboxCached, false);
    assert.deepEqual(retained.exceptions, checkpoint.exceptions); assert.notEqual(retained.exceptions, checkpoint.exceptions);
    assert.deepEqual(retained.pendingInterrupts, checkpoint.pendingInterrupts); assert.notEqual(retained.pendingInterrupts, checkpoint.pendingInterrupts);
    if (index < 4) {assert.equal(retained.listObservation, undefined); assert.deepEqual(calls, []);}
    else {
      assert.equal(retained.listObservation.status, 'observed');
      assert.equal(retained.listObservation.scalars.pc, pc);
      assert.equal(calls.filter(call => call.kind === 'register').length, 4);
      assert.ok(calls.filter(call => call.kind === 'memory').reduce((sum, call) => sum + call.bytes, 0) <= 66);
    }
    snapshots.push(checkpoint); exceptions.push(structuredClone(checkpoint.exceptions)); pending.push([...checkpoint.pendingInterrupts]); records.push(retained);
  }
  assert.equal(records.length, 40); assert.equal(records.filter(record => record.listObservation).length, 36);
  for (const checkpoint of snapshots) {checkpoint.exceptions.pending.push(99); checkpoint.pendingInterrupts.push(99);}
  for (const [index, record] of records.entries()) {
    assert.deepEqual(record.exceptions, exceptions[index]); assert.deepEqual(record.pendingInterrupts, pending[index]);
  }
  assert.deepEqual(c.f.forbidden, []);
});

const rangeRecords = ranges => ranges.map(({address, bytes, completed}) => ({address, bytes, completed}));

test('failed memory range counters describe exactly the one attempted incomplete read', () => {
  const f = fixture(context(), {onMemory: () => {throw new Error(SECRET);}}), result = f.observe();
  const [read] = memoryReads(f); assert.equal(result.status, 'unavailable');
  assert.deepEqual(rangeRecords(result.ranges), [{address: read.address, bytes: read.bytes, completed: false}]);
  assert.equal(result.requestedBytes, read.bytes); assert.equal(result.distinctBytes, read.bytes);
  assert.equal(memoryReads(f).length, 1); assertPassive(f, result, {derived: false});
});

test('a task-flag read error preserves all fixed fields and the already captured task-state byte', () => {
  const f = fixture(context(), {onMemory: address => {if (address === TASK + 96) throw new Error(SECRET);}});
  const result = f.observe(); assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.fields.currentTaskState.values, {state: 4}); assert.equal(result.fields.currentTaskFlags, undefined);
  assert.equal(Object.keys(result.fields).length, 9);
  const last = memoryReads(f).at(-1); assert.deepEqual(last, {kind: 'memory', address: TASK + 96, bytes: 1});
  assert.deepEqual(rangeRecords(result.ranges.filter(range => !range.completed)), [{address: TASK + 96, bytes: 1, completed: false}]);
  assert.equal(result.requestedBytes, 66); assert.equal(result.distinctBytes, 66);
  assertPassive(f, result);
});

test('backend loss during a derived task byte stops before the other derived byte is read', () => {
  const f = fixture(context(), {onMemory: (address, _length, cpu) => {if (address === TASK + 35) cpu.backendFailed = true;}});
  const result = f.observe(); assert.equal(result.status, 'unavailable');
  assert.equal(Object.keys(result.fields).length, 8); assert.equal(result.fields.currentTaskState, undefined);
  assert.equal(result.fields.currentTaskFlags, undefined);
  assert.ok(!memoryReads(f).some(read => includesAddress(read, TASK + 96)));
  assert.deepEqual(rangeRecords(result.ranges.filter(range => !range.completed)), [{address: TASK + 35, bytes: 1, completed: false}]);
  assert.equal(result.requestedBytes, 65); assert.equal(result.distinctBytes, 65); assertPassive(f, result);
});
