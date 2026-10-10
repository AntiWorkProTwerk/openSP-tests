import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
import {createSession} from '../src/lib/emulator/session.ts';
import {loadFirmwareImage} from '../src/lib/emulator/image.ts';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firmwareProject = path.resolve(project, '../sp404mk2');
const defaultFirmware = path.join(firmwareProject, 'sdk/examples/original_r13/build/original_r13.bin');
const defaultR14 = path.join(firmwareProject, 'sdk/examples/original_r14/build/original_r14.bin');
const defaultReport = path.join(project, 'tools/emulator-evidence/r13-integration.json');
const differentImageReport = path.join(project, 'tools/emulator-evidence/r13-to-r14-integration.json');
const R13_SHA = '4891fd9451cd107f6f50f4fb85d75f538cf5b2eb3c7fb2680f36719b32f67e8a';
const R13_MARKER = 0x523d0001;
const R14_SHA = 'b8e582ce74fb28b209dc9b14eccc9c175745bcb20648efe0ca9a0053c9e92695';
const R14_MARKER = 0x523e0001;
const DEFAULT_JS_SHA = 'd8bc37b898ccbc5b429f17112add6ad33a8a9b35df4146034ba141b992dae007';
const DEFAULT_WASM_SHA = '16599c54af6da32ecce2ce52538890610a83c96e1152796ddffa2533d6440b35';
const UNREPAIRED_WASM_SHA = 'f9520f9aa55299b84d005390844082a1468f26137e239eb1167dde8473aecc6c';
const APP1_OFFSET = 0x80000;
const fields = ['version', 'state', 'error', 'length', 'received', 'crc32', 'maximum',
  'capabilities', 'jedec', 'flash_status', 'flash_error', 'programmed',
  'flash_ready', 'flash_crc32', 'build_marker'];
