import {createCPU} from './cpu.ts';
import {SPBoard, type MmioWidth} from './board.ts';
import {loadFirmwareImage, resolveApp1ResetImage, validateApp1ResetContract, APP1_BASE, FLASH_BASE,
  type App1ResetContract, type FirmwareImage, type FirmwareImageOptions} from './image.ts';
import {CortexMExceptions} from './exceptions.ts';
import {captureExceptionReturn, applyPcTransferEffects, type PcTransferPlan} from './exception-return.ts';

type CPU = Awaited<ReturnType<typeof createCPU>>;
type StepResult = ReturnType<CPU['step']>;
export type SessionState = 'loaded' | 'paused' | 'halted' | 'fault' | 'closed';
export interface SessionOptions extends FirmwareImageOptions {
  cpuOptions?: Parameters<typeof createCPU>[1];
  /** Reuse the deterministic R13 MMIO fixture clock for fast regression runs. */
  timerReadTicks?: number;
}

function packet(requestType: number, request: number, value: number, index: number, length: number) {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  bytes[0] = requestType; bytes[1] = request;
  view.setUint16(2, value, true); view.setUint16(4, index, true); view.setUint16(6, length, true);
  return bytes;
}

/** One isolated CPU, board and virtual NOR. No device or network transport. */
export class EmulatorSession {
  image: FirmwareImage;
  readonly board: SPBoard;
  cpu!: CPU;
  state: SessionState = 'loaded';
  private fault: string | undefined;
  private readonly options: SessionOptions;
  private readonly usbLog: Array<{request: number[]; response: number[]}> = [];
  private readonly pendingInterrupts = new Set<number>();
  private usbEnumerated = false;
  private exceptions: CortexMExceptions | undefined;
  private interruptRequested = false;
  private yieldForInterrupt = false;
  private returnTransfer: PcTransferPlan | undefined;
  private readonly lastMailbox = new Uint8Array(80);

  constructor(image: FirmwareImage, options: SessionOptions) {
    this.image = image;
    this.options = options;
    this.board = new SPBoard({timerReadTicks: options.timerReadTicks ?? 24000,
      onPower: powered => {if (!powered) this.cpu?.stop();}, onIrq: (irq, asserted) => {
      if (asserted) this.pendingInterrupts.add(irq);
      else this.pendingInterrupts.delete(irq);
      this.exceptions?.setExternalLine(irq, asserted);
      if (asserted) this.interruptRequested = true;
    }});
  }

  async initialize() {
    this.cpu = await this.makeCPU();
    const flash = this.board.flash.flash;
    flash.set(this.image.bytes, this.image.flashBase - FLASH_BASE);
    this.boot();
  }

  private async makeCPU() {
    const width = (value: number): MmioWidth => {
      if (value !== 1 && value !== 2 && value !== 4) throw new Error(`Unsupported MMIO width: ${value}`);
      return value;
    };
    const cpu = await createCPU({read: (address, size) => this.exceptions?.readMmio(address, size) ?? this.board.read(address, width(size)),
      write: (address, value, size) => {
        if (!this.exceptions?.writeMmio(address, value, size)) this.board.write(address, value, width(size));
      },
      tick: cycles => {
        this.board.tick(cycles);
        if (this.exceptions?.advanceSysTick(cycles)) this.interruptRequested = true;
      },
      setMemoryCallbacks: (read, write) => this.board.setMemoryCallbacks(read, write)}, this.options.cpuOptions);
      this.exceptions = new CortexMExceptions(cpu, {externalInterrupts: 160, priorityBits: 4});
      cpu.onInstruction((address, size) => {
        if (this.interruptRequested) {this.interruptRequested = false; this.yieldForInterrupt = true; cpu.stop(); return;}
        const transfer = captureExceptionReturn(cpu, address, size, this.exceptions?.activeException ?? 0);
        if (transfer) {this.returnTransfer = transfer; cpu.stop(); return;}
        this.exceptions?.beforeInstruction(address, size);
      });
      return cpu;
  }

