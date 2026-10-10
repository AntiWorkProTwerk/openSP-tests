import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// Keep this test runnable on the repository's supported Node22 without flags.
const source = await readFile(new URL('../src/lib/emulator/flash.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { FlexSpiNorModel, NOR_BYTES, flashGeometryFixture, measuredSfdpFixture } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const measuredHeader = '53464450000101ff00000109300000ffc2000104600000ffffffffffffffffff';
const measuredBfpt = 'e520f1ffffffff0144eb086b083b04bbeeffffffffff00ffffff00ff0c200f5210d800ff';

function lutWords(opcode, length) {
  const instructions = [0x400 | opcode];
  if ([3, 2, 0x20, 0x5a].includes(opcode)) instructions.push(0x818);
  if (opcode === 0x5a) instructions.push(0x3008);
  if (length) instructions.push((opcode === 2 ? 0x2000 : 0x2400) | 4);
  while (instructions.length < 8) instructions.push(0);
  return Array.from({ length: 4 }, (_, word) =>
    (instructions[2 * word] | (instructions[2 * word + 1] << 16)) >>> 0);
}

function start(model, opcode, address, length, sequence = 15) {
  model.write(0x18, 0x5af05af0);
  model.write(0x1c, 2);
  lutWords(opcode, length).forEach((word, index) =>
    model.write(0x200 + sequence * 16 + index * 4, word));
  model.write(0x18, 0x5af05af0);
  model.write(0x1c, 1);
  model.write(0x80, model.read(0x80) | 0x80000000);
  model.write(0x14, 0x83f);
  model.write(0xb8, 1);
  model.write(0xbc, 1);
  model.write(0xa0, address);
  model.write(0xa4, sequence << 16 | length);
  model.write(0xb0, 1);
}

function command(model, opcode, address = 0, length = 0, input, sequence = 15) {
  start(model, opcode, address, length, sequence);
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += 8) {
    assert.equal(model.read(0x14) & 0x80a, 0, model.lastError);
    const count = Math.min(8, length - offset);
    if (opcode === 2) {
      assert.ok(model.read(0x14) & 0x40, 'TX watermark');
      for (let word = 0; word * 4 < count; word++) {
        let value = 0;
        for (let byte = 0; byte < 4 && word * 4 + byte < count; byte++) {
          value |= input[offset + word * 4 + byte] << (8 * byte);
        }
        model.write(0x180 + 4 * word, value >>> 0);
      }
      model.write(0x14, 0x40);
    } else {
      assert.ok(model.read(0xf0) & 255, 'RX watermark');
      for (let word = 0; word * 4 < count; word++) {
        const value = model.read(0x100 + 4 * word);
        for (let byte = 0; byte < 4 && word * 4 + byte < count; byte++) {
          bytes[offset + word * 4 + byte] = value >>> (8 * byte);
        }
      }
      model.write(0x14, 0x20);
    }
  }
  assert.equal(model.read(0x14) & 0x80a, 0, model.lastError);
  assert.ok(model.read(0x14) & 1, 'command completion');
  assert.equal(model.read(0xe0) & 3, 3, 'controller idle');
  return bytes;
}

function waitReady(model) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const status = command(model, 5, 0, 1)[0];
    if (!(status & 1)) return status;
  }
  assert.fail('NOR remained busy');
}

function writeEnable(model) {
  assert.equal(waitReady(model) & ~0x42, 0);
  command(model, 6);
  assert.ok(command(model, 5, 0, 1)[0] & 2);
}

function erase(model, address) {
  writeEnable(model);
  command(model, 0x20, address);
  waitReady(model);
}

function program(model, address, bytes) {
  writeEnable(model);
  command(model, 2, address, bytes.length, bytes);
  waitReady(model);
}

