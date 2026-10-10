/**
 * Integer Cortex-M7 exception semantics, independent of the instruction engine.
 * Sources: Arm DUI 0646B §§2.1.3, 2.3, 4.2–4.4, 4.7:
 * https://documentation-service.arm.com/static/61efd6602dd99944d051417b
 * Priority encoding also follows Arm's CMSIS-Core NVIC implementation:
 * https://arm-software.github.io/CMSIS_6/latest/Core/group__NVIC__gr.html
 * ARMv7-M DDI 0403E.b §B1.5.8 defines EXC_RETURN integrity and PopStack:
 * https://documentation-service.arm.com/static/5f8fef3af86e16515cdbf816
 *
 * The caller supplies source-clock ticks. They are deterministic model counts,
 * not measured Cortex-M7 cycles. Late arrival, fault escalation, sleep, exclusive
 * monitors and FPU/lazy frames remain outside this model; unsupported frame
 * transitions fail explicitly. Delivery must occur at instruction boundaries.
 */

export interface ExceptionCPU {
  readRegister(name: string): number;
  writeRegister(name: string, value: number): void;
  readMemory(address: number, length: number): Uint8Array;
  loadMemory?(address: number, bytes: Uint8Array): void;
  writeMemory?(address: number, bytes: Uint8Array): void;
}

export interface ExceptionOptions {
  externalInterrupts?: number;
  priorityBits?: number;
  vectorTable?: number;
  /** Implementation-specific VTOR alignment; defaults to the implemented table size. */
  vectorTableAlignment?: number;
  /** Unknown calibration is the default; no physical clock rate is implied. */
  systickCalibration?: number;
}

export interface ExceptionTransition {
  kind: 'entry' | 'return' | 'tail-chain';
  exceptionNumber: number;
  returnException: number;
  stack: 'msp' | 'psp';
  stackPointer: number;
  excReturn: number;
  pc: number;
}

export class ExceptionModelError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExceptionModelError';
    this.code = code;
  }
}

export const EXC_RETURN = Object.freeze({
  handlerMsp: 0xfffffff1,
  threadMsp: 0xfffffff9,
  threadPsp: 0xfffffffd,
});

const VALID_SYSTEM = new Set([2, 3, 4, 5, 6, 11, 12, 14, 15]);
const CONFIGURABLE_SYSTEM = new Set([4, 5, 6, 11, 12, 14, 15]);
const T = 0x01000000;
const ALIGN = 0x200;
const IPSR = 0x1ff;
const APSR = 0xf80f0000;
const SYST_CSR = 0xe000e010;
const SYST_RVR = 0xe000e014;
const SYST_CVR = 0xe000e018;
const SYST_CALIB = 0xe000e01c;
const ICTR = 0xe000e004;
const ICSR = 0xe000ed04;
const VTOR = 0xe000ed08;
const AIRCR = 0xe000ed0c;
const CCR = 0xe000ed14;
const SHPR = 0xe000ed18;
const SHCSR = 0xe000ed24;
const STIR = 0xe000ef00;
const FPCCR = 0xe000ef34;

/** BX/LoadWritePC route Handler-mode destinations with top nibble F to EXC_RETURN. */
export function isExceptionReturn(pc: number): boolean {
  return ((pc >>> 0) >>> 28) === 0xf;
}

function normalizeReturn(value: number, fromFetch: boolean): number {
  // A cleared bit0 is accepted only at the runner boundary after a Thumb branch.
  const token = (fromFetch ? value | 1 : value) >>> 0;
  if ([0xffffffe1, 0xffffffe9, 0xffffffed].includes(token)) {
    throw new ExceptionModelError('fpu-frame', 'Floating-point exception frames are not modeled.');
  }
  if (token !== EXC_RETURN.handlerMsp && token !== EXC_RETURN.threadMsp && token !== EXC_RETURN.threadPsp) {
    throw new ExceptionModelError('invalid-exc-return', `Invalid ARMv7-M EXC_RETURN 0x${(value >>> 0).toString(16)}.`);
  }
  return token;
}

