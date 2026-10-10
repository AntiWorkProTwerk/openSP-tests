/**
 * Qualified Thumb PC transfers for the host-owned Cortex-M exception model.
 * Arm DDI0403E.e: A2-31, A7-215, A7-242..251, A7-319..320, B1-539..543.
 * https://documentation-service.arm.com/static/606dc36485368c4c2b1bf62f
 * This is a bounded decoder, not a replacement instruction engine. All reads
 * are transactional ordinary-memory reads; fault rollback/ICI are not modeled.
 */
import { EXC_RETURN, ExceptionModelError } from './exceptions.ts';

export interface ReturnTransferCPU {
  readRegister(name: string): number;
  writeRegister(name: string, value: number): void;
  readMemory(address: number, length: number): Uint8Array;
  readonly memoryMap?: ReadonlyArray<{ address: number; bytes: number; permissions: number }>;
}
interface RegisterValue { readonly name: string; readonly value: number }
interface MemoryWord { readonly address: number; readonly value: number }
export interface PcTransferPlan {
  readonly instructionAddress: number;
  readonly instructionBytes: readonly number[];
  readonly kind: 'bx' | 'pop' | 'ldmia' | 'ldmdb' | 'ldr';
  readonly target: number;
  readonly handlerException: number;
  readonly loads: readonly RegisterValue[];
  readonly writeback: RegisterValue | null;
  /** General LDM writeback is qualified only when hardware unstack cannot alter its base. */
  readonly qualifiedWriteback: boolean;
  readonly inputs: readonly RegisterValue[];
  readonly memoryWords: readonly MemoryWord[];
  readonly xpsr: number;
  readonly control: number;
}
const tokens = new Set<number>(Object.values(EXC_RETURN));
const name = (index: number) => index === 13 ? 'sp' : index === 14 ? 'lr' : `r${index}`;
const count = (mask: number) => { let result = 0; for (let index = 0; index < 16; index++) result += mask >>> index & 1; return result; };
const error = (code: string, message: string): never => { throw new ExceptionModelError(code, message); };
function normalMemory(cpu: ReturnTransferCPU, address: number, length: number): void {
  // Cortex-M default device/system regions are excluded. Host reads of their
  // backing bytes cannot qualify an instruction's MMIO side effects or value.
  const end = address + length;
  const ordinary = address >= 0 && end <= 0x40000000 || address >= 0x60000000 && end <= 0xa0000000;
  if (!ordinary || end > 0x100000000 || (cpu.memoryMap && !cpu.memoryMap.some(region =>
    (region.permissions & 1) && address >= region.address && end <= region.address + region.bytes))) {
    error('unqualified-return-memory', 'PC transfer prediction requires mapped ordinary memory; device/system reads are not modeled.');
  }
}
function read(cpu: ReturnTransferCPU, address: number, length: number): Uint8Array {
  normalMemory(cpu, address, length);
  const bytes = cpu.readMemory(address, length);
  if (bytes.byteLength !== length) error('return-transfer-read', 'The CPU returned incomplete PC-transfer memory.');
  return bytes;
}
function conditionPassed(xpsr: number, it: number): boolean {
  if (!it) return true;
  const n = Boolean(xpsr & 0x80000000), z = Boolean(xpsr & 0x40000000);
  const c = Boolean(xpsr & 0x20000000), v = Boolean(xpsr & 0x10000000), condition = it >>> 4;
  const tests = [z, c, n, v, c && !z, n === v, !z && n === v, true];
  return condition === 15 ? false : condition & 1 ? !tests[condition >>> 1] : tests[condition >>> 1]!;
}

