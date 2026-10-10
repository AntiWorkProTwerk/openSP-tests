import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {loadFirmwareImage} from '../src/lib/emulator/image.ts';
import {USDHC_REG as R, USDHC_INT as I, USDHC_MIX as M,
  VIRTUAL_SD_GEOMETRY} from '../src/lib/emulator/usdhc.ts';

// Evaluate the production session with only its CPU import replaced. The real
// image admission, board and SD controllers run; every guest step is forbidden.
const cpuStub = 'data:text/javascript;base64,' + Buffer.from([
  'export const instances = [];',
  'export class FakeCPU {',
  '  totalInstructions = 0; backendFailed = false; closeCalls = 0; stepCalls = 0;',
  '  registers = new Map();',
  '  memoryMap = [{name: "SDRAM", address: 0x80000000, bytes: 0x10000, permissions: 3}];',
  '  loadMemory(address, bytes) { this.loadedAddress = address; this.loadedBytes = bytes.length; }',
  '  readMemory(_address, length) { return new Uint8Array(length); }',
  '  writeMemory() {}',
  '  readRegister(name) { return this.registers.get(name) ?? 0; }',
  '  writeRegister(name, value) { this.registers.set(name, value); }',
  '  onInstruction(callback) { this.instructionCallback = callback; }',
  '  stop() {}',
  '  close() { this.closeCalls++; }',
  '  step() { this.stepCalls++; throw new Error("Guest execution is forbidden in SD session tests"); }',
  '}',
  'export async function createCPU(board) { const cpu = new FakeCPU(); board.setMemoryCallbacks(cpu.readMemory.bind(cpu), cpu.writeMemory.bind(cpu)); instances.push(cpu); return cpu; }',
].join('\n')).toString('base64');
const {instances: fakeCpus} = await import(cpuStub);
const sessionUrl = new URL('../src/lib/emulator/session.ts', import.meta.url);
const sessionSource = readFileSync(sessionUrl, 'utf8');
assert.equal(sessionSource.split("from './cpu.ts'").length, 2);
const isolatedSource = sessionSource.replace("from './cpu.ts'", "from '" + cpuStub + "'")
  .replace(/from '(\.\/[^']+)'/g, (_match, target) => "from '" + new URL(target, sessionUrl).href + "'");
const sessionCode = ts.transpileModule(isolatedSource, {
  compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext},
}).outputText;
const {EmulatorSession, createSession} = await import(
  'data:text/javascript;base64,' + Buffer.from(sessionCode).toString('base64'));

const SD1 = 0x402c0000, SD2 = 0x402c4000;
const ENABLE = I.CC | I.TC | I.BRR | I.CTOE | I.DTOE | I.DMAE;
const R1 = 2, R2 = 1, DATA = 0x200000;
const sectorBytes = VIRTUAL_SD_GEOMETRY.sectorBytes;
const cardBytes = VIRTUAL_SD_GEOMETRY.minimumImageBytes;
const benign = () => Uint8Array.of(0xfe, 0xe7, 0xfe, 0xe7);
const image = (seed = 0, size = cardBytes) => Uint8Array.from({length: size},
  (_, index) => (index * 17 + (index >>> 9) + seed) & 255);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = (session, base, offset) => session.board.read(base + offset);
const write = (session, base, offset, value) => session.board.write(base + offset, value);
const status = (session, base) => base === SD1 ? session.board.status().sd1 : session.board.status().sd2;

async function fixture(context, options = {}, useConstructor = false) {
  let session;
  if (useConstructor) {
    const firmware = await loadFirmwareImage(benign(), {format: 'app1', name: 'synthetic.bin'});
    session = new EmulatorSession(firmware, {format: 'app1', name: 'synthetic.bin', ...options});
    await session.initialize();
  } else session = await createSession(benign(), {format: 'app1', name: 'synthetic.bin', ...options});
  context.after(() => session.close());
  return session;
}

