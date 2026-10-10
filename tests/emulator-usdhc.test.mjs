import assert from 'node:assert/strict';
import test from 'node:test';
import { USDHCController, USDHC_REG as R, USDHC_INT as I, USDHC_MIX as M,
  VIRTUAL_SD_GEOMETRY } from '../src/lib/emulator/usdhc.ts';

const ENABLE = I.CC | I.TC | I.BRR | I.CTOE | I.DTOE | I.DMAE;
const R1 = 2, R2 = 1, R1B = 3, DATA = 0x200000;
function image(size = 256 * 1024) {
  return Uint8Array.from({ length: size }, (_, index) => (index * 17 + (index >>> 9)) & 255);
}
function controller(options = {}) {
  const source = options.image ?? image();
  const card = new USDHCController({ ...options, image: source });
  card.write(R.INT_STATUS_EN, ENABLE);
  return { card, source };
}
function command(card, index, argument = 0, response = R1, data = false, commandType = 0) {
  card.write(R.INT_STATUS, 0xffffffff);
  card.write(R.CMD_ARG, argument);
  card.write(R.CMD_XFR_TYP, (index << 24) | (response << 16) | (data ? DATA : 0) | commandType);
  card.tick(1);
  return card.read(R.CMD_RSP0);
}
function initialize(card, busy = false) {
  command(card, 0, 0, 0);
  assert.equal(command(card, 8, 0x1aa), 0x1aa);
  assert.equal(command(card, 55) & 0x20, 0x20);
  assert.equal(command(card, 41, 0x40ff8000), 0x80ff8000); // HCS requested, SDSC CCS remains0.
  command(card, 2, 0, R2);
  const r6 = command(card, 3);
  const rca = r6 >>> 16;
  assert.equal(rca, 1);
  assert.equal((r6 >>> 9) & 15, 2);
  assert.equal((command(card, 7, rca << 16, busy ? R1B : R1) >>> 9) & 15, 3);
  if (busy) card.tick(1);
  assert.equal(card.status().cardState, 'transfer');
  command(card, 16, 512);
  return rca;
}
function configureRead(card, { blocks = 1, size = 512, watermark = 16, multi = false, autoStop = false, extra = 0 } = {}) {
  card.write(R.WTMK_LVL, 0x08100800 | watermark);
  card.write(R.BLK_ATT, (blocks << 16) | size);
  card.write(R.MIX_CTRL, 0x80000000 | M.READ | (multi ? M.MULTI | M.BCEN : 0) | (autoStop ? M.AC12EN : 0) | extra);
}
function drain(card, bytes, blockSize = 512) {
  const data = new Uint8Array(bytes);
  const view = new DataView(data.buffer);
  const bursts = [];
  let cursor = 0;
  for (let attempts = 0; cursor < bytes && attempts < 100000; attempts++) {
    if (!(card.read(R.INT_STATUS) & I.BRR)) { card.tick(1); continue; }
    // RM1528 caller rule: use the configured watermark and shorten at each block end.
    const wordsRemainingInBlock = (blockSize - cursor % blockSize) / 4;
    const count = Math.min(card.read(R.WTMK_LVL) & 255, wordsRemainingInBlock, (bytes - cursor) / 4);
    assert.ok(count > 0 && count <= 128);
    assert.equal(card.status().fifoWords, count);
    bursts.push(count);
    for (let i = 0; i < count; i++) {
      assert.equal(card.read(R.PRES_STATE) & 0x800, 0x800);
      view.setUint32(cursor, card.read(R.DATA_PORT), true);
      cursor += 4;
    }
    card.write(R.INT_STATUS, I.BRR);
    card.tick(1);
  }
  assert.equal(cursor, bytes);
  return { data, bursts };
}
// Same120-bit controller reconstruction used by the official NXP driver.
function decodedResponse(card) {
  const raw = [0, 1, 2, 3].map(index => card.read(R.CMD_RSP0 + index * 4));
  return Uint32Array.of(raw[0] << 8, (raw[1] << 8) | (raw[0] >>> 24),
    (raw[2] << 8) | (raw[1] >>> 24), (raw[3] << 8) | (raw[2] >>> 24));
}
function decodedCapacity(csd) {
  // Official SD_DecodeCsd's CSD v1 capacity formula.
  const size = ((csd[2] & 0x3ff) << 2) | (csd[1] >>> 30);
  const multiplier = (csd[1] >>> 15) & 7;
  const blockLength = (csd[2] >>> 16) & 15;
  return (size + 1) * 2 ** (multiplier + 2) * 2 ** blockLength;
}

