// Build openSynth from the visitor's own official Roland update, entirely in the browser.
// The patch holds only openSynth's own bytes plus copy instructions that point
// into the visitor's file; see tools/opensynth-patcher/make-patch.mjs.

export const PATCH_FORMAT = 'opensynth-binpatch/1';
const MAGIC = 'OSPATCH1';

export interface PatchHeader {
  format: typeof PATCH_FORMAT;
  zipEntry: string;
  input: {name: string; bytes: number; sha256: string};
  output: {name: string; bytes: number; sha256: string};
}
export interface ParsedPatch {header: PatchHeader; body: Bytes; bodyStart: number}
export type Stage = 'verifying' | 'patching' | 'checking';

type Bytes = Uint8Array<ArrayBuffer>;

/** An expected refusal whose message is safe to show to the visitor. */
export class PatchError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

const damaged = () => new PatchError('The openSynth patch on this page failed its check. Reload the page and try again.', 'patch-damaged');
const badZip = () => new PatchError('This ZIP is damaged or incomplete. Download it from Roland again.', 'zip-damaged');
const wrongFile = () => new PatchError("This isn't Roland's SP-404MKII v5.52 update. Download v5.52 from Roland and drop that ZIP, or the SP404MKII_APP1.bin inside it. Other versions and changed files don't work.", 'wrong-file');

export async function sha256Hex(bytes: Bytes): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Check the magic, header and every operation's bounds before any byte is written. */
export function parsePatch(bytes: Bytes): ParsedPatch {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 13 || new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) throw damaged();
  const length = view.getUint32(8, true);
  if (12 + length >= bytes.length) throw damaged();
  let header: PatchHeader;
  try { header = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(12, 12 + length))); } catch { throw damaged(); }
  if (header?.format !== PATCH_FORMAT) throw new PatchError('This patch needs a newer patcher. Reload the page and try again.', 'patch-format');
  const valid = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= 64 * 1024 * 1024;
  if (!valid(header.input?.bytes) || !valid(header.output?.bytes) || !/^[0-9a-f]{64}$/.test(header.input?.sha256) || !/^[0-9a-f]{64}$/.test(header.output?.sha256) || typeof header.zipEntry !== 'string') throw damaged();
  // Walk the operations once so a short or malformed patch is refused up front.
  let p = 12 + length, out = 0;
  for (;;) {
    if (p >= bytes.length) throw damaged();
    const op = bytes[p++];
    if (op === 0) break;
    if (p + 4 > bytes.length) throw damaged();
    if (op === 1) {
      if (p + 8 > bytes.length) throw damaged();
      const from = view.getUint32(p, true), n = view.getUint32(p + 4, true);
      if (n === 0 || from + n > header.input.bytes) throw damaged();
      out += n; p += 8;
    } else if (op === 2) {
      const n = view.getUint32(p, true);
      if (n === 0 || p + 4 + n > bytes.length) throw damaged();
      out += n; p += 4 + n;
    } else throw damaged();
  }
  if (p !== bytes.length || out !== header.output.bytes) throw damaged();
  return {header, body: bytes, bodyStart: 12 + length};
}

async function inflateRaw(data: Bytes, size: number): Promise<Bytes> {
  try {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    if (out.length !== size) throw badZip();
    return out;
  } catch (error) { throw error instanceof PatchError ? error : badZip(); }
}

/** Return the named entry from a ZIP, or the input itself when it is not a ZIP. */
export async function extractEntry(bytes: Bytes, entry: string): Promise<Bytes> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint32(0, true) !== 0x04034b50) return bytes;
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw badZip();
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw badZip();
    const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true), size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true), extra = view.getUint16(p + 30, true), comment = view.getUint16(p + 32, true), local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    if (name.split('/').pop() === entry) {
      if (flags & 1) throw badZip();
      if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw badZip();
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + compressed);
      if (data.length !== compressed) throw badZip();
      if (method === 0) { if (size !== compressed) throw badZip(); return data.slice(); }
      if (method === 8) return inflateRaw(data, size);
      throw new PatchError('This ZIP uses a compression method the patcher cannot read. Use the original ZIP from Roland.', 'zip-method');
    }
    p += 46 + nameLength + extra + comment;
  }
  throw new PatchError(`This ZIP doesn't contain ${entry}. Drop Roland's SP-404MKII v5.52 system update ZIP.`, 'zip-entry');
}

/**
 * Verify the official input, rebuild the openSynth image and verify the result.
 * `expectedPatchSha256` pins the patch file this page was published with.
 */
export async function buildFirmware(
  patchBytes: Bytes,
  file: Bytes,
  expectedPatchSha256: string,
  progress: (stage: Stage, fraction: number) => void = () => {},
): Promise<{output: Bytes; sha256: string; name: string}> {
  progress('verifying', 0);
  if (await sha256Hex(patchBytes) !== expectedPatchSha256) throw damaged();
  const {header, body, bodyStart} = parsePatch(patchBytes);
  const input = await extractEntry(file, header.zipEntry);
  progress('verifying', 0.5);
  if (input.length !== header.input.bytes || await sha256Hex(input) !== header.input.sha256) throw wrongFile();
  progress('verifying', 1);

  const out = new Uint8Array(header.output.bytes);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let p = bodyStart, o = 0, lastReport = 0;
  for (;;) {
    const op = body[p++];
    if (op === 0) break;
    if (op === 1) {
      const from = view.getUint32(p, true), n = view.getUint32(p + 4, true);
      out.set(input.subarray(from, from + n), o); o += n; p += 8;
    } else {
      const n = view.getUint32(p, true);
      out.set(body.subarray(p + 4, p + 4 + n), o); o += n; p += 4 + n;
    }
    if (o - lastReport > 65536) { lastReport = o; progress('patching', o / out.length); }
  }
  progress('patching', 1);

  progress('checking', 0);
  const sha256 = await sha256Hex(out);
  if (o !== out.length || sha256 !== header.output.sha256) {
    throw new PatchError("The finished file didn't match openSynth's checksum, so it wasn't offered. Reload the page and try again.", 'output-mismatch');
  }
  progress('checking', 1);
  return {output: out, sha256, name: header.output.name};
}