const sourceFiles = ['src/lib/emulator/image.ts', 'src/lib/emulator/cpu.ts',
  'src/lib/emulator/board.ts', 'src/lib/emulator/oscillator.ts', 'src/lib/emulator/usb.ts', 'src/lib/emulator/flash.ts',
  'src/lib/emulator/exceptions.ts', 'src/lib/emulator/exception-return.ts', 'src/lib/emulator/session.ts',
  'tools/test-emulator-firmware.mjs', 'tools/emulator-test-worker.mjs'];

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ascii = bytes => String.fromCharCode(...bytes);
const hex = value => `0x${value.toString(16).padStart(8, '0')}`;
const crcTable = Uint32Array.from({length: 256}, (_, start) => {
  let value = start;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

export function featureReport(opcode, argument = 0, data = new Uint8Array(0), dataLength = 0) {
  assert.ok(data.length <= 56);
  const bytes = new Uint8Array(64);
  bytes[0] = opcode; bytes[1] = 1; bytes[2] = dataLength;
  new DataView(bytes.buffer).setUint32(4, argument, true);
  bytes.set(data, 8);
  return Array.from(bytes);
}

export function decodeStatus(bytes, marker = R13_MARKER) {
  assert.equal(bytes.length, 64, 'Actual firmware HID reply length');
  const signature = marker === R14_MARKER ? 'SP14' : 'SP13';
  assert.equal(ascii(bytes.subarray(0, 4)), signature, 'Actual running firmware report identity');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = Object.fromEntries(fields.map((name, index) => [name, view.getUint32(4 + index * 4, true)]));
  assert.equal(result.version, 2);
  assert.equal(result.maximum, 65536);
  assert.equal(result.capabilities, 1);
  assert.equal(result.build_marker, marker);
  return result;
}

function mailbox(session) {
  const bytes = session.cpu.readMemory(0x2023f000, 80);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({length: 20}, (_, index) => view.getUint32(index * 4, true));
}

function step(session, count = 25000) {
  const result = session.step(count);
  assert.notEqual(result.reason, 'fault', result.fault);
  return result;
}

export function boot(session, frames = 5, marker = R13_MARKER) {
  const firstFrames = [];
  let seen = session.board.status().frameCount;
  const startInstructions = session.cpu.totalInstructions;
  while (session.board.status().frameCount < frames) {
    assert.ok(session.cpu.totalInstructions - startInstructions < 16000000, 'Original APP1 boot/frame instruction bound');
    step(session);
    const board = session.board.status();
    if (board.frameCount !== seen) {
      assert.equal(board.frameCount, seen + 1, 'Each initial OLED frame is observed without skipping');
      firstFrames.push(board.lastFrame);
      seen = board.frameCount;
    }
  }
  const words = mailbox(session);
  assert.equal(session.cpu.cpuModel, 10, 'Runtime CPU model readback is Cortex-M7');
  assert.deepEqual(words.slice(0, 3), [0x53503443, 1, 2]);
  assert.deepEqual(words.slice(4, 8), [0x60080001, 0x202435b0, 4, 0]);
  assert.equal(words[8], 0x411fc271, 'CPUID comes from the documented board fixture');
  assert.equal(words[9], 0x80000000, 'Firmware installed its own runtime vectors');
  assert.deepEqual(words.slice(12, 14), [0x404552a5, 0]);
  assert.equal(words[19], marker, 'Marker is read from the actual guest mailbox');
  assert.equal(words[14], 0, 'No recorded firmware exception');
  assert.equal(session.board.status().unknownMmio.length, 0);
  if (firstFrames.length) {
    assert.equal(hash(firstFrames[0]), '5f70bf18a086007016e948b04aed3b82103a36bea41755b6cddfaf10ace3c6ef',
      'OLED initialization emits the preserved blank frame');
    assert.ok(firstFrames.slice(1).every(frame => frame.some(Boolean)), 'Native rendered frames are nonblank');
    const title = hash(firstFrames[1].subarray(0, 128));
    assert.ok(firstFrames.slice(2).every(frame => hash(frame.subarray(0, 128)) === title), 'Native title page stays stable');
    assert.equal(new Set(firstFrames.slice(1).map(frame => hash(frame.subarray(896)))).size,
      firstFrames.length - 1, 'Compiled heartbeat updates the OLED bottom page');
  }
  return {
    checkpoint: session.image.checkpoint,
    incoming: {r0: hex(words[4]), msp: hex(words[5]), lr: words[6], control: words[7]},
    cpuModel: session.cpu.cpuModel, cpuid: hex(words[8]), vtor: hex(words[9]),
    marker: hex(words[19]), firmwareState: words[2], heartbeat: words[3],
    exceptions: session.snapshot().exceptions,
    frames: firstFrames.map((bytes, index) => ({number: index + 1, bytes: bytes.length, sha256: hash(bytes)})),
    instructions: session.cpu.totalInstructions - startInstructions,
  };
}

export function captureSnapshot(session) {
  const result = new Uint8Array(168);
  for (let page = 0; page < 3; page++) {
    const bytes = session.usbReport(featureReport(8, page));
    assert.equal(ascii(bytes.subarray(0, 4)), 'SPIS');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(4, true), page);
    result.set(bytes.subarray(8), page * 56);
  }
  const normal = decodeStatus(session.usbReport());
  assert.equal(normal.error, 0);
  const view = new DataView(result.buffer);
  return {
    id: view.getUint32(0, true), ticks: view.getUint32(4, true), scans: view.getUint32(8, true),
    captureDropped: view.getUint32(24, true), pendingEvents: view.getUint32(132, true),
    captureEnabled: view.getUint32(136, true), epoch: view.getUint32(140, true),
    adcStatus: view.getUint32(28, true), adcErrors: view.getUint32(32, true),
    uartErrors: view.getUint32(40, true), shift: view.getUint32(120, true),
    analog: Array.from({length: 32}, (_, slot) => view.getUint16(56 + slot * 2, true)),
    sha256: hash(result),
  };
}

function pollStatus(session, predicate, name, budget = 12000000) {
  const begin = session.cpu.totalInstructions;
  while (session.cpu.totalInstructions - begin < budget) {
    const status = decodeStatus(session.usbReport());
    assert.equal(status.error, 0, `${name} upload error`);
    assert.equal(status.flash_error, 0, `${name} flash error`);
    if (predicate(status)) return status;
    step(session);
  }
  throw new Error(`${name} failed to reach its expected state within ${budget} modeled instructions`);
}

function uploadFirmware(session, bytes) {
  const crc = crc32(bytes);
  const checksum = new Uint8Array(4); new DataView(checksum.buffer).setUint32(0, crc, true);
  const begin = session.cpu.totalInstructions;
  const norSha256 = hash(session.board.flash.flash);
  let status = decodeStatus(session.usbReport(featureReport(1, bytes.length, checksum)));
  assert.equal(status.state, 1);
  let packets = 0;
  for (let offset = 0; offset < bytes.length; offset += 56) {
    const part = bytes.slice(offset, offset + 56);
    status = decodeStatus(session.usbReport(featureReport(2, offset, part, part.length)));
    assert.equal(status.state, 1);
    assert.equal(status.error, 0);
    assert.equal(status.received, offset + part.length);
    packets++;
  }
  status = decodeStatus(session.usbReport(featureReport(3)));
  assert.equal(status.state, 2);
  assert.equal(status.error, 0);
  assert.equal(status.length, bytes.length);
  assert.equal(status.received, bytes.length);
  assert.equal(status.crc32, crc);
  const staged = session.cpu.readMemory(0x83000000, bytes.length);
  assert.deepEqual(staged, bytes, 'Actual receiver staged every uploaded byte');
  assert.equal(hash(session.board.flash.flash), norSha256, 'RAM VERIFIED has not modified NOR');
  return {status, packets, crc32: crc, actualStagingSha256: hash(staged),
    stagingReadMechanism: 'Passive observation of guest RAM after the firmware reports its CRC',
    instructions: session.cpu.totalInstructions - begin, norUnchanged: true};
}

function rejectedWriteEnable(session, crc) {
  const start = session.cpu.totalInstructions;
  const previousNor = hash(session.board.flash.flash);
  const commandStart = session.board.flash.commandLog.length;
  session.board.flash.faults.noWel = true;
  let status;
  try {
    status = decodeStatus(session.usbReport(featureReport(6, (crc ^ 0x46534c48) >>> 0)));
    while (status.state !== 7) {
      assert.ok(session.cpu.totalInstructions - start < 4000000, 'No-WEL failure has a bounded guest response');
      assert.ok([4, 5].includes(status.state));
      assert.equal(status.error, 0);
      assert.equal(status.flash_error, 0);
      step(session);
      status = decodeStatus(session.usbReport());
    }
    assert.equal(status.error, 0);
    assert.equal(status.flash_error, 14, 'Compiled driver reports its source-defined WEL failure');
    assert.equal(status.programmed, 0);
    assert.equal(status.flash_ready, 0);
    assert.equal(session.board.flash.erases.length, 0);
    assert.equal(session.board.flash.pages.length, 0);
    assert.equal(hash(session.board.flash.flash), previousNor);
    const commands = session.board.flash.commandLog.slice(commandStart);
    assert.ok(commands.some(command => command.opcode === 6), 'Firmware actually attempts write-enable');
    assert.ok(commands.every(command => ![2, 0x20].includes(command.opcode)),
      'Firmware rejects missing WEL before erase or program');
    return {injection: 'Existing virtual NOR noWel fault prevents WEL from setting', status,
      instructions: session.cpu.totalInstructions - start, commandCount: commands.length,
      commandSha256: hash(JSON.stringify(commands)), norUnchanged: true};
  } finally {session.board.flash.faults.noWel = false;}
}

export async function pinOriginalFirmware(file, version, expectedSha256, marker) {
  const bytes = new Uint8Array(await fs.readFile(file));
  assert.equal(hash(bytes), expectedSha256, `Preserved exact ORIGINAL ${version} binary`);
  const directory = path.join(firmwareProject, `sdk/examples/original_${version.toLowerCase()}`);
  const manifestBytes = await fs.readFile(path.join(directory, 'build/manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.binary_sha256, expectedSha256);
  assert.equal(manifest.binary_size, bytes.length);
  const sourceSha256 = {};
  for (const [name, expected] of Object.entries(manifest.sources)) {
    const actual = hash(await fs.readFile(path.join(directory, name)));
    assert.equal(actual, expected, `${version} build-time source pin: ${name}`);
    sourceSha256[name] = actual;
  }
  return {bytes, evidence: {name: `ORIGINAL ${version}`, bytes: bytes.length,
    sha256: expectedSha256, marker: hex(marker), buildManifestSha256: hash(manifestBytes), sourceSha256}};
}

async function readDiagnostics(session) {
  const result = new Uint8Array(112);
  for (let page = 0; page < 2; page++) {
    const bytes = session.usbReport(featureReport(7, page));
    assert.equal(ascii(bytes.subarray(0, 4)), 'SPDG');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(4, true), page);
    result.set(bytes.subarray(8), page * 56);
  }
  const view = new DataView(result.buffer);
  const names = ['phase', 'bfpt_dwords', 'bfpt_pointer', 'legacy_profile', 'jedec',
    'flash_status', 'flash_error', 'flash_ready', 'reserved'];
  const decoded = Object.fromEntries(names.map((name, index) => [name, view.getUint32(76 + index * 4, true)]));
  const measuredProfileFile = 'analysis/hardware/usb_r11_20260922T190757Z/preflight.json';
  const measuredProfileBytes = await fs.readFile(path.join(firmwareProject, measuredProfileFile));
  const hardware = JSON.parse(measuredProfileBytes.toString('utf8'));
  const measured = JSON.parse(hardware.steps.find(item => item.action === 'diagnostics').stdout);
  assert.equal(Buffer.from(result.subarray(0, 32)).toString('hex'), measured.header_hex);
  assert.equal(Buffer.from(result.subarray(32, 76)).toString('hex'), measured.bfpt_hex);
  for (const [name, value] of Object.entries(decoded)) assert.equal(value, measured[name], `Measured ${name}`);
  assert.equal(decodeStatus(session.usbReport()).state, 0, 'Diagnostic reply is one-shot');
  return {...decoded, sha256: hash(result), measuredProfileMatches: true,
    measuredProfileFile, measuredProfileSha256: hash(measuredProfileBytes)};
}

async function sourcePins() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, hash(await fs.readFile(path.join(project, name)))])));
}