test('image geometry is exactly representable, owned and read-only', () => {
  for (const size of [0, 512, 256 * 1024 - 512, 256 * 1024 + 512])
    assert.throws(() => new USDHCController({ image: new Uint8Array(size) }), /capacity units/);
  assert.throws(() => new USDHCController({ image: new Uint8Array(VIRTUAL_SD_GEOMETRY.maximumImageBytes + 512) }), /capacity units/);
  assert.throws(() => new USDHCController({ image: [], instance: 1 }), /capacity units/);
  const { card, source } = controller();
  const original = source.slice(0, 512);
  source.fill(0);
  initialize(card);
  configureRead(card);
  command(card, 17, 0, R1, true);
  assert.deepEqual(drain(card, 512).data, original);
  assert.equal(card.status().readOnly, true);
  assert.equal('image' in card.status(), false);
});

test('CSD decoded through actual controller response packing reports exact image capacity', () => {
  for (const units of [1, 2, 7, 32]) {
    const { card } = controller({ image: image(units * 256 * 1024) });
    initialize(card);
    command(card, 7, 0, 0);
    command(card, 9, 0x10000, R2);
    const csd = decodedResponse(card);
    assert.equal(csd[3] >>> 30, 0);
    assert.equal(decodedCapacity(csd), units * 256 * 1024);
    assert.equal((csd[0] >>> 13) & 1, 1); // Permanent card-level write protection.
  }
});

test('CID is a named synthetic profile and short responses preserve RSP1..3', () => {
  const { card } = controller(); initialize(card);
  command(card, 7, 0, 0);
  command(card, 10, 0x10000, R2);
  const cid = decodedResponse(card);
  assert.equal((cid[3] >>> 8) & 0xffff, 0x4f53);
  const name = [cid[3] & 255, cid[2] >>> 24, (cid[2] >>> 16) & 255, (cid[2] >>> 8) & 255, cid[2] & 255];
  assert.equal(String.fromCharCode(...name), 'VSDRO');
  const retained = [R.CMD_RSP1, R.CMD_RSP2, R.CMD_RSP3].map(offset => card.read(offset));
  command(card, 7, 0x10000);
  assert.equal(command(card, 13, 0x10000) & 0x1e00, 4 << 9);
  assert.deepEqual([R.CMD_RSP1, R.CMD_RSP2, R.CMD_RSP3].map(offset => card.read(offset)), retained);
  card.write(R.CMD_RSP0, 0xffffffff);
  assert.equal(card.read(R.CMD_RSP0), (4 << 9) | 0x100);
});

test('initialization follows SD states and CMD55 authorizes only the next command', () => {
  const { card } = controller();
  assert.equal(card.status().cardState, 'idle');
  command(card, 55); command(card, 41, 0);
  assert.equal(card.status().cardState, 'idle');
  assert.equal(card.read(R.CMD_RSP0) & 0x80000000, 0);
  command(card, 55); command(card, 8, 0x1aa); // Undefined ACMD8 falls back to normal CMD8.
  assert.equal(card.read(R.CMD_RSP0), 0x1aa);
  assert.equal(command(card, 41, 0x00ff8000) & 0x400000, 0x400000);
  assert.equal(card.status().cardState, 'idle');
  initialize(card);
  assert.equal(card.status().cardState, 'transfer');
});

