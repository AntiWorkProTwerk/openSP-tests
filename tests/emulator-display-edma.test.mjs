import test from 'node:test';
import assert from 'node:assert/strict';
import { MappedDisplayBus } from '../src/lib/emulator/display-bus.ts';
import { DisplayEdma, dmaIrqLevels } from '../src/lib/emulator/display-edma.ts';
import { CSR, DMAMUX, DREG, EDMA, LPSPI, TCD_BASE, OwnershipChanged } from '../src/lib/emulator/display-types.ts';
import { descriptor, RAM, TX, RX, SG } from './fixtures/emulator-display.mjs';

function fixture() {
  let owner = 0, dma;
  const ram = new Uint8Array(0x1000), events = [], reports = [], irqs = [];
  const callbacks = { read: undefined, write: undefined, tx: undefined, rx: undefined, diagnostic: undefined, irq: undefined };
  let ready = true, polls = 0;
  const bus = new MappedDisplayBus({read(address, size) { events.push(['read', address, size]); callbacks.read?.(address, size);
      return ram.slice(address - RAM, address - RAM + size); },
    write(address, bytes) { ram.set(bytes, address - RAM); events.push(['ram', address, [...bytes]]); callbacks.write?.(address, bytes); }},
    {start: RAM, bytes: ram.length}, [{start: RAM, bytes: ram.length}], () => owner);
  const serial = { txRequest() { polls++; return ready; }, rxRequest() { polls++; return ready; },
    write(offset, value, width) { events.push(['tx', offset, value, width]); callbacks.tx?.(); return true; },
    read(offset, width) { events.push(['rx', offset, width]); callbacks.rx?.(); return 0x5a; } };
  const hooks = {owner: () => owner, diagnostic(code, channel, address) { reports.push([code, channel, address]); callbacks.diagnostic?.(code); },
    onIrq(number, active) { irqs.push([number, active]); callbacks.irq?.(number, active); } };
  dma = new DisplayEdma(bus, serial, hooks);
  const write = (address, value, width = 4) => assert.equal(dma.write(address, value >>> 0, width), true);
  const program = (channel, bytes) => {
    write(EDMA + DREG.CDNE, channel, 1);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset < 32; offset += 4) write(TCD_BASE + channel * 32 + offset, v.getUint32(offset, true));
  };
  const start = (channel = 6, overrides = {}) => {
    program(channel, descriptor(channel === 6 ? {csr: CSR.DREQ | CSR.INTMAJOR, destinationLast: 0, ...overrides} :
      {source: LPSPI + 0x77, sourceOffset: 0, destination: RX, destinationLast: 0, csr: CSR.DREQ | CSR.INTMAJOR, ...overrides}));
    write(DMAMUX + channel * 4, 0x80000000 | (channel === 6 ? 80 : 79)); write(EDMA + DREG.SERQ, channel, 1);
  };
  return {dma, ram, events, reports, irqs, callbacks, serial, hooks, write, program, start,
    changeOwner: () => owner++, ready: value => { ready = value; }, polls: () => polls};
}

