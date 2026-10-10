import { MappedDisplayBus } from './display-bus.ts';
import { DisplayEdma } from './display-edma.ts';
import { DisplayLpspi, LpspiCallbackFault } from './display-lpspi.ts';
import { AudioSai, AudioCallbackFault, SAI } from './audio-sai.ts';
import { DMA_CLOCK, SPI_CLOCK, LPSPI, OwnershipChanged,
  type Diagnostic, type DisplayFixtures, type DisplayTransportApi,
  type DisplayTransportOptions, type DisplayTransportStatus, type Width } from './display-types.ts';

/** Private source-form transport. Every timing and SIN choice is an explicit fixture. */
export class DisplayTransport implements DisplayTransportApi {
  private owner = 0;
  private disposed = false;
  private readonly fixtures: Readonly<DisplayFixtures>;
  private readonly outputs: Readonly<Pick<DisplayTransportOptions, 'onPcs' | 'onByte' | 'onIrq'>>;
  private readonly bus: MappedDisplayBus;
  private readonly serial: DisplayLpspi;
  private readonly dma: DisplayEdma;
  private readonly audio?: AudioSai;
  private audioTurn = false;
  private dmaWord = 0;
  private lpspiWord = 0;
  private credit = 0;
  private phases = 0;
  private diagnostics = new Map<string, Diagnostic>();
  private diagnosticOverflow = 0;
  private inTick = false;