test('8-byte SCR completes through a final short PIO burst with a128-word watermark', () => {
  const { card } = controller(); initialize(card);
  configureRead(card, { size: 8, watermark: 128 });
  command(card, 55, 0x10000); command(card, 51, 0, R1, true);
  assert.equal(card.read(R.CMD_RSP0) & 0x20, 0x20);
  assert.equal(card.read(R.INT_STATUS) & I.TC, 0);
  const { data, bursts } = drain(card, 8, 8);
  assert.deepEqual(bursts, [2]);
  assert.deepEqual(data, Uint8Array.of(2, 5, 0, 0, 0, 0, 0, 0));
  // SD SCR is an MSB-first data packet; official driver converts these bytes before decoding.
  assert.equal(data[0] & 15, 2);
  assert.equal(data[1] & 15, 5); // One and four-bit widths advertised.
  assert.equal(card.read(R.INT_STATUS) & I.TC, I.TC);
  assert.equal(card.status().cardState, 'transfer');
});

test('PIO single-block data and readiness honor watermark boundaries1/40/128', () => {
  for (const watermark of [1, 40, 128]) {
    const { card, source } = controller(); initialize(card);
    configureRead(card, { watermark });
    command(card, 17, 512, R1, true);
    const { data, bursts } = drain(card, 512);
    assert.deepEqual(data, source.slice(512, 1024));
    if (watermark === 40) assert.deepEqual(bursts, [40, 40, 40, 8]);
    assert.equal(card.read(R.PRES_STATE) & (2 | 0x200 | 0x800), 0);
    assert.equal(card.read(R.INT_STATUS) & I.TC, I.TC);
    assert.equal(card.status().bytesRead, 512);
    assert.equal(card.status().unsupported.length, 0);
  }
});

test('CMD18 uses finite block count and short bursts restart at each block boundary', () => {
  const { card, source } = controller(); initialize(card);
  configureRead(card, { blocks: 2, watermark: 40, multi: true });
  command(card, 18, 1024, R1, true);
  const { data, bursts } = drain(card, 1024);
  assert.deepEqual(data, source.slice(1024, 2048));
  assert.deepEqual(bursts, [40, 40, 40, 8, 40, 40, 40, 8]);
  assert.equal(card.read(R.BLK_ATT) >>> 16, 0);
  assert.equal(card.status().cardState, 'sending-data');
  assert.equal((command(card, 12, 0, R1B, false, 0xc00000) >>> 9) & 15, 5);
  assert.equal(card.read(R.INT_STATUS) & I.CC, I.CC);
  assert.equal(card.read(R.INT_STATUS) & I.TC, 0);
  card.tick(1);
  assert.equal(card.read(R.INT_STATUS) & I.TC, I.TC);
  assert.equal(card.status().cardState, 'transfer');
});

test('AutoCMD12 returns card to transfer state and places its response in RSP3', () => {
  const { card, source } = controller(); initialize(card);
  configureRead(card, { blocks: 2, watermark: 128, multi: true, autoStop: true });
  command(card, 18, source.length - 1024, R1, true);
  assert.deepEqual(drain(card, 1024).data, source.slice(-1024));
  assert.equal(card.status().cardState, 'transfer');
  assert.equal(card.read(R.CMD_RSP3), 5 << 9);
  assert.equal(card.read(R.AUTOCMD12_ERR_STATUS), 0);
  assert.equal(card.status().completedReads, 1);
});

test('capacity, alignment, block size and finite-transfer bounds reject without data or mutation', () => {
  const { card, source } = controller({ maximumTransferBytes: 1024 }); initialize(card);
  const original = source.slice();
  configureRead(card);
  assert.equal((command(card, 17, source.length, R1, true) & 0x80000000) >>> 0, 0x80000000);
  assert.equal(card.status().fifoWords, 0);
  assert.equal(command(card, 17, 1, R1, true) & 0x40000000, 0x40000000);
  configureRead(card, { size: 256 });
  assert.equal(command(card, 17, 0, R1, true) & 0x20000000, 0x20000000);
  configureRead(card, { multi: true, blocks: 3 });
  command(card, 18, 0, R1, true);
  assert.equal(card.read(R.INT_STATUS) & (I.DTOE | I.ERR), I.DTOE | I.ERR);
  assert.equal(card.read(R.INT_STATUS) & (I.TC | I.CC), 0);
  configureRead(card, { multi: true, blocks: 2 });
  assert.equal((command(card, 18, source.length - 512, R1, true) & 0x80000000) >>> 0, 0x80000000);
  assert.deepEqual(source, original);
});

