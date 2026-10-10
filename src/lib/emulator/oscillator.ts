/** Bounded RT1062 oscillator register model. See docs/emulator-oscillator.md. */
export type OscillatorMmioWidth = 1 | 2 | 4;

export const OSCILLATOR_REG = Object.freeze({
  MISC0: 0x400d8150, MISC0_SET: 0x400d8154,
  MISC0_CLR: 0x400d8158, MISC0_TOG: 0x400d815c,
  LOWPWR_CTRL: 0x400d8270, LOWPWR_CTRL_SET: 0x400d8274,
  LOWPWR_CTRL_CLR: 0x400d8278, LOWPWR_CTRL_TOG: 0x400d827c,
});
export const OSCILLATOR_BITS = Object.freeze({
  XTAL_24M_PWD: 0x40000000, OSC_XTALOK_EN: 0x10000,
  OSC_XTALOK: 0x8000, XTALOSC_PWRUP_STAT: 0x10000,
  RTC_XTAL_SOURCE: 0x20000000, REFTOP_VBGUP: 0x80,
});
export const OSCILLATOR_RESET = Object.freeze({ MISC0: 0x04000000, LOWPWR_CTRL: 0x00004001 });
export const OSCILLATOR_EVIDENCE = Object.freeze({
  manual: 'analysis/flash_research/IMXRT1060RM_rev3.pdf',
  manualSha256: 'a2e342e492eded2a1d626cf955de953ca28d8db8675b10937a5176fd6f2c9200',
  manualSections: '1.5.2; 14.8.17; 15.4.4; 15.6.1; 15.6.2',
  header: 'references/MIMXRT1062.h',
  headerSha256: '1ee70ed9eb7f3a75ed89943dd799314e8330538f54c6990ea7d9cae96fd263aa',
  driver: 'https://raw.githubusercontent.com/nxp-mcuxpresso/legacy-mcux-sdk/6f3fd257cdcf978a4d26e7d6e9eed9240037422b/devices/MIMXRT1062/drivers/fsl_clock.c',
  driverSha256: '669e2698ea0be01db0ac656f4ceef6106670d1f116b2da9f3b2ac961945a5eb3',
  driverLines: '175..199',
});
export const OSCILLATOR_LIMITATIONS = Object.freeze([
  'Power-up and detection delays are explicit synthetic ticks, unrelated to physical clock time or CPU cycles.',
  'XTALOK retention after detector disable, clearing on detector re-enable, and clearing on power-down are model assumptions.',
  'Other documented XTAL-view controls retain values without electrical, clock-routing, PLL, bandgap, or power-gating effects.',
  'RTC_XTAL_SOURCE and the unmodeled, access-ambiguous REFTOP_VBGUP remain zero fixtures; PMU-only bits1/2 are outside this subset.',
  'These reset values describe a model reset, not measured oscillator state at the resident APP1 handoff.',
]);

export interface OscillatorOptions {
  /** Synthetic elapsed ticks; neither register delay field converts ticks to milliseconds. */
  powerUpTicks?: number;
  frequencyDetectTicks?: number;
  /** Fixed environmental fixtures, preserved across model reset. */
  powerUpFailure?: boolean;
  frequencyFailure?: boolean;
}
export interface OscillatorStatus {
  ticks: number;
  poweredDown: boolean;
  powerUpReady: boolean;
  detectorEnabled: boolean;
  crystalOk: boolean;
  powerUpElapsed: number;
  detectionElapsed: number;
  misc0: number;
  lowPowerControl: number;
  configuration: Required<OscillatorOptions>;
  limitations: readonly string[];
}
interface Access {
  register: 'misc0' | 'lowPowerControl';
  alias: number;
  shift: number;
  busMask: number;
  laneMask: number;
}

// XTALOSC view of the shared analog registers. MISC0 bit31 is VID_PLL_PREDIV
// in that view; CCM labels it reserved. Unmodeled status/PMU fields are omitted.
const MISC0_WRITABLE = 0xde017c79;
const LOWPWR_WRITABLE = 0x0006eff1;
const B = OSCILLATOR_BITS;
const MAX_TICKS = 0xffffffff;

function tickCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TICKS) {
    throw new RangeError(`${name} must be an integer in 0..4294967295`);
  }
  return value;
}
function access(address: number, width: OscillatorMmioWidth): Access | undefined {
  if (![1, 2, 4].includes(width) || !Number.isInteger(address) || address < 0 ||
      address > 0xffffffff || address % width !== 0) return undefined;
  const word = (address & ~3) >>> 0;
  const register = word >= OSCILLATOR_REG.MISC0 && word <= OSCILLATOR_REG.MISC0_TOG
    ? 'misc0' : word >= OSCILLATOR_REG.LOWPWR_CTRL && word <= OSCILLATOR_REG.LOWPWR_CTRL_TOG
      ? 'lowPowerControl' : undefined;
  if (register === undefined) return undefined;
  const base = register === 'misc0' ? OSCILLATOR_REG.MISC0 : OSCILLATOR_REG.LOWPWR_CTRL;
  const shift = (address & 3) * 8;
  const busMask = width === 4 ? 0xffffffff : width === 2 ? 0xffff : 0xff;
  return { register, alias: (word - base) / 4, shift, busMask, laneMask: (busMask << shift) >>> 0 };
}

