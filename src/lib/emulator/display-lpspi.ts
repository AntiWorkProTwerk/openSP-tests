import { OwnershipChanged, SREG, TCR, type LpspiHooks, type Width } from './display-types.ts';

const FIFO_WORDS = 16, STICKY = 0x3f00, IRQ_MASK = 0x3f03;
const WORD = 0x100, FRAME = 0x200, COMPLETE = 0x400, RECEIVE_ERROR = 0x1000;
const REGISTERS = new Set<number>(Object.values(SREG));
type TxEntry = { kind: 'command' | 'data'; word: number };
type RxEntry = { word: number; first: boolean };
type Ticket = { local: number; owner: number };

export class LpspiCallbackFault extends Error {
  readonly code = 'lpspi-callback-failure';
}

/** Rev3 chapter48 register/FIFO contract; serial phases use explicit abstract quanta. */
export class DisplayLpspi {
  private readonly hooks: Readonly<LpspiHooks>;
  private generation = 0;
  private ownedOwner = 0;
  private registers = new Map<number, number>();
  private tx: TxEntry[] = [];
  private rx: RxEntry[] = [];
  private held: RxEntry | undefined;
  private activeCommand = 31;
  private sticky = 0;
  private pcs = false;
  private emittedPcs = false;
  private emittedIrq = false;
  private firstWord = true;
  private failed = false;
  private cancelled = false;
  private parked: string | undefined;
  private diagnostics = new Set<string>();
  private transferredWords = 0;

  constructor(hooks: LpspiHooks) {
    if (!Number.isInteger(hooks.sinByte) || hooks.sinByte < 0 || hooks.sinByte > 255)
      throw new RangeError('LPSPI SIN fixture must be a byte');
    this.hooks = Object.freeze({owner: hooks.owner.bind(hooks), diagnostic: hooks.diagnostic.bind(hooks),
      onPcs: hooks.onPcs.bind(hooks), onByte: hooks.onByte.bind(hooks), onIrq: hooks.onIrq.bind(hooks),
      sinByte: hooks.sinByte});
    this.reset();
  }

  private ticket(): Ticket {return {local: this.generation, owner: this.ownedOwner};}
  private guard(ticket: Ticket): void {
    if (this.cancelled || ticket.local !== this.generation || ticket.owner !== this.hooks.owner()) throw new OwnershipChanged();
  }
  private notify(ticket: Ticket, callback: () => void): void {
    this.guard(ticket);
    try {callback();}
    catch (error) {
      this.guard(ticket);
      if (error instanceof OwnershipChanged) {this.cancelled = true; throw error;}
      this.failed = true;
      if (!this.diagnostics.has('lpspi-callback-failure')) {
        this.diagnostics.add('lpspi-callback-failure');
        this.hooks.diagnostic('lpspi-callback-failure');
        this.guard(ticket);
      }
      throw new LpspiCallbackFault('An LPSPI output callback failed');
    }
    this.guard(ticket);
  }
  private report(code: string, offset?: number): void {
    if (this.diagnostics.has(code)) return;
    this.diagnostics.add(code);
    const ticket = this.ticket();
    this.guard(ticket);
    this.hooks.diagnostic(code, offset === undefined ? undefined : 0x403a0000 + offset);
    this.guard(ticket);
  }
  private emitIrq(ticket: Ticket, asserted: boolean): void {
    if (asserted === this.emittedIrq) return;
    this.emittedIrq = asserted;
    this.notify(ticket, () => this.hooks.onIrq(asserted));
  }
  private emitPcs(ticket: Ticket, active: boolean): void {
    if (active === this.emittedPcs) return;
    this.emittedPcs = active;
    this.notify(ticket, () => this.hooks.onPcs(active));
  }
  private value(offset: number): number {return this.registers.get(offset) ?? 0;}
  private resetHeld(): boolean {return !!(this.value(SREG.CR) & 2);}
  private flags(): number {
    const txWater = this.value(SREG.FCR) & 15, rxWater = (this.value(SREG.FCR) >>> 16) & 15;
    return (this.sticky | (this.tx.length <= txWater ? 1 : 0) |
      (this.rx.length > rxWater ? 2 : 0) | (this.pcs ? 0x1000000 : 0)) >>> 0;
  }
  private updateIrq(ticket = this.ticket()): void {
    this.emitIrq(ticket, !!(this.flags() & this.value(SREG.IER) & IRQ_MASK));
  }

