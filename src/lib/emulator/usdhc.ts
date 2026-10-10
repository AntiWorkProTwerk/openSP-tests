/** RT1062 USDHC register subset with an owned, read-only virtual SDSC card.
 * See docs/emulator-usdhc-contract.md for primary sources and fixture scope.
 */
export const USDHC_REG = Object.freeze({
  DS_ADDR: 0x00, BLK_ATT: 0x04, CMD_ARG: 0x08, CMD_XFR_TYP: 0x0c,
  CMD_RSP0: 0x10, CMD_RSP1: 0x14, CMD_RSP2: 0x18, CMD_RSP3: 0x1c,
  DATA_PORT: 0x20, PRES_STATE: 0x24, PROT_CTRL: 0x28, SYS_CTRL: 0x2c,
  INT_STATUS: 0x30, INT_STATUS_EN: 0x34, INT_SIGNAL_EN: 0x38,
  AUTOCMD12_ERR_STATUS: 0x3c, HOST_CTRL_CAP: 0x40, WTMK_LVL: 0x44,
  MIX_CTRL: 0x48, FORCE_EVENT: 0x50, ADMA_ERR_STATUS: 0x54,
  ADMA_SYS_ADDR: 0x58, VEND_SPEC: 0xc0,
});
export const USDHC_INT = Object.freeze({
  CC: 1, TC: 2, BGE: 4, DINT: 8, BWR: 0x10, BRR: 0x20,
  CINS: 0x40, CRM: 0x80, CINT: 0x100, ERR: 0x8000,
  CTOE: 0x10000, CCE: 0x20000, CEBE: 0x40000, CIE: 0x80000,
  DTOE: 0x100000, DCE: 0x200000, DEBE: 0x400000,
  AC12E: 0x1000000, DMAE: 0x10000000,
});
export const USDHC_MIX = Object.freeze({
  DMAEN: 1, BCEN: 2, AC12EN: 4, DDR: 8, READ: 0x10, MULTI: 0x20,
  AC23EN: 0x80,
});
export const VIRTUAL_SD_GEOMETRY = Object.freeze({
  profile: 'synthetic read-only SDSC / CSD v1',
  sectorBytes: 512, capacityUnitBytes: 256 * 1024,
  minimumImageBytes: 256 * 1024, maximumImageBytes: 128 * 1024 * 1024,
});

const R = USDHC_REG, I = USDHC_INT, M = USDHC_MIX;
const ERRORS = 0x117f0000, VALID_INTERRUPTS = 0x157f51ff;
const RSTA = 0x1000000, RSTC = 0x2000000, RSTD = 0x4000000, INITA = 0x8000000;
const CMD_MASK = 0x3ffb0000, MIX_MASK = 0x80000037;
const OUT_OF_RANGE = 0x80000000, ADDRESS_ERROR = 0x40000000;
const BLOCK_LENGTH_ERROR = 0x20000000, WRITE_PROTECT = 0x04000000;
const ILLEGAL_COMMAND = 0x00400000, RCA = 1, OCR = 0x00ff8000;
const CARD_NAMES = ['idle', 'ready', 'identification', 'standby', 'transfer', 'sending-data'] as const;

export interface USDHCOptions {
  image: Uint8Array;
  instance?: 1 | 2;
  inserted?: boolean;
  onIrq?: (irq: number, asserted: boolean) => void;
  /** Nominal scheduler turns, unrelated to SD clocks or CPU cycle counts. */
  commandTicks?: number;
  /** Limits each finite PIO transfer before allocating its private buffer. */
  maximumTransferBytes?: number;
}
export interface USDHCStatus {
  profile: string;
  baseAddress: number;
  irq: number;
  irqAsserted: boolean;
  inserted: boolean;
  readOnly: true;
  imageBytes: number;
  cardState: typeof CARD_NAMES[number];
  cardBusWidth: 1 | 4;
  blockLength: number;
  pendingCommand: number | null;
  transferBytes: number;
  transferReadBytes: number;
  fifoWords: number;
  completedCommands: number;
  completedReads: number;
  bytesRead: number;
  lastError: string | null;
  unsupported: Array<{ reason: string; count: number }>;
  unsupportedOverflow: number;
  limitations: readonly string[];
}
interface Command {
  index: number; argument: number; type: number; mix: number; blockSize: number;
  blockCount: number; ticks: number;
}
interface Transfer {
  bytes: Uint8Array; cursor: number; batchWords: number; blockSize: number;
  multiple: boolean; autoStop: boolean;
}