function command(session, base, index, argument = 0, response = R1, data = false) {
  write(session, base, R.INT_STATUS, 0xffffffff);
  write(session, base, R.CMD_ARG, argument);
  write(session, base, R.CMD_XFR_TYP, (index << 24) | (response << 16) | (data ? DATA : 0));
  session.board.tick(1);
  return read(session, base, R.CMD_RSP0);
}
function initializeCard(session, base) {
  write(session, base, R.INT_STATUS_EN, ENABLE);
  command(session, base, 0, 0, 0);
  assert.equal(command(session, base, 8, 0x1aa), 0x1aa);
  assert.equal(command(session, base, 55) & 0x20, 0x20);
  assert.equal(command(session, base, 41, 0x40ff8000), 0x80ff8000);
  command(session, base, 2, 0, R2);
  assert.equal(command(session, base, 3) >>> 16, 1);
  command(session, base, 7, 0x10000);
  command(session, base, 16, sectorBytes);
  assert.equal(status(session, base).cardState, 'transfer');
}
function configureRead(session, base) {
  write(session, base, R.INT_STATUS_EN, ENABLE);
  write(session, base, R.PROT_CTRL, 0x08800020 | (status(session, base).cardBusWidth === 4 ? 2 : 0));
  write(session, base, R.WTMK_LVL, 0x08100810);
  write(session, base, R.BLK_ATT, (1 << 16) | sectorBytes);
  write(session, base, R.MIX_CTRL, 0x80000000 | M.READ);
}
function readSector(session, base, address = 0) {
  configureRead(session, base);
  command(session, base, 17, address, R1, true);
  const result = new Uint8Array(sectorBytes), view = new DataView(result.buffer);
  let cursor = 0;
  for (let turn = 0; cursor < sectorBytes && turn < 64; turn++) {
    if (!(read(session, base, R.INT_STATUS) & I.BRR)) {session.board.tick(1); continue;}
    const words = Math.min(read(session, base, R.WTMK_LVL) & 255, (sectorBytes - cursor) / 4);
    assert.ok(words > 0 && words <= 128);
    for (let index = 0; index < words; index++) {
      view.setUint32(cursor, read(session, base, R.DATA_PORT), true); cursor += 4;
    }
    write(session, base, R.INT_STATUS, I.BRR);
    session.board.tick(1);
  }
  assert.equal(cursor, sectorBytes, 'The owned sector drains within a fixed model-turn bound.');
  assert.equal(status(session, base).cardState, 'transfer');
  return result;
}
function holdDigest(context) {
  const original = globalThis.crypto.subtle.digest;
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  context.mock.method(globalThis.crypto.subtle, 'digest', async function (algorithm, bytes) {
    await gate; return original.call(this, algorithm, bytes);
  });
  return release;
}
function assertMetadataOnly(value) {
  assert.equal(value.readOnly, true);
  assert.equal(value.profile, VIRTUAL_SD_GEOMETRY.profile);
  assert.ok(value.imageBytes >= cardBytes);
  const visit = current => {
    assert.equal(current instanceof ArrayBuffer || ArrayBuffer.isView(current), false);
    if (current === null || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      assert.equal(['image', 'data', 'buffer', 'bytes'].includes(key), false);
      if (Array.isArray(child)) assert.ok(child.length < sectorBytes);
      visit(child);
    }
  };
  visit(value);
}

test.after(() => {
  assert.ok(fakeCpus.length > 0);
  assert.ok(fakeCpus.every(cpu => cpu.stepCalls === 0), 'No test executed a guest instruction.');
});

test('direct session construction owns exact typed-array views and ArrayBuffer cards immediately', async context => {
  const firmware = await loadFirmwareImage(benign(), {format: 'app1'});
  const backing = new Uint8Array(cardBytes + 32).fill(0xdd);
  const first = image(11), second = image(93);
  backing.set(first, 16);
  const view = backing.subarray(16, 16 + cardBytes);
  const buffer = second.buffer;
  const options = {format: 'app1', sd1: view, sd2: buffer};
  const session = new EmulatorSession(firmware, options);
  context.after(() => session.close());
  backing.fill(0); second.fill(0); options.sd1 = image(211); options.sd2 = new ArrayBuffer(cardBytes);
  await session.initialize();
  initializeCard(session, SD1); initializeCard(session, SD2);
  assert.deepEqual(readSector(session, SD1), image(11).subarray(0, sectorBytes));
  assert.deepEqual(readSector(session, SD2), image(93).subarray(0, sectorBytes));
  assert.equal(status(session, SD1).imageBytes, cardBytes);
  assert.equal(status(session, SD2).imageBytes, cardBytes);
});

