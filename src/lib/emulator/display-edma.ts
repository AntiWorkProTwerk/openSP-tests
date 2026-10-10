import { MappedDisplayBus } from './display-bus.ts';
import { CSR, DMAMUX, DREG, DisplayBusFault, EDMA, LPSPI, OwnershipChanged,
  TCD_BASE, type Width } from './display-types.ts';
import { SAI } from './audio-sai.ts';

export interface DmaSerialEndpoint {
  txRequest(): boolean;
  rxRequest(): boolean;
  read(offset: number, width: Width): number | undefined;
  write(offset: number, value: number, width: Width): boolean;
}
export interface EdmaHooks {
  owner(): number;
  diagnostic(code: string, channel?: number, address?: number): void;
  onIrq(irq: number, asserted: boolean): void;
}
export interface DmaAudioEndpoint extends DmaSerialEndpoint {
  canWrite(channel: number): boolean;
  canRead(): boolean;
}
interface AudioTransfer { source: number; destination: number; size: 2 | 4; count: number;
  rawInitial: number; countPrefix: number; csr: number; beat: number }
interface Transfer { source: number; destination: number; sourceOffset: number; destinationOffset: number;
  size: 1 | 4; count: number; initialCount: number; sourceLast: number; destinationLast: number; csr: number }
interface Ticket { local: number; owner: number; channel?: number; operation?: number }
export function dmaIrqLevels(interrupts: number, errors: number, enables: number, audio = false): readonly [number, boolean][] {
  if (audio) return [...Array.from({ length: 16 }, (_, irq): [number, boolean] =>
    [irq, !!(interrupts & ((1 << irq) | (1 << (irq + 16))))]), [16, !!(errors & enables)]];
  return [[6, !!(interrupts & ((1 << 6) | (1 << 22)))],
    [7, !!(interrupts & ((1 << 7) | (1 << 23)))], [16, !!(errors & enables)]];
}

