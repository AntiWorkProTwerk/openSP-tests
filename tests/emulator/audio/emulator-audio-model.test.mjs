import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AudioSai, AudioCallbackFault, SAI } from '../../../src/lib/emulator/audio-sai.ts';
import { admitStockAudioRam } from '../../../src/lib/emulator/audio-maps.ts';
import { MappedDisplayBus } from '../../../src/lib/emulator/display-bus.ts';
import { DisplayEdma, dmaIrqLevels } from '../../../src/lib/emulator/display-edma.ts';
import { DisplayTransport } from '../../../src/lib/emulator/display-transport.ts';
import { CSR, DMAMUX, DREG, EDMA, TCD_BASE, DMA_CLOCK, SPI_CLOCK, LPSPI, SREG, DisplayBusFault, OwnershipChanged } from '../../../src/lib/emulator/display-types.ts';

const DTCM = 0x20000000, SDRAM = 0x80000000;
// Same property names and permissions as actual Cpu.memoryMap, not an options object.
const activeMap = () => [{ name: 'DTCM', address: DTCM, bytes: 0x80000, permissions: 7 },
  { name: 'SDRAM', address: SDRAM, bytes: 0x10000, permissions: 7 }];
const fixtureWords = Array.from({ length: 16 }, (_, n) => (0xabcd0000 | (n + 1)) >>> 0);
const fixtures = overrides => ({ saiClockReady: true, externalClock: true, slotTicks: 8, rxFrame: fixtureWords, ...overrides });
function configureSai(sai, start = true) {
  for (const [offset, word] of [[0xc, 16], [0x10, 0x40000000], [0x14, 0xf0000], [0x18, 0x100f1f38], [0x1c, 0x1f1f1300],
    [0x8c, 16], [0x90, 0], [0x94, 0x10000], [0x98, 0x100f1f10], [0x9c, 0x1f1f0f00]]) assert.equal(sai.write(offset, word, 4), true);
  sai.write(8, start ? 0x90000001 : 1, 4); sai.write(0x88, start ? 0x90000001 : 1, 4);
}
function descriptor(channel, overrides = {}) {
  const rx = channel === 4;
  const t = { source: rx ? SAI + 0xa0 : DTCM + channel * 0x2000, sourceOffset: rx ? 0 : 4,
    attr: rx ? 0x0101 : 0x0202, bytes: rx ? 32 : 64, sourceLast: 0,
    destination: rx ? DTCM + 0x8000 : SAI + 0x20 + channel * 4, destinationOffset: rx ? 2 : 0,
    count: channel < 3 ? 0x8000 | ((channel + 1) << 9) | 64 : 64,
    initial: channel < 3 ? 0x8000 | ((channel + 1) << 9) | 64 : 64,
    destinationLast: 0, csr: channel < 3 ? CSR.DREQ | CSR.MAJORELINK | ((channel + 1) << 8) : CSR.DREQ | CSR.INTMAJOR, ...overrides };
  const bytes = new Uint8Array(32), v = new DataView(bytes.buffer);
  v.setUint32(0, t.source, true); v.setInt16(4, t.sourceOffset, true); v.setUint16(6, t.attr, true);
  v.setUint32(8, t.bytes, true); v.setInt32(12, t.sourceLast, true); v.setUint32(16, t.destination, true);
  v.setInt16(20, t.destinationOffset, true); v.setUint16(22, t.count, true); v.setInt32(24, t.destinationLast, true);
  v.setUint16(28, t.csr, true); v.setUint16(30, t.initial, true); return bytes;
}
function core(overrides = {}) {
  let owner = 0, dma;
  const dtcm = new Uint8Array(0x9000), sdram = new Uint8Array(0x10000), calls = [], irqs = [], reports = [];
  const callbacks = { read: undefined, write: undefined, irq: undefined };
  const hooks = { owner: () => owner, diagnostic(code, channel) { reports.push([code, channel]); },
    onIrq(irq, value) { irqs.push([irq, value]); callbacks.irq?.(irq, value); } };
  const memory = { read(address, bytes) { calls.push(['read', address, bytes]); callbacks.read?.(address, bytes);
      const data = address >= SDRAM ? sdram : dtcm, base = address >= SDRAM ? SDRAM : DTCM; return data.slice(address - base, address - base + bytes); },
    write(address, bytes) { calls.push(['write', address, [...bytes]]);
      const data = address >= SDRAM ? sdram : dtcm, base = address >= SDRAM ? SDRAM : DTCM; data.set(bytes, address - base); callbacks.write?.(address, bytes); } };
  const admission = admitStockAudioRam(activeMap());
  const bus = new MappedDisplayBus(memory, admission.mappedRam, admission.admittedRam, () => owner);
  const sai = new AudioSai(fixtures(overrides), { owner: hooks.owner, diagnostic: code => reports.push([code]), onIrq: value => hooks.onIrq(56, value) });
  sai.setClockEnabled(true); configureSai(sai);
  const serial = { txRequest: () => false, rxRequest: () => false, read: () => undefined, write: () => false };
  const endpoint = { txRequest: () => sai.txRequest(), rxRequest: () => sai.rxRequest(), canRead: () => sai.canRead(),
    canWrite: channel => sai.canWrite(channel), read: (offset, width) => sai.read(offset, width),
    write(offset, value, width) { const result = sai.write(offset, value, width); if (result) calls.push(['fifo', offset, value, width]); return result; } };
  dma = new DisplayEdma(bus, serial, hooks, endpoint);
  const write = (address, value, width = 4) => assert.equal(dma.write(address, value >>> 0, width), true);
  const program = (channel, options) => {
    write(EDMA + DREG.CDNE, channel, 1);
    const v = new DataView(descriptor(channel, options).buffer);
    for (let offset = 0; offset < 32; offset += 4) write(TCD_BASE + channel * 32 + offset, v.getUint32(offset, true));
  };
  const start = (channel, options) => { program(channel, options);
    if (channel === 0 || channel === 4) write(DMAMUX + channel * 4, 0x80000000 | (channel === 0 ? 20 : 19));
    write(EDMA + DREG.SERQ, channel, 1); };
  const step = () => { const result = dma.phase(); sai.phase(); return result; };
  const runUntil = (predicate, limit = 40000) => { let count = 0; while (!predicate() && count < limit) { step(); count++; }
    assert.ok(predicate(), `bounded core did not reach checkpoint after ${count} calls`); return count; };
  return { sai, dma, dtcm, sdram, bus, memory, calls, irqs, reports, callbacks, program, start, write, step, runUntil,
    changeOwner() { owner++; }, reset() { owner++; dma.reset(); sai.reset(); sai.setClockEnabled(true); configureSai(sai); } };
}

