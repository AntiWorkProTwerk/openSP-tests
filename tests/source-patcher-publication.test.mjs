import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {deflateRawSync} from 'node:zlib';
import {assertSourceOnlyPublicJson, checkPublicSourceArchives, checkSourcePatcherMetadata, validateSourceArchivePin, verifySourceArchive} from '../tools/source-patcher-publication.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = JSON.parse(fs.readFileSync(new URL('../src/content/releases/synth-source-patcher.json', import.meta.url)));
const registry = JSON.parse(fs.readFileSync(new URL('../tools/source-patcher-publication.json', import.meta.url)));

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function sourceZip(members) {
  const locals = [], directories = [];
  let offset = 0;
  for (const [name, dataValue] of members) {
    const nameBytes = Buffer.from(name), data = Buffer.from(dataValue), compressed = deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30), directory = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(nameBytes.length, 28); directory.writeUInt32LE(offset, 42);
    const localData = Buffer.concat([local, nameBytes, compressed]);
    locals.push(localData); directories.push(Buffer.concat([directory, nameBytes])); offset += localData.length;
  }
  const directory = Buffer.concat(directories), footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50); footer.writeUInt16LE(members.length, 8); footer.writeUInt16LE(members.length, 10); footer.writeUInt32LE(directory.length, 12); footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, footer]);
}
function fixture(extra = [], mutateManifest = manifest => manifest) {
  const members = [['build_combined.py', 'print("local source build")\n'], ['README.md', 'Supply official firmware locally.\n'], ['inputs/main.c', 'void main(void) {}\n'], ...extra];
  const manifest = mutateManifest({status: 'PASS_PINNED_STANDALONE_PATCHER_INPUTS', inputs: Object.fromEntries(members.map(([name, bytes]) => [name, digest(bytes)])), official_included: false, compiled_artifacts_included: false});
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const bytes = sourceZip([...members, ['MANIFEST.json', manifestBytes]]);
  const pin = {identity: 'openSynthP12', path: 'downloads/opensynthp12-source-patcher.zip', url: '/downloads/opensynthp12-source-patcher.zip', bytes: bytes.length, sha256: digest(bytes), manifestSha256: digest(manifestBytes), reviewSha256: '1'.repeat(64), sourceFiles: members.length, reviewedSourceOnly: true, firmwareInstallAvailable: false};
  return {bytes, pin};
}