  reset(): void {
    this.generation++;
    this.ownedOwner = this.hooks.owner();
    this.registers = new Map([[SREG.CR, 0], [SREG.IER, 0], [SREG.DER, 0],
      [SREG.CFGR0, 0], [SREG.CFGR1, 0], [SREG.DMR0, 0], [SREG.DMR1, 0],
      [SREG.CCR, 0], [SREG.FCR, 0]]);
    this.tx = []; this.rx = []; this.held = undefined;
    this.activeCommand = 31; this.sticky = 0; this.pcs = false; this.firstWord = true;
    this.failed = false; this.cancelled = false; this.parked = undefined; this.diagnostics.clear(); this.transferredWords = 0;
    const ticket = this.ticket();
    try {this.emitIrq(ticket, false); this.emitPcs(ticket, false);}
    catch (error) {if (!(error instanceof OwnershipChanged)) throw error;}
  }

  handles(offset: number, width: Width): boolean {
    return Number.isSafeInteger(offset) && [1, 2, 4].includes(width) && offset >= 0 &&
      offset % width === 0 && (offset & 3) + width <= 4 && REGISTERS.has(offset - (offset % 4));
  }
  private extract(word: number, offset: number, width: Width): number {
    return width === 4 ? word >>> 0 : (word >>> ((offset & 3) * 8)) & (width === 1 ? 255 : 65535);
  }
  private bits(value: number, offset: number, width: Width): number {
    return width === 4 ? value >>> 0 : ((value & (width === 1 ? 255 : 65535)) << ((offset & 3) * 8)) >>> 0;
  }
  private merge(old: number, value: number, offset: number, width: Width): number {
    const mask = width === 4 ? 0xffffffff : this.bits(width === 1 ? 255 : 65535, offset, width);
    return ((old & ~mask) | this.bits(value, offset, width)) >>> 0;
  }

  read(offset: number, width: Width): number | undefined {
    if (!this.handles(offset, width)) return undefined;
    const base = offset - (offset % 4);
    let word: number;
    if (base === SREG.VERID) word = 0x01020004;
    else if (base === SREG.PARAM) word = 0x00040404;
    else if (base === SREG.SR) word = this.flags();
    else if (base === SREG.FSR) word = this.tx.length | (this.rx.length << 16);
    else if (base === SREG.TCR) word = this.activeCommand;
    else if (base === SREG.RSR) word = (this.rx[0]?.first ? 1 : 0) | (!this.rx.length ? 2 : 0);
    else if (base === SREG.RDR) {
      this.guard(this.ticket());
      if (!this.rx.length) {this.report('lpspi-empty-rdr', offset); return 0;}
      word = this.rx.shift()!.word;
      this.updateIrq();
    } else if (base === SREG.TDR) {this.report('lpspi-write-only-read', offset); return undefined;}
    else word = this.value(base);
    return this.extract(word, offset, width);
  }