function putBits(value: bigint, high: number, low: number, field: number): bigint {
  const mask = ((1n << BigInt(high - low + 1)) - 1n) << BigInt(low);
  return (value & ~mask) | ((BigInt(field) << BigInt(low)) & mask);
}
function registerBytes(value: bigint, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => Number((value >> BigInt((length - 1 - i) * 8)) & 255n));
}
function registerCrc(value: bigint): bigint {
  let crc = 0;
  for (const byte of registerBytes(value, 16).subarray(0, 15)) {
    for (let bit = 7; bit >= 0; bit--) {
      const feedback = ((crc >> 6) ^ (byte >> bit)) & 1;
      crc = (crc << 1) & 0x7f;
      if (feedback) crc ^= 9;
    }
  }
  return (value & ~255n) | BigInt((crc << 1) | 1);
}
function syntheticCid(): bigint {
  // MID=0, OEM="OS", PNM="VSDRO", revision1.0, serial1, date2026-10.
  let value = 0n;
  for (const [high, low, field] of [
    [119, 104, 0x4f53], [103, 96, 0x56], [95, 88, 0x53], [87, 80, 0x44],
    [79, 72, 0x52], [71, 64, 0x4f], [63, 56, 0x10], [55, 24, 1], [19, 8, 0x1aa],
  ]) value = putBits(value, high, low, field);
  return registerCrc(value);
}
function syntheticCsd(imageBytes: number): bigint {
  let value = 0n;
  // Exact CSD v1 geometry; only basic, block-read and application classes.
  for (const [high, low, field] of [
    [119, 112, 0x0e], [103, 96, 0x32], [95, 84, 0x105], [83, 80, 9],
    [73, 62, imageBytes / VIRTUAL_SD_GEOMETRY.capacityUnitBytes - 1],
    [49, 47, 7], [46, 46, 1], [45, 39, 0x7f], [25, 22, 9], [13, 13, 1],
  ]) value = putBits(value, high, low, field);
  return registerCrc(value);
}

/** Relative register offsets only. No host filesystem or physical-media API. */
export class USDHCController {
  readonly baseAddress: number;
  readonly irqNumber: number;
  private readonly image: Uint8Array;
  private readonly cid = syntheticCid();
  private readonly csd: bigint;
  private readonly scr = Uint8Array.of(0x02, 0x05, 0, 0, 0, 0, 0, 0);
  private readonly onIrq?: USDHCOptions['onIrq'];
  private readonly commandTicks: number;
  private readonly maximumTransferBytes: number;
  private readonly registers = new Map<number, number>();
  private readonly unsupported = new Map<string, number>();
  private unsupportedOverflow = 0;
  private inserted: boolean;
  private cardState = 0;
  private cardBusWidth: 1 | 4 = 1;
  private blockLength = 512;
  private application = false;
  private pending: Command | null = null;
  private transfer: Transfer | null = null;
  private busyTicks = 0;
  private resetTicks = 0;
  private initializationTicks = 0;
  private irqAsserted = false;
  private lastError: string | null = null;
  private completedCommands = 0;
  private completedReads = 0;
  private bytesRead = 0;

