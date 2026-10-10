/**
 * Isolated stock-startup candidate derived from the frozen R13 FlexSPI model.
 * Production flash.ts is unchanged. No device APIs are used.
 * Source contract: analysis/emulator/flexspi_static_20261003 in sp404mk2.
 *
 * Evidence in the adjacent firmware workspace:
 * - sdk/examples/original_r13/{flash.c,FLASH.md,test_flash.py}
 * - sdk/examples/original_r16b/{flash.c,test_flash.py,test_full_flash.py}
 * - analysis/hardware/usb_r11_20260922T190757Z/preflight.json
 * - analysis/flash_research/MIMXRT1062.h (register/LUT definitions)
 *
 * C22016, status40 and the copied SFDP header/BFPT were measured on one SP.
 * The default FCB is a geometry fixture; its remaining bytes are synthesized.
 * Supply a full flash image to retain an actual captured FCB/resident image.
 * Unread SFDP bytes are FF fixture padding, not additional captured evidence.
 * Busy duration is two status polls, with no claim about physical timing.
 * Status writes accept only one byte 40 on the existing measured status40
 * fixture; other protection/configuration requests remain unsupported.
 * RX refill is immediate and bounded to the 128-byte register window;
 * physical FIFO backpressure, read counters and bus timing are unmodeled.
 * NOR status protection behavior outside the known QE/WEL/WIP bits is unmodeled.
 * DMA, quad/fast reads and command chaining remain unsupported.
 */

export const NOR_BYTES = 0x400000;
export const NOR_XIP_BASE = 0x60000000;
// These are the writer's policy bounds, never restrictions on virtual NOR.
export const APP1_START = 0x80000;
export const APP1_END = 0x3ff000;

export interface FlexSpiNorOptions {
  readMemory?: (address: number, length: number) => Uint8Array;
  writeMemory?: (address: number, bytes: Uint8Array) => void;
  flash?: Uint8Array;
  sfdp?: Uint8Array;
}

export interface FlashCommand {
  opcode: number;
  address: number;
  length: number;
  sequence: number;
  error?: string;
  ipcr0?: number;
  ipcr1?: number;
  lutWords?: number[];
}

export interface FlashCommandMetadata {
  index: number;
  ipcr0: number;
  ipcr1: number;
  sequence: number;
  requestedSequenceCount: number;
  lutWords: number[];
  rxWatermarkBytes: number;
  txWatermarkBytes: number;
}

export interface FlashFaults {
  idleStuck: boolean;
  resetStuck: boolean;
  noRx: boolean;
  noWel: boolean;
  busyStuck: boolean;
  commandErrorAt: number;
  corruptPage: boolean;
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

/** Measured portions of the R11 export, surrounded by explicit FF fixtures. */
export function measuredSfdpFixture(): Uint8Array {
  const bytes = new Uint8Array(256).fill(0xff);
  bytes.set(hexBytes('53464450000101ff00000109300000ffc2000104600000ffffffffffffffffff'));
  bytes.set(hexBytes('e520f1ffffffff0144eb086b083b04bbeeffffffffff00ffffff00ff0c200f5210d800ff'), 0x30);
  return bytes;
}

/** Synthetic geometry-only FCB. This does not constitute a bootable resident. */
export function flashGeometryFixture(): Uint8Array {
  const bytes = new Uint8Array(NOR_BYTES).fill(0xff);
  bytes.fill(0, 0, 512);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x42464346, true);
  view.setUint32(0x50, NOR_BYTES, true);
  view.setUint32(0x1c0, 256, true);
  view.setUint32(0x1c4, 4096, true);
  return bytes;
}

const RW_REGISTERS = new Set([
  0x00, 0x04, 0x08, 0x0c, 0x10, 0x14, 0x18, 0x1c,
  0x20, 0x24, 0x28, 0x2c,
  0x60, 0x64, 0x68, 0x6c, 0x70, 0x74, 0x78, 0x7c,
  0x80, 0x84, 0x88, 0x8c, 0x94, 0xa0, 0xa4, 0xb0,
  0xb8, 0xbc, 0xc0, 0xc4,
]);
const RO_REGISTERS = new Set([0xe0, 0xe4, 0xe8, 0xec, 0xf0, 0xf4]);

/** MMIO offsets are relative to FlexSPI1 base 0x402A8000. */
export class FlexSpiNorModel {
  readonly flash: Uint8Array;
  readonly sfdp: Uint8Array;
  readonly fcbSource: 'geometry fixture' | 'caller flash image';
  readonly sfdpSource: 'R11 measured bytes with FF fixture padding' | 'caller SFDP image';
  readonly commandLog: FlashCommand[] = [];
  // Retain raw metadata for the latest 64 commands; no payload bytes.
  readonly commandMetadata: FlashCommandMetadata[] = [];
  readonly commandMetadataLimit = 64;
  commandMetadataOverflow = 0;
  readonly erases: number[] = [];
  readonly pages: number[] = [];
  readonly faults: FlashFaults = {
    idleStuck: false, resetStuck: false, noRx: false, noWel: false,
    busyStuck: false, commandErrorAt: 0, corruptPage: false,
  };
  jedec = Uint8Array.from([0xc2, 0x20, 0x16]);
  statusExtra = 0x40;
  lastError: string | undefined;

