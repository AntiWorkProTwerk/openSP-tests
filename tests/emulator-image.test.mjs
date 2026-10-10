import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {loadFirmwareImage, APP1_BASE, FLASH_BASE, FLASH_BYTES, MAX_APP1_BYTES} from '../src/lib/emulator/image.ts';

const app = (length = 4) => {
  const bytes = new Uint8Array(length);
  bytes.set([0xfe, 0xe7, 0xfe, 0xe7]); // Synthetic Thumb self-loop, not a firmware package.
  return bytes;
};
const put = (bytes, offset, value) => new DataView(bytes.buffer).setUint32(offset, value, true);
const crc = bytes => {
  let value = 0xffffffff;
  for (let offset = 0; offset < bytes.length; offset++) {
    value ^= offset >= 0x220 && offset < 0x224 ? 0 : bytes[offset];
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
function abiImage(abi = 1, length = 0x800) {
  const bytes = app(length);
  const fields = [0x41555053, abi === 1 ? 0x30315746 : 0x30325746, abi, length,
    0x80000000, length - 0x400, 0x400, 0x20243000];
  fields.forEach((word, index) => put(bytes, 0x200 + index * 4, word));
  put(bytes, 0x400, 0x20243000);
  if (abi === 2) put(bytes, 0x220, crc(bytes));
  return bytes;
}
function flashImage() {
  const bytes = new Uint8Array(FLASH_BYTES);
  bytes.set(new TextEncoder().encode('FCFB'));
  put(bytes, 0x50, FLASH_BYTES);
  [0x412000d1, FLASH_BASE + 0x2001, 0, FLASH_BASE + 0x1030,
    FLASH_BASE + 0x1020, FLASH_BASE + 0x1000, 0, 0]
    .forEach((word, index) => put(bytes, 0x1000 + index * 4, word));
  [FLASH_BASE, FLASH_BYTES, 0].forEach((word, index) => put(bytes, 0x1020 + index * 4, word));
  bytes.set([0xd2, 0, 4, 0x41], 0x1030);
  bytes.set(app(), 0x2000);
  return bytes;
}
const options = {format: 'app1'};

test('APP1 uses the captured direct Thumb handoff and retains the raw bytes', async () => {
  const bytes = app(32);
  put(bytes, 4, 0x80001001); // Must never be mistaken for a Cortex-M reset vector.
  const result = await loadFirmwareImage(bytes, options);
  assert.equal(result.entry, APP1_BASE + 1);
  assert.equal(result.stack, 0x202435b0);
  assert.equal(result.flashBase, APP1_BASE);
  assert.equal(result.checkpoint, 'resident-app1-handoff');
  assert.equal(result.abi, undefined);
  assert.equal(result.marker, undefined);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.match(result.limits.join(' '), /No reset-vector lookup/);
});

test('loader snapshots subarray and ArrayBuffer inputs before asynchronous hashing', async () => {
  const backing = new Uint8Array(12);
  backing.set(app(), 4);
  const input = backing.subarray(4, 8);
  const pending = loadFirmwareImage(input, options);
  backing.fill(0);
  assert.deepEqual((await pending).bytes, app());
  const buffer = app().buffer;
  const bufferPending = loadFirmwareImage(buffer, options);
  new Uint8Array(buffer).fill(255);
  assert.deepEqual((await bufferPending).bytes, app());
});

test('APP1 admission covers the full application slot beyond historical 64 KiB', async () => {
  assert.equal((await loadFirmwareImage(app(0x10004), options)).bytes.length, 0x10004);
  assert.equal((await loadFirmwareImage(app(MAX_APP1_BYTES), options)).bytes.length, MAX_APP1_BYTES);
  await assert.rejects(loadFirmwareImage(app(MAX_APP1_BYTES + 1), options), /exceeds/);
});

test('container, companion-image, blank and truncated inputs are refused', async () => {
  for (const bytes of [new Uint8Array(), new Uint8Array(3), new Uint8Array(4), new Uint8Array(4).fill(255)]) {
    await assert.rejects(loadFirmwareImage(bytes, options), /empty|truncated|blank/);
  }
  for (const prefix of ['PK\x03\x04', '\x7fELF', 'FCFB']) {
    await assert.rejects(loadFirmwareImage(new TextEncoder().encode(prefix), options), /ZIP|ELF|resident/);
  }
  await assert.rejects(loadFirmwareImage(app(), {format: 'app1', name: 'SP404MKII_APP0.bin'}), /APP0/);
  await assert.rejects(loadFirmwareImage(app(), {format: 'flash', name: 'SP404MKII_APP0W.bin'}), /APP0/);
  await assert.rejects(loadFirmwareImage(app(), {format: 'app1', name: 'update.ZIP'}), /ZIP/);
  await assert.rejects(loadFirmwareImage(app(), {}), /explicitly/);
});

test('original ABI1 metadata admits large images without changing the launch checkpoint', async () => {
  const result = await loadFirmwareImage(abiImage(1, 0x10004), options);
  assert.equal(result.abi, 1);
  assert.equal(result.entry, APP1_BASE + 1);
  assert.equal(result.stack, 0x202435b0);
  for (const [offset, value, reason] of [
    [0x208, 2, /version/], [0x20c, 100, /declared length/],
    [0x210, 0x81000000, /runtime address/], [0x214, 0xffffffff, /runtime exceeds/],
    [0x218, 0xfffffff0, /source offset/], [0x21c, 0x20000000, /stack/], [0x400, 0, /stack/],
  ]) {
    const bytes = abiImage(); put(bytes, offset, value);
    await assert.rejects(loadFirmwareImage(bytes, options), reason);
  }
  const truncated = abiImage().subarray(0, 0x208);
  await assert.rejects(loadFirmwareImage(truncated, options), /header is truncated/);
});

test('original ABI2 CRC detects payload and metadata changes', async () => {
  const bytes = abiImage(2, 0x10004);
  assert.equal((await loadFirmwareImage(bytes, options)).abi, 2);
  bytes[0x700] ^= 1;
  await assert.rejects(loadFirmwareImage(bytes, options), /CRC/);
  const flags = abiImage(2); put(flags, 0x224, 1);
  await assert.rejects(loadFirmwareImage(flags, options), /flags/);
  const short = abiImage(2, 0x404);
  await assert.rejects(loadFirmwareImage(short, options), /minimum/);
});

test('full flash uses the resident IVT rather than treating the FCB as vectors', async () => {
  const bytes = flashImage();
  const result = await loadFirmwareImage(bytes, {format: 'flash'});
  assert.equal(result.entry, FLASH_BASE + 0x2001);
  assert.equal(result.stack, 0x202435b8);
  assert.equal(result.flashBase, FLASH_BASE);
  assert.equal(result.checkpoint, 'rom-resident-entry');
  assert.deepEqual(result.bytes, bytes);
  assert.match(result.limits.join(' '), /DCD side effects.*unmodeled/);
  const changedEntry = flashImage();
  put(changedEntry, 0x1004, FLASH_BASE + 0x3001); changedEntry.set(app(), 0x3000);
  assert.equal((await loadFirmwareImage(changedEntry, {format: 'flash'})).entry, FLASH_BASE + 0x3001);
});

test('full-flash structural validation refuses wrong size, pointers and non-Thumb entries', async () => {
  await assert.rejects(loadFirmwareImage(flashImage().subarray(0, FLASH_BYTES - 1), {format: 'flash'}), /exactly 4 MiB/);
  for (const [offset, value, reason] of [
    [0x50, 0x800000, /configuration/], [0x1000, 0x412100d1, /IVT header/],
    [0x1014, FLASH_BASE + 0x2000, /self pointer/], [0x1010, FLASH_BASE + 0x3ffffc, /boot-data/],
    [0x1024, FLASH_BYTES - 1, /boot data/], [0x1028, 1, /boot data/],
    [0x1004, FLASH_BASE + 0x2000, /Thumb/], [0x1004, APP1_BASE + 1, /Thumb/],
    [0x1018, 0x80000000, /security pointer/], [0x100c, FLASH_BASE + 0x3ffffc, /DCD pointer/],
  ]) {
    const bytes = flashImage(); put(bytes, offset, value);
    await assert.rejects(loadFirmwareImage(bytes, {format: 'flash'}), reason);
  }
});

test('DCD lengths cannot escape their envelope or leave a truncated command', async () => {
  const bytes = flashImage();
  bytes.set([0xd2, 0x0f, 0xff, 0x41], 0x1030);
  await assert.rejects(loadFirmwareImage(bytes, {format: 'flash'}), /DCD header or bounds/);
  bytes.set([0xd2, 0, 8, 0x41, 0xcc, 0, 12, 4], 0x1030);
  await assert.rejects(loadFirmwareImage(bytes, {format: 'flash'}), /command exceeds/);
  bytes.set([0xd2, 0, 6, 0x41, 0xcc, 0], 0x1030);
  await assert.rejects(loadFirmwareImage(bytes, {format: 'flash'}), /command header is truncated/);
});

// Local research inputs are read by tests only; the website never ships them.
const localR13 = new URL('../../sp404mk2/sdk/examples/original_r13/build/original_r13.bin', import.meta.url);
test('pinned original R13 is identified by exact hash, without guessed markers', {skip: !existsSync(localR13)}, async () => {
  const bytes = readFileSync(localR13);
  const result = await loadFirmwareImage(bytes, options);
  assert.equal(result.sha256, '4891fd9451cd107f6f50f4fb85d75f538cf5b2eb3c7fb2680f36719b32f67e8a');
  assert.equal(result.marker, 0x523d0001);
  assert.equal(result.abi, 1);
  assert.deepEqual(result.bytes, new Uint8Array(bytes));
});

const localStock = new URL('../../sp404mk2/firmware/v552/extracted/sp404mk2_sys_v552/SP404MKII_APP1.bin', import.meta.url);
test('pinned stock v5.52 bytes remain unchanged for their own scatter startup', {skip: !existsSync(localStock)}, async () => {
  const bytes = readFileSync(localStock);
  const result = await loadFirmwareImage(bytes, options);
  assert.equal(result.sha256, '4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80');
  assert.equal(result.entry, APP1_BASE + 1);
  assert.deepEqual(result.bytes, new Uint8Array(bytes));
  assert.match(result.limits.join(' '), /pinned stock v5.52/);
});

const localApp0 = new URL('../../sp404mk2/firmware/v552/extracted/sp404mk2_sys_v552/SP404MKII_APP0.bin', import.meta.url);
test('pinned APP0 is refused even when its file name is absent or misleading', {skip: !existsSync(localApp0)}, async () => {
  await assert.rejects(loadFirmwareImage(readFileSync(localApp0), {format: 'app1', name: 'test.bin'}), /APP0 companion/);
});

const localP1 = new URL('../../sp404mk2/sdk/examples/boot_chain_p1/build/OFFLINE_ONLY_DO_NOT_FLASH.img', import.meta.url);
test('preserved offline P1 envelope passes captured FCB, IVT and DCD structural checks', {skip: !existsSync(localP1)}, async () => {
  const result = await loadFirmwareImage(readFileSync(localP1), {format: 'flash'});
  assert.equal(result.sha256, 'd28dd4c25df234ae282e94013b4eeb23705053f413dabac4eb87dc45e7604157');
  assert.equal(result.entry, 0x60002001);
  assert.equal(result.checkpoint, 'rom-resident-entry');
  assert.equal(result.bytes.length, FLASH_BYTES);
});