export class CortexMExceptions {
  readonly cpu: ExceptionCPU;
  readonly externalInterrupts: number;
  readonly priorityBits: number;
  readonly vectorTableAlignment: number;
  readonly priorityMask: number;
  private priorities: Uint8Array;
  private enabled: Uint8Array;
  private pending: Uint8Array;
  private levels: Uint8Array;
  private active: number[] = [];
  private vtor = 0;
  private prigroup = 0;
  private ccr = 0x40200; // M7 BP and STKALIGN read as one.
  private systickControl = 4;
  private systickReload = 0;
  private systickCurrent = 0;
  private systickCountFlag = false;
  private systickCalibration: number;
  private fpccr = 0xc0000000;
  private sourceTicks = 0;
  private delivered = 0;
  private returned = 0;
  private tailChains = 0;

  constructor(cpu: ExceptionCPU, options: ExceptionOptions = {}) {
    this.cpu = cpu;
    this.externalInterrupts = options.externalInterrupts ?? 160;
    this.priorityBits = options.priorityBits ?? 4;
    if (!Number.isInteger(this.externalInterrupts) || this.externalInterrupts < 1 || this.externalInterrupts > 240) {
      throw new RangeError('externalInterrupts must be 1..240.');
    }
    if (!Number.isInteger(this.priorityBits) || this.priorityBits < 1 || this.priorityBits > 8) {
      throw new RangeError('priorityBits must be 1..8.');
    }
    const requiredAlignment = 2 ** Math.ceil(Math.log2(Math.max(128, 4 * (16 + this.externalInterrupts))));
    this.vectorTableAlignment = options.vectorTableAlignment ?? requiredAlignment;
    if (!Number.isInteger(this.vectorTableAlignment) || this.vectorTableAlignment > 0x80000000 || this.vectorTableAlignment < requiredAlignment || (this.vectorTableAlignment & (this.vectorTableAlignment - 1)) !== 0) {
      throw new RangeError('VTOR alignment must be a power of two large enough for the implemented vector table.');
    }
    this.priorityMask = (0xff << (8 - this.priorityBits)) & 0xff;
    this.priorities = new Uint8Array(16 + this.externalInterrupts);
    this.enabled = new Uint8Array(this.priorities.length);
    this.pending = new Uint8Array(this.priorities.length);
    this.levels = new Uint8Array(this.externalInterrupts);
    for (const exception of [2, 3, 11, 14, 15]) this.enabled[exception] = 1;
    this.systickCalibration = (options.systickCalibration ?? 0x40000000) >>> 0;
    this.setVectorTable(options.vectorTable ?? 0);
    if (!cpu.loadMemory && !cpu.writeMemory) throw new TypeError('ExceptionCPU needs loadMemory or writeMemory.');
  }

  get activeException(): number { return this.active.at(-1) ?? 0; }
  get pendingCount(): number { return this.pending.reduce((count, value) => count + value, 0); }
  get vectorTable(): number { return this.vtor; }

  status() {
    return {
      activeException: this.activeException,
      activeExceptions: [...this.active],
      pendingExceptions: Array.from(this.pending.keys()).filter((exception) => this.pending[exception]),
      vectorTable: this.vtor,
      priorityGrouping: this.prigroup,
      delivered: this.delivered,
      returned: this.returned,
      tailChains: this.tailChains,
      systick: {
        control: this.systickControl,
        reload: this.systickReload,
        current: this.systickCurrent,
        countFlag: this.systickCountFlag,
        sourceTicks: this.sourceTicks,
        timing: 'modeled source ticks; no physical cycle calibration',
      },
      unsupported: ['FPU/lazy frames', 'late arrival', 'fault escalation', 'non-base Thread return', 'sleep', 'exclusive monitors'],
    };
  }

