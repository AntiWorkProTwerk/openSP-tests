import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {parseVirtualUpdateManifest, VirtualApp1Update} from '../src/lib/emulator/update-ui.ts';
import {updateCrc32} from '../src/lib/emulator/update.ts';

// Finite protocol fakes cover UI host decisions; they execute no guest or device code.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const markers = {R13: 0x523d0001, R14: 0x523e0001, R15: 0x523f0001, R16B: 0x52410001};
const fields = ['version', 'state', 'error', 'length', 'received', 'crc32', 'maximum',
  'capabilities', 'jedec', 'flash_status', 'flash_error', 'programmed', 'flash_ready', 'flash_crc32', 'build_marker'];
const header = Buffer.from('53464450000101ff00000109300000ffc2000104600000ffffffffffffffffff', 'hex');
const bfpt = Buffer.from('e520f1ffffffff0144eb086b083b04bbeeffffffffff00ffffff00ff0c200f5210d800ff0000000000000000', 'hex');
function candidate(length = 2048) {
  const bytes = Uint8Array.from({length}, (_, index) => index * 17 & 255);
  bytes.set(Buffer.from('SPUAFW10'), 0x200);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0x208, 1], [0x20c, length], [0x210, 0x80000000],
    [0x214, length - 0x400], [0x218, 0x400], [0x21c, 0x20243000], [0x400, 0x20243000]]) view.setUint32(offset, value, true);
  return bytes;
}
const rawManifest = (bytes, marker = '523E0001') => ({usb_marker: marker, usb_install: {bytes: bytes.length, sha256: hash(bytes)}});
const pinFor = bytes => parseVirtualUpdateManifest(rawManifest(bytes));
function statusFor(name, marker = markers[name]) {
  return {signature: name === 'R16B' ? 'SP16' : `SP${name.slice(1)}`, version: 2, state: 0, error: 0,
    length: 0, received: 0, crc32: 0, maximum: name === 'R16B' ? 0x37f000 : 65536, capabilities: 1,
    jedec: 0, flash_status: 0, flash_error: 0, programmed: 0, flash_ready: 0, flash_crc32: 0, build_marker: marker};
}
function report(status) {
  const bytes = new Uint8Array(64); bytes.set(Buffer.from(status.signature));
  const view = new DataView(bytes.buffer);
  fields.forEach((field, index) => view.setUint32(4 + index * 4, status[field], true));
  return Array.from(bytes);
}
function fixture({running = 'R13', marker = markers[running], pause, snapshot: alterSnapshot} = {}) {
  const fake = {calls: [], commands: [], resets: 0, snapshots: 0, status: statusFor(running, marker),
    runningHash: hash(Buffer.from(`fake-${running}`)), uploaded: undefined};
  const note = (method, options) => fake.calls.push({method, options});
  const snapshot = () => {
    const result = {marker: fake.status.build_marker, firmwareState: 2, firmwareHash: fake.runningHash,
      unknownMmio: [], unknownMmioOverflow: 0, cpuBackendFailed: false, flash: {lastError: ''}};
    alterSnapshot?.(result, ++fake.snapshots, fake); return result;
  };
  const bridge = {
    async pause(options) {note('pause', options); await pause?.(options); return snapshot();},
    asUpdateBridge(options) {
      note('bind', options);
      return {
        async transport(request) {
          note('transport', options);
          if (!request) return report(fake.status);
          assert.equal(request.length, 64); assert.equal(request[1], 1); assert.equal(request[3], 0);
          const bytes = Uint8Array.from(request), view = new DataView(bytes.buffer);
          const opcode = bytes[0], argument = view.getUint32(4, true), length = bytes[2];
          fake.commands.push({opcode, argument, length});
          switch (opcode) {
            case 5: Object.assign(fake.status, {jedec: 0xc22016, flash_status: 0x40, flash_ready: 1}); break;
            case 7: {
              assert.ok(argument === 0 || argument === 1);
              const diagnostic = new Uint8Array(112); diagnostic.set(header); diagnostic.set(bfpt, 32);
              const dv = new DataView(diagnostic.buffer);
              [5, 9, 0x30, 1, 0xc22016, 0x40, 0, 1, 0].forEach((value, index) => dv.setUint32(76 + index * 4, value, true));
              const raw = new Uint8Array(64); raw.set(Buffer.from('SPDG'));
              new DataView(raw.buffer).setUint32(4, argument, true);
              raw.set(diagnostic.subarray(argument * 56, argument * 56 + 56), 8); return Array.from(raw);
            }
            case 1:
              fake.expectedCrc = view.getUint32(8, true); fake.uploaded = new Uint8Array(argument);
              Object.assign(fake.status, {state: 1, length: argument, received: 0}); break;
            case 2:
              assert.equal(argument, fake.status.received); assert.ok(length > 0 && length <= 56);
              fake.uploaded.set(bytes.subarray(8, 8 + length), argument); fake.status.received += length; break;
            case 3:
              assert.equal(fake.status.received, fake.status.length); assert.equal(updateCrc32(fake.uploaded), fake.expectedCrc);
              Object.assign(fake.status, {state: 2, crc32: fake.expectedCrc}); break;
            case 6:
              assert.equal(argument, (fake.expectedCrc ^ 0x46534c48) >>> 0);
              Object.assign(fake.status, {state: 6, programmed: Math.ceil(fake.status.length / 4096) * 4096, flash_crc32: fake.expectedCrc}); break;
            default: assert.fail(`Unexpected command ${opcode}`);
          }
          return report(fake.status);
        },
        async snapshot() {note('snapshot', options); return snapshot();},
        async reset(contract) {
          note('reset', options); fake.resets++; fake.resetContract = contract;
          fake.status = statusFor('R14'); fake.runningHash = hash(fake.uploaded);
        },
      };
    },
  };
  return {bridge, fake};
}
const rejected = (action, code) => assert.rejects(action, error => error.code === code);
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};