/** The normal channel6/TX80 + channel7/RX79 byte form and one terminal TCR SG form. */
export class DisplayEdma {
  private tcd = new Uint8Array(32 * 32);
  private mux = new Uint32Array(32);
  private priorities = Uint8Array.from({ length: 32 }, (_, n) => n);
  private control = 0x400;
  private requests = 0;
  private errorEnables = 0;
  private interrupts = 0;
  private errors = 0;
  private errorStatus = 0;
  private blocked = new Set<number>();
  private links = new Uint8Array(32);
  private pending = new Map<number, number>();
  private irq = new Map<number, boolean>();
  private readonly hooks: Readonly<EdmaHooks>;
  private readonly serial: Readonly<DmaSerialEndpoint>;
  private readonly audio?: Readonly<DmaAudioEndpoint>;
  private audioMinors = new Map<number, AudioTransfer>();
  private internalStarts = 0;
  private minorLinks = new Array<number>(4).fill(0);
  private majorLinks = new Array<number>(4).fill(0);
  private generation = 0;
  private boundOwner = 0;
  private operations = new Array<number>(32).fill(0);
  constructor(private readonly bus: MappedDisplayBus, serial: DmaSerialEndpoint, hooks: EdmaHooks, audio?: DmaAudioEndpoint) {
    this.hooks = Object.freeze({ owner: hooks.owner.bind(hooks), diagnostic: hooks.diagnostic.bind(hooks),
      onIrq: hooks.onIrq.bind(hooks) });
    this.serial = Object.freeze({ txRequest: serial.txRequest.bind(serial), rxRequest: serial.rxRequest.bind(serial),
      read: serial.read.bind(serial), write: serial.write.bind(serial) });
    if (audio) this.audio = Object.freeze({ txRequest: audio.txRequest.bind(audio), rxRequest: audio.rxRequest.bind(audio),
      canWrite: audio.canWrite.bind(audio), canRead: audio.canRead.bind(audio), read: audio.read.bind(audio), write: audio.write.bind(audio) });
    this.boundOwner = this.hooks.owner();
  }
  private ticket(channel?: number): Ticket {
    return { local: this.generation, owner: this.boundOwner, channel,
      operation: channel === undefined ? undefined : this.operations[channel] };
  }
  private guard(ticket: Ticket): void {
    if (ticket.local !== this.generation || ticket.owner !== this.hooks.owner() ||
      ticket.channel !== undefined && ticket.operation !== this.operations[ticket.channel]) throw new OwnershipChanged();
  }
  reset(): void {
    const asserted = [...this.irq].filter(([, value]) => value);
    this.generation++; this.boundOwner = this.hooks.owner();
    this.tcd = new Uint8Array(32 * 32); this.mux = new Uint32Array(32); this.control = 0x400; this.requests = 0;
    this.errorEnables = 0; this.interrupts = 0; this.errors = 0; this.errorStatus = 0;
    this.blocked.clear(); this.links.fill(0); this.pending.clear(); this.irq.clear();
    this.audioMinors.clear(); this.internalStarts = 0; this.minorLinks.fill(0); this.majorLinks.fill(0);
    this.priorities = Uint8Array.from({ length: 32 }, (_, n) => n);
    const ticket = this.ticket();
    try { for (const [number] of asserted) { this.guard(ticket); this.hooks.onIrq(number, false); this.guard(ticket); } }
    catch (error) { if (!(error instanceof OwnershipChanged)) throw error; }
  }
  handles(address: number, width: Width): boolean {
    return address >= EDMA && address + width <= EDMA + 0x200 ||
      address >= TCD_BASE && address + width <= TCD_BASE + 1024 ||
      address >= DMAMUX && address + width <= DMAMUX + 128;
  }
  private view(channel: number): DataView { return new DataView(this.tcd.buffer, channel * 32, 32); }
  private newOperation(channel: number): void {
    this.operations[channel]++;
    this.links[channel] = 0; this.pending.delete(channel); this.blocked.delete(channel);
    this.audioMinors.delete(channel);
    if (this.internalStarts & (1 << channel)) {
      const v = this.view(channel); v.setUint16(28, v.getUint16(28, true) & ~CSR.START, true);
    }
    this.internalStarts = (this.internalStarts & ~(1 << channel)) >>> 0;
  }
  private changedIrqs(ticket: Ticket): void {
    this.guard(ticket);
    for (const [number, value] of dmaIrqLevels(this.interrupts, this.errors, this.errorEnables, !!this.audio)) {
      if (this.irq.get(number) === value) continue;
      this.guard(ticket); this.irq.set(number, value); this.hooks.onIrq(number, value); this.guard(ticket);
    }
  }
  private park(channel: number, code: string, ticket: Ticket, address?: number): void {
    this.guard(ticket); this.blocked.add(channel); this.hooks.diagnostic(code, channel, address); this.guard(ticket);
  }
  private fail(channel: number, condition: number, code: string, ticket: Ticket): void {
    this.guard(ticket);
    this.errors = (this.errors | (1 << channel)) >>> 0;
    this.errorStatus = (0x80000000 | (channel << 8) | condition) >>> 0;
    this.requests = (this.requests & ~(1 << channel)) >>> 0;
    if (this.control & 0x10) this.control |= 0x20;
    this.hooks.diagnostic(code, channel); this.guard(ticket); this.changedIrqs(ticket);
  }
  private lane(word: number, address: number, width: Width): number {
    return width === 4 ? word >>> 0 : (word >>> ((address & 3) * 8)) & (width === 1 ? 255 : 65535);
  }
  read(address: number, width: Width): number | undefined {
    if (address >= DMAMUX && address + width <= DMAMUX + 128)
      return this.lane(this.mux[(address - DMAMUX) >>> 2], address, width);
    if (address >= TCD_BASE && address + width <= TCD_BASE + 1024) {
      const v = new DataView(this.tcd.buffer), offset = address - TCD_BASE;
      return width === 1 ? v.getUint8(offset) : width === 2 ? v.getUint16(offset, true) : v.getUint32(offset, true);
    }
    const offset = address - EDMA;
    if (offset >= 0x18 && offset + width <= 0x20) return 0;
    if (offset >= 0x100 && offset + width <= 0x120) {
      let value = 0; for (let n = 0; n < width; n++) value |= this.priorities[((offset + n - 0x100) ^ 3)] << (n * 8);
      return value >>> 0;
    }
    const register = offset & ~3;
    const words: Record<number, number> = { [DREG.CR]: this.control, [DREG.ES]: this.errorStatus,
      [DREG.ERQ]: this.requests, [DREG.EEI]: this.errorEnables, [DREG.INT]: this.interrupts,
      [DREG.ERR]: this.errors };
    if (register === DREG.HRS) return this.lane(this.hardwareRequests(), address, width);
    return words[register] === undefined ? undefined : this.lane(words[register], address, width);
  }
  private merge(old: number, address: number, value: number, width: Width): number {
    const shift = (address & 3) * 8, mask = width === 4 ? 0xffffffff : (width === 1 ? 255 : 65535) << shift;
    return ((old & ~mask) | ((width === 4 ? value : value << shift) & mask)) >>> 0;
  }
  private command(offset: number, value: number, ticket: Ticket): void {
    this.guard(ticket);
    if (value & 0x80) return;
    const selected = value & 0x40 ? Array.from({ length: 32 }, (_, n) => n) : [value & 31];
    for (const channel of selected) {
      this.guard(ticket);
      const bit = (1 << channel) >>> 0;
      if (offset === DREG.CEEI) this.errorEnables = (this.errorEnables & ~bit) >>> 0;
      if (offset === DREG.SEEI) this.errorEnables = (this.errorEnables | bit) >>> 0;
      if (offset === DREG.CERQ) this.requests = (this.requests & ~bit) >>> 0;
      if (offset === DREG.SERQ) {
        if (!(this.requests & bit)) this.newOperation(channel);
        this.requests = (this.requests | bit) >>> 0;
      }
      if (offset === DREG.CDNE) this.view(channel).setUint16(28, this.view(channel).getUint16(28, true) & ~CSR.DONE, true);
      if (offset === DREG.SSRT) this.park(channel, 'software-start-unsupported', ticket);
      if (offset === DREG.CERR) {
        this.errors = (this.errors & ~bit) >>> 0;
        if (!this.errors) this.errorStatus = 0;
      }
      if (offset === DREG.CINT) this.interrupts = (this.interrupts & ~bit) >>> 0;
    }
    this.changedIrqs(ticket);
  }
  write(address: number, value: number, width: Width): boolean {
    const ticket = this.ticket(); this.guard(ticket);
    if (address >= DMAMUX && address + width <= DMAMUX + 128) {
      if (width !== 4) { this.hooks.diagnostic('dmamux-width-unsupported', undefined, address); this.guard(ticket); return false; }
      const channel = (address - DMAMUX) >>> 2; this.mux[channel] = value >>> 0; this.blocked.delete(channel); return true;
    }
    if (address >= TCD_BASE && address + width <= TCD_BASE + 1024) {
      const channel = (address - TCD_BASE) >>> 5, local = (address - TCD_BASE) & 31;
      if (local + width > 32) return false;
      const v = this.view(channel), oldCsr = v.getUint16(28, true);
      if (width === 1) v.setUint8(local, value); else if (width === 2) v.setUint16(local, value, true); else v.setUint32(local, value, true);
      if (local <= 29 && local + width > 28) {
        let software = v.getUint16(28, true);
        if (oldCsr & CSR.DONE) software &= ~(CSR.ESG | CSR.MAJORELINK);
        software = (software & ~(CSR.ACTIVE | CSR.DONE)) | (oldCsr & CSR.ACTIVE) |
          ((software & CSR.DONE) ? oldCsr & CSR.DONE : 0);
        v.setUint16(28, software, true);
      }
      this.newOperation(channel); return true;
    }
    const offset = address - EDMA;
    if (offset >= 0x18 && offset + width <= 0x20) {
      for (let n = 0; n < width; n++) this.command(offset + n, (value >>> (n * 8)) & 255, ticket);
      return true;
    }
    if (offset >= 0x100 && offset + width <= 0x120) {
      for (let n = 0; n < width; n++) this.priorities[(offset + n - 0x100) ^ 3] = (value >>> (n * 8)) & 255;
      this.blocked.clear(); return true;
    }
    const register = offset & ~3;
    if (register === DREG.CR) { this.control = this.merge(this.control, address, value, width) & 0x000307fe; this.blocked.clear(); return true; }
    if (register === DREG.ERQ) {
      const next = this.merge(this.requests, address, value, width);
      for (let n = 0; n < 32; n++) if ((next & (1 << n)) && !(this.requests & (1 << n))) this.newOperation(n);
      this.requests = next; return true;
    }
    if (register === DREG.EEI) { this.errorEnables = this.merge(this.errorEnables, address, value, width); this.changedIrqs(ticket); return true; }
    const bits = (width === 4 ? value : value << ((address & 3) * 8)) >>> 0;
    if (register === DREG.INT) { this.interrupts = (this.interrupts & ~bits) >>> 0; this.changedIrqs(ticket); return true; }
    if (register === DREG.ERR) { this.errors = (this.errors & ~bits) >>> 0; if (!this.errors) this.errorStatus = 0; this.changedIrqs(ticket); return true; }
    if ([DREG.ES, DREG.HRS].includes(register as 4 | 52)) return true;
    return false;
  }
  private routed(channel: number): boolean {
    const mux = this.mux[channel];
    return !!(mux & 0x80000000) && !(mux & 0x60000000) && (mux & 127) === (channel === 6 ? 80 : 79);
  }
  private hardwareRequests(display = true, audio = true): number {
    const ticket = this.ticket(); this.guard(ticket);
    let result = 0;
    if (display && this.routed(6)) { const ready = this.serial.txRequest(); this.guard(ticket); if (ready) result |= 1 << 6; }
    if (display && this.routed(7)) { const ready = this.serial.rxRequest(); this.guard(ticket); if (ready) result |= 1 << 7; }
    if (audio && this.audio) {
      for (const channel of [0, 4]) if (this.audioRouted(channel)) {
        const ready = channel === 0 ? this.audio.txRequest() : this.audio.rxRequest(); this.guard(ticket);
        if (ready) result |= 1 << channel;
      }
    }
    return result >>> 0;
  }
  private audioRouted(channel: number): boolean {
    const mux = this.mux[channel];
    return !!(mux & 0x80000000) && !(mux & 0x60000000) && (mux & 127) === (channel === 0 ? 20 : 19);
  }
  private audioChannel(channel: number): boolean { return !!this.audio && channel >= 0 && channel <= 4; }
  hasWork(display = true, audio = true): boolean {
    if (this.boundOwner !== this.hooks.owner() || this.control & 0x20) return false;
    const ready = this.hardwareRequests(display, audio);
    if (audio && this.audio && [0, 4].some(n => !!(this.mux[n] & 0x80000000) && !!(this.requests & (1 << n)) &&
      !this.blocked.has(n) && !this.audioRouted(n))) return true;
    if (audio && this.audio && [4, 3, 2, 1, 0].some(n => !this.blocked.has(n) && !(this.errors & (1 << n)) &&
      (this.audioMinors.has(n) || !!(this.internalStarts & (1 << n)) || !!(ready & this.requests & (1 << n))))) return true;
    if ((display || audio) && [...this.mux].some((mux, n) => !!(mux & 0x80000000) && !!(this.requests & (1 << n)) &&
      (n !== 6 && n !== 7 || display) &&
      !this.blocked.has(n) && !this.audioChannel(n) &&
      (n !== 6 && n !== 7 || !!(mux & 0x60000000) || (mux & 127) !== (n === 6 ? 80 : 79)))) return true;
    return display && [7, 6].some(n => !this.blocked.has(n) && !(this.errors & (1 << n)) &&
      !!(this.requests & (1 << n)) && (this.pending.has(n) || !!(ready & (1 << n))));
  }
  private decode(channel: number, terminal: boolean, ticket: Ticket): Transfer | undefined {
    this.guard(ticket);
    const v = this.view(channel), attr = v.getUint16(6, true), csr = v.getUint16(28, true);
    const sourceSize = (attr >>> 8) & 7, destinationSize = attr & 7;
    const count = v.getUint16(22, true), initialCount = v.getUint16(30, true);
    if (sourceSize > 5) { this.fail(channel, 0x80, 'invalid-source-size', ticket); return; }
    if (destinationSize > 5) { this.fail(channel, 0x20, 'invalid-destination-size', ticket); return; }
    if (attr & 0xf8f8) { this.park(channel, 'modulo-unsupported', ticket); return; }
    if (sourceSize !== destinationSize) { this.park(channel, 'unequal-transfer-widths-unsupported', ticket); return; }
    if ((count | initialCount) & 0x8000 || csr & CSR.MAJORELINK) { this.park(channel, 'channel-linking-unsupported', ticket); return; }
    if (csr & (CSR.START | CSR.INTHALF) || csr & 0xc000) { this.park(channel, 'start-half-bandwidth-unsupported', ticket); return; }
    const rawBytes = v.getUint32(8, true);
    if (this.control & 0x80 && rawBytes & 0xc0000000) { this.park(channel, 'minor-offset-unsupported', ticket); return; }
    const bytes = this.control & 0x80 ? rawBytes & 0x3fffffff : rawBytes;
    if (!count || !initialCount || count > initialCount || !bytes || bytes % (1 << sourceSize)) {
      this.fail(channel, 8, 'invalid-minor-count', ticket); return;
    }
    const size = terminal ? 4 : 1;
    if (sourceSize !== (terminal ? 2 : 0) || bytes !== size) { this.park(channel, 'minor-width-form-unsupported', ticket); return; }
    const t: Transfer = { source: v.getUint32(0, true), sourceOffset: v.getInt16(4, true),
      sourceLast: v.getInt32(12, true), destination: v.getUint32(16, true), destinationOffset: v.getInt16(20, true),
      destinationLast: v.getInt32(24, true), count, initialCount, csr, size };
    if (t.source % size) { this.fail(channel, 0x80, 'source-alignment', ticket); return; }
    if (t.destination % size) { this.fail(channel, 0x20, 'destination-alignment', ticket); return; }
    if (t.sourceOffset % size) { this.fail(channel, 0x40, 'source-offset-alignment', ticket); return; }
    if (t.destinationOffset % size) { this.fail(channel, 0x10, 'destination-offset-alignment', ticket); return; }
    if (terminal && (channel !== 6 || t.destination !== LPSPI + 0x60 || t.count !== 1 || t.initialCount !== 1 ||
      t.sourceOffset !== 0 || t.destinationOffset !== 0 || t.sourceLast !== 0 || t.destinationLast !== 0 ||
      t.csr !== CSR.DREQ)) { this.park(channel, 'terminal-tcr-form-unsupported', ticket); return; }
    if (!terminal && (channel === 6 ? ![LPSPI + 0x64, LPSPI + 0x67].includes(t.destination) || t.destinationOffset !== 0 :
      ![LPSPI + 0x74, LPSPI + 0x77].includes(t.source) || t.sourceOffset !== 0 || !!(csr & CSR.ESG))) {
      this.park(channel, 'peripheral-endpoint-unsupported', ticket); return;
    }
    return t;
  }
  private advance(address: number, delta: number): number {
    const next = address + delta;
    if (!Number.isSafeInteger(next) || next < 0 || next > 0xffffffff)
      throw new DisplayBusFault('range', 'Address arithmetic wraps');
    return next;
  }
  private decodeAudio(channel: number, ticket: Ticket): AudioTransfer | undefined {
    this.guard(ticket);
    const v = this.view(channel), rx = channel === 4, size = rx ? 2 : 4;
    const attr = v.getUint16(6, true), countRaw = v.getUint16(22, true), initial = v.getUint16(30, true);
    const csrRaw = v.getUint16(28, true), csr = csrRaw & ~(CSR.START | CSR.ACTIVE | CSR.DONE);
    const expectedCount = channel < 3 ? 0x8000 | ((channel + 1) << 9) | 64 : 64;
    const expectedCsr = channel < 3 ? CSR.DREQ | CSR.MAJORELINK | ((channel + 1) << 8) : CSR.DREQ | CSR.INTMAJOR;
    if (csrRaw & CSR.DONE) { this.park(channel, 'audio-done-rearm-required', ticket); return; }
    if ((countRaw & 0x8000) !== (initial & 0x8000)) {
      this.fail(channel, 8, 'audio-link-count-mismatch', ticket); return;
    }
    const countMask = countRaw & 0x8000 ? 0x1ff : 0x7fff, count = countRaw & countMask;
    if (!count || count > 64 || initial !== expectedCount || (countRaw & ~countMask) !== (initial & ~countMask)) {
      this.fail(channel, 8, 'audio-count-form-invalid', ticket); return;
    }
    if (attr !== (rx ? 0x0101 : 0x0202) || v.getUint32(8, true) !== size * 16 || csr !== expectedCsr ||
      v.getInt16(4, true) !== (rx ? 0 : 4) || v.getInt16(20, true) !== (rx ? 2 : 0) ||
      v.getInt32(12, true) !== 0 || v.getInt32(24, true) !== 0) {
      this.park(channel, 'audio-descriptor-form-unsupported', ticket); return;
    }
    const source = v.getUint32(0, true), destination = v.getUint32(16, true);
    if (source % size || destination % size) {
      this.fail(channel, source % size ? 0x80 : 0x20, 'audio-address-alignment', ticket); return;
    }
    if (rx ? source !== SAI + 0xa0 : destination !== SAI + 0x20 + channel * 4) {
      this.park(channel, 'audio-endpoint-unsupported', ticket); return;
    }
    // Admit the whole contiguous minor before the first destructive FIFO access.
    this.bus.check(rx ? destination : source, size * 16, size);
    this.advance(rx ? destination : source, size * 16);
    return { source, destination, size, count, rawInitial: initial, countPrefix: initial & ~countMask, csr, beat: 0 };
  }
  private audioCsr(channel: number, csr: number): void {
    this.view(channel).setUint16(28, (csr & ~CSR.START) | (this.internalStarts & (1 << channel) ? CSR.START : 0), true);
  }
  private linkAudio(channel: number, target: number, major: boolean, ticket: Ticket): void {
    this.guard(ticket);
    // A START bit is a coalesced latch; repeated links do not allocate request work.
    this.internalStarts = (this.internalStarts | (1 << target)) >>> 0;
    const v = this.view(target); v.setUint16(28, v.getUint16(28, true) | CSR.START, true);
    const counters = major ? this.majorLinks : this.minorLinks;
    counters[channel] = Math.min(Number.MAX_SAFE_INTEGER, counters[channel] + 1);
  }
  private audioPhase(channel: number, ticket: Ticket): boolean {
    const audio = this.audio!, bit = 1 << channel, rx = channel === 4;
    this.guard(ticket);
    if (this.priorities[channel] !== channel) { this.park(channel, 'channel-priority-unsupported', ticket); return false; }
    let transfer = this.audioMinors.get(channel);
    try {
      if (!transfer) {
        const internal = !!(this.internalStarts & bit);
        if (!internal) {
          if (!(this.requests & bit) || channel > 0 && channel < 4) return false;
          if (this.mux[channel] & 0x60000000) { this.park(channel, 'dmamux-trigger-always-on-unsupported', ticket); return false; }
          if (this.mux[channel] & 0x80000000 && !this.audioRouted(channel)) {
            this.park(channel, 'dmamux-source-unsupported', ticket); return false;
          }
          if (!this.audioRouted(channel)) return false;
          const requested = rx ? audio.rxRequest() : audio.txRequest(); this.guard(ticket);
          if (!requested) return false;
        }
        const ready = rx ? audio.canRead() : audio.canWrite(channel); this.guard(ticket);
        if (!ready) return false;
        transfer = this.decodeAudio(channel, ticket); this.guard(ticket);
        if (!transfer) return false;
        if (!internal && this.view(channel).getUint16(28, true) & CSR.START) {
          this.park(channel, 'software-start-unsupported', ticket); return false;
        }
        this.internalStarts = (this.internalStarts & ~bit) >>> 0;
        this.audioMinors.set(channel, transfer);
      }
      const ready = rx ? audio.canRead() : audio.canWrite(channel); this.guard(ticket);
      if (!ready) return false;
      const source = transfer.source, destination = transfer.destination;
      const next = this.advance(rx ? destination : source, transfer.size);
      this.bus.check(rx ? destination : source, transfer.size, transfer.size);
      this.audioCsr(channel, transfer.csr | CSR.ACTIVE);
      if (rx) {
        const value = audio.read(0xa0, 2); this.guard(ticket);
        if (value === undefined) throw new DisplayBusFault('read', 'SAI FIFO rejected an admitted read');
        const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, true);
        this.bus.write(destination, bytes, 2); this.guard(ticket);
        transfer.destination = next; this.view(channel).setUint32(16, next, true);
      } else {
        const bytes = this.bus.read(source, 4, 4); this.guard(ticket);
        const value = new DataView(bytes.buffer).getUint32(0, true);
        const accepted = audio.write(0x20 + channel * 4, value, 4); this.guard(ticket);
        if (!accepted) { this.audioCsr(channel, transfer.csr); return false; }
        transfer.source = next; this.view(channel).setUint32(0, next, true);
      }
      this.guard(ticket); transfer.beat++;
      this.audioCsr(channel, transfer.csr);
      if (transfer.beat < 16) return true;
      this.audioMinors.delete(channel);
      const v = this.view(channel), final = transfer.count === 1;
      v.setUint16(22, final ? transfer.rawInitial : transfer.countPrefix | (transfer.count - 1), true);
      if (!final) {
        if (channel < 3) this.linkAudio(channel, channel + 1, false, ticket);
        return true;
      }
      if (transfer.csr & CSR.DREQ) this.requests = (this.requests & ~bit) >>> 0;
      if (transfer.csr & CSR.INTMAJOR) this.interrupts = (this.interrupts | bit) >>> 0;
      this.audioCsr(channel, transfer.csr | CSR.DONE);
      if (channel < 3) this.linkAudio(channel, channel + 1, true, ticket);
      this.changedIrqs(ticket); return true;
    } catch (error) {
      this.guard(ticket);
      if (error instanceof OwnershipChanged) throw error;
      this.audioMinors.delete(channel);
      this.audioCsr(channel, this.view(channel).getUint16(28, true) & ~CSR.ACTIVE);
      if (error instanceof DisplayBusFault) this.fail(channel, rx ? 1 : 2, 'audio-minor-bus-failure', ticket);
      else this.park(channel, 'audio-endpoint-callback-failure', ticket);
      return true;
    }
  }
  phase(display = true, audio = true): boolean {
    const ticket = this.ticket();
    try { this.guard(ticket); return this.ownedPhase(ticket, display, audio); }
    catch (error) { if (error instanceof OwnershipChanged) return false; throw error; }
  }
  private ownedPhase(ticket: Ticket, display: boolean, audio: boolean): boolean {
    if (this.control & 0x20) return false;
    if (this.control & (0x4 | 0x8 | 0x40 | 0x30000) || (this.control & 0x500) !== 0x400) {
      for (const n of this.audio ? [...(audio ? [0, 1, 2, 3, 4] : []), ...(display ? [6, 7] : [])] : display ? [6, 7] : [])
        if (this.requests & (1 << n) && !this.blocked.has(n)) this.park(n, 'arbitration-control-unsupported', ticket);
      return false;
    }
    for (let n = 0; n < 32; n++) if ((this.requests & (1 << n)) && n !== 6 && n !== 7 && !this.audioChannel(n) &&
      !this.blocked.has(n) && (this.mux[n] & 0x80000000))
      this.park(n, 'active-channel-unsupported', ticket);
    for (const channel of this.audio ? [7, 6, 4, 3, 2, 1, 0] : [7, 6]) {
      if (channel >= 6 ? !display : !audio) continue;
      const bit = 1 << channel;
      const operation = this.ticket(channel); this.guard(ticket); this.guard(operation);
      if (this.blocked.has(channel) || this.errors & bit) continue;
      if (this.audioChannel(channel)) {
        if (this.audioPhase(channel, operation)) return true;
        continue;
      }
      if (!(this.requests & bit)) continue;
      if (this.priorities[channel] !== (channel & 15)) { this.park(channel, 'channel-priority-unsupported', operation); continue; }
      if (this.mux[channel] & 0x60000000) { this.park(channel, 'dmamux-trigger-always-on-unsupported', operation); continue; }
      if ((this.mux[channel] & 0x80000000) && (this.mux[channel] & 127) !== (channel === 6 ? 80 : 79)) {
        this.park(channel, 'dmamux-source-unsupported', operation); continue;
      }
      const sg = this.pending.get(channel);
      if (sg !== undefined) { this.loadTerminal(channel, sg, operation); return true; }
      if (!this.routed(channel) || !(channel === 6 ? this.serial.txRequest() : this.serial.rxRequest())) continue;
      this.guard(operation);
      const terminal = this.links[channel] === 1, transfer = this.decode(channel, terminal, operation);
      if (!transfer) continue;
      this.consume(channel, transfer, terminal, operation); return true;
    }
    return false;
  }
  private loadTerminal(channel: number, address: number, ticket: Ticket): void {
    this.guard(ticket);
    if (this.links[channel]) { this.park(channel, 'second-scatter-gather-unsupported', ticket, address); return; }
    try {
      if (address % 32) { this.fail(channel, 4, 'scatter-gather-alignment', ticket); return; }
      const descriptor = this.bus.read(address, 32, 32);
      this.guard(ticket);
      const old = this.tcd.slice(channel * 32, channel * 32 + 32);
      this.tcd.set(descriptor, channel * 32);
      const terminal = this.decode(channel, true, ticket);
      this.guard(ticket);
      if (!terminal) { this.tcd.set(old, channel * 32); this.pending.delete(channel); return; }
      this.pending.delete(channel); this.links[channel] = 1;
    } catch (error) {
      this.guard(ticket);
      if (error instanceof OwnershipChanged) throw error;
      if (error instanceof DisplayBusFault)
        this.fail(channel, error.code === 'alignment' ? 4 : 2, 'scatter-gather-bus-failure', ticket);
      else this.park(channel, 'scatter-gather-callback-failure', ticket);
    }
  }
  private consume(channel: number, t: Transfer, terminal: boolean, ticket: Ticket): void {
    this.guard(ticket); const v = this.view(channel);
    try {
      if (channel === 6) this.bus.check(t.source, t.size, t.size);
      else this.bus.check(t.destination, t.size, t.size);
      // Validate all post-transfer arithmetic before a destructive FIFO access or bus write.
      const nextSource = this.advance(t.source, t.sourceOffset), nextDestination = this.advance(t.destination, t.destinationOffset);
      const lastSource = t.count === 1 ? this.advance(nextSource, t.sourceLast) : nextSource;
      const lastDestination = t.count === 1 && !(t.csr & CSR.ESG) ? this.advance(nextDestination, t.destinationLast) : nextDestination;
      v.setUint16(28, (t.csr & ~CSR.DONE) | CSR.ACTIVE, true);
      if (channel === 6) {
        const bytes = this.bus.read(t.source, t.size, t.size);
        this.guard(ticket);
        const ready = this.serial.txRequest(); this.guard(ticket);
        if (!ready) { v.setUint16(28, t.csr & ~CSR.ACTIVE, true); return; }
        const value = t.size === 1 ? bytes[0] : new DataView(bytes.buffer).getUint32(0, true);
        if (terminal && (value & 0x300000)) { this.park(channel, 'terminal-cont-command-unsupported', ticket); this.guard(ticket); v.setUint16(28, t.csr & ~CSR.ACTIVE, true); return; }
        const accepted = this.serial.write(t.destination - LPSPI, value, t.size); this.guard(ticket);
        if (!accepted) {
          this.park(channel, 'peripheral-write-not-accepted', ticket); this.guard(ticket); v.setUint16(28, t.csr & ~CSR.ACTIVE, true); return;
        }
      } else {
        const ready = this.serial.rxRequest(); this.guard(ticket);
        if (!ready) { v.setUint16(28, t.csr & ~CSR.ACTIVE, true); return; }
        const value = this.serial.read(t.source - LPSPI, 1);
        this.guard(ticket);
        if (value === undefined) { this.park(channel, 'peripheral-read-not-accepted', ticket); this.guard(ticket); v.setUint16(28, t.csr & ~CSR.ACTIVE, true); return; }
        this.bus.write(t.destination, new Uint8Array([value]), 1);
      }
      this.guard(ticket);
      v.setUint32(0, lastSource, true); v.setUint32(16, lastDestination, true);
      v.setUint16(22, t.count - 1, true); v.setUint16(28, t.csr & ~(CSR.ACTIVE | CSR.DONE), true);
      if (t.count !== 1) return;
      v.setUint16(22, t.initialCount, true);
      if (t.csr & CSR.INTMAJOR) this.interrupts = (this.interrupts | (1 << channel)) >>> 0;
      if (t.csr & CSR.DREQ) this.requests = (this.requests & ~(1 << channel)) >>> 0;
      if (t.csr & CSR.ESG) {
        if (terminal || this.links[channel]) this.park(channel, 'second-scatter-gather-unsupported', ticket);
        else this.pending.set(channel, t.destinationLast >>> 0);
      } else v.setUint16(28, (t.csr & ~CSR.ACTIVE) | CSR.DONE, true);
      this.changedIrqs(ticket);
    } catch (error) {
      this.guard(ticket);
      if (error instanceof OwnershipChanged) throw error;
      v.setUint16(28, v.getUint16(28, true) & ~CSR.ACTIVE, true);
      if (error instanceof DisplayBusFault) this.fail(channel, channel === 6 ? 2 : 1, 'minor-bus-failure', ticket);
      else this.park(channel, 'peripheral-callback-failure', ticket);
    }
  }
  status() {
    return { control: this.control >>> 0, requests: this.requests >>> 0, interrupts: this.interrupts >>> 0,
      errors: this.errors >>> 0, errorStatus: this.errorStatus >>> 0, pendingTerminal: this.pending.size,
      blockedChannels: [...this.blocked], channel6: [...this.tcd.slice(192, 224)], channel7: [...this.tcd.slice(224, 256)],
      ...(this.audio ? { audio: { internalStarts: this.internalStarts, minorLinks: [...this.minorLinks],
        majorLinks: [...this.majorLinks], partialMinors: [...this.audioMinors].map(([channel, t]) => ({ channel, beat: t.beat })),
        channels: Array.from({ length: 5 }, (_, n) => [...this.tcd.slice(n * 32, n * 32 + 32)]) } } : {}) };
  }
}
