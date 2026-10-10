import assert from 'node:assert/strict';
import test from 'node:test';
import {DisplayLpspi, LpspiCallbackFault} from '../src/lib/emulator/display-lpspi.ts';
import {OwnershipChanged, SREG, TCR} from '../src/lib/emulator/display-types.ts';

// Pure component fixtures: no engine, Board, Session, guest or physical device.
function fixture(overrides = {}) {
  const f = {owner: 0, bytes: [], pcs: [], irqs: [], diagnostics: [], ownerReads: 0};
  const hooks = {owner() {f.ownerReads++; return f.owner;}, sinByte: overrides.sinByte ?? 0xa5,
    diagnostic(code, address) {f.diagnostics.push({code, address}); overrides.diagnostic?.(f, code);},
    onPcs(active) {f.pcs.push(active); overrides.onPcs?.(f, active);},
    onByte(byte) {f.bytes.push(byte); overrides.onByte?.(f, byte);},
    onIrq(asserted) {f.irqs.push(asserted); overrides.onIrq?.(f, asserted);}};
  f.hooks = hooks;
  f.model = new DisplayLpspi(hooks);
  return f;
}
function ready(flags = 0, overrides = {}) {
  const f = fixture(overrides), p = f.model;
  assert.equal(p.write(SREG.CFGR1, 1, 4), true);
  assert.equal(p.write(SREG.CR, 1, 4), true);
  assert.equal(p.write(SREG.DER, 3, 4), true);
  assert.equal(p.write(SREG.TCR, 7 | flags, 4), true);
  assert.equal(p.phase(), true);
  return f;
}
const send = (f, byte, lane = 0) => {assert.equal(f.model.write(SREG.TDR + lane, byte, 1), true);};

test('documented reset registers, FIFO capacities and inert ownership predicates', () => {
  const f = fixture(), p = f.model;
  assert.equal(p.read(SREG.VERID, 4), 0x01020004);
  assert.equal(p.read(SREG.PARAM, 4), 0x00040404);
  assert.equal(p.read(SREG.SR, 4), 1);
  assert.equal(p.read(SREG.TCR, 4), 31);
  assert.equal(p.read(SREG.RSR, 4), 2);
  const before = p.status(), ownerReads = f.ownerReads;
  for (let n = 0; n < 50; n++) {
    assert.equal(p.handles(SREG.RDR + 3, 1), true);
    assert.equal(p.handles(SREG.RDR + 1, 2), false);
    p.status(); p.read(SREG.SR, 4); p.read(SREG.FSR, 4); p.read(SREG.TCR, 4);
  }
  assert.deepEqual(p.status(), before);
  assert.equal(f.ownerReads, ownerReads);
  assert.deepEqual([f.bytes, f.pcs, f.irqs, f.diagnostics], [[], [], [], []]);
});

test('TCR is an ordered FIFO command and reads expose only the active command', () => {
  const f = fixture(), p = f.model;
  p.write(SREG.CFGR1, 1, 4); p.write(SREG.CR, 1, 4);
  p.write(SREG.TCR, 7, 4);
  assert.equal(p.read(SREG.TCR, 4), 31);
  assert.equal(p.read(SREG.FSR, 4), 1);
  assert.equal(p.phase(), true);
  assert.equal(p.read(SREG.TCR, 4), 7);
  assert.equal(p.read(SREG.FSR, 4), 0);
  assert.deepEqual(f.bytes, []);
  assert.deepEqual(f.pcs, []);
});

test('ordinary byte frame earns RX and word/frame/transfer flags after serial consumption', () => {
  const f = ready(), p = f.model;
  send(f, 0xae);
  assert.equal(p.rxRequest(), false);
  assert.deepEqual(f.bytes, []);
  assert.equal(p.phase(), true);
  assert.deepEqual(f.bytes, [0xae]);
  assert.deepEqual(f.pcs, [true, false]);
  assert.equal(p.read(SREG.SR, 4) & 0x700, 0x700);
  assert.equal(p.read(SREG.RSR, 4), 1);
  assert.equal(p.rxRequest(), true);
  assert.equal(p.read(SREG.RDR, 1), 0xa5);
  assert.equal(p.rxRequest(), false);
  assert.equal(p.read(SREG.RSR, 4), 2);
});