test('default profile exposes measured ID/status/SFDP and labeled FCB fixture', () => {
  const model = new FlexSpiNorModel();
  assert.equal(model.flash.length, NOR_BYTES);
  assert.equal(model.fcbSource, 'geometry fixture');
  assert.equal(model.sfdpSource, 'R11 measured bytes with FF fixture padding');
  assert.deepEqual(command(model, 0x9f, 0, 3), Uint8Array.of(0xc2, 0x20, 0x16));
  assert.equal(command(model, 5, 0, 1)[0], 0x40);
  const first = command(model, 3, 0, 256);
  const second = command(model, 3, 0x100, 256);
  assert.equal(new DataView(first.buffer).getUint32(0, true), 0x42464346);
  assert.equal(new DataView(first.buffer).getUint32(0x50, true), NOR_BYTES);
  assert.equal(new DataView(second.buffer).getUint32(0xc0, true), 256);
  assert.equal(new DataView(second.buffer).getUint32(0xc4, true), 4096);
  assert.equal(Buffer.from(command(model, 0x5a, 0, 32)).toString('hex'), measuredHeader);
  assert.equal(Buffer.from(command(model, 0x5a, 0x30, 36)).toString('hex'), measuredBfpt);
  assert.deepEqual(model.erases, []);
  assert.deepEqual(model.pages, []);
  assert.ok(model.commandLog.every(({ opcode }) => ![6, 0x20, 2].includes(opcode)));
});

test('caller flash and SFDP bytes replace fixtures without being rewritten', () => {
  const flash = new Uint8Array(NOR_BYTES).fill(0xa7);
  const sfdp = new Uint8Array(256).fill(0x29);
  const model = new FlexSpiNorModel({ flash, sfdp });
  assert.equal(model.flash, flash);
  assert.equal(model.sfdp, sfdp);
  assert.equal(model.fcbSource, 'caller flash image');
  assert.deepEqual(command(model, 3, 0, 256), new Uint8Array(256).fill(0xa7));
  assert.deepEqual(command(model, 0x5a, 0, 32), new Uint8Array(32).fill(0x29));
  assert.throws(() => new FlexSpiNorModel({ flash: new Uint8Array(512) }), /4 MiB/);
});

test('unknown, reserved, unaligned and read-only MMIO accesses remain explicit', () => {
  const model = new FlexSpiNorModel();
  for (const offset of [0x30, 0x90, 0x98, 0xa8, 0xb4, 0xf8, 0x300, -4]) {
    assert.equal(model.read(offset), undefined);
    assert.equal(model.write(offset, 0), false);
  }
  for (const [offset, width] of [[0x01, 4], [0x03, 2], [0x00, 8]]) {
    assert.equal(model.read(offset, width), undefined);
    assert.equal(model.write(offset, 0, width), false);
  }
  assert.equal(model.write(0xe0, 0), false);
  assert.equal(model.write(0x100, 0), false);
  assert.equal(model.read(0x180), undefined);
  assert.equal(model.write(0xc0, 0x12345678), true);
  model.write(0xc1, 0xab, 1);
  model.write(0xc2, 0xcdef, 2);
  assert.equal(model.read(0xc0), 0xcdefab78);
  assert.equal(model.read(0xc1, 1), 0xab);
  assert.equal(model.read(0xc2, 2), 0xcdef);
});

test('LUT writes require key/unlock and can execute any of sixteen slots', () => {
  const model = new FlexSpiNorModel();
  model.write(0x2f0, 0x49f);
  assert.equal(model.read(0x2f0), 0);
  model.write(0x1c, 2);
  model.write(0x2f0, 0x49f);
  assert.equal(model.read(0x2f0), 0);
  assert.deepEqual(command(model, 0x9f, 0, 3, undefined, 4), Uint8Array.of(0xc2, 0x20, 0x16));
  model.write(0x200 + 4 * 16, 0);
  assert.notEqual(model.read(0x200 + 4 * 16), 0);
});