  private register(name: string): number { return this.cpu.readRegister(name) >>> 0; }
  private checkException(exception: number): void {
    if (!Number.isInteger(exception) || !(VALID_SYSTEM.has(exception) || (exception >= 16 && exception < this.pending.length))) {
      throw new RangeError(`Unimplemented or reserved exception ${exception}.`);
    }
  }
  private checkExternal(irq: number): void {
    if (!Number.isInteger(irq) || irq < 0 || irq >= this.externalInterrupts) throw new RangeError(`Unimplemented IRQ ${irq}.`);
  }
  private checkIntegerFrame(): void {
    if ((this.register('control') & 4) || (this.fpccr & 1)) {
      throw new ExceptionModelError('fpu-frame', 'Active or lazy floating-point state requires an extended exception frame.');
    }
  }
  private checkContext(): void {
    if ((this.register('xpsr') & IPSR) !== this.activeException) {
      throw new ExceptionModelError('untracked-handler', 'CPU IPSR and modeled active exceptions disagree.');
    }
  }

  setVectorTable(address: number): void {
    this.vtor = ((address >>> 0) & ~(this.vectorTableAlignment - 1)) >>> 0;
  }
  setPriorityGrouping(group: number): void {
    if (!Number.isInteger(group) || group < 0 || group > 7) throw new RangeError('PRIGROUP must be 0..7.');
    this.prigroup = group;
  }
  setPriority(exception: number, encodedPriority: number): void {
    this.checkException(exception);
    if (exception < 16 && !CONFIGURABLE_SYSTEM.has(exception)) throw new RangeError('NMI and HardFault have fixed priority.');
    this.priorities[exception] = encodedPriority & this.priorityMask;
  }
  setExternalEnabled(irq: number, value: boolean): void {
    this.checkExternal(irq);
    this.enabled[irq + 16] = Number(value);
  }
  setSystemEnabled(exception: number, value: boolean): void {
    if (![4, 5, 6, 12].includes(exception)) throw new RangeError('Only configurable faults and DebugMonitor have modeled enables.');
    this.enabled[exception] = Number(value);
  }
  pend(exception: number): void { this.checkException(exception); this.pending[exception] = 1; }
  clearPending(exception: number): void {
    this.checkException(exception);
    this.pending[exception] = Number(exception >= 16 && this.levels[exception - 16]
      && (this.pending[exception] || !this.active.includes(exception)));
  }
  /** A held peripheral line re-pends on return; deasserting does not clear a latched request. */
  setExternalLine(irq: number, asserted: boolean): void {
    this.checkExternal(irq);
    const rising = asserted && !this.levels[irq];
    this.levels[irq] = Number(asserted);
    if (asserted && (rising || !this.active.includes(irq + 16))) this.pend(irq + 16);
  }

  private priority(exception: number): number {
    return exception === 2 ? -2 : exception === 3 ? -1 : this.priorities[exception];
  }
  private groupPriority(priority: number): number {
    return priority < 0 ? priority : (priority & ~((1 << (this.prigroup + 1)) - 1));
  }
  private choosePending(active = this.active, masks = true, faultmask = this.register('faultmask') & 1, ignorePrimask = false): number | null {
    let candidate: number | null = null;
    const executionPriority = active.reduce((priority, exception) => Math.min(priority, this.groupPriority(this.priority(exception))), 256);
    const basepri = this.register('basepri') & this.priorityMask;
    const baseGroup = this.groupPriority(basepri);
    const primask = this.register('primask') & 1;
    for (let exception = 2; exception < this.pending.length; exception++) {
      if (!this.pending[exception] || !this.enabled[exception] || active.includes(exception)) continue;
      const priority = this.priority(exception);
      const group = this.groupPriority(priority);
      if (masks && ((faultmask && exception !== 2) || (!ignorePrimask && primask && priority >= 0) || (basepri && priority >= 0 && group >= baseGroup))) continue;
      if (masks && group >= executionPriority) continue;
      if (candidate === null || priority < this.priority(candidate) || (priority === this.priority(candidate) && exception < candidate)) candidate = exception;
    }
    return candidate;
  }