export function runtimeSessionOptions(runtimeDirectory) {
  return runtimeDirectory ? {format: 'app1', cpuOptions: {
    vendorUrl: pathToFileURL(path.join(runtimeDirectory, 'unicorn-arm.js')).href,
  }} : {format: 'app1'};
}

export async function runtimeEvidence(runtimeDirectory) {
  const directory = runtimeDirectory ?? path.join(project, 'public/emulator/vendor');
  assert.ok((await fs.stat(directory)).isDirectory(), 'Runtime argument is a local asset directory');
  const provenanceBytes = await fs.readFile(path.join(directory, 'provenance.json'));
  const provenance = JSON.parse(provenanceBytes.toString('utf8'));
  for (const name of ['unicorn-arm.js', 'unicorn-arm.wasm']) {
    const bytes = await fs.readFile(path.join(directory, name));
    assert.equal(bytes.length, provenance.files[name].bytes, `${name} length pin`);
    assert.equal(hash(bytes), provenance.files[name].sha256, `${name} hash pin`);
  }
  if (!runtimeDirectory) {
    assert.equal(provenance.files['unicorn-arm.js'].sha256, DEFAULT_JS_SHA, 'Published JS runtime pin');
    assert.equal(provenance.files['unicorn-arm.wasm'].sha256, DEFAULT_WASM_SHA, 'Published WASM runtime pin');
  }
  return {wrapperCommit: provenance.wrapperCommit, coreCommit: provenance.coreCommit,
    jsSha256: provenance.files['unicorn-arm.js'].sha256, wasmSha256: provenance.files['unicorn-arm.wasm'].sha256,
    provenanceSha256: hash(provenanceBytes), assetDirectory: path.relative(project, directory).replaceAll('\\', '/'),
    candidate: !!runtimeDirectory,
    isPublishedBaseline: provenance.files['unicorn-arm.js'].sha256 === DEFAULT_JS_SHA &&
      provenance.files['unicorn-arm.wasm'].sha256 === DEFAULT_WASM_SHA,
    hasKnownR14Frontier: provenance.files['unicorn-arm.wasm'].sha256 === UNREPAIRED_WASM_SHA};
}