test('full sector erase/page programming/IP readback and FF padding match traffic', () => {
  const model = new FlexSpiNorModel();
  const bytes = Uint8Array.from({ length: 3556 }, (_, index) => index * 17);
  const sector = new Uint8Array(4096).fill(0xff);
  sector.set(bytes);
  const untouchedResident = model.flash.slice(0, 0x80000);
  const untouchedTail = model.flash.slice(0x81000);
  erase(model, 0x80000);
  for (let offset = 0; offset < sector.length; offset += 256) {
    program(model, 0x80000 + offset, sector.slice(offset, offset + 256));
  }
  const readback = new Uint8Array(4096);
  for (let offset = 0; offset < readback.length; offset += 256) {
    readback.set(command(model, 3, 0x80000 + offset, 256), offset);
  }
  assert.deepEqual(readback, sector);
  assert.deepEqual(model.flash.slice(0, 0x80000), untouchedResident);
  assert.deepEqual(model.flash.slice(0x81000), untouchedTail);
  assert.deepEqual(model.erases, [0x80000]);
  assert.equal(model.pages.length, 16);
});

test('virtual chip permits offset0 and final-sector writes; writer must own APP1 policy', () => {
  const model = new FlexSpiNorModel();
  for (const address of [0, 0x3ff000]) {
    erase(model, address);
    program(model, address, new Uint8Array(256).fill(0x35));
    assert.deepEqual(command(model, 3, address, 256), new Uint8Array(256).fill(0x35));
  }
  assert.deepEqual(model.erases, [0, 0x3ff000]);
});

test('programming performs NOR bitwise AND and consumes WEL', () => {
  const model = new FlexSpiNorModel();
  erase(model, 0x80000);
  program(model, 0x80000, new Uint8Array(256).fill(0x55));
  program(model, 0x80000, new Uint8Array(256).fill(0xaa));
  assert.deepEqual(command(model, 3, 0x80000, 256), new Uint8Array(256));
  assert.equal(command(model, 5, 0, 1)[0], 0x40);
});

test('busy transitions are deterministic status polls, never physical timing evidence', () => {
  const model = new FlexSpiNorModel();
  writeEnable(model);
  command(model, 0x20, 0x80000);
  assert.deepEqual(Array.from({ length: 3 }, () => command(model, 5, 0, 1)[0]), [0x41, 0x41, 0x40]);
  model.faults.busyStuck = true;
  assert.equal(command(model, 5, 0, 1)[0], 0x41);
});

test('reset preserves storage, clears controller/FIFO and requires fresh WREN', () => {
  const model = new FlexSpiNorModel();
  erase(model, 0x80000);
  program(model, 0x80000, new Uint8Array(256).fill(0x69));
  model.reset();
  assert.deepEqual(command(model, 3, 0x80000, 256), new Uint8Array(256).fill(0x69));
  start(model, 0x20, 0x80000, 0);
  assert.ok(model.read(0x14) & 8);
  assert.deepEqual(model.erases, [0x80000]);
});

test('controller software reset clears transient work without corrupting programmed bytes', () => {
  const model = new FlexSpiNorModel();
  erase(model, 0x80000);
  writeEnable(model);
  start(model, 2, 0x80000, 256);
  model.write(0x180, 0x12345678);
  model.write(0x14, 0x40);
  model.write(0, model.read(0) | 1);
  assert.equal(model.read(0) & 1, 0);
  assert.equal(model.read(0x14), 0);
  assert.equal(model.read(0xe0), 3);
  assert.deepEqual(model.flash.slice(0x80000, 0x80100), new Uint8Array(256).fill(0xff));
  assert.deepEqual(model.pages, []);
  model.faults.resetStuck = true;
  model.write(0, 1);
  assert.equal(model.read(0) & 1, 1);
});

