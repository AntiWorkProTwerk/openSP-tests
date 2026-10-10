import { OwnershipChanged, type AudioFixtures, type Width } from './display-types.ts';
export const SAI = 0x40384000;
export interface AudioHooks {
  owner(): number;
  diagnostic(code: string): void;
  onIrq(asserted: boolean): void;
}
const CSR_MASK = 0xf1001f03, W1C = 0x1c0000;
const CONFIG = [0x0c, 0x10, 0x14, 0x18, 0x1c, 0x60, 0x8c, 0x90, 0x94, 0x98, 0x9c, 0xe0];
export class AudioCallbackFault extends Error { readonly code = 'sai-callback-failure'; }

/** Four TX FIFOs and the same RX0 FIFO for MMIO and DMA. Timing is an explicit fixture. */
export class AudioSai {
  private readonly fixtures: Readonly<AudioFixtures>;
  private readonly hooks: Readonly<AudioHooks>;
  private boundOwner: number;
  private generation = 0;
  private regs = new Map<number, number>();
  private tx: number[][] = [[], [], [], []];
  private rx: number[] = [];
  private txRead = [0, 0, 0, 0];
  private txWrite = [0, 0, 0, 0];
  private rxRead = 0;
  private rxWrite = 0;
  private txFlags = 0;
  private rxFlags = 0;
  private clockEnabled = false;
  private irq = false;
  private cancelled = false;
  private failed = false;
  private slotCredit = 0;
  private frameIndex = 0;
  private slots = 0;
  private transmitted = [0, 0, 0, 0];
  private received = 0;
  constructor(fixtures: AudioFixtures, hooks: AudioHooks) {
    if (typeof fixtures.saiClockReady !== 'boolean' || typeof fixtures.externalClock !== 'boolean' ||
      !Number.isSafeInteger(fixtures.slotTicks) || fixtures.slotTicks < 1 || fixtures.slotTicks > 1000000 ||
      !Array.isArray(fixtures.rxFrame) || fixtures.rxFrame.length !== 16 ||
      !fixtures.rxFrame.every(word => Number.isInteger(word) && word >= 0 && word <= 0xffffffff))
      throw new RangeError('Explicit finite SAI clock and sixteen-word input fixtures are required');
    this.fixtures = Object.freeze({ saiClockReady: fixtures.saiClockReady, externalClock: fixtures.externalClock,
      slotTicks: fixtures.slotTicks, rxFrame: Object.freeze([...fixtures.rxFrame]) });
    this.hooks = Object.freeze({ owner: hooks.owner.bind(hooks), diagnostic: hooks.diagnostic.bind(hooks),
      onIrq: hooks.onIrq.bind(hooks) });
    this.boundOwner = this.hooks.owner();
  }
  private ticket() { return { generation: this.generation, owner: this.boundOwner }; }
  private guard(ticket: { generation: number; owner: number }): void {
    if (this.cancelled || ticket.generation !== this.generation || ticket.owner !== this.hooks.owner()) throw new OwnershipChanged();
  }
  private notify(ticket: ReturnType<AudioSai['ticket']>, callback: () => void): void {
    try { this.guard(ticket); callback(); this.guard(ticket); }
    catch (error) {
      this.guard(ticket); // A stale callback is cancellation before ordinary error classification.
      // Retire only this ticket; callback reset/replacement must retain its new state.
      if (ticket.generation === this.generation && ticket.owner === this.boundOwner && ticket.owner === this.hooks.owner()) {
        if (error instanceof OwnershipChanged) this.cancelled = true;
        else this.failed = true;
      }
      if (error instanceof OwnershipChanged) throw error;
      throw new AudioCallbackFault(String(error));
    }
  }
  private word(offset: number): number { return this.regs.get(offset) ?? 0; }
  setClockEnabled(enabled: boolean): void { this.clockEnabled = enabled; if (!enabled) this.slotCredit = 0; }
  private enabled(): boolean { return !this.cancelled && !this.failed && this.clockEnabled && this.fixtures.saiClockReady && this.boundOwner === this.hooks.owner(); }
  private txChannels(): number { return (this.word(0x14) >>> 16) & 15; }
  private receiveForm(): boolean {
    return this.word(0x90) === 0 && this.word(0x94) === 0x10000 && this.word(0x98) === 0x100f1f10 &&
      this.word(0x9c) === 0x1f1f0f00 && this.word(0xe0) === 0;
  }
  private transmitForm(): boolean {
    return this.word(0x10) === 0x40000000 && this.word(0x14) === 0xf0000 && this.word(0x18) === 0x100f1f38 &&
      this.word(0x1c) === 0x1f1f1300 && this.word(0x60) === 0;
  }
  private txRequestFlag(): boolean {
    const channels = this.txChannels(), watermark = this.word(0x0c) & 31;
    return this.tx.some((fifo, n) => !!(channels & (1 << n)) && fifo.length <= watermark);
  }
  private rxRequestFlag(): boolean { return !!(this.word(0x94) & 0x10000) && this.rx.length > (this.word(0x8c) & 31); }
  private csr(receive: boolean): number {
    const value = this.word(receive ? 0x88 : 8), flags = receive ? this.rxFlags : this.txFlags;
    const request = receive ? this.rxRequestFlag() : this.txRequestFlag();
    const warning = receive ? this.rx.length === 32 : this.tx.some((fifo, n) => !!(this.txChannels() & (1 << n)) && !fifo.length);
    return (value | flags | (request ? 0x10000 : 0) | (warning ? 0x20000 : 0)) >>> 0;
  }
  private changedIrq(ticket: ReturnType<AudioSai['ticket']>): void {
    this.guard(ticket);
    const t = this.csr(false), r = this.csr(true);
    const next = !!(((t >>> 8) & t & 0x1f00) | ((r >>> 8) & r & 0x1f00));
    if (next === this.irq) return;
    this.irq = next; this.notify(ticket, () => this.hooks.onIrq(next));
  }
  txRequest(): boolean { return this.enabled() && this.transmitForm() && !(this.word(8) & 0x1000000) && !!(this.word(8) & 1) && this.txRequestFlag(); }
  rxRequest(): boolean { return this.enabled() && this.receiveForm() && !(this.word(0x88) & 0x1000000) && !!(this.word(0x88) & 1) && this.rxRequestFlag(); }
  canWrite(channel: number): boolean {
    return this.enabled() && this.transmitForm() && !(this.word(8) & 0x1000000) && channel >= 0 && channel < 4 && this.tx[channel].length < 32;
  }
  canRead(): boolean { return this.enabled() && this.receiveForm() && !(this.word(0x88) & 0x1000000) && this.rx.length > 0; }
  handles(offset: number, width: Width): boolean {
    const register = offset & ~3;
    return Number.isInteger(offset) && offset >= 0 && [1, 2, 4].includes(width) && offset % width === 0 &&
      (offset & 3) + width <= 4 && ([8, 0x88, ...CONFIG].includes(register) ||
        register >= 0x20 && register <= 0x2c || register >= 0x40 && register <= 0x4c || register === 0xa0 || register === 0xc0);
  }
  read(offset: number, width: Width): number | undefined {
    if (!this.handles(offset, width)) return undefined;
    const ticket = this.ticket(); this.guard(ticket);
    const register = offset & ~3;
    let value: number;
    if (register === 8 || register === 0x88) value = this.csr(register === 0x88);
    else if (register === 0xa0) {
      // The source-used lower halfword is an explicit adapter form, not all narrow hardware accesses.
      if ((offset !== 0xa0 || width !== 2 && width !== 4) || !this.canRead()) return undefined;
      value = this.rx.shift()!; this.rxRead = (this.rxRead + 1) & 63; this.changedIrq(ticket);
    } else if (register === 0xc0) value = this.rxRead | (this.rxWrite << 16);
    else if (register >= 0x40 && register <= 0x4c) {
      const channel = (register - 0x40) >>> 2; value = this.txRead[channel] | (this.txWrite[channel] << 16);
    } else if (register >= 0x20 && register <= 0x2c) return 0;
    else value = this.word(register);
    this.guard(ticket);
    return width === 4 ? value >>> 0 : (value >>> ((offset & 3) * 8)) & (width === 1 ? 255 : 65535);
  }
  write(offset: number, value: number, width: Width): boolean {
    if (!this.handles(offset, width) || !Number.isInteger(value) || value < 0 || value > 0xffffffff) return false;
    const ticket = this.ticket(); this.guard(ticket);
    const register = offset & ~3;
    if (register >= 0x20 && register <= 0x2c) {
      const channel = (register - 0x20) >>> 2;
      if (offset !== register || width !== 4 || !this.canWrite(channel)) return false;
      this.tx[channel].push(value >>> 0); this.txWrite[channel] = (this.txWrite[channel] + 1) & 63;
      this.changedIrq(ticket); return true;
    }
    if (register === 0xa0 || register === 0xc0 || register >= 0x40 && register <= 0x4c) return true;
    const shift = (offset & 3) * 8, mask = width === 4 ? 0xffffffff : (width === 1 ? 255 : 65535) << shift;
    const written = (width === 4 ? value : value << shift) >>> 0;
    let merged = ((this.word(register) & ~mask) | (written & mask)) >>> 0;
    if (register === 8 || register === 0x88) {
      const receive = register === 0x88;
      if (receive) this.rxFlags &= ~(written & W1C); else this.txFlags &= ~(written & W1C);
      if (written & 0x3000000) {
        if (receive) { this.rx = []; this.rxRead = 0; this.rxWrite = 0; this.rxFlags = 0; }
        else { this.tx = [[], [], [], []]; this.txRead.fill(0); this.txWrite.fill(0); this.txFlags = 0; }
      }
      merged &= CSR_MASK;
      if (merged & 0x80000000) merged |= 0x10000000;
      this.regs.set(register, merged >>> 0);
      if (merged & 2) this.notify(ticket, () => this.hooks.diagnostic('sai-warning-dma-unsupported'));
    } else this.regs.set(register, merged);
    this.changedIrq(ticket); return true;
  }
  hasClockWork(): boolean {
    return this.enabled() && this.fixtures.externalClock && this.receiveForm() &&
      ((this.word(0x88) & 0x90000000) >>> 0) === 0x90000000 && !(this.word(0x88) & 0x1000000);
  }
  /** One bounded fixture slot: at most four FIFO reads and one shared RX0 write. */
  phase(): boolean {
    if (!this.hasClockWork()) { this.slotCredit = 0; return false; }
    const ticket = this.ticket(); this.guard(ticket);
    this.slotCredit++;
    if (this.slotCredit < this.fixtures.slotTicks) return true;
    this.slotCredit = 0;
    if (this.transmitForm() && ((this.word(8) & 0x90000000) >>> 0) === 0x90000000 && !(this.word(8) & 0x1000000)) {
      for (let channel = 0; channel < 4; channel++) {
        if (this.tx[channel].length) {
          this.tx[channel].shift(); this.txRead[channel] = (this.txRead[channel] + 1) & 63;
          this.transmitted[channel] = Math.min(Number.MAX_SAFE_INTEGER, this.transmitted[channel] + 1);
        } else this.txFlags |= 0x40000;
      }
    }
    if (this.rx.length < 32) {
      this.rx.push(this.fixtures.rxFrame[this.frameIndex]); this.rxWrite = (this.rxWrite + 1) & 63;
      this.received = Math.min(Number.MAX_SAFE_INTEGER, this.received + 1);
    } else this.rxFlags |= 0x40000;
    this.frameIndex = (this.frameIndex + 1) & 15; this.slots = Math.min(Number.MAX_SAFE_INTEGER, this.slots + 1);
    this.changedIrq(ticket); return true;
  }
  reset(): void {
    const wasAsserted = this.irq;
    this.generation++; this.boundOwner = this.hooks.owner();
    this.regs.clear(); this.tx = [[], [], [], []]; this.rx = [];
    this.txRead.fill(0); this.txWrite.fill(0); this.rxRead = 0; this.rxWrite = 0;
    this.txFlags = 0; this.rxFlags = 0; this.irq = false; this.cancelled = false; this.failed = false; this.slotCredit = 0; this.frameIndex = 0;
    this.slots = 0; this.transmitted.fill(0); this.received = 0; this.clockEnabled = false;
    const ticket = this.ticket();
    if (wasAsserted) {
      try { this.notify(ticket, () => this.hooks.onIrq(false)); }
      catch (error) { if (!(error instanceof OwnershipChanged)) throw error; }
    }
  }
  status() {
    return { fixtures: { ...this.fixtures, rxFrame: [...this.fixtures.rxFrame] }, clockEnabled: this.clockEnabled,
      tcsr: this.csr(false), rcsr: this.csr(true), txCounts: this.tx.map(fifo => fifo.length), rxCount: this.rx.length,
      slots: this.slots, transmitted: [...this.transmitted], received: this.received, irq: this.irq,
      cancelled: this.cancelled, failed: this.failed };
  }
}