test('block-count zero means no data transfer and infinite CMD18 is refused visibly', () => {
  const { card } = controller(); initialize(card);
  configureRead(card, { multi: true, blocks: 0 });
  command(card, 18, 0, R1, true);
  assert.equal(card.status().fifoWords, 0);
  assert.equal(card.read(R.INT_STATUS) & I.CC, I.CC);
  assert.equal(card.read(R.INT_STATUS) & I.TC, 0);
  card.write(R.MIX_CTRL, M.READ | M.MULTI);
  command(card, 18, 0, R1, true);
  assert.equal(card.read(R.INT_STATUS) & I.DTOE, I.DTOE);
  assert.ok(card.status().unsupported.some(entry => /finite block count/.test(entry.reason)));
});

test('status generation and signal delivery are separate, with byte-lane W1C', () => {
  const events = [];
  const { card } = controller({ onIrq: (irq, asserted) => events.push([irq, asserted]) });
  card.write(R.INT_STATUS_EN, 0);
  command(card, 8, 0x1aa);
  assert.equal(card.read(R.INT_STATUS), 0);
  card.write(R.INT_STATUS_EN, I.CC | I.CTOE);
  command(card, 8, 0x1aa);
  assert.equal(card.read(R.INT_STATUS), I.CC);
  assert.equal(events.length, 0);
  card.write(R.INT_SIGNAL_EN, I.CC);
  assert.deepEqual(events, [[110, true]]);
  card.write(R.INT_STATUS_EN, 0); // Policy: disabling status generation preserves prior latch.
  assert.equal(card.read(R.INT_STATUS), I.CC);
  card.write(R.INT_STATUS, I.CC, 1);
  assert.deepEqual(events, [[110, true], [110, false]]);
  card.write(R.INT_STATUS_EN, I.CC | I.CTOE);
  command(card, 8, 0x2aa); // Voltage mismatch creates command timeout, no CC.
  assert.equal(card.read(R.INT_STATUS), I.CTOE | I.ERR);
  card.write(R.INT_STATUS, 0x10001, 1); // Oversized byte write cannot clear bit16.
  assert.equal(card.read(R.INT_STATUS), I.CTOE | I.ERR);
  card.write(R.INT_STATUS + 2, 1, 1);
  assert.equal(card.read(R.INT_STATUS), 0);
});

test('card insertion/removal status reasserts until its status enable is disabled', () => {
  const { card } = controller({ instance: 2, inserted: false });
  assert.equal(card.baseAddress, 0x402c4000);
  assert.equal(card.irqNumber, 111);
  card.write(R.INT_STATUS_EN, I.CINS | I.CRM);
  assert.equal(card.read(R.INT_STATUS), I.CRM);
  card.write(R.INT_STATUS, I.CRM);
  assert.equal(card.read(R.INT_STATUS), I.CRM);
  card.write(R.INT_STATUS_EN, 0); card.write(R.INT_STATUS, I.CRM);
  assert.equal(card.read(R.INT_STATUS), 0);
  card.write(R.INT_STATUS_EN, I.CINS | I.CRM); card.setInserted(true);
  assert.equal(card.read(R.PRES_STATE) & 0x10000, 0x10000);
  assert.equal(card.read(R.INT_STATUS) & I.CINS, I.CINS);
  card.write(R.SYS_CTRL, 0x1000000); card.tick(1);
  assert.equal(card.read(R.PRES_STATE) & 0x10000, 0x10000);
});