test('capacity, page crossing, erase alignment, missing WEL and unknown commands reject before mutation', () => {
  for (const [opcode, address, length, needWel] of [
    [0x20, 0x80001, 0, true], [0x20, 0x400000, 0, true],
    [2, 0x400000, 256, true], [2, 0x80001, 256, true],
    [2, 0x80000, 257, true], [0x20, 0x80000, 0, false],
    [0xc7, 0, 0, true], [1, 0, 1, true],
  ]) {
    const model = new FlexSpiNorModel();
    const before = model.flash.slice();
    if (needWel) writeEnable(model);
    start(model, opcode, address, length);
    assert.ok(model.read(0x14) & 8, `${opcode}:${address}:${length}`);
    assert.ok(model.lastError);
    assert.deepEqual(model.flash, before);
    assert.deepEqual(model.erases, []);
    assert.deepEqual(model.pages, []);
  }
});

test('altered LUT pad/address/dummy/data instructions and chained sequences remain unsupported', () => {
  for (const [index, value, config] of [
    [0, 0x059f, 15 << 16 | 3], [0, 0x041f, 15 << 16 | 3],
    [0, 0x0405, 15 << 16 | 3], [1, 0x2814, 15 << 16 | 3],
    [3, 0x1234, 15 << 16 | 3], [0, 0x0409f, 1 << 24 | 15 << 16 | 3],
  ]) {
    const model = new FlexSpiNorModel();
    start(model, 0x9f, 0, 3);
    model.write(0x18, 0x5af05af0);
    model.write(0x1c, 2);
    model.write(0x2f0 + index * 4, value);
    model.write(0x1c, 1);
    model.write(0x14, 0x83f);
    model.write(0xa4, config);
    model.write(0xb0, 1);
    assert.ok(model.read(0x14) & 8);
    assert.ok(model.lastError);
  }
});

test('unsupported protection profile, injected command/RX/WEL/idle failures stay visible', () => {
  const protectedModel = new FlexSpiNorModel();
  protectedModel.statusExtra = 0x44;
  command(protectedModel, 6);
  start(protectedModel, 0x20, 0x80000, 0);
  assert.ok(protectedModel.read(0x14) & 8);
  assert.deepEqual(protectedModel.erases, []);
  const model = new FlexSpiNorModel();
  model.faults.commandErrorAt = 1;
  start(model, 0x9f, 0, 3);
  assert.ok(model.read(0x14) & 8);
  model.faults.commandErrorAt = 0;
  model.faults.noRx = true;
  start(model, 0x9f, 0, 3);
  assert.equal(model.read(0xf0), 0);
  assert.equal(model.read(0x100), 0);
  model.faults.noRx = false;
  model.faults.noWel = true;
  command(model, 6);
  assert.equal(command(model, 5, 0, 1)[0] & 2, 0);
  model.faults.idleStuck = true;
  assert.equal(model.read(0xe0), 0);
});

test('XIP callback follows completed mutations and exposes optional corrupt-page readback', () => {
  const writes = [];
  const model = new FlexSpiNorModel({
    writeMemory: (address, bytes) => writes.push({ address, bytes: bytes.slice() }),
  });
  erase(model, 0x80000);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].address, 0x60080000);
  assert.equal(writes[0].bytes.length, 4096);
  model.faults.corruptPage = true;
  program(model, 0x80000, new Uint8Array(256).fill(0x55));
  assert.equal(writes.length, 2);
  assert.equal(writes[1].bytes[0], 0x54);
  assert.equal(command(model, 3, 0x80000, 256)[0], 0x54);
});

test('exported fixtures are independent arrays for parallel virtual boards', () => {
  const flash = flashGeometryFixture();
  const sfdp = measuredSfdpFixture();
  flash[0x80000] = 0x27;
  sfdp[0] = 0;
  const first = new FlexSpiNorModel();
  const second = new FlexSpiNorModel();
  first.flash[0x80000] = 0x3a;
  assert.equal(second.flash[0x80000], 0xff);
  assert.equal(first.sfdp[0], 0x53);
  assert.notEqual(first.flash, second.flash);
});

