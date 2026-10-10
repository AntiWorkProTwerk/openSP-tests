/**
 * Original packet-level USB1 device-controller model.
 *
 * Descriptor layout and EP0 register use follow the project's R13/R16B
 * usb_device.c. Address masks and IRQ113 are checked against NXP's header:
 * https://raw.githubusercontent.com/nxp-mcuxpresso/mcux-sdk/main/devices/MIMXRT1062/MIMXRT1062.h
 *
 * The firmware supplies descriptors and handles requests. This module performs
 * controller DMA; it does not substitute responses for firmware execution.
 * Transfers are deterministic host transactions. PHY/clock/cache timing,
 * isochronous scheduling, USB host mode and physical USB are not modeled.
 */

export const USB1_BASE = 0x402e0000;
export const USB1_IRQ = 113;

export interface UsbMemoryBus {
  readMemory(address: number, length: number): Uint8Array;
  writeMemory(address: number, bytes: Uint8Array): void;
  irq?(irq: number, asserted: boolean): void;
}

export interface UsbSetupRequest {
  requestType: number;
  request: number;
  value: number;
  index: number;
  length: number;
}

const CMD = 0x140;
const STS = 0x144;
const INTR = 0x148;
const ADDR = 0x154;
const LIST = 0x158;
const NAK = 0x178;
const NAKEN = 0x17c;
const PORT = 0x184;
const MODE = 0x1a8;
const SETUP = 0x1ac;
const PRIME = 0x1b0;
const FLUSH = 0x1b4;
const STAT = 0x1b8;
const COMPLETE = 0x1bc;
const EPCTRL = 0x1c0;
const EP_MASK = 0x00ff00ff;
const ACTIVE = 0x80;
const IOC = 0x8000;
const ERROR = 0x68;
const UI = 1;
const UEI = 2;
const URI = 64;
const NAKI = 0x10000;

interface Transfer {
  head: number;
  descriptor: number;
  next: number;
  token: number;
  total: number;
  consumed: number;
  packetSize: number;
  pages: number[];
  zeroTerminate: boolean;
}

/** Eight endpoint pairs, with 64-byte dQHs and 32-byte dTDs. */
export class Rt1062UsbDevice {
  private readonly bus: UsbMemoryBus;
  private readonly registers = new Map<number, number>();
  private readonly transfers = new Map<number, Transfer>();
  private irqAsserted = false;

  constructor(bus?: UsbMemoryBus) {
    const unbound = (): never => { throw new Error('USB DMA memory bus is not bound'); };
    this.bus = bus ? { ...bus } : { readMemory: unbound, writeMemory: unbound };
    this.reset();
  }

  setMemoryCallbacks(bus: Pick<UsbMemoryBus, 'readMemory' | 'writeMemory'>): void {
    this.bus.readMemory = bus.readMemory;
    this.bus.writeMemory = bus.writeMemory;
  }

  reset(): void {
    this.transfers.clear();
    this.registers.clear();
    for (const offset of [0x90, CMD, STS, INTR, 0x14c, ADDR, LIST, 0x160,
      0x164, NAK, NAKEN, PORT, 0x1a4, MODE, SETUP, PRIME, FLUSH, STAT, COMPLETE]) {
      this.registers.set(offset, 0);
    }
    // DEN=8, device capable. This model exposes device mode only.
    this.registers.set(0x124, 0x88);
    for (let endpoint = 0; endpoint < 8; endpoint++) {
      this.registers.set(EPCTRL + 4 * endpoint, 0);
    }
    this.updateIrq();
  }

  read(offset: number, width = 4): number | undefined {
    if (!this.validAccess(offset, width)) return undefined;
    const value = this.registers.get(offset & ~3);
    if (value === undefined) return undefined;
    return ((value >>> ((offset & 3) * 8)) & this.widthMask(width)) >>> 0;
  }

