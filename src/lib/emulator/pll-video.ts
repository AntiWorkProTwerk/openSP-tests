/** VIDEO PLL register polling only. See docs/emulator-pll-video.md. */
export type VideoPllMmioWidth = 1 | 2 | 4;
export const PLL_VIDEO_REG = Object.freeze({
  CONTROL: 0x400d80a0, SET: 0x400d80a4, CLR: 0x400d80a8, TOG: 0x400d80ac,
  NUM: 0x400d80b0, DENOM: 0x400d80c0,
});
export const PLL_VIDEO_BITS = Object.freeze({
  DIV_SELECT: 0x7f, POWERDOWN: 0x1000, ENABLE: 0x2000,
  BYPASS_CLK_SRC: 0xc000, BYPASS: 0x10000, POST_DIV_SELECT: 0x180000, LOCK: 0x80000000,
});
export const PLL_VIDEO_RESET = 0x0001100c;
export const PLL_VIDEO_NUM_RESET = 0x05f5e100;
export const PLL_VIDEO_DENOM_RESET = 0x10a24447;
export const PLL_VIDEO_WRITABLE = 0x0019f07f;
export const PLL_VIDEO_FRACTION_MASK = 0x3fffffff;
export const PLL_VIDEO_EVIDENCE = Object.freeze({
  manual: 'analysis/flash_research/IMXRT1060RM_rev3.pdf',
  manualSha256: 'a2e342e492eded2a1d626cf955de953ca28d8db8675b10937a5176fd6f2c9200',
  manualSections: '1.5.2; 14.6.1.5.3; 14.6.1.6; 14.8.11..14.8.13',
  manualPages: '25; 1031..1032; 1108..1111',
  header: 'references/MIMXRT1062.h',
  headerSha256: '1ee70ed9eb7f3a75ed89943dd799314e8330538f54c6990ea7d9cae96fd263aa',
  headerLines: '8539..8547; 9403..9597',
  driver: 'https://raw.githubusercontent.com/nxp-mcuxpresso/legacy-mcux-sdk/6f3fd257cdcf978a4d26e7d6e9eed9240037422b/devices/MIMXRT1062/drivers/fsl_clock.c',
  driverSha256: '669e2698ea0be01db0ac656f4ceef6106670d1f116b2da9f3b2ac961945a5eb3',
  driverLines: '809..878',
});
export const PLL_VIDEO_LIMITATIONS = Object.freeze([
  'Lock delay uses explicit synthetic ticks, unrelated to physical settling time or CPU cycles.',
  '24 MHz and CLK1 reference availability are fixed fixtures preserved by reset; register writes cannot create a reference.',
  'Changed loop divider, reference, analog power or fractional parameters clear synthetic LOCK and restart its delay; physical transition timing is unmeasured.',
  'Unsupported loop/source encodings, zero denominator or abs(signed numerator) >= denominator conservatively hold synthetic LOCK low; their silicon response is unqualified.',
  'ENABLE, BYPASS and post-divider bits retain output settings without becoming analog-lock prerequisites; reserved post-divider code3 has no supported output meaning.',
  'Fractional frequency arithmetic, generated waveforms, MISC2 division, CCM routing, other PLLs and oscillator coupling are outside this component.',
]);

