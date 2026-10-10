/** ARM PLL control group only. See docs/emulator-pll-arm.md. */
export type ArmPllMmioWidth = 1 | 2 | 4;
export const PLL_ARM_REG = Object.freeze({
  CONTROL: 0x400d8000, SET: 0x400d8004, CLR: 0x400d8008, TOG: 0x400d800c,
});
export const PLL_ARM_BITS = Object.freeze({
  DIV_SELECT: 0x7f, POWERDOWN: 0x1000, ENABLE: 0x2000,
  BYPASS_CLK_SRC: 0xc000, BYPASS: 0x10000,
  RESERVED_PLL_SEL: 0x80000, LOCK: 0x80000000,
});
export const PLL_ARM_RESET = 0x00013063;
export const PLL_ARM_WRITABLE = 0x0001f07f;
export const PLL_ARM_EVIDENCE = Object.freeze({
  manual: 'analysis/flash_research/IMXRT1060RM_rev3.pdf',
  manualSha256: 'a2e342e492eded2a1d626cf955de953ca28d8db8675b10937a5176fd6f2c9200',
  manualSections: '1.5.2; 14.6.1.5.3; 14.6.1.6; 14.8.1',
  manualPages: '25; 1031..1033; 1090; 1093..1094',
  header: 'references/MIMXRT1062.h',
  headerSha256: '1ee70ed9eb7f3a75ed89943dd799314e8330538f54c6990ea7d9cae96fd263aa',
  driver: 'https://raw.githubusercontent.com/nxp-mcuxpresso/legacy-mcux-sdk/6f3fd257cdcf978a4d26e7d6e9eed9240037422b/devices/MIMXRT1062/drivers/fsl_clock.c',
  driverSha256: '669e2698ea0be01db0ac656f4ceef6106670d1f116b2da9f3b2ac961945a5eb3',
  driverLines: '581..597',
});
export const PLL_ARM_LIMITATIONS = Object.freeze([
  'Lock delay uses explicit synthetic ticks, unrelated to physical PLL settling time or CPU cycles.',
  '24 MHz and CLK1 reference availability are fixed environmental fixtures, preserved by reset; register bits cannot create a reference.',
  'Source/divider changes or power transitions clear synthetic LOCK and restart the delay; that transition policy is not a hardware timing result.',
  'Undocumented dividers outside54..108 or reserved source codes2/3 retain their fields and conservatively hold synthetic LOCK low.',
  'Reserved PLL_SEL bit19 remains zero; a generated header mask does not establish functional selector behavior.',
  'ENABLE and BYPASS retain output configuration without generating or routing a clock; locking remains eligible while bypassed or output-disabled.',
  'Other PLLs, PFD status, CCM handshakes, oscillator coupling, output frequency and resident/ROM clock state remain outside this component.',
]);

export interface ArmPllOptions {
  lockTicks?: number;
  lockFailure?: boolean;
  reference24MAvailable?: boolean;
  referenceClk1Available?: boolean;
}
export interface ArmPllStatus {
  ticks: number;
  lockElapsed: number;
  locked: boolean;
  poweredDown: boolean;
  outputEnabled: boolean;
  bypassed: boolean;
  divider: number;
  referenceSourceCode: number;
  referenceSource: 'oscillator24M' | 'clk1' | 'unsupported';
  referenceAvailable: boolean;
  reservedSelectorRequests: number;
  control: number;
  blockingReasons: string[];
  unsupported: string[];
  configuration: Required<ArmPllOptions>;
  limitations: readonly string[];
}
interface Access {
  alias: number;
  shift: number;
  busMask: number;
  laneMask: number;
}
const B = PLL_ARM_BITS;
const MAX_TICKS = 0xffffffff;
const LOCK_CONFIGURATION = B.DIV_SELECT | B.POWERDOWN | B.BYPASS_CLK_SRC;

function tickCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TICKS) {
    throw new RangeError(`${name} must be an integer in 0..4294967295`);
  }
  return value;
}
function fixture(value: boolean | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
  return value;
}
function access(address: number, width: ArmPllMmioWidth): Access | undefined {
  if (![1, 2, 4].includes(width) || !Number.isInteger(address) || address < 0 ||
      address > 0xffffffff || address % width !== 0) return undefined;
  const word = (address & ~3) >>> 0;
  if (word < PLL_ARM_REG.CONTROL || word > PLL_ARM_REG.TOG) return undefined;
  const shift = (address & 3) * 8;
  const busMask = width === 4 ? 0xffffffff : width === 2 ? 0xffff : 0xff;
  return { alias: (word - PLL_ARM_REG.CONTROL) / 4, shift, busMask, laneMask: (busMask << shift) >>> 0 };
}

/** Absolute MMIO addresses; only the ARM PLL's four words are owned. */
export class Rt1062ArmPll {
  private readonly configuration: Required<ArmPllOptions>;
  private control = PLL_ARM_RESET;
  private ticks = 0;
  private lockElapsed = 0;
  private locked = false;
  private reservedSelectorRequests = 0;

