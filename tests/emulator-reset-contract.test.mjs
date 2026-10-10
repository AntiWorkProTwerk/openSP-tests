import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {APP1_BASE, FLASH_BASE, FLASH_BYTES, MAX_APP1_BYTES, loadFirmwareImage,
  validateApp1ResetContract, resolveApp1ResetImage} from '../src/lib/emulator/image.ts';

// Import the real session logic with its CPU dependency replaced before evaluation.
// No CPU module, engine, firmware input, Worker, browser or physical device runs.
const sessionUrl = new URL('../src/lib/emulator/session.ts', import.meta.url);
const cpuStub = `data:text/javascript;base64,${Buffer.from(
  'export async function createCPU() { throw new Error("CPU execution is forbidden in reset contract tests"); }',
).toString('base64')}`;
const sessionSource = readFileSync(sessionUrl, 'utf8');
assert.equal(sessionSource.split("from './cpu.ts'").length, 2);
const isolatedSource = sessionSource.replace("from './cpu.ts'", `from '${cpuStub}'`)
  .replace(/from '(\.\/[^']+)'/g, (_match, target) => `from '${new URL(target, sessionUrl).href}'`);
const sessionCode = ts.transpileModule(isolatedSource, {
  compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext},
}).outputText;
const {EmulatorSession} = await import(`data:text/javascript;base64,${Buffer.from(sessionCode).toString('base64')}`);

const appStart = APP1_BASE - FLASH_BASE;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const benign = (length = 32) => {
  const bytes = new Uint8Array(length);
  bytes.set([0xfe, 0xe7, 0xfe, 0xe7]); // Owned benign bytes, never executed.
  if (length > 4) bytes[length - 1] = 0x71;
  return bytes;
};
const put = (bytes, offset, value) => new DataView(bytes.buffer).setUint32(offset, value, true);
const abi = (length = 0x800) => {
  const bytes = benign(length);
  [0x41555053, 0x30315746, 1, length, 0x80000000, length - 0x400, 0x400, 0x20243000]
    .forEach((value, index) => put(bytes, 0x200 + index * 4, value));
  put(bytes, 0x400, 0x20243000);
  return bytes;
};
const norWith = target => {
  const nor = new Uint8Array(FLASH_BYTES).fill(255);
  nor.set(target, appStart);
  return nor;
};
const request = (target, current) => ({length: target.length, sha256: sha(target), expectedCurrentSha256: current.sha256});

class FakeCPU {
  totalInstructions = 0;
  backendFailed = false;
  registers = new Map();
  closeCalls = 0;
  constructor(events) {this.events = events;}
  loadMemory(address, bytes) {this.events.push('loadMemory'); this.loadedAddress = address; this.loadedBytes = bytes.slice();}
  writeRegister(name, value) {this.registers.set(name, value);}
  readRegister(name) {return this.registers.get(name) ?? 0;}
  readMemory(_address, length) {return new Uint8Array(length);}
  stop() {}
  close() {this.closeCalls++; this.events.push('closeCPU');}
  step() {throw new Error('Guest execution is forbidden in reset contract tests');}
}

async function fixture(bytes = benign()) {
  const image = await loadFirmwareImage(bytes, {format: 'app1', name: 'synthetic.bin'});
  const events = [], cpus = [];
  const session = new EmulatorSession(image, {format: 'app1', name: 'synthetic.bin'});
  session.makeCPU = async () => {events.push('makeCPU'); const cpu = new FakeCPU(events); cpus.push(cpu); return cpu;};
  const reset = session.board.reset.bind(session.board);
  session.board.reset = () => {events.push('resetBoard'); reset();};
  const setControl = session.board.setControl.bind(session.board);
  session.board.setControl = (name, value) => {events.push(`control:${name}:${value}`); setControl(name, value);};
  await session.initialize();
  session.state = 'paused';
  events.length = 0;
  return {session, image, cpu: session.cpu, events, cpus};
}

function assertUntouched(model) {
  assert.equal(model.session.image, model.image);
  assert.equal(model.session.cpu, model.cpu);
  assert.equal(model.session.state, 'paused');
  assert.equal(model.cpu.closeCalls, 0);
  assert.equal(model.cpus.length, 1);
  assert.deepEqual(model.events, []);
}

function holdDigest(context) {
  const original = globalThis.crypto.subtle.digest;
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  context.mock.method(globalThis.crypto.subtle, 'digest', async function (algorithm, bytes) {
    await gate;
    return original.call(this, algorithm, bytes);
  });
  return release;
}

test('reset contract parser owns its exact bounded request and normalizes complete hashes', () => {
  const source = {length: 4, sha256: 'A'.repeat(64), expectedCurrentSha256: 'B'.repeat(64)};
  const owned = validateApp1ResetContract(source);
  source.length = MAX_APP1_BYTES + 1; source.sha256 = 'broken';
  assert.deepEqual(owned, {length: 4, sha256: 'a'.repeat(64), expectedCurrentSha256: 'b'.repeat(64)});
  assert.equal(validateApp1ResetContract({...owned, length: MAX_APP1_BYTES}).length, MAX_APP1_BYTES);
});