test('manifest copies only normal package identity and folds hexadecimal case', () => {
  for (const [marker, profile] of [['523D0001', 'R13'], ['523e0001', 'R14'], ['523F0001', 'R15']]) {
    const raw = rawManifest(candidate(), marker); raw.usb_install.sha256 = raw.usb_install.sha256.toUpperCase(); raw.extra = {private: true};
    const pin = parseVirtualUpdateManifest(raw);
    assert.deepEqual(Object.keys(pin).sort(), ['expectedMarker', 'expectedSha256', 'length', 'profile']);
    assert.equal(pin.profile, profile); assert.equal(pin.expectedMarker, markers[profile]);
    assert.equal(pin.expectedSha256, hash(candidate())); raw.usb_install.bytes = 4; assert.equal(pin.length, 2048);
  }
});

test('manifest rejects unknown/proof profiles, coercion, invalid lengths and incomplete hashes', () => {
  const valid = rawManifest(candidate());
  const invalid = [null, [], {}, {...valid, usb_install: []}, ...[0x523e0001, '0x523E0001', ' 523E0001', '523E0002', '52410001'].map(usb_marker => ({...valid, usb_marker})),
    ...['2048', 2047, 2049, 65540, NaN, Infinity].map(bytes => ({...valid, usb_install: {...valid.usb_install, bytes}})),
    ...[null, 2, 'a'.repeat(63), 'z'.repeat(64)].map(sha256 => ({...valid, usb_install: {...valid.usb_install, sha256}}))];
  for (const raw of invalid) assert.throws(() => parseVirtualUpdateManifest(raw), error => error.code.startsWith('manifest-'));
  assert.equal(parseVirtualUpdateManifest({...valid, usb_install: {...valid.usb_install, bytes: 65536}}).length, 65536);
});

test('bad candidate length, ABI, hash or forged manifest is refused before Pause or USB', async () => {
  const bytes = candidate(), pin = pinFor(bytes);
  const badAbi = bytes.slice(); badAbi[0x200] = 0;
  for (const [image, manifest, code] of [[bytes.subarray(4), pin, 'image-size'],
    [badAbi, {...pin, expectedSha256: hash(badAbi)}, 'image-format'],
    [bytes, {...pin, expectedSha256: '0'.repeat(64)}, 'image-hash'],
    [bytes, {...pin, expectedMarker: 0x523e0002}, 'manifest-profile']]) {
    const f = fixture(); await rejected(() => new VirtualApp1Update(f.bridge).update(image, manifest), code);
    assert.equal(f.fake.calls.length, 0);
  }
});

test('larger, unknown and proof running writers cannot reach probe or upload', async () => {
  for (const options of [{running: 'R16B'}, {running: 'R13', marker: 0x523d0002}, {running: 'R13', marker: 0x12345678}]) {
    const f = fixture(options), bytes = candidate();
    await rejected(() => new VirtualApp1Update(f.bridge).update(bytes, pinFor(bytes)),
      options.marker === 0x12345678 ? 'unknown-writer' : 'ui-writer-profile');
    assert.equal(f.fake.commands.length, 0); assert.equal(f.fake.resets, 0);
  }
});