  private registers = new Uint32Array(0x300 / 4);
  private lutUnlocked = false;
  private irq = 0;
  private wel = false;
  private busyPolls = 0;
  private rx = new Uint8Array(0);
  private rxPosition = 0;
  private txWindow = new Uint8Array(128);
  private tx = new Uint8Array(0);
  private txPosition = 0;
  private active: FlashCommand | undefined;
  private writeMemory: FlexSpiNorOptions['writeMemory'];

  constructor(options: FlexSpiNorOptions = {}) {
    if (options.flash && options.flash.length !== NOR_BYTES) {
      throw new RangeError('Virtual NOR storage must contain exactly 4 MiB.');
    }
    this.flash = options.flash ?? flashGeometryFixture();
    this.sfdp = options.sfdp ?? measuredSfdpFixture();
    this.fcbSource = options.flash ? 'caller flash image' : 'geometry fixture';
    this.sfdpSource = options.sfdp ? 'caller SFDP image' : 'R11 measured bytes with FF fixture padding';
    this.writeMemory = options.writeMemory;
    // Polled FIFO accesses are stored here; readMemory is available to the board
    // interface but unused until a DMA path is modeled.
    this.reset();
  }

  /** Board reset preserves programmed virtual flash and its supplied image. */
  reset(): void {
    this.registers.fill(0);
    this.registers[0x60 / 4] = NOR_BYTES / 1024;
    this.registers[0x1c / 4] = 1;
    this.lutUnlocked = false;
    this.wel = false;
    this.busyPolls = 0;
    this.lastError = undefined;
    this.clearController();
  }

  read(offset: number, width = 4): number | undefined {
    if (!this.validAccess(offset, width)) return undefined;
    const wordOffset = offset & ~3;
    let value: number;
    if (wordOffset >= 0x100 && wordOffset < 0x180) {
      value = 0;
      const withinWindow = wordOffset - 0x100;
      if (withinWindow < this.rxAvailableBytes()) {
        for (let byte = 0; byte < 4; byte++) {
          value |= (this.rx[this.rxPosition + withinWindow + byte] ?? 0) << (8 * byte);
        }
      }
    } else if (wordOffset >= 0x200 && wordOffset < 0x300) {
      value = this.registers[wordOffset / 4]!;
    } else if (RW_REGISTERS.has(wordOffset)) {
      value = wordOffset === 0x14 ? this.irq : this.registers[wordOffset / 4]!;
    } else if (RO_REGISTERS.has(wordOffset)) {
      if (wordOffset === 0xe0) {
        value = this.faults.idleStuck || this.active ? 0 : 3;
      } else if (wordOffset === 0xf0) {
        value = Math.ceil(this.rxAvailableBytes() / 8);
      } else {
        value = 0;
      }
    } else {
      return undefined;
    }
    return this.extract(value, offset, width);
  }

  write(offset: number, value: number, width = 4): boolean {
    if (!this.validAccess(offset, width)) return false;
    const wordOffset = offset & ~3;
    const mask = width === 4 ? 0xffffffff : (2 ** (8 * width) - 1) << ((offset & 3) * 8);
    const shifted = width === 4 ? value >>> 0 : (value << ((offset & 3) * 8)) & mask;
    const merged = ((this.registers[wordOffset / 4] ?? 0) & ~mask) | shifted;
    if (wordOffset >= 0x180 && wordOffset < 0x200) {
      const windowOffset = offset - 0x180;
      for (let byte = 0; byte < width; byte++) {
        this.txWindow[windowOffset + byte] = value >>> (8 * byte);
      }
      return true;
    }
    if (wordOffset >= 0x200 && wordOffset < 0x300) {
      if (this.lutUnlocked) this.registers[wordOffset / 4] = merged >>> 0;
      return true;
    }
    if (!RW_REGISTERS.has(wordOffset)) return false;
    if (wordOffset === 0x14) {
      this.acknowledge(shifted >>> 0);
    } else if (wordOffset === 0x00) {
      this.registers[0] = merged >>> 0;
      if ((merged & 1) && !this.faults.resetStuck) {
        this.clearController();
        this.registers[0] &= ~1;
      }
    } else if (wordOffset === 0x1c) {
      if (this.registers[0x18 / 4] === 0x5af05af0) {
        if (shifted & 2) this.lutUnlocked = true;
        if (shifted & 1) this.lutUnlocked = false;
        this.registers[0x1c / 4] = this.lutUnlocked ? 2 : 1;
      }
    } else if (wordOffset === 0xb8 || wordOffset === 0xbc) {
      this.registers[wordOffset / 4] = merged & ~1;
      if (shifted & 1) {
        if (wordOffset === 0xb8) {
          this.rx = new Uint8Array(0);
          this.rxPosition = 0;
          this.irq &= ~0x20;
        } else {
          this.txWindow.fill(0);
          this.txPosition = 0;
        }
      }
    } else if (wordOffset === 0xb0) {
      // IPCMD is a trigger, so no command remains pending in this register.
      this.registers[wordOffset / 4] = 0;
      if (shifted & 1) this.startCommand();
    } else {
      this.registers[wordOffset / 4] = merged >>> 0;
      if (wordOffset >= 0x80 && wordOffset <= 0x8c) {
        this.registers[wordOffset / 4] &= 0x7fffffff; // AHB buffer clear self-clears.
      }
    }
    return true;
  }