  constructor(options: USDHCOptions) {
    const size = options.image?.byteLength;
    const geometry = VIRTUAL_SD_GEOMETRY;
    if (!(options.image instanceof Uint8Array) || size < geometry.minimumImageBytes ||
      size > geometry.maximumImageBytes || size % geometry.capacityUnitBytes !== 0) {
      throw new RangeError('SDSC image must contain 256KiB..128MiB in exact 256KiB capacity units');
    }
    if (options.instance !== undefined && options.instance !== 1 && options.instance !== 2)
      throw new RangeError('USDHC instance must be 1 or 2');
    this.commandTicks = options.commandTicks ?? 1;
    this.maximumTransferBytes = options.maximumTransferBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(this.commandTicks) || this.commandTicks < 1 || this.commandTicks > 1_000_000)
      throw new RangeError('commandTicks must be an integer 1..1000000');
    if (!Number.isSafeInteger(this.maximumTransferBytes) || this.maximumTransferBytes < 512 ||
      this.maximumTransferBytes > 16 * 1024 * 1024 || this.maximumTransferBytes % 512 !== 0)
      throw new RangeError('maximumTransferBytes must be a 512-byte multiple in 512..16777216');
    const instance = options.instance ?? 1;
    this.baseAddress = instance === 1 ? 0x402c0000 : 0x402c4000;
    this.irqNumber = instance === 1 ? 110 : 111;
    this.image = new Uint8Array(options.image);
    this.csd = syntheticCsd(size);
    this.inserted = options.inserted ?? true;
    this.onIrq = options.onIrq;
    this.resetController();
  }

  private reg(offset: number): number { return this.registers.get(offset) ?? 0; }
  private diagnostic(reason: string): void {
    this.lastError = reason;
    const previous = this.unsupported.get(reason);
    if (previous !== undefined) this.unsupported.set(reason, previous + 1);
    else if (this.unsupported.size < 128) this.unsupported.set(reason, 1);
    else this.unsupportedOverflow++;
  }
  private interrupt(flags: number): void {
    this.registers.set(R.INT_STATUS, (this.reg(R.INT_STATUS) | (flags & this.reg(R.INT_STATUS_EN))) >>> 0);
    this.updateIrq();
  }
  private updateIrq(): void {
    const asserted = (this.reg(R.INT_STATUS) & this.reg(R.INT_SIGNAL_EN)) !== 0;
    if (asserted !== this.irqAsserted) {
      this.irqAsserted = asserted;
      this.onIrq?.(this.irqNumber, asserted);
    }
  }
  private presenceEvent(): void { this.interrupt(this.inserted ? I.CINS : I.CRM); }
  private present(): number {
    // Named idle-high line/clock fixture. Electrical pads and real timing are unknown.
    let value = 0xff808008 | (this.inserted ? 0x10000 : 0);
    if (this.pending) value |= 1;
    if (this.transfer || this.busyTicks) value |= 2;
    if (this.transfer) {
      value |= 0x200;
      if (this.transfer.cursor + this.transfer.batchWords * 4 < this.transfer.bytes.length) value |= 4;
      if (this.transfer.batchWords > 0 && (this.reg(R.INT_STATUS_EN) & I.BRR)) value |= 0x800;
    } else if (this.busyTicks) value |= 4;
    if (this.busyTicks) value &= ~(1 << 24);
    return value >>> 0;
  }
  private address(offset: number, width: number): { aligned: number; shift: number; mask: number } | null {
    if (!Number.isInteger(offset) || offset < 0 || offset >= 0x4000 ||
      ![1, 2, 4].includes(width) || offset % width !== 0 || (offset & 3) + width > 4) {
      this.diagnostic('invalid or unaligned register access');
      return null;
    }
    return { aligned: offset & ~3, shift: (offset & 3) * 8, mask: width === 4 ? 0xffffffff : (1 << (width * 8)) - 1 };
  }

  read(offset: number, width = 4): number | undefined {
    const access = this.address(offset, width);
    if (!access) return undefined;
    const { aligned, shift, mask } = access;
    let value: number;
    if (aligned === R.DATA_PORT) {
      if (width !== 4) { this.diagnostic('PIO data port requires aligned32-bit reads'); return undefined; }
      value = this.readData();
    } else if (aligned === R.PRES_STATE) value = this.present();
    else if (aligned === R.INT_STATUS) value = this.reg(aligned) | ((this.reg(aligned) & ERRORS) ? I.ERR : 0);
    else if (aligned === R.BLK_ATT) value = (this.reg(aligned) & 0x1fff) |
      ((this.reg(R.MIX_CTRL) & M.MULTI) ? (this.reg(aligned) & 0xffff0000) : 0x10000);
    else if (aligned === R.FORCE_EVENT) value = 0;
    else if (this.registers.has(aligned)) value = this.reg(aligned);
    else { this.diagnostic(`unimplemented register read0x${aligned.toString(16)}`); return undefined; }
    return ((value >>> shift) & mask) >>> 0;
  }

  write(offset: number, value: number, width = 4): void {
    const access = this.address(offset, width);
    if (!access) return;
    const { aligned, shift, mask } = access;
    const laneMask = (mask << shift) >>> 0;
    const written = ((value & mask) << shift) >>> 0;
    const merged = ((this.reg(aligned) & ~laneMask) | written) >>> 0;
    if (aligned === R.INT_STATUS) {
      this.registers.set(aligned, (this.reg(aligned) & ~(written & VALID_INTERRUPTS)) >>> 0);
      if (written & (I.CINS | I.CRM)) this.presenceEvent();
      this.updateIrq();
    } else if (aligned === R.INT_STATUS_EN || aligned === R.INT_SIGNAL_EN) {
      this.registers.set(aligned, (merged & VALID_INTERRUPTS) >>> 0);
      if (aligned === R.INT_STATUS_EN) this.presenceEvent();
      this.updateIrq();
    } else if (aligned === R.SYS_CTRL) this.writeSystem(merged, written);
    else if (aligned === R.CMD_XFR_TYP) {
      if (width !== 4) { this.diagnostic('command launch requires aligned32-bit write'); return; }
      this.launch(merged & CMD_MASK);
    } else if (aligned === R.DATA_PORT) {
      if (!(this.reg(R.MIX_CTRL) & M.DMAEN)) this.diagnostic('PIO writes refused: owned SD image is read-only');
    } else if (new Set<number>([R.CMD_RSP0, R.CMD_RSP1, R.CMD_RSP2, R.CMD_RSP3, R.PRES_STATE, R.HOST_CTRL_CAP, R.ADMA_ERR_STATUS]).has(aligned)) {
      // Read-only response/present/capability fields ignore writes.
    } else if (aligned === R.WTMK_LVL) {
      if (this.transfer) { this.diagnostic('watermark change during active transfer refused'); return; }
      let watermark = merged & 0x1fff1fff;
      if (!(watermark & 0x1f00)) watermark |= 0x800;
      if (!(watermark & 0x1f000000)) watermark |= 0x8000000;
      this.registers.set(aligned, watermark >>> 0);
    } else if (aligned === R.MIX_CTRL) {
      if (this.transfer) { this.diagnostic('MIX_CTRL change during active transfer refused'); return; }
      this.registers.set(aligned, merged >>> 0);
    } else if (aligned === R.PROT_CTRL) {
      if (this.transfer) { this.diagnostic('PROT_CTRL change during active transfer refused'); return; }
      this.registers.set(aligned, merged >>> 0);
    } else if (aligned === R.BLK_ATT) {
      if (!this.transfer) this.registers.set(aligned, (merged & 0xffff1fff) >>> 0);
    } else if (aligned === R.CMD_ARG || aligned === R.DS_ADDR || aligned === R.ADMA_SYS_ADDR || aligned === R.VEND_SPEC) {
      if (aligned === R.CMD_ARG && this.pending) return;
      if (aligned === R.CMD_ARG || !this.transfer) this.registers.set(aligned, merged >>> 0);
    } else if (aligned === R.FORCE_EVENT) {
      this.diagnostic('FORCE_EVENT is outside the qualified subset');
    } else this.diagnostic(`unimplemented register write0x${aligned.toString(16)}`);
  }

  /** Host reset leaves the card protocol state, image and diagnostics intact. */
  resetController(): void {
    if (this.transfer) this.diagnostic('RSTA during unfinished data is outside documented reset procedure');
    this.registers.clear();
    for (const offset of [R.DS_ADDR, R.BLK_ATT, R.CMD_ARG, R.CMD_XFR_TYP, R.CMD_RSP0,
      R.CMD_RSP1, R.CMD_RSP2, R.CMD_RSP3, R.INT_STATUS, R.INT_STATUS_EN, R.INT_SIGNAL_EN,
      R.AUTOCMD12_ERR_STATUS, R.ADMA_ERR_STATUS, R.ADMA_SYS_ADDR]) this.registers.set(offset, 0);
    this.registers.set(R.PROT_CTRL, 0x08800020);
    this.registers.set(R.SYS_CTRL, 0x0080800f);
    this.registers.set(R.WTMK_LVL, 0x08100810);
    this.registers.set(R.MIX_CTRL, 0x80000000);
    this.registers.set(R.HOST_CTRL_CAP, this.irqNumber === 110 ? 0x07f3b407 : 0x07f3b400);
    this.registers.set(R.VEND_SPEC, 0x30007809);
    this.pending = null; this.transfer = null; this.busyTicks = 0;
    this.resetTicks = 0; this.initializationTicks = 0;
    this.updateIrq();
  }
  private writeSystem(merged: number, written: number): void {
    if (written & RSTA) {
      this.resetController();
      this.registers.set(R.SYS_CTRL, this.reg(R.SYS_CTRL) | RSTA);
      this.resetTicks = 1;
      return;
    }
    const previous = this.reg(R.SYS_CTRL);
    // INITA is write-one-to-start; writing0 cannot end initialization.
    this.registers.set(R.SYS_CTRL, ((merged & 0x078ffff0) | 15 | (previous & (INITA | RSTC | RSTD))) >>> 0);
    if (written & RSTC) {
      this.pending = null;
      this.registers.set(R.INT_STATUS, this.reg(R.INT_STATUS) & ~I.CC);
      this.resetTicks = 1;
    }
    if (written & RSTD) {
      if (this.transfer) this.diagnostic('RSTD during unfinished data is outside documented reset procedure');
      this.transfer = null; this.busyTicks = 0;
      this.registers.set(R.PROT_CTRL, this.reg(R.PROT_CTRL) & ~0x20000);
      this.registers.set(R.INT_STATUS, this.reg(R.INT_STATUS) & ~(I.BRR | I.BWR | I.DINT | I.BGE | I.TC));
      this.resetTicks = 1;
    }
    if ((written & INITA) && !this.pending && !this.transfer && !this.busyTicks && !this.initializationTicks) {
      this.initializationTicks = 1;
      this.registers.set(R.SYS_CTRL, this.reg(R.SYS_CTRL) | INITA);
    }
    if (written & 0x10000000) this.diagnostic('tuning reset is outside the qualified subset');
    this.updateIrq();
  }

  setInserted(inserted: boolean): void {
    if (this.inserted === inserted) return;
    this.inserted = inserted;
    this.cardState = 0; this.cardBusWidth = 1; this.blockLength = 512; this.application = false;
    if (!inserted && this.transfer) {
      this.diagnostic('card removed during unfinished PIO transfer');
      this.transfer = null;
    }
    this.presenceEvent();
  }
  private launch(type: number): void {
    const index = (type >>> 24) & 63;
    if (this.pending || this.resetTicks) { this.diagnostic('command write while CMD inhibited refused'); return; }
    const needsData = Boolean(type & 0x200000) || ((type >>> 16) & 3) === 3;
    if ((this.transfer || this.busyTicks) && needsData && index !== 12) {
      this.diagnostic('command write while DATA inhibited refused'); return;
    }
    if ((type & 0xc00000) && !(index === 12 && (type & 0xc00000) === 0xc00000)) {
      this.diagnostic('suspend/resume and non-CMD12 abort command types are outside the qualified subset');
      this.interrupt(I.CTOE); return;
    }
    this.registers.set(R.CMD_XFR_TYP, type >>> 0);
    this.pending = {
      index, argument: this.reg(R.CMD_ARG), type: type >>> 0, mix: this.reg(R.MIX_CTRL),
      blockSize: this.reg(R.BLK_ATT) & 0x1fff,
      blockCount: (this.reg(R.BLK_ATT) >>> 16) & 0xffff, ticks: this.commandTicks,
    };
  }
  private cardStatus(error = 0, app = false): number {
    return (error | (this.cardState << 9) | ([3, 4].includes(this.cardState) ? 0x100 : 0) | (app ? 0x20 : 0)) >>> 0;
  }
  private longResponse(value: bigint): void {
    const payload = value >> 8n;
    for (let i = 0; i < 3; i++) this.registers.set(R.CMD_RSP0 + i * 4, Number((payload >> BigInt(i * 32)) & 0xffffffffn));
    this.registers.set(R.CMD_RSP3, ((this.reg(R.CMD_RSP3) & 0xff000000) | Number((payload >> 96n) & 0xffffffn)) >>> 0);
  }
  private response(command: Command, value: number | bigint, expected: number): boolean {
    if (((command.type >>> 16) & 3) !== expected) {
      this.diagnostic(`response format mismatch for CMD${command.index}`);
      this.interrupt(I.CTOE);
      return false;
    }
    if (typeof value === 'bigint') this.longResponse(value);
    else this.registers.set(R.CMD_RSP0, value >>> 0);
    this.interrupt(I.CC);
    if (expected === 3 && !this.transfer) this.busyTicks = 1;
    return true;
  }
  private cardReject(command: Command, error: number, reason: string, responseType = 2): void {
    this.lastError = reason;
    this.response(command, this.cardStatus(error), responseType);
  }
  private unsupportedCommand(command: Command, reason: string): void {
    this.diagnostic(reason);
    if (((command.type >>> 16) & 3) === 0) this.interrupt(I.CC);
    else this.response(command, this.cardStatus(ILLEGAL_COMMAND), 2);
  }
  private complete(command: Command): void {
    this.completedCommands++;
    const { index, argument } = command;
    const application = this.application;
    this.application = false;
    if (index === 0) {
      this.cardState = 0; this.cardBusWidth = 1; this.blockLength = 512;
      this.transfer = null; this.busyTicks = 0;
      if (((command.type >>> 16) & 3) === 0) this.interrupt(I.CC);
      else { this.lastError = 'CMD0 has no response'; this.interrupt(I.CTOE); }
      return;
    }
    if (!this.inserted) {
      if (((command.type >>> 16) & 3) === 0) this.interrupt(I.CC);
      else { this.lastError = 'command response timeout: no card inserted'; this.interrupt(I.CTOE); }
      return;
    }
    if (application && index !== 55) {
      if (index === 41 && this.cardState <= 1) {
        if (argument & OCR) this.cardState = 1;
        this.response(command, OCR | (this.cardState === 1 ? 0x80000000 : 0), 2);
      } else if (index === 6 && this.cardState === 4) {
        if (argument !== 0 && argument !== 2) this.cardReject(command, ILLEGAL_COMMAND, 'unsupported SD bus width');
        else { this.cardBusWidth = argument === 2 ? 4 : 1; this.response(command, this.cardStatus(0, true), 2); }
      } else if (index === 51 && this.cardState === 4) {
        if (command.mix & M.MULTI) {
          this.diagnostic('SCR requires single-block PIO mode'); this.interrupt(I.DTOE);
        } else this.startRead(command, this.scr, 8, false, true);
      } else if ([6, 13, 22, 23, 41, 42, 51].includes(index)) {
        this.unsupportedCommand(command, `ACMD${index} is outside the qualified SD subset or card state`);
      } else {
        // Undefined ACMD numbers fall back to their normal command interpretation.
        this.completeNormal(command);
      }
      return;
    }
    this.completeNormal(command);
  }
  private completeNormal(command: Command): void {
    const { index, argument } = command;
    switch (index) {
      case 8:
        if (this.cardState !== 0 || ((argument >>> 8) & 15) !== 1) {
          this.lastError = 'CMD8 unsupported card state or voltage'; this.interrupt(I.CTOE);
        } else this.response(command, argument & 0xfff, 2);
        break;
      case 55:
        if ((this.cardState <= 1 && argument === 0) || ((argument >>> 16) === RCA && this.cardState >= 3)) {
          this.application = this.response(command, this.cardStatus(0, true), 2);
        } else { this.lastError = 'CMD55 addressed a different card'; this.interrupt(I.CTOE); }
        break;
      case 2:
        if (this.cardState !== 1) this.unsupportedCommand(command, 'CMD2 requires ready state');
        else { this.cardState = 2; this.response(command, this.cid, 1); }
        break;
      case 3:
        if (this.cardState !== 2 && this.cardState !== 3) this.unsupportedCommand(command, 'CMD3 requires identification or standby state');
        else {
          const status = this.cardStatus();
          this.cardState = 3; this.response(command, (RCA << 16) | status, 2);
        }
        break;
      case 9: case 10:
        if ((argument >>> 16) !== RCA) { this.lastError = 'register query addressed a different card'; this.interrupt(I.CTOE); }
        else if (this.cardState !== 3) {
          this.diagnostic('CID/CSD register queries are qualified only in standby state');
          this.interrupt(I.CTOE);
        }
        else this.response(command, index === 9 ? this.csd : this.cid, 1);
        break;
      case 7:
        if (argument === 0 && (this.cardState === 3 || this.cardState === 4)) {
          this.cardState = 3; this.busyTicks = 0;
          if (((command.type >>> 16) & 3) === 0) this.interrupt(I.CC);
          else { this.lastError = 'CMD7 deselection has no response'; this.interrupt(I.CTOE); }
        }
        else if ((argument >>> 16) !== RCA) { this.lastError = 'CMD7 addressed a different card'; this.interrupt(I.CTOE); }
        else if (this.cardState !== 3 && this.cardState !== 4) this.unsupportedCommand(command, 'CMD7 requires standby or transfer state');
        else {
          const status = this.cardStatus();
          this.cardState = 4;
          // NXP SDMMC_SelectCard requests48-bit R1; checking R1b busy is optional here.
          this.response(command, status, ((command.type >>> 16) & 3) === 3 ? 3 : 2);
        }
        break;
      case 13:
        if ((argument >>> 16) !== RCA || this.cardState < 3) { this.lastError = 'CMD13 addressed a different or unidentified card'; this.interrupt(I.CTOE); }
        else this.response(command, this.cardStatus(), 2);
        break;
      case 16:
        if (this.cardState !== 4) this.cardReject(command, ILLEGAL_COMMAND, 'CMD16 requires transfer state');
        else if (argument !== 512) this.cardReject(command, BLOCK_LENGTH_ERROR, 'only512-byte SDSC blocks are qualified');
        else { this.blockLength = 512; this.response(command, this.cardStatus(), 2); }
        break;
      case 17: case 18: this.readImage(command); break;
      case 12:
        if (this.transfer) {
          this.diagnostic('CMD12 before finite PIO drain is outside the qualified stop subset');
          this.transfer = null;
        }
        if (this.cardState !== 5 && this.cardState !== 4) this.cardReject(command, ILLEGAL_COMMAND, 'CMD12 requires sending-data or transfer state');
        else {
          const status = this.cardStatus();
          this.cardState = 4; this.response(command, status, 3);
        }
        break;
      case 24: case 25: case 27: case 28: case 29: case 32: case 33: case 38: case 42:
        this.diagnostic(`CMD${index} mutation refused: owned SD image is read-only`);
        this.cardReject(command, WRITE_PROTECT, 'SD image is permanently write-protected', index === 38 ? 3 : 2);
        break;
      case 1: case 5:
        this.diagnostic(`CMD${index} MMC/SDIO discovery is outside the SD memory-card subset`);
        this.interrupt(I.CTOE);
        break;
      default: this.unsupportedCommand(command, `CMD${index} is outside the qualified SD subset`);
    }
  }
  private readImage(command: Command): void {
    if (this.cardState !== 4) { this.cardReject(command, ILLEGAL_COMMAND, 'block read requires transfer state'); return; }
    if (command.argument % 512 !== 0) { this.cardReject(command, ADDRESS_ERROR, 'SDSC read requires a512-byte-aligned byte address'); return; }
    if (command.blockSize !== 512) { this.cardReject(command, BLOCK_LENGTH_ERROR, 'controller and card block lengths differ'); return; }
    const multiple = command.index === 18;
    if (multiple !== Boolean(command.mix & M.MULTI) || (multiple && !(command.mix & M.BCEN))) {
      this.diagnostic('read requires matching single/multiple mode and a finite block count');
      this.interrupt(I.DTOE); return;
    }
    const count = multiple ? command.blockCount : 1;
    if (count === 0) { this.response(command, this.cardStatus(), 2); return; }
    const length = count * 512;
    if (length > this.maximumTransferBytes) {
      this.diagnostic('finite read exceeds configured maximumTransferBytes'); this.interrupt(I.DTOE); return;
    }
    if (command.argument >= this.image.length || length > this.image.length - command.argument) {
      this.cardReject(command, OUT_OF_RANGE, 'read range exceeds exact owned SD image capacity'); return;
    }
    this.startRead(command, this.image.subarray(command.argument, command.argument + length), 512, multiple);
  }
  private startRead(command: Command, bytes: Uint8Array, blockSize: number, multiple: boolean, app = false): void {
    if (!(command.type & 0x200000) || !(command.mix & M.READ) || command.blockSize !== blockSize) {
      this.diagnostic('read data requires DPSEL, DTDSEL and matching block size'); this.interrupt(I.DTOE); return;
    }
    if (command.mix & M.DMAEN) {
      this.diagnostic('DMA/ADMA data transfer is outside the qualified PIO subset'); this.interrupt(I.DMAE); return;
    }
    if (command.mix & ~MIX_MASK) {
      this.diagnostic('DDR/UHS/tuning/AutoCMD23 mode is outside the qualified subset'); this.interrupt(I.DTOE); return;
    }
    const endian = (this.reg(R.PROT_CTRL) >>> 4) & 3;
    const width = (this.reg(R.PROT_CTRL) >>> 1) & 3;
    if (endian !== 2 || width > 1 || (width === 1 ? 4 : 1) !== this.cardBusWidth || (this.reg(R.PROT_CTRL) & 0x000f0000)) {
      this.diagnostic('PIO requires little endian, matching1/4-bit width and no block-gap mode'); this.interrupt(I.DTOE); return;
    }
    const watermark = this.reg(R.WTMK_LVL) & 255;
    if (watermark < 1 || watermark > 128) {
      this.diagnostic('read watermark must be1..128 words'); this.interrupt(I.DTOE); return;
    }
    if (!this.response(command, this.cardStatus(0, app), 2)) return;
    this.cardState = 5;
    this.transfer = { bytes: new Uint8Array(bytes), cursor: 0, batchWords: 0, blockSize,
      multiple, autoStop: multiple && Boolean(command.mix & M.AC12EN) };
    this.fillBatch();
  }
  private fillBatch(): void {
    const transfer = this.transfer;
    if (!transfer || transfer.batchWords !== 0 || (this.reg(R.INT_STATUS) & I.BRR)) return;
    const blockRemaining = transfer.blockSize - (transfer.cursor % transfer.blockSize);
    transfer.batchWords = Math.min(this.reg(R.WTMK_LVL) & 255, blockRemaining / 4,
      (transfer.bytes.length - transfer.cursor) / 4);
    if (transfer.batchWords) this.interrupt(I.BRR);
  }
  private readData(): number {
    if (this.reg(R.MIX_CTRL) & M.DMAEN) return 0;
    const transfer = this.transfer;
    if (!transfer || !transfer.batchWords) {
      this.diagnostic('PIO read without a ready data batch'); return 0;
    }
    const offset = transfer.cursor;
    const data = transfer.bytes;
    const value = (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
    transfer.cursor += 4; transfer.batchWords--; this.bytesRead += 4;
    if (transfer.multiple && transfer.cursor % transfer.blockSize === 0)
      this.registers.set(R.BLK_ATT, (this.reg(R.BLK_ATT) - 0x10000) >>> 0);
    if (transfer.cursor === transfer.bytes.length) {
      this.completedReads++;
      const stopStatus = this.cardStatus();
      if (!transfer.multiple || transfer.autoStop) this.cardState = 4;
      if (transfer.autoStop) this.registers.set(R.CMD_RSP3, stopStatus);
      this.transfer = null;
      this.interrupt(I.TC);
    }
    return value;
  }

  tick(turns = 1): void {
    if (!Number.isSafeInteger(turns) || turns < 0) throw new RangeError('tick requires a nonnegative integer');
    if (!turns) return;
    if (this.resetTicks) {
      this.resetTicks = Math.max(0, this.resetTicks - turns);
      if (!this.resetTicks) this.registers.set(R.SYS_CTRL, this.reg(R.SYS_CTRL) & ~(RSTA | RSTC | RSTD));
    }
    const initializationWait = Math.min(turns, this.initializationTicks);
    if (this.initializationTicks) {
      this.initializationTicks = Math.max(0, this.initializationTicks - turns);
      if (!this.initializationTicks) this.registers.set(R.SYS_CTRL, this.reg(R.SYS_CTRL) & ~INITA);
    }
    // Commands wait behind initialization. Aggregated turns preserve sequential latency.
    if (this.busyTicks) {
      this.busyTicks = Math.max(0, this.busyTicks - turns);
      if (!this.busyTicks) this.interrupt(I.TC);
    }
    const command = this.pending;
    if (command && !this.initializationTicks) {
      const budget = turns - initializationWait;
      const remainingAfterCommand = budget - command.ticks;
      command.ticks -= budget;
      if (command.ticks <= 0) {
        this.pending = null; this.complete(command);
        if (this.busyTicks && remainingAfterCommand > 0) {
          this.busyTicks = Math.max(0, this.busyTicks - remainingAfterCommand);
          if (!this.busyTicks) this.interrupt(I.TC);
        }
      }
    }
    this.fillBatch();
  }

  status(): USDHCStatus {
    return {
      profile: VIRTUAL_SD_GEOMETRY.profile, baseAddress: this.baseAddress, irq: this.irqNumber,
      irqAsserted: this.irqAsserted, inserted: this.inserted, readOnly: true, imageBytes: this.image.length,
      cardState: CARD_NAMES[this.cardState], cardBusWidth: this.cardBusWidth, blockLength: this.blockLength,
      pendingCommand: this.pending?.index ?? null, transferBytes: this.transfer?.bytes.length ?? 0,
      transferReadBytes: this.transfer?.cursor ?? 0, fifoWords: this.transfer?.batchWords ?? 0,
      completedCommands: this.completedCommands, completedReads: this.completedReads, bytesRead: this.bytesRead,
      lastError: this.lastError, unsupported: [...this.unsupported].map(([reason, count]) => ({ reason, count })),
      unsupportedOverflow: this.unsupportedOverflow,
      limitations: [
        'Synthetic SDSC CID/CSD/SCR; no physical card identity or route established.',
        'Nominal command/busy/reset ticks and acknowledged PIO batches; no electrical clock or cycle timing.',
        'Only little-endian32-bit PIO,512-byte blocks, finite CMD18 and one/ four-bit native SD.',
        'DMA/ADMA, writes/erase, MMC/SDIO, high-speed/UHS/tuning, block gaps and SD status remain unqualified.',
        'This component is not integrated into guest boot or a filesystem; it establishes no stock storage result.',
      ],
    };
  }
}
