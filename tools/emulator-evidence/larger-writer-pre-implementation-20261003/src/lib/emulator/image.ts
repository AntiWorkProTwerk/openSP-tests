/**
 * Raw firmware admission for the captured SP resident profile.
 * Sources: RESIDENT_BOOT.md, sdk/validate_update.py,
 * sdk/examples/boot_chain_p1/derive_profile.py, original_r13/app1.ld,
 * and boot_chain_p7_core/updater.c in the adjacent firmware workspace.
 * No scatter regions are reconstructed here: startup executes uploaded bytes.
 */
export const FLASH_BASE = 0x60000000;
export const FLASH_BYTES = 0x400000;
export const APP1_BASE = 0x60080000;
export const MAX_APP1_BYTES = 0x37f000;
export const APP1_HANDOFF_STACK = 0x202435b0;
export const RESIDENT_ENTRY_STACK = 0x202435b8;

export type FirmwareFormat = 'app1' | 'flash';
export interface FirmwareImageOptions {
  format: FirmwareFormat;
  name?: string;
}
export interface FirmwareImage {
  bytes: Uint8Array<ArrayBuffer>;
  format: FirmwareFormat;
  flashBase: number;
  entry: number;
  stack: number;
  sha256: string;
  limits: string[];
  abi?: 1 | 2;
  marker?: number;
  checkpoint: 'resident-app1-handoff' | 'rom-resident-entry';
}

const STOCK_V552_SHA = '4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80';
const STOCK_APP0_SHA = '3e35ff30137f741a715566e205384f9b434ca7ac3847e247bad3f0c9c8a2bd23';
const R13_SHA = '4891fd9451cd107f6f50f4fb85d75f538cf5b2eb3c7fb2680f36719b32f67e8a';
const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