test('command inhibit protects a pending command and ordinary data commands cannot replace reads', () => {
  const { card } = controller({ commandTicks: 2 });
  card.write(R.CMD_ARG, 0x1aa); card.write(R.CMD_XFR_TYP, (8 << 24) | (R1 << 16));
  assert.equal(card.read(R.PRES_STATE) & 1, 1);
  card.write(R.CMD_ARG, 0x2aa); card.write(R.CMD_XFR_TYP, (8 << 24) | (R1 << 16));
  assert.equal(card.read(R.CMD_ARG), 0x1aa); // CIHB write protection also affects visible register.
  card.tick(2);
  assert.equal(card.read(R.CMD_RSP0), 0x1aa);
  assert.ok(card.status().unsupported.some(entry => /CMD inhibited/.test(entry.reason)));
  const { card: fast } = controller(); initialize(fast); configureRead(fast);
  command(fast, 17, 0, R1, true);
  fast.write(R.CMD_XFR_TYP, (17 << 24) | DATA | (R1 << 16));
  assert.equal(fast.status().transferBytes, 512);
  assert.ok(fast.status().unsupported.some(entry => /DATA inhibited/.test(entry.reason)));
});

test('RSTC preserves data and errors; RSTD clears data flags while sticky errors survive', () => {
  const { card } = controller(); initialize(card);
  command(card, 8, 0x2aa); // Sticky timeout survives a later successful read.
  configureRead(card);
  card.write(R.CMD_ARG, 0); card.write(R.CMD_XFR_TYP, (17 << 24) | DATA | (R1 << 16)); card.tick(1);
  assert.ok(card.read(R.INT_STATUS) & I.CTOE);
  card.write(R.SYS_CTRL, card.read(R.SYS_CTRL) | 0x2000000);
  assert.equal(card.read(R.INT_STATUS) & I.CC, 0);
  assert.equal(card.status().fifoWords, 16);
  assert.ok(card.read(R.INT_STATUS) & I.CTOE);
  card.tick(1);
  assert.equal(card.read(R.SYS_CTRL) & 0x2000000, 0);
  card.write(R.SYS_CTRL, card.read(R.SYS_CTRL) | 0x4000000);
  assert.equal(card.status().fifoWords, 0);
  assert.equal(card.read(R.INT_STATUS) & (I.BRR | I.TC), 0);
  assert.ok(card.read(R.INT_STATUS) & I.CTOE);
  assert.equal(card.status().cardState, 'sending-data');
  assert.ok(card.status().unsupported.some(entry => /unfinished data/.test(entry.reason)));
  card.tick(1); command(card, 12, 0, R1B); card.tick(1);
  assert.equal(card.status().cardState, 'transfer');
  card.write(R.PROT_CTRL, card.read(R.PROT_CTRL) | 0x20000);
  card.write(R.SYS_CTRL, card.read(R.SYS_CTRL) | 0x4000000);
  assert.equal(card.read(R.PROT_CTRL) & 0x20000, 0);
});

test('full controller reset preserves protocol state/capabilities and requires explicit card CMD0', () => {
  const { card } = controller(); initialize(card);
  const capability = card.read(R.HOST_CTRL_CAP);
  card.write(R.SYS_CTRL, 0x1000000);
  assert.equal(card.read(R.SYS_CTRL) & 0x1000000, 0x1000000);
  card.tick(1);
  assert.equal(card.read(R.SYS_CTRL), 0x0080800f);
  assert.equal(card.read(R.PROT_CTRL), 0x08800020);
  assert.equal(card.read(R.WTMK_LVL), 0x08100810);
  assert.equal(card.read(R.MIX_CTRL), 0x80000000);
  assert.equal(card.read(R.HOST_CTRL_CAP), capability);
  assert.equal(card.read(R.INT_STATUS_EN), 0);
  assert.equal(card.status().cardState, 'transfer');
  command(card, 0, 0, 0);
  assert.equal(card.status().cardState, 'idle');
});

test('INITA is write-one-start, cannot be cancelled by zero, and does not reset card state', () => {
  const { card } = controller();
  card.write(R.SYS_CTRL, card.read(R.SYS_CTRL) | 0x8000000);
  assert.equal(card.read(R.SYS_CTRL) & 0x8000000, 0x8000000);
  card.write(R.SYS_CTRL, 0);
  assert.equal(card.read(R.SYS_CTRL) & 0x8000000, 0x8000000);
  card.tick(1);
  assert.equal(card.read(R.SYS_CTRL) & 0x8000000, 0);
  assert.equal(card.status().cardState, 'idle');
});

