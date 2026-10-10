/** ARM execution only. Device effects belong to the supplied board model. */
export interface CpuBoard {
  read(address: number, width: number): number | undefined;
  write(address: number, value: number, width: number): void;
  tick(cycles: number): void;
  setMemoryCallbacks?(
    read: (address: number, length: number) => Uint8Array,
    write: (address: number, bytes: Uint8Array) => void,
  ): void;
}

interface UnicornHook { handle: number; callback: number }
interface UnicornEngine {
  ctl_set_cpu_model(model: number): void;
  ctl_get_cpu_model(): number;
  ctl_remove_cache(address: number, end: number): void;
  reg_write_i32(register: number, value: number): void;
  reg_read_i32(register: number): number;
  mem_map(address: number, bytes: number, permissions: number): void;
  mem_read(address: number, bytes: number): Uint8Array;
  mem_write(address: number, bytes: Uint8Array): void;
  hook_add(type: number, callback: (...args: unknown[]) => unknown,
    data?: unknown, begin?: number, end?: number): UnicornHook;
  hook_del(hook: UnicornHook): void;
  emu_start(begin: number, until: number, timeout: number, count: number): void;
  emu_stop(): void;
  arm_wfi_event?(): unknown;
  close(): void;
}
export interface UnicornModule {
  Unicorn: new (architecture: number, mode: number) => UnicornEngine;
  [constant: string]: unknown;
}
export type UnicornFactory = (options?: Record<string, unknown>) => Promise<UnicornModule>;
export type CpuRegister = string;
export interface CpuStep {
  instructions: number;
  totalInstructions: number;
  pc: number;
  reason: 'budget' | 'stopped' | 'fault';
  fault?: string;
  backendLost?: boolean;
  /** Pinned-backend executed-WFI evidence; native halt cause may be ambiguous. */
  sleep?: {kind: 'wfi'; address: number; resumePc: number};
}
export interface CpuOptions {
  factory?: UnicornFactory;
  vendorUrl?: string;
  sdramBytes?: number;
}

export const CPU_MEMORY_MAP = [
  { name: 'ITCM', address: 0x00000000, bytes: 0x00080000, permissions: 7 },
  { name: 'ROM', address: 0x00200000, bytes: 0x00020000, permissions: 5 },
  { name: 'DTCM', address: 0x20000000, bytes: 0x00080000, permissions: 7 },
  // Stock v5.52 startup uses MSP202BE008 and scatter output extends into this
  // window. These are emulator mappings; they do not assert a FlexRAM layout.
  { name: 'OCRAM', address: 0x20200000, bytes: 0x000c0000, permissions: 7 },
  { name: 'MMIO', address: 0x40000000, bytes: 0x00400000, permissions: 3 },
  { name: 'XIP flash', address: 0x60000000, bytes: 0x00400000, permissions: 5 },
  { name: 'SDRAM', address: 0x80000000, bytes: 0x04000000, permissions: 7 },
  { name: 'Core peripherals', address: 0xe0000000, bytes: 0x00100000, permissions: 3 },
] as const;

const scalar = (value: unknown): number => Number(value) >>> 0;
const hexadecimal = (value: number) => `0x${value.toString(16).padStart(8, '0')}`;
const registerName = (name: CpuRegister) => name.toUpperCase().replace(/^UC_ARM_REG_|^ARM_REG_/, '');
const isProgramCounter = (name: CpuRegister) => ['PC', 'R15'].includes(registerName(name));

