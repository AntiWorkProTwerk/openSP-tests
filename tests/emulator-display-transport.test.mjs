import test from 'node:test';
import assert from 'node:assert/strict';
import { CSR, DMAMUX, DREG, EDMA, LPSPI, DMA_CLOCK, SPI_CLOCK, SREG, TCD_BASE, OwnershipChanged } from '../src/lib/emulator/display-types.ts';
import { fixture, descriptor, csr, RAM, RX, TX, SG } from './fixtures/emulator-display.mjs';

test('source-form byte lane3 plus terminal SG completes from FIFO consumption', () => {
  const f = fixture(); f.configure(); f.request();
  f.hooks.irq = (irq, active) => { if (irq === 7 && active) assert.equal(f.ram[RX - RAM], 0x5a); };
  assert.equal(f.transport.read(EDMA + DREG.INT), 0); assert.equal(f.ram[RX - RAM], 0);
  f.transport.tick(1); // initial queued TCR becomes active
  assert.equal(f.transport.status().lpspi.tcr, 0x00600007);
  f.transport.tick(1); // TX byte accepted into FIFO; no serial delivery yet
  assert.deepEqual(f.bytes, []); assert.equal(f.transport.read(EDMA + DREG.INT), 0);
  f.transport.tick(1); // consumed major loop admits one SG descriptor
  f.transport.tick(1); // CONT word holds the final RX word and PCS
  assert.deepEqual(f.bytes, [0xae]); assert.equal(f.transport.status().lpspi.heldRx, true);
  assert.equal(f.transport.status().lpspi.rxCount, 0); assert.equal(f.ram[RX - RAM], 0);
  f.transport.tick(1); // terminal TCR enqueued by programmed 32-bit transfer
  assert.equal(f.transport.status().lpspi.heldRx, true);
  f.transport.tick(1); // terminal command negates PCS and exposes held RX
  assert.deepEqual(f.pcs, [true, false]); assert.equal(f.transport.status().lpspi.rxCount, 1);
  f.transport.tick(1); // RX7 consumes the lane3 byte and accepts the RAM write
  assert.equal(f.ram[RX - RAM], 0x5a); assert.equal(f.transport.read(EDMA + DREG.INT), 1 << 7);
  assert.equal(csr(f.transport, 7), CSR.INTMAJOR | CSR.DREQ | CSR.DONE);
  assert.equal(csr(f.transport, 6), CSR.DREQ | CSR.DONE);
  assert.equal(f.transport.read(EDMA + DREG.ERQ), 0);
  const accepted = f.calls.findIndex(c => c[0] === 'write');
  assert.ok(accepted >= 0); assert.ok(f.irqs.some(([irq, level]) => irq === 7 && level));
  f.write(EDMA + DREG.CINT, 7, 1); assert.equal(f.transport.read(EDMA + DREG.INT), 0);
  assert.deepEqual(f.irqs.at(-1), [7, false]);
});
test('two newly programmed source-form operations each own one terminal SG transition', () => {
  const f = fixture(); f.configure(); f.request(); f.transport.tick(32);
  f.write(EDMA + DREG.CINT, 7, 1); f.write(LPSPI + SREG.TCR, 0x00600007);
  f.request({byte: 0xa5, tx: TX + 5, rx: RX + 5, sg: SG + 32}); f.transport.tick(32);
  assert.deepEqual(f.bytes, [0xae, 0xa5]); assert.deepEqual(f.pcs, [true, false, true, false]);
  assert.equal(f.ram[RX + 5 - RAM], 0x5a); assert.equal(f.transport.read(EDMA + DREG.INT), 1 << 7);
  assert.equal(f.calls.filter(c => c[0] === 'read' && c[2] === 32).length, 2);
  assert.equal(f.transport.status().edma.errors, 0); assert.deepEqual(f.transport.status().edma.blockedChannels, []);
});
test('EMLM no-offset byte form and alternate admitted RAM addresses preserve behavior', () => {
  const f = fixture(); f.configure(); f.write(EDMA + DREG.CR, 0x480);
  f.request({byte: 0x31, tx: TX + 32, rx: RX + 32, sg: SG + 64}); f.transport.tick(32);
  assert.deepEqual(f.bytes, [0x31]); assert.equal(f.ram[RX + 32 - RAM], 0x5a);
  assert.equal(f.transport.status().edma.errors, 0);
});
test('hardware and fixture clocks gate progress without banking disabled time', () => {
  const f = fixture(); f.configure(); f.request(); f.transport.notifyClock(DMA_CLOCK, 0); f.transport.notifyClock(SPI_CLOCK, 0);
  f.transport.tick(1_000_000); assert.equal(f.transport.status().creditTicks, 0); assert.deepEqual(f.calls, []);
  f.transport.notifyClock(DMA_CLOCK, 0xc0); f.transport.notifyClock(SPI_CLOCK, 0xc0);
  assert.equal(f.transport.status().phases, 0); f.transport.tick(1); assert.equal(f.transport.status().phases, 1);
  const blocked = fixture({lpspiClockReady: false}); blocked.configure(); blocked.request(); blocked.transport.tick(1000);
  assert.deepEqual(blocked.calls, []); assert.equal(blocked.transport.status().creditTicks, 0);
});
test('request enable and MEN are separate; DER/ERQ writes alone do not consume old time', () => {
  const f = fixture(); f.configure(); f.request(); f.write(LPSPI + SREG.DER, 0);
  f.transport.tick(100); // only the explicitly queued command may advance
  assert.deepEqual(f.bytes, []); assert.equal(f.transport.status().creditTicks, 0);
  f.write(LPSPI + SREG.DER, 3); assert.deepEqual(f.bytes, []); f.transport.tick(32); assert.deepEqual(f.bytes, [0xae]);
  const disabled = fixture(); disabled.configure(); disabled.request(); disabled.write(LPSPI + SREG.CR, 0);
  disabled.write(LPSPI + SREG.FCR, 1);
  disabled.transport.tick(4); // DMA can queue a word while serial MEN is clear
  assert.equal(disabled.transport.status().lpspi.txCount, 2); assert.deepEqual(disabled.bytes, []);
});
test('active work retains cap credit while tick0 and status stay inert', () => {
  const f = fixture({quantumTicks: 10, workCap: 2}); f.configure(); f.request(); f.transport.tick(100);
  const state = f.transport.status(); assert.equal(state.phases, 2); assert.equal(state.creditTicks, 80);
  assert.deepEqual(f.bytes, []); f.transport.tick(0); assert.deepEqual(f.transport.status(), state);
  f.transport.tick(1); assert.equal(f.transport.status().phases, 4); assert.equal(f.transport.status().creditTicks, 61);
  f.transport.notifyClock(SPI_CLOCK, 0); assert.equal(f.transport.status().creditTicks, 0);
  f.transport.notifyClock(SPI_CLOCK, 0xc0); assert.equal(f.transport.status().phases, 4);
});
test('below-cap tick partitions preserve consumed bytes, RX visibility and completion', () => {
  const a = fixture({quantumTicks: 10}), b = fixture({quantumTicks: 10});
  for (const f of [a, b]) { f.configure(); f.request(); }
  a.transport.tick(70); for (let n = 0; n < 14; n++) b.transport.tick(5);
  assert.deepEqual(a.transport.status(), b.transport.status());
  assert.deepEqual(a.bytes, b.bytes); assert.deepEqual(a.pcs, b.pcs); assert.deepEqual(a.calls, b.calls);
});
test('status, handles, register observation and tick0 have no transfer effects', () => {
  const f = fixture(); f.configure(); f.request(); const initial = f.transport.status();
  for (let n = 0; n < 5; n++) {
    assert.equal(f.transport.handles(TCD_BASE + 192), true); f.transport.read(EDMA + DREG.CR);
    f.transport.read(EDMA + DREG.INT); f.transport.read(TCD_BASE + 192 + 28, 2); f.transport.tick(0);
    assert.deepEqual(f.transport.status(), initial);
  }
  assert.deepEqual(f.calls, []); assert.deepEqual(f.bytes, []);
  for (const [address, width] of [[EDMA + 1, 4], [EDMA + 0.5, 1], [EDMA, 3], [0x100000000, 4]]) {
    assert.equal(f.transport.handles(address, width), false); assert.equal(f.transport.read(address, width), undefined);
    assert.equal(f.transport.write(address, 1, width), false);
  }
});
test('reset, disposal and callback reset cancel stale completion without rolling back accepted RAM', () => {
  const f = fixture(); f.configure(); f.request(); f.hooks.write = () => f.transport.reset(); f.transport.tick(32);
  assert.equal(f.ram[RX - RAM], 0x5a); assert.equal(f.transport.status().edma.interrupts, 0);
  assert.equal(f.transport.status().lpspi.rxCount, 0); assert.equal(f.transport.status().creditTicks, 0);
  f.configure(); f.request(); f.hooks.write = undefined; f.transport.dispose(); const closed = f.transport.status();
  f.transport.tick(32); f.transport.reset(); assert.deepEqual(f.transport.status(), closed);
  assert.equal(f.transport.write(LPSPI + SREG.CR, 1), false);
});
test('reset inside onByte stops old RX/DONE/IRQ publication', () => {
  const f = fixture(); f.configure(); f.request(); f.hooks.byte = () => f.transport.reset(); f.transport.tick(32);
  assert.deepEqual(f.bytes, [0xae]); assert.equal(f.ram[RX - RAM], 0);
  assert.equal(f.transport.status().edma.interrupts, 0); assert.equal(f.transport.status().lpspi.transferredWords, 0);
});
test('foreign serial cancellation stops pending SG fetch and credit until explicit reset', () => {
  const f = fixture({quantumTicks: 10, workCap: 2}); f.configure(); f.request(); f.transport.tick(30);
  assert.equal(f.transport.status().edma.pendingTerminal, 1); f.write(LPSPI + SREG.FCR, 1);
  assert.equal(f.transport.status().creditTicks, 10);
  const owner = f.transport.status().owner, calls = f.calls.length;
  f.hooks.irq = (irq, active) => { if (irq === 35 && active) throw new OwnershipChanged(); };
  assert.equal(f.transport.write(LPSPI + SREG.IER, 1), false);
  assert.equal(f.transport.status().owner, owner); assert.equal(f.transport.status().lpspi.cancelled, true);
  assert.equal(f.transport.status().creditTicks, 0);
  f.transport.tick(1000); assert.equal(f.calls.length, calls); assert.equal(f.transport.status().creditTicks, 0);
  assert.deepEqual(f.bytes, []); assert.equal(f.transport.status().edma.interrupts, 0);
  f.hooks.irq = undefined; f.transport.reset(); f.configure(); f.request();
  for (let n = 0; n < 4; n++) f.transport.tick(20);
  assert.deepEqual(f.bytes, [0xae]); assert.equal(f.ram[RX - RAM], 0x5a);
});
test('valid unsupported minor offsets, DMAMUX modes and second SG forms park without hardware errors', () => {
  for (const form of ['minor', 'mux', 'chain']) {
    const f = fixture(); f.configure(); f.request();
    if (form === 'minor') { f.write(EDMA + DREG.CR, 0x480); f.write(TCD_BASE + 192 + 8, 0x80000001); }
    if (form === 'mux') f.write(DMAMUX + 24, 0xc0000050);
    if (form === 'chain') f.ram.set(descriptor({csr: CSR.ESG, destinationLast: SG}), SG - RAM);
    f.transport.tick(32); assert.equal(f.transport.status().edma.errors, 0); assert.equal(f.transport.status().edma.interrupts, 0);
    assert.ok(f.transport.status().diagnostics.some(d => /unsupported/.test(d.code)));
    assert.equal(f.transport.status().creditTicks, 0);
  }
});
test('RX bus admission failure reports documented DBE without accepting RAM or major completion', () => {
  const f = fixture(); f.configure(); f.request({rx: RAM + 0x1000}); f.transport.tick(32);
  assert.equal(f.transport.status().edma.errors, 1 << 7); assert.equal(f.transport.status().edma.errorStatus & 0xff, 1);
  assert.equal(f.transport.read(EDMA + DREG.INT), 0); assert.equal(f.calls.filter(c => c[0] === 'write').length, 0);
  assert.equal(f.transport.status().lpspi.rxCount, 1);
});