  private boot() {
    this.cpu.loadMemory(FLASH_BASE, this.board.flash.flash);
    this.cpu.writeRegister('msp', this.image.stack);
    this.cpu.writeRegister('psp', 0x20242800);
    this.cpu.writeRegister('control', 0);
    this.cpu.writeRegister('basepri', 16);
    this.cpu.writeRegister('primask', 0);
    this.cpu.writeRegister('faultmask', 0);
    this.cpu.writeRegister('lr', 4);
    this.cpu.writeRegister('r0', this.image.format === 'app1' ? APP1_BASE | 1 : 0xe000ed0c);
    this.cpu.writeRegister('pc', this.image.entry);
    this.lastMailbox.fill(0);
    this.fault = undefined;
    this.state = 'loaded';
  }

  private capturedReturn(): PcTransferPlan | undefined {return this.returnTransfer;}

  step(instructions = 25000): StepResult {
    if (this.state === 'closed') throw new Error('This emulator session was closed.');
    if (this.state === 'fault') throw new Error(this.fault ?? 'Reset this session after the CPU fault.');
    if (this.state === 'halted') return {instructions: 0, totalInstructions: this.cpu.totalInstructions, pc: this.cpu.readRegister('pc'), reason: 'stopped'};
    if (!Number.isSafeInteger(instructions) || instructions < 1 || instructions > 1000000) throw new Error('Instruction slice must contain 1..1,000,000 instructions.');
    let completed = 0;
    let result: StepResult = {instructions: 0, totalInstructions: this.cpu.totalInstructions, pc: this.cpu.readRegister('pc'), reason: 'budget'};
    try {
      for (let transitions = 0; completed < instructions; transitions++) {
        if (transitions > instructions + 32) throw new Error('Exception transitions made no instruction progress.');
        this.exceptions?.dispatchPending();
        this.yieldForInterrupt = false;
        this.returnTransfer = undefined;
        result = this.cpu.step(instructions - completed);
        if (!result.backendLost) this.exceptions?.afterExecution();
        completed += result.instructions;
        const transfer = this.capturedReturn();
        if (transfer && result.reason === 'stopped' && !result.backendLost) {
          applyPcTransferEffects(this.cpu, transfer);
          this.exceptions!.returnFromException(transfer.target);
          continue;
        }
        if (this.yieldForInterrupt) continue;
        if (result.reason !== 'budget') break;
      }
    } catch (error) {
      result = {...result, reason: 'fault', fault: error instanceof Error ? error.message : String(error)};
    }
    if (result.reason === 'fault') {this.state = 'fault'; this.fault = String(result.fault ?? 'ARM execution stopped on a fault.');}
    else if (!this.board.status().powered) {this.state = 'halted'; result = {...result, reason: 'stopped'};}
    else {this.state = 'paused'; result = {...result, reason: completed === instructions ? 'budget' : result.reason};}
    return {...result, instructions: completed, totalInstructions: this.cpu.totalInstructions, pc: this.cpu.readRegister('pc')};
  }

  pause() {if (this.state !== 'fault' && this.state !== 'closed' && this.state !== 'halted') this.state = 'paused';}

  private assertResetSourceStable(
    current: {image: FirmwareImage; cpu: CPU; nor: Uint8Array},
    captured: {image: FirmwareImage; imageBytes: Uint8Array; nor: Uint8Array},
  ) {
    if (this.state === 'closed' || this.image !== current.image || this.cpu !== current.cpu ||
      this.board.flash.flash !== current.nor || current.nor.length !== captured.nor.length ||
      !current.nor.every((value, index) => value === captured.nor[index]) ||
      !Object.entries(captured.image).every(([key, value]) => current.image[key as keyof FirmwareImage] === value) ||
      current.image.bytes.length !== captured.imageBytes.length ||
      !current.image.bytes.every((value, index) => value === captured.imageBytes[index])) {
      throw new Error('The current session or retained NOR changed during APP1 reset validation.');
    }
  }