test('stock BYSW lane3 continuous byte stays held until terminal TCR consumes', () => {
  const f = ready(TCR.CONT | TCR.BYSW), p = f.model;
  send(f, 0xae, 3); p.phase();
  assert.deepEqual(f.bytes, [0xae]);
  assert.deepEqual(f.pcs, [true]);
  assert.equal(p.status().heldRx, true);
  assert.equal(p.rxRequest(), false);
  assert.equal(p.read(SREG.SR, 4) & 0x600, 0);
  const terminal = p.read(SREG.TCR, 4) & 0xffcfffff;
  p.write(SREG.TCR, terminal, 4);
  assert.equal(p.read(SREG.TCR, 4), 7 | TCR.CONT | TCR.BYSW);
  assert.equal(p.rxRequest(), false);
  p.phase();
  assert.equal(p.read(SREG.TCR, 4), 7 | TCR.BYSW);
  assert.deepEqual(f.pcs, [true, false]);
  assert.equal(p.status().heldRx, false);
  assert.equal(p.rxRequest(), true);
  assert.equal(p.read(SREG.RDR + 3, 1), 0xa5);
});

test('continuous words publish the previous receive word and preserve SOF', () => {
  const f = ready(TCR.CONT), p = f.model;
  send(f, 0x12); send(f, 0x34);
  p.phase(); assert.equal(p.status().rxCount, 0);
  p.phase(); assert.equal(p.status().rxCount, 1);
  assert.equal(p.read(SREG.RSR, 4), 1);
  assert.equal(p.read(SREG.RDR, 4), 0xa5);
  assert.equal(p.status().heldRx, true);
  p.write(SREG.TCR, 7, 4); p.phase();
  assert.equal(p.read(SREG.RSR, 4), 0);
  assert.equal(p.read(SREG.RDR, 4), 0xa5);
  assert.deepEqual(f.bytes, [0x12, 0x34]);
  assert.deepEqual(f.pcs, [true, false]);
});

test('continuing command preserves PCS and leaves final receive pending', () => {
  const f = ready(TCR.CONT), p = f.model;
  send(f, 1); p.phase();
  p.write(SREG.TCR, 7 | TCR.CONT | TCR.CONTC, 4); p.phase();
  assert.deepEqual(f.pcs, [true]);
  assert.equal(p.status().heldRx, true);
  assert.equal(p.status().rxCount, 0);
  send(f, 2); p.phase();
  assert.equal(p.status().rxCount, 1);
  p.write(SREG.TCR, 7, 4); p.phase();
  assert.equal(p.status().rxCount, 2);
  assert.deepEqual(f.bytes, [1, 2]);
  assert.deepEqual(f.pcs, [true, false]);
});

test('data writes zero-fill addressed lanes and SIN is a copied explicit fixture', () => {
  const f = ready(TCR.BYSW), p = f.model;
  f.hooks.sinByte = 0xff;
  f.hooks.onByte = () => {throw new Error('Replaced caller hook must not be adopted');};
  p.write(SREG.TDR + 2, 0xabcd, 2); p.phase();
  assert.deepEqual(f.bytes, [0xab]);
  assert.equal(p.read(SREG.RDR, 4), 0xa5000000);
  p.write(SREG.TDR, 0x89abcdef, 4); p.phase();
  assert.deepEqual(f.bytes, [0xab, 0x89]);
  assert.equal(p.read(SREG.RDR + 3, 1), 0xa5);
});

test('requests use DER and watermark without adding a MEN gate', () => {
  const f = fixture(), p = f.model;
  p.write(SREG.DER, 1, 4);
  assert.equal(p.txRequest(), true);
  send(f, 1); assert.equal(p.txRequest(), false);
  p.write(SREG.FCR, 1, 4); assert.equal(p.txRequest(), true);
  const before = p.status(); assert.equal(p.phase(), false); assert.deepEqual(p.status(), before);
  p.write(SREG.DER, 0, 4); assert.equal(p.txRequest(), false);
  p.write(SREG.CR, 2, 4); p.write(SREG.DER, 3, 4);
  assert.equal(p.read(SREG.DER, 4), 0);
  assert.equal(p.txRequest(), false); assert.equal(p.rxRequest(), false);
});