export async function archiveExistingReport(destination, prefix = path.basename(destination, '.json')) {
  let bytes;
  try {bytes = await fs.readFile(destination);}
  catch (error) {if (error.code === 'ENOENT') return undefined; throw error;}
  const previous = JSON.parse(bytes.toString('utf8'));
  const stamp = previous.timestampUtc.replaceAll(':', '').replaceAll('.', '-');
  const archive = path.join(path.dirname(destination), `${prefix}-${stamp}.json`);
  try {await fs.writeFile(archive, bytes, {flag: 'wx'});}
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert.equal(hash(await fs.readFile(archive)), hash(bytes), 'Historical report is immutable');
  }
  return {report: path.relative(project, archive).replaceAll('\\', '/'), sha256: hash(bytes), passed: previous.passed};
}

export async function isolatedWorker(bytes, volume, runtimeDirectory) {
  assert.equal(hash(bytes), R13_SHA);
  const session = await createSession(bytes, runtimeSessionOptions(runtimeDirectory));
  try {
    const startup = boot(session);
    assert.equal(decodeStatus(session.usbReport(featureReport(10, 1))).state, 0);
    session.setInput({control: 'VOLUME', value: volume});
    for (let count = 0; count < 100; count++) step(session);
    const snapshot = captureSnapshot(session);
    const expected = Math.round((1 - volume) * 4082);
    assert.equal(snapshot.analog[16], expected, 'Actual ADC scan reaches the worker-specific injected VOLUME');
    assert.equal(snapshot.adcErrors, 0);
    assert.equal(snapshot.captureEnabled, 1);
    assert.equal(snapshot.captureDropped, 0);
    const events = [];
    for (let packet = 0; packet < 33; packet++) {
      const reply = session.usbReport(featureReport(9));
      assert.equal(ascii(reply.subarray(0, 4)), 'SPEV');
      const view = new DataView(reply.buffer, reply.byteOffset, reply.byteLength);
      const count = view.getUint32(4, true);
      assert.ok(count <= 4);
      assert.equal(view.getUint32(8, true), 0, 'Actual capture ring did not drop events');
      for (let index = 0; index < count; index++) {
        const offset = 16 + index * 12;
        events.push({ticks: view.getUint32(offset, true), sequence: view.getUint32(offset + 4, true),
          value: view.getUint16(offset + 8, true), source: reply[offset + 10], slot: reply[offset + 11]});
      }
      if (view.getUint32(12, true) === 0) break;
      assert.ok(packet < 32, 'Actual capture ring drains within its source-defined capacity');
    }
    assert.ok(events.some(event => event.source === 2 && event.slot === 16 && event.value === expected),
      'Actual compiled capture opcode reports the worker-specific ADC event');
    assert.equal(decodeStatus(session.usbReport(featureReport(10, 0))).state, 0);
    const status = decodeStatus(session.usbReport());
    assert.equal(status.state, 0);
    assert.equal(session.board.flash.erases.length, 0);
    assert.equal(session.board.flash.pages.length, 0);
    return {volume, expectedRaw: expected, observedRaw: snapshot.analog[16],
      snapshotSha256: snapshot.sha256, startup, status,
      capture: {opcodes: [8, 9, 10], events, dropped: snapshot.captureDropped},
      instructions: session.cpu.totalInstructions, norSha256: hash(session.board.flash.flash),
      unknownMmio: session.board.status().unknownMmio};
  } finally {session.close();}
}

function launchWorker(bytes, volume, runtimeDirectory) {
  const worker = new Worker(new URL('./emulator-test-worker.mjs', import.meta.url),
    {workerData: {bytes, volume, runtimeDirectory}});
  return new Promise((resolve, reject) => {
    let settled = false;
    worker.once('message', message => {
      settled = true;
      if (message.error) reject(new Error(`Parallel firmware worker: ${message.error}`));
      else resolve(message.result);
    });
    worker.once('error', reject);
    worker.once('exit', code => {if (!settled) reject(new Error(`Parallel firmware worker exited ${code} without evidence`));});
  });
}