  /** Power-cycle volatile state while retaining the session's programmed NOR. */
  async reset(contract?: App1ResetContract) {
    if (this.state === 'closed') throw new Error('This emulator session was closed.');
    let image: FirmwareImage;
    if (contract !== undefined) {
      const request = validateApp1ResetContract(contract);
      if (request.selector === 'b1-del-writer') {
        throw new Error('B1 DEL writer reset is unqualified; whole-target selector execution must be verified first.');
      }
      const currentImage = this.image, currentCpu = this.cpu;
      const retainedNor = this.board.flash.flash;
      const captured = {image: {...currentImage}, imageBytes: currentImage.bytes.slice(), nor: retainedNor.slice()};
      const resolved = await resolveApp1ResetImage(captured.nor, currentImage, request, this.options);
      this.assertResetSourceStable({image: currentImage, cpu: currentCpu, nor: retainedNor}, captured);
      image = resolved.image;
    } else if (this.image.format === 'app1') {
      const bytes = this.board.flash.flash.subarray(APP1_BASE - FLASH_BASE);
      const originalHeader = String.fromCharCode(...bytes.subarray(0x200, 0x208));
      const declaredLength = originalHeader === 'SPUAFW10' || originalHeader === 'SPUAFW20'
        ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(0x20c, true) : this.image.bytes.length;
      image = await loadFirmwareImage(bytes.slice(0, declaredLength), this.options);
    } else image = await loadFirmwareImage(this.board.flash.flash, this.options);
    this.image = image;
    this.cpu.close();
    this.exceptions = undefined;
    this.board.reset();
    this.pendingInterrupts.clear();
    this.interruptRequested = false;
    this.usbEnumerated = false;
    this.cpu = await this.makeCPU();
    this.boot();
  }

  snapshot() {
    const board = this.board.status();
    if (!this.cpu.backendFailed) this.lastMailbox.set(this.cpu.readMemory(0x2023f000, 80));
    const mailbox = this.lastMailbox;
    const words = new DataView(mailbox.buffer, mailbox.byteOffset, mailbox.byteLength);
    const recognized = words.getUint32(0, true) === 0x53503443;
    return {
      state: this.state, pc: this.cpu.readRegister('pc'), instructions: this.cpu.totalInstructions,
      firmwareHash: this.image.sha256, format: this.image.format, checkpoint: this.image.checkpoint,
      marker: recognized ? words.getUint32(76, true) : this.image.marker,
      heartbeat: recognized ? words.getUint32(12, true) : undefined,
      firmwareState: recognized ? words.getUint32(8, true) : undefined,
      frames: board.frameCount, display: Array.from(board.lastFrame), displayOn: board.powered && board.displayOn,
      powered: board.powered, unknownMmio: board.unknownMmio, unknownMmioOverflow: board.unknownMmioOverflow,
      pendingInterrupts: Array.from(this.pendingInterrupts), fault: this.fault,
      cpuBackendFailed: this.cpu.backendFailed, mailboxCached: this.cpu.backendFailed,
      exceptions: this.exceptions?.status(), flash: board.flash,
      limitations: [...this.image.limits, ...board.limitations.slice(1),
        'The default regression clock advances GPT by 24,000 ticks per counter read; this is a fast fixture, not hardware timing.',
        'Integer and eager/lazy floating-point frames are modeled. Fault escalation and complete interrupt timing remain unsupported.',
        'External IRQ count 160 and priority bits 4 are model profile choices; they do not establish the physical configuration.',
        'Instruction counts are emulator work, not measured Cortex-M7 cycles.',
        ...(this.cpu.backendFailed ? ['The ARM engine failed. Mailbox values are from its last healthy snapshot; reset or replace this session.'] : [])],
    };
  }

  private pump<T>(attempt: () => T | null | false, description: string): T {
    for (let budget = 0; budget < 4000000; budget += 25000) {
      const result = attempt();
      if (result !== null && result !== false) return result;
      if ((this.board.usb.read(0x1c0) ?? 0) & 0x00010001) throw new Error(`Virtual USB ${description} was stalled by the firmware.`);
      const step = this.step(25000);
      if (step.reason === 'fault') throw new Error(`USB ${description} stopped: ${this.fault}`);
    }
    throw new Error(`Virtual USB ${description} timed out after 4,000,000 instructions. Inspect the trace and peripheral coverage.`);
  }