test('createSession owns both cards before asynchronous firmware admission starts', async context => {
  const first = image(17), second = image(81), expectedFirst = first.slice(0, sectorBytes), expectedSecond = second.slice(0, sectorBytes);
  const options = {format: 'app1', sd1: first, sd2: second.buffer};
  const beforeCpus = fakeCpus.length, release = holdDigest(context);
  const pending = createSession(benign(), options);
  first.fill(0); second.fill(0); options.sd1 = null; options.sd2 = null;
  assert.equal(fakeCpus.length, beforeCpus, 'Admission is still waiting before CPU construction.');
  release();
  const session = await pending; context.after(() => session.close());
  initializeCard(session, SD1); initializeCard(session, SD2);
  assert.deepEqual(readSector(session, SD1), expectedFirst);
  assert.deepEqual(readSector(session, SD2), expectedSecond);
});

test('each session and slot owns separate card data, protocol state and diagnostics', async context => {
  const source = image(29), expected = source.slice(0, sectorBytes);
  const first = await fixture(context, {sd1: source, sd2: source});
  const second = await fixture(context, {sd1: source, sd2: source});
  const cards = [first.board.sd1, first.board.sd2, second.board.sd1, second.board.sd2];
  assert.equal(new Set(cards).size, 4);
  source.fill(0);
  initializeCard(first, SD1);
  assert.deepEqual(readSector(first, SD1), expected);
  assert.equal(status(first, SD2).cardState, 'idle');
  assert.equal(status(second, SD1).cardState, 'idle');
  assert.equal(status(second, SD2).cardState, 'idle');
  command(first, SD1, 24, 0, R1, true);
  assert.match(status(first, SD1).lastError, /write-protected/);
  assert.ok(status(first, SD1).unsupported.some(row => /mutation refused/.test(row.reason)));
  for (const [session, base] of [[first, SD2], [second, SD1], [second, SD2]]) {
    assert.equal(status(session, base).lastError, null);
    assert.deepEqual(status(session, base).unsupported, []);
    initializeCard(session, base); assert.deepEqual(readSector(session, base), expected);
  }
  first.board.sd1.setInserted(false);
  assert.equal(status(first, SD1).inserted, false);
  assert.ok([status(first, SD2), status(second, SD1), status(second, SD2)].every(card => card.inserted));
});

test('different cards route independent sector data and fixed controller identities', async context => {
  const first = image(7), second = image(143, cardBytes * 2);
  const session = await fixture(context, {sd1: first.buffer, sd2: second});
  initializeCard(session, SD1); initializeCard(session, SD2);
  assert.deepEqual(readSector(session, SD1, sectorBytes), first.subarray(sectorBytes, sectorBytes * 2));
  assert.deepEqual(readSector(session, SD2, sectorBytes), second.subarray(sectorBytes, sectorBytes * 2));
  assert.equal(status(session, SD1).baseAddress, SD1); assert.equal(status(session, SD1).irq, 110);
  assert.equal(status(session, SD2).baseAddress, SD2); assert.equal(status(session, SD2).irq, 111);
  assert.equal(status(session, SD1).imageBytes, cardBytes);
  assert.equal(status(session, SD2).imageBytes, cardBytes * 2);
});

test('invalid raw card types and geometry reject before firmware hashing or CPU construction', async context => {
  const firmware = await loadFirmwareImage(benign(), {format: 'app1'});
  const overMaximum = new ArrayBuffer(VIRTUAL_SD_GEOMETRY.maximumImageBytes + VIRTUAL_SD_GEOMETRY.capacityUnitBytes);
  const invalid = [null, [], {}, {image: image()}, new Uint16Array(cardBytes / 2),
    new DataView(new ArrayBuffer(cardBytes)), 'local.img', new ArrayBuffer(0),
    new Uint8Array(cardBytes - 1), new ArrayBuffer(cardBytes + 1), overMaximum];
  const beforeCpus = fakeCpus.length;
  let digestCalls = 0;
  context.mock.method(globalThis.crypto.subtle, 'digest', () => {digestCalls++; throw new Error('Unexpected firmware admission');});
  for (const slot of ['sd1', 'sd2']) for (const raw of invalid) {
    const options = {format: 'app1', [slot]: raw};
    assert.throws(() => new EmulatorSession(firmware, options), /sd[12] requires/);
    await assert.rejects(createSession(benign(), options), /sd[12] requires/);
  }
  assert.equal(digestCalls, 0);
  assert.equal(fakeCpus.length, beforeCpus);
});