test('website metadata agrees with the exact publication registry', () => checkSourcePatcherMetadata(copy, registry));
test('reviewed source archive verifies every pinned member', () => {
  const {bytes, pin} = fixture(), result = verifySourceArchive(bytes, pin);
  assert.equal(result.sourceFiles, 3); assert.equal(result.firmwareInstallAvailable, false);
});
for (const field of ['sha256', 'manifestSha256']) test(`rejects a changed ${field}`, () => {
  const {bytes, pin} = fixture(); pin[field] = '0'.repeat(64); assert.throws(() => verifySourceArchive(bytes, pin), /differs from review/);
});
test('rejects changed archive size', () => {const {bytes, pin} = fixture(); pin.bytes++; assert.throws(() => verifySourceArchive(bytes, pin), /length differs/);});
for (const name of ['SP404MKII_APP1.bin', 'module.elf', 'unit.o', 'archive.zip', 'rom.dump', '../escape.py', 'inputs\\main.c', 'toolchain/main.c', 'inputs/hooks/report.json']) {
  test(`rejects unpublished member ${name}`, () => {const {bytes, pin} = fixture([[name, 'source']]); assert.throws(() => verifySourceArchive(bytes, pin), /invalid or duplicate source member/);});
}
test('rejects private machine paths', () => {const {bytes, pin} = fixture([['private.py', 'x = "C:/Users/person/code"\n']]); assert.throws(() => verifySourceArchive(bytes, pin), /private path/);});
test('rejects binary content disguised as source', () => {const {bytes, pin} = fixture([['private.c', Buffer.from([0, 1, 2])]]); assert.throws(() => verifySourceArchive(bytes, pin), /binary data/);});
test('rejects case-colliding names', () => {const {bytes, pin} = fixture([['readme.md', 'duplicate']]); assert.throws(() => verifySourceArchive(bytes, pin), /duplicate source member/);});
test('rejects sources absent from the manifest', () => {const {bytes, pin} = fixture([], manifest => {delete manifest.inputs['README.md']; return manifest;}); assert.throws(() => verifySourceArchive(bytes, pin), /source count/);});
test('rejects manifest members with altered hashes', () => {const {bytes, pin} = fixture([], manifest => {manifest.inputs['README.md'] = '0'.repeat(64); return manifest;}); assert.throws(() => verifySourceArchive(bytes, pin), /source member differs/);});
test('rejects a manifest that admits vendor images', () => {const {bytes, pin} = fixture([], manifest => ({...manifest, official_included: true})); assert.throws(() => verifySourceArchive(bytes, pin), /source-only contract/);});
test('rejects a manifest that admits compiled artifacts', () => {const {bytes, pin} = fixture([], manifest => ({...manifest, compiled_artifacts_included: true})); assert.throws(() => verifySourceArchive(bytes, pin), /source-only contract/);});
test('rejects an external or renamed download URL', () => {const {pin} = fixture(); for (const url of ['https://example.org/archive.zip', '/downloads/other.zip']) assert.throws(() => validateSourceArchivePin({...pin, url}), /pinned local path/);});
test('rejects enabled firmware installation', () => {const {pin} = fixture(); assert.throws(() => validateSourceArchivePin({...pin, firmwareInstallAvailable: true}), /installation hold/);});
test('requires the source-policy review hash', () => {const {pin} = fixture(); delete pin.reviewSha256; assert.throws(() => validateSourceArchivePin(pin), /source-policy review pin/);});
test('rejects former browser patch payloads from JSON output', () => {assert.throws(() => assertSourceOnlyPublicJson('{"format": "opensynth-patch/1", "ops": []}', 'patch.json'), /compiled browser patch/);});
test('rejects JSON-escaped browser patch formats', () => {assert.throws(() => assertSourceOnlyPublicJson('{"format": "\\u006fpensynth-patch\\/1"}', 'patch.json'), /compiled browser patch/);});
test('rejects a nested browser patch payload', () => {assert.throws(() => assertSourceOnlyPublicJson('{"nested": {"format": "opensp-patch/1"}}', 'patch.json'), /compiled browser patch/);});
test('pending metadata cannot expose an archive', () => {const {pin} = fixture(); assert.throws(() => checkSourcePatcherMetadata({...copy, status: 'pending', archive: pin}, {schema: registry.schema, version: 1, archives: []}), /pending source patcher exposes/);});
test('reviewed website metadata cannot drift from archive pins', () => {
  const {pin} = fixture(), reviewed = {...copy, identity: pin.identity, status: 'reviewed-source', archive: {...pin, sha256: '0'.repeat(64)}};
  assert.throws(() => checkSourcePatcherMetadata(reviewed, {schema: registry.schema, version: 1, archives: [pin]}), /website archive sha256/);
});
test('publication reads the exact archive from dist', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'opensp-source-test-')); t.after(() => fs.rmSync(folder, {recursive: true, force: true}));
  const {bytes, pin} = fixture(), policy = {schema: registry.schema, version: 1, archives: [pin]};
  assert.throws(() => checkPublicSourceArchives(folder, policy), /archive is missing/);
  fs.mkdirSync(path.join(folder, 'downloads')); fs.writeFileSync(path.join(folder, pin.path), bytes);
  assert.equal(checkPublicSourceArchives(folder, policy).length, 1);
  fs.writeFileSync(path.join(folder, pin.path), Buffer.from('changed'));
  assert.throws(() => checkPublicSourceArchives(folder, policy), /differs from review/);
});
