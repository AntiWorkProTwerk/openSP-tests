// Isolated GPIO1/2 read candidate; production board.ts stays frozen.
// Pad values retain the existing synthetic fixtures; this adds digital read routing.
import { gpioReadData, gpioReadPadStatus, gpioInputRouteEnabled } from './gpio-read-candidate.ts';
import { Rt1062UsbDevice } from './usb.ts';
import { FlexSpiNorModel } from './flash.ts';
import { Rt1062Oscillator, type OscillatorOptions, type OscillatorStatus } from './oscillator.ts';
import { Rt1062Dcdc, type DcdcOptions, type DcdcStatus } from './dcdc.ts';
import { Rt1062ArmPll, type ArmPllOptions, type ArmPllStatus } from './pll-arm.ts';
import { Rt1062Usb2Pll, type Usb2PllOptions, type Usb2PllStatus } from './pll-usb2.ts';
import { Rt1062VideoPll, type VideoPllOptions, type VideoPllStatus } from './pll-video.ts';
import { Rt1062AudioPll, type AudioPllOptions, type AudioPllStatus } from './pll-audio.ts';
import { USDHCController, USDHC_REG, type USDHCOptions, type USDHCStatus } from './usdhc.ts';

export type MmioWidth = 1 | 2 | 4;
export type ReadMemory = (address: number, length: number) => Uint8Array;
export type WriteMemory = (address: number, bytes: Uint8Array) => void;
export interface AudioRxEvents {
  /** Explicit selected-word event; injection blocks do not imply a frame boundary. */
  wordStart?: boolean;
  /** Explicit external frame-sync error; no serial clock waveform is generated. */
  syncError?: boolean;
  /** Frame boundary used to resume FCONT=0 after overflow recovery. */
  frameStart?: boolean;
}
export type BoardSdOptions = Omit<USDHCOptions, 'instance' | 'onIrq'>;
export interface BoardOptions {
  readMemory?: ReadMemory;
  writeMemory?: WriteMemory;
  onFrame?: (frame: Uint8Array, frameCount: number) => void;
  onIrq?: (irq: number, asserted: boolean) => void;
  onPower?: (powered: boolean) => void;
  cpuHz?: number;
  /** Compatibility option for the existing Python MMIO fixture; zero uses tick(). */
  timerReadTicks?: number;
  /** Startup/power companion fixture. The complete BMC is still unimplemented. */
  autoCompanion?: boolean;
  /** Crystal readiness uses abstract ticks; these settings do not calibrate clocks. */
  oscillator?: OscillatorOptions;
  /** Converter settling and clock availability are explicit synthetic fixtures. */
  dcdc?: DcdcOptions;
  /** ARM PLL reference availability and lock delay are synthetic fixtures. */
  armPll?: ArmPllOptions;
  /** USB2 PLL analog lock uses separate synthetic fixtures; USB1 is unchanged. */
  usb2Pll?: Usb2PllOptions;
  /** VIDEO fractional registers use explicit synthetic reference and lock fixtures. */
  videoPll?: VideoPllOptions;
  /** AUDIO lock is synthetic; these settings do not generate an audio clock. */
  audioPll?: AudioPllOptions;
  /** Owned, read-only SD fixtures. Absent slots leave their MMIO windows unknown. */
  sd1?: BoardSdOptions;
  sd2?: BoardSdOptions;
}
export interface UnknownMmio {
  address: number;
  width: MmioWidth;
  operation: 'read' | 'write';
  count: number;
}
export interface BoardStatus {
  ticks: number;
  frameCount: number;
  lastFrame: Uint8Array;
  displayOn: boolean;
  powered: boolean;
  uartRxBytes: number;
  uartTxBytes: number;
  unknownMmio: UnknownMmio[];
  unknownMmioOverflow: number;
  flash: { lastError?: string; commandCount: number; fcbSource: string; sfdpSource: string };
  oscillator: OscillatorStatus;
  dcdc: DcdcStatus;
  armPll: ArmPllStatus;
  usb2Pll: Usb2PllStatus;
  videoPll: VideoPllStatus;
  audioPll: AudioPllStatus;
  sd1?: USDHCStatus;
  sd2?: USDHCStatus;
  limitations: readonly string[];
}

export const BOARD_EVIDENCE = {
  board: 'sdk/examples/original_r13/board.c',
  input: 'sdk/examples/original_r13/local_input.c',
  controls: 'sdk/examples/original_r13/control_map.c',
  originalFixture: 'sdk/examples/original_r13/test_r13.py',
  audio: 'sdk/examples/original_r15/audio_probe.c',
  audioR14: 'sdk/examples/original_r14/audio_probe.c',
  audioRegisterContract: 'analysis/flash_research/IMXRT1060RM_rev3.pdf, chapter38',
  oscillatorRegisterContract: 'analysis/flash_research/IMXRT1060RM_rev3.pdf, chapter15',
  dcdcRegisterContract: 'analysis/flash_research/IMXRT1060RM_rev3.pdf, chapter18',
  armPllRegisterContract: 'analysis/flash_research/IMXRT1060RM_rev3.pdf, section14.8.1',
  usb2PllRegisterContract: 'analysis/flash_research/IMXRT1060RM_rev3.pdf, section14.8.3',
  videoPllRegisterContract: 'analysis/flash_research/IMXRT1060RM_rev3.pdf, sections14.8.11..14.8.13',
  audioPllRegisterContract: 'analysis/flash_research/IMXRT1060RM_rev3.pdf, sections14.8.8..14.8.10',
  storageRegisterContract: 'analysis/flash_research/IMXRT1060RM_rev3.pdf, chapter26',
  registerDefinitions: 'references/MIMXRT1062.h',
} as const;
export const BOARD_LIMITATIONS = [
  'This model starts at the resident APP1 handoff; ROM, DCD and a cold resident boot are unverified.',
  'GPT uses nominal 24 MHz; instruction ticks do not establish Cortex-M7 cycle timing.',
  'GPIO/ADC inputs are injected values; electrical settling, pressure and mechanical calibration are unmodeled.',
  'ADC calibration and conversion complete immediately; failure injection tests bounded firmware paths.',
  'Crystal readiness/detection uses explicit synthetic ticks; other clock/mux, watchdog and cache controls have no electrical, expiry or cache-coherency simulation.',
  'DCDC settling and clock/power availability are fixed synthetic fixtures; output voltage, supplies, analog protection and oscillator coupling are unmodeled.',
  'ARM/USB2/VIDEO/AUDIO PLL lock and reference availability are fixed synthetic fixtures; physical settling, clock outputs, other PLLs, PFD and CCM handshakes are unmodeled.',
  'UART startup/status/shutdown replies are a bounded companion fixture; complete BMC behavior remains unknown.',
  'SAI RX0 models injected decoded FIFO words/events only; external clocks, frame latency, additional channels, packing, combining, word masking, audio DMA and physical route identity are unimplemented. TX collects writes only.',
  'OLED RAM/window/on-off and GPIO SPI are modeled; contrast, scrolling and analog display behavior are unimplemented.',
  'USB device DMA/control tokens are modeled; PHY, cache timing, host mode and isochronous scheduling are unimplemented.',
  'NOR preflight/IP reads/erase/program are modeled; default FCB fields and unread SFDP bytes are fixtures, and unsupported commands report a model error.',
  'USDHC is routed only for explicit read-only SD fixtures; no guest filesystem, stock storage or physical card power result is established.',
  'Absent SD fixtures, unsupported USDHC registers, ADC_ETC, eDMA and other stock peripherals appear in unknown MMIO.',
] as const;

