import assert from 'node:assert/strict';
import test from 'node:test';
import { SPBoard } from '../src/lib/emulator/board.ts';
import { USDHC_REG as R, USDHC_INT as I, USDHC_MIX as M } from '../src/lib/emulator/usdhc.ts';

const SD1 = 0x402c0000, SD2 = 0x402c4000, GPT = 0x401ec000;
const ENABLE = I.CC | I.TC | I.BRR | I.CTOE | I.DTOE | I.DMAE;
const R1 = 2, R2 = 1, R1B = 3, DATA = 0x200000;
const image = (seed = 0) => Uint8Array.from({length: 256 * 1024},
  (_, i) => (i * 17 + (i >>> 9) + seed) & 255);
const read = (board, base, offset, width = 4) => board.read(base + offset, width);
const write = (board, base, offset, value, width = 4) => board.write(base + offset, value, width);
const status = (board, base) => base === SD1 ? board.status().sd1 : board.status().sd2;

function command(board, base, index, argument = 0, response = R1, data = false,
  {turns = 1, type = 0, clear = true} = {}) {
  if (clear) write(board, base, R.INT_STATUS, 0xffffffff);
  write(board, base, R.CMD_ARG, argument);
  write(board, base, R.CMD_XFR_TYP, (index << 24) | (response << 16) | (data ? DATA : 0) | type);
  board.tick(turns);
  return read(board, base, R.CMD_RSP0);
}
function initialize(board, base) {
  write(board, base, R.INT_STATUS_EN, ENABLE);
  command(board, base, 0, 0, 0);
  assert.equal(command(board, base, 8, 0x1aa), 0x1aa);
  assert.equal(command(board, base, 55) & 0x20, 0x20);
  assert.equal(command(board, base, 41, 0x40ff8000), 0x80ff8000);
  command(board, base, 2, 0, R2);
  const rca = command(board, base, 3) >>> 16;
  assert.equal(rca, 1);
  command(board, base, 7, rca << 16);
  command(board, base, 16, 512);
  assert.equal(status(board, base).cardState, 'transfer');
}
function configureRead(board, base, {blocks = 1, watermark = 40, multiple = false} = {}) {
  write(board, base, R.WTMK_LVL, 0x08100800 | watermark);
  write(board, base, R.BLK_ATT, (blocks << 16) | 512);
  write(board, base, R.MIX_CTRL, 0x80000000 | M.READ | (multiple ? M.MULTI | M.BCEN : 0));
}
function drain(board, base, bytes) {
  const result = new Uint8Array(bytes), view = new DataView(result.buffer);
  const bursts = [];
  let cursor = 0;
  for (let poll = 0; cursor < bytes && poll < 2000; poll++) {
    if (!(read(board, base, R.INT_STATUS) & I.BRR)) { board.tick(1); continue; }
    // Choose each burst from MMIO and block boundaries, without private FIFO state.
    const words = Math.min(read(board, base, R.WTMK_LVL) & 255,
      (512 - cursor % 512) / 4, (bytes - cursor) / 4);
    assert.ok(words > 0 && words <= 128);
    bursts.push(words);
    for (let word = 0; word < words; word++) {
      assert.equal(read(board, base, R.PRES_STATE) & 0x800, 0x800);
      view.setUint32(cursor, read(board, base, R.DATA_PORT), true);
      cursor += 4;
    }
    write(board, base, R.INT_STATUS, I.BRR);
    board.tick(1);
  }
  assert.equal(cursor, bytes, 'Finite PIO transfer must complete within the polling bound.');
  return {bytes: result, bursts};
}
function timer(board) {
  board.write(0x400fc01c, 0x40);
  board.write(0x400ac014, 0);
  board.write(GPT, 0x283);
}