  private vector(exception: number): number {
    const bytes = this.cpu.readMemory((this.vtor + exception * 4) >>> 0, 4);
    if (bytes.byteLength !== 4) throw new ExceptionModelError('vector-read', 'CPU returned an incomplete vector word.');
    const pointer = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
    if (!(pointer & 1)) throw new ExceptionModelError('non-thumb-vector', `Exception ${exception} vector lacks its Thumb bit.`);
    return pointer;
  }
  private enterHandler(exception: number, pointer: number, token: number): void {
    const xpsr = ((this.register('xpsr') & APSR) | T | exception) >>> 0;
    this.cpu.writeRegister('control', this.register('control') & ~2);
    this.cpu.writeRegister('xpsr', xpsr);
    this.cpu.writeRegister('sp', this.register('msp'));
    this.cpu.writeRegister('lr', token);
    this.cpu.writeRegister('pc', pointer);
    this.pending[exception] = 0;
    this.active.push(exception);
    this.delivered++;
  }

  dispatchPending(): ExceptionTransition | null {
    this.checkContext();
    const exception = this.choosePending();
    if (exception === null) return null;
    this.checkIntegerFrame();
    const oldXpsr = this.register('xpsr');
    if (!(oldXpsr & T)) throw new ExceptionModelError('invalid-thumb-state', 'Exception entry requires a valid Thumb xPSR.');
    const returnException = this.activeException;
    const stack = returnException === 0 && (this.register('control') & 2) ? 'psp' : 'msp';
    const oldSp = this.register(stack);
    if ((oldSp & 3) || oldSp < 36) throw new ExceptionModelError('invalid-stack', 'Exception stack must be word aligned and have space for the frame.');
    const padding = oldSp & 4 ? 4 : 0;
    const frameSp = (oldSp - 32 - padding) >>> 0;
    const bytes = new Uint8Array(32);
    const frame = new DataView(bytes.buffer);
    const names = ['r0', 'r1', 'r2', 'r3', 'r12', 'lr', 'pc'];
    names.forEach((name, index) => frame.setUint32(index * 4, name === 'pc' ? this.register(name) & ~1 : this.register(name), true));
    frame.setUint32(28, ((oldXpsr & ~ALIGN) | (padding ? ALIGN : 0)) >>> 0, true);
    // Validate the vector before changing CPU state. Memory faults are surfaced to
    // the caller; this model does not pretend to have implemented fault escalation.
    const pointer = this.vector(exception);
    const writer = this.cpu.loadMemory ?? this.cpu.writeMemory;
    writer!.call(this.cpu, frameSp, bytes);
    this.cpu.writeRegister(stack, frameSp);
    const token = returnException ? EXC_RETURN.handlerMsp : stack === 'psp' ? EXC_RETURN.threadPsp : EXC_RETURN.threadMsp;
    this.enterHandler(exception, pointer, token);
    return { kind: 'entry', exceptionNumber: exception, returnException, stack, stackPointer: frameSp, excReturn: token, pc: (pointer & ~1) >>> 0 };
  }