const GPIO1 = 0x401b8000, GPIO2 = 0x401bc000;
const GPIO_BASES = [GPIO1, GPIO2, 0x401c0000, 0x401c4000, 0x400c0000];
const GPT = 0x401ec000, UART = 0x4018c000, ADC = 0x400c4000;
const SAI = 0x40384000, USB = 0x402e0000, FLEXSPI = 0x402a8000;
const USDHC1 = 0x402c0000, USDHC2 = 0x402c4000, USDHC_WINDOW_BYTES = 0x4000;
const USDHC_WRITE_REGISTERS = new Set<number>(Object.values(USDHC_REG).filter(offset =>
  offset !== USDHC_REG.AUTOCMD12_ERR_STATUS && offset !== USDHC_REG.FORCE_EVENT));
const SAI_RX_FLAGS = 0x001c0000, SAI_RX_CONTROL = 0xf1001f03;
const CS = 1, DC = 2, MOSI = 4, CLK = 8, OLED_RESET = 1024;
const ROW_PINS = [20, 21, 22, 28, 26];
const MATRIX_BUTTONS: Record<string, number> = {
  'VALUE PRESS': 38, 'FILTER+DRIVE': 25, RESONATOR: 20, DELAY: 10,
  ISOLATOR: 5, 'DJFX LOOPER': 15, MFX: 30, 'PATTERN SELECT': 37,
  'PATTERN EDIT': 32, 'RECORD SETTING': 12, DEL: 4, REC: 7,
  RESAMPLE: 2, EXIT: 27, COPY: 22, REMAIN: 17, 'START/END': 31,
  'PITCH/SPEED': 36, MARK: 11, 'BPM SYNC': 33, GATE: 13, LOOP: 26,
  REVERSE: 21, ROLL: 16, 'BANK A/F': 28, 'BANK B/G': 23, 'BANK C/H': 18,
  'BANK D/I': 8, 'BANK E/J': 3, 'BUS FX': 1, HOLD: 6, 'EXT SOURCE': 0,
};
export const CONTROL_NAMES = [
  ...Object.keys(MATRIX_BUTTONS), 'SHIFT',
  ...Array.from({ length: 16 }, (_, i) => `PAD ${i + 1}`),
  'SUB PAD', 'VOLUME', 'CTRL 1', 'CTRL 2', 'CTRL 3', 'VALUE TURN',
] as const;
// Rounded recorded idle levels. These are fixtures, not a calibrated velocity map.
const PAD_SLOTS = [15, 13, 5, 3, 14, 12, 7, 2, 11, 8, 6, 1, 10, 9, 4, 0];
const PAD_IDLE = [4083, 4083, 4081, 4081, 4083, 4083, 4082, 4082, 4082, 4083, 4081, 4081, 4082, 4082, 4082, 4081];
const PAD_LOW = [124, 98, 149, 142, 92, 156, 141, 135, 87, 108, 106, 116, 90, 148, 177, 113];
const STORED_REGISTERS = new Set([
  0x400fc01c, 0x400fc024, 0x400fc068, 0x400fc06c, 0x400fc070, 0x400fc078, 0x400fc07c, 0x400fc080,
  0x400ac014, 0x400ac068, 0x400ac06c,
  0x400d8010, 0x400d8120, 0x400d81b4, 0x400d9030, 0x400d9000,
  0x400b8000, 0x400b8008, 0x400d0000, 0x400d0008,
  0x400bc000, 0x400bc004, 0x400bc008,
  0xe000e010, 0xe000e014, 0xe000e018, 0xe000ed00, 0xe000ed04,
  0xe000ed08, 0xe000ed0c, 0xe000ed10, 0xe000ed14, 0xe000ed24,
  0xe000ed28, 0xe000ed2c, 0xe000ed30, 0xe000ed34, 0xe000ed38,
  0xe000ed88, 0xe000ed90, 0xe000ed94, 0xe000ed98, 0xe000ed9c,
  0xe000eda0, 0xe000eda4, 0xe000eda8, 0xe000edac, 0xe000edb0,
  0xe000ef34, 0xe000ef40, 0xe000ef50, 0xe000ef58, 0xe000ef5c,
  0xe000ef60, 0xe000ef64, 0xe000ef68, 0xe000ef6c, 0xe000ef70, 0xe000ef74,
]);