test('absent SD fixtures retain unknown MMIO across both exact windows and boundaries', () => {
  const board = new SPBoard();
  assert.equal(board.sd1, undefined); assert.equal(board.sd2, undefined);
  assert.equal(board.status().sd1, undefined); assert.equal(board.status().sd2, undefined);
  for (const address of [SD1 - 4, SD1, SD1 + 0x3ffc, SD2, SD2 + 0x3ffc, SD2 + 0x4000]) {
    assert.equal(board.read(address), undefined);
    board.write(address, 123);
  }
  assert.equal(board.status().unknownMmio.length, 12);
  const oneSlot = new SPBoard({sd1: {image: image()}});
  assert.equal(oneSlot.read(SD1 + R.HOST_CTRL_CAP), 0x07f3b407);
  assert.equal(oneSlot.read(SD2), undefined, 'USDHC2 must not alias the supplied first slot.');
  assert.equal(oneSlot.read(SD2 + 0x4000), undefined);
});

test('runtime instance and callback overrides cannot change fixed board routes', () => {
  for (const [option, base, irq, attemptedInstance] of [
    ['sd1', SD1, 110, 2], ['sd2', SD2, 111, 1],
  ]) {
    let injectedCallbackCalls = 0;
    const events = [];
    const board = new SPBoard({[option]: {image: image(), instance: attemptedInstance,
      onIrq: () => injectedCallbackCalls++}, onIrq: (...event) => events.push(event)});
    assert.equal(status(board, base).baseAddress, base);
    assert.equal(status(board, base).irq, irq);
    write(board, base, R.INT_STATUS_EN, I.CC);
    write(board, base, R.INT_SIGNAL_EN, I.CC);
    command(board, base, 8, 0x1aa);
    assert.deepEqual(events, [[irq, true]]);
    assert.equal(injectedCallbackCalls, 0);
    assert.equal(board.read(0xe000e200 + (irq >>> 5) * 4), 1 << (irq & 31));
  }
});

test('register lanes preserve neighboring bytes and reads apply the lane exactly once', () => {
  const board = new SPBoard({sd2: {image: image()}});
  write(board, SD2, R.CMD_ARG, 0x11223344);
  assert.equal(read(board, SD2, R.CMD_ARG + 1, 1), 0x33);
  assert.equal(read(board, SD2, R.CMD_ARG + 2, 2), 0x1122);
  write(board, SD2, R.CMD_ARG + 2, 0xaa55, 2);
  write(board, SD2, R.CMD_ARG + 1, 0x99, 1);
  assert.equal(read(board, SD2, R.CMD_ARG), 0xaa559944);
  assert.equal(read(board, SD2, R.HOST_CTRL_CAP + 3, 1), 7);
  assert.equal(read(board, SD2, R.CMD_RSP0 + 1, 1), 0);
  assert.deepEqual(board.status().unknownMmio, []);
});

test('unsupported status/force writes retain unknown evidence while qualified read-only writes are ignored', () => {
  const board = new SPBoard({sd2: {image: image()}});
  const capability = read(board, SD2, R.HOST_CTRL_CAP);
  write(board, SD2, R.HOST_CTRL_CAP, 0);
  assert.equal(read(board, SD2, R.HOST_CTRL_CAP), capability);
  assert.deepEqual(board.status().unknownMmio, []);
  assert.deepEqual(status(board, SD2).unsupported, []);
  write(board, SD2, R.AUTOCMD12_ERR_STATUS, 0xffffffff);
  write(board, SD2, R.FORCE_EVENT, I.CTOE);
  assert.equal(read(board, SD2, R.AUTOCMD12_ERR_STATUS), 0);
  assert.equal(read(board, SD2, R.FORCE_EVENT), 0);
  assert.deepEqual(board.status().unknownMmio, [
    {address: SD2 + R.AUTOCMD12_ERR_STATUS, width: 4, operation: 'write', count: 1},
    {address: SD2 + R.FORCE_EVENT, width: 4, operation: 'write', count: 1},
  ]);
  assert.ok(status(board, SD2).unsupported.some(x => /unimplemented register write0x3c/.test(x.reason)));
  assert.ok(status(board, SD2).unsupported.some(x => /FORCE_EVENT/.test(x.reason)));
});