// Static stock startup words at 8022DFD8, slots2/9/12. No guest executes here.
const stockStartupSlots = new Map([
  [2, [0x00000406, 0, 0, 0]],
  [9, [0x20040401, 0, 0, 0]],
  [12, [0x24040405, 0, 0, 0]],
]);

function installSlot(model, sequence, words) {
  model.write(0x18, 0x5af05af0);
  model.write(0x1c, 2);
  words.forEach((word, index) => model.write(0x200 + sequence * 16 + index * 4, word));
  model.write(0x18, 0x5af05af0);
  model.write(0x1c, 1);
}

function triggerSlot(model, sequence, size = 0, address = 0, rxWatermark = 8, txWatermark = 8) {
  model.write(0x14, 0x83f);
  model.write(0xb8, 1 | ((rxWatermark / 8 - 1) << 2));
  model.write(0xbc, 1 | ((txWatermark / 8 - 1) << 2));
  model.write(0xa0, address);
  model.write(0xa4, (sequence << 16) | size);
  model.write(0xb0, 1);
}

function stockStatus(model, rxWatermark = 64) {
  triggerSlot(model, 12, 1, 0, rxWatermark);
  assert.equal(model.read(0x14) & 0x80a, 0, model.lastError);
  assert.equal(model.read(0xf0) & 255, 1);
  assert.equal(model.read(0x14) & 0x20, 0, 'one-byte tail is below watermark');
  const status = model.read(0x100, 1);
  model.write(0xb8, 1 | ((rxWatermark / 8 - 1) << 2));
  return status;
}

function stockWriteEnable(model) {
  triggerSlot(model, 2);
  assert.equal(model.read(0x14) & 9, 1);
  assert.equal(stockStatus(model), 0x42);
}

function finishStatusWrite(model, value = 0x40) {
  assert.equal(model.read(0x14) & 0x40, 0x40);
  assert.equal(model.read(0xe0), 0, 'waiting for TX payload');
  model.write(0x180, value | 0xbababa00);
  model.write(0x14, 0x40);
}

test('stock one-byte status write overrides operand4 and never alters array storage', () => {
  const writes = [];
  const model = new FlexSpiNorModel({ writeMemory: (...args) => writes.push(args) });
  for (const [slot, words] of stockStartupSlots) installSlot(model, slot, words);
  const before = model.flash.slice();
  stockWriteEnable(model);
  triggerSlot(model, 9, 1, 0, 64, 64);
  assert.equal(model.commandLog.at(-1).length, 1);
  model.write(0x180, 0xdeadbe40);
  assert.equal(stockStatusAfterPendingTx(model), 0x40);
  assert.deepEqual(model.flash, before);
  assert.deepEqual(model.erases, []);
  assert.deepEqual(model.pages, []);
  assert.deepEqual(writes, []);
});

function stockStatusAfterPendingTx(model) {
  assert.equal(model.read(0x14) & 0x40, 0x40);
  model.write(0x14, 0x40);
  assert.equal(model.read(0x14) & 0x80b, 1);
  assert.equal(model.read(0xe0), 3);
  const statuses = Array.from({ length: 3 }, () => stockStatus(model));
  assert.deepEqual(statuses, [0x41, 0x41, 0x40], 'WEL consumed, bounded status-write busy polls');
  return statuses.at(-1);
}

test('captured FCB operand1 supplies size when IDATSZ is zero', () => {
  const model = new FlexSpiNorModel();
  for (const [slot, words] of stockStartupSlots) installSlot(model, slot, words);
  installSlot(model, 4, [0x20010401, 0, 0, 0]);
  stockWriteEnable(model);
  triggerSlot(model, 4, 0);
  assert.equal(model.commandLog.at(-1).length, 1);
  finishStatusWrite(model);
  assert.equal(model.read(0x14) & 9, 1);
  assert.equal(stockStatus(model), 0x41);
});