test('FIFO16 rejects overflow, reset bits read zero and RX watermark uses greater-than', () => {
  const f = fixture(), p = f.model;
  for (let n = 0; n < 16; n++) send(f, n);
  assert.equal(p.write(SREG.TDR, 99, 1), false);
  assert.equal(p.read(SREG.FSR, 4), 16);
  assert.equal(f.diagnostics.at(-1).code, 'lpspi-full-tx-fifo');
  p.write(SREG.CR, 0x300, 4);
  assert.equal(p.read(SREG.CR, 4), 0);
  assert.equal(p.read(SREG.FSR, 4), 0);
  const g = ready(), q = g.model;
  q.write(SREG.FCR, 1 << 16, 4);
  send(g, 1); q.phase(); assert.equal(q.rxRequest(), false);
  send(g, 2); q.phase(); assert.equal(q.rxRequest(), true);
  q.read(SREG.RDR, 4); assert.equal(q.rxRequest(), false);
  assert.equal(q.status().rxCount, 1);
});

test('SR W1C byte lanes clear sticky IRQ causes without clearing FIFO status', () => {
  const f = ready(), p = f.model;
  p.write(SREG.IER, 0x100, 4); send(f, 1); p.phase();
  assert.deepEqual(f.irqs, [true]);
  p.write(SREG.SR, 0, 4); assert.deepEqual(f.irqs, [true]);
  p.write(SREG.SR + 1, 1, 1);
  assert.deepEqual(f.irqs, [true, false]);
  assert.equal(p.read(SREG.SR, 4) & 0x700, 0x600);
  p.write(SREG.SR, 0xffffffff, 4);
  assert.equal(p.read(SREG.SR, 4), 3);
});

test('documented RX FIFO overflow sets REF without fabricated data or DMA completion', () => {
  const f = ready(), p = f.model;
  for (let n = 0; n < 17; n++) {send(f, n); p.phase();}
  assert.equal(p.status().rxCount, 16);
  assert.equal(f.bytes.length, 17);
  assert.equal(p.read(SREG.SR, 4) & 0x1000, 0x1000);
  assert.equal(f.diagnostics.at(-1).code, 'lpspi-rx-overflow');
});

test('unsupported formats and partial TCR writes report and preserve the queue', () => {
  const f = fixture(), p = f.model;
  p.write(SREG.CFGR1, 1, 4); p.write(SREG.CR, 1, 4); p.write(SREG.DER, 3, 4);
  assert.equal(p.write(SREG.TCR, 7, 1), false);
  assert.equal(p.status().txCount, 0);
  p.write(SREG.TCR, 15, 4);
  for (let n = 0; n < 20; n++) assert.equal(p.phase(), false);
  assert.equal(p.status().txCount, 1);
  assert.equal(p.read(SREG.TCR, 4), 31);
  assert.equal(p.txRequest(), false);
  assert.deepEqual(f.bytes, []);
  assert.deepEqual(f.diagnostics.map(d => d.code), ['lpspi-command-width', 'lpspi-frame-size']);
});

test('callback-only owner replacement cannot resume old FIFO or held receive state', () => {
  const f = ready(TCR.CONT, {onByte(f) {f.owner++;}}), p = f.model;
  send(f, 1);
  assert.throws(() => p.phase(), OwnershipChanged);
  assert.equal(p.status().rxCount, 0); assert.equal(p.status().heldRx, false);
  assert.equal(p.txRequest(), false); assert.equal(p.rxRequest(), false);
  assert.throws(() => p.phase(), OwnershipChanged);
  assert.throws(() => p.write(SREG.TCR, 7, 4), OwnershipChanged);
  p.reset(); assert.equal(p.status().transferredWords, 0);
});