test('board MMIO completes single-sector and finite two-block PIO with short block tails', () => {
  const source = image(), board = new SPBoard({sd1: {image: source}});
  initialize(board, SD1);
  configureRead(board, SD1);
  command(board, SD1, 17, 512, R1, true);
  const single = drain(board, SD1, 512);
  assert.deepEqual(single.bytes, source.slice(512, 1024));
  assert.deepEqual(single.bursts, [40, 40, 40, 8]);
  assert.equal(status(board, SD1).cardState, 'transfer');
  assert.equal(read(board, SD1, R.INT_STATUS) & I.TC, I.TC);
  configureRead(board, SD1, {blocks: 2, multiple: true});
  command(board, SD1, 18, 1024, R1, true);
  const multi = drain(board, SD1, 1024);
  assert.deepEqual(multi.bytes, source.slice(1024, 2048));
  assert.deepEqual(multi.bursts, [40, 40, 40, 8, 40, 40, 40, 8]);
  assert.equal(read(board, SD1, R.BLK_ATT) >>> 16, 0);
  assert.equal(status(board, SD1).cardState, 'sending-data');
  command(board, SD1, 12, 0, R1B, false, {type: 0xc00000});
  assert.equal(read(board, SD1, R.INT_STATUS) & I.TC, 0);
  board.tick(1);
  assert.equal(read(board, SD1, R.INT_STATUS) & I.TC, I.TC);
  assert.equal(status(board, SD1).cardState, 'transfer');
  assert.equal(status(board, SD1).completedReads, 2);
  assert.equal(status(board, SD1).bytesRead, 1536);
  assert.equal(board.read(GPT + 0x24), 0, 'PIO progressed with GPT disabled.');
  assert.deepEqual(board.status().unknownMmio, []);
  assert.deepEqual(status(board, SD1).unsupported, []);
});

test('byte-lane W1C deasserts the controller IRQ while NVIC pending needs its own acknowledgment', () => {
  const events = [], board = new SPBoard({sd1: {image: image()}, onIrq: (...event) => events.push(event)});
  write(board, SD1, R.INT_STATUS_EN, I.CC | I.CTOE);
  write(board, SD1, R.INT_SIGNAL_EN, I.CC | I.CTOE);
  command(board, SD1, 8, 0x1aa);
  board.sd1.setInserted(false);
  command(board, SD1, 8, 0x1aa, R1, false, {clear: false});
  assert.equal(read(board, SD1, R.INT_STATUS) & (I.CC | I.CTOE), I.CC | I.CTOE);
  write(board, SD1, R.INT_STATUS, I.CC, 1);
  assert.equal(read(board, SD1, R.INT_STATUS) & I.CC, 0);
  assert.equal(read(board, SD1, R.INT_STATUS) & I.CTOE, I.CTOE);
  assert.equal(status(board, SD1).irqAsserted, true);
  write(board, SD1, R.INT_STATUS + 2, 1, 1);
  assert.equal(read(board, SD1, R.INT_STATUS), 0);
  assert.equal(status(board, SD1).irqAsserted, false);
  assert.deepEqual(events, [[110, true], [110, false]]);
  assert.equal(board.read(0xe000e20c) & (1 << 14), 1 << 14);
  board.write(0xe000e28c, 1 << 14);
  assert.equal(board.read(0xe000e20c) & (1 << 14), 0);
});

test('SD commands advance with disabled, stalled and read-driven GPT without read-driven SD time', () => {
  for (const fixture of ['disabled', 'stalled', 'read-driven']) {
    const board = new SPBoard({sd2: {image: image(), commandTicks: 2},
      timerReadTicks: fixture === 'read-driven' ? 24000 : 0});
    if (fixture !== 'disabled') timer(board);
    if (fixture === 'stalled') board.faults.timerStuck = true;
    write(board, SD2, R.INT_STATUS_EN, I.CC);
    write(board, SD2, R.CMD_ARG, 0x1aa);
    write(board, SD2, R.CMD_XFR_TYP, (8 << 24) | (R1 << 16));
    for (let poll = 0; poll < 4; poll++) assert.equal(read(board, SD2, R.CMD_RSP0), 0);
    board.tick(0); assert.equal(status(board, SD2).pendingCommand, 8);
    board.tick(1); assert.equal(status(board, SD2).pendingCommand, 8);
    board.tick(1);
    assert.equal(status(board, SD2).pendingCommand, null);
    assert.equal(read(board, SD2, R.CMD_RSP0), 0x1aa);
    assert.equal(read(board, SD2, R.INT_STATUS) & I.CC, I.CC);
    assert.equal(board.read(GPT + 0x24), fixture === 'read-driven' ? 24000 : 0);
  }
});