test('live map shape admits owned SDRAM and only the stock DTCM audio extent', () => {
  const cpu = readFileSync(new URL('../../../../opensp/src/lib/emulator/cpu.ts', import.meta.url), 'utf8');
  assert.match(cpu, /name: 'DTCM', address: 0x20000000, bytes: 0x00080000, permissions: 7/);
  assert.match(cpu, /this\.memoryMap = CPU_MEMORY_MAP\.map/);
  const rows = activeMap(), result = admitStockAudioRam(rows); rows[0].bytes = 1; rows[1].address = 0;
  assert.deepEqual(result.admittedRam, [{ start: SDRAM, bytes: 0x10000 }, { start: DTCM, bytes: 0x9000 }]);
  const f = core(); f.bus.check(DTCM + 0x8ffe, 2, 2); f.bus.check(SDRAM + 0xffff, 1);
  for (const [address, bytes, alignment] of [[DTCM + 0x8fff, 2, 1], [DTCM + 1, 4, 4], [0xffffffff, 4, 1], [SAI + 0xa0, 2, 2], [0x20200000, 2, 2]])
    assert.throws(() => f.bus.read(address, bytes, alignment), DisplayBusFault);
  assert.deepEqual(f.calls, []);
  for (const bad of [[], [{ name: 'DTCM', address: DTCM, bytes: 0x8000, permissions: 7 }, activeMap()[1]],
    [activeMap()[0], { ...activeMap()[1], permissions: 1 }], [...activeMap(), activeMap()[0]],
    [{ ...activeMap()[0], address: 0x20200000 }, activeMap()[1]]]) assert.throws(() => admitStockAudioRam(bad), RangeError);
});
test('all active spans remain disjoint and must contain each admitted transfer', () => {
  const memory = { read() { throw new Error('should not read'); }, write() {} }, map = activeMap();
  assert.throws(() => new MappedDisplayBus(memory, [{ start: SDRAM, bytes: 32 }, { start: SDRAM + 16, bytes: 32 }], [{ start: SDRAM, bytes: 16 }], () => 0), RangeError);
  assert.throws(() => new MappedDisplayBus(memory, { start: SAI, bytes: 128 }, [{ start: SAI, bytes: 32 }], () => 0), RangeError);
  assert.throws(() => new MappedDisplayBus(memory, { start: DTCM, bytes: 32 }, [{ start: DTCM, bytes: 64 }], () => 0), RangeError);
  assert.equal(admitStockAudioRam(map).mappedRam.length, 2);
});
test('fixtures own sixteen uint32 words and require finite explicit clock choices', () => {
  const f = core({ rxFrame: [...fixtureWords], slotTicks: 1 });
  const status = f.sai.status(); status.fixtures.rxFrame[0] = 0; f.sai.phase();
  assert.equal(f.sai.read(0xa0, 4), fixtureWords[0]);
  for (const bad of [{ slotTicks: 0 }, { slotTicks: Infinity }, { rxFrame: [0] }, { externalClock: undefined }, { rxFrame: Array(16).fill(-1) }])
    assert.throws(() => core(bad), RangeError);
});
test('RX uses one FIFO for full word and source-used lower halfword; pointer wrap is finite', () => {
  const f = core({ slotTicks: 1 });
  for (let n = 0; n < 32; n++) f.sai.phase();
  assert.equal(f.sai.status().rxCount, 32); assert.equal(f.sai.read(0xc0, 4), 32 << 16);
  assert.equal(f.sai.read(0xa0, 4), fixtureWords[0]); assert.equal(f.sai.read(0xa0, 2), 2);
  assert.equal(f.sai.status().rxCount, 30); assert.equal(f.sai.read(0xa2, 2), undefined);
  for (let n = 0; n < 30; n++) f.sai.read(0xa0, 2);
  for (let n = 0; n < 32; n++) f.sai.phase();
  assert.equal(f.sai.read(0xc0, 4), 32); // write pointer wrapped to0, read pointer32
});
test('RX request is >watermark, warning means full and IRQ requires its own enable', () => {
  const f = core({ slotTicks: 1 }); for (let n = 0; n < 16; n++) f.sai.phase();
  assert.equal(f.sai.rxRequest(), false); f.sai.phase(); assert.equal(f.sai.rxRequest(), true);
  assert.equal(f.sai.status().irq, false); f.sai.write(0x88, 0x90000101, 4); assert.equal(f.sai.status().irq, true);
  f.sai.read(0xa0, 2); assert.equal(f.sai.rxRequest(), false); assert.equal(f.sai.status().irq, false);
  for (let n = 0; n < 16; n++) f.sai.phase(); assert.ok(f.sai.read(0x88, 4) & 0x20000);
  f.sai.write(0x88, 0x90000000, 4); assert.equal(f.sai.rxRequest(), false); assert.ok(f.sai.read(0x88, 4) & 0x10000);
});
test('four TX FIFOs are bounded; request<=watermark and empty warning are independent', () => {
  const f = core(); configureSai(f.sai, false);
  assert.equal(f.sai.txRequest(), true); assert.ok(f.sai.read(8, 4) & 0x20000);
  for (let channel = 0; channel < 4; channel++) for (let n = 0; n < 17; n++) assert.equal(f.sai.write(0x20 + channel * 4, n, 4), true);
  assert.equal(f.sai.txRequest(), false); assert.equal(f.sai.read(8, 4) & 0x20000, 0);
  for (let channel = 0; channel < 4; channel++) for (let n = 17; n < 32; n++) assert.equal(f.sai.write(0x20 + channel * 4, n, 4), true);
  assert.equal(f.sai.write(0x20, 33, 4), false); assert.deepEqual(f.sai.status().txCounts, [32, 32, 32, 32]);
  f.sai.write(8, 0x02000301, 4); assert.deepEqual(f.sai.status().txCounts, [0, 0, 0, 0]);
  assert.equal(f.sai.read(0x40, 4), 0); assert.equal(f.sai.status().irq, true);
  f.sai.write(8, 1, 4); assert.equal(f.sai.status().irq, false);
});
test('FIFO-error W1C leaves derived request/warning flags and disabled IRQs separate', () => {
  const f = core({ slotTicks: 1 }); f.sai.phase(); assert.ok(f.sai.read(8, 4) & 0x40000);
  f.sai.write(8, 0x90000401, 4); assert.equal(f.sai.status().irq, true);
  f.sai.write(8, 0x90040401, 4); assert.equal(f.sai.read(8, 4) & 0x40000, 0); assert.equal(f.sai.status().irq, false);
  assert.ok(f.sai.read(8, 4) & 0x30000);
});
test('external clock, SAI gate, reset and exact serial format each bound slot progress', () => {
  for (const options of [{ externalClock: false }, { saiClockReady: false }]) {
    const f = core(options); for (let n = 0; n < 100; n++) assert.equal(f.sai.phase(), false);
    assert.equal(f.sai.status().slots, 0); assert.equal(f.sai.status().received, 0);
  }
  const f = core({ slotTicks: 1 }); f.sai.setClockEnabled(false); assert.equal(f.sai.phase(), false);
  f.sai.setClockEnabled(true); f.sai.write(0x90, 0x1000000, 4); assert.equal(f.sai.phase(), false);
  f.sai.write(0x90, 0, 4); f.sai.write(0x88, 0x91000001, 4); assert.equal(f.sai.phase(), false);
  f.sai.write(0x88, 0x90000001, 4); assert.equal(f.sai.phase(), true);
});
test('partial TX minor advances accepted addresses while retaining count/link bits until beat16', () => {
  const f = core(); configureSai(f.sai, false); f.start(0); f.program(1);
  for (let n = 0; n < 15; n++) assert.equal(f.dma.phase(), true);
  assert.equal(f.dma.read(TCD_BASE, 4), DTCM + 60); assert.equal(f.dma.read(TCD_BASE + 22, 2), 0x8240);
  assert.deepEqual(f.dma.status().audio.partialMinors, [{ channel: 0, beat: 15 }]);
  assert.equal(f.dma.phase(), true); assert.equal(f.dma.read(TCD_BASE + 22, 2), 0x823f);
  assert.equal(f.dma.read(TCD_BASE + 32 + 28, 2) & CSR.START, CSR.START);
  assert.equal(f.dma.read(EDMA + DREG.HRS, 4) & 0xe, 0);
  assert.equal(f.dma.phase(), true); // internal START services1 without DMAMUX or ERQ
  assert.equal(f.dma.read(TCD_BASE + 32, 4), DTCM + 0x2004);
});
test('full exact64-minor TX chain emits63 minor links and only1 final major link', () => {
  const f = core(); for (let n = 0; n < 0x8000; n++) f.dtcm[n] = (n * 7) & 255;
  for (let n = 0; n <= 4; n++) f.start(n);
  f.runUntil(() => (f.dma.status().requests & 31) === 0);
  assert.deepEqual(f.dma.status().audio.minorLinks, [63, 63, 63, 0]);
  assert.deepEqual(f.dma.status().audio.majorLinks, [1, 1, 1, 0]);
  assert.equal(f.dma.status().audio.internalStarts, 0); assert.deepEqual(f.dma.status().audio.partialMinors, []);
  for (let channel = 0; channel < 4; channel++) {
    assert.equal(f.dma.read(TCD_BASE + channel * 32, 4), DTCM + channel * 0x2000 + 4096);
    assert.equal(f.dma.read(TCD_BASE + channel * 32 + 22, 2), channel < 3 ? 0x8000 | ((channel + 1) << 9) | 64 : 64);
    assert.ok(f.dma.read(TCD_BASE + channel * 32 + 28, 2) & CSR.DONE);
  }
  assert.equal(f.dma.read(TCD_BASE + 4 * 32 + 16, 4), DTCM + 0x8800);
  assert.equal(f.dma.status().interrupts & 31, (1 << 3) | (1 << 4));
  assert.ok(f.irqs.some(([irq, level]) => irq === 3 && level)); assert.ok(f.irqs.some(([irq, level]) => irq === 4 && level));
  for (let n = 0; n < 1024; n++) assert.equal(new DataView(f.dtcm.buffer).getUint16(0x8000 + n * 2, true), (n & 15) + 1);
  for (let channel = 0; channel < 4; channel++) {
    const fifo = f.calls.filter(call => call[0] === 'fifo' && call[1] === 0x20 + channel * 4);
    assert.equal(fifo.length, 1024);
    for (let n = 0; n < 1024; n++) assert.equal(fifo[n][2], new DataView(f.dtcm.buffer).getUint32(channel * 0x2000 + n * 4, true));
  }
  assert.deepEqual(f.reports.filter(([code]) => !code.startsWith('sai-')), []);
});
test('internal START coalesces repeated links into one latch without queue allocation', () => {
  const f = core(); configureSai(f.sai, false); f.start(0); f.program(1);
  // Keep FIFO1 full while0 can accept two16-word minors. No external routes1..3 exist.
  for (let n = 0; n < 32; n++) f.sai.write(0x24, n, 4);
  for (let n = 0; n < 32; n++) f.dma.phase();
  assert.equal(f.dma.status().audio.internalStarts, 2); assert.equal(f.dma.status().audio.minorLinks[0], 2);
  assert.equal(f.dma.status().audio.partialMinors.length, 0);
  f.sai.write(8, 0x02000001, 4); assert.equal(f.dma.phase(), true);
  assert.equal(f.dma.status().audio.internalStarts, 0); assert.equal(f.dma.read(TCD_BASE + 32 + 22, 2), 0x8440);
});
test('completion rearm clears DONE/INT and selects alternate buffers without invented rewind', () => {
  const f = core(); for (let n = 0; n <= 4; n++) f.start(n); f.runUntil(() => (f.dma.status().requests & 31) === 0);
  for (let n = 0; n <= 4; n++) {
    f.write(EDMA + DREG.CINT, n, 1); f.write(EDMA + DREG.CDNE, n, 1);
    f.write(TCD_BASE + n * 32 + (n === 4 ? 16 : 0), DTCM + (n === 4 ? 0x8800 : n * 0x2000 + 0x1000));
    f.write(EDMA + DREG.SERQ, n, 1);
  }
  assert.equal(f.dma.status().interrupts, 0); f.runUntil(() => (f.dma.status().requests & 31) === 0);
  assert.equal(f.dma.read(TCD_BASE + 4 * 32 + 16, 4), DTCM + 0x9000);
  assert.deepEqual(f.dma.status().audio.majorLinks, [2, 2, 2, 0]);
});
test('general DMA IRQ pairing and independent W1C lanes preserve global ownership', () => {
  const levels = dmaIrqLevels((1 << 19) | (1 << 20), 1 << 31, 1 << 31, true);
  assert.deepEqual(levels.filter(([, level]) => level), [[3, true], [4, true], [16, true]]);
  const f = core(); f.start(0, { count: 0x8040 }); f.write(EDMA + DREG.SEEI, 0, 1); f.dma.phase();
  assert.equal(f.dma.status().errors, 1); assert.ok(f.irqs.some(([irq, level]) => irq === 16 && level));
  f.write(EDMA + DREG.CDNE, 0x80008080); // NOP/CDNE, NOP/SSRT, CERR0, NOP/CINT
  assert.equal(f.dma.status().errors, 0); assert.deepEqual(f.irqs.at(-1), [16, false]);
});
test('entire out-of-range minor fails before any RX pop or TX memory callback', () => {
  const f = core({ slotTicks: 1 }); for (let n = 0; n < 17; n++) f.sai.phase();
  f.start(4, { destination: DTCM + 0x8ffe }); const count = f.sai.status().rxCount;
  f.dma.phase(); assert.equal(f.sai.status().rxCount, count); assert.deepEqual(f.calls, []);
  assert.equal(f.dma.status().errors, 1 << 4);
  const g = core(); g.start(0, { source: DTCM + 0x8ffc }); g.dma.phase(); assert.deepEqual(g.calls, []);
  assert.deepEqual(g.sai.status().txCounts, [0, 0, 0, 0]);
});
test('source count/mask/endpoint/width extensions are rejected without broad descriptor acceptance', () => {
  for (const options of [{ initial: 0x8241 }, { count: 0x4240 }, { count: 0x8240, initial: 64 },
    { sourceOffset: 8 }, { attr: 0x0101 }, { csr: CSR.ESG }, { destination: SAI + 0x30 }, { sourceLast: -4096 }]) {
    const f = core(); f.start(0, options); f.dma.phase();
    assert.equal(f.calls.length, 0); assert.ok(f.reports.length > 0);
  }
});
test('partial reset/reprogram/owner change retains accepted RAM effects and cancels old completion', () => {
  const f = core({ slotTicks: 1 }); for (let n = 0; n < 17; n++) f.sai.phase(); f.start(4);
  f.callbacks.write = () => f.reset(); assert.equal(f.dma.phase(), false);
  assert.equal(new DataView(f.dtcm.buffer).getUint16(0x8000, true), 1);
  assert.equal(f.dma.status().interrupts, 0); assert.equal(f.dma.status().audio.partialMinors.length, 0);
  const g = core(); g.start(0); g.callbacks.read = () => g.program(0, { source: DTCM + 0x1000 });
  assert.equal(g.dma.phase(), false); assert.deepEqual(g.sai.status().txCounts, [0, 0, 0, 0]);
  assert.equal(g.dma.read(TCD_BASE, 4), DTCM + 0x1000);
  const h = core(); h.start(0); h.changeOwner(); assert.equal(h.dma.phase(), false);
  assert.throws(() => h.dma.write(EDMA + DREG.CINT, 0, 1), OwnershipChanged);
});
test('memory callback failure raises global ERR/EEI without completion or a synthetic IRQ', () => {
  const f = core(); f.start(0); f.write(EDMA + DREG.SEEI, 0, 1); f.callbacks.read = () => { throw new Error('owned read failure'); };
  assert.equal(f.dma.phase(), true); assert.equal(f.dma.status().errors, 1); assert.equal(f.dma.status().interrupts, 0);
  assert.deepEqual(f.sai.status().txCounts, [0, 0, 0, 0]); assert.ok(f.irqs.some(([irq, level]) => irq === 16 && level));
});
test('queued accepted RX bytes survive owner cancellation for caller drain; no later beat or IRQ runs', () => {
  let owner = 0, dma;
  const queued = [], applied = [], reports = [], irqs = [];
  const bus = new MappedDisplayBus({ read: (_a, n) => new Uint8Array(n), write(address, bytes) {
    queued.push({ address, bytes }); owner++; } }, [{ start: DTCM, bytes: 0x80000 }], [{ start: DTCM, bytes: 0x9000 }], () => owner);
  const sai = new AudioSai(fixtures({ slotTicks: 1 }), { owner: () => owner, diagnostic() {}, onIrq() {} });
  sai.setClockEnabled(true); configureSai(sai); for (let n = 0; n < 17; n++) sai.phase();
  dma = new DisplayEdma(bus, { txRequest: () => false, rxRequest: () => false, read: () => undefined, write: () => false },
    { owner: () => owner, diagnostic: code => reports.push(code), onIrq: (...event) => irqs.push(event) }, sai);
  const v = new DataView(descriptor(4).buffer);
  for (let n = 0; n < 32; n += 4) dma.write(TCD_BASE + 128 + n, v.getUint32(n, true), 4);
  dma.write(DMAMUX + 16, 0x80000013, 4); dma.write(EDMA + DREG.SERQ, 4, 1);
  assert.equal(dma.phase(), false); assert.equal(queued.length, 1); assert.equal(dma.phase(), false);
  for (const entry of queued) applied.push([entry.address, [...entry.bytes]]);
  assert.deepEqual(applied, [[DTCM + 0x8000, [1, 0]]]); assert.equal(dma.status().interrupts, 0);
  assert.deepEqual(reports, []); assert.deepEqual(irqs.filter(([, level]) => level), []);
  // Actual CPU instruction-boundary drain/terminal-backend behavior is outside this pure bus test.
});
test('separate eDMA/SAI owners retain independent RAM, FIFO, requests and reset state', () => {
  const a = core(), b = core(); a.start(0); b.start(0); a.dtcm[0] = 0x7b; b.dtcm[0] = 0x31;
  a.dma.phase(); b.dma.phase(); a.reset();
  assert.deepEqual(a.sai.status().txCounts, [0, 0, 0, 0]); assert.deepEqual(b.sai.status().txCounts, [1, 0, 0, 0]);
  assert.equal(b.dma.read(TCD_BASE, 4), DTCM + 4); assert.equal(b.dma.read(EDMA + DREG.ERQ, 4), 1);
  assert.equal(a.dtcm[0], 0x7b); assert.equal(b.dtcm[0], 0x31); assert.equal(b.calls.find(call => call[0] === 'fifo')[2], 0x31);
});
function aggregate() {
  const dtcm = new Uint8Array(0x9000), sdram = new Uint8Array(0x10000), bytes = [], irqs = [];
  const callbacks = { read: undefined, write: undefined, irq: undefined };
  let transport;
  transport = new DisplayTransport({ ...admitStockAudioRam(activeMap()),
    memory: { read(address, count) { callbacks.read?.(); const data = address >= SDRAM ? sdram : dtcm;
        return data.slice(address - (address >= SDRAM ? SDRAM : DTCM), address - (address >= SDRAM ? SDRAM : DTCM) + count); },
      write(address, data) { (address >= SDRAM ? sdram : dtcm).set(data, address - (address >= SDRAM ? SDRAM : DTCM)); callbacks.write?.(); } },
    fixtures: { quantumTicks: 1, workCap: 64, dmaClockReady: true, lpspiClockReady: true, sinByte: 0x5a },
    audioFixtures: fixtures({ slotTicks: 8 }), onByte: value => bytes.push(value), onPcs() {},
    onIrq(irq, level) { irqs.push([irq, level]); callbacks.irq?.(irq, level); } });
  const write = (address, value, width = 4) => assert.equal(transport.write(address, value >>> 0, width), true);
  configureSai({ write: (offset, value, width) => transport.write(SAI + offset, value, width) });
  const program = (channel, data = descriptor(channel)) => { write(EDMA + DREG.CDNE, channel, 1);
    const v = new DataView(data.buffer); for (let offset = 0; offset < 32; offset += 4) write(TCD_BASE + channel * 32 + offset, v.getUint32(offset, true)); };
  return { transport, dtcm, sdram, bytes, irqs, callbacks, write, program };
}
test('SAI clock and DMA gate progress with LPSPI disabled; each tick keeps the shared work cap', () => {
  const f = aggregate(); for (let n = 0; n <= 4; n++) { f.program(n); f.write(EDMA + DREG.SERQ, n, 1); }
  f.write(DMAMUX, 0x80000014); f.write(DMAMUX + 16, 0x80000013);
  f.transport.notifyClock(DMA_CLOCK, 0xc0000); f.transport.tick(1000);
  assert.equal(f.transport.status().edma.channel6.every(byte => byte === 0), true);
  assert.equal(f.transport.read(TCD_BASE, 4), DTCM); assert.ok(f.transport.status().audio.slots > 0);
  f.transport.notifyClock(DMA_CLOCK, 0xc00c0); const before = f.transport.status().phases; f.transport.tick(1000);
  assert.ok(f.transport.read(TCD_BASE, 4) > DTCM); assert.ok(f.transport.status().phases - before <= 64);
  assert.equal(f.transport.status().clocks.lpspiEnabled, false); assert.deepEqual(f.bytes, []);
  f.transport.notifyClock(DMA_CLOCK, 0xc0); const slots = f.transport.status().audio.slots; f.transport.tick(1000);
  assert.equal(f.transport.status().audio.slots, slots);
});
test('audio0–4 and display6/7 share one global bank and independent endpoint effects', () => {
  const f = aggregate(); for (let n = 0; n <= 4; n++) { f.program(n); f.write(EDMA + DREG.SERQ, n, 1); }
  f.write(DMAMUX, 0x80000014); f.write(DMAMUX + 16, 0x80000013);
  f.sdram[0x100] = 0xae;
  const makeDisplay = (rx) => { const b = new Uint8Array(32), v = new DataView(b.buffer);
    v.setUint32(0, rx ? LPSPI + SREG.RDR + 3 : SDRAM + 0x100, true); v.setInt16(4, rx ? 0 : 1, true);
    v.setUint32(8, 1, true); v.setUint32(16, rx ? SDRAM + 0x200 : LPSPI + SREG.TDR + 3, true);
    v.setInt16(20, rx ? 1 : 0, true); v.setUint16(22, 1, true); v.setUint16(28, CSR.DREQ | CSR.INTMAJOR, true); v.setUint16(30, 1, true); return b; };
  for (const n of [6, 7]) { f.program(n, makeDisplay(n === 7)); f.write(DMAMUX + n * 4, 0x80000000 | (n === 6 ? 80 : 79)); f.write(EDMA + DREG.SERQ, n, 1); }
  f.write(LPSPI + SREG.CR, 1); f.write(LPSPI + SREG.CFGR1, 1); f.write(LPSPI + SREG.DER, 3); f.write(LPSPI + SREG.TCR, 0x00400007);
  f.transport.notifyClock(DMA_CLOCK, 0xc00c0); f.transport.notifyClock(SPI_CLOCK, 0xc0);
  for (let n = 0; n < 800 && !(f.transport.status().edma.interrupts & (1 << 7)); n++) f.transport.tick(64);
  assert.deepEqual(f.bytes, [0xae]); assert.equal(f.sdram[0x200], 0x5a); assert.ok(f.transport.read(TCD_BASE, 4) > DTCM);
  assert.equal(f.transport.status().edma.errors, 0);
});
test('aggregate disposal/reset inside accepted RX callback cancels remaining work without reverting RAM', () => {
  for (const action of ['dispose', 'reset']) {
    const f = aggregate(); f.program(4); f.write(DMAMUX + 16, 0x80000013); f.write(EDMA + DREG.SERQ, 4, 1);
    f.transport.notifyClock(DMA_CLOCK, 0xc00c0); f.callbacks.write = () => f.transport[action]();
    for (let n = 0; n < 40 && !new DataView(f.dtcm.buffer).getUint16(0x8000, true); n++) f.transport.tick(64);
    assert.equal(new DataView(f.dtcm.buffer).getUint16(0x8000, true), 1);
    assert.equal(f.transport.status().edma.interrupts, 0); assert.equal(f.transport.status().creditTicks, 0);
    const after = f.dtcm.slice(); f.transport.tick(100000); assert.deepEqual(f.dtcm, after);
    assert.equal(f.transport.status().disposed, action === 'dispose');
  }
});
function pendingDisplayWithAudio(cancel = false) {
  const ram = new Uint8Array(0x10000), reads = [], writes = [], received = [], hooks = { irq: undefined };
  let transport;
  const make = ({ source, sourceOffset = 0, attr = 0, bytes = 1, destination, destinationOffset = 0, destinationLast = 0, csr }) => {
    const data = new Uint8Array(32), view = new DataView(data.buffer);
    view.setUint32(0, source, true); view.setInt16(4, sourceOffset, true); view.setUint16(6, attr, true);
    view.setUint32(8, bytes, true); view.setUint32(16, destination, true); view.setInt16(20, destinationOffset, true);
    view.setUint16(22, 1, true); view.setUint32(24, destinationLast, true); view.setUint16(28, csr, true); view.setUint16(30, 1, true); return data;
  };
  transport = new DisplayTransport({ ...admitStockAudioRam(activeMap()),
    memory: { read(address, bytes) { reads.push([address, bytes]); return ram.slice(address - SDRAM, address - SDRAM + bytes); },
      write(address, bytes) { writes.push([address, [...bytes]]); ram.set(bytes, address - SDRAM); } },
    fixtures: { quantumTicks: 1, workCap: 64, dmaClockReady: true, lpspiClockReady: true, sinByte: 0x5a },
    audioFixtures: fixtures({ slotTicks: 1 }), onByte(value) { received.push(value); }, onPcs() {},
    onIrq(irq, level) { hooks.irq?.(irq, level); } });
  const write = (address, value, width = 4) => assert.equal(transport.write(address, value >>> 0, width), true);
  configureSai({ write: (offset, value, width) => transport.write(SAI + offset, value, width) });
  transport.notifyClock(DMA_CLOCK, 0xc00c0); transport.notifyClock(SPI_CLOCK, 0xc0);
  write(LPSPI + SREG.CR, 1); write(LPSPI + SREG.CFGR1, 1); write(LPSPI + SREG.DER, 3); write(LPSPI + SREG.TCR, 0x00600007);
  ram[0x100] = 0xae; new DataView(ram.buffer).setUint32(0x300, 0x00400007, true);
  ram.set(make({ source: SDRAM + 0x300, attr: 0x0202, bytes: 4, destination: LPSPI + SREG.TCR, csr: CSR.DREQ }), 0x200);
  const source = make({ source: SDRAM + 0x100, sourceOffset: 1, destination: LPSPI + SREG.TDR + 3, destinationLast: SDRAM + 0x200, csr: CSR.ESG });
  const v = new DataView(source.buffer); for (let n = 0; n < 32; n += 4) write(TCD_BASE + 192 + n, v.getUint32(n, true));
  write(DMAMUX + 24, 0x80000050); write(EDMA + DREG.SERQ, 6, 1);
  for (let n = 0; n < 32 && transport.status().edma.pendingTerminal !== 1; n++) transport.tick(1);
  assert.equal(transport.status().edma.pendingTerminal, 1);
  assert.deepEqual(reads, [[SDRAM + 0x100, 1]]);
  if (cancel) {
    // The retained unchanged-owner cancellation fixture: LPSPI's IRQ callback rejects its local phase.
    write(LPSPI + SREG.FCR, 1);
    hooks.irq = (irq, level) => { if (irq === 35 && level) throw new OwnershipChanged(); };
    assert.equal(transport.write(LPSPI + SREG.IER, 1), false);
    assert.equal(transport.status().lpspi.cancelled, true); assert.deepEqual(received, []);
  }
  return { transport, reads, writes, write };
}
test('audio-present shared DMA cannot read pending display SG while LPSPI clock is off', () => {
  const f = pendingDisplayWithAudio(); f.transport.notifyClock(SPI_CLOCK, 0);
  const before = structuredClone(f.reads), slots = f.transport.status().audio.slots;
  f.transport.tick(1000);
  assert.deepEqual(f.reads, before); assert.deepEqual(f.writes, []);
  assert.equal(f.transport.status().edma.pendingTerminal, 1); assert.ok(f.transport.status().audio.slots > slots);
  f.transport.notifyClock(SPI_CLOCK, 0xc0);
  for (let n = 0; n < 32 && f.transport.status().edma.pendingTerminal; n++) f.transport.tick(1);
  assert.ok(f.reads.some(([address, bytes]) => address === SDRAM + 0x200 && bytes === 32));
});
test('audio-present shared DMA cannot read pending display SG after foreign LPSPI cancellation', () => {
  const f = pendingDisplayWithAudio(true), before = structuredClone(f.reads), status = f.transport.status();
  f.transport.tick(1000);
  assert.deepEqual(f.reads, before); assert.deepEqual(f.writes, []);
  assert.equal(f.transport.status().edma.pendingTerminal, 1); assert.equal(f.transport.status().lpspi.cancelled, true);
  assert.ok(f.transport.status().audio.slots > status.audio.slots);
  assert.equal(f.transport.status().edma.errors, 0);
});
test('unchanged-owner SAI IRQ cancellation stays retired until reset and keeps accepted RX entries', () => {
  const f = core({ slotTicks: 1 }); for (let n = 0; n < 17; n++) f.sai.phase();
  const before = f.sai.status(); f.callbacks.irq = (irq, level) => { if (irq === 56 && level) throw new OwnershipChanged(); };
  assert.throws(() => f.sai.write(0x88, 0x90000101, 4), OwnershipChanged);
  assert.equal(f.sai.status().cancelled, true); assert.equal(f.sai.status().rxCount, 17);
  for (let n = 0; n < 100; n++) assert.equal(f.sai.phase(), false);
  assert.equal(f.sai.status().slots, before.slots); assert.equal(f.sai.rxRequest(), false); assert.equal(f.sai.canRead(), false);
  f.callbacks.irq = undefined; f.sai.reset(); f.sai.setClockEnabled(true); configureSai(f.sai);
  assert.equal(f.sai.status().cancelled, false); assert.equal(f.sai.phase(), true);
});
test('aggregate foreign SAI cancellation excludes its pending DMA while retaining display eligibility', () => {
  const f = aggregate(); f.program(4); f.write(DMAMUX + 16, 0x80000013); f.write(EDMA + DREG.SERQ, 4, 1);
  f.transport.notifyClock(DMA_CLOCK, 0xc0000); // no DMA while fixture fills the shared RX FIFO
  for (let n = 0; n < 3; n++) f.transport.tick(64);
  f.callbacks.irq = (irq, level) => { if (irq === 56 && level) throw new OwnershipChanged(); };
  assert.equal(f.transport.write(SAI + 0x88, 0x90000101, 4), false);
  const before = f.transport.status(); assert.equal(before.audio.cancelled, true);
  f.transport.notifyClock(DMA_CLOCK, 0xc00c0); f.transport.notifyClock(SPI_CLOCK, 0xc0);
  f.transport.tick(100000); assert.equal(f.transport.status().audio.slots, before.audio.slots);
  assert.equal(f.transport.read(TCD_BASE + 128 + 16, 4), DTCM + 0x8000);
  assert.equal(f.dtcm.some(byte => byte !== 0), false); assert.equal(f.transport.status().edma.interrupts, 0);
  // Independent display commands still consume under the same global owner.
  f.write(LPSPI + SREG.CR, 1); f.write(LPSPI + SREG.CFGR1, 1); f.write(LPSPI + SREG.TCR, 0x00400007);
  f.write(LPSPI + SREG.TDR + 3, 0xae, 1); f.transport.tick(64); assert.deepEqual(f.bytes, [0xae]);
  f.callbacks.irq = undefined; f.transport.reset(); assert.equal(f.transport.status().audio.cancelled, false);
});
test('IRQ callback reset cannot mark the replacement SAI generation cancelled or failed', () => {
  const f = core({ slotTicks: 1 }); for (let n = 0; n < 17; n++) f.sai.phase();
  f.callbacks.irq = (irq, level) => { if (irq === 56 && level) f.sai.reset(); };
  assert.throws(() => f.sai.write(0x88, 0x90000101, 4), OwnershipChanged);
  assert.equal(f.sai.status().cancelled, false); assert.equal(f.sai.status().failed, false);
  assert.equal(f.sai.status().rxCount, 0); assert.equal(f.sai.status().irq, false);
  f.callbacks.irq = undefined; f.sai.setClockEnabled(true); configureSai(f.sai); assert.equal(f.sai.phase(), true);
});
test('ordinary SAI callback failure is named, contained and prevents later fixture work', () => {
  const f = core({ slotTicks: 1 }); for (let n = 0; n < 17; n++) f.sai.phase();
  f.callbacks.irq = (irq, level) => { if (irq === 56 && level) throw new Error('owned callback fault'); };
  assert.throws(() => f.sai.write(0x88, 0x90000101, 4), AudioCallbackFault);
  assert.equal(f.sai.status().failed, true); assert.equal(f.sai.status().rxCount, 17); assert.equal(f.sai.phase(), false);
  const g = aggregate(); g.transport.notifyClock(DMA_CLOCK, 0xc0000); for (let n = 0; n < 3; n++) g.transport.tick(64);
  g.callbacks.irq = (irq, level) => { if (irq === 56 && level) throw new Error('owned callback fault'); };
  assert.equal(g.transport.write(SAI + 0x88, 0x90000101, 4), false);
  assert.equal(g.transport.status().audio.failed, true);
  assert.ok(g.transport.status().diagnostics.some(row => row.code === 'sai-callback-failure'));
});
test('reset-then-throw SAI callback cannot publish failure or diagnostics into the new generation', () => {
  const f = core({ slotTicks: 1 }); for (let n = 0; n < 17; n++) f.sai.phase();
  f.callbacks.irq = (irq, level) => { if (irq === 56 && level) { f.sai.reset(); throw new Error('old callback after reset'); } };
  assert.throws(() => f.sai.write(0x88, 0x90000101, 4), OwnershipChanged);
  assert.equal(f.sai.status().failed, false); assert.equal(f.sai.status().cancelled, false); assert.equal(f.sai.status().rxCount, 0);
  const g = aggregate(); g.transport.notifyClock(DMA_CLOCK, 0xc0000); for (let n = 0; n < 3; n++) g.transport.tick(64);
  const owner = g.transport.status().owner;
  g.callbacks.irq = (irq, level) => { if (irq === 56 && level) { g.transport.reset(); throw new Error('old callback after reset'); } };
  assert.equal(g.transport.write(SAI + 0x88, 0x90000101, 4), false);
  const current = g.transport.status(); assert.equal(current.owner, owner + 1);
  assert.equal(current.audio.failed, false); assert.equal(current.audio.cancelled, false); assert.equal(current.audio.rxCount, 0);
  assert.deepEqual(current.diagnostics, []); assert.equal(current.creditTicks, 0); assert.equal(current.phases, 0);
});