/** Deterministic peripherals used by original R13/R16B/R48; no firmware helpers. */
export class SPBoard {
  readonly usb: Rt1062UsbDevice;
  readonly flash: FlexSpiNorModel;
  readonly oscillator: Rt1062Oscillator;
  readonly dcdc: Rt1062Dcdc;
  readonly armPll: Rt1062ArmPll;
  readonly usb2Pll: Rt1062Usb2Pll;
  readonly videoPll: Rt1062VideoPll;
  readonly audioPll: Rt1062AudioPll;
  readonly sd1?: USDHCController;
  readonly sd2?: USDHCController;
  readonly faults = {
    timerStuck: false, adcStuck: false, adcCalibrationFail: false,
    adcCalibrationStuck: false, uartTxStuck: false, usbPllStuck: false,
  };
  private options: BoardOptions;
  private readMemoryCallback?: ReadMemory;
  private writeMemoryCallback?: WriteMemory;
  private registers = new Map<number, number>();
  private unknown = new Map<string, UnknownMmio>();
  private unknownOverflow = 0;
  private gpioReadRoutes = [0xfffff00f, 0xffffffff];
  private gpio1 = 0;
  private gpio2 = CS | OLED_RESET;
  private extraGpio = new Map<number, number>();
  private matrix = new Uint8Array(8);
  private analog = new Uint16Array(32);
  private encoder = 0;
  private shift = false;
  private ready = true;
  private ticks = 0;
  private tickFraction = 0;
  private adcReady = false;
  private adcValue = 0;
  private uartRx: number[] = [];
  private uartTx: number[] = [];
  private uartErrors = 0;
  private enabledIrqs = new Uint32Array(8);
  private pendingIrqs = new Uint32Array(8);
  private irqLines = new Set<number>();
  private oledBits = 0;
  private oledByte = 0;
  private oledTransaction: number[] = [];
  private oledCommand = -1;
  private oledArguments: number[] = [];
  private oledArgumentsNeeded = 0;
  private columnStart = 0;
  private columnEnd = 127;
  private pageStart = 0;
  private pageEnd = 7;
  private column = 0;
  private page = 0;
  private memoryMode = 0;
  private frame = new Uint8Array(1024);
  private frames = 0;
  private displayOn = false;
  private powered = true;
  private saiRx: number[] = [];
  private saiReadPointer = 0;
  private saiWritePointer = 0;
  private saiNeedsFrame = false;
  private saiTx: number[] = [];

  constructor(options: BoardOptions = {}) {
    this.options = options;
    this.oscillator = new Rt1062Oscillator(options.oscillator);
    this.dcdc = new Rt1062Dcdc(options.dcdc);
    this.armPll = new Rt1062ArmPll(options.armPll);
    this.usb2Pll = new Rt1062Usb2Pll(options.usb2Pll);
    this.videoPll = new Rt1062VideoPll(options.videoPll);
    this.audioPll = new Rt1062AudioPll(options.audioPll);
    this.sd1 = options.sd1 === undefined ? undefined : new USDHCController({
      ...options.sd1, instance: 1, onIrq: (_irq, asserted) => this.setIrq(110, asserted),
    });
    this.sd2 = options.sd2 === undefined ? undefined : new USDHCController({
      ...options.sd2, instance: 2, onIrq: (_irq, asserted) => this.setIrq(111, asserted),
    });
    this.readMemoryCallback = options.readMemory;
    this.writeMemoryCallback = options.writeMemory;
    const memory = {
      readMemory: (address: number, length: number) => this.memoryRead(address, length),
      writeMemory: (address: number, bytes: Uint8Array) => this.memoryWrite(address, bytes),
    };
    this.usb = new Rt1062UsbDevice({ ...memory, irq: (irq, asserted) => this.setIrq(irq, asserted) });
    this.flash = new FlexSpiNorModel(memory);
    this.reset();
  }

  setMemoryCallbacks(readMemory: ReadMemory, writeMemory: WriteMemory): void {
    this.readMemoryCallback = readMemory;
    this.writeMemoryCallback = writeMemory;
  }

  private memoryRead(address: number, length: number): Uint8Array {
    if (!this.readMemoryCallback) throw new Error('Board memory is not bound to a CPU');
    return this.readMemoryCallback(address, length);
  }
  private memoryWrite(address: number, bytes: Uint8Array): void {
    if (!this.writeMemoryCallback) throw new Error('Board memory is not bound to a CPU');
    this.writeMemoryCallback(address, bytes);
  }

  reset(): void {
    this.registers.clear(); this.unknown.clear(); this.unknownOverflow = 0;
    this.gpio1 = 0; this.gpio2 = CS | OLED_RESET; this.extraGpio.clear();
    // Rev3 mux reset tables: GPIO_AD_B0_04..11 reset ALT0; the other GPIO1/2 pads reset ALT5.
    this.gpioReadRoutes = [0xfffff00f, 0xffffffff];
    for (let pin = 0; pin < 64; pin++)
      this.registers.set(0x401f80bc + pin * 4, pin >= 4 && pin <= 11 ? 0 : 5);
    this.matrix.fill(0); this.analog.fill(4082);
    PAD_SLOTS.forEach((slot, i) => { this.analog[slot] = PAD_IDLE[i]; });
    this.encoder = 0; this.shift = false; this.ready = true;
    this.ticks = 0; this.tickFraction = 0; this.adcReady = false; this.adcValue = 0;
    this.uartRx = []; this.uartTx = []; this.uartErrors = 0;
    // Host-controller reset preserves the owned card's protocol, image and diagnostics.
    this.sd1?.resetController(); this.sd2?.resetController();
    for (const irq of this.irqLines) this.options.onIrq?.(irq, false);
    this.irqLines.clear(); this.enabledIrqs.fill(0); this.pendingIrqs.fill(0);
    this.oledReset(); this.powered = true;
    this.saiRx = []; this.saiTx = []; this.saiReadPointer = 0; this.saiWritePointer = 0; this.saiNeedsFrame = false;
    this.registers.set(0xe000ed00, 0x411fc271);
    this.registers.set(0xe000ed14, 0x30000);
    this.registers.set(0x400bc000, 0x2080);
    // Deliberately unfavorable inherited timer selections, as in the R13 fixture.
    this.registers.set(0x400fc01c, 0x3f);
    this.registers.set(0x400ac014, 0x10000000);
    this.usb.reset(); this.flash.reset(); this.oscillator.reset(); this.dcdc.reset();
    this.armPll.reset();
    this.usb2Pll.reset();
    this.videoPll.reset();
    this.audioPll.reset();
  }

