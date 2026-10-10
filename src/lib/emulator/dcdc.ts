/** Bounded RT1062 DCDC register model. See docs/emulator-dcdc.md. */
export type DcdcMmioWidth = 1 | 2 | 4;

export const DCDC_REG = Object.freeze({
  REG0: 0x40080000, REG1: 0x40080004, REG2: 0x40080008, REG3: 0x4008000c,
});
export const DCDC_BITS = Object.freeze({
  DISABLE_AUTO_CLK_SWITCH: 0x2, SEL_CLK: 0x4, PWD_OSC_INT: 0x8,
  XTALOK_DISABLE: 0x08000000, CURRENT_ALERT_RESET: 0x10000000,
  XTAL_24M_OK: 0x20000000, STS_DC_OK: 0x80000000,
  TRG: 0x1f, TARGET_LP: 0x700, DISABLE_STEP: 0x40000000,
});
export const DCDC_RESET = Object.freeze({
  REG0: 0x14030111, REG1: 0x111ba29c, REG2: 0x00000002, REG3: 0x0000010e,
});
export const DCDC_WRITABLE = Object.freeze({
  REG0: 0x3c3f0fff, REG1: 0x1fa03380, REG2: 0x18003fc0, REG3: 0x4100071f,
});
export const DCDC_EVIDENCE = Object.freeze({
  manual: 'analysis/flash_research/IMXRT1060RM_rev3.pdf',
  manualSha256: 'a2e342e492eded2a1d626cf955de953ca28d8db8675b10937a5176fd6f2c9200',
  manualSections: '18.4.1; 18.4.2; 18.5.1.1..18.5.1.5',
  manualPages: '1202..1214',
  header: 'references/MIMXRT1062.h',
  headerSha256: '1ee70ed9eb7f3a75ed89943dd799314e8330538f54c6990ea7d9cae96fd263aa',
  driver: 'https://raw.githubusercontent.com/nxp-mcuxpresso/legacy-mcux-sdk/6f3fd257cdcf978a4d26e7d6e9eed9240037422b/drivers/dcdc_1/fsl_dcdc.c',
  driverSha256: '454f11c1d72b1ceab2b563d20e76fff7d23d335747eb52a91a4de4a2d52fa6ea',
  driverLines: '200..225; 404..414; 718..801',
});
export const DCDC_LIMITATIONS = Object.freeze([
  'Settling uses explicit synthetic ticks, unrelated to electrical voltage, physical time, or CPU cycles.',
  'Converter enable and internal/external clock availability are fixed environmental fixtures, preserved by reset.',
  'Auto selection falls back to the powered internal oscillator when the requested external fixture is unavailable; this is model policy.',
  'Reserved TARGET_LP encodings5..7 hold DC_OK low as a conservative model policy, not a documented silicon response.',
  'Other writable fields retain configuration without analog loop, protection, current-alert, IRQ, voltage, standby, or power-sequencing effects.',
  'CCGR gating, PMIC_ON_REQ, PSWITCH, physical supplies, fuse trims, and oscillator detector coupling remain outside this component.',
  'Register reset values describe model reset, not measured DCDC state at the resident APP1 handoff.',
]);

export interface DcdcOptions {
  /** Synthetic delay for reset, changed targets, and selected-clock changes. */
  settleTicks?: number;
  /** Fixed environmental fixtures; none is inferred from writable status-like controls. */
  settlingFailure?: boolean;
  converterEnabled?: boolean;
  internalClockAvailable?: boolean;
  externalClockAvailable?: boolean;
}
export interface DcdcStatus {
  ticks: number;
  settlingElapsed: number;
  dcOk: boolean;
  targetRun: number;
  targetLowPower: number;
  clockSource: 'internal' | 'external' | 'unavailable';
  blockingReasons: string[];
  unsupported: string[];
  reg0: number;
  reg1: number;
  reg2: number;
  reg3: number;
  configuration: Required<DcdcOptions>;
  limitations: readonly string[];
}
type RegisterName = keyof typeof DCDC_REG;
interface Access {
  register: RegisterName;
  shift: number;
  busMask: number;
  laneMask: number;
}
const B = DCDC_BITS;
const MAX_TICKS = 0xffffffff;
const REGISTERS: readonly RegisterName[] = ['REG0', 'REG1', 'REG2', 'REG3'];

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
function access(address: number, width: DcdcMmioWidth): Access | undefined {
  if (![1, 2, 4].includes(width) || !Number.isInteger(address) || address < 0 ||
      address > 0xffffffff || address % width !== 0) return undefined;
  const word = (address & ~3) >>> 0;
  if (word < DCDC_REG.REG0 || word > DCDC_REG.REG3) return undefined;
  const register = REGISTERS[(word - DCDC_REG.REG0) / 4];
  const shift = (address & 3) * 8;
  const busMask = width === 4 ? 0xffffffff : width === 2 ? 0xffff : 0xff;
  return { register, shift, busMask, laneMask: (busMask << shift) >>> 0 };
}

/** Absolute MMIO addresses; +4/+8/+12 are separate registers, never aliases. */
export class Rt1062Dcdc {
  private readonly configuration: Required<DcdcOptions>;
  private registers: Record<RegisterName, number> = { ...DCDC_RESET };
  private ticks = 0;
  private settlingElapsed = 0;
  private dcOk = false;