/** Bounded CPU slices permit independent workers and deterministic board time. */
export class ArmCPU {
  readonly architecture = 'ARM Cortex-M7';
  readonly cpuModel: number;
  readonly memoryMap: Array<{ name: string; address: number; bytes: number; permissions: number }>;
  totalInstructions = 0;
  private readonly engine: UnicornEngine;
  private readonly module: UnicornModule;
  private readonly hooks: UnicornHook[] = [];
  private readonly instructionListeners = new Set<(address: number, size: number, cpu: ArmCPU) => void>();
  private sliceInstructions = 0;
  private instructionLimit = 0;
  private stopped = false;
  private closed = false;
  private callbackFailure: unknown;
  private executing = false;
  private internalYield = false;
  private readonly pendingDeviceWrites: Array<{address: number; bytes: Uint8Array}> = [];
  private readonly pendingInstructionInvalidations: Array<{address: number; end: number}> = [];
  private terminalBackendFault: string | undefined;
  private lastPc = 0;
  private lastStartedAddress: number | undefined;
  private lastStartedSize = 0;
  private wfiCallbackPcChanged = false;

  get backendFailed(): boolean { return this.terminalBackendFault !== undefined; }
  get backendFault(): string | undefined { return this.terminalBackendFault; }

  constructor(module: UnicornModule, board: CpuBoard, options: CpuOptions = {}) {
    this.module = module;
    const constant = (name: string): number => {
      const value = module[name];
      if (typeof value !== 'number') throw new Error(`Unicorn runtime lacks ${name}`);
      return value;
    };
    // Unicorn 2.1.4 MCLASS replaces the selected M7 with M33. Plain Thumb plus
    // explicit M7 selection retains M-profile special registers in this core.
    this.engine = new module.Unicorn(constant('ARCH_ARM'), constant('MODE_THUMB'));
    this.engine.ctl_set_cpu_model(constant('CPU_ARM_CORTEX_M7'));
    this.cpuModel = this.engine.ctl_get_cpu_model();
    if (this.cpuModel !== constant('CPU_ARM_CORTEX_M7')) {
      this.engine.close();
      throw new Error(`Unicorn selected CPU ${this.cpuModel}, expected Cortex-M7`);
    }
    const sdramBytes = options.sdramBytes ?? 0x04000000;
    if (sdramBytes < 0x10000 || sdramBytes > 0x04000000 || sdramBytes % 4096) {
      this.engine.close();
      throw new Error('SDRAM size must be a page multiple between 64 KiB and 64 MiB');
    }
    this.memoryMap = CPU_MEMORY_MAP.map(region => ({ ...region,
      bytes: region.name === 'SDRAM' ? sdramBytes : region.bytes }));
    for (const region of this.memoryMap) {
      this.engine.mem_map(region.address, region.bytes, region.permissions);
    }
    board.setMemoryCallbacks?.(this.readDeviceMemory.bind(this), this.queueDeviceWrite.bind(this));
    for (const region of this.memoryMap.filter(region => region.name === 'MMIO' || region.name === 'Core peripherals')) {
      this.hooks.push(this.engine.hook_add(constant('HOOK_MEM_READ'), (...args) => {
        try {
          const address = scalar(args[2]);
          const size = scalar(args[3]);
          const value = board.read(address, size);
          if (value !== undefined) this.writeScalar(address, size, value);
        } catch (error) { this.failCallback(error); }
      }, undefined, region.address, region.address + region.bytes - 1));
      this.hooks.push(this.engine.hook_add(constant('HOOK_MEM_WRITE'), (...args) => {
        try { board.write(scalar(args[2]), scalar(args[4]), scalar(args[3])); }
        catch (error) { this.failCallback(error); }
      }, undefined, region.address, region.address + region.bytes - 1));
    }
    this.hooks.push(this.engine.hook_add(constant('HOOK_CODE'), (...args) => {
      try {
        this.lastPc = scalar(args[1]);
        // Device DMA/NOR may change executable memory. Complete the current
        // instruction, then leave Unicorn before invalidating translated code.
        if (this.pendingDeviceWrites.length) {
          this.internalYield = true;
          this.invokeBackend(() => this.engine.emu_stop());
          return;
        }
        if (this.sliceInstructions >= this.instructionLimit) { this.stop(); return; }
        const address = scalar(args[1]);
        const size = scalar(args[2]);
        for (const listener of this.instructionListeners) listener(address, size, this);
        if (this.stopped || this.internalYield) return;
        this.lastStartedAddress = address;
        this.lastStartedSize = size;
        this.sliceInstructions++;
        this.totalInstructions++;
        board.tick(1);
      } catch (error) { this.failCallback(error); }
    }));
  }

