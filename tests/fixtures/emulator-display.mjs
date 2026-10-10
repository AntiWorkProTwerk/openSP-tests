import assert from 'node:assert/strict';
import { DisplayTransport } from '../../src/lib/emulator/display-transport.ts';
import { CSR, DMAMUX, DREG, EDMA, LPSPI, DMA_CLOCK, SPI_CLOCK, SREG, TCD_BASE } from '../../src/lib/emulator/display-types.ts';

export const RAM = 0x80000000, TX = RAM + 0x21, RX = RAM + 0x80, TERMINAL_WORD = RAM + 0x100, SG = RAM + 0x200;
export function descriptor(options = {}) {
  const t = { source: TX, sourceOffset: 1, attr: 0, bytes: 1, sourceLast: 0,
    destination: LPSPI + SREG.TDR + 3, destinationOffset: 0, count: 1,
    destinationLast: SG, csr: CSR.ESG, initialCount: 1, ...options };
  const bytes = new Uint8Array(32), v = new DataView(bytes.buffer);
  v.setUint32(0, t.source, true); v.setInt16(4, t.sourceOffset, true); v.setUint16(6, t.attr, true);
  v.setUint32(8, t.bytes, true); v.setInt32(12, t.sourceLast, true); v.setUint32(16, t.destination, true);
  v.setInt16(20, t.destinationOffset, true); v.setUint16(22, t.count, true);
  v.setUint32(24, t.destinationLast >>> 0, true); v.setUint16(28, t.csr, true); v.setUint16(30, t.initialCount, true);
  return bytes;
}
export function fixture(overrides = {}) {
  const ram = new Uint8Array(0x1000), calls = [], bytes = [], pcs = [], irqs = [];
  const hooks = { read: undefined, write: undefined, byte: undefined, pcs: undefined, irq: undefined };
  let transport;
  const memory = {
    read(address, length) { calls.push(['read', address, length]); hooks.read?.(address, length);
      return ram.slice(address - RAM, address - RAM + length); },
    write(address, data) { calls.push(['write', address, [...data]]); ram.set(data, address - RAM);
      hooks.write?.(address, data); },
  };
  transport = new DisplayTransport({ memory, mappedRam: { start: RAM, bytes: ram.length },
    admittedRam: [{ start: RAM, bytes: ram.length }],
    fixtures: { quantumTicks: 1, workCap: 64, dmaClockReady: true, lpspiClockReady: true, sinByte: 0x5a, ...overrides },
    onByte(value) { bytes.push(value); hooks.byte?.(value); },
    onPcs(active) { pcs.push(active); hooks.pcs?.(active); },
    onIrq(irq, active) { irqs.push([irq, active]); hooks.irq?.(irq, active); } });
  const write = (address, value, width = 4) => assert.equal(transport.write(address, value >>> 0, width), true);
  const program = (channel, data) => {
    write(EDMA + DREG.CDNE, channel, 1);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let offset = 0; offset < 32; offset += 4) write(TCD_BASE + channel * 32 + offset, view.getUint32(offset, true));
  };
  const configure = () => {
    transport.notifyClock(DMA_CLOCK, 0xc0); transport.notifyClock(SPI_CLOCK, 0xc0);
    write(LPSPI + SREG.CR, 1); write(LPSPI + SREG.CFGR1, 1); write(LPSPI + SREG.DER, 3);
    write(LPSPI + SREG.TCR, 0x00600007);
  };
  const request = (values = {}) => {
    const tx = values.tx ?? TX, rx = values.rx ?? RX, sg = values.sg ?? SG, word = values.word ?? TERMINAL_WORD;
    ram[tx - RAM] = values.byte ?? 0xae;
    new DataView(ram.buffer).setUint32(word - RAM, 0x00400007, true);
    ram.set(descriptor({ source: word, sourceOffset: 0, attr: 0x0202, bytes: 4,
      destination: LPSPI + SREG.TCR, destinationLast: 0, csr: CSR.DREQ }), sg - RAM);
    program(6, descriptor({ source: tx, destinationLast: sg }));
    program(7, descriptor({ source: LPSPI + SREG.RDR + 3, sourceOffset: 0,
      destination: rx, destinationLast: 0, csr: CSR.INTMAJOR | CSR.DREQ }));
    write(DMAMUX + 6 * 4, 0x80000050); write(DMAMUX + 7 * 4, 0x8000004f);
    write(EDMA + DREG.SERQ, 6, 1); write(EDMA + DREG.SERQ, 7, 1);
  };
  return { transport, ram, calls, bytes, pcs, irqs, hooks, write, program, configure, request };
}
export function csr(transport, channel) { return transport.read(TCD_BASE + channel * 32 + 28, 2); }