  constructor(options: ArmPllOptions = {}) {
    this.configuration = {
      lockTicks: tickCount(options.lockTicks ?? 1, 'lockTicks'),
      lockFailure: fixture(options.lockFailure, false, 'lockFailure'),
      reference24MAvailable: fixture(options.reference24MAvailable, true, 'reference24MAvailable'),
      referenceClk1Available: fixture(options.referenceClk1Available, false, 'referenceClk1Available'),
    };
  }

  handles(address: number, width: ArmPllMmioWidth = 4): boolean {
    return access(address, width) !== undefined;
  }

  read(address: number, width: ArmPllMmioWidth = 4): number | undefined {
    const location = access(address, width);
    if (!location) return undefined;
    if (location.alias !== 0) return 0;
    const value = this.control | (this.locked ? B.LOCK : 0);
    return ((value >>> location.shift) & location.busMask) >>> 0;
  }

  write(address: number, value: number, width: ArmPllMmioWidth = 4): boolean {
    const location = access(address, width);
    if (!location) return false;
    const raw = ((value & location.busMask) << location.shift) >>> 0;
    if ((raw & B.RESERVED_PLL_SEL) !== 0) {
      this.reservedSelectorRequests = Math.min(Number.MAX_SAFE_INTEGER, this.reservedSelectorRequests + 1);
    }
    const bits = raw & PLL_ARM_WRITABLE;
    const old = this.control;
    let next = old;
    if (location.alias === 0) next = (old & ~(location.laneMask & PLL_ARM_WRITABLE)) | bits;
    else if (location.alias === 1) next = old | bits;
    else if (location.alias === 2) next = old & ~bits;
    else next = old ^ bits;
    this.control = next >>> 0;
    if (((old ^ next) & LOCK_CONFIGURATION) !== 0 || this.blocked()) {
      this.locked = false;
      this.lockElapsed = 0;
    }
    return true;
  }

  private referenceAvailable(): boolean {
    const source = (this.control & B.BYPASS_CLK_SRC) >>> 14;
    return source === 0 ? this.configuration.reference24MAvailable
      : source === 1 ? this.configuration.referenceClk1Available : false;
  }

  private blocked(): boolean {
    // Keep the tick path free of diagnostic arrays.
    const divider = this.control & B.DIV_SELECT;
    return this.configuration.lockFailure || (this.control & B.POWERDOWN) !== 0 ||
      divider < 54 || divider > 108 || !this.referenceAvailable();
  }

  /** Only this explicit call advances abstract lock time. */
  tick(ticks = 1): void {
    tickCount(ticks, 'ticks');
    this.ticks = Math.min(Number.MAX_SAFE_INTEGER, this.ticks + ticks);
    if (this.blocked()) {
      this.locked = false;
      this.lockElapsed = 0;
      return;
    }
    this.lockElapsed = Math.min(this.configuration.lockTicks, this.lockElapsed + ticks);
    if (this.lockElapsed >= this.configuration.lockTicks) this.locked = true;
  }

  reset(): void {
    this.control = PLL_ARM_RESET;
    this.ticks = this.lockElapsed = this.reservedSelectorRequests = 0;
    this.locked = false;
  }

  status(): ArmPllStatus {
    const divider = this.control & B.DIV_SELECT;
    const source = (this.control & B.BYPASS_CLK_SRC) >>> 14;
    const blockingReasons: string[] = [];
    const unsupported: string[] = [];
    if (this.configuration.lockFailure) blockingReasons.push('lock-failure fixture is true');
    if ((this.control & B.POWERDOWN) !== 0) blockingReasons.push('PLL is powered down');
    if (divider < 54 || divider > 108) {
      blockingReasons.push('unsupported divider encoding');
      unsupported.push('DIV_SELECT outside documented54..108');
    }
    if (source > 1) {
      blockingReasons.push('unsupported reference source encoding');
      unsupported.push('BYPASS_CLK_SRC codes2/3 are reserved');
    } else if (!this.referenceAvailable()) blockingReasons.push('selected reference fixture is unavailable');
    if (this.reservedSelectorRequests !== 0) unsupported.push('Reserved PLL_SEL writes were ignored');
    return {
      ticks: this.ticks, lockElapsed: this.lockElapsed, locked: this.locked,
      poweredDown: (this.control & B.POWERDOWN) !== 0,
      outputEnabled: (this.control & B.ENABLE) !== 0, bypassed: (this.control & B.BYPASS) !== 0,
      divider, referenceSourceCode: source,
      referenceSource: source === 0 ? 'oscillator24M' : source === 1 ? 'clk1' : 'unsupported',
      referenceAvailable: this.referenceAvailable(), reservedSelectorRequests: this.reservedSelectorRequests,
      control: this.read(PLL_ARM_REG.CONTROL)!, blockingReasons, unsupported,
      configuration: { ...this.configuration }, limitations: PLL_ARM_LIMITATIONS,
    };
  }
}
