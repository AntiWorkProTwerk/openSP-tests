import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {TextDecoder} from 'node:util';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const textDecoder = new TextDecoder('utf-8', {fatal: true});
const sourceExtension = /\.(?:c|h|s|inc|ld|py|json|md|txt)$/i;
const privateText = /(?:[a-z]:[\\/]Users[\\/]|\/mnt\/[a-z]\/Users\/|\/home\/[a-z0-9._-]+\/|penpot-mcp|(?:API_KEY|SECRET_KEY|ACCESS_TOKEN)\s*[:=]\s*["']?[a-z0-9_+-]{16,})/i;
const maxArchiveBytes = 2 * 1024 * 1024;
const maxExpandedBytes = 8 * 1024 * 1024;
const maxMembers = 1000;

function requireValue(condition, message) {
  if (!condition) throw new Error(`Source archive: ${message}`);
}

function safeMemberName(name) {
  return name.length > 0 && name.length <= 240 &&
    /^[a-z0-9_./-]+$/i.test(name) && !name.startsWith('/') &&
    name.split('/').every(part => part && part !== '.' && part !== '..') &&
    sourceExtension.test(name) &&
    !/(?:^|\/)(?:hooks?|dumps?|toolchains?|vendor|node_modules)\//i.test(name) &&
    !/(?:^|\/)(?:hooks?|dumps?)\.(?:json|txt|md)$/i.test(name);
}

function u16(bytes, offset) {
  requireValue(offset >= 0 && offset + 2 <= bytes.length, 'truncated ZIP field');
  return bytes.readUInt16LE(offset);
}
function u32(bytes, offset) {
  requireValue(offset >= 0 && offset + 4 <= bytes.length, 'truncated ZIP field');
  return bytes.readUInt32LE(offset);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Only classic single-disk ZIPs with plain source files are admitted. The full
// archive and manifest pins remain authoritative before any decompression.
function readSourceZip(bytes) {
  requireValue(bytes.length >= 22 && bytes.length <= maxArchiveBytes, 'ZIP size outside bounds');
  const end = bytes.length - 22;
  requireValue(u32(bytes, end) === 0x06054b50 && u16(bytes, end + 20) === 0, 'ZIP footer or comments are unsupported');
  const count = u16(bytes, end + 10), directorySize = u32(bytes, end + 12), directoryStart = u32(bytes, end + 16);
  requireValue(u16(bytes, end + 4) === 0 && u16(bytes, end + 6) === 0 && u16(bytes, end + 8) === count, 'split ZIP is unsupported');
  requireValue(count > 1 && count <= maxMembers && directoryStart + directorySize === end, 'invalid ZIP directory');
  const entries = new Map(), lowerNames = new Set(), spans = [];
  let offset = directoryStart, expanded = 0;
  for (let index = 0; index < count; index++) {
    requireValue(u32(bytes, offset) === 0x02014b50, 'invalid ZIP directory member');
    const flags = u16(bytes, offset + 8), method = u16(bytes, offset + 10), crc = u32(bytes, offset + 16);
    const compressedSize = u32(bytes, offset + 20), size = u32(bytes, offset + 24);
    const nameSize = u16(bytes, offset + 28), extraSize = u16(bytes, offset + 30), commentSize = u16(bytes, offset + 32);
    const local = u32(bytes, offset + 42), next = offset + 46 + nameSize + extraSize + commentSize;
    requireValue(next <= end && u16(bytes, offset + 34) === 0 && (flags === 0 || flags === 0x800) && (method === 0 || method === 8), 'unsupported ZIP member encoding');
    const name = textDecoder.decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
    requireValue(safeMemberName(name) && !lowerNames.has(name.toLowerCase()), `invalid or duplicate source member: ${name}`);
    lowerNames.add(name.toLowerCase());
    const mode = u32(bytes, offset + 38) >>> 16;
    requireValue(!(mode & 0xf000) || (mode & 0xf000) === 0x8000, 'ZIP member is not a regular file');
    requireValue(u32(bytes, local) === 0x04034b50 && u16(bytes, local + 6) === flags && u16(bytes, local + 8) === method && u32(bytes, local + 14) === crc && u32(bytes, local + 18) === compressedSize && u32(bytes, local + 22) === size, 'ZIP local header mismatch');
    const localNameSize = u16(bytes, local + 26), dataStart = local + 30 + localNameSize + u16(bytes, local + 28);
    requireValue(localNameSize === nameSize && textDecoder.decode(bytes.subarray(local + 30, local + 30 + localNameSize)) === name && dataStart + compressedSize <= directoryStart, 'ZIP member crosses directory');
    spans.push([local, dataStart + compressedSize]);
    expanded += size;
    requireValue(size > 0 && size <= maxExpandedBytes && expanded <= maxExpandedBytes, 'expanded source size outside bounds');
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : inflateRawSync(compressed, {maxOutputLength: size});
    requireValue(data.length === size && crc32(data) === crc, 'ZIP member length or CRC mismatch');
    const content = textDecoder.decode(data);
    requireValue(!content.includes('\0') && !privateText.test(content), 'binary data or private path in source member');
    entries.set(name, data);
    offset = next;
  }
  requireValue(offset === end, 'unconsumed ZIP directory data');
  spans.sort((a, b) => a[0] - b[0]);
  let last = 0;
  for (const [start, finish] of spans) {
    requireValue(start === last, 'ZIP has overlapping or unlisted data');
    last = finish;
  }
  requireValue(last === directoryStart, 'ZIP has trailing unlisted data');
  return {entries, expandedBytes: expanded};
}

export function validateSourceArchivePin(pin) {
  requireValue(pin && /^openSynthP\d+$/.test(pin.identity), 'invalid build identity');
  const expectedPath = `downloads/${pin.identity.toLowerCase()}-source-patcher.zip`;
  requireValue(pin.path === expectedPath && pin.url === `/${expectedPath}`, 'download URL is not the pinned local path');
  requireValue(/^[a-f0-9]{64}$/.test(pin.sha256) && /^[a-f0-9]{64}$/.test(pin.manifestSha256), 'missing SHA256 pin');
  requireValue(/^[a-f0-9]{64}$/.test(pin.reviewSha256), 'missing source-policy review pin');
  requireValue(Number.isSafeInteger(pin.bytes) && pin.bytes > 22 && pin.bytes <= maxArchiveBytes && Number.isSafeInteger(pin.sourceFiles) && pin.sourceFiles > 0 && pin.sourceFiles < maxMembers, 'invalid pinned size or member count');
  requireValue(pin.reviewedSourceOnly === true && pin.firmwareInstallAvailable === false, 'source-only review or installation hold is missing');
  return pin;
}

export function verifySourceArchive(buffer, pin) {
  validateSourceArchivePin(pin);
  const bytes = Buffer.from(buffer);
  requireValue(bytes.length === pin.bytes && digest(bytes) === pin.sha256, 'archive SHA256 or length differs from review');
  const {entries, expandedBytes} = readSourceZip(bytes), manifestBytes = entries.get('MANIFEST.json');
  requireValue(manifestBytes && digest(manifestBytes) === pin.manifestSha256, 'MANIFEST SHA256 differs from review');
  const manifest = JSON.parse(textDecoder.decode(manifestBytes));
  requireValue(manifest.status === 'PASS_PINNED_STANDALONE_PATCHER_INPUTS' && manifest.official_included === false && manifest.compiled_artifacts_included === false, 'MANIFEST source-only contract mismatch');
  requireValue(manifest.inputs && typeof manifest.inputs === 'object' && !Array.isArray(manifest.inputs), 'MANIFEST inputs are missing');
  const names = Object.keys(manifest.inputs);
  requireValue(names.length === pin.sourceFiles && entries.size === names.length + 1, 'MANIFEST source count or archive extras mismatch');
  for (const name of names) {
    requireValue(safeMemberName(name) && name !== 'MANIFEST.json' && /^[a-f0-9]{64}$/.test(manifest.inputs[name]), 'invalid MANIFEST input');
    requireValue(entries.has(name) && digest(entries.get(name)) === manifest.inputs[name], 'source member differs from MANIFEST');
  }
  requireValue(entries.has('build_combined.py') && entries.has('README.md'), 'standalone CLI or README is missing');
  return {path: pin.path, url: pin.url, identity: pin.identity, bytes: bytes.length, sha256: pin.sha256, manifestSha256: pin.manifestSha256, sourceFiles: names.length, expandedBytes, firmwareInstallAvailable: false};
}

export function checkPublicSourceArchives(distDirectory, registry) {
  requireValue(registry?.schema === 'opensp-reviewed-source-archives' && registry.version === 1 && Array.isArray(registry.archives), 'invalid publication registry');
  requireValue(registry.archives.length <= 1, 'only the current reviewed source archive can be public');
  const pins = registry.archives.map(validateSourceArchivePin);
  return pins.map(pin => {
    const filename = path.join(distDirectory, ...pin.path.split('/'));
    requireValue(fs.existsSync(filename) && fs.lstatSync(filename).isFile(), 'reviewed archive is missing');
    return verifySourceArchive(fs.readFileSync(filename), pin);
  });
}

export function checkSourcePatcherMetadata(copy, registry) {
  requireValue(copy?.schema === 1 && /^openSynthP\d+$/.test(copy.identity) && copy.firmwareInstallAvailable === false, 'invalid website source-patcher identity or installation status');
  requireValue(registry?.schema === 'opensp-reviewed-source-archives' && registry.version === 1 && Array.isArray(registry.archives), 'invalid publication registry');
  requireValue(copy.command === 'python build_combined.py --inputs inputs --official OFFICIAL_V552_ZIP --tool-prefix ARM_PREFIX --output ../fresh-build', 'website command differs from standalone CLI');
  if (copy.status === 'pending') {
    requireValue(copy.archive === null && registry.archives.length === 0, 'pending source patcher exposes a download');
    return;
  }
  requireValue(copy.status === 'reviewed-source' && registry.archives.length === 1, 'source-patcher publication status mismatch');
  const pin = validateSourceArchivePin(registry.archives[0]);
  requireValue(pin.identity === copy.identity && copy.archive, 'website archive identity mismatch');
  for (const field of ['url', 'bytes', 'sha256', 'manifestSha256', 'sourceFiles']) {
    requireValue(copy.archive[field] === pin[field], `website archive ${field} differs from review`);
  }
}

export function assertSourceOnlyPublicJson(text, filename) {
  const pending = [JSON.parse(text)];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    requireValue(typeof value.format !== 'string' || !/^(?:opensynth|opensp)-patch\//i.test(value.format), `compiled browser patch payload in ${filename}`);
    pending.push(...Object.values(value).filter(member => member && typeof member === 'object'));
  }
}