/** Absolute MMIO addresses only. Unknown/unaligned accesses remain unhandled. */
export class Rt1062Oscillator {
  private readonly configuration: Required<OscillatorOptions>;
  private misc0: number = OSCILLATOR_RESET.MISC0;
  private lowPowerControl: number = OSCILLATOR_RESET.LOWPWR_CTRL;
  private ticks = 0;
  private powerUpElapsed = 0;
  private detectionElapsed = 0;
  private powerUpReady = false;
  private crystalOk = false;

  constructor(options: OscillatorOptions = {}) {
    this.configuration = {
      powerUpTicks: tickCount(options.powerUpTicks ?? 1, 'powerUpTicks'),
      frequencyDetectTicks: tickCount(options.frequencyDetectTicks ?? 1, 'frequencyDetectTicks'),
      powerUpFailure: options.powerUpFailure ?? false,
      frequencyFailure: options.frequencyFailure ?? false,
    };
  }

  handles(address: number, width: OscillatorMmioWidth = 4): boolean {
    return access(address, width) !== undefined;
  }

  read(address: number, width: OscillatorMmioWidth = 4): number | undefined {
    const location = access(address, width);
    if (!location) return undefined;
    // Rev3 §1.5.2: SET/CLR/TOG reads return zero, not the primary contents.
    if (location.alias !== 0) return 0;
    const value = location.register === 'misc0'
      ? (this.misc0 | (this.crystalOk ? B.OSC_XTALOK : 0)) >>> 0
      : this.lowPowerControl | (this.powerUpReady ? B.XTALOSC_PWRUP_STAT : 0);
    return ((value >>> location.shift) & location.busMask) >>> 0;
  }

  /** Returns false for an address/width this subset does not own. */
  write(address: number, value: number, width: OscillatorMmioWidth = 4): boolean {
    const location = access(address, width);
    if (!location) return false;
    const writable = location.register === 'misc0' ? MISC0_WRITABLE : LOWPWR_WRITABLE;
    const old = this[location.register];
    // Mask before shifting: unwritten high bits cannot trigger control actions.
    const bits = (((value & location.busMask) << location.shift) & writable) >>> 0;
    let next = old;
    if (location.alias === 0) next = (old & ~(location.laneMask & writable)) | bits;
    else if (location.alias === 1) next = old | bits;
    else if (location.alias === 2) next = old & ~bits;
    else next = old ^ bits;
    this[location.register] = next >>> 0;
    if (location.register === 'misc0') this.controlChanged(old, next >>> 0);
    return true;
  }

  private controlChanged(old: number, next: number): void {
    if ((next & B.XTAL_24M_PWD) !== 0) {
      this.powerUpReady = this.crystalOk = false;
      this.powerUpElapsed = this.detectionElapsed = 0;
    } else if ((old & B.XTAL_24M_PWD) !== 0) {
      this.powerUpElapsed = this.detectionElapsed = 0;
      this.powerUpReady = this.crystalOk = false;
    }
    if ((old & B.OSC_XTALOK_EN) === 0 && (next & B.OSC_XTALOK_EN) !== 0) {
      this.detectionElapsed = 0;
      this.crystalOk = false;
    } else if ((next & B.OSC_XTALOK_EN) === 0) {
      this.detectionElapsed = 0;
      // Retain a completed detection result until re-enabled or powered down.
    }
  }

  /** Explicit abstract time only; reads and control writes never advance it. */
  tick(ticks = 1): void {
    tickCount(ticks, 'ticks');
    this.ticks = Math.min(Number.MAX_SAFE_INTEGER, this.ticks + ticks);
    if ((this.misc0 & B.XTAL_24M_PWD) !== 0 || this.configuration.powerUpFailure) return;
    let detectionTicks = ticks;
    if (!this.powerUpReady) {
      const needed = Math.max(0, this.configuration.powerUpTicks - this.powerUpElapsed);
      this.powerUpElapsed = Math.min(this.configuration.powerUpTicks, this.powerUpElapsed + ticks);
      if (this.powerUpElapsed < this.configuration.powerUpTicks) return;
      this.powerUpReady = true;
      detectionTicks = Math.max(0, ticks - needed);
    }
    if ((this.misc0 & B.OSC_XTALOK_EN) === 0 || this.configuration.frequencyFailure) return;
    this.detectionElapsed = Math.min(this.configuration.frequencyDetectTicks, this.detectionElapsed + detectionTicks);
    if (this.detectionElapsed >= this.configuration.frequencyDetectTicks) this.crystalOk = true;
  }

  reset(): void {
    this.misc0 = OSCILLATOR_RESET.MISC0;
    this.lowPowerControl = OSCILLATOR_RESET.LOWPWR_CTRL;
    this.ticks = this.powerUpElapsed = this.detectionElapsed = 0;
    this.powerUpReady = this.crystalOk = false;
  }

  status(): OscillatorStatus {
    return {
      ticks: this.ticks, poweredDown: (this.misc0 & B.XTAL_24M_PWD) !== 0,
      powerUpReady: this.powerUpReady, detectorEnabled: (this.misc0 & B.OSC_XTALOK_EN) !== 0,
      crystalOk: this.crystalOk, powerUpElapsed: this.powerUpElapsed, detectionElapsed: this.detectionElapsed,
      misc0: this.read(OSCILLATOR_REG.MISC0)!, lowPowerControl: this.read(OSCILLATOR_REG.LOWPWR_CTRL)!,
      configuration: { ...this.configuration }, limitations: OSCILLATOR_LIMITATIONS,
    };
  }
}
