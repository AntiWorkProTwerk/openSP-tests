/** USB2 PLL control only; documented in docs/emulator-pll-usb2.md. */
export type Usb2PllMmioWidth = 1 | 2 | 4;
export const PLL_USB2_REG = Object.freeze({CONTROL: 0x400d8020, SET: 0x400d8024, CLR: 0x400d8028, TOG: 0x400d802c});
export const PLL_USB2_BITS = Object.freeze({DIV_SELECT: 2, EN_USB_CLKS: 0x40, POWER: 0x1000,
  ENABLE: 0x2000, BYPASS_CLK_SRC: 0xc000, BYPASS: 0x10000, LOCK: 0x80000000});
export const PLL_USB2_RESET = 0x12000;
export const PLL_USB2_WRITABLE = 0x1f042;
export interface Usb2PllOptions {
  lockTicks?: number;
  lockFailure?: boolean;
  reference24MAvailable?: boolean;
  referenceClk1Available?: boolean;
}
export interface Usb2PllStatus {
  ticks: number;
  lockElapsed: number;
  locked: boolean;
  powered: boolean;
  outputEnabled: boolean;
  usbClocksEnabled: boolean;
  bypassed: boolean;
  multiplier: 20 | 22;
  referenceSourceCode: number;
  referenceSource: 'oscillator24M' | 'clk1' | 'unsupported';
  referenceAvailable: boolean;
  control: number;
  blockingReasons: string[];
  configuration: Required<Usb2PllOptions>;
  limitations: readonly string[];
}
export const PLL_USB2_LIMITATIONS = Object.freeze([
  'Lock progress uses synthetic ticks and fixed reference availability; physical settling and output frequency are unverified.',
  'Power/divider/reference changes restart synthetic lock; this is explicit model policy.',
  'ENABLE, EN_USB_CLKS and BYPASS are retained output controls; none generates a clock waveform or prevents analog lock.',
  'Reserved reference codes2/3 remain stored and conservatively hold synthetic LOCK low.',
  'USBPHY gating, remote-wakeup hardware changes, oscillator coupling, other PLLs and CCM/PFD handshakes are unmodeled.',
]);
const B = PLL_USB2_BITS;
const LOCK_CONFIGURATION = B.POWER | B.DIV_SELECT | B.BYPASS_CLK_SRC;
function tickCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${name} must be an integer in 0..4294967295`);
  }
  return value;
}
function fixture(value: boolean | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
  return value;
}
function access(address: number, width: Usb2PllMmioWidth) {
  if (![1, 2, 4].includes(width) || !Number.isInteger(address) || address < 0 || address > 0xffffffff || address % width) return;
  const word = (address & ~3) >>> 0;
  if (word < PLL_USB2_REG.CONTROL || word > PLL_USB2_REG.TOG) return;
  const shift = (address & 3) * 8;
  const mask = width === 4 ? 0xffffffff : width === 2 ? 0xffff : 0xff;
  return {alias: (word - PLL_USB2_REG.CONTROL) / 4, shift, mask, lanes: (mask << shift) >>> 0};
}

/** Owns exactly400D8020..400D802F; USB1's historical fixture is separate. */
export class Rt1062Usb2Pll {
  private readonly configuration: Required<Usb2PllOptions>;
  private control = PLL_USB2_RESET;
  private ticks = 0;
  private lockElapsed = 0;
  private locked = false;
  constructor(options: Usb2PllOptions = {}) {
    this.configuration = {lockTicks: tickCount(options.lockTicks ?? 1, 'lockTicks'),
      lockFailure: fixture(options.lockFailure, false, 'lockFailure'),
      reference24MAvailable: fixture(options.reference24MAvailable, true, 'reference24MAvailable'),
      referenceClk1Available: fixture(options.referenceClk1Available, false, 'referenceClk1Available')};
  }
  handles(address: number, width: Usb2PllMmioWidth = 4): boolean {return access(address, width) !== undefined;}
  read(address: number, width: Usb2PllMmioWidth = 4): number | undefined {
    const lane = access(address, width);
    if (!lane) return;
    if (lane.alias) return 0;
    return (((this.control | (this.locked ? B.LOCK : 0)) >>> lane.shift) & lane.mask) >>> 0;
  }
  write(address: number, value: number, width: Usb2PllMmioWidth = 4): boolean {
    const lane = access(address, width);
    if (!lane) return false;
    const bits = (((value & lane.mask) << lane.shift) >>> 0) & PLL_USB2_WRITABLE;
    const old = this.control;
    if (lane.alias === 0) this.control = ((old & ~(lane.lanes & PLL_USB2_WRITABLE)) | bits) >>> 0;
    else if (lane.alias === 1) this.control = (old | bits) >>> 0;
    else if (lane.alias === 2) this.control = (old & ~bits) >>> 0;
    else this.control = (old ^ bits) >>> 0;
    if (((old ^ this.control) & LOCK_CONFIGURATION) !== 0 || this.blocked()) {
      this.locked = false; this.lockElapsed = 0;
    }
    return true;
  }
  private referenceAvailable(): boolean {
    const source = (this.control & B.BYPASS_CLK_SRC) >>> 14;
    return source === 0 ? this.configuration.reference24MAvailable : source === 1 ? this.configuration.referenceClk1Available : false;
  }
  private blocked(): boolean {
    return this.configuration.lockFailure || (this.control & B.POWER) === 0 || !this.referenceAvailable();
  }
  tick(ticks = 1): void {
    tickCount(ticks, 'ticks');
    this.ticks = Math.min(Number.MAX_SAFE_INTEGER, this.ticks + ticks);
    if (this.blocked()) {this.locked = false; this.lockElapsed = 0; return;}
    this.lockElapsed = Math.min(this.configuration.lockTicks, this.lockElapsed + ticks);
    if (this.lockElapsed >= this.configuration.lockTicks) this.locked = true;
  }
  reset(): void {this.control = PLL_USB2_RESET; this.ticks = this.lockElapsed = 0; this.locked = false;}
  status(): Usb2PllStatus {
    const source = (this.control & B.BYPASS_CLK_SRC) >>> 14;
    const blockingReasons: string[] = [];
    if (this.configuration.lockFailure) blockingReasons.push('lock-failure fixture is true');
    if (!(this.control & B.POWER)) blockingReasons.push('analog power is disabled');
    if (source > 1) blockingReasons.push('unsupported reference source encoding');
    else if (!this.referenceAvailable()) blockingReasons.push('selected reference fixture is unavailable');
    return {ticks: this.ticks, lockElapsed: this.lockElapsed, locked: this.locked, powered: !!(this.control & B.POWER),
      outputEnabled: !!(this.control & B.ENABLE), usbClocksEnabled: !!(this.control & B.EN_USB_CLKS), bypassed: !!(this.control & B.BYPASS),
      multiplier: this.control & B.DIV_SELECT ? 22 : 20, referenceSourceCode: source,
      referenceSource: source === 0 ? 'oscillator24M' : source === 1 ? 'clk1' : 'unsupported', referenceAvailable: this.referenceAvailable(),
      control: this.read(PLL_USB2_REG.CONTROL)!, blockingReasons, configuration: {...this.configuration}, limitations: PLL_USB2_LIMITATIONS};
  }
}