  write(offset: number, value: number, width = 4): boolean {
    if (!this.validAccess(offset, width)) return false;
    const aligned = offset & ~3;
    const previous = this.registers.get(aligned);
    if (previous === undefined) return false;
    const shift = (offset & 3) * 8;
    const lane = (this.widthMask(width) << shift) >>> 0;
    const written = ((value & this.widthMask(width)) << shift) >>> 0;
    const merged = ((previous & ~lane) | written) >>> 0;
    if (aligned === 0x124 || aligned === STAT) return true;
    if ([STS, SETUP, COMPLETE, NAK].includes(aligned)) {
      this.registers.set(aligned, (previous & ~written) >>> 0);
    } else if (aligned === CMD && (merged & 2)) {
      this.reset(); // Controller reset completes synchronously.
    } else if (aligned === PRIME) {
      this.prime(written & EP_MASK);
    } else if (aligned === FLUSH) {
      this.flush(written & EP_MASK);
    } else if (aligned === LIST) {
      this.registers.set(LIST, (merged & 0xfffff800) >>> 0);
    } else if (aligned === ADDR) {
      this.registers.set(ADDR, (merged & 0xff000000) >>> 0);
    } else if (aligned === MODE) {
      // Device mode and setup-lockout/stream-disable controls.
      this.registers.set(MODE, merged & 0x1f);
    } else if (aligned >= EPCTRL && aligned < EPCTRL + 32) {
      // RXR/TXR reset the data toggle and are self-clearing.
      this.registers.set(aligned, (merged & ~0x00400040) >>> 0);
    } else if (aligned === PORT) {
      // Connection/change and enable/change bits are owned by the bus.
      const changes = 0x2a;
      this.registers.set(PORT, ((merged & ~changes & ~5) |
        (previous & 5) | (previous & changes & ~written)) >>> 0);
    } else {
      this.registers.set(aligned, merged);
    }
    this.updateIrq();
    return true;
  }

  /** Deliver a SETUP packet into the OUT dQH, then let firmware service it. */
  hostSetup(request: Uint8Array, endpoint = 0): boolean {
    if (request.length !== 8 || !Number.isInteger(endpoint) || endpoint < 0 || endpoint >= 8 ||
      !this.running() || !(this.word(EPCTRL + endpoint * 4) & 0x80)) return false;
    try {
      const head = this.headAddress(endpoint, false);
      this.bus.writeMemory(head + 40, request.slice());
      this.flush(this.endpointBit(endpoint, false) | this.endpointBit(endpoint, true));
      this.registers.set(CMD, this.word(CMD) & ~(1 << 13));
      this.registers.set(SETUP, this.word(SETUP) | (1 << endpoint));
      // A SETUP transaction starts a new control transfer and clears STALL.
      const control = EPCTRL + endpoint * 4;
      this.registers.set(control, this.word(control) & ~0x00010001);
      if (this.dmaWord(head) & 0x8000) this.raise(UI);
      this.connect();
      return true;
    } catch {
      this.raise(UEI);
      return false;
    }
  }

  /** One host OUT packet. False denotes NAK, STALL or a controller DMA fault. */
  hostOut(data: Uint8Array, endpoint = 0): boolean {
    const key = endpoint * 2;
    const transfer = this.activeTransfer(endpoint, false);
    if (!transfer) return false;
    const remaining = transfer.total - transfer.consumed;
    if (data.length > transfer.packetSize || data.length > remaining) {
      this.fail(key, transfer, 0x40);
      return false;
    }
    try {
      this.copyBuffer(transfer, data.length, data);
      transfer.consumed += data.length;
      this.updateToken(transfer, true);
      if (transfer.consumed === transfer.total || data.length < transfer.packetSize) {
        this.retire(key, transfer);
      }
      return true;
    } catch {
      this.fail(key, transfer, 0x60);
      return false;
    }
  }

  /** One host IN packet. Null denotes NAK, STALL or a controller DMA fault. */
  hostIn(endpoint = 0): Uint8Array | null {
    const key = endpoint * 2 + 1;
    const transfer = this.activeTransfer(endpoint, true);
    if (!transfer) return null;
    const length = Math.min(transfer.total - transfer.consumed, transfer.packetSize);
    try {
      const data = this.copyBuffer(transfer, length);
      transfer.consumed += length;
      this.updateToken(transfer, true);
      if (transfer.consumed === transfer.total) {
        if (transfer.zeroTerminate && length === transfer.packetSize) {
          transfer.zeroTerminate = false;
        } else {
          this.retire(key, transfer);
          // USBADRA stages the new address until the control status ACK.
          if (endpoint === 0 && transfer.total === 0 && (this.word(ADDR) & 0x1000000)) {
            this.registers.set(ADDR, this.word(ADDR) & ~0x1000000);
          }
        }
      }
      return data;
    } catch {
      this.fail(key, transfer, 0x60);
      return null;
    }
  }