  private validAccess(offset: number, width: number): boolean {
    return Number.isInteger(offset) && offset >= 0 && offset < 0x300 &&
      (width === 1 || width === 2 || width === 4) &&
      offset % width === 0 && (offset & 3) + width <= 4;
  }

  private extract(value: number, offset: number, width: number): number {
    return width === 4 ? value >>> 0 : (value >>> ((offset & 3) * 8)) & (2 ** (8 * width) - 1);
  }

  private watermark(register: number): number {
    return (((this.registers[register / 4]! >>> 2) & 15) + 1) * 8;
  }

  private clearController(): void {
    this.irq = 0;
    this.active = undefined;
    this.rx = new Uint8Array(0);
    this.rxPosition = 0;
    this.tx = new Uint8Array(0);
    this.txPosition = 0;
    this.txWindow.fill(0);
  }

  private reject(command: FlashCommand, error: string): void {
    command.error = error;
    this.lastError = error;
    this.irq = 1 | 8; // NXP IPCMDERR also generates IPCMDDONE.
    this.active = undefined;
  }

  private startCommand(): void {
    const config = this.registers[0xa4 / 4]!;
    const sequence = (config >>> 16) & 15;
    const base = 0x200 / 4 + sequence * 4;
    const instructions: number[] = [];
    const lutWords: number[] = [];
    for (let word = 0; word < 4; word++) {
      const value = this.registers[base + word]!;
      lutWords.push(value);
      instructions.push(value & 0xffff, value >>> 16);
    }
    const command: FlashCommand = {
      opcode: instructions[0]! & 255,
      address: this.registers[0xa0 / 4]!,
      length: config & 0xffff,
      sequence,
      ipcr0: this.registers[0xa0 / 4]!,
      ipcr1: config,
      lutWords,
    };
    this.commandLog.push(command);
    if (this.commandMetadata.length === this.commandMetadataLimit) {
      const expired = this.commandMetadata.shift()!;
      const oldCommand = this.commandLog[expired.index - 1]!;
      delete oldCommand.ipcr0;
      delete oldCommand.ipcr1;
      delete oldCommand.lutWords;
      this.commandMetadataOverflow++;
    }
    this.commandMetadata.push({
      index: this.commandLog.length,
      ipcr0: command.address,
      ipcr1: config,
      sequence,
      requestedSequenceCount: ((config >>> 24) & 7) + 1,
      lutWords,
      rxWatermarkBytes: this.watermark(0xb8),
      txWatermarkBytes: this.watermark(0xbc),
    });
    this.lastError = undefined;
    if (this.active || (this.registers[0] & 2)) {
      this.reject(command, 'IP command while controller unavailable');
      return;
    }
    this.rx = new Uint8Array(0);
    this.rxPosition = 0;
    this.irq = 0;
    const op = command.opcode;
    const hasAddress = op === 3 || op === 2 || op === 0x20 || op === 0x5a;
    const hasData = op === 1 || op === 2 || op === 3 || op === 5 || op === 0x5a || op === 0x9f;
    const expected = [0x400 | op];
    if (hasAddress) expected.push(0x818);
    if (op === 0x5a) expected.push(0x3008);
    if (hasData) {
      const operand = instructions[expected.length]! & 255;
      // Stock uses operand4 with IDATSZ1; its captured FCB uses operand1.
      if (op === 1 && operand !== 1 && operand !== 4) {
        this.reject(command, 'Unsupported status-write LUT operand');
        return;
      }
      expected.push((op === 1 || op === 2 ? 0x2000 : 0x2400) | (op === 1 ? operand : 4));
      // RT1060RM 27.3.10: a nonzero IDATSZ overrides the LUT operand.
      command.length ||= operand;
    } else if (command.length) {
      // Command-only nonzero IDATSZ is outside this bounded profile.
      this.reject(command, 'Unsupported data size for command-only sequence');
      return;
    }
    while (expected.length < 8) expected.push(0);
    if ((config & 0xfff0_0000) || command.length > 256 ||
      instructions.some((instruction, index) => instruction !== expected[index])) {
      this.reject(command, 'Unsupported LUT sequence or IP transfer size');
      return;
    }
    if (this.faults.commandErrorAt === this.commandLog.length) {
      this.reject(command, 'Injected IP command error');
      return;
    }
    if ((op === 2 || op === 0x20) && (this.statusExtra & ~0x40)) {
      this.reject(command, 'NOR protection bits outside the measured profile are not modeled');
      return;
    }
    const { address, length } = command;
    if (op === 0x9f && length > 0 && length <= this.jedec.length) {
      this.rx = this.jedec.slice(0, length);
    } else if (op === 5 && length === 1) {
      this.rx = Uint8Array.of(this.statusExtra | (this.wel ? 2 : 0) |
        (this.busyPolls || this.faults.busyStuck ? 1 : 0));
      if (this.busyPolls) this.busyPolls--;
    } else if (op === 0x5a && length > 0 && address + length <= this.sfdp.length) {
      this.rx = this.sfdp.slice(address, address + length);
    } else if (op === 3 && length > 0 && address + length <= this.flash.length && !this.busy()) {
      this.rx = this.flash.slice(address, address + length);
    } else if (op === 6 && length === 0 && !this.busy()) {
      this.wel = !this.faults.noWel;
    } else if (op === 0x20 && length === 0 && this.canMutate(address, 4096) && !(address & 4095)) {
      this.flash.fill(0xff, address, address + 4096);
      this.publish(address, 4096);
      this.erases.push(address);
      this.wel = false;
      this.busyPolls = 2;
    } else if (op === 2 && length > 0 && this.canMutate(address, length) &&
      (address & 255) + length <= 256) {
      this.active = command;
      this.tx = new Uint8Array(length);
      this.txPosition = 0;
      this.irq = 0x40;
      return;
    } else if (op === 1 && length === 1 && this.wel && !this.busy() && this.statusExtra === 0x40) {
      this.active = command;
      this.tx = new Uint8Array(1);
      this.txPosition = 0;
      this.irq = 0x40;
      return;
    } else {
      this.reject(command, 'Unsupported NOR command, bounds, alignment or write state');
      return;
    }
    this.irq = 1 | (this.rxAvailableBytes() >= this.watermark(0xb8) ? 0x20 : 0);
  }