  /** The controller DMA supplies tokens; every USB response comes from ARM code. */
  usbControl(requestType: number, request: number, value = 0, index = 0, length = 64, data?: Uint8Array): Uint8Array {
    if (!Number.isInteger(length) || length < 0 || length > 65535) throw new Error('USB control length is invalid.');
    const setup = packet(requestType, request, value, index, length);
    this.pump(() => this.board.usb.hostSetup(setup), 'SETUP');
    const incoming = (requestType & 0x80) !== 0;
    let result = new Uint8Array(0);
    if (incoming && length) {
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (received < length) {
        const chunk = this.pump(() => this.board.usb.hostIn(), 'IN data');
        chunks.push(chunk); received += chunk.length;
        if (chunk.length < 64) break;
      }
      result = new Uint8Array(received);
      let offset = 0; for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.length;}
      this.pump(() => this.board.usb.hostOut(new Uint8Array(0)), 'OUT status');
    } else {
      if (length) {
        if (!data || data.length !== length) throw new Error('USB OUT payload must match its control length.');
        for (let offset = 0; offset < data.length; offset += 64) {
          const chunk = data.slice(offset, offset + 64);
          this.pump(() => this.board.usb.hostOut(chunk), 'OUT data');
        }
      }
      this.pump(() => this.board.usb.hostIn(), 'IN status');
    }
    // Host ACK ends the bus transaction. Let actual firmware consume its
    // completion and have an idle scheduling turn before the next SETUP.
    this.pump(() => ((this.board.usb.read(0x1bc) ?? 0) & 0x00010001) === 0, 'completion service');
    const idle = this.step(25000);
    if (idle.reason === 'fault') throw new Error(`Virtual USB idle service stopped: ${this.fault}`);
    this.usbLog.push({request: Array.from(setup), response: Array.from(result)});
    if (this.usbLog.length > 256) this.usbLog.shift();
    return result;
  }

  usbReport(report?: number[]): Uint8Array {
    if (!this.usbEnumerated) this.enumerateUsb();
    if (report !== undefined) {
      if (report.length !== 64 || report.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
        throw new Error('A USB feature report must contain exactly 64 bytes.');
      }
      this.usbControl(0x21, 9, 0x300, 0, 64, Uint8Array.from(report));
    }
    return this.usbControl(0xa1, 1, 0x300, 0, 64);
  }

  enumerateUsb() {
    const device = this.usbControl(0x80, 6, 0x100, 0, 18);
    if (device.length !== 18 || device[1] !== 1) throw new Error('Firmware returned an invalid USB device descriptor.');
    const config = this.usbControl(0x80, 6, 0x200, 0, 64);
    if (config.length < 9 || config[1] !== 2) throw new Error('Firmware returned an invalid USB configuration descriptor.');
    let featureInterface = false;
    for (let offset = 0; offset + 2 <= config.length && config[offset]! >= 2; offset += config[offset]!) {
      if (config[offset + 1] === 4 && config[offset]! >= 9 && config[offset + 5] === 3 && config[offset + 2] === 0) featureInterface = true;
    }
    if (!featureInterface) throw new Error('This firmware does not expose the modeled interface-0 HID feature-report transport.');
    this.usbControl(0, 5, 7, 0, 0);
    this.usbControl(0, 9, config[5]!, 0, 0);
    this.usbEnumerated = true;
    return {device: Array.from(device), configuration: Array.from(config)};
  }

  setInput(input: Record<string, unknown>) {
    if (typeof input.control === 'string' && typeof input.value === 'number') this.board.setControl(input.control, input.value);
    else if (typeof input.slot === 'number' && typeof input.down === 'boolean') this.board.setMatrix(input.slot, input.down);
    else if (typeof input.slot === 'number' && typeof input.raw === 'number') this.board.setAnalog(input.slot, input.raw);
    else if (input.power === false) this.board.requestPowerOff();
    else throw new Error('Input requires a named control/value, matrix slot/down, analog slot/raw or power-off request.');
  }

  trace() {
    return {schema: 'opensp-emulator-trace-v1', ...this.snapshot(), usb: this.usbLog.map(row => ({...row})),
      flash: {commands: this.board.flash.commandLog.slice(-256), erases: [...this.board.flash.erases], pages: [...this.board.flash.pages]}};
  }

  close() {this.cpu.close(); this.state = 'closed';}
}

export async function createSession(bytes: Uint8Array, options: SessionOptions): Promise<EmulatorSession> {
  const image = await loadFirmwareImage(bytes, options);
  const session = new EmulatorSession(image, options);
  try {await session.initialize(); return session;}
  catch (error) {session.cpu?.close(); throw error;}
}