async function run(firmware, report, updateR14 = false, runtimeDirectory) {
  report.sourceSha256 = await sourcePins();
  report.runtime = await runtimeEvidence(runtimeDirectory);
  if (updateR14) assert.equal(report.runtime.hasKnownR14Frontier, false,
    'R14 has a preserved boot frontier on this unrepaired runtime; use a qualified repaired engine');
  if (updateR14) {
    const previousBytes = await fs.readFile(defaultReport);
    const previous = JSON.parse(previousBytes.toString('utf8'));
    assert.equal(previous.passed, true, 'Preserved same-image report passed');
    assert.equal(previous.firmware.sha256, R13_SHA);
    assert.equal(previous.flash.unchangedImageRestaged, true);
    const name = `r13-same-image-${previous.timestampUtc.replaceAll(':', '').replaceAll('.', '-')}.json`;
    const archive = path.join(path.dirname(defaultReport), name);
    try {await fs.writeFile(archive, previousBytes, {flag: 'wx'});}
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assert.equal(hash(await fs.readFile(archive)), hash(previousBytes), 'Historical report is immutable');
    }
    report.history = {sameImageReport: path.relative(project, archive).replaceAll('\\', '/'),
      sha256: hash(previousBytes), passed: true};
  }
  const initial = await pinOriginalFirmware(firmware, 'R13', R13_SHA, R13_MARKER);
  const bytes = initial.bytes;
  report.firmware = initial.evidence;
  const target = updateR14 ? await pinOriginalFirmware(defaultR14, 'R14', R14_SHA, R14_MARKER) : initial;
  const candidate = target.bytes;
  const targetMarker = updateR14 ? R14_MARKER : R13_MARKER;
  const targetImage = await loadFirmwareImage(candidate, {format: 'app1'});
  assert.equal(targetImage.abi, 1, 'Candidate source-built APP1 uses the receiver-supported ABI1');
  report.candidate = {...target.evidence, abi: targetImage.abi,
    entry: hex(targetImage.entry), flashBase: hex(targetImage.flashBase), checkpoint: targetImage.checkpoint};
  if (updateR14) {
    assert.notEqual(report.candidate.sha256, report.firmware.sha256);
    assert.notEqual(targetMarker, R13_MARKER);
  }
  report.references = [
    'sdk/examples/original_r13/{USB.md,FLASH.md,monitor.c,screen.c,usb_upload.c,flash.c}',
    'sdk/examples/original_r11/{USB.md,FLASH.md}',
    'tools/{usb_upload.py,usb_flash_r13.py}',
    'analysis/hardware/usb_r11_20260922T190757Z/preflight.json',
  ];
  if (updateR14) report.references.push('sdk/examples/original_r14/{FLASH.md,USB.md,monitor.c,usb_upload.c,build/manifest.json}');
  const session = await createSession(bytes, runtimeSessionOptions(runtimeDirectory));
  try {
    report.phase = 'boot';
    report.boot = boot(session);
    console.log('R13 native startup, mailbox and five decoded OLED frames passed.');
    report.phase = 'USB enumeration';
    const enumeration = session.enumerateUsb();
    assert.deepEqual(enumeration.device,
      [18, 1, 0, 2, 0, 0, 0, 64, 0xfe, 0xca, 0x4d, 0x40, 0x13, 0, 1, 2, 0, 1]);
    assert.equal(enumeration.configuration.length, 34);
    const hid = session.usbControl(0x81, 6, 0x2200, 0, 64);
    assert.equal(hid.at(-1), 0xc0);
    const product = session.usbControl(0x80, 6, 0x302, 0, 64);
    assert.equal(Buffer.from(product.subarray(2)).toString('utf16le'), 'SP404 USB FLASH R13');
    const initialStatus = decodeStatus(session.usbReport());
    assert.equal(initialStatus.state, 0);
    assert.ok(candidate.length >= 4 && candidate.length <= initialStatus.maximum,
      'Actual running recipient reports enough capacity for the candidate');
    report.candidate.recipient = {marker: hex(initialStatus.build_marker),
      maximum: initialStatus.maximum, acceptedSourceAbi: 1, capacityFits: true};
    report.usb = {enumeration, hidDescriptorSha256: hash(hid), initialStatus};
    report.phase = 'USB writer guards';
    const guardNorSha256 = hash(session.board.flash.flash);
    const oversize = decodeStatus(session.usbReport(featureReport(1, 65537)));
    assert.equal(oversize.state, 3);
    assert.equal(oversize.error, 2, 'Executed R13 receiver enforces its own 64 KiB limit');
    const abortedOversize = decodeStatus(session.usbReport(featureReport(4)));
    assert.equal(abortedOversize.state, 0);
    assert.equal(abortedOversize.error, 0);
    const prematureCommit = decodeStatus(session.usbReport(featureReport(6)));
    assert.equal(prematureCommit.state, 3);
    assert.equal(prematureCommit.error, 7, 'Executed R13 commit rejects an unverified upload');
    const abortedCommit = decodeStatus(session.usbReport(featureReport(4)));
    assert.equal(abortedCommit.state, 0);
    assert.equal(abortedCommit.error, 0);
    assert.equal(session.board.flash.commandLog.length, 0, 'Rejected reports issue no NOR commands');
    assert.equal(hash(session.board.flash.flash), guardNorSha256);
    report.writerGuards = {oversize, prematureCommit, abortRestoresIdle: true,
      noNorCommands: true, norUnchanged: true};
    report.phase = 'flash preflight';
    const oldNor = session.board.flash.flash.slice();
    const oldNorSha256 = hash(oldNor);
    decodeStatus(session.usbReport(featureReport(5)));
    const preflight = pollStatus(session, status => status.flash_ready === 1, 'Read-only flash preflight');
    assert.equal(preflight.jedec, 0xc22016);
    assert.equal(preflight.flash_status, 0x40);
    assert.equal(session.board.flash.erases.length, 0);
    assert.equal(session.board.flash.pages.length, 0);
    assert.ok(session.board.flash.commandLog.every(command => ![2, 6, 0x20].includes(command.opcode)),
      'Preflight issues no program, write-enable or erase');
    const diagnostic = await readDiagnostics(session);
    assert.equal(hash(session.board.flash.flash), oldNorSha256);
    report.preflight = {status: preflight, diagnostic,
      commandCount: session.board.flash.commandLog.length, norUnchanged: true,
      fcbSource: session.board.flash.fcbSource, sfdpSource: session.board.flash.sfdpSource};
    console.log('Compiled R13 USB descriptors and measured-profile read-only preflight passed.');
    report.phase = 'RAM upload';
    report.upload = uploadFirmware(session, candidate);
    const crc = report.upload.crc32;
    let status = report.upload.status;
    console.log(`Compiled R13 RAM upload and device CRC/reread passed (${candidate.length} bytes, ${report.upload.packets} DATA reports).`);
    if (updateR14) {
      report.phase = 'bounded no-WEL failure and recovery';
      report.negative = rejectedWriteEnable(session, crc);
      const abort = decodeStatus(session.usbReport(featureReport(4)));
      assert.equal(abort.state, 0);
      assert.equal(abort.error, 0);
      decodeStatus(session.usbReport(featureReport(5)));
      const recoveredPreflight = pollStatus(session, item => item.flash_ready === 1,
        'Read-only preflight after no-WEL fault');
      assert.equal(recoveredPreflight.jedec, 0xc22016);
      assert.equal(recoveredPreflight.flash_status, 0x40);
      report.negative.recovery = {abort, preflight: recoveredPreflight,
        upload: uploadFirmware(session, candidate), norUnchanged: true};
      assert.equal(hash(session.board.flash.flash), oldNorSha256);
      console.log('Actual driver rejected missing WEL before mutation; abort, fresh preflight and reupload recovered.');
    }
    report.phase = 'APP1 flash/readback';
    const beforeCommitInstructions = session.cpu.totalInstructions;
    const commandStart = session.board.flash.commandLog.length;
    const eraseObservations = [];
    let seenErases = 0;
    const stopObserving = session.cpu.onInstruction(() => {
      while (seenErases < session.board.flash.erases.length) {
        const address = session.board.flash.erases[seenErases++];
        const erased = session.board.flash.flash.subarray(address, address + 4096);
        assert.ok(erased.every(byte => byte === 255), 'NOR erase physically changes the modeled bytes before programming');
        const previous = oldNor.subarray(address, address + 4096);
        const changed = previous.reduce((count, byte) => count + (byte !== 255 ? 1 : 0), 0);
        if (address < APP1_OFFSET + Math.ceil(bytes.length / 4096) * 4096)
          assert.ok(changed > 0, 'An occupied R13 sector actually changed during erase');
        eraseObservations.push({address, changedBytes: changed, erasedSha256: hash(erased)});
      }
    });
    let flashed;
    try {
      status = decodeStatus(session.usbReport(featureReport(6, (crc ^ 0x46534c48) >>> 0)));
      assert.ok([4, 5, 6].includes(status.state), 'Commit acknowledges queued/writing/verified state');
      assert.equal(status.error, 0);
      flashed = status.state === 6 ? status : pollStatus(session, item => item.state === 6, 'Actual APP1 flash/readback', 20000000);
    } finally {stopObserving();}
    const programmedBytes = Math.ceil(candidate.length / 4096) * 4096;
    const end = APP1_OFFSET + programmedBytes;
    assert.equal(flashed.flash_crc32, crc);
    assert.equal(flashed.programmed, programmedBytes);
    assert.equal(flashed.flash_error, 0);
    assert.deepEqual(session.board.flash.erases,
      [...Array.from({length: programmedBytes / 4096 - 1}, (_, index) => APP1_OFFSET + (index + 1) * 4096), APP1_OFFSET],
      'Actual writer keeps the APP1 entry sector last');
    assert.equal(session.board.flash.pages.length, programmedBytes / 256);
    assert.equal(eraseObservations.length, programmedBytes / 4096);
    assert.deepEqual(session.board.flash.flash.subarray(APP1_OFFSET, APP1_OFFSET + candidate.length), candidate);
    assert.ok(session.board.flash.flash.subarray(APP1_OFFSET + candidate.length, end).every(byte => byte === 255));
    assert.deepEqual(session.board.flash.flash.subarray(0, APP1_OFFSET), oldNor.subarray(0, APP1_OFFSET),
      'Executed writer preserves the resident even though the NOR model allows whole-chip mutations');
    assert.deepEqual(session.board.flash.flash.subarray(end), oldNor.subarray(end),
      'Executed writer preserves all bytes beyond its occupied APP1 sectors, including the excluded final sector');
    const actualCommands = session.board.flash.commandLog.slice(commandStart);
    const reads = actualCommands.filter(command => command.opcode === 3 && command.address >= APP1_OFFSET && command.address < end);
    assert.equal(reads.length, programmedBytes / 256);
    assert.equal(reads.reduce((count, command) => count + command.length, 0), programmedBytes);
    assert.deepEqual(reads.map(command => command.address),
      Array.from({length: programmedBytes / 256}, (_, index) => APP1_OFFSET + index * 256));
    assert.ok(actualCommands.every(command => !command.error), 'NOR accepted every emitted driver transaction');
    const separateStatus = decodeStatus(session.usbReport());
    assert.equal(separateStatus.state, 6, 'A separate actual GET_REPORT retains verified completion');
    assert.equal(separateStatus.flash_crc32, crc);
    assert.equal(separateStatus.flash_error, 0);
    const storedNorSha256 = hash(session.board.flash.flash);
    report.flash = {status: flashed, separateStatus, programmedBytes, actualIpReadbackBytes: programmedBytes,
      crc32: hex(crc), commandCount: actualCommands.length,
      commandSha256: hash(JSON.stringify(actualCommands)),
      erases: [...session.board.flash.erases], pages: [...session.board.flash.pages], eraseObservations,
      preservedResidentSha256: hash(session.board.flash.flash.subarray(0, APP1_OFFSET)),
      preservedTailSha256: hash(session.board.flash.flash.subarray(end)), storedNorSha256,
      instructions: session.cpu.totalInstructions - beforeCommitInstructions,
      unchangedImageRestaged: !updateR14, candidateSha256: hash(candidate)};
    console.log(`Actual R13 RAM-resident writer passed ${programmedBytes}-byte IP readback and separate USB status.`);
    report.phase = 'model power cycle';
    const beforeResetInstructions = session.cpu.totalInstructions;
    await session.reset();
    assert.equal(hash(session.board.flash.flash), storedNorSha256, 'Model power cycle retains programmed NOR');
    assert.equal(session.image.sha256, target.evidence.sha256, 'New launch image is read from the retained NOR header and bytes');
    assert.deepEqual(session.image.bytes, candidate, 'Reset uses the exact declared candidate bytes from NOR');
    report.reboot = boot(session, 5, targetMarker);
    const freshStatus = decodeStatus(session.usbReport(), targetMarker);
    assert.equal(freshStatus.state, 0);
    assert.equal(freshStatus.length, 0);
    assert.equal(freshStatus.received, 0);
    assert.equal(freshStatus.flash_ready, 0);
    assert.equal(freshStatus.build_marker, targetMarker);
    report.reboot.status = freshStatus;
    report.reboot.firmwareSha256 = session.image.sha256;
    report.reboot.bytes = session.image.bytes.length;
    report.reboot.identityChanged = session.image.sha256 !== report.firmware.sha256;
    assert.equal(report.reboot.identityChanged, updateR14);
    report.reboot.norSha256 = hash(session.board.flash.flash);
    report.board = {unknownMmio: session.board.status().unknownMmio,
      unknownMmioOverflow: session.board.status().unknownMmioOverflow};
    assert.equal(report.board.unknownMmio.length, 0);
    assert.equal(report.board.unknownMmioOverflow, 0);
    report.mainInstructionLifetimes = {beforeModelReset: beforeResetInstructions,
      afterModelReset: session.cpu.totalInstructions};
    report.totalInstructions = beforeResetInstructions + session.cpu.totalInstructions;
    console.log(`Model power cycle passed fresh ${target.evidence.name} boot and idle USB status from retained NOR.`);
  } catch (error) {
    report.failureSnapshot = session.snapshot();
    delete report.failureSnapshot.display;
    report.failureFlash = {commands: session.board.flash.commandLog.slice(-32),
      erases: [...session.board.flash.erases], pages: [...session.board.flash.pages]};
    throw error;
  } finally {session.close();}
  report.phase = 'parallel worker isolation';
  const workers = await Promise.allSettled([launchWorker(bytes, 0.25, runtimeDirectory), launchWorker(bytes, 0.75, runtimeDirectory)]);
  report.parallelWorkers = workers.map(result => result.status === 'fulfilled' ? result.value : {error: String(result.reason)});
  for (const result of workers) if (result.status === 'rejected') throw result.reason;
  const [first, second] = workers.map(result => result.value);
  assert.notEqual(first.observedRaw, second.observedRaw);
  assert.notEqual(first.snapshotSha256, second.snapshotSha256);
  assert.equal(first.norSha256, second.norSha256, 'Independent inputs do not modify either NOR image');
  report.parallelIsolation = {actualWorkerThreads: 2, divergentInputsAndFirmwareSnapshots: true,
    independentCpuBoardNor: true};
  assert.deepEqual(await sourcePins(), report.sourceSha256, 'Sources must not change during the evidence run');
  assert.deepEqual(await runtimeEvidence(runtimeDirectory), report.runtime, 'Runtime assets must remain stable for the evidence run');
  report.phase = 'complete';
  report.passed = true;
}