  private rxAvailableBytes(): number {
    return this.faults.noRx ? 0 : Math.min(128, this.rx.length - this.rxPosition);
  }

  private busy(): boolean {
    return this.busyPolls !== 0 || this.faults.busyStuck;
  }

  private canMutate(address: number, length: number): boolean {
    return this.wel && !this.busy() &&
      address >= 0 && address + length <= this.flash.length;
  }

  private acknowledge(bits: number): void {
    this.irq &= ~bits;
    if ((bits & 0x20) && this.rxPosition < this.rx.length && !this.faults.noRx) {
      this.rxPosition = Math.min(this.rx.length, this.rxPosition + this.watermark(0xb8));
      if (this.rxAvailableBytes() >= this.watermark(0xb8)) this.irq |= 0x20;
    }
    if ((bits & 0x40) && (this.active?.opcode === 2 || this.active?.opcode === 1)) {
      const command = this.active;
      const count = Math.min(this.watermark(0xbc), this.tx.length - this.txPosition);
      this.tx.set(this.txWindow.subarray(0, count), this.txPosition);
      this.txPosition += count;
      if (this.txPosition < this.tx.length) {
        this.irq |= 0x40;
        return;
      }
      if (command.opcode === 1) {
        if (this.tx[0] !== 0x40) {
          this.reject(command, 'Only the measured status40 write is modeled');
          return;
        }
        // This source-proved startup write retains QE; protection changes
        // and unknown part/configuration behavior remain unsupported.
      } else {
        for (let byte = 0; byte < this.tx.length; byte++) {
          this.flash[command.address + byte]! &= this.tx[byte]!;
        }
        if (this.faults.corruptPage) this.flash[command.address]! ^= 1;
        this.publish(command.address, command.length);
        this.pages.push(command.address);
      }
      this.wel = false;
      this.busyPolls = 2;
      this.active = undefined;
      this.irq |= 1;
    }
  }

  private publish(address: number, length: number): void {
    this.writeMemory?.(NOR_XIP_BASE + address, this.flash.slice(address, address + length));
  }
}

export { FlexSpiNorModel as FlexSPI };