/** Decode a passing, valid PC-writing instruction; ordinary branch targets are retained for testing. */
export function decodeThumbPcTransfer(cpu: ReturnTransferCPU, address: number, size: number): PcTransferPlan | null {
  address >>>= 0;
  if ((address & 1) || (size !== 2 && size !== 4)) error('invalid-return-instruction', 'PC transfer decoding requires an aligned two- or four-byte Thumb instruction.');
  const xpsr = cpu.readRegister('xpsr') >>> 0;
  if (!(xpsr & 0x01000000)) return null;
  const it = ((xpsr >>> 25) & 3) | ((xpsr >>> 8) & 0xfc);
  if (!conditionPassed(xpsr, it)) return null;
  const bytes = read(cpu, address, size), h1 = bytes[0]! | bytes[1]! << 8;
  const h2 = size === 4 ? bytes[2]! | bytes[3]! << 8 : 0;
  const inputs: RegisterValue[] = [], loads: RegisterValue[] = [], memoryWords: MemoryWord[] = [];
  let writeback: RegisterValue | null = null, qualifiedWriteback = true;
  const register = (index: number): number => {
    if (index === 15) return (address + 4) >>> 0;
    const registerName = name(index), value = cpu.readRegister(registerName) >>> 0;
    if (!inputs.some(input => input.name === registerName)) inputs.push(Object.freeze({ name: registerName, value }));
    return value;
  };
  const word = (location: number): number => {
    if (location & 3) error('unaligned-return-memory', 'A PC load requires a word-aligned data address.');
    const data = read(cpu, location, 4), value = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true);
    memoryWords.push(Object.freeze({ address: location, value }));
    return value;
  };
  let kind: PcTransferPlan['kind'], target: number;
  if (size === 2 && (h1 & 0xff87) === 0x4700) {
    kind = 'bx'; target = register(h1 >>> 3 & 15);
  } else if (size === 2 && (h1 & 0xff00) === 0xbd00) {
    kind = 'pop';
    const mask = (h1 & 255) | 0x8000, base = register(13), total = count(mask);
    target = word((base + (total - 1) * 4) >>> 0);
    for (let index = 0, offset = 0; index < 8; index++) if (mask & 1 << index) {
      loads.push(Object.freeze({ name: name(index), value: word((base + offset) >>> 0) })); offset += 4;
    }
    writeback = Object.freeze({ name: 'sp', value: (base + total * 4) >>> 0 });
  } else if (size === 4 && ((h1 & 0xffd0) === 0xe890 || (h1 & 0xffd0) === 0xe910)) {
    const n = h1 & 15, wb = Boolean(h1 & 32), mask = h2, total = count(mask);
    if (!(mask & 0x8000)) return null;
    if (n === 15 || (mask & 0x6000) || total < 2 || wb && (mask & 1 << n)) {
      error('unqualified-return-encoding', 'The multiple-load PC transfer has reserved or unpredictable operands.');
    }
    kind = h1 === 0xe8bd ? 'pop' : (h1 & 0xffd0) === 0xe890 ? 'ldmia' : 'ldmdb';
    const base = register(n), start = kind === 'ldmdb' ? (base - total * 4) >>> 0 : base;
    target = word((start + (total - 1) * 4) >>> 0);
    for (let index = 0, offset = 0; index < 13; index++) if (mask & 1 << index) {
      loads.push(Object.freeze({ name: name(index), value: word((start + offset) >>> 0) })); offset += 4;
    }
    if (wb) {
      qualifiedWriteback = kind === 'pop' || n >= 4 && n <= 11;
      writeback = Object.freeze({ name: name(n), value: (base + (kind === 'ldmdb' ? -4 : 4) * total) >>> 0 });
    }
  } else if (size === 4 && (h2 & 0xf000) === 0xf000) {
    kind = 'ldr'; let location: number;
    if ((h1 & 0xff7f) === 0xf85f) {
      const base = ((address + 4) & ~3) >>> 0;
      location = (base + (h1 & 128 ? 1 : -1) * (h2 & 0xfff)) >>> 0;
    } else if ((h1 & 0xfff0) === 0xf8d0) {
      location = (register(h1 & 15) + (h2 & 0xfff)) >>> 0;
    } else if ((h1 & 0xfff0) === 0xf850 && (h2 & 0xffc0) === 0xf000) {
      const m = h2 & 15;
      if (m === 13 || m === 15) error('unqualified-return-encoding', 'LDR PC register offset cannot use SP or PC.');
      location = (register(h1 & 15) + (register(m) << (h2 >>> 4 & 3))) >>> 0;
    } else if ((h1 & 0xfff0) === 0xf850 && (h2 & 0xf800) === 0xf800) {
      const n = h1 & 15, index = Boolean(h2 & 0x400), add = Boolean(h2 & 0x200), wb = Boolean(h2 & 0x100);
      if ((!index && !wb) || (index && add && !wb)) error('unqualified-return-encoding', 'Undefined LDR addressing or an LDRT PC destination cannot qualify an exception return.');
      const base = register(n), updated = (base + (add ? 1 : -1) * (h2 & 255)) >>> 0;
      location = index ? updated : base;
      if (wb) writeback = Object.freeze({ name: name(n), value: updated });
      if (h1 === 0xf85d && h2 === 0xfb04) kind = 'pop'; // Single-register POP T3.
    } else return null;
    target = word(location);
  } else return null;
  if (it && (it & 7)) error('unqualified-return-it', 'A PC transfer must be the final instruction of its IT block.');
  return Object.freeze({ instructionAddress: address, instructionBytes: Object.freeze([...bytes]), kind, target,
    handlerException: xpsr & 511, loads: Object.freeze(loads), writeback, qualifiedWriteback,
    inputs: Object.freeze(inputs), memoryWords: Object.freeze(memoryWords), xpsr,
    control: cpu.readRegister('control') & 3 });
}