test('status writes require WREN and ready measured40 state', () => {
  for (const state of ['no-wren', 'busy', 'protection']) {
    const model = new FlexSpiNorModel();
    for (const [slot, words] of stockStartupSlots) installSlot(model, slot, words);
    if (state !== 'no-wren') stockWriteEnable(model);
    if (state === 'busy') model.faults.busyStuck = true;
    if (state === 'protection') model.statusExtra = 0x44;
    const before = model.flash.slice();
    triggerSlot(model, 9, 1);
    assert.equal(model.read(0x14) & 9, 9, state);
    assert.equal(model.read(0x14) & 0x40, 0, state);
    assert.ok(model.lastError);
    assert.deepEqual(model.flash, before);
  }
});

test('other status values are explicit coverage failures without changing measured40', () => {
  for (const value of [0x00, 0x04, 0x44, 0x80, 0x43]) {
    const model = new FlexSpiNorModel();
    for (const [slot, words] of stockStartupSlots) installSlot(model, slot, words);
    const before = model.flash.slice();
    stockWriteEnable(model);
    triggerSlot(model, 9, 1);
    finishStatusWrite(model, value);
    assert.equal(model.read(0x14) & 9, 9);
    assert.match(model.lastError, /Only the measured status40 write/);
    assert.equal(model.statusExtra, 0x40);
    assert.deepEqual(model.flash, before);
    assert.deepEqual(model.erases, []);
    assert.deepEqual(model.pages, []);
  }
});

test('stock write phase retains exact pad, address, size and single-sequence guards', () => {
  for (const [words, config] of [
    [[0x24040401, 0, 0, 0], 9 << 16 | 1], // Read phase for a status write.
    [[0x22040401, 0, 0, 0], 9 << 16 | 1], // Quad write remains unsupported.
    [[0x20040501, 0, 0, 0], 9 << 16 | 1], // Two-pad command.
    [[0x08180401, 0x2004, 0, 0], 9 << 16 | 1], // Unexpected address phase.
    [[0x20040401, 0, 0, 0], 9 << 16 | 2],
    [[0x20040401, 0, 0, 0], 9 << 16], // Operand4 fallback exceeds this status profile.
    [[0x20040401, 0, 0, 0], 9 << 16 | 1 << 24 | 1],
  ]) {
    const model = new FlexSpiNorModel();
    for (const [slot, baseWords] of stockStartupSlots) installSlot(model, slot, baseWords);
    stockWriteEnable(model);
    installSlot(model, 9, words);
    model.write(0x14, 0x83f);
    model.write(0xb8, 1);
    model.write(0xbc, 1);
    model.write(0xa0, 0);
    model.write(0xa4, config);
    model.write(0xb0, 1);
    assert.equal(model.read(0x14) & 9, 9);
    assert.ok(model.lastError);
    assert.deepEqual(model.pages, []);
    assert.deepEqual(model.erases, []);
  }
});

test('TFDR data waits for TX acknowledgment and controller reset cancels a status write', () => {
  const model = new FlexSpiNorModel();
  for (const [slot, words] of stockStartupSlots) installSlot(model, slot, words);
  stockWriteEnable(model);
  triggerSlot(model, 9, 1, 0, 64, 64);
  model.write(0x180, 0x40);
  assert.equal(model.read(0x14) & 0x41, 0x40);
  assert.equal(model.read(0xe0), 0);
  model.write(0, 1);
  assert.equal(model.read(0x14), 0);
  assert.equal(model.read(0xe0), 3);
  assert.equal(stockStatus(model), 0x42, 'canceled write leaves WEL set and starts no busy cycle');
  assert.deepEqual(model.pages, []);
  assert.deepEqual(model.erases, []);
});