  private failCallback(error: unknown) {
    this.callbackFailure = error;
    if (error instanceof WebAssembly.RuntimeError) {
      this.terminalBackendFault = String(error);
      throw error;
    }
    this.stop();
  }

  private register(name: CpuRegister): number {
    const aliases: Record<string, string> = { R13: 'SP', R14: 'LR', R15: 'PC' };
    const key = registerName(name);
    // The i32 binding owns four bytes. D/Q registers and CP_REG use wider or
    // structured values; callers must not route those through this scalar API.
    if (/^[DQ]\d+$/.test(key) || key === 'CP_REG') {
      throw new Error(`ARM register ${name} requires a wider or structured API; this adapter accepts 32-bit scalar registers`);
    }
    const value = this.module[`ARM_REG_${aliases[key] ?? key}`];
    if (typeof value !== 'number') throw new Error(`Unknown ARM register: ${name}`);
    return value;
  }

  private requireBackend() {
    if (this.backendFailed) throw new Error(`ARM backend is unavailable after a WASM trap: ${this.backendFault}. Replace this CPU worker.`);
    if (this.closed) throw new Error('CPU is closed');
  }

  private invokeBackend<T>(operation: () => T): T {
    this.requireBackend();
    try { return operation(); }
    catch (error) {
      if (error instanceof WebAssembly.RuntimeError) this.terminalBackendFault = String(error);
      throw error;
    }
  }

  readRegister(name: CpuRegister): number {
    if (this.backendFailed) {
      if (isProgramCounter(name)) return this.lastPc;
      throw new Error('Registers are unavailable after the terminal WASM trap.');
    }
    const value = this.invokeBackend(() => this.engine.reg_read_i32(this.register(name))) >>> 0;
    return value;
  }
  writeRegister(name: CpuRegister, value: number) {
    this.requireBackend();
    this.invokeBackend(() => this.engine.reg_write_i32(this.register(name), value | 0));
    if (isProgramCounter(name)) {
      if (this.executing) this.wfiCallbackPcChanged = true;
      this.lastPc = (value & 0xfffffffe) >>> 0;
    }
  }
  readMemory(address: number, length: number): Uint8Array {
    this.requireBackend();
    address >>>= 0;
    const bytes = this.invokeBackend(() => this.engine.mem_read(address, length));
    for (const pending of this.pendingDeviceWrites) {
      const begin = Math.max(address, pending.address);
      const end = Math.min(address + length, pending.address + pending.bytes.length);
      if (begin < end) bytes.set(pending.bytes.subarray(begin - pending.address, end - pending.address), begin - address);
    }
    return bytes;
  }
  writeMemory(address: number, bytes: Uint8Array) {
    this.requireBackend();
    address >>>= 0;
    if (this.executing) {
      this.pendingDeviceWrites.push({address, bytes: bytes.slice()});
      this.internalYield = true;
      this.invokeBackend(() => this.engine.emu_stop());
      return;
    }
    this.invokeBackend(() => this.engine.mem_write(address, bytes));
    if (bytes.length && this.memoryMap.some(region => (region.permissions & 4) &&
      address < region.address + region.bytes && address + bytes.length > region.address)) {
      this.invokeBackend(() => this.engine.ctl_remove_cache(address, address + bytes.length));
    }
  }
  loadMemory(address: number, bytes: Uint8Array) { this.writeMemory(address, bytes); }