export interface VideoPllOptions {
  lockTicks?: number;
  lockFailure?: boolean;
  reference24MAvailable?: boolean;
  referenceClk1Available?: boolean;
}
export interface VideoPllStatus {
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
  numerator: number;
  signedNumerator: number;
  denominator: number;
  fractionalValid: boolean;
  postDividerCode: number;
  postDivider?: number;
  control: number;
  blockingReasons: string[];
  unsupported: string[];
  configuration: Required<VideoPllOptions>;
  limitations: readonly string[];
}
interface Access {
  kind: 'control' | 'numerator' | 'denominator';
  alias: number;
  shift: number;
  busMask: number;
  laneMask: number;
}
const B = PLL_VIDEO_BITS;
const LOCK_CONFIGURATION = B.DIV_SELECT | B.POWERDOWN | B.BYPASS_CLK_SRC;
const MAX_TICKS = 0xffffffff;

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
function access(address: number, width: VideoPllMmioWidth): Access | undefined {
  if (![1, 2, 4].includes(width) || !Number.isInteger(address) || address < 0 ||
      address > 0xffffffff || address % width !== 0) return undefined;
  const word = (address & ~3) >>> 0;
  let kind: Access['kind'];
  let alias = 0;
  if (word >= PLL_VIDEO_REG.CONTROL && word <= PLL_VIDEO_REG.TOG) {
    kind = 'control'; alias = (word - PLL_VIDEO_REG.CONTROL) / 4;
  } else if (word === PLL_VIDEO_REG.NUM) kind = 'numerator';
  else if (word === PLL_VIDEO_REG.DENOM) kind = 'denominator';
  else return undefined;
  const shift = (address & 3) * 8;
  const busMask = width === 4 ? 0xffffffff : width === 2 ? 0xffff : 0xff;
  return {kind, alias, shift, busMask, laneMask: (busMask << shift) >>> 0};
}

/** Absolute MMIO addresses: four VIDEO control words and two standalone fractional words. */
export class Rt1062VideoPll {
  private readonly configuration: Required<VideoPllOptions>;
  private control = PLL_VIDEO_RESET;
  private numerator = PLL_VIDEO_NUM_RESET;
  private denominator = PLL_VIDEO_DENOM_RESET;
  private ticks = 0;
  private lockElapsed = 0;
  private locked = false;