  /** USB bus reset preserves RAM; firmware decides which upload state survives. */
  hostBusReset(): boolean {
    if (!this.running()) return false;
    this.flush(EP_MASK);
    for (const register of [ADDR, SETUP, COMPLETE, NAK]) this.registers.set(register, 0);
    this.connect();
    this.raise(URI);
    return true;
  }

  setup(request: UsbSetupRequest): boolean {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, request.requestType);
    view.setUint8(1, request.request);
    view.setUint16(2, request.value, true);
    view.setUint16(4, request.index, true);
    view.setUint16(6, request.length, true);
    return this.hostSetup(bytes);
  }

  inToken(endpoint = 0): Uint8Array | null {
    return this.hostIn(endpoint);
  }

  outToken(endpoint = 0, data = new Uint8Array()): boolean {
    return this.hostOut(data, endpoint);
  }

  private word(offset: number): number {
    return this.registers.get(offset) ?? 0;
  }

  private validAccess(offset: number, width: number): boolean {
    return Number.isInteger(offset) && offset >= 0 && [1, 2, 4].includes(width) &&
      offset % width === 0 && (offset & 3) + width <= 4;
  }

  private widthMask(width: number): number {
    return width === 4 ? 0xffffffff : (1 << (width * 8)) - 1;
  }

  private running(): boolean {
    return (this.word(CMD) & 1) !== 0 && (this.word(MODE) & 3) === 2;
  }

  private available(endpoint: number, input: boolean): boolean {
    if (!Number.isInteger(endpoint) || endpoint < 0 || endpoint >= 8 || !this.running()) return false;
    const control = this.word(EPCTRL + endpoint * 4) >>> (input ? 16 : 0);
    return (control & 0x80) !== 0 && (control & 1) === 0;
  }

  private endpointBit(endpoint: number, input: boolean): number {
    return 1 << (endpoint + (input ? 16 : 0));
  }

  private headAddress(endpoint: number, input: boolean): number {
    return (this.word(LIST) + (endpoint * 2 + Number(input)) * 64) >>> 0;
  }

  private dmaWord(address: number): number {
    const bytes = this.bus.readMemory(address >>> 0, 4);
    if (bytes.length !== 4) throw new Error('USB descriptor read is incomplete');
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }

  private dmaWriteWord(address: number, value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    this.bus.writeMemory(address >>> 0, bytes);
  }

  private prime(mask: number): void {
    for (let endpoint = 0; endpoint < 8; endpoint++) {
      for (const input of [false, true]) {
        const bit = this.endpointBit(endpoint, input);
        if (!(mask & bit) || (this.word(STAT) & bit)) continue;
        const key = endpoint * 2 + Number(input);
        const head = this.headAddress(endpoint, input);
        try {
          this.loadDescriptor(key, head, this.dmaWord(head + 8));
        } catch {
          this.raise(UEI);
        }
      }
    }
    this.registers.set(PRIME, 0);
  }

  private loadDescriptor(key: number, head: number, pointer: number): void {
    if (pointer & 1) return;
    const descriptor = (pointer & 0xffffffe0) >>> 0;
    const token = this.dmaWord(descriptor + 4);
    if (!(token & ACTIVE) || (token & ERROR)) return;
    const capabilities = this.dmaWord(head);
    const packetSize = (capabilities >>> 16) & 0x7ff;
    if (!packetSize) throw new Error('USB endpoint maximum packet size is zero');
    const total = (token >>> 16) & 0x7fff;
    const pages = Array.from({ length: 5 }, (_, index) => this.dmaWord(descriptor + 8 + index * 4));
    const transfer: Transfer = {
      head, descriptor, token, total, pages, consumed: 0, packetSize,
      next: this.dmaWord(descriptor),
      zeroTerminate: total > 0 && total % packetSize === 0 && !(capabilities & (1 << 29)),
    };
    this.dmaWriteWord(head + 4, descriptor);
    this.dmaWriteWord(head + 8, transfer.next);
    this.dmaWriteWord(head + 12, token);
    for (let index = 0; index < 5; index++) this.dmaWriteWord(head + 16 + index * 4, pages[index]);
    this.transfers.set(key, transfer);
    const bit = this.endpointBit(key >> 1, (key & 1) !== 0);
    this.registers.set(STAT, this.word(STAT) | bit);
    this.registers.set(NAK, this.word(NAK) & ~bit);
  }

  private activeTransfer(endpoint: number, input: boolean): Transfer | undefined {
    if (!this.available(endpoint, input)) return undefined;
    const transfer = this.transfers.get(endpoint * 2 + Number(input));
    if (!transfer) {
      const bit = this.endpointBit(endpoint, input);
      this.registers.set(NAK, this.word(NAK) | bit);
      if (this.word(NAKEN) & bit) this.raise(NAKI);
    }
    return transfer;
  }

  private copyBuffer(transfer: Transfer, length: number, source?: Uint8Array): Uint8Array {
    const result = new Uint8Array(length);
    let copied = 0;
    while (copied < length) {
      const position = (transfer.pages[0] & 0xfff) + transfer.consumed + copied;
      const page = Math.floor(position / 4096);
      if (page >= 5) throw new Error('USB transfer exceeds its five buffer pages');
      const address = ((transfer.pages[page] & 0xfffff000) + (position & 0xfff)) >>> 0;
      const amount = Math.min(length - copied, 4096 - (position & 0xfff));
      if (source) {
        this.bus.writeMemory(address, source.slice(copied, copied + amount));
      } else {
        const bytes = this.bus.readMemory(address, amount);
        if (bytes.length !== amount) throw new Error('USB buffer read is incomplete');
        result.set(bytes, copied);
      }
      copied += amount;
    }
    return result;
  }

  private updateToken(transfer: Transfer, active: boolean, error = 0): void {
    const remaining = transfer.total - transfer.consumed;
    const token = (((transfer.token & 0x8000ff00) | (remaining << 16) |
      (active ? ACTIVE : 0) | error)) >>> 0;
    this.dmaWriteWord(transfer.descriptor + 4, token);
    this.dmaWriteWord(transfer.head + 12, token);
  }

  private retire(key: number, transfer: Transfer): void {
    this.updateToken(transfer, false);
    this.transfers.delete(key);
    const bit = this.endpointBit(key >> 1, (key & 1) !== 0);
    this.registers.set(STAT, this.word(STAT) & ~bit);
    this.registers.set(COMPLETE, this.word(COMPLETE) | bit);
    if (transfer.token & IOC) this.raise(UI);
    // A short OUT packet terminates the queued transfer before a next dTD.
    if (transfer.consumed === transfer.total) this.loadDescriptor(key, transfer.head, transfer.next);
  }

  private fail(key: number, transfer: Transfer, error: number): void {
    try {
      this.updateToken(transfer, false, error);
    } catch {
      // An inaccessible descriptor cannot receive its error token.
    }
    this.transfers.delete(key);
    const bit = this.endpointBit(key >> 1, (key & 1) !== 0);
    this.registers.set(STAT, this.word(STAT) & ~bit);
    this.registers.set(COMPLETE, this.word(COMPLETE) | bit);
    this.raise(UEI);
  }

  private flush(mask: number): void {
    for (let key = 0; key < 16; key++) {
      if (mask & this.endpointBit(key >> 1, (key & 1) !== 0)) this.transfers.delete(key);
    }
    this.registers.set(STAT, this.word(STAT) & ~mask);
    this.registers.set(PRIME, this.word(PRIME) & ~mask);
    this.registers.set(FLUSH, 0);
  }

  private connect(): void {
    this.registers.set(PORT, this.word(PORT) | 5);
  }

  private raise(status: number): void {
    this.registers.set(STS, this.word(STS) | status);
    this.updateIrq();
  }

  private updateIrq(): void {
    const asserted = (this.word(STS) & this.word(INTR)) !== 0;
    if (asserted !== this.irqAsserted) {
      this.irqAsserted = asserted;
      this.bus.irq?.(USB1_IRQ, asserted);
    }
  }
}