function requireImage(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function checkEntry(bytes: Uint8Array, offset: number): void {
  requireImage(offset >= 0 && offset + 4 <= bytes.length, 'Entry is outside the uploaded image or truncated.');
  const prefix = bytes.subarray(offset, offset + 4);
  requireImage(!prefix.every(value => value === 0) && !prefix.every(value => value === 255), 'Firmware entry is blank.');
}

function imageCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let offset = 0; offset < bytes.length; offset++) {
    const value = offset >= 0x220 && offset < 0x224 ? 0 : bytes[offset]!;
    crc = (crc >>> 8) ^ crcTable[(crc ^ value) & 255]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectOriginalAbi(bytes: Uint8Array): 1 | 2 | undefined {
  if (ascii(bytes, 0x200, 4) !== 'SPUA') return undefined;
  requireImage(bytes.length >= 0x220, 'Original APP1 header is truncated.');
  const magic = ascii(bytes, 0x200, 8);
  requireImage(magic === 'SPUAFW10' || magic === 'SPUAFW20', 'Original APP1 header magic is unsupported.');
  const abi = magic === 'SPUAFW10' ? 1 : 2;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (offset: number) => view.getUint32(offset, true);
  requireImage(word(0x208) === abi, 'Original APP1 ABI version contradicts its magic.');
  requireImage(word(0x20c) === bytes.length, 'Original APP1 declared length differs from the uploaded bytes.');
  requireImage(bytes.length >= 0x404 && (bytes.length & 3) === 0, 'Original APP1 runtime is truncated or misaligned.');
  requireImage(word(0x210) === 0x80000000 && word(0x218) === 0x400,
    'Original APP1 runtime address or source offset is unsupported.');
  requireImage(word(0x214) > 0 && word(0x214) <= bytes.length - 0x400,
    'Original APP1 runtime exceeds the uploaded image.');
  requireImage(word(0x21c) === 0x20243000 && word(0x400) === 0x20243000,
    'Original APP1 stack declaration or runtime vectors contradict this ABI.');
  if (abi === 2) {
    requireImage(bytes.length >= 0x800, 'Original ABI2 APP1 is shorter than its minimum image.');
    requireImage(word(0x224) === 0, 'Original ABI2 APP1 flags are unsupported.');
    requireImage(word(0x220) === imageCrc(bytes), 'Original ABI2 APP1 CRC does not match the uploaded image.');
  }
  return abi;
}

function inspectFlash(bytes: Uint8Array): number {
  requireImage(bytes.length === FLASH_BYTES, 'A full flash image must contain exactly 4 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (offset: number) => view.getUint32(offset, true);
  requireImage(ascii(bytes, 0, 4) === 'FCFB' && word(0x50) === FLASH_BYTES,
    'Full flash image is missing the 4 MiB FlexSPI configuration block.');
  // These locations are measured in the captured resident, not Cortex-M vectors.
  requireImage(word(0x1000) === 0x412000d1 && word(0x1014) === FLASH_BASE + 0x1000,
    'Resident IVT header or self pointer is invalid.');
  requireImage(word(0x1008) === 0 && word(0x101c) === 0,
    'Resident IVT reserved fields are invalid.');
  requireImage(word(0x1010) === FLASH_BASE + 0x1020, 'Resident IVT boot-data pointer is invalid.');
  requireImage(word(0x1020) === FLASH_BASE && word(0x1024) === FLASH_BYTES && word(0x1028) === 0,
    'Resident boot data does not describe an ordinary 4 MiB flash image.');
  const csf = word(0x1018);
  requireImage(csf === 0 || (csf >= FLASH_BASE + 0x2000 && csf < APP1_BASE),
    'Resident IVT security pointer is outside the resident region.');
  const entry = word(0x1004);
  requireImage((entry & 1) === 1 && entry >= FLASH_BASE + 0x2001 && entry < APP1_BASE,
    'Resident IVT entry must be a Thumb address inside resident code.');
  checkEntry(bytes, (entry & ~1) - FLASH_BASE);
  const dcd = word(0x100c);
  if (dcd !== 0) {
    requireImage(dcd === FLASH_BASE + 0x1030, 'Resident IVT DCD pointer is invalid.');
    const end = 0x1030 + view.getUint16(0x1031, false);
    requireImage(bytes[0x1030] === 0xd2 && bytes[0x1033] === 0x41 && end >= 0x1034 && end <= 0x2000,
      'Resident DCD header or bounds are invalid.');
    let command = 0x1034;
    while (command < end) {
      requireImage(command + 4 <= end, 'Resident DCD command header is truncated.');
      const length = view.getUint16(command + 1, false);
      requireImage(length >= 4 && (length & 3) === 0 && command + length <= end,
        'Resident DCD command exceeds its declared bounds.');
      command += length;
    }
  }
  return entry;
}

export async function loadFirmwareImage(
  input: Uint8Array | ArrayBuffer,
  options: FirmwareImageOptions,
): Promise<FirmwareImage> {
  requireImage(options?.format === 'app1' || options?.format === 'flash', 'Choose APP1 or full flash format explicitly.');
  requireImage(input instanceof Uint8Array || input instanceof ArrayBuffer, 'Firmware must be raw binary bytes.');
  const source = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  // Own a stable copy before asynchronous hashing, including subarray inputs.
  const owned = new Uint8Array(source.byteLength);
  owned.set(source);
  requireImage(owned.length >= 4, 'Firmware image is empty or truncated.');
  requireImage(!/APP0(?:W)?(?:\.|$)/i.test(options.name ?? ''), 'APP0 is a companion image, not an APP1 or resident image.');
  requireImage(ascii(owned, 0, 2) !== 'PK' && !/\.zip$/i.test(options.name ?? ''), 'Select an extracted raw firmware image, not a ZIP archive.');
  requireImage(ascii(owned, 0, 4) !== '\x7fELF', 'Select a raw firmware image, not an ELF executable.');
  const limits = [
    'Structural admission does not prove firmware bootability or physical device behavior.',
    'The emulator executes the uploaded startup bytes; it does not substitute reconstructed scatter regions.',
  ];
  let entry: number;
  let abi: 1 | 2 | undefined;
  if (options.format === 'app1') {
    requireImage(owned.length <= MAX_APP1_BYTES, 'APP1 exceeds the 0x37F000-byte resident application slot.');
    requireImage(ascii(owned, 0, 4) !== 'FCFB', 'A resident flash image cannot be loaded as APP1.');
    checkEntry(owned, 0);
    abi = inspectOriginalAbi(owned);
    entry = APP1_BASE | 1;
    limits.push('APP1 starts at the captured resident handoff, MSP 0x202435B0 and BASEPRI 16. No reset-vector lookup or cold ROM boot occurs.');
    if (!abi) limits.push('This application has no recognized original ABI header; its instruction completeness and runtime assumptions are unknown.');
  } else {
    entry = inspectFlash(owned);
    limits.push('Full flash starts at the IVT resident entry with an assumed MSP 0x202435B8. ROM execution, DCD side effects and security authentication are unmodeled.');
  }
  requireImage(Boolean(globalThis.crypto?.subtle), 'Local SHA-256 requires Web Crypto in a secure browser context.');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', owned.buffer));
  const sha256 = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
  requireImage(sha256 !== STOCK_APP0_SHA, 'The bytes match the pinned stock APP0 companion image, not APP1.');
  if (sha256 === STOCK_V552_SHA) limits.push('The bytes match the pinned stock v5.52 APP1. Complete board and sampler behavior still require verification.');
  const result: FirmwareImage = {
    bytes: owned,
    format: options.format,
    flashBase: options.format === 'app1' ? APP1_BASE : FLASH_BASE,
    entry,
    stack: options.format === 'app1' ? APP1_HANDOFF_STACK : RESIDENT_ENTRY_STACK,
    sha256,
    limits,
    checkpoint: options.format === 'app1' ? 'resident-app1-handoff' : 'rom-resident-entry',
  };
  if (abi) result.abi = abi;
  if (sha256 === R13_SHA) result.marker = 0x523d0001;
  return result;
}