  constructor(options: DisplayTransportOptions) {
    const f = options.fixtures;
    if (!Number.isSafeInteger(f.quantumTicks) || f.quantumTicks <= 0 ||
      !Number.isSafeInteger(f.workCap) || f.workCap < 1 || f.workCap > 4096 ||
      !Number.isSafeInteger(f.quantumTicks * f.workCap) ||
      typeof f.dmaClockReady !== 'boolean' || typeof f.lpspiClockReady !== 'boolean' ||
      !Number.isInteger(f.sinByte) || f.sinByte < 0 || f.sinByte > 255)
      throw new RangeError('Explicit finite display timing, clock and SIN fixtures are required');
    this.fixtures = Object.freeze({ quantumTicks: f.quantumTicks, workCap: f.workCap,
      dmaClockReady: f.dmaClockReady, lpspiClockReady: f.lpspiClockReady, sinByte: f.sinByte });
    this.outputs = Object.freeze({ onPcs: options.onPcs.bind(options), onByte: options.onByte.bind(options),
      onIrq: options.onIrq.bind(options) });
    this.bus = new MappedDisplayBus(options.memory, options.mappedRam, options.admittedRam, () => this.owner);
    this.serial = new DisplayLpspi({ owner: () => this.owner, sinByte: this.fixtures.sinByte,
      diagnostic: (code, address) => this.report(code, undefined, address),
      onPcs: active => this.outputs.onPcs(active), onByte: byte => this.outputs.onByte(byte),
      onIrq: asserted => this.outputs.onIrq(35, asserted) });
    if (options.audioFixtures) this.audio = new AudioSai(options.audioFixtures, { owner: () => this.owner,
      diagnostic: code => this.report(code), onIrq: asserted => this.outputs.onIrq(56, asserted) });
    this.dma = new DisplayEdma(this.bus, {
      txRequest: () => this.lpspiEnabled() && this.serial.txRequest(),
      rxRequest: () => this.lpspiEnabled() && this.serial.rxRequest(),
      read: (offset, width) => this.serial.read(offset, width),
      write: (offset, value, width) => this.serial.write(offset, value, width),
    }, { owner: () => this.owner,
      diagnostic: (code, channel, address) => this.report(code, channel, address),
      onIrq: (irq, asserted) => this.outputs.onIrq(irq, asserted) }, this.audio);
  }
  private report(code: string, channel?: number, address?: number): void {
    const key = `${code}/${channel ?? ''}/${address ?? ''}`, old = this.diagnostics.get(key);
    if (old) { old.count = Math.min(Number.MAX_SAFE_INTEGER, old.count + 1); return; }
    if (this.diagnostics.size === 64) { this.diagnosticOverflow = Math.min(Number.MAX_SAFE_INTEGER, this.diagnosticOverflow + 1); return; }
    this.diagnostics.set(key, { code, channel, address, count: 1 });
  }
  private gate(word: number): boolean { const value = (word >>> 6) & 3; return value === 1 || value === 3; }
  private dmaEnabled(): boolean { return !this.disposed && this.fixtures.dmaClockReady && this.gate(this.dmaWord); }
  private lpspiEnabled(): boolean { return !this.disposed && this.fixtures.lpspiClockReady && this.gate(this.lpspiWord); }
  private saiEnabled(): boolean {
    const gate = (this.dmaWord >>> 18) & 3;
    return !this.disposed && !!this.audio && (gate === 1 || gate === 3);
  }
  private displayEligible(): boolean {
    const status = this.serial.status();
    return this.lpspiEnabled() && !status.failed && !status.cancelled;
  }
  private audioEligible(): boolean {
    const status = this.audio?.status();
    return this.saiEnabled() && !!status && !status.failed && !status.cancelled;
  }
  private guard(owner: number): void { if (owner !== this.owner || this.disposed) throw new OwnershipChanged(); }
  private access(address: number, width: Width): boolean {
    return Number.isSafeInteger(address) && address >= 0 && address <= 0xffffffff &&
      [1, 2, 4].includes(width) && address % width === 0 && address + width <= 0x100000000;
  }
  handles(address: number, width: Width = 4): boolean {
    return this.access(address, width) && (this.dma.handles(address, width) || this.serial.handles(address - LPSPI, width) ||
      !!this.audio?.handles(address - SAI, width));
  }
  read(address: number, width: Width = 4): number | undefined {
    if (this.disposed || !this.handles(address, width)) return undefined;
    const owner = this.owner;
    try {
      const value = this.audio?.handles(address - SAI, width) ? this.audio.read(address - SAI, width) :
        this.serial.handles(address - LPSPI, width) ? this.serial.read(address - LPSPI, width) : this.dma.read(address, width);
      this.guard(owner); return value;
    } catch (error) {
      if (error instanceof OwnershipChanged) { if (owner === this.owner && !this.disposed) this.credit = 0; return undefined; }
      if (error instanceof LpspiCallbackFault || error instanceof AudioCallbackFault) { this.report(error.code); return undefined; }
      throw error;
    }
  }
  write(address: number, value: number, width: Width = 4): boolean {
    if (this.disposed || !this.handles(address, width)) return false;
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      this.report('invalid-register-value', undefined, address); return false;
    }
    const owner = this.owner;
    try {
      const result = this.audio?.handles(address - SAI, width) ? this.audio.write(address - SAI, value, width) :
        this.serial.handles(address - LPSPI, width) ? this.serial.write(address - LPSPI, value, width) : this.dma.write(address, value, width);
      this.guard(owner);
      if (!this.possibleWork()) this.credit = 0;
      return result;
    } catch (error) {
      if (error instanceof OwnershipChanged) { if (owner === this.owner && !this.disposed) this.credit = 0; return false; }
      if (error instanceof LpspiCallbackFault || error instanceof AudioCallbackFault) { this.report(error.code); return false; }
      throw error;
    }
  }
  notifyClock(address: number, mergedWord: number): void {
    if (this.disposed || ![DMA_CLOCK, SPI_CLOCK].includes(address)) return;
    if (!Number.isInteger(mergedWord) || mergedWord < 0 || mergedWord > 0xffffffff)
      throw new RangeError('A clock observation must be a merged uint32 register value');
    if (address === DMA_CLOCK) this.dmaWord = mergedWord >>> 0; else this.lpspiWord = mergedWord >>> 0;
    this.audio?.setClockEnabled(this.saiEnabled());
    if (((mergedWord >>> 6) & 3) === 2) this.report('reserved-clock-gate', undefined, address);
    if (this.audio && address === DMA_CLOCK && ((mergedWord >>> 18) & 3) === 2)
      this.report('reserved-sai-clock-gate', undefined, address);
    if (!this.possibleWork()) this.credit = 0;
  }
  private possibleWork(): boolean {
    if (this.audio && (this.audio.hasClockWork() || this.dmaEnabled() && this.dma.hasWork(this.displayEligible(), this.audioEligible()))) return true;
    if (!this.lpspiEnabled()) return false;
    const s = this.serial.status();
    if (s.failed || s.cancelled) return false;
    if (this.dmaEnabled() && this.dma.hasWork(this.audio ? this.displayEligible() : true, this.audioEligible())) return true;
    return !!(s.cr & 1) && !(s.cr & 2) && !s.failed && !s.cancelled && !s.parked && s.txCount > 0;
  }
  tick(cycles: number): void {
    if (!Number.isSafeInteger(cycles) || cycles < 0) throw new RangeError('Display tick must be a nonnegative integer');
    if (!cycles || this.disposed) return;
    if (this.inTick) { this.report('reentrant-tick-ignored'); return; }
    if (!this.possibleWork()) { this.credit = 0; return; }
    const owner = this.owner, quantum = this.fixtures.quantumTicks;
    // Retain capped time only while this owner has active work; blocked time is discarded.
    const total = Math.min(Number.MAX_SAFE_INTEGER, this.credit + cycles);
    const count = Math.min(this.fixtures.workCap, Math.floor(total / quantum));
    this.credit = total;
    this.inTick = true;
    try {
      for (let n = 0; n < count; n++) {
        this.guard(owner);
        let progressed = false;
        // Alternate an explicit external-clock slot with eDMA/serial service; each consumes one work unit.
        if (this.audio && this.audioTurn && this.audioEligible()) progressed = this.audio.phase();
        this.guard(owner);
        if (!progressed) progressed = this.dmaEnabled() && (this.audio || this.lpspiEnabled()) ?
          this.dma.phase(this.audio ? this.displayEligible() : true, this.audioEligible()) : false;
        this.guard(owner);
        if (!progressed && (this.audio ? this.displayEligible() : this.lpspiEnabled())) progressed = this.serial.phase();
        this.guard(owner);
        if (!progressed && this.audio && this.audioEligible()) progressed = this.audio.phase();
        this.guard(owner);
        if (this.audio) this.audioTurn = !this.audioTurn;
        if (!progressed) { this.credit = 0; break; }
        this.credit -= quantum;
        this.phases = Math.min(Number.MAX_SAFE_INTEGER, this.phases + 1);
      }
      this.guard(owner);
      if (!this.possibleWork()) this.credit = 0;
      if (Math.floor(total / quantum) > this.fixtures.workCap) this.report('tick-work-cap');
    } catch (error) {
      if (error instanceof OwnershipChanged) { if (owner === this.owner && !this.disposed) this.credit = 0; return; }
      this.credit = 0;
      if (error instanceof LpspiCallbackFault || error instanceof AudioCallbackFault) this.report(error.code);
      else throw error;
    } finally { this.inTick = false; }
  }
  reset(): void {
    if (this.disposed) return;
    const owner = ++this.owner;
    this.credit = 0; this.phases = 0; this.dmaWord = 0; this.lpspiWord = 0;
    this.audioTurn = false;
    this.diagnostics.clear(); this.diagnosticOverflow = 0;
    this.dma.reset();
    if (owner !== this.owner || this.disposed) return;
    this.serial.reset();
    if (owner !== this.owner || this.disposed) return;
    this.audio?.reset();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.owner++;
    this.credit = 0; this.dmaWord = 0; this.lpspiWord = 0;
    // Previously accepted RAM effects survive cancellation; reset removes only remaining work.
    this.dma.reset(); this.serial.reset();
    this.audio?.reset();
  }
  status(): DisplayTransportStatus {
    return { owner: this.owner, disposed: this.disposed, fixtures: { ...this.fixtures },
      clocks: { dmaWord: this.dmaWord, lpspiWord: this.lpspiWord,
        dmaEnabled: this.dmaEnabled(), lpspiEnabled: this.lpspiEnabled(), ...(this.audio ? { saiEnabled: this.saiEnabled() } : {}) },
      creditTicks: this.credit, phases: this.phases, diagnostics: [...this.diagnostics.values()].map(d => ({ ...d })),
      diagnosticOverflow: this.diagnosticOverflow, edma: this.dma.status(), lpspi: this.serial.status(),
      ...(this.audio ? { audio: this.audio.status() } : {}) };
  }
}