test('unsupported lanes and write classification cannot consume active PIO data or launch commands', () => {
  const source = image(), board = new SPBoard({sd1: {image: source}});
  initialize(board, SD1); configureRead(board, SD1);
  command(board, SD1, 17, 0, R1, true);
  assert.equal(read(board, SD1, R.DATA_PORT + 1, 1), undefined);
  assert.equal(read(board, SD1, R.DATA_PORT + 2, 2), undefined);
  write(board, SD1, R.DATA_PORT, 0xdeadbeef);
  assert.equal(status(board, SD1).transferReadBytes, 0);
  assert.equal(read(board, SD1, R.DATA_PORT), new DataView(source.buffer).getUint32(0, true));
  write(board, SD1, R.CMD_XFR_TYP, 0xffff, 2);
  assert.equal(status(board, SD1).pendingCommand, null);
  assert.equal(status(board, SD1).transferReadBytes, 4);
  write(board, SD1, 0x4c, 7);
  assert.equal(read(board, SD1, 0x4c), undefined);
  assert.equal(board.status().unknownMmio.length, 5);
  assert.ok(status(board, SD1).unsupported.some(x => /read-only/.test(x.reason)));
  assert.throws(() => board.read(SD1 + R.DATA_PORT + 1, 4), /aligned/);
});

test('board reset preserves card protocol, owned image and diagnostics while clearing controller work and IRQs', () => {
  const events = [], source = image(), board = new SPBoard({sd1: {image: source}, onIrq: (...event) => events.push(event)});
  initialize(board, SD1); configureRead(board, SD1);
  write(board, SD1, R.INT_SIGNAL_EN, I.BRR);
  command(board, SD1, 17, 0, R1, true);
  read(board, SD1, R.DATA_PORT);
  write(board, SD1, 0x4c, 7);
  const card = board.sd1, before = status(board, SD1), callbacksBefore = events.length;
  board.reset();
  const after = status(board, SD1);
  assert.equal(board.sd1, card);
  assert.equal(after.cardState, before.cardState);
  assert.equal(after.inserted, true);
  assert.equal(after.bytesRead, 4); assert.equal(after.completedCommands, before.completedCommands);
  assert.equal(after.transferBytes, 0); assert.equal(after.pendingCommand, null);
  assert.equal(after.irqAsserted, false);
  assert.equal(read(board, SD1, R.INT_STATUS_EN), 0);
  assert.equal(read(board, SD1, R.INT_SIGNAL_EN), 0);
  assert.equal(board.read(0xe000e20c), 0);
  assert.deepEqual(events.slice(callbacksBefore), [[110, false]], 'Reset deasserts the SD line once.');
  assert.ok(after.unsupported.some(x => /unimplemented register write/.test(x.reason)));
  assert.ok(after.unsupported.some(x => /unfinished data/.test(x.reason)));
  assert.deepEqual(board.status().unknownMmio, []);
  command(board, SD1, 0, 0, 0);
  assert.equal(status(board, SD1).cardState, 'idle');
  initialize(board, SD1); configureRead(board, SD1);
  command(board, SD1, 17, 512, R1, true);
  assert.deepEqual(drain(board, SD1, 512).bytes, source.slice(512, 1024));
});