test('stale inspected identity and a changed running hash fail before BEGIN', async () => {
  for (const [mutate, code] of [[result => {result.marker = markers.R14;}, 'running-image-pin'],
    [(result, count) => {if (count === 3) result.firmwareHash = '0'.repeat(64);}, 'boot-snapshot']]) {
    const f = fixture({snapshot: mutate}), bytes = candidate();
    await rejected(() => new VirtualApp1Update(f.bridge).update(bytes, pinFor(bytes)), code);
    assert.equal(f.fake.commands.some(row => row.opcode === 1), false); assert.equal(f.fake.resets, 0);
  }
});

test('an already-aborted update and cancellation during Pause send no USB work', async () => {
  const bytes = candidate(), cancelled = new AbortController(); cancelled.abort();
  const unopened = fixture(); await rejected(() => new VirtualApp1Update(unopened.bridge).update(bytes, pinFor(bytes), {signal: cancelled.signal}), 'cancelled');
  assert.equal(unopened.fake.calls.length, 0);
  const entered = deferred(), controller = new AbortController();
  const f = fixture({pause: ({signal}) => new Promise((_resolve, reject) => {
    assert.equal(signal, controller.signal); entered.resolve();
    signal.addEventListener('abort', () => reject(Object.assign(new Error('Pause cancelled'), {code: 'cancelled'})), {once: true});
  })});
  const pending = new VirtualApp1Update(f.bridge).update(bytes, pinFor(bytes), {signal: controller.signal});
  await entered.promise; controller.abort(); await rejected(() => pending, 'cancelled');
  assert.deepEqual(f.fake.calls.map(row => row.method), ['pause']);
});

test('one controller locks admission through receipt and owns candidate and manifest bytes', async () => {
  const gate = deferred(), entered = deferred(), f = fixture({pause: () => {entered.resolve(); return gate.promise;}});
  const update = new VirtualApp1Update(f.bridge), bytes = candidate(), original = bytes.slice(), manifest = pinFor(bytes);
  const pending = update.update(bytes, manifest);
  await rejected(() => update.update(bytes, manifest), 'concurrent-client');
  await entered.promise; bytes.fill(0); manifest.expectedSha256 = '0'.repeat(64); manifest.expectedMarker = markers.R15;
  await rejected(() => update.update(original, pinFor(original)), 'concurrent-client');
  gate.resolve(); const receipt = await pending;
  assert.deepEqual(f.fake.uploaded, original); assert.equal(receipt.image.sha256, hash(original));
  assert.equal(f.fake.commands.filter(row => row.opcode === 2).length, Math.ceil(original.length / 56));
  assert.equal(f.fake.commands.filter(row => row.opcode === 2).at(-1).length, 32);
});

test('shared signal and 45-second bounds retain the full fresh receipt when progress consumers throw', async () => {
  for (const [running, onProgress] of [['R13', () => {throw new Error('render failed');}],
    ['R14', async () => {throw new Error('async render failed');}], ['R15', () => {}]]) {
    const f = fixture({running}), bytes = candidate(), controller = new AbortController();
    const receipt = await new VirtualApp1Update(f.bridge).update(bytes, pinFor(bytes), {signal: controller.signal, onProgress});
    assert.equal(f.fake.calls[0].method, 'pause'); assert.equal(f.fake.calls[1].method, 'bind');
    for (const {options} of f.fake.calls) {assert.equal(options.signal, controller.signal); assert.equal(options.timeoutMs, 45000);}
    assert.equal(f.fake.resets, 1); assert.equal(receipt.before.build_marker, markers[running]);
    assert.equal(receipt.flashVerified.state, 6); assert.equal(receipt.separateStatus.state, 6);
    assert.equal(receipt.flashReadback.verifiedBytes, 4096); assert.equal(receipt.bootStatus.state, 0);
    assert.equal(receipt.snapshot.marker, markers.R14); assert.equal(receipt.snapshot.firmwareHash, hash(bytes));
    assert.deepEqual(f.fake.resetContract, {length: bytes.length, sha256: hash(bytes), expectedCurrentSha256: receipt.beforeSnapshot.firmwareHash});
    assert.equal(receipt.phases.at(-1).phase, 'boot-verified');
  }
});