test('DONE accompanies command errors and each W1C status can be cleared separately', () => {
  const model = new FlexSpiNorModel();
  start(model, 0xc7, 0, 0);
  assert.equal(model.read(0x14) & 9, 9);
  assert.equal(model.read(0x14) & 0x40, 0, 'no guessed TX readiness on a rejected command');
  model.write(0x14, 1);
  assert.equal(model.read(0x14) & 9, 8);
  model.write(0x14, 8);
  assert.equal(model.read(0x14) & 9, 0);
  model.faults.commandErrorAt = model.commandLog.length + 1;
  start(model, 0x9f, 0, 3);
  assert.equal(model.read(0x14) & 9, 9);
  model.write(0x14, 8);
  assert.equal(model.read(0x14) & 9, 1);
});

test('32-byte RX tail under a 64-byte watermark reports four entries and no RXWA', () => {
  const model = new FlexSpiNorModel();
  installSlot(model, 7, [0x08180403, 0x00002404, 0, 0]);
  const expected = Uint8Array.from({ length: 32 }, (_, i) => 0x80 + i);
  model.flash.set(expected, 0x1000);
  triggerSlot(model, 7, 32, 0x1000, 64);
  assert.equal(model.read(0xf0) & 255, 4);
  assert.equal(model.read(0x14) & 0x21, 1);
  const values = Array.from({ length: 8 }, (_, word) => model.read(0x100 + word * 4));
  assert.deepEqual(Array.from({ length: 8 }, (_, word) => model.read(0x100 + word * 4)), values);
  assert.equal(model.read(0xf0) & 255, 4, 'RFDR reads do not pop entries');
  const actual = new Uint8Array(32);
  values.forEach((value, word) => new DataView(actual.buffer).setUint32(word * 4, value, true));
  assert.deepEqual(actual, expected);
  model.write(0xb8, 1 | (7 << 2));
  assert.equal(model.read(0xf0) & 255, 0);
  assert.equal(model.read(0x100), 0);
  assert.equal(model.read(0x14) & 1, 1, 'FIFO clear retains completion');
});

test('RX acknowledgments pop a watermark then preserve a short padded tail', () => {
  const model = new FlexSpiNorModel();
  installSlot(model, 7, [0x08180403, 0x00002404, 0, 0]);
  model.flash.set(Uint8Array.from({ length: 67 }, (_, i) => i + 1), 0x1000);
  triggerSlot(model, 7, 67, 0x1000, 64);
  assert.equal(model.read(0xf0) & 255, 9);
  assert.equal(model.read(0x14) & 0x20, 0x20);
  assert.equal(model.read(0x100), 0x04030201);
  assert.equal(model.read(0x13c), 0x403f3e3d);
  model.write(0x14, 0x20);
  assert.equal(model.read(0xf0) & 255, 1);
  assert.equal(model.read(0x14) & 0x20, 0);
  assert.equal(model.read(0x100), 0x00434241);
  assert.equal(model.read(0x104), 0);
  assert.equal(model.read(0x100), 0x00434241);
  model.write(0xb8, 1 | (7 << 2));
  assert.equal(model.read(0xf0), 0);
});

test('SFDP bytes remain readable as a final chunk below the selected RX watermark', () => {
  const model = new FlexSpiNorModel();
  installSlot(model, 5, [0x0818045a, 0x24043008, 0, 0]);
  triggerSlot(model, 5, 36, 0x30, 64);
  assert.equal(model.read(0xf0) & 255, 5);
  assert.equal(model.read(0x14) & 0x21, 1);
  const bytes = new Uint8Array(36);
  for (let word = 0; word < 9; word++) {
    new DataView(bytes.buffer).setUint32(word * 4, model.read(0x100 + 4 * word), true);
  }
  assert.equal(Buffer.from(bytes).toString('hex'), measuredBfpt);
  assert.equal(model.read(0x124), 0, 'padding beyond the actual response is zero');
  assert.equal(model.read(0xf0) & 255, 5);
  model.write(0xb8, 1 | (7 << 2));
  assert.equal(model.read(0xf0), 0);
});