  /** Retranslate an instruction after architectural state changes in its hook. */
  synchronizeInstructionState(address: number, size: number) {
    this.requireBackend();
    address >>>= 0;
    if ((address & 1) || (size !== 2 && size !== 4) || !this.memoryMap.some(region =>
      (region.permissions & 4) && address >= region.address && address + size <= region.address + region.bytes)) {
      throw new Error('Instruction state synchronization requires one mapped Thumb instruction.');
    }
    if (this.executing) {
      this.pendingInstructionInvalidations.push({address, end: address + size});
      this.internalYield = true;
      this.invokeBackend(() => this.engine.emu_stop());
    } else this.invokeBackend(() => this.engine.ctl_remove_cache(address, address + size));
  }

  /** Device writes become guest-visible before the next instruction begins. */
  queueDeviceWrite(address: number, bytes: Uint8Array) {
    this.requireBackend();
    if (this.executing) this.pendingDeviceWrites.push({address: address >>> 0, bytes: bytes.slice()});
    else this.writeMemory(address, bytes);
  }

  private readDeviceMemory(address: number, length: number): Uint8Array {
    return this.readMemory(address, length);
  }

  private drainDeviceWrites() {
    while (this.pendingDeviceWrites.length) {
      const pending = this.pendingDeviceWrites[0]!;
      this.writeMemory(pending.address, pending.bytes);
      this.pendingDeviceWrites.shift();
    }
    while (this.pendingInstructionInvalidations.length) {
      const pending = this.pendingInstructionInvalidations[0]!;
      this.invokeBackend(() => this.engine.ctl_remove_cache(pending.address, pending.end));
      this.pendingInstructionInvalidations.shift();
    }
  }

  private writeScalar(address: number, width: number, value: number) {
    if (![1, 2, 4].includes(width)) throw new Error(`Unsupported MMIO width ${width} at ${hexadecimal(address)}`);
    const bytes = new Uint8Array(width);
    for (let index = 0; index < width; index++) bytes[index] = value >>> (index * 8);
    // Scalar MMIO reads must supply this instruction's value immediately. This
    // backing range is never executable and does not invalidate translated code.
    this.invokeBackend(() => this.engine.mem_write(address, bytes));
  }

  onInstruction(listener: (address: number, size: number, cpu: ArmCPU) => void): () => void {
    this.instructionListeners.add(listener);
    return () => this.instructionListeners.delete(listener);
  }

  step(instructions: number, options: { entry?: number; until?: number } = {}): CpuStep {
    if (this.closed) throw new Error('CPU is closed');
    if (!Number.isInteger(instructions) || instructions < 1 || instructions > 1_000_000) {
      throw new Error('Instruction slice must contain 1..1,000,000 instructions');
    }
    if (this.backendFailed) return {instructions: 0, totalInstructions: this.totalInstructions,
      pc: this.lastPc, reason: 'fault', fault: this.backendFault, backendLost: true};
    this.stopped = false;
    this.callbackFailure = undefined;
    this.sliceInstructions = 0;
    this.instructionLimit = instructions;
    let fault: string | undefined;
    let consecutiveYieldRestarts = 0;
    let finalAttemptHadInternalActivity = false;
    this.wfiCallbackPcChanged = false;
    let entry = (options.entry ?? this.readRegister('pc')) | 1;
    do {
      const instructionsBeforeAttempt = this.sliceInstructions;
      this.internalYield = false;
      this.lastStartedAddress = undefined;
      this.lastStartedSize = 0;
      this.lastPc = (entry & 0xfffffffe) >>> 0;
      this.executing = true;
      try { this.engine.emu_start(entry >>> 0, options.until ?? 0, 0, instructions - this.sliceInstructions); }
      catch (error) {
        fault = String(error);
        if (error instanceof WebAssembly.RuntimeError) this.terminalBackendFault = fault;
      }
      finally { this.executing = false; }
      finalAttemptHadInternalActivity = this.internalYield || this.pendingInstructionInvalidations.length > 0;
      if (!this.backendFailed) {
        try { this.drainDeviceWrites(); }
        catch (error) {
          fault = String(error);
          if (error instanceof WebAssembly.RuntimeError) this.terminalBackendFault = fault;
        }
      }
      if (fault || this.stopped || this.sliceInstructions >= instructions || !this.internalYield) break;
      consecutiveYieldRestarts = this.sliceInstructions === instructionsBeforeAttempt ? consecutiveYieldRestarts + 1 : 0;
      if (consecutiveYieldRestarts >= 64) {
        fault = 'ARM instruction preparation made no progress after 64 internal restarts';
        break;
      }
      entry = this.readRegister('pc') | 1;
    } while (true);
    if (this.callbackFailure !== undefined) fault = String(this.callbackFailure);
    const pc = this.readRegister('pc');
    // Preserve the latest successful PC if the optional marker getter loses the backend.
    this.lastPc = pc;
    let sleep: CpuStep['sleep'];
    if (!fault && !this.backendFailed && !this.stopped && !finalAttemptHadInternalActivity &&
      !this.wfiCallbackPcChanged && options.until === undefined && this.sliceInstructions > 0 && this.sliceInstructions <= instructions) {
      try { sleep = this.classifyWfi(pc); }
      catch { if (this.backendFailed) fault = this.backendFault; }
    }
    return {
      instructions: this.sliceInstructions,
      totalInstructions: this.totalInstructions,
      pc,
      ...(sleep ? {sleep} : {}),
      reason: fault ? 'fault' : this.sliceInstructions >= instructions ? 'budget' : 'stopped',
      ...(fault ? { fault } : {}),
      ...(this.backendFailed ? {backendLost: true} : {}),
    };
  }