test('DMA, DDR, endian, width, watermark and missing data flags fail visibly', () => {
  for (const setup of [
    card => configureRead(card, { extra: M.DMAEN }),
    card => configureRead(card, { extra: M.DDR }),
    card => { configureRead(card); card.write(R.PROT_CTRL, 0); },
    card => { configureRead(card); card.write(R.PROT_CTRL, 0x22); },
    card => configureRead(card, { watermark: 0 }),
    card => configureRead(card, { watermark: 129 }),
    card => configureRead(card, { extra: M.AC23EN }),
  ]) {
    const { card } = controller(); initialize(card); setup(card);
    command(card, 17, 0, R1, true);
    assert.equal(card.status().fifoWords, 0);
    assert.ok(card.status().unsupported.length > 0);
    assert.equal(card.read(R.INT_STATUS) & I.TC, 0);
    assert.ok(card.read(R.INT_STATUS) & I.ERR);
  }
  const { card } = controller(); initialize(card); configureRead(card);
  command(card, 17, 0, R1, false);
  assert.match(card.status().lastError, /DPSEL/);
  assert.equal(card.status().fifoWords, 0);
});

test('ACMD6 and matching host width allow4-bit PIO; response-format mismatch is diagnosed', () => {
  const { card, source } = controller(); initialize(card);
  command(card, 55, 0x10000); command(card, 6, 2);
  card.write(R.PROT_CTRL, card.read(R.PROT_CTRL) | 2);
  configureRead(card); command(card, 17, 0, R1, true);
  assert.deepEqual(drain(card, 512).data, source.slice(0, 512));
  assert.equal(card.status().cardBusWidth, 4);
  command(card, 7, 0, 0);
  command(card, 9, 0x10000, R1);
  assert.match(card.status().lastError, /format mismatch/);
  assert.equal(card.read(R.INT_STATUS) & I.CTOE, I.CTOE);
});

test('write/erase attempts return write protection and leave original sectors intact', () => {
  const { card, source } = controller(); initialize(card);
  for (const index of [24, 25, 32, 33, 38]) {
    const response = command(card, index, 0, index === 38 ? R1B : R1, index === 24 || index === 25);
    assert.equal(response & 0x4000000, 0x4000000);
    if (index === 38) card.tick(1);
  }
  card.write(R.DATA_PORT, 0xdeadbeef);
  configureRead(card); command(card, 17, 0, R1, true);
  assert.deepEqual(drain(card, 512).data, source.slice(0, 512));
  assert.ok(card.status().unsupported.some(entry => /read-only/.test(entry.reason)));
});

test('unknown MMIO and invalid accesses stay visible with bounded diagnostics', () => {
  const { card } = controller();
  assert.equal(card.read(R.DATA_PORT, 2), undefined);
  assert.equal(card.read(3, 4), undefined);
  card.write(R.CMD_XFR_TYP + 2, 0x800, 2);
  assert.equal(card.status().pendingCommand, null);
  for (let offset = 0x200; offset < 0x1200; offset += 4) assert.equal(card.read(offset), undefined);
  assert.equal(card.status().unsupported.length, 128);
  assert.ok(card.status().unsupportedOverflow > 0);
  card.resetController();
  assert.equal(card.status().unsupported.length, 128); // Reset cannot conceal incomplete implementation.
  assert.throws(() => card.tick(-1), /nonnegative/);
});