test('RX window is bounded to sixteen 64-bit entries and refills after acknowledgment', () => {
  const model = new FlexSpiNorModel();
  installSlot(model, 7, [0x08180403, 0x00002404, 0, 0]);
  model.flash.set(Uint8Array.from({ length: 256 }, (_, i) => i), 0x1000);
  triggerSlot(model, 7, 256, 0x1000, 128);
  assert.equal(model.read(0xf0) & 255, 16);
  assert.equal(model.read(0x17c), 0x7f7e7d7c);
  model.write(0x14, 0x20);
  assert.equal(model.read(0xf0) & 255, 16);
  assert.equal(model.read(0x100), 0x83828180);
  assert.equal(model.read(0x17c), 0xfffefdfc);
  model.write(0x14, 0x20);
  assert.equal(model.read(0xf0), 0);
  assert.equal(model.read(0x14) & 0x20, 0);
});

test('status read operand fallback uses the same bounded data-size rule', () => {
  const model = new FlexSpiNorModel();
  installSlot(model, 12, [0x24040405, 0, 0, 0]);
  triggerSlot(model, 12, 0);
  assert.equal(model.commandLog.at(-1).length, 4);
  assert.equal(model.read(0x14) & 9, 9, 'four-byte status reads remain outside this NOR profile');
  installSlot(model, 7, [0x08180403, 0x00002404, 0, 0]);
  model.flash.set(Uint8Array.of(1, 2, 3, 4), 0x1000);
  triggerSlot(model, 7, 0, 0x1000);
  assert.equal(model.commandLog.at(-1).length, 4);
  assert.equal(model.read(0x100), 0x04030201);
});

test('passive metadata retains raw controller values and has an independent cap', () => {
  const model = new FlexSpiNorModel();
  for (const [slot, words] of stockStartupSlots) installSlot(model, slot, words);
  stockWriteEnable(model);
  triggerSlot(model, 9, 1, 0x1234, 64, 128);
  assert.deepEqual(model.commandMetadata.at(-1), {
    index: 3, ipcr0: 0x1234, ipcr1: 9 << 16 | 1, sequence: 9,
    requestedSequenceCount: 1, lutWords: [0x20040401, 0, 0, 0],
    rxWatermarkBytes: 64, txWatermarkBytes: 128,
  });
  assert.equal(model.commandLog.at(-1).ipcr0, 0x1234);
  assert.equal(model.commandLog.at(-1).ipcr1, 9 << 16 | 1);
  assert.deepEqual(model.commandLog.at(-1).lutWords, [0x20040401, 0, 0, 0]);
  installSlot(model, 9, [0x20010401, 0, 0, 0]);
  assert.deepEqual(model.commandLog.at(-1).lutWords, [0x20040401, 0, 0, 0], 'metadata snapshots the LUT before later edits');
  assert.ok(model.commandMetadata.every((record) => !Object.keys(record).some((key) => /payload|dataBytes/.test(key))));
  finishStatusWrite(model);
  stockStatus(model);
  stockStatus(model);
  stockStatus(model);
  for (let i = model.commandLog.length; i < 70; i++) triggerSlot(model, 2);
  assert.equal(model.commandLog.length, 70);
  assert.equal(model.commandMetadata.length, 64);
  assert.equal(model.commandMetadataOverflow, 6);
  assert.equal(model.commandMetadata[0].index, 7);
  assert.equal(model.commandMetadata.at(-1).index, 70);
  assert.equal(model.commandLog[0].lutWords, undefined);
  assert.equal(model.commandLog[0].ipcr0, undefined);
  assert.equal(model.commandLog[0].ipcr1, undefined);
  assert.ok(model.commandLog.slice(-16).every(({ ipcr0, ipcr1, lutWords }) =>
    typeof ipcr0 === 'number' && typeof ipcr1 === 'number' && lutWords?.length === 4));
});