  constructor(options: DcdcOptions = {}) {
    this.configuration = {
      settleTicks: tickCount(options.settleTicks ?? 1, 'settleTicks'),
      settlingFailure: fixture(options.settlingFailure, false, 'settlingFailure'),
      converterEnabled: fixture(options.converterEnabled, true, 'converterEnabled'),
      internalClockAvailable: fixture(options.internalClockAvailable, true, 'internalClockAvailable'),
      externalClockAvailable: fixture(options.externalClockAvailable, false, 'externalClockAvailable'),
    };
  }

  handles(address: number, width: DcdcMmioWidth = 4): boolean {
    return access(address, width) !== undefined;
  }

  read(address: number, width: DcdcMmioWidth = 4): number | undefined {
    const location = access(address, width);
    if (!location) return undefined;
    const value = this.registers[location.register] |
      (location.register === 'REG0' && this.dcOk ? B.STS_DC_OK : 0);
    return ((value >>> location.shift) & location.busMask) >>> 0;
  }

  write(address: number, value: number, width: DcdcMmioWidth = 4): boolean {
    const location = access(address, width);
    if (!location) return false;
    const oldClock = this.clockSource();
    const old = this.registers[location.register];
    const mask = location.laneMask & DCDC_WRITABLE[location.register];
    // Mask bus lanes before shifting so unwritten high bits cannot change controls.
    const bits = ((value & location.busMask) << location.shift) & mask;
    const next = ((old & ~mask) | bits) >>> 0;
    this.registers[location.register] = next;
    const targetChanged = location.register === 'REG3' && ((old ^ next) & (B.TRG | B.TARGET_LP)) !== 0;
    if (targetChanged || oldClock !== this.clockSource() || this.blocked()) {
      this.dcOk = false;
      this.settlingElapsed = 0;
    }
    return true;
  }

  private clockSource(): DcdcStatus['clockSource'] {
    const control = this.registers.REG0;
    const internalAvailable = this.configuration.internalClockAvailable && (control & B.PWD_OSC_INT) === 0;
    const externalAvailable = this.configuration.externalClockAvailable;
    if ((control & B.DISABLE_AUTO_CLK_SWITCH) !== 0) {
      return (control & B.SEL_CLK) !== 0
        ? externalAvailable ? 'external' : 'unavailable'
        : internalAvailable ? 'internal' : 'unavailable';
    }
    if ((control & B.XTAL_24M_OK) !== 0 && externalAvailable) return 'external';
    return internalAvailable ? 'internal' : 'unavailable';
  }

  private unsupported(): string[] {
    const result: string[] = [];
    if (((this.registers.REG3 & B.TARGET_LP) >>> 8) > 4) result.push('TARGET_LP encoding5..7 is undocumented');
    if (((this.registers.REG0 >>> 5) & 7) > 5) result.push('CUR_SNS_THRSH encoding6..7 is undocumented; current detection is unmodeled');
    return result;
  }

  private blockingReasons(): string[] {
    const result: string[] = [];
    if (!this.configuration.converterEnabled) result.push('converter-enable fixture is false');
    if (this.configuration.settlingFailure) result.push('settling-failure fixture is true');
    if (this.clockSource() === 'unavailable') result.push('selected clock fixture is unavailable');
    if (((this.registers.REG3 & B.TARGET_LP) >>> 8) > 4) result.push('unsupported TARGET_LP encoding');
    return result;
  }

  private blocked(): boolean {
    // Tick runs with every observed CPU hook; reserve diagnostic arrays for status().
    return !this.configuration.converterEnabled || this.configuration.settlingFailure ||
      this.clockSource() === 'unavailable' || ((this.registers.REG3 & B.TARGET_LP) >>> 8) > 4;
  }

  /** Reads and writes do not advance abstract settling time. */
  tick(ticks = 1): void {
    tickCount(ticks, 'ticks');
    this.ticks = Math.min(Number.MAX_SAFE_INTEGER, this.ticks + ticks);
    if (this.blocked()) {
      this.dcOk = false;
      this.settlingElapsed = 0;
      return;
    }
    this.settlingElapsed = Math.min(this.configuration.settleTicks, this.settlingElapsed + ticks);
    if (this.settlingElapsed >= this.configuration.settleTicks) this.dcOk = true;
  }

  reset(): void {
    this.registers = { ...DCDC_RESET };
    this.ticks = this.settlingElapsed = 0;
    this.dcOk = false;
  }

  status(): DcdcStatus {
    return {
      ticks: this.ticks, settlingElapsed: this.settlingElapsed, dcOk: this.dcOk,
      targetRun: this.registers.REG3 & B.TRG, targetLowPower: (this.registers.REG3 & B.TARGET_LP) >>> 8,
      clockSource: this.clockSource(), blockingReasons: this.blockingReasons(), unsupported: this.unsupported(),
      reg0: this.read(DCDC_REG.REG0)!, reg1: this.read(DCDC_REG.REG1)!,
      reg2: this.read(DCDC_REG.REG2)!, reg3: this.read(DCDC_REG.REG3)!,
      configuration: { ...this.configuration }, limitations: DCDC_LIMITATIONS,
    };
  }
}