test('HRS invokes request hooks only when addressed; ordinary reads and status are passive', () => {
  const f = fixture();
  assert.equal(f.dma.read(EDMA + DREG.CR, 4), 0x400);
  assert.equal(f.dma.read(EDMA + 0x113, 1), 0x10); assert.equal(f.dma.read(EDMA + 0x11c, 1), 0x1f);
  f.dma.reset(); assert.equal(f.dma.read(EDMA + DREG.CR, 4), 0x400);
  f.start(); const before = f.polls();
  f.dma.read(EDMA + DREG.CR, 4); f.dma.read(EDMA + DREG.INT, 4); f.dma.read(TCD_BASE + 192 + 28, 2); f.dma.status();
  assert.equal(f.polls(), before); assert.equal(f.dma.read(EDMA + DREG.HRS, 4), 1 << 6); assert.ok(f.polls() > before);
});
test('wider command writes apply every addressed byte with independent NOP lanes', () => {
  const f = fixture(); f.start(7); f.dma.phase();
  assert.equal(f.dma.read(EDMA + DREG.INT, 4), 1 << 7);
  f.write(EDMA + DREG.CDNE, 0x07808007); // CDNE7, SSRT NOP, CERR NOP, CINT7
  assert.equal(f.dma.read(TCD_BASE + 224 + 28, 2) & CSR.DONE, 0); assert.equal(f.dma.read(EDMA + DREG.INT, 4), 0);
  assert.deepEqual(f.reports, []);
  f.write(EDMA + DREG.SERQ, 6, 1); f.write(EDMA + DREG.SEEI, 6, 1);
  f.write(EDMA + DREG.CEEI, 0x07060706); // CEEI6, SEEI7, CERQ6, SERQ7
  assert.equal(f.dma.read(EDMA + DREG.EEI, 4), 1 << 7); assert.equal(f.dma.read(EDMA + DREG.ERQ, 4), 1 << 7);
});
test('software CSR cannot manufacture DONE; CDNE admits ESG after a completed operation', () => {
  const f = fixture(); f.start(); f.write(TCD_BASE + 192 + 28, CSR.DONE | CSR.DREQ | CSR.INTMAJOR, 2);
  assert.equal(f.dma.read(TCD_BASE + 192 + 28, 2) & CSR.DONE, 0); f.dma.phase();
  assert.ok(f.dma.read(TCD_BASE + 192 + 28, 2) & CSR.DONE);
  f.write(TCD_BASE + 192 + 28, CSR.DONE | CSR.ESG, 2); assert.equal(f.dma.read(TCD_BASE + 192 + 28, 2), CSR.DONE);
  f.write(EDMA + DREG.CDNE, 6, 1); f.write(TCD_BASE + 192 + 28, CSR.ESG, 2);
  assert.equal(f.dma.read(TCD_BASE + 192 + 28, 2), CSR.ESG);
});
test('INT and ERR are W1C; documented NCE asserts the enabled error IRQ', () => {
  const f = fixture(); f.start(6, {bytes: 0}); f.write(EDMA + DREG.SEEI, 6, 1); f.dma.phase();
  assert.equal(f.dma.status().errors, 1 << 6); assert.equal(f.dma.status().errorStatus & 255, 8);
  assert.ok(f.irqs.some(([number, active]) => number === 16 && active)); assert.deepEqual(f.events, []);
  f.write(EDMA + DREG.ERR, 0); assert.equal(f.dma.status().errors, 1 << 6);
  f.write(EDMA + DREG.ERR, 1 << 6); assert.equal(f.dma.status().errors, 0); assert.deepEqual(f.irqs.at(-1), [16, false]);
});
test('shared IRQ6/7 include channels22/23 without synthesizing unsupported completions', () => {
  assert.deepEqual(dmaIrqLevels(1 << 22, 0, 0), [[6, true], [7, false], [16, false]]);
  assert.deepEqual(dmaIrqLevels(1 << 23, 1 << 31, 1 << 31), [[6, false], [7, true], [16, true]]);
});
test('reset inside RAM read cancels local generation even with unchanged outer owner', () => {
  const f = fixture(); f.start(); f.callbacks.read = () => f.dma.reset();
  assert.equal(f.dma.phase(), false); assert.equal(f.events.filter(e => e[0] === 'tx').length, 0);
  assert.equal(f.dma.status().interrupts, 0); assert.deepEqual(f.dma.status().channel6, new Array(32).fill(0));
});
test('outer-owner change remains stale until explicit reset rebind', () => {
  const f = fixture(); f.start(); f.changeOwner(); assert.equal(f.dma.phase(), false); assert.equal(f.dma.hasWork(), false);
  assert.throws(() => f.dma.write(EDMA + DREG.CINT, 6, 1), OwnershipChanged);
  f.dma.reset(); f.start(); assert.equal(f.dma.phase(), true); assert.equal(f.events.filter(e => e[0] === 'tx').length, 1);
});
test('same-channel reprogramming inside TX callback preserves accepted bus effect but cancels old completion', () => {
  const f = fixture(); f.start();
  f.callbacks.tx = () => f.program(6, descriptor({source: TX + 5, csr: CSR.DREQ, destinationLast: 0}));
  assert.equal(f.dma.phase(), false); assert.equal(f.events.filter(e => e[0] === 'tx').length, 1);
  assert.equal(f.dma.read(TCD_BASE + 192, 4), TX + 5); assert.equal(f.dma.status().interrupts, 0);
  assert.equal(f.dma.read(TCD_BASE + 192 + 28, 2) & CSR.DONE, 0);
});
test('new ERQ operation inside RX RAM acceptance cancels old DONE/INT without rollback', () => {
  const f = fixture(); f.start(7);
  f.callbacks.write = () => { f.write(EDMA + DREG.CERQ, 7, 1); f.write(EDMA + DREG.SERQ, 7, 1); };
  assert.equal(f.dma.phase(), false); assert.equal(f.ram[RX - RAM], 0x5a); assert.equal(f.dma.status().interrupts, 0);
  assert.equal(f.dma.read(TCD_BASE + 224 + 28, 2) & CSR.DONE, 0);
});
test('SG diagnostic reset cannot restore an old TCD or publish stale IRQ', () => {
  const f = fixture(); f.start(6, {csr: CSR.ESG, destinationLast: SG}); f.dma.phase();
  f.ram.set(descriptor({attr: 0x0808}), SG - RAM); f.callbacks.diagnostic = () => f.dma.reset();
  assert.equal(f.dma.phase(), false); assert.equal(f.dma.status().pendingTerminal, 0);
  assert.deepEqual(f.dma.status().channel6, new Array(32).fill(0)); assert.equal(f.dma.status().interrupts, 0);
});
test('failed-transfer diagnostic reset cancels later error IRQ publication', () => {
  const f = fixture(); f.start(6, {bytes: 0}); f.write(EDMA + DREG.SEEI, 6, 1);
  f.callbacks.diagnostic = () => f.dma.reset(); assert.equal(f.dma.phase(), false);
  assert.equal(f.dma.status().errors, 0); assert.equal(f.irqs.filter(([number, active]) => number === 16 && active).length, 0);
});
test('TX readiness is rechecked after the RAM callback and rejected work does not decrement', () => {
  const f = fixture(); f.start(); f.callbacks.read = () => f.ready(false); assert.equal(f.dma.phase(), true);
  assert.equal(f.events.filter(e => e[0] === 'tx').length, 0); assert.equal(f.dma.read(TCD_BASE + 192 + 22, 2), 1);
  assert.equal(f.dma.status().interrupts, 0);
});
test('callbacks and endpoint identities are owned after construction', () => {
  const f = fixture(); f.start(); f.hooks.owner = () => 99; f.serial.write = () => { throw new Error('replacement'); };
  assert.equal(f.dma.phase(), true); assert.equal(f.events.filter(e => e[0] === 'tx').length, 1);
});