test('shared and detached card buffers reject before admission', async context => {
  const firmware = await loadFirmwareImage(benign(), {format: 'app1'});
  const detached = new ArrayBuffer(cardBytes);
  const detachedView = new Uint8Array(detached);
  structuredClone(detached, {transfer: [detached]});
  const shared = new SharedArrayBuffer(cardBytes);
  const beforeCpus = fakeCpus.length;
  let digestCalls = 0;
  context.mock.method(globalThis.crypto.subtle, 'digest', () => {digestCalls++; throw new Error('Unexpected firmware admission');});
  for (const raw of [shared, new Uint8Array(shared), detached, detachedView]) {
    assert.throws(() => new EmulatorSession(firmware, {format: 'app1', sd1: raw}), /sd1 requires/);
    await assert.rejects(createSession(benign(), {format: 'app1', sd2: raw}), /sd2 requires/);
  }
  assert.equal(digestCalls, 0); assert.equal(fakeCpus.length, beforeCpus);
});

test('no supplied cards leaves both USDHC windows unknown in session diagnostics', async context => {
  const session = await fixture(context);
  assert.equal(session.board.sd1, undefined); assert.equal(session.board.sd2, undefined);
  for (const base of [SD1, SD2]) {
    assert.equal(read(session, base, R.HOST_CTRL_CAP), undefined);
    write(session, base, R.CMD_ARG, 0x71);
  }
  const snapshot = session.snapshot(), trace = session.trace();
  assert.equal(snapshot.sd1, undefined); assert.equal(snapshot.sd2, undefined);
  assert.equal(trace.sd1, undefined); assert.equal(trace.sd2, undefined);
  assert.equal(snapshot.unknownMmio.length, 4);
  assert.deepEqual(trace.unknownMmio, snapshot.unknownMmio);
});

test('supplying one slot never aliases or implicitly creates the absent slot', async context => {
  for (const [slot, base, absent] of [['sd1', SD1, SD2], ['sd2', SD2, SD1]]) {
    const session = await fixture(context, {[slot]: image()});
    assert.ok(read(session, base, R.HOST_CTRL_CAP) > 0);
    assert.equal(read(session, absent, R.HOST_CTRL_CAP), undefined);
    assert.equal(session.snapshot()[slot].imageBytes, cardBytes);
    assert.equal(session.snapshot()[slot === 'sd1' ? 'sd2' : 'sd1'], undefined);
    assert.deepEqual(session.snapshot().unknownMmio,
      [{address: absent + R.HOST_CTRL_CAP, width: 4, operation: 'read', count: 1}]);
  }
});

test('session reset retains card bytes and protocol while resetting both host controllers and CPU', async context => {
  const first = image(37), second = image(113);
  const session = await fixture(context, {sd1: first, sd2: second});
  initializeCard(session, SD1); initializeCard(session, SD2);
  for (const base of [SD1, SD2]) {
    command(session, base, 55, 0x10000); command(session, base, 6, 2);
    assert.equal(status(session, base).cardBusWidth, 4);
  }
  readSector(session, SD1); readSector(session, SD2);
  command(session, SD1, 24, 0, R1, true);
  command(session, SD2, 55, 0x10000);
  for (const base of [SD1, SD2]) {
    write(session, base, R.INT_SIGNAL_EN, I.CC);
    command(session, base, 13, 0x10000);
    assert.equal(status(session, base).irqAsserted, true);
    write(session, base, R.DS_ADDR, 0x20200000);
  }
  // Authorize an application command in the card before resetting its host.
  command(session, SD2, 55, 0x10000);
  const before = [status(session, SD1), status(session, SD2)];
  const cards = [session.board.sd1, session.board.sd2], cpu = session.cpu;
  const resetCalls = [0, 0];
  cards.forEach((card, index) => {
    const reset = card.resetController.bind(card);
    card.resetController = () => {resetCalls[index]++; reset();};
  });
  const norHash = hash(session.board.flash.flash);
  first.fill(0); second.fill(0);
  await session.reset();
  assert.equal(cpu.closeCalls, 1); assert.notEqual(session.cpu, cpu);
  assert.equal(session.cpu.totalInstructions, 0); assert.equal(session.state, 'loaded');
  assert.equal(hash(session.board.flash.flash), norHash);
  assert.equal(session.board.sd1, cards[0]); assert.equal(session.board.sd2, cards[1]);
  assert.deepEqual(resetCalls, [1, 1]);
  for (const [index, base] of [SD1, SD2].entries()) {
    const after = status(session, base);
    for (const field of ['cardState', 'cardBusWidth', 'blockLength', 'inserted', 'imageBytes',
      'completedCommands', 'completedReads', 'bytesRead', 'unsupported', 'unsupportedOverflow', 'lastError'])
      assert.deepEqual(after[field], before[index][field]);
    assert.equal(after.pendingCommand, null); assert.equal(after.transferBytes, 0);
    assert.equal(after.irqAsserted, false);
    assert.equal(read(session, base, R.DS_ADDR), 0); assert.equal(read(session, base, R.CMD_ARG), 0);
    assert.equal(read(session, base, R.INT_STATUS), 0); assert.equal(read(session, base, R.INT_SIGNAL_EN), 0);
  }
  assert.deepEqual(session.snapshot().pendingInterrupts, []);
  // The retained CMD55 latch is consumed without another authorization.
  command(session, SD2, 6, 0); assert.equal(status(session, SD2).cardBusWidth, 1);
  assert.deepEqual(readSector(session, SD1), image(37).subarray(0, sectorBytes));
  assert.deepEqual(readSector(session, SD2), image(113).subarray(0, sectorBytes));
});