  status(): BoardStatus {
    return { ticks: this.ticks, frameCount: this.frames, lastFrame: this.frame.slice(),
      displayOn: this.displayOn, powered: this.powered,
      uartRxBytes: this.uartRx.length, uartTxBytes: this.uartTx.length,
      unknownMmio: [...this.unknown.values()].map(record => ({ ...record })),
      unknownMmioOverflow: this.unknownOverflow,
      flash: { lastError: this.flash.lastError, commandCount: this.flash.commandLog.length,
        fcbSource: this.flash.fcbSource, sfdpSource: this.flash.sfdpSource },
      oscillator: this.oscillator.status(),
      dcdc: this.dcdc.status(),
      armPll: this.armPll.status(),
      usb2Pll: this.usb2Pll.status(),
      videoPll: this.videoPll.status(),
      audioPll: this.audioPll.status(),
      sd1: this.sd1?.status(), sd2: this.sd2?.status(),
      limitations: BOARD_LIMITATIONS };
  }

  /** Tick units must be configured with cpuHz; default assumes 600 MHz. */
  tick(cycles: number): void {
    if (!Number.isSafeInteger(cycles) || cycles < 0) throw new RangeError('Tick count must be a nonnegative integer');
    // Clock and converter startup advance independently of GPT timer fixtures.
    for (let left = cycles; left > 0; left -= Math.min(left, 0xffffffff)) {
      const chunk = Math.min(left, 0xffffffff);
      this.oscillator.tick(chunk); this.dcdc.tick(chunk); this.armPll.tick(chunk); this.usb2Pll.tick(chunk); this.videoPll.tick(chunk);
      this.audioPll.tick(chunk);
    }
    if (cycles === 0) { this.oscillator.tick(0); this.dcdc.tick(0); this.armPll.tick(0); this.usb2Pll.tick(0); this.videoPll.tick(0); }
    if (cycles === 0) this.audioPll.tick(0);
    // Nominal SD scheduler turns advance even when GPT is disabled or stalled.
    this.sd1?.tick(cycles); this.sd2?.tick(cycles);
    if (!this.timerRunning() || this.faults.timerStuck || this.options.timerReadTicks) return;
    this.tickFraction += cycles * 24000000 / (this.options.cpuHz ?? 600000000) / (((this.registers.get(GPT + 4) ?? 0) & 0xfff) + 1);
    const whole = Math.floor(this.tickFraction);
    this.tickFraction -= whole;
    this.ticks = (this.ticks + whole) >>> 0;
  }

  private timerRunning(): boolean {
    const cr = this.registers.get(GPT) ?? 0;
    return !!(cr & 1) && ((cr >>> 6) & 7) === 2 &&
      ((this.registers.get(0x400fc01c) ?? 0) & 0x7f) === 0x40 &&
      !((this.registers.get(0x400ac014) ?? 0) & 0x10000000);
  }