  /** Restores the frame at the current architectural SP, allowing RTOS PSP switches. */
  returnFromException(value = this.register('lr'), options: { fromFetch?: boolean } = {}): ExceptionTransition {
    const token = normalizeReturn(value, options.fromFetch ?? false);
    this.checkContext();
    const completed = this.activeException;
    if (!completed) throw new ExceptionModelError('return-in-thread', 'EXC_RETURN requires an active Handler context.');
    this.checkIntegerFrame();
    const toThread = Boolean(token & 8);
    const stack = token & 4 ? 'psp' : 'msp';
    const remaining = this.active.slice(0, -1);
    if (toThread && remaining.length) {
      throw new ExceptionModelError(this.ccr & 1 ? 'non-base-thread-return' : 'invalid-return-context', 'Returning to Thread mode while another exception remains active is not modeled.');
    }
    if (!toThread && !remaining.length) throw new ExceptionModelError('invalid-return-context', 'Handler-mode return requires a preempted active exception.');
    const returnException = toThread ? 0 : remaining.at(-1)!;
    const frameSp = this.register(stack);
    if (frameSp & 3) throw new ExceptionModelError('invalid-stack', 'Exception return stack must be word aligned.');
    // A held level is sampled on retirement, even if software cleared pending.
    const rePend = completed >= 16 && Boolean(this.levels[completed - 16]);
    if (rePend) this.pending[completed] = 1;
    const returnFaultmask = completed === 2 ? this.register('faultmask') & 1 : 0;
    const next = this.choosePending(remaining, true, returnFaultmask);
    if (next !== null) {
      const pointer = this.vector(next);
      this.active.pop();
      if (completed !== 2) this.cpu.writeRegister('faultmask', 0);
      this.enterHandler(next, pointer, token);
      this.tailChains++;
      this.returned++;
      return { kind: 'tail-chain', exceptionNumber: next, returnException, stack, stackPointer: frameSp, excReturn: token, pc: (pointer & ~1) >>> 0 };
    }
    const bytes = this.cpu.readMemory(frameSp, 32);
    if (bytes.byteLength !== 32) throw new ExceptionModelError('frame-read', 'CPU returned an incomplete exception frame.');
    const frame = new DataView(bytes.buffer, bytes.byteOffset, 32);
    const savedXpsr = frame.getUint32(28, true);
    const savedPc = frame.getUint32(24, true);
    if ((savedXpsr & IPSR) !== returnException) throw new ExceptionModelError('invalid-return-context', 'Stacked IPSR disagrees with the EXC_RETURN destination.');
    if (!(savedXpsr & T) || (savedPc & 1)) throw new ExceptionModelError('invalid-thumb-state', 'Stacked PC/xPSR do not describe a valid Thumb return.');
    if (frameSp + 32 > 0xffffffff) throw new ExceptionModelError('invalid-stack', 'Exception return overflows the address space.');
    // PopStack ORs the alignment bit; addition differs for software-crafted frames.
    const restoredSp = ((frameSp + 32) | (savedXpsr & ALIGN ? 4 : 0)) >>> 0;
    this.active.pop();
    this.cpu.writeRegister('control', (this.register('control') & ~2) | (toThread && stack === 'psp' ? 2 : 0));
    this.cpu.writeRegister('xpsr', (savedXpsr & (APSR | 0x0700fc00 | IPSR)) >>> 0);
    this.cpu.writeRegister(stack, restoredSp >>> 0);
    this.cpu.writeRegister('sp', toThread && stack === 'psp' ? this.register('psp') : this.register('msp'));
    ['r0', 'r1', 'r2', 'r3', 'r12', 'lr'].forEach((name, index) => this.cpu.writeRegister(name, frame.getUint32(index * 4, true)));
    this.cpu.writeRegister('pc', (savedPc | 1) >>> 0);
    if (completed !== 2) this.cpu.writeRegister('faultmask', 0);
    this.returned++;
    return { kind: 'return', exceptionNumber: completed, returnException, stack, stackPointer: restoredSp >>> 0, excReturn: token, pc: savedPc };
  }

  /** Advance only the selected source. Pending state coalesces multiple wraps. */
  advanceSysTick(ticks: number, source: 'processor' | 'external' = 'processor'): number {
    if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError('SysTick ticks must be a nonnegative safe integer.');
    if (!(this.systickControl & 1) || (Boolean(this.systickControl & 4) !== (source === 'processor'))) return 0;
    if (!Number.isSafeInteger(this.sourceTicks + ticks)) throw new RangeError('SysTick model tick count exceeds safe integer range.');
    this.sourceTicks += ticks;
    let remaining = ticks;
    let wraps = 0;
    if (this.systickCurrent > 0) {
      if (remaining < this.systickCurrent) { this.systickCurrent -= remaining; return 0; }
      remaining -= this.systickCurrent;
      this.systickCurrent = 0;
      wraps++;
    }
    if (this.systickReload > 0 && remaining > 0) {
      const period = this.systickReload + 1;
      wraps += Math.floor(remaining / period);
      remaining %= period;
      if (remaining) this.systickCurrent = this.systickReload - remaining + 1;
    }
    if (wraps) {
      this.systickCountFlag = true;
      if (this.systickControl & 2) this.pend(15);
    }
    return wraps;
  }