test('removal abandons active PIO without fabricated completion and presence W1C reasserts', () => {
  const board = new SPBoard({sd2: {image: image()}});
  initialize(board, SD2); configureRead(board, SD2);
  write(board, SD2, R.INT_STATUS_EN, ENABLE | I.CRM);
  write(board, SD2, R.INT_SIGNAL_EN, I.CRM);
  command(board, SD2, 17, 0, R1, true);
  read(board, SD2, R.DATA_PORT);
  board.sd2.setInserted(false);
  assert.equal(status(board, SD2).cardState, 'idle');
  assert.equal(status(board, SD2).transferBytes, 0);
  assert.equal(status(board, SD2).completedReads, 0);
  assert.equal(status(board, SD2).bytesRead, 4);
  assert.equal(read(board, SD2, R.INT_STATUS) & I.TC, 0);
  assert.equal(status(board, SD2).irqAsserted, true);
  write(board, SD2, R.INT_STATUS, I.CRM);
  assert.equal(read(board, SD2, R.INT_STATUS) & I.CRM, I.CRM);
  write(board, SD2, R.INT_STATUS_EN, ENABLE);
  write(board, SD2, R.INT_STATUS, I.CRM);
  assert.equal(status(board, SD2).irqAsserted, false);
  assert.equal(read(board, SD2, R.PRES_STATE) & 0x10000, 0);
});

test('two boards and two controllers retain independent owned images, commands, presence and IRQs', () => {
  const firstImage = image(7), secondImage = image(99);
  const expected1 = firstImage.slice(0, 512), expected2 = secondImage.slice(0, 512);
  const options = {sd1: {image: firstImage}, sd2: {image: secondImage}};
  const first = new SPBoard(options), second = new SPBoard(options);
  firstImage.fill(0); secondImage.fill(0);
  for (const board of [first, second]) for (const base of [SD1, SD2]) initialize(board, base);
  configureRead(first, SD1); write(first, SD1, R.INT_SIGNAL_EN, I.BRR);
  command(first, SD1, 17, 0, R1, true);
  assert.equal(status(first, SD1).irqAsserted, true);
  assert.equal(status(first, SD2).transferBytes, 0);
  assert.equal(status(second, SD1).transferBytes, 0);
  assert.equal(status(second, SD1).irqAsserted, false);
  assert.deepEqual(drain(first, SD1, 512).bytes, expected1);
  for (const [board, base, expected] of [[first, SD2, expected2], [second, SD1, expected1], [second, SD2, expected2]]) {
    configureRead(board, base); command(board, base, 17, 0, R1, true);
    assert.deepEqual(drain(board, base, 512).bytes, expected);
  }
  first.sd1.setInserted(false);
  assert.equal(status(first, SD1).inserted, false);
  for (const [board, base] of [[first, SD2], [second, SD1], [second, SD2]]) assert.equal(status(board, base).inserted, true);
  first.reset();
  assert.equal(status(first, SD1).inserted, false);
  assert.equal(status(second, SD1).completedReads, 1);
});

test('board fixture transfer bounds are forwarded and do not invent oversized read completion', () => {
  assert.throws(() => new SPBoard({sd1: {image: new Uint8Array(512)}}), /capacity units/);
  const source = image(), board = new SPBoard({sd2: {image: source, maximumTransferBytes: 512}});
  initialize(board, SD2);
  configureRead(board, SD2, {blocks: 2, multiple: true});
  command(board, SD2, 18, 0, R1, true);
  assert.equal(read(board, SD2, R.INT_STATUS) & I.DTOE, I.DTOE);
  assert.equal(read(board, SD2, R.INT_STATUS) & I.TC, 0);
  assert.equal(status(board, SD2).transferBytes, 0);
  assert.equal(status(board, SD2).bytesRead, 0);
});

test('board SD status omits image data and returns independent diagnostic snapshots', () => {
  const board = new SPBoard({sd1: {image: image()}});
  write(board, SD1, 0x4c, 1);
  const snapshot = board.status();
  assert.equal(snapshot.sd1.imageBytes, 256 * 1024);
  assert.equal(snapshot.sd1.readOnly, true);
  assert.equal('image' in snapshot.sd1, false);
  snapshot.sd1.unsupported[0].count = 999;
  snapshot.sd1.unsupported.push({reason: 'external mutation', count: 1});
  snapshot.unknownMmio[0].count = 999;
  const fresh = board.status();
  assert.equal(fresh.sd1.unsupported[0].count, 1);
  assert.equal(fresh.sd1.unsupported.length, 1);
  assert.equal(fresh.unknownMmio[0].count, 1);
});