  setMatrix(slot: number, down: boolean): void {
    this.checkSlot(slot, 40);
    const col = Math.floor(slot / 5), row = slot % 5, mask = 1 << row;
    this.matrix[col] = down ? this.matrix[col] | mask : this.matrix[col] & ~mask;
  }
  setAnalog(slot: number, raw: number): void {
    this.checkSlot(slot, 32);
    if (!Number.isInteger(raw) || raw < 0 || raw > 4095) throw new RangeError('ADC value must be 0..4095');
    this.analog[slot] = raw;
  }
  setEncoderState(raw: number): void {
    if (!Number.isInteger(raw) || raw < 0 || raw > 3) throw new RangeError('Encoder state must be 0..3');
    this.encoder = raw;
  }
  setReadyPin(high: boolean): void { this.ready = high; }
  /** Named controls inject the captured GPIO/ADC/UART path before firmware decoding. */
  setControl(name: string, value: number): void {
    const label = name.trim().toUpperCase();
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Control value must be 0..1');
    if (label in MATRIX_BUTTONS) {
      if (label === 'DEL') for (let col = 0; col < 8; col++) this.setMatrix(col * 5 + 4, !!value);
      else this.setMatrix(MATRIX_BUTTONS[label], !!value);
      return;
    }
    if (label === 'SHIFT') {
      if (this.shift !== !!value) { this.shift = !!value; this.injectUart([1, 255, 255, this.shift ? 1 : 0]); }
      return;
    }
    // Normalized selection of a raw two-bit phase; this does not generate detents.
    if (label === 'VALUE TURN') { this.setEncoderState(Math.round(value * 3)); return; }
    const pad = /^PAD (\d+)$/.exec(label);
    if (pad && +pad[1] >= 1 && +pad[1] <= 16) {
      const i = +pad[1] - 1;
      this.setAnalog(PAD_SLOTS[i], Math.round(PAD_IDLE[i] - value * (PAD_IDLE[i] - PAD_LOW[i])));
      return;
    }
    if (label === 'SUB PAD') { this.setAnalog(20, Math.round(4082 - value * 4005)); return; }
    const knob = label === 'VOLUME' ? 16 : ({ 'CTRL 1': 17, 'CTRL 2': 18, 'CTRL 3': 19 } as Record<string, number>)[label];
    if (knob !== undefined) { this.setAnalog(knob, Math.round((1 - value) * 4082)); return; }
    throw new Error(`Unmapped control: ${name}`);
  }
  private checkSlot(slot: number, limit: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= limit) throw new RangeError(`Slot must be 0..${limit - 1}`);
  }

  injectUart(bytes: ArrayLike<number>, errorMask = 0): void {
    for (let i = 0; i < bytes.length; i++) {
      if (this.uartRx.length >= 4096) { this.uartErrors |= 0x80000; break; }
      this.uartRx.push(bytes[i] & 255);
    }
    this.uartErrors |= errorMask & 0x000f0000;
    this.updateUartIrq();
  }
  requestPowerOff(): void { this.injectUart([1, 255, 0, 1]); }
  takeUartTx(): Uint8Array { const bytes = Uint8Array.from(this.uartTx); this.uartTx = []; return bytes; }
  /** Completed RX0 words, not a sample-rate source. Returns the accepted count. */
  injectAudioRx(words: ArrayLike<number>, events: AudioRxEvents = {}): number {
    const control = this.registers.get(SAI + 0x88) ?? 0;
    const channel = this.registers.get(SAI + 0x94) ?? 0;
    const configuration = this.registers.get(SAI + 0x98) ?? 0;
    if (!(control & 0x80000000) || !(control & 0x10000000) || control & 0x01000000 ||
        !(channel & 0x10000) || channel & 0xe0000 || configuration & 0x0f000000 ||
        (this.registers.get(SAI + 0xe0) ?? 0)) return 0;
    let flags = control & SAI_RX_FLAGS;
    if (events.wordStart) flags |= 0x100000;
    if (events.syncError) flags |= 0x80000;
    if (events.frameStart && !(flags & 0x40000)) this.saiNeedsFrame = false;
    const continueOnError = !!(configuration & 0x10000000);
    let accepted = 0;
    this.registers.set(SAI + 0x88, (control & ~SAI_RX_FLAGS) | flags);
    if (!continueOnError && ((flags & 0x40000) || this.saiNeedsFrame)) { this.updateSaiIrq(); return 0; }
    for (let i = 0; i < words.length; i++) {
      if (this.saiRx.length >= 32) {
        this.registers.set(SAI + 0x88, (this.registers.get(SAI + 0x88) ?? 0) | 0x40000);
        if (!continueOnError) this.saiNeedsFrame = true;
        break;
      }
      this.saiRx.push(words[i] >>> 0); this.saiWritePointer = (this.saiWritePointer + 1) & 63;
      accepted++;
    }
    this.updateSaiIrq();
    return accepted;
  }
  takeAudioTx(): Uint32Array { const words = Uint32Array.from(this.saiTx); this.saiTx = []; return words; }

  private saiReceiveStatus(): number {
    const control = this.registers.get(SAI + 0x88) ?? 0;
    if (!((this.registers.get(SAI + 0x94) ?? 0) & 0x10000) || control & 0x01000000) return control;
    const watermark = (this.registers.get(SAI + 0x8c) ?? 0) & 31;
    return (control | (this.saiRx.length > watermark ? 0x10000 : 0) | (this.saiRx.length === 32 ? 0x20000 : 0)) >>> 0;
  }
  private updateSaiIrq(): void {
    const status = this.saiReceiveStatus();
    this.setIrq(56, !!(status & ((status & 0x1f00) << 8)));
  }

  read(address: number, width: MmioWidth = 4): number | undefined {
    this.checkAccess(address, width);
    if (this.oscillator.handles(address, width)) return this.oscillator.read(address, width);
    if (this.dcdc.handles(address, width)) return this.dcdc.read(address, width);
    if (this.armPll.handles(address, width)) return this.armPll.read(address, width);
    if (this.usb2Pll.handles(address, width)) return this.usb2Pll.read(address, width);
    if (this.videoPll.handles(address, width)) return this.videoPll.read(address, width);
    if (this.audioPll.handles(address, width)) return this.audioPll.read(address, width);
    const sd = this.sdController(address);
    if (sd) {
      // The component already applies the requested byte lane; do not shift again.
      const value = sd.read(address - sd.baseAddress, width);
      if (value === undefined) this.unknownAccess(address, width, 'read');
      return value;
    }
    const aligned = (address & ~3) >>> 0;
    let word: number | undefined;
    if (aligned >= USB && aligned < USB + 0x200) return this.readPeripheral(this.usb.read(aligned - USB, 4), address, width);
    if (aligned >= FLEXSPI && aligned < FLEXSPI + 0x400) return this.readPeripheral(this.flash.read(aligned - FLEXSPI, 4), address, width);
    if (aligned === GPIO1 || aligned === GPIO2) {
      const bank = aligned === GPIO1 ? 0 : 1;
      const samples = bank === 0 ? (this.gpio1 & ~1) | (this.ready ? 1 : 0) : this.matrixPins();
      word = gpioReadData(bank === 0 ? this.gpio1 : this.gpio2,
        this.registers.get(aligned + 4) ?? 0, samples, this.gpioReadRoutes[bank]);
    } else if (aligned === GPIO1 + 8)
      word = gpioReadPadStatus((this.gpio1 & ~1) | (this.ready ? 1 : 0), this.gpioReadRoutes[0]);
    else if (aligned === GPIO2 + 8) word = gpioReadPadStatus(this.matrixPins(), this.gpioReadRoutes[1]);
    else if (GPIO_BASES.slice(2).includes(aligned)) word = this.extraGpio.get(aligned) ?? 0;
    else if (GPIO_BASES.slice(2).some(base => aligned === base + 8)) {
      const base = aligned - 8;
      // Only driven output levels are supplied; unmeasured external inputs are zero fixtures.
      word = (this.extraGpio.get(base) ?? 0) & (this.registers.get(base + 4) ?? 0);
    }
    else if (aligned === GPT + 0x24) {
      if (this.timerRunning() && !this.faults.timerStuck && this.options.timerReadTicks)
        this.ticks = (this.ticks + this.options.timerReadTicks) >>> 0;
      word = this.ticks;
    } else if (aligned === GPT && (this.registers.get(GPT) ?? 0) & 0x8000) { this.registers.set(GPT, 0); word = 0; }
    else if (aligned === UART + 0x14) word = (this.faults.uartTxStuck ? 0 : 0xc00000) | (this.uartRx.length ? 0x200000 : 0) | this.uartErrors;
    else if (aligned === UART + 0x1c) { word = this.uartRx.shift() ?? 0; this.updateUartIrq(); }
    else if (aligned === ADC + 0x20) word = this.adcReady && !this.faults.adcStuck ? 1 : 0;
    else if (aligned === ADC + 0x24) { word = this.adcValue; this.adcReady = false; }
    else if (aligned === ADC + 0x48 && (this.registers.get(aligned) ?? 0) & 0x80) {
      if (!this.faults.adcCalibrationStuck) {
        this.registers.set(aligned, 1);
        this.registers.set(ADC + 0x4c, this.faults.adcCalibrationFail ? 2 : 0);
        this.adcReady = !this.faults.adcCalibrationFail; this.adcValue = 0;
      }
      word = this.registers.get(aligned) ?? 0;
    } else if (aligned === 0x400d8010) word = ((this.registers.get(aligned) ?? 0) & ~0x80000000) | (this.faults.usbPllStuck ? 0 : 0x80000000);
    else if (aligned === SAI + 0x88) word = this.saiReceiveStatus();
    else if (aligned === SAI + 0xc0) word = this.saiReadPointer | (this.saiWritePointer << 16);
    else if (aligned === SAI + 0xa0) {
      // Empty-read data is an explicit zero fixture; hardware specifies no valid data.
      word = this.saiRx.shift() ?? 0;
      if (this.saiReadPointer !== this.saiWritePointer) this.saiReadPointer = (this.saiReadPointer + 1) & 63;
      this.updateSaiIrq();
    }
    else if (aligned >= 0xe000e100 && aligned < 0xe000e120) word = this.enabledIrqs[(aligned - 0xe000e100) / 4];
    else if (aligned >= 0xe000e180 && aligned < 0xe000e1a0) word = this.enabledIrqs[(aligned - 0xe000e180) / 4];
    else if (aligned >= 0xe000e200 && aligned < 0xe000e220) word = this.pendingIrqs[(aligned - 0xe000e200) / 4];
    else if (aligned >= 0xe000e280 && aligned < 0xe000e2a0) word = this.pendingIrqs[(aligned - 0xe000e280) / 4];
    else if (this.isStored(aligned)) word = this.registers.get(aligned) ?? 0;
    return this.readPeripheral(word, address, width);
  }

  private readPeripheral(word: number | undefined, address: number, width: MmioWidth): number | undefined {
    if (word === undefined) { this.unknownAccess(address, width, 'read'); return undefined; }
    const shift = (address & 3) * 8;
    return width === 4 ? word >>> 0 : (word >>> shift) & (width === 1 ? 255 : 65535);
  }

  write(address: number, value: number, width: MmioWidth = 4): void {
    this.checkAccess(address, width);
    if (this.oscillator.write(address, value, width)) return;
    if (this.dcdc.write(address, value, width)) return;
    if (this.armPll.write(address, value, width)) return;
    if (this.usb2Pll.write(address, value, width)) return;
    if (this.videoPll.write(address, value, width)) return;
    if (this.audioPll.write(address, value, width)) return;
    const sd = this.sdController(address);
    if (sd) {
      const offset = address - sd.baseAddress, register = offset & ~3;
      // Never probe with read(): reading DATA_PORT consumes data.
      sd.write(offset, value, width);
      if (!USDHC_WRITE_REGISTERS.has(register) ||
        (width !== 4 && (register === USDHC_REG.DATA_PORT || register === USDHC_REG.CMD_XFR_TYP)))
        this.unknownAccess(address, width, 'write');
      return;
    }
    const aligned = (address & ~3) >>> 0, shift = (address & 3) * 8;
    const mask = width === 4 ? 0xffffffff : (width === 1 ? 255 : 65535) << shift;
    const raw = width === 4 ? value >>> 0 : (value << shift) >>> 0;
    const merged = (((this.registers.get(aligned) ?? 0) & ~mask) | (raw & mask)) >>> 0;
    if (aligned >= USB && aligned < USB + 0x200) {
      if (!this.usb.write(address - USB, value, width)) this.unknownAccess(address, width, 'write');
      return;
    }
    if (aligned >= FLEXSPI && aligned < FLEXSPI + 0x400) {
      if (!this.flash.write(address - FLEXSPI, value, width)) this.unknownAccess(address, width, 'write');
      return;
    }
    if (aligned === SAI + 0xa0 || aligned === SAI + 0xc0) return; // RX data/pointers are read-only.
    if ([GPIO1, GPIO1 + 0x84, GPIO1 + 0x88, GPIO1 + 0x8c].includes(aligned)) {
      this.gpio1 = this.gpioValue(this.gpio1, aligned - GPIO1, aligned === GPIO1 ? (this.gpio1 & ~mask) | (raw & mask) : raw & mask); return;
    }
    if ([GPIO2, GPIO2 + 0x84, GPIO2 + 0x88, GPIO2 + 0x8c].includes(aligned)) {
      const old = this.gpio2;
      this.gpio2 = this.gpioValue(old, aligned - GPIO2, aligned === GPIO2 ? (old & ~mask) | (raw & mask) : raw & mask);
      this.oledPins(old, this.gpio2); return;
    }
    const extraGpioBase = GPIO_BASES.slice(2).find(base => [base, base + 0x84, base + 0x88, base + 0x8c].includes(aligned));
    if (extraGpioBase !== undefined) {
      const old = this.extraGpio.get(extraGpioBase) ?? 0;
      this.extraGpio.set(extraGpioBase, this.gpioValue(old, aligned - extraGpioBase,
        aligned === extraGpioBase ? (old & ~mask) | (raw & mask) : raw & mask));
      return;
    }
    if (GPIO_BASES.some(base => aligned === base + 0x18)) {
      this.registers.set(aligned, (this.registers.get(aligned) ?? 0) & ~raw); return;
    }
    if (aligned >= 0xe000e100 && aligned < 0xe000e120) { this.enabledIrqs[(aligned - 0xe000e100) / 4] |= raw; return; }
    if (aligned >= 0xe000e180 && aligned < 0xe000e1a0) { this.enabledIrqs[(aligned - 0xe000e180) / 4] &= ~raw; return; }
    if (aligned >= 0xe000e200 && aligned < 0xe000e220) { this.pendingIrqs[(aligned - 0xe000e200) / 4] |= raw; return; }
    if (aligned >= 0xe000e280 && aligned < 0xe000e2a0) { this.pendingIrqs[(aligned - 0xe000e280) / 4] &= ~raw; return; }
    if (!this.isStored(aligned)) { this.unknownAccess(address, width, 'write'); return; }
    if (aligned === UART + 0x14) { this.uartErrors &= ~raw; this.updateUartIrq(); return; }
    if (aligned === UART + 0x1c) {
      const byte = value & 255;
      if (this.uartTx.length < 4096) this.uartTx.push(byte);
      this.companionPacket(); return;
    }
    if (aligned === UART + 8 && raw & 2) { this.uartRx = []; this.uartErrors = 0; }
    if (aligned === UART + 0x28 && raw & 0x4000) { this.uartRx = []; this.updateUartIrq(); }
    if (aligned === ADC + 0x4c) { this.registers.set(aligned, (this.registers.get(aligned) ?? 0) & ~raw); return; }
    if (aligned === ADC) {
      const channel = merged & 31;
      const bank = [4, 5, 6, 3].indexOf(channel);
      this.adcReady = bank >= 0;
      if (bank >= 0) {
        const col = ((this.gpio2 >>> 27) & 1) | ((this.gpio2 >>> 29) & 6);
        this.adcValue = this.analog[bank * 8 + col];
      }
    }
    if (aligned === ADC + 0x48 && raw & 0x80) this.registers.set(ADC + 0x4c, 0);
    if (aligned === GPT && (merged & 1) && !((this.registers.get(GPT) ?? 0) & 1) && merged & 2) { this.ticks = 0; this.tickFraction = 0; }
    if (aligned === GPT + 8) { this.registers.set(aligned, (this.registers.get(aligned) ?? 0) & ~raw); return; }
    if (aligned === SAI + 0x88) {
      const written = raw & mask;
      if (written & 3) this.unknownAccess(address, width, 'write'); // DMA requests have no backend.
      let flags = (this.registers.get(aligned) ?? 0) & SAI_RX_FLAGS & ~written;
      let control = merged & SAI_RX_CONTROL;
      if (control & 0x80000000) control |= 0x10000000; // RE automatically sets BCE.
      if (control & 0x01000000) {
        this.saiRx = []; this.saiReadPointer = 0; this.saiWritePointer = 0; this.saiNeedsFrame = false; flags = 0;
      } else if (written & 0x02000000) {
        // RX FR empties the FIFO at its current phase; sticky errors survive.
        this.saiRx = []; this.saiReadPointer = this.saiWritePointer;
      }
      this.registers.set(aligned, (control | flags) >>> 0); this.updateSaiIrq(); return;
    }
    if (aligned === SAI + 0x8c) { this.registers.set(aligned, merged & 31); this.updateSaiIrq(); return; }
    if (aligned === SAI + 0x94) {
      // Additional channels and individual CFR resets are outside the RX0 contract.
      if ((raw & mask) & 0x0f0e0000) this.unknownAccess(address, width, 'write');
      this.registers.set(aligned, merged & 0x000f001f); this.updateSaiIrq(); return;
    }
    if ((aligned === SAI + 0x98 && merged & 0x0f000000) || (aligned === SAI + 0xe0 && merged))
      this.unknownAccess(address, width, 'write');
    if (aligned === SAI + 0x20) { if (this.saiTx.length < 65536) this.saiTx.push(value >>> 0); return; }
    if (aligned === 0xe000ed08) { this.registers.set(aligned, merged & 0xffffff80); return; }
    if (aligned === 0xe000ed0c && (raw & 0xffff0000) !== 0x05fa0000) return;
    this.registers.set(aligned, merged);
    this.updateGpioReadRoutes(aligned);
    if (aligned === UART + 0x18) this.updateUartIrq();
  }

  private updateGpioReadRoutes(address: number): void {
    const bank = address === 0x400ac068 ? 0 : address === 0x400ac06c ? 1
      : address >= 0x401f80bc && address <= 0x401f8138 ? 0
      : address >= 0x401f813c && address <= 0x401f81b8 ? 1 : -1;
    if (bank < 0) return;
    const muxBase = bank === 0 ? 0x401f80bc : 0x401f813c;
    const highSpeed = this.registers.get(0x400ac068 + bank * 4) ?? 0;
    let routes = 0;
    for (let pin = 0; pin < 32; pin++) {
      if (gpioInputRouteEnabled(this.registers.get(muxBase + pin * 4) ?? 0, !!(highSpeed & (1 << pin))))
        routes |= 1 << pin;
    }
    this.gpioReadRoutes[bank] = routes >>> 0;
  }

  private gpioValue(old: number, offset: number, value: number): number {
    return (offset === 0x84 ? old | value : offset === 0x88 ? old & ~value : offset === 0x8c ? old ^ value : value) >>> 0;
  }
  private sdController(address: number): USDHCController | undefined {
    if (address >= USDHC1 && address < USDHC1 + USDHC_WINDOW_BYTES) return this.sd1;
    if (address >= USDHC2 && address < USDHC2 + USDHC_WINDOW_BYTES) return this.sd2;
    return undefined;
  }
  private matrixPins(): number {
    const col = (this.gpio2 >>> 23) & 7;
    let value = (this.gpio2 & ~(3 << 18)) | (this.encoder << 18);
    ROW_PINS.forEach((pin, row) => { value = this.matrix[col] & (1 << row) ? value & ~(1 << pin) : value | (1 << pin); });
    return value >>> 0;
  }
  private isStored(address: number): boolean {
    return STORED_REGISTERS.has(address) ||
      // NXP GPIO_Type: direction, interrupt configuration/mask/status and edge selection.
      GPIO_BASES.some(base => [4, 0xc, 0x10, 0x14, 0x18, 0x1c].includes(address - base)) ||
      // Pin mux/pad/daisy values are retained; their electrical effects are outside this model.
      (address >= 0x401f80bc && address <= 0x401f85a4 && !(address & 3)) ||
      [0x401f85e8, 0x401f85ec].includes(address) ||
      (address >= 0xe000e400 && address < 0xe000e500) ||
      [GPIO1 + 4, GPIO2 + 4, GPT, GPT + 4, GPT + 8, GPT + 0xc,
        UART + 8, UART + 0x10, UART + 0x14, UART + 0x18, UART + 0x1c, UART + 0x28, UART + 0x2c,
        ADC, ADC + 4, ADC + 8, ADC + 12, ADC + 16, ADC + 20, ADC + 24, ADC + 28,
        ADC + 0x20, ADC + 0x24, ADC + 0x44, ADC + 0x48, ADC + 0x4c,
        SAI + 8, SAI + 0xc, SAI + 0x10, SAI + 0x14, SAI + 0x18, SAI + 0x1c, SAI + 0x20,
        SAI + 0x88, SAI + 0x8c, SAI + 0x90, SAI + 0x94, SAI + 0x98, SAI + 0x9c, SAI + 0xe0].includes(address);
  }
  private checkAccess(address: number, width: MmioWidth): void {
    if (![1, 2, 4].includes(width) || !Number.isInteger(address) || address < 0 || address > 0xffffffff || address % width)
      throw new RangeError('MMIO access must be aligned and 1, 2 or 4 bytes');
  }
  private unknownAccess(address: number, width: MmioWidth, operation: 'read' | 'write'): void {
    const key = `${operation}:${address}:${width}`;
    const previous = this.unknown.get(key);
    if (previous) previous.count++;
    else if (this.unknown.size < 4096) this.unknown.set(key, { address, width, operation, count: 1 });
    else this.unknownOverflow++;
  }
  private setIrq(irq: number, asserted: boolean): void {
    const index = irq >>> 5, mask = 1 << (irq & 31);
    if (asserted) { this.irqLines.add(irq); this.pendingIrqs[index] |= mask; }
    else this.irqLines.delete(irq);
    this.options.onIrq?.(irq, asserted);
  }
  private updateUartIrq(): void {
    const ctrl = this.registers.get(UART + 0x18) ?? 0;
    this.setIrq(22, !!((ctrl & 0x200000 && this.uartRx.length) || (ctrl & 0x0f000000 && this.uartErrors)));
  }
  private companionPacket(): void {
    if (this.options.autoCompanion === false || this.uartTx.length < 4 || this.uartTx.length % 4) return;
    const p = this.uartTx.slice(-4);
    if (p[0] !== 1 || p[1] !== 255 || p[2] !== 0) return;
    if (p[3] === 1) this.injectUart([1, 255, 0, 16]);
    else if (p[3] === 0) { this.powered = false; this.options.onPower?.(false); }
  }

  private oledReset(): void {
    this.oledBits = 0; this.oledByte = 0; this.oledTransaction = [];
    this.oledCommand = -1; this.oledArguments = []; this.oledArgumentsNeeded = 0;
    this.columnStart = 0; this.columnEnd = 127; this.pageStart = 0; this.pageEnd = 7;
    this.column = 0; this.page = 0; this.memoryMode = 0;
    this.frame.fill(0); this.frames = 0; this.displayOn = false;
  }
  private oledPins(old: number, next: number): void {
    if ((old & OLED_RESET) && !(next & OLED_RESET)) this.oledReset();
    if ((old & CS) && !(next & CS)) { this.oledBits = 0; this.oledByte = 0; this.oledTransaction = []; }
    if (!(next & CS) && !(old & CLK) && next & CLK && next & OLED_RESET) {
      this.oledByte = (this.oledByte << 1) | (next & MOSI ? 1 : 0);
      if (++this.oledBits === 8) {
        const byte = this.oledByte & 255; this.oledBits = 0; this.oledByte = 0;
        this.oledTransaction.push(byte);
        if (next & DC) this.oledData(byte); else this.oledInstruction(byte);
      }
    }
    if (!(old & CS) && next & CS && old & DC && this.oledTransaction.length) {
      this.frames++; this.options.onFrame?.(this.frame.slice(), this.frames);
    }
  }
  private oledData(byte: number): void {
    this.frame[this.page * 128 + this.column] = byte;
    if (this.memoryMode === 1) {
      if (++this.page > this.pageEnd) { this.page = this.pageStart; if (++this.column > this.columnEnd) this.column = this.columnStart; }
    } else if (++this.column > this.columnEnd) {
      this.column = this.columnStart;
      if (this.memoryMode !== 2 && ++this.page > this.pageEnd) this.page = this.pageStart;
    }
  }
  private oledInstruction(byte: number): void {
    if (this.oledArgumentsNeeded) {
      this.oledArguments.push(byte);
      if (this.oledArguments.length === this.oledArgumentsNeeded) {
        const a = this.oledArguments;
        if (this.oledCommand === 0x20) this.memoryMode = a[0] & 3;
        if (this.oledCommand === 0x21) { this.columnStart = a[0] & 127; this.columnEnd = Math.max(this.columnStart, a[1] & 127); this.column = this.columnStart; }
        if (this.oledCommand === 0x22) { this.pageStart = a[0] & 7; this.pageEnd = Math.max(this.pageStart, a[1] & 7); this.page = this.pageStart; }
        this.oledArgumentsNeeded = 0; this.oledArguments = [];
      }
      return;
    }
    if (byte === 0xae || byte === 0xaf) this.displayOn = byte === 0xaf;
    else if (byte >= 0xb0 && byte <= 0xb7) this.page = byte & 7;
    else if (byte <= 0xf) this.column = (this.column & 0x70) | byte;
    else if (byte >= 0x10 && byte <= 0x1f) this.column = ((byte & 7) << 4) | (this.column & 15);
    const count = byte === 0x21 || byte === 0x22 ? 2 : [0xfd, 0xd5, 0xa8, 0xd3, 0x20, 0xda, 0x81, 0xd9, 0xdb, 0xa3, 0xad].includes(byte) ? 1 : 0;
    if (count) { this.oledCommand = byte; this.oledArgumentsNeeded = count; this.oledArguments = []; }
  }
}