  private priorityRegion(address: number, size: number): boolean {
    return (address >= 0xe000e400 && address + size <= 0xe000e4f0) || (address >= SHPR && address + size <= SHPR + 12);
  }
  ownsMmio(address: number, size = 4): boolean {
    return this.priorityRegion(address, size) || [ICTR, SYST_CSR, SYST_RVR, SYST_CVR, SYST_CALIB, ICSR, VTOR, AIRCR, CCR, SHCSR, STIR, FPCCR].includes(address)
      || [0xe000e100, 0xe000e180, 0xe000e200, 0xe000e280, 0xe000e300].some((base) => address >= base && address + size <= base + 32);
  }
  private checkMmio(address: number, size: number): void {
    if (![1, 2, 4].includes(size) || address % size || (!this.priorityRegion(address, size) && size !== 4)) {
      throw new ExceptionModelError('invalid-mmio-width', 'NVIC/SCB/SysTick access must use a supported aligned width.');
    }
    if ((this.register('control') & 1) && !this.activeException && !(address === STIR && (this.ccr & 2))) {
      throw new ExceptionModelError('unprivileged-mmio', 'Unprivileged access to the modeled core peripheral registers is denied.');
    }
  }
  private bank(address: number): { kind: 'enabled' | 'pending' | 'active'; clear: boolean; first: number } | null {
    for (const [base, kind, clear] of [[0xe000e100, 'enabled', false], [0xe000e180, 'enabled', true], [0xe000e200, 'pending', false], [0xe000e280, 'pending', true], [0xe000e300, 'active', false]] as const) {
      if (address >= base && address < base + 32) return { kind, clear, first: 16 + ((address - base) >>> 2) * 32 };
    }
    return null;
  }
  readMmio(address: number, size = 4): number | undefined {
    address >>>= 0;
    if (!this.ownsMmio(address, size)) return undefined;
    this.checkMmio(address, size);
    if (this.priorityRegion(address, size)) {
      let value = 0;
      for (let byte = 0; byte < size; byte++) {
        const exception = address >= SHPR ? address + byte - SHPR + 4 : address + byte - 0xe000e400 + 16;
        value |= (this.priorities[exception] ?? 0) << (byte * 8);
      }
      return value >>> 0;
    }
    const bank = this.bank(address);
    if (bank) {
      let value = 0;
      for (let bit = 0; bit < 32; bit++) {
        const exception = bank.first + bit;
        if (exception >= this.pending.length) break;
        if (bank.kind === 'active' ? this.active.includes(exception) : bank.kind === 'enabled' ? this.enabled[exception] : this.pending[exception]) value |= 1 << bit;
      }
      return value >>> 0;
    }
    switch (address) {
      case ICTR: return Math.ceil(this.externalInterrupts / 32) - 1;
      case SYST_CSR: {
        const value = this.systickControl | (this.systickCountFlag ? 0x10000 : 0);
        this.systickCountFlag = false;
        return value;
      }
      case SYST_RVR: return this.systickReload;
      case SYST_CVR: return this.systickCurrent;
      case SYST_CALIB: return this.systickCalibration;
      case VTOR: return this.vtor;
      case AIRCR: return (0xfa050000 | (this.prigroup << 8)) >>> 0;
      case CCR: return this.ccr;
      case FPCCR: return this.fpccr;
      case STIR: return 0;
      case ICSR: {
        // M7 VECTPENDING includes BASEPRI/FAULTMASK, but ignores PRIMASK (§4.3.3).
        const candidate = this.choosePending([], true, this.register('faultmask') & 1, true) ?? 0;
        const externalPending = this.pending.some((value, exception) => exception >= 16 && value !== 0);
        return (this.activeException | (this.active.length <= 1 ? 1 << 11 : 0) | (candidate << 12) | (externalPending ? 1 << 22 : 0)
          | (this.pending[15] ? 1 << 26 : 0) | (this.pending[14] ? 1 << 28 : 0) | (this.pending[2] ? 1 << 31 : 0)) >>> 0;
      }
      case SHCSR: {
        let value = 0;
        for (const [exception, bit] of [[4, 0], [5, 1], [6, 3], [11, 7], [12, 8], [14, 10], [15, 11]]) if (this.active.includes(exception)) value |= 1 << bit;
        for (const [exception, bit] of [[6, 12], [4, 13], [5, 14], [11, 15]]) if (this.pending[exception]) value |= 1 << bit;
        for (const [exception, bit] of [[4, 16], [5, 17], [6, 18]]) if (this.enabled[exception]) value |= 1 << bit;
        return value >>> 0;
      }
      default: return undefined;
    }
  }
  writeMmio(address: number, value: number, size = 4): boolean {
    address >>>= 0;
    value >>>= 0;
    if (!this.ownsMmio(address, size)) return false;
    this.checkMmio(address, size);
    if (this.priorityRegion(address, size)) {
      for (let byte = 0; byte < size; byte++) {
        const exception = address >= SHPR ? address + byte - SHPR + 4 : address + byte - 0xe000e400 + 16;
        if ((exception >= 16 && exception < this.pending.length) || CONFIGURABLE_SYSTEM.has(exception)) this.priorities[exception] = (value >>> (byte * 8)) & this.priorityMask;
      }
      return true;
    }
    const bank = this.bank(address);
    if (bank) {
      if (bank.kind === 'active') return true; // IABR is read-only.
      for (let bit = 0; bit < 32; bit++) {
        const exception = bank.first + bit;
        if (exception >= this.pending.length) break;
        if (!(value & (1 << bit))) continue;
        if (bank.kind === 'enabled') this.enabled[exception] = Number(!bank.clear);
        else if (bank.clear) this.clearPending(exception);
        else this.pend(exception);
      }
      return true;
    }
    switch (address) {
      case SYST_CSR: this.systickControl = (value & 7) | (this.systickCalibration & 0x80000000 ? 4 : 0); break;
      case SYST_RVR: this.systickReload = value & 0xffffff; break;
      case SYST_CVR: this.systickCurrent = 0; this.systickCountFlag = false; break;
      case VTOR: this.setVectorTable(value); break;
      case AIRCR:
        if ((value >>> 16) === 0x5fa) {
          if (value & 7) throw new ExceptionModelError('unmodeled-reset', 'AIRCR reset/debug actions require board reset integration.');
          this.setPriorityGrouping((value >>> 8) & 7);
        }
        break;
      case CCR: this.ccr = ((value & 0x3011b) | 0x40200) >>> 0; break;
      case FPCCR: this.fpccr = value; break;
      case STIR: {
        const irq = value & 0x1ff;
        if (irq < this.externalInterrupts) this.pend(irq + 16);
        break;
      }
      case ICSR:
        if (((value & (1 << 28)) && (value & (1 << 27))) || ((value & (1 << 26)) && (value & (1 << 25)))) {
          throw new ExceptionModelError('unpredictable-icsr', 'Setting and clearing the same ICSR pending flag together is architecturally unpredictable.');
        }
        if (value & (1 << 31)) this.pend(2);
        if (value & (1 << 27)) this.clearPending(14);
        if (value & (1 << 25)) this.clearPending(15);
        if (value & (1 << 28)) this.pend(14);
        if (value & (1 << 26)) this.pend(15);
        break;
      case SHCSR:
        for (const [exception, bit] of [[6, 12], [4, 13], [5, 14], [11, 15]]) this.pending[exception] = Number(Boolean(value & (1 << bit)));
        for (const [exception, bit] of [[4, 16], [5, 17], [6, 18]]) this.enabled[exception] = Number(Boolean(value & (1 << bit)));
        break;
      // ICTR and SYST_CALIB are read-only.
    }
    return true;
  }
}