test('stock CR490 permits plain minor counts with EMLM and no minor offsets', () => {
  const f = core(); f.write(EDMA + DREG.CR, 0x490);
  for (let n = 0; n < 0x8000; n++) f.dtcm[n] = (n * 13) & 255;
  for (let channel = 0; channel <= 4; channel++) f.start(channel);
  f.runUntil(() => (f.dma.status().requests & 31) === 0);
  assert.deepEqual(f.dma.status().blockedChannels, []);
  assert.equal(f.dma.status().errors, 0);
  assert.deepEqual(f.dma.status().audio.minorLinks, [63, 63, 63, 0]);
  assert.deepEqual(f.dma.status().audio.majorLinks, [1, 1, 1, 0]);
  assert.equal(f.dma.status().interrupts & 31, 24);
  assert.equal(f.dma.read(TCD_BASE + 4 * 32 + 16, 4), DTCM + 0x8800);
  for (let n = 0; n < 1024; n++) assert.equal(new DataView(f.dtcm.buffer).getUint16(0x8000 + n * 2, true), (n & 15) + 1);
  for (let channel = 0; channel < 4; channel++) {
    const accepted = f.calls.filter(call => call[0] === 'fifo' && call[1] === 0x20 + channel * 4);
    assert.equal(accepted.length, 1024);
    for (let n = 0; n < 1024; n++) assert.equal(accepted[n][2], new DataView(f.dtcm.buffer).getUint32(channel * 0x2000 + n * 4, true));
  }
  assert.ok(f.irqs.some(([irq, level]) => irq === 3 && level));
  assert.ok(f.irqs.some(([irq, level]) => irq === 4 && level));
  assert.deepEqual(f.reports.filter(([code]) => !code.startsWith('sai-')), []);
});

test('enabled minor offset forms remain refused before destructive audio accesses', () => {
  for (const channel of [0, 4]) for (const enable of [0x40000000, 0x80000000, 0xc0000000]) {
    const f = core({ slotTicks: 1 }); f.write(EDMA + DREG.CR, 0x490);
    for (let n = 0; n < 17; n++) f.sai.phase();
    const beforeRx = f.sai.status().rxCount;
    f.start(channel, { bytes: ((channel === 4 ? 32 : 64) | enable) >>> 0 });
    f.dma.phase();
    assert.deepEqual(f.dma.status().blockedChannels, [channel]);
    assert.equal(f.dma.status().errors, 0);
    assert.ok(f.reports.some(([code, owner]) => code === 'audio-descriptor-form-unsupported' && owner === channel));
    assert.deepEqual(f.calls, []);
    assert.equal(f.sai.status().rxCount, beforeRx);
    assert.deepEqual(f.sai.status().txCounts, [0, 0, 0, 0]);
  }
});