  private classifyWfi(pc: number): CpuStep['sleep'] {
    const address = this.lastStartedAddress;
    if (address === undefined || this.lastStartedSize !== 2 || (address & 1) || pc !== address + 2 ||
      !this.memoryMap.some(region => (region.permissions & 5) === 5 && address >= region.address && address + 2 <= region.address + region.bytes)) return undefined;
    // The pinned optional getter records real WFI helper execution for this
    // native attempt. It does not assert which native exit caused this return.
    return this.invokeBackend(() => {
      const getter = this.engine.arm_wfi_event;
      if (typeof getter !== 'function') return undefined;
      const event = getter.call(this.engine);
      if (!event || typeof event !== 'object' || Array.isArray(event)) return undefined;
      const fields = event as Record<string, unknown>;
      const kind = fields.kind, size = fields.size;
      const eventAddress = fields.address, resumePc = fields.resumePc;
      const unsigned = (value: unknown): value is number =>
        typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
      if (kind !== 'wfi' || size !== 2 || !unsigned(eventAddress) || !unsigned(resumePc) ||
        eventAddress !== address || resumePc !== pc) return undefined;
      return {kind: 'wfi', address: eventAddress, resumePc};
    });
  }

  stop() {
    this.stopped = true;
    if (!this.backendFailed && !this.closed) this.invokeBackend(() => this.engine.emu_stop());
  }
  close() {
    if (this.closed) return;
    // A trapped WASM instance may corrupt allocator/translation state. Worker
    // teardown releases it; calling uc_close or uc_hook_del can trap or hang.
    if (this.backendFailed) { this.closed = true; return; }
    try {
      for (const hook of this.hooks) this.invokeBackend(() => this.engine.hook_del(hook));
      this.invokeBackend(() => this.engine.close());
    } finally { this.closed = true; }
  }
}

export async function createCPU(board: CpuBoard, options: CpuOptions = {}): Promise<ArmCPU> {
  let factory = options.factory;
  if (!factory) {
    const vendorUrl = options.vendorUrl ?? (typeof location === 'undefined'
      ? new URL('../../../public/emulator/vendor/unicorn-arm.js', import.meta.url).href
      : new URL('/emulator/vendor/unicorn-arm.js', location.origin).href);
    const module = await import(/* @vite-ignore */ vendorUrl) as { default: UnicornFactory };
    factory = module.default;
  }
  return new ArmCPU(await factory(), board, options);
}
