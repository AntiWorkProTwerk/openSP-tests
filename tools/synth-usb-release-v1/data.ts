import {B2} from './model.ts';
import type {LocalBinary, ImageFormat} from './model.ts';
const APP1_OFFSET = 0x288000;
const APP1_MINIMUM = APP1_OFFSET + 0x800;
const BRIDGE_MAGIC = 0x32425053;
const STACK_TOP = 0x20243000;
const MAX_RECEIPT_BYTES = 128 * 1024;
const APP1_OPCODES = new Set([1, 2, 3, 5, 6]);
export function fail(message: string): never {
  throw new TypeError(message);
}

export function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${name} must be an object`);
  return value as Record<string, unknown>;
}

export function allowOnlyFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, name: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${name} contains an unsupported field`);
}

export function text(value: unknown, name: string, maximum = 512): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) fail(`${name} is invalid`);
  return value;
}

export function integer(value: unknown, name: string, minimum = 0, maximum = 0xffffffff): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${name} is invalid`);
  }
  return value;
}

export function shaText(value: unknown, name: string): string {
  const result = text(value, name, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(result)) fail(`${name} must be a SHA-256 digest`);
  return result;
}

export function rejectDuplicateJsonKeys(source: string): void {
  let offset = 0;
  const whitespace = () => { while (/\s/.test(source[offset] ?? "")) offset += 1; };
  const stringToken = (): string => {
    const start = offset++;
    while (offset < source.length) {
      if (source[offset] === "\\") { offset += 2; continue; }
      if (source[offset++] === '"') return JSON.parse(source.slice(start, offset)) as string;
    }
    throw new SyntaxError("Unclosed JSON string");
  };
  const value = (): void => {
    whitespace();
    const char = source[offset];
    if (char === '"') { stringToken(); return; }
    if (char === "[") {
      offset += 1; whitespace();
      if (source[offset] === "]") { offset += 1; return; }
      while (true) {
        value(); whitespace();
        if (source[offset] === "]") { offset += 1; return; }
        if (source[offset++] !== ",") throw new SyntaxError("Invalid JSON array");
      }
    }
    if (char === "{") {
      offset += 1; whitespace();
      const keys = new Set<string>();
      if (source[offset] === "}") { offset += 1; return; }
      while (true) {
        whitespace();
        if (source[offset] !== '"') throw new SyntaxError("Invalid JSON object key");
        const key = stringToken();
        if (keys.has(key)) throw new TypeError("Receipt contains duplicate JSON fields");
        keys.add(key); whitespace();
        if (source[offset++] !== ":") throw new SyntaxError("Invalid JSON object field");
        value(); whitespace();
        if (source[offset] === "}") { offset += 1; return; }
        if (source[offset++] !== ",") throw new SyntaxError("Invalid JSON object");
      }
    }
    const start = offset;
    while (offset < source.length && !/[\s,\]}]/.test(source[offset])) offset += 1;
    if (start === offset) throw new SyntaxError("Invalid JSON value");
    JSON.parse(source.slice(start, offset));
  };
  value(); whitespace();
  if (offset !== source.length) throw new SyntaxError("Unexpected JSON content");
}

export function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export function hexDigest(bytes: Uint8Array): Promise<string> {
  const provider = globalThis.crypto?.subtle;
  if (!provider) throw new Error("Web Crypto SHA-256 is unavailable in this context");
  return provider.digest("SHA-256", ownedBytes(bytes)).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function copyBinary(file: LocalBinary, name: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!file || typeof file.arrayBuffer !== "function" || !Number.isSafeInteger(file.size)) fail(`${name} is not a local binary file`);
  if (file.size < APP1_MINIMUM || file.size > B2.maximum) fail(`${name} exceeds the B2 APP1 extent`);
  const snapshot = new Uint8Array(await file.arrayBuffer());
  if (snapshot.byteLength !== file.size) fail(`${name} changed while it was being read`);
  return new Uint8Array(snapshot);
}

export async function readJsonFile(file: LocalBinary, name: string): Promise<{ bytes: Uint8Array; value: Record<string, unknown>; sha256: string }> {
  if (!file || typeof file.arrayBuffer !== "function" || !Number.isSafeInteger(file.size) || file.size < 2 || file.size > MAX_RECEIPT_BYTES) {
    fail(`${name} is outside the receipt size bound`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) fail(`${name} changed while it was being read`);
  let source: string;
  let parsed: unknown;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    rejectDuplicateJsonKeys(source);
    parsed = JSON.parse(source);
  } catch (error) {
    throw new TypeError(`${name} is not valid bounded JSON without duplicate fields`, { cause: error });
  }
  return { bytes, value: record(parsed, name), sha256: await hexDigest(bytes) };
}

export function packageFilePin(value: unknown, name: string): { bytes: number; sha256: string } {
  const entry = record(value, name);
  const file = entry.file === undefined ? entry : record(entry.file, `${name}.file`);
  const bytes = integer(entry.bytes ?? file.bytes, `${name}.bytes`, 1, B2.maximum);
  const sha256 = shaText(entry.sha256 ?? file.sha256, `${name}.sha256`);
  return { bytes, sha256 };
}

export function app1Metadata(bytes: Uint8Array, expectedAbi: unknown, name: string): { abi: 1 | 2; format: ImageFormat; paddedBytes: number; sectors: number; crc32: number } {
  if (expectedAbi !== 1 && expectedAbi !== 2) fail(`${name}.abi must be 1 or 2`);
  if (bytes.byteLength < APP1_MINIMUM || bytes.byteLength > B2.maximum || (bytes.byteLength & 3) !== 0) {
    fail(`${name} has an unsupported APP1 extent`);
  }
  if (bytes[0] !== 0x87 || bytes[1] !== 0xf2 || bytes[2] !== 0xfe || bytes[3] !== 0xbf) {
    fail(`${name} does not start with the qualified APP1 bridge branch`);
  }

  const tail = bytes.subarray(APP1_OFFSET);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const magic = new TextDecoder("ascii").decode(tail.subarray(0x200, 0x208));
  const version = view.getUint32(0x208, true);
  const tailBytes = view.getUint32(0x20c, true);
  const runtimeAddress = view.getUint32(0x210, true);
  const runtimeBytes = view.getUint32(0x214, true);
  const runtimeOffset = view.getUint32(0x218, true);
  const stack = view.getUint32(0x21c, true);
  if (magic !== "SPUAFW10" || version !== expectedAbi || tailBytes !== tail.byteLength ||
      runtimeAddress !== 0x80000000 || runtimeOffset !== 0x400 || stack !== STACK_TOP ||
      runtimeBytes < 0x400 || runtimeBytes > tail.byteLength - 0x400 ||
      view.getUint32(0x400, true) !== STACK_TOP) {
    fail(`${name} does not match its qualified SPUAFW10 bridge header`);
  }

  if (expectedAbi === 1) {
    if (tail.byteLength > 0x10000) fail(`${name} exceeds the ABI1 B1 tail limit`);
  } else {
    if (tail.byteLength < 0x240) fail(`${name} is too short for ABI2 metadata`);
    const bridgeBytes = view.getUint32(0x224, true);
    const dataAddress = view.getUint32(0x228, true);
    const dataBytes = view.getUint32(0x22c, true);
    const payloadOffset = view.getUint32(0x230, true);
    const payloadBytes = view.getUint32(0x234, true);
    const reserved0 = view.getUint32(0x238, true);
    const reserved1 = view.getUint32(0x23c, true);
    if (view.getUint32(0x220, true) !== BRIDGE_MAGIC || reserved0 !== 0 || reserved1 !== 0 ||
        bridgeBytes < 0x800 || bridgeBytes > 0x10000 || (bridgeBytes & 3) !== 0 ||
        runtimeBytes > 0x10000 || (runtimeBytes & 31) !== 0 || runtimeBytes > bridgeBytes - 0x400 ||
        dataBytes !== bridgeBytes - 0x400 - runtimeBytes || (dataBytes & 3) !== 0 ||
        dataAddress < 0x2023f000 || dataAddress > 0x20242000 || (dataAddress & 3) !== 0 ||
        dataBytes > 0x20242000 - dataAddress ||
        payloadOffset < ((bridgeBytes + 31) & ~31) || (payloadOffset & 31) !== 0 ||
        payloadOffset > tail.byteLength || payloadBytes === 0 || (payloadBytes & 3) !== 0 ||
        payloadBytes !== tail.byteLength - payloadOffset) {
      fail(`${name} does not match the bounded ABI2 bridge/data/payload intervals`);
    }
  }

  const paddedBytes = Math.ceil(bytes.byteLength / B2.sectorBytes) * B2.sectorBytes;
  if (paddedBytes > B2.maximum) fail(`${name} padded extent exceeds the B2 writer capacity`);
  return {
    abi: expectedAbi,
    format: expectedAbi === 1 ? "spuafw10-abi1" : "spuafw10-abi2",
    paddedBytes,
    sectors: paddedBytes / B2.sectorBytes,
    crc32: crc32(bytes),
  };
}