  constructor(options: VideoPllOptions = {}) {
    this.configuration = {
      lockTicks: tickCount(options.lockTicks ?? 1, 'lockTicks'),
      lockFailure: fixture(options.lockFailure, false, 'lockFailure'),
      reference24MAvailable: fixture(options.reference24MAvailable, true, 'reference24MAvailable'),
      referenceClk1Available: fixture(options.referenceClk1Available, false, 'referenceClk1Available'),
    };
  }
  handles(address: number, width: VideoPllMmioWidth = 4): boolean {return access(address, width) !== undefined;}
  read(address: number, width: VideoPllMmioWidth = 4): number | undefined {
    const location = access(address, width);
    if (!location) return undefined;
    if (location.alias !== 0) return 0;
    const value = location.kind === 'numerator' ? this.numerator : location.kind === 'denominator' ? this.denominator
      : this.control | (this.locked ? B.LOCK : 0);
    return ((value >>> location.shift) & location.busMask) >>> 0;
  }
  write(address: number, value: number, width: VideoPllMmioWidth = 4): boolean {
    const location = access(address, width);
    if (!location) return false;
    const raw = ((value & location.busMask) << location.shift) >>> 0;
    let changed = false;
    if (location.kind === 'control') {
      const bits = raw & PLL_VIDEO_WRITABLE, old = this.control;
      let next = old;
      if (location.alias === 0) next = (old & ~(location.laneMask & PLL_VIDEO_WRITABLE)) | bits;
      else if (location.alias === 1) next = old | bits;
      else if (location.alias === 2) next = old & ~bits;
      else next = old ^ bits;
      this.control = next >>> 0;
      changed = ((old ^ next) & LOCK_CONFIGURATION) !== 0;
    } else {
      const old = location.kind === 'numerator' ? this.numerator : this.denominator;
      const next = ((old & ~(location.laneMask & PLL_VIDEO_FRACTION_MASK)) | (raw & PLL_VIDEO_FRACTION_MASK)) >>> 0;
      if (location.kind === 'numerator') this.numerator = next; else this.denominator = next;
      changed = old !== next;
    }
    if (changed || this.blocked()) {this.locked = false; this.lockElapsed = 0;}
    return true;
  }
  private signedNumerator(): number {return (this.numerator << 2) >> 2;}
  private fractionalValid(): boolean {return this.denominator !== 0 && Math.abs(this.signedNumerator()) < this.denominator;}
  private referenceAvailable(): boolean {
    const source = (this.control & B.BYPASS_CLK_SRC) >>> 14;
    return source === 0 ? this.configuration.reference24MAvailable
      : source === 1 ? this.configuration.referenceClk1Available : false;
  }
  private blocked(): boolean {
    const divider = this.control & B.DIV_SELECT;
    return this.configuration.lockFailure || (this.control & B.POWERDOWN) !== 0 ||
      divider < 27 || divider > 54 || !this.referenceAvailable() || !this.fractionalValid();
  }
  /** Reads and writes never advance abstract lock time. */
  tick(ticks = 1): void {
    tickCount(ticks, 'ticks');
    this.ticks = Math.min(Number.MAX_SAFE_INTEGER, this.ticks + ticks);
    if (this.blocked()) {this.locked = false; this.lockElapsed = 0; return;}
    this.lockElapsed = Math.min(this.configuration.lockTicks, this.lockElapsed + ticks);
    if (this.lockElapsed >= this.configuration.lockTicks) this.locked = true;
  }
  reset(): void {
    this.control = PLL_VIDEO_RESET; this.numerator = PLL_VIDEO_NUM_RESET; this.denominator = PLL_VIDEO_DENOM_RESET;
    this.ticks = this.lockElapsed = 0; this.locked = false;
  }
  status(): VideoPllStatus {
    const divider = this.control & B.DIV_SELECT, source = (this.control & B.BYPASS_CLK_SRC) >>> 14;
    const post = (this.control & B.POST_DIV_SELECT) >>> 19;
    const blockingReasons: string[] = [], unsupported: string[] = [];
    if (this.configuration.lockFailure) blockingReasons.push('lock-failure fixture is true');
    if ((this.control & B.POWERDOWN) !== 0) blockingReasons.push('PLL is powered down');
    if (divider < 27 || divider > 54) {
      blockingReasons.push('unsupported loop divider encoding'); unsupported.push('DIV_SELECT outside documented27..54');
    }
    if (source > 1) {
      blockingReasons.push('unsupported reference source encoding'); unsupported.push('BYPASS_CLK_SRC codes2/3 are reserved');
    } else if (!this.referenceAvailable()) blockingReasons.push('selected reference fixture is unavailable');
    if (this.denominator === 0) {
      blockingReasons.push('zero denominator conservatively stalls synthetic lock'); unsupported.push('Zero-denominator silicon response is unspecified');
    } else if (!this.fractionalValid()) {
      blockingReasons.push('fractional numerator magnitude must be less than denominator'); unsupported.push('Fractional parameters are outside the documented bound');
    }
    if (post === 3) unsupported.push('POST_DIV_SELECT code3 has reserved output behavior');
    return {
      ticks: this.ticks, lockElapsed: this.lockElapsed, locked: this.locked,
      poweredDown: (this.control & B.POWERDOWN) !== 0, outputEnabled: (this.control & B.ENABLE) !== 0,
      bypassed: (this.control & B.BYPASS) !== 0, divider, referenceSourceCode: source,
      referenceSource: source === 0 ? 'oscillator24M' : source === 1 ? 'clk1' : 'unsupported',
      referenceAvailable: this.referenceAvailable(), numerator: this.numerator, signedNumerator: this.signedNumerator(),
      denominator: this.denominator, fractionalValid: this.fractionalValid(), postDividerCode: post,
      postDivider: post === 0 ? 4 : post === 1 ? 2 : post === 2 ? 1 : undefined,
      control: this.read(PLL_VIDEO_REG.CONTROL)!, blockingReasons, unsupported,
      configuration: {...this.configuration}, limitations: PLL_VIDEO_LIMITATIONS,
    };
  }
}