  write(offset: number, value: number, width: Width): boolean {
    if (!this.handles(offset, width)) return false;
    this.guard(this.ticket());
    const base = offset - (offset % 4);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      this.report('lpspi-invalid-value', offset); return false;
    }
    if (base === SREG.CR) {
      const control = this.merge(this.value(base), value, offset, width);
      if (control & 2) {
        const before = this.ticket();
        this.reset();
        this.guard({local: before.local + 1, owner: before.owner});
        this.registers.set(base, control & 15);
      } else {
        this.registers.set(base, control & 15);
        if (control & 0x100) {this.tx = []; this.parked = undefined;}
        if (control & 0x200) this.rx = [];
      }
      this.updateIrq(); return true;
    }
    if (this.resetHeld()) return true;
    if (base === SREG.TCR || base === SREG.TDR) {
      if (base === SREG.TCR && (width !== 4 || offset !== SREG.TCR)) {
        this.report('lpspi-command-width', offset); return false;
      }
      if (this.tx.length === FIFO_WORDS) {this.report('lpspi-full-tx-fifo', offset); return false;}
      this.tx.push({kind: base === SREG.TCR ? 'command' : 'data', word: this.bits(value, offset, width)});
      this.updateIrq(); return true;
    }
    if (base === SREG.SR) {this.sticky &= ~(this.bits(value, offset, width) & STICKY);}
    else if ([SREG.VERID, SREG.PARAM, SREG.FSR, SREG.RSR, SREG.RDR].includes(base as never)) {
      this.report('lpspi-read-only-write', offset); return false;
    } else {
      const next = this.merge(this.value(base), value, offset, width);
      const mask = base === SREG.IER ? IRQ_MASK : base === SREG.DER ? 3 :
        base === SREG.CFGR0 ? 0x307 : base === SREG.CFGR1 ? 0x0f070f0f :
        base === SREG.FCR ? 0x000f000f : 0xffffffff;
      this.registers.set(base, (next & mask) >>> 0);
      if (base === SREG.CFGR0 || base === SREG.CFGR1) this.parked = undefined;
    }
    this.updateIrq(); return true;
  }

  txRequest(): boolean {return !this.cancelled && this.ownedOwner === this.hooks.owner() && !this.failed && !this.parked && !this.resetHeld() &&
    !!(this.value(SREG.DER) & 1) && !!(this.flags() & 1);}
  rxRequest(): boolean {return !this.cancelled && this.ownedOwner === this.hooks.owner() && !this.failed && !this.resetHeld() &&
    !!(this.value(SREG.DER) & 2) && !!(this.flags() & 2);}

  private unsupported(code: string, offset: number): false {
    this.parked = code; this.report(code, offset); return false;
  }
  private commandSupported(command: number): string | undefined {
    if ((command & 0xfff) !== 7) return 'lpspi-frame-size';
    if (command & 0x30000) return 'lpspi-parallel-width';
    if (command & 0xc0000) return 'lpspi-masked-transfer';
    if (command & 0x800000) return 'lpspi-lsb-first';
    if (command & 0x3000000) return 'lpspi-pcs-selection';
    return undefined;
  }
  private publish(entry: RxEntry): void {
    if (this.rx.length === FIFO_WORDS) {this.sticky |= RECEIVE_ERROR; this.report('lpspi-rx-overflow', SREG.RDR);}
    else this.rx.push(entry);
  }
  private endFrame(ticket: Ticket): void {
    if (this.held) {const entry = this.held; this.held = undefined; this.publish(entry);}
    this.pcs = false; this.firstWord = true; this.sticky |= FRAME;
    if (!this.tx.length) this.sticky |= COMPLETE;
    this.emitPcs(ticket, false);
  }

  /** One queued command or one complete 8-bit serial word; no clock-credit state. */
  phase(): boolean {
    this.guard(this.ticket());
    if (this.failed || this.resetHeld() || !(this.value(SREG.CR) & 1)) return false;
    if (!this.tx.length) return false;
    if (!(this.value(SREG.CFGR1) & 1)) return this.unsupported('lpspi-slave-mode', SREG.CFGR1);
    if (this.value(SREG.CFGR0) & 0x301) return this.unsupported('lpspi-host-circular-match', SREG.CFGR0);
    if (this.value(SREG.CFGR1) & 0x0f070f08) return this.unsupported('lpspi-configuration', SREG.CFGR1);
    const ticket = this.ticket(), entry = this.tx[0];
    const command = entry.kind === 'command' ? entry.word : this.activeCommand;
    const unsupported = this.commandSupported(command);
    if (unsupported) return this.unsupported(unsupported, SREG.TCR);
    if (entry.kind === 'command') {
      if (command & TCR.CONTC) {
        if (!this.pcs || !(this.activeCommand & TCR.CONT) || !(command & TCR.CONT))
          return this.unsupported('lpspi-continuing-command', SREG.TCR);
      }
      this.tx.shift();
      if (this.pcs && !(command & TCR.CONTC)) this.endFrame(ticket);
      this.activeCommand = command & TCR.CONTC
        ? ((this.activeCommand & 0xff000000) | (command & 0x00ffffff)) >>> 0 : command >>> 0;
      this.parked = undefined;
      this.updateIrq(ticket); return true;
    }
    this.tx.shift();
    if (!this.pcs) {
      this.pcs = true; this.firstWord = true;
      this.emitPcs(ticket, true);
    }
    if (this.held) {const previous = this.held; this.held = undefined; this.publish(previous); this.guard(ticket);}
    const txByte = (entry.word >>> (this.activeCommand & TCR.BYSW ? 24 : 0)) & 255;
    this.notify(ticket, () => this.hooks.onByte(txByte));
    const received = {word: this.activeCommand & TCR.BYSW ? (this.hooks.sinByte << 24) >>> 0 : this.hooks.sinByte,
      first: this.firstWord};
    this.firstWord = false; this.transferredWords++; this.sticky |= WORD;
    if (this.activeCommand & TCR.CONT) this.held = received;
    else {this.publish(received); this.guard(ticket); this.endFrame(ticket);}
    this.updateIrq(ticket); return true;
  }

  status() {
    return {cr: this.value(SREG.CR), sr: this.flags(), ier: this.value(SREG.IER), der: this.value(SREG.DER),
      tcr: this.activeCommand, txCount: this.tx.length, rxCount: this.rx.length,
      heldRx: !!this.held, pcsActive: this.pcs, irq: this.emittedIrq,
      failed: this.failed, cancelled: this.cancelled, parked: this.parked, transferredWords: this.transferredWords};
  }
}