test('foreign callback cancellation blocks the instance until explicit reset', () => {
  let armed = true;
  const f = ready(TCR.CONT, {onByte() {if (armed) {armed = false; throw new OwnershipChanged();}}}), p = f.model;
  send(f, 1); send(f, 2);
  assert.throws(() => p.phase(), OwnershipChanged);
  const cancelled = p.status();
  assert.equal(cancelled.cancelled, true); assert.equal(cancelled.failed, false);
  assert.equal(cancelled.rxCount, 0); assert.equal(cancelled.heldRx, false);
  assert.equal(cancelled.transferredWords, 0); assert.equal(cancelled.txCount, 1);
  assert.equal(p.txRequest(), false); assert.equal(p.rxRequest(), false);
  assert.throws(() => p.phase(), OwnershipChanged);
  assert.throws(() => p.write(SREG.TDR, 3, 1), OwnershipChanged);
  assert.throws(() => p.read(SREG.RDR, 1), OwnershipChanged);
  assert.deepEqual(p.status(), cancelled); assert.deepEqual(f.diagnostics, []);
  p.reset();
  assert.equal(p.status().cancelled, false); assert.equal(p.status().txCount, 0);
  assert.deepEqual(f.pcs, [true, false]);
  p.write(SREG.CFGR1, 1, 4); p.write(SREG.CR, 1, 4); p.write(SREG.TCR, 7, 4); p.phase();
  send(f, 4); p.phase();
  assert.deepEqual(f.bytes, [1, 4]); assert.equal(p.status().rxCount, 1);
});

test('reset from PCS or byte callback aborts stale receive and completion publication', () => {
  for (const event of ['onPcs', 'onByte']) {
    let armed = true;
    const overrides = event === 'onPcs' ? {onPcs(f, active) {if (active && armed) {armed = false; f.model.reset();}}}
      : {onByte(f) {if (armed) {armed = false; f.model.reset();}}};
    const f = ready(TCR.CONT, overrides), p = f.model;
    send(f, 1); assert.throws(() => p.phase(), OwnershipChanged);
    assert.equal(p.status().rxCount, 0); assert.equal(p.status().heldRx, false);
    assert.equal(p.read(SREG.SR, 4), 1); assert.equal(p.status().transferredWords, 0);
    assert.deepEqual(f.pcs, [true, false]);
  }
});

test('CR.RST aborts old control write after deassertion callback rebind', () => {
  let armed = false;
  const f = ready(TCR.CONT, {onIrq(f, asserted) {if (armed && !asserted) {armed = false; f.owner++;}}}), p = f.model;
  p.write(SREG.IER, 0x100, 4); send(f, 1); p.phase(); armed = true;
  assert.throws(() => p.write(SREG.CR, 3, 4), OwnershipChanged);
  assert.equal(p.read(SREG.CR, 4), 0);
  assert.equal(p.status().txCount, 0); assert.equal(p.status().heldRx, false);
  p.reset(); assert.deepEqual(f.pcs, [true, false]);
});

test('CR.RST aborts old control write after recursive reset from PCS deassertion', () => {
  let armed = false;
  const f = ready(TCR.CONT, {onPcs(f, active) {if (armed && !active) {armed = false; f.model.reset();}}}), p = f.model;
  send(f, 1); p.phase(); armed = true;
  assert.throws(() => p.write(SREG.CR, 3, 4), OwnershipChanged);
  assert.equal(p.read(SREG.CR, 4), 0);
  assert.equal(p.status().txCount, 0); assert.equal(p.status().rxCount, 0);
  assert.equal(p.status().pcsActive, false);
});

test('IRQ callback reset removes earned local state without stale post-callback mutation', () => {
  let armed = true;
  const f = ready(0, {onIrq(f, asserted) {if (armed && asserted) {armed = false; f.model.reset();}}}), p = f.model;
  p.write(SREG.IER, 0x100, 4); send(f, 1);
  assert.throws(() => p.phase(), OwnershipChanged);
  assert.deepEqual(f.irqs, [true, false]);
  assert.equal(p.read(SREG.SR, 4), 1);
  assert.equal(p.status().rxCount, 0); assert.equal(p.status().transferredWords, 0);
});

test('throwing output callback parks source without manufacturing receive status', () => {
  const f = ready(0, {onByte() {throw new Error('Finite fixture failure');}}), p = f.model;
  send(f, 1);
  assert.throws(() => p.phase(), LpspiCallbackFault);
  assert.equal(p.status().failed, true);
  assert.equal(p.status().rxCount, 0); assert.equal(p.read(SREG.SR, 4) & 0x700, 0);
  assert.equal(p.txRequest(), false); assert.equal(p.rxRequest(), false);
  assert.equal(p.phase(), false);
  assert.equal(f.diagnostics.at(-1).code, 'lpspi-callback-failure');
});