test('upstream total-transfer burst rule is rejected at non-dividing multiblock watermark', () => {
  const { card } = controller(); initialize(card);
  configureRead(card, { multi: true, blocks: 2, watermark: 40 });
  command(card, 18, 0, R1, true);
  let words = 0;
  // Current NXP USDHC_ReadDataPort uses total remaining words, so its fourth40-word
  // batch crosses the RM-required8-word tail of the first512-byte block.
  for (let burst = 0; burst < 4; burst++) {
    assert.ok(card.read(R.INT_STATUS) & I.BRR);
    const count = Math.min(40, 256 - words);
    for (let i = 0; i < count; i++) { card.read(R.DATA_PORT); words++; }
    card.write(R.INT_STATUS, I.BRR); card.tick(1);
  }
  assert.equal(words, 160);
  assert.equal(card.status().bytesRead, 512);
  assert.match(card.status().lastError, /without a ready data batch/);
  assert.equal(card.status().unsupported.find(entry => /without a ready data batch/.test(entry.reason)).count, 32);
  assert.equal(card.read(R.INT_STATUS) & I.TC, 0);
});

test('card state restrictions prevent CID/CSD and CMD8 queries from becoming fabricated success', () => {
  const { card } = controller(); initialize(card);
  command(card, 9, 0x10000, R2);
  assert.equal(card.read(R.INT_STATUS) & I.CC, 0);
  assert.equal(card.read(R.INT_STATUS) & I.CTOE, I.CTOE);
  assert.match(card.status().lastError, /standby/);
  command(card, 0, 0, 0); command(card, 55); command(card, 41, 0xff8000);
  command(card, 8, 0x1aa);
  assert.equal(card.read(R.INT_STATUS) & I.CTOE, I.CTOE);
  assert.equal(card.status().cardState, 'ready');
});

test('repeated CMD55 retains authorization and an absent card cannot delay a no-response command', () => {
  const { card } = controller();
  command(card, 0, 0, 0);
  assert.equal(command(card, 55) & 0x20, 0x20);
  assert.equal(command(card, 55) & 0x20, 0x20);
  assert.equal(command(card, 41, 0xff8000), 0x80ff8000);
  assert.equal(card.status().unsupported.length, 0);
  const { card: absent } = controller({ inserted: false });
  command(absent, 0, 0, 0);
  assert.equal(absent.read(R.INT_STATUS), I.CC);
  command(absent, 8, 0x1aa);
  assert.equal(absent.read(R.INT_STATUS), I.CTOE | I.ERR);
});

test('CMD13 command-only status can coexist with PIO data without consuming or replacing its batch', () => {
  const { card } = controller(); initialize(card); configureRead(card);
  command(card, 17, 0, R1, true);
  assert.equal(card.status().fifoWords, 16);
  const status = command(card, 13, 0x10000);
  assert.equal((status >>> 9) & 15, 5);
  assert.equal(card.status().fifoWords, 16);
  assert.equal(card.status().transferReadBytes, 0);
  // command() clears old BRR; BREN remains a data-availability field.
  assert.equal(card.read(R.PRES_STATE) & 0x800, 0x800);
  assert.equal(card.status().unsupported.length, 0);
});

test('aggregated ticks preserve command, initialization and busy phase ordering', () => {
  for (const aggregate of [false, true]) {
    const { card } = controller(); initialize(card);
    card.write(R.INT_STATUS, 0xffffffff);
    card.write(R.CMD_ARG, 0x10000);
    card.write(R.CMD_XFR_TYP, (7 << 24) | (R1B << 16));
    if (aggregate) card.tick(2);
    else { card.tick(1); card.tick(1); }
    assert.equal(card.read(R.INT_STATUS) & (I.CC | I.TC), I.CC | I.TC);
    assert.equal(card.read(R.PRES_STATE) & 3, 0);
  }
  const { card } = controller();
  card.write(R.SYS_CTRL, card.read(R.SYS_CTRL) | 0x8000000);
  card.write(R.CMD_ARG, 0x1aa); card.write(R.CMD_XFR_TYP, (8 << 24) | (R1 << 16));
  card.tick(1);
  assert.equal(card.status().pendingCommand, 8);
  assert.equal(card.read(R.INT_STATUS) & I.CC, 0);
  card.tick(1);
  assert.equal(card.status().pendingCommand, null);
  assert.equal(card.read(R.CMD_RSP0), 0x1aa);
});