test('reset contracts reject missing identities, invalid extents and arbitrary entry controls', () => {
  const valid = {length: 4, sha256: 'a'.repeat(64), expectedCurrentSha256: 'b'.repeat(64)};
  for (const value of [null, undefined, [], {}, {length: 4}, {...valid, sha256: 'a'.repeat(63)},
    {...valid, expectedCurrentSha256: 'not a hash'}, {...valid, selector: 'normal'},
    {...valid, entry: 0x60308001}, {...valid, selector: null}]) assert.throws(() => validateApp1ResetContract(value));
  for (const length of [0, 3, -1, 4.5, NaN, Infinity, MAX_APP1_BYTES + 1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateApp1ResetContract({...valid, length}), /reset length/);
  }
});

test('explicit raw APP1 extent admits every target byte beyond the old image length', async () => {
  const current = await loadFirmwareImage(benign(), {format: 'app1'});
  const target = benign(0x10004), nor = norWith(target);
  put(target, 4, 0x60308001); nor.set(target, appStart);
  const resolved = await resolveApp1ResetImage(nor, current, request(target, current));
  assert.deepEqual(resolved.image.bytes, target);
  assert.equal(resolved.image.sha256, sha(target));
  assert.equal(resolved.image.bytes.length, 0x10004);
  assert.equal(resolved.image.abi, undefined);
  assert.equal(resolved.image.entry, APP1_BASE | 1);
  assert.equal(resolved.image.stack, 0x202435b0);
  nor.fill(0); assert.deepEqual(resolved.image.bytes, target);
});

test('explicit target identity rejects partial programming and incomplete retained NOR', async () => {
  const current = await loadFirmwareImage(benign(), {format: 'app1'});
  const target = benign(0x10004), nor = norWith(target);
  nor[appStart + target.length - 1] ^= 1;
  await assert.rejects(resolveApp1ResetImage(nor, current, request(target, current)), /target SHA256/);
  await assert.rejects(resolveApp1ResetImage(nor.subarray(0, FLASH_BYTES - 1), current, request(target, current)), /complete 4 MiB/);
});

test('matching SHA cannot bypass original APP1 structural admission', async () => {
  const current = await loadFirmwareImage(benign(), {format: 'app1'});
  for (const target of [new Uint8Array(32), new TextEncoder().encode('FCFB'), abi()]) {
    if (target.length === 0x800) put(target, 0x20c, 0x900);
    await assert.rejects(resolveApp1ResetImage(norWith(target), current, request(target, current)), /blank|resident|declared length/);
  }
});

test('reset helper rejects stale current hashes and full-flash sessions', async () => {
  const current = await loadFirmwareImage(benign(), {format: 'app1'}), target = benign(64);
  await assert.rejects(resolveApp1ResetImage(norWith(target), current,
    {...request(target, current), expectedCurrentSha256: 'a'.repeat(64)}), /current running image hash/);
  await assert.rejects(resolveApp1ResetImage(norWith(target), {...current, format: 'flash'}, request(target, current)), /APP1 session/);
});

test('reset helper snapshots the request and detects retained target mutation during hashing', async context => {
  const current = await loadFirmwareImage(benign(), {format: 'app1'}), target = benign(64), nor = norWith(target);
  const release = holdDigest(context), contract = request(target, current);
  const pending = resolveApp1ResetImage(nor, current, contract);
  contract.sha256 = 'broken'; contract.length = 4;
  nor[appStart + 40] ^= 1;
  release();
  await assert.rejects(pending, /Retained APP1 bytes changed/);
});

test('reset helper detects running-image byte mutation during hashing', async context => {
  const current = await loadFirmwareImage(benign(), {format: 'app1'}), target = benign(64);
  const release = holdDigest(context);
  const pending = resolveApp1ResetImage(norWith(target), current, request(target, current));
  current.bytes[8] ^= 1; release();
  await assert.rejects(pending, /current APP1 image changed/);
});

test('B1 selector source admission requires its exact wrapped-R3 length and SHA', async () => {
  const current = await loadFirmwareImage(benign(), {format: 'app1'}), target = benign(64);
  for (const contract of [{...request(target, current), selector: 'b1-del-writer'},
    {...request(target, current), length: 2671332, selector: 'b1-del-writer'},
    {...request(target, current), sha256: '475835a7c076feeb6a7d4f3a4eddf50fcb215b64c3f59048d0eae40a6e061dc1', selector: 'b1-del-writer'}]) {
    await assert.rejects(resolveApp1ResetImage(norWith(target), current, contract), /exact pinned wrapped-R3/);
  }
});

test('exact B1 source pin still requires the complete retained target hash', async () => {
  const current = await loadFirmwareImage(benign(), {format: 'app1'}), target = benign(2671332);
  await assert.rejects(resolveApp1ResetImage(norWith(target), current, {length: target.length,
    sha256: '475835a7c076feeb6a7d4f3a4eddf50fcb215b64c3f59048d0eae40a6e061dc1',
    expectedCurrentSha256: current.sha256, selector: 'b1-del-writer'}), /target SHA256/);
});