/** Returns an instruction-backed strict raw token; an arbitrary fetch PC is never input. */
export function captureExceptionReturn(cpu: ReturnTransferCPU, address: number, size: number, activeException: number): PcTransferPlan | null {
  if (!activeException) return null;
  if ((cpu.readRegister('xpsr') & 511) !== activeException) error('untracked-handler', 'Return instruction capture requires matching CPU and modeled Handler state.');
  const plan = decodeThumbPcTransfer(cpu, address, size);
  if (!plan || plan.target >>> 28 !== 15) return null;
  if (!tokens.has(plan.target)) error('invalid-exc-return', 'The instruction supplied a reserved or non-Thumb raw EXC_RETURN token.');
  if (!plan.qualifiedWriteback) error('unqualified-return-writeback', 'General LDM writeback through hardware-restored or banked registers requires post-return modeling.');
  return plan;
}

/** Apply only the software instruction's loads/writeback; never restore a hidden context or write PC. */
export function applyPcTransferEffects(cpu: ReturnTransferCPU, plan: PcTransferPlan): void {
  if (!plan.qualifiedWriteback) error('unqualified-return-writeback', 'This transfer has unqualified mode-changing writeback.');
  const pc = cpu.readRegister('pc') >>> 0;
  if ((pc & ~1) >>> 0 !== plan.instructionAddress || cpu.readRegister('xpsr') >>> 0 !== plan.xpsr ||
    (cpu.readRegister('control') & 3) !== plan.control || plan.inputs.some(input => (cpu.readRegister(input.name) >>> 0) !== input.value)) {
    error('stale-return-transfer', 'CPU state changed after the PC-transfer plan was captured.');
  }
  const code = read(cpu, plan.instructionAddress, plan.instructionBytes.length);
  if (plan.instructionBytes.some((byte, index) => code[index] !== byte) || plan.memoryWords.some(item => {
    const data = read(cpu, item.address, 4);
    return new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true) !== item.value;
  })) error('stale-return-transfer', 'Instruction or source memory changed after PC-transfer capture.');
  // POP updates its current SP before loading. LDR has no other destination,
  // and qualified general LDM bases cannot be altered by hardware unstacking.
  if (plan.kind === 'pop' && plan.writeback) cpu.writeRegister(plan.writeback.name, plan.writeback.value);
  for (const load of plan.loads) cpu.writeRegister(load.name, load.value);
  if (plan.kind !== 'pop' && plan.writeback) cpu.writeRegister(plan.writeback.name, plan.writeback.value);
}