test('reset clears pending host commands without completing them or resetting card state', async context => {
  const session = await fixture(context, {sd1: image(43), sd2: image(67)});
  initializeCard(session, SD1); initializeCard(session, SD2);
  const completed = [status(session, SD1).completedCommands, status(session, SD2).completedCommands];
  for (const base of [SD1, SD2]) {
    write(session, base, R.CMD_ARG, 0x10000);
    write(session, base, R.CMD_XFR_TYP, (13 << 24) | (R1 << 16));
    assert.equal(status(session, base).pendingCommand, 13);
  }
  await session.reset();
  session.board.tick(1);
  for (const [index, base] of [SD1, SD2].entries()) {
    assert.equal(status(session, base).pendingCommand, null);
    assert.equal(status(session, base).completedCommands, completed[index]);
    assert.equal(status(session, base).cardState, 'transfer');
    assert.equal(read(session, base, R.CMD_RSP0), 0);
  }
});

test('reset during unfinished PIO retains sending-data and records its model limitation', async context => {
  const session = await fixture(context, {sd1: image(53)});
  initializeCard(session, SD1); configureRead(session, SD1);
  command(session, SD1, 17, 0, R1, true);
  read(session, SD1, R.DATA_PORT);
  assert.equal(status(session, SD1).transferReadBytes, 4);
  const completedCommands = status(session, SD1).completedCommands;
  await session.reset();
  const after = status(session, SD1);
  assert.equal(after.cardState, 'sending-data'); assert.equal(after.transferBytes, 0);
  assert.equal(after.transferReadBytes, 0); assert.equal(after.completedCommands, completedCommands);
  assert.match(after.lastError, /RSTA during unfinished data/);
  assert.ok(after.unsupported.some(row => /RSTA during unfinished data/.test(row.reason)));
});

test('snapshot and trace expose owned metadata and diagnostics without raw card bytes', async context => {
  const session = await fixture(context, {sd1: image(59), sd2: image(101, cardBytes * 2)});
  initializeCard(session, SD1); readSector(session, SD1);
  command(session, SD1, 24, 0, R1, true);
  const snapshot = session.snapshot(), trace = session.trace();
  assert.equal(trace.schema, 'opensp-emulator-trace-v1');
  for (const value of [snapshot.sd1, snapshot.sd2, trace.sd1, trace.sd2]) assertMetadataOnly(value);
  assert.deepEqual(snapshot.sd1, session.board.sd1.status());
  assert.deepEqual(snapshot.sd2, session.board.sd2.status());
  assert.deepEqual(trace.sd1, snapshot.sd1); assert.deepEqual(trace.sd2, snapshot.sd2);
  assert.equal(snapshot.sd1.bytesRead, sectorBytes); assert.equal(snapshot.sd1.completedReads, 1);
  snapshot.sd1.unsupported[0].reason = 'caller mutation'; snapshot.sd1.unsupported.push({reason: 'injected', count: 1});
  trace.sd1.unsupported.length = 0; snapshot.sd2.imageBytes = 0;
  assert.ok(session.snapshot().sd1.unsupported.every(row => row.reason !== 'caller mutation' && row.reason !== 'injected'));
  assert.equal(session.snapshot().sd2.imageBytes, cardBytes * 2);
  assert.ok(session.trace().sd1.unsupported.length > 0);
});