test('explicit session reset validates the complete larger target before recreating a fake CPU', async () => {
  const model = await fixture(), target = benign(0x10004);
  model.session.board.flash.flash.set(target, appStart);
  const savedNor = model.session.board.flash.flash.slice();
  await model.session.reset(request(target, model.image));
  assert.equal(model.cpu.closeCalls, 1);
  assert.notEqual(model.session.cpu, model.cpu);
  assert.equal(model.session.image.sha256, sha(target));
  assert.deepEqual(model.session.image.bytes, target);
  assert.deepEqual(model.session.board.flash.flash, savedNor);
  assert.deepEqual(model.session.cpu.loadedBytes, savedNor);
  assert.deepEqual(model.events, ['closeCPU', 'resetBoard', 'makeCPU', 'loadMemory']);
  assert.equal(model.session.cpu.readRegister('pc'), APP1_BASE | 1);
  assert.equal(model.session.cpu.totalInstructions, 0);
  assert.equal(model.session.state, 'loaded');
});

test('malformed, stale and mismatched reset contracts leave the live session intact', async () => {
  const model = await fixture(), target = benign(64);
  model.session.board.flash.flash.set(target, appStart);
  for (const contract of [null, {}, {...request(target, model.image), expectedCurrentSha256: 'a'.repeat(64)},
    {...request(target, model.image), sha256: 'b'.repeat(64)}]) {
    await assert.rejects(model.session.reset(contract)); assertUntouched(model);
  }
});

test('reset rehashes the owned running image rather than trusting stale hash metadata', async () => {
  const model = await fixture(), target = benign(64);
  model.session.board.flash.flash.set(target, appStart);
  model.image.bytes[8] ^= 1;
  await assert.rejects(model.session.reset(request(target, model.image)), /Current APP1 bytes SHA256/);
  assertUntouched(model);
});

test('session reset detects any retained NOR mutation during async SHA before closing its CPU', async context => {
  const model = await fixture(), target = benign(64);
  model.session.board.flash.flash.set(target, appStart);
  const release = holdDigest(context), pending = model.session.reset(request(target, model.image));
  model.session.board.flash.flash[0x2000] ^= 1; release();
  await assert.rejects(pending, /session or retained NOR changed/); assertUntouched(model);
});

test('session reset refuses a replaced running image during async validation', async context => {
  const model = await fixture(), target = benign(64);
  model.session.board.flash.flash.set(target, appStart);
  const release = holdDigest(context), pending = model.session.reset(request(target, model.image));
  const replacement = {...model.image}; model.session.image = replacement; release();
  await assert.rejects(pending, /session or retained NOR changed/);
  assert.equal(model.session.image, replacement); model.image = replacement; assertUntouched(model);
});

test('session reset detects executable image metadata changes during async validation', async context => {
  const model = await fixture(), target = benign(64);
  model.session.board.flash.flash.set(target, appStart);
  const release = holdDigest(context), pending = model.session.reset(request(target, model.image));
  model.image.entry = 0x60308001; release();
  await assert.rejects(pending, /session or retained NOR changed/); assertUntouched(model);
});

test('session reset does not reopen a session closed during SHA validation', async context => {
  const model = await fixture(), target = benign(64);
  model.session.board.flash.flash.set(target, appStart);
  const release = holdDigest(context), pending = model.session.reset(request(target, model.image));
  model.session.state = 'closed'; release();
  await assert.rejects(pending, /session or retained NOR changed/);
  assert.equal(model.session.state, 'closed'); assert.equal(model.session.cpu, model.cpu);
  assert.equal(model.session.image, model.image); assert.deepEqual(model.events, []);
});

test('legacy reset preserves old raw-image length and original ABI declared-length behavior', async () => {
  const raw = await fixture(), target = benign(64);
  raw.session.board.flash.flash.set(target, appStart);
  await raw.session.reset();
  assert.equal(raw.session.image.bytes.length, 32);
  assert.equal(raw.session.image.sha256, sha(target.subarray(0, 32)));
  const original = await fixture(), originalTarget = abi(0x10004);
  original.session.board.flash.flash.set(originalTarget, appStart);
  await original.session.reset();
  assert.equal(original.session.image.bytes.length, originalTarget.length);
  assert.equal(original.session.image.abi, 1);
  assert.equal(original.session.image.sha256, sha(originalTarget));
});

test('B1 DEL runtime reset remains blocked before any CPU, image or board mutation', async () => {
  const model = await fixture();
  await assert.rejects(model.session.reset({length: 2671332,
    sha256: '475835a7c076feeb6a7d4f3a4eddf50fcb215b64c3f59048d0eae40a6e061dc1',
    expectedCurrentSha256: model.image.sha256, selector: 'b1-del-writer'}), /unqualified/);
  assertUntouched(model);
});