export async function main(argv = process.argv.slice(2)) {
  const hostStart = performance.now();
  const argument = (name, fallback) => {
    const index = argv.indexOf(name);
    if (index === -1) return fallback;
    assert.ok(argv[index + 1], `${name} requires a value`);
    return path.resolve(argv[index + 1]);
  };
  const updateR14 = argv.includes('--update-r14');
  const runtimeDirectory = argv.includes('--runtime-dir') ? argument('--runtime-dir') : undefined;
  assert.ok(!runtimeDirectory || argv.includes('--report'), 'Candidate qualification requires a separate --report destination');
  const firmware = argument('--firmware', defaultFirmware);
  const destination = argument('--report', updateR14 ? differentImageReport : defaultReport);
  assert.ok(!runtimeDirectory || path.relative(defaultReport, destination) !== '',
    'Candidate results must not replace the published-runtime R13 report');
  const report = {
    schema: updateR14 ? 'opensp-r13-r14-machine-update-v1' : 'opensp-r13-machine-integration-v1',
    timestampUtc: new Date().toISOString(), passed: false,
    scope: updateR14
      ? 'Exact original R13 receives preserved original R14 over virtual USB, rejects a bounded missing-WEL fault before mutation, recovers through its actual client protocol, completes NOR IP readback and boots distinct R14 from retained NOR; two Node worker threads independently run R13.'
      : 'Exact original R13 executes in ARM WASM through startup, OLED GPIO, USB EP0/HID, RAM CRC, FlexSPI erase/program/IP readback and a model power cycle; two actual Node worker threads execute separate firmware sessions.',
    modeledClock: {gptHz: 24000000, counterReadIncrement: 24000, cpuCyclesMeasured: false},
    modeledHost: {statusCompletion: 'Guest services ENDPTCOMPLETE before the next SETUP',
      guestIdleInstructionsAfterEachControl: 25000, physicalElapsedTimeMeasured: false},
    physicalDeviceAccess: false, firmwareBytesPublished: false,
    limitations: [
      'APP1 begins at the captured resident handoff, not a cold ROM or resident-loader execution.',
      updateR14
        ? 'This covers the preserved R13-to-R14 ABI1 update and a no-WEL failure before erase; other firmware families and interrupted programming remain unverified.'
        : 'This is a same-image R13 update; a changed firmware identity and broader firmware families are separate evidence.',
      'FCB geometry, busy completion, ADC conversion and bounded companion replies include explicit model fixtures.',
      'NOR policy bounds are enforced by the executed R13 writer; the hardware model permits whole-chip mutations.',
      'No physical USB, PHY, cache coherence, electrical timing, flash endurance or interrupted-update recovery is established.',
      'Stock sampler, SD/filesystem, SAI/DMA audio, complete BMC and all peripheral behavior remain unverified.',
      'Instruction counts and accelerated GPT reads do not establish device deadlines.',
      'USB host idle turns are synthetic instruction intervals; physical host polling intervals are not measured.',
    ],
  };
  try {
    await run(firmware, report, updateR14, runtimeDirectory);
    report.hostElapsedMs = Math.round(performance.now() - hostStart);
    await fs.mkdir(path.dirname(destination), {recursive: true});
    const replacedReport = await archiveExistingReport(destination);
    if (replacedReport) report.replacedReport = replacedReport;
    await fs.writeFile(destination, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({passed: true, report: path.relative(project, destination).replaceAll('\\', '/'),
      firmwareSha256: report.firmware.sha256, candidateSha256: report.candidate.sha256,
      bootMarker: report.reboot.marker, parallelWorkers: report.parallelIsolation.actualWorkerThreads}));
    return report;
  } catch (error) {
    report.hostElapsedMs = Math.round(performance.now() - hostStart);
    report.error = {name: error.name, message: error.message};
    if (report.sourceSha256) report.finalSourceSha256 = await sourcePins();
    const failed = path.join(path.dirname(destination), `failed-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}.json`);
    await fs.mkdir(path.dirname(failed), {recursive: true});
    await fs.writeFile(failed, JSON.stringify(report, null, 2) + '\n');
    console.error(JSON.stringify({passed: false, phase: report.phase, error: report.error,
      preserved: path.relative(project, failed).replaceAll('\\', '/')}));
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
