import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createSession} from '../src/lib/emulator/session.ts';
import {loadFirmwareImage} from '../src/lib/emulator/image.ts';
import {VirtualFirmwareUpdater} from '../src/lib/emulator/update.ts';
import {archiveExistingReport, boot, decodeStatus, hash, pinOriginalFirmware, runtimeEvidence, runtimeSessionOptions} from './test-emulator-firmware.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firmwareProject = path.resolve(project, '../sp404mk2');
const defaultReport = path.join(project, 'tools/emulator-evidence/updater-roundtrip.json');
const APP1_OFFSET = 0x80000;
const original = {
  R13: {sha256: '4891fd9451cd107f6f50f4fb85d75f538cf5b2eb3c7fb2680f36719b32f67e8a', marker: 0x523d0001},
  R14: {sha256: 'b8e582ce74fb28b209dc9b14eccc9c175745bcb20648efe0ca9a0053c9e92695', marker: 0x523e0001},
};
const sourceFiles = ['src/lib/emulator/image.ts', 'src/lib/emulator/cpu.ts',
  'src/lib/emulator/board.ts', 'src/lib/emulator/gpio-read.ts', 'src/lib/emulator/oscillator.ts', 'src/lib/emulator/usb.ts', 'src/lib/emulator/flash.ts',
  'src/lib/emulator/dcdc.ts', 'src/lib/emulator/usdhc.ts', 'src/lib/emulator/pll-arm.ts', 'src/lib/emulator/pll-usb2.ts',
  'src/lib/emulator/pll-video.ts',
  'src/lib/emulator/pll-audio.ts',
  'src/lib/emulator/sd-fixtures.ts',
  'src/lib/emulator/exceptions.ts', 'src/lib/emulator/exception-return.ts', 'src/lib/emulator/session.ts', 'src/lib/emulator/instruction-boundary.ts', 'src/lib/emulator/update.ts',
  'tools/test-emulator-firmware.mjs', 'tools/test-emulator-update.mjs'];
const hex = value => `0x${value.toString(16).padStart(8, '0')}`;

async function sourcePins() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async name =>
    [name, hash(await fs.readFile(path.join(project, name)))])));
}

async function preserved(version) {
  const info = original[version];
  const pinned = await pinOriginalFirmware(path.join(firmwareProject,
    `sdk/examples/original_${version.toLowerCase()}/build/original_${version.toLowerCase()}.bin`),
  version, info.sha256, info.marker);
  const image = await loadFirmwareImage(pinned.bytes, {format: 'app1'});
  assert.equal(image.abi, 1);
  return {...pinned, image, marker: info.marker};
}

function startObservation(session) {
  return {nor: session.board.flash.flash.slice(), instructions: session.cpu.totalInstructions,
    commands: session.board.flash.commandLog.length, erases: session.board.flash.erases.length,
    pages: session.board.flash.pages.length};
}

function actualWrite(session, before, candidate) {
  const length = Math.ceil(candidate.bytes.length / 4096) * 4096;
  const end = APP1_OFFSET + length;
  const nor = session.board.flash.flash;
  const erases = session.board.flash.erases.slice(before.erases);
  const pages = session.board.flash.pages.slice(before.pages);
  const commands = session.board.flash.commandLog.slice(before.commands);
  assert.deepEqual(erases, [...Array.from({length: length / 4096 - 1},
    (_, index) => APP1_OFFSET + (index + 1) * 4096), APP1_OFFSET]);
  assert.equal(pages.length, length / 256);
  assert.deepEqual(nor.subarray(APP1_OFFSET, APP1_OFFSET + candidate.bytes.length), candidate.bytes);
  assert.ok(nor.subarray(APP1_OFFSET + candidate.bytes.length, end).every(byte => byte === 255));
  assert.deepEqual(nor.subarray(0, APP1_OFFSET), before.nor.subarray(0, APP1_OFFSET),
    'Executed writer preserves resident while the model permits whole-chip mutations');
  assert.deepEqual(nor.subarray(end), before.nor.subarray(end),
    'Executed writer preserves every byte beyond occupied target sectors');
  const readback = commands.filter(command => command.opcode === 3 &&
    command.address >= APP1_OFFSET && command.address < end);
  assert.equal(readback.length, length / 256);
  assert.equal(readback.reduce((count, command) => count + command.length, 0), length);
  assert.deepEqual(readback.map(command => command.address),
    Array.from({length: length / 256}, (_, index) => APP1_OFFSET + index * 256));
  assert.ok(commands.every(command => !command.error));
  assert.ok(!nor.subarray(APP1_OFFSET, end).every((byte, index) =>
    byte === before.nor[APP1_OFFSET + index]), 'Different-image update actually changes occupied NOR');
  assert.equal(session.image.sha256, candidate.evidence.sha256);
  assert.deepEqual(session.image.bytes, candidate.bytes);
  const status = decodeStatus(session.usbReport(), candidate.marker);
  assert.equal(status.state, 0);
  assert.equal(status.error, 0);
  assert.equal(status.flash_error, 0);
  assert.equal(status.build_marker, candidate.marker);
  const snapshot = session.snapshot();
  assert.equal(snapshot.marker, candidate.marker);
  assert.equal(snapshot.firmwareState, 2);
  assert.equal(snapshot.firmwareHash, candidate.evidence.sha256);
  assert.deepEqual(snapshot.unknownMmio, []);
  assert.equal(snapshot.unknownMmioOverflow, 0);
  return {programmedBytes: length, actualIpReadbackBytes: length, erases, pages,
    commandCount: commands.length, commandSha256: hash(JSON.stringify(commands)),
    preservedResidentSha256: hash(nor.subarray(0, APP1_OFFSET)),
    preservedTailSha256: hash(nor.subarray(end)), storedNorSha256: hash(nor),
    exactCandidateSha256: hash(nor.subarray(APP1_OFFSET, APP1_OFFSET + candidate.bytes.length)),
    freshStatus: status, freshMailbox: {marker: hex(snapshot.marker), state: snapshot.firmwareState,
      firmwareSha256: snapshot.firmwareHash}, unknownMmio: snapshot.unknownMmio};
}

function healthySnapshot(session) {
  const snapshot = session.snapshot();
  return {marker: snapshot.marker, firmwareState: snapshot.firmwareState,
    firmwareHash: snapshot.firmwareHash, unknownMmio: snapshot.unknownMmio,
    unknownMmioOverflow: snapshot.unknownMmioOverflow, cpuBackendFailed: snapshot.cpuBackendFailed,
    fault: snapshot.fault, flash: snapshot.flash};
}

async function run(report, runtimeDirectory) {
  report.sourceSha256 = await sourcePins();
  report.runtime = await runtimeEvidence(runtimeDirectory);
  assert.equal(report.runtime.hasKnownR14Frontier, false,
    'R14 has a preserved boot frontier on this unrepaired runtime; use a qualified repaired engine');
  const measuredProfileFile = 'analysis/hardware/usb_r11_20260922T190757Z/preflight.json';
  const measuredProfileBytes = await fs.readFile(path.join(firmwareProject, measuredProfileFile));
  const measuredProfile = JSON.parse(JSON.parse(measuredProfileBytes.toString('utf8')).steps
    .find(item => item.action === 'diagnostics').stdout);
  report.measuredProfile = {file: measuredProfileFile, sha256: hash(measuredProfileBytes)};
  const [r13, r14] = await Promise.all([preserved('R13'), preserved('R14')]);
  report.firmware = {initial: r13.evidence, intermediate: r14.evidence, final: r13.evidence};
  const session = await createSession(r13.bytes, runtimeSessionOptions(runtimeDirectory));
  const resets = [];
  const reports = {normalGets: 0, commands: {}, signatures: {}};
  let retiredInstructions = 0;
  let pendingCandidate;
  const totalInstructions = () => retiredInstructions + session.cpu.totalInstructions;
  try {
    report.phase = 'initial R13 boot';
    report.initialBoot = boot(session);
    const initialNorSha256 = hash(session.board.flash.flash);
    const updater = new VirtualFirmwareUpdater({
      transport: async request => {
        const bytes = session.usbReport(request);
        if (request) reports.commands[request[0]] = (reports.commands[request[0]] ?? 0) + 1;
        else reports.normalGets++;
        const signature = String.fromCharCode(...bytes.subarray(0, 4));
        reports.signatures[signature] = (reports.signatures[signature] ?? 0) + 1;
        if (signature === 'SP13' || signature === 'SP14')
          reports.lastNormalStatus = decodeStatus(bytes, signature === 'SP14' ? original.R14.marker : original.R13.marker);
        return Array.from(bytes);
      },
      reset: async target => {
        assert.ok(pendingCandidate, 'Updater reset belongs to an inspected candidate');
        assert.equal(target.length, pendingCandidate.bytes.length, 'Reset forwards the exact verified target extent');
        assert.equal(target.sha256, pendingCandidate.evidence.sha256, 'Reset forwards the exact verified target hash');
        assert.equal(target.expectedCurrentSha256, session.image.sha256, 'Reset belongs to the current running image');
        const before = {firmwareSha256: session.image.sha256, instructions: session.cpu.totalInstructions,
          norSha256: hash(session.board.flash.flash)};
        retiredInstructions += before.instructions;
        await session.reset(target);
        assert.equal(hash(session.board.flash.flash), before.norSha256, 'Reset retains the actual programmed NOR');
        assert.equal(session.image.sha256, pendingCandidate.evidence.sha256);
        assert.deepEqual(session.image.bytes, pendingCandidate.bytes);
        const startup = boot(session, 5, pendingCandidate.marker);
        resets.push({before, after: {firmwareSha256: session.image.sha256,
          bytes: session.image.bytes.length, norSha256: hash(session.board.flash.flash), startup}});
      },
      snapshot: async () => healthySnapshot(session),
    });
    report.directions = [];
    for (const [running, candidate] of [[r13, r14], [r14, r13]]) {
      report.phase = `${running.evidence.name} to ${candidate.evidence.name}`;
      const before = startObservation(session);
      const startInstructions = totalInstructions();
      const progress = {events: 0, phaseCounts: {}, last: undefined};
      report.pendingDirection = {from: running.evidence.name, to: candidate.evidence.name, progress};
      pendingCandidate = candidate;
      const result = await updater.update(candidate.bytes, {
        expectedSha256: candidate.evidence.sha256, expectedMarker: candidate.marker,
        expectedRunningMarker: running.marker,
        onProgress: event => {
          progress.events++;
          const phase = event.phase ?? 'unspecified';
          progress.phaseCounts[phase] = (progress.phaseCounts[phase] ?? 0) + 1;
          progress.last = event;
        },
      });
      assert.equal(result.image.sha256, candidate.evidence.sha256);
      assert.equal(result.image.length, candidate.bytes.length);
      assert.equal(result.image.paddedLength, Math.ceil(candidate.bytes.length / 4096) * 4096);
      assert.equal(result.before.build_marker, running.marker);
      assert.equal(result.before.state, 0);
      assert.ok(result.before.maximum >= candidate.bytes.length);
      for (const snapshot of [result.beforeSnapshot, result.beforeResetSnapshot]) {
        assert.equal(snapshot.marker, running.marker);
        assert.equal(snapshot.firmwareState, 2);
        assert.equal(snapshot.firmwareHash, running.evidence.sha256);
        assert.deepEqual(snapshot.unknownMmio, []);
        assert.equal(snapshot.unknownMmioOverflow, 0);
      }
      assert.equal(result.preflight.status.jedec, 0xc22016);
      assert.equal(result.preflight.status.flash_status, 0x40);
      assert.equal(result.preflight.status.flash_error, 0);
      assert.equal(result.preflight.status.flash_ready, 1);
      assert.equal(result.preflight.diagnostics.headerHex, measuredProfile.header_hex);
      assert.equal(result.preflight.diagnostics.bfptHex, measuredProfile.bfpt_hex);
      for (const [field, value] of Object.entries(result.preflight.diagnostics)) {
        if (field !== 'headerHex' && field !== 'bfptHex') assert.equal(value, measuredProfile[field]);
      }
      assert.equal(result.ramVerified.state, 2);
      assert.equal(result.ramVerified.crc32, result.image.crc32);
      assert.equal(result.flashVerified.state, 6);
      assert.equal(result.flashVerified.flash_error, 0);
      assert.equal(result.flashVerified.flash_crc32, result.image.crc32);
      assert.equal(result.separateStatus.state, 6);
      assert.equal(result.separateStatus.flash_crc32, result.image.crc32);
      assert.equal(result.flashReadback.verifiedBytes, result.image.paddedLength);
      assert.equal(result.flashReadback.imageCrc32, result.image.crc32);
      assert.equal(result.flashReadback.tail, 'FF');
      assert.equal(result.bootStatus.state, 0);
      assert.equal(result.bootStatus.build_marker, candidate.marker);
      assert.equal(result.snapshot.firmwareHash, candidate.evidence.sha256);
      assert.equal(result.phases.filter(event => event.phase === 'upload').length, Math.ceil(candidate.bytes.length / 56));
      assert.equal(result.phases.at(-1).phase, 'boot-verified');
      assert.equal(result.phases.at(-1).completedBytes, candidate.bytes.length);
      const executed = actualWrite(session, before, candidate);
      const {phases, ...receipt} = result;
      report.directions.push({from: running.evidence.name, to: candidate.evidence.name,
        updater: {...receipt, phases: {count: phases.length, sha256: hash(JSON.stringify(phases))}},
        progress, executed, instructions: totalInstructions() - startInstructions});
      delete report.pendingDirection;
      console.log(`${running.evidence.name} -> ${candidate.evidence.name}: reusable updater, actual ${executed.actualIpReadbackBytes}-byte IP readback and fresh marker passed.`);
    }
    assert.equal(resets.length, 2);
    assert.equal(session.image.sha256, r13.evidence.sha256);
    assert.equal(healthySnapshot(session).marker, r13.marker);
    const afterNorSha256 = hash(session.board.flash.flash);
    const returnedEnd = APP1_OFFSET + Math.ceil(r13.bytes.length / 4096) * 4096;
    const intermediateEnd = APP1_OFFSET + Math.ceil(r14.bytes.length / 4096) * 4096;
    assert.ok(session.board.flash.flash.subarray(returnedEnd, intermediateEnd).some(byte => byte !== 255),
      'R14 bytes beyond the smaller R13 occupied interval remain preserved by the real writer');
    assert.notEqual(afterNorSha256, initialNorSha256, 'Restoring declared APP1 identity preserves the previous larger-image tail');
    report.roundtrip = {declaredApp1Restored: true, marker: hex(r13.marker), sha256: r13.evidence.sha256,
      initialNorSha256, finalNorSha256: afterNorSha256, wholeNorRestored: false,
      preservedIntermediateTail: {start: returnedEnd, end: intermediateEnd,
        sha256: hash(session.board.flash.flash.subarray(returnedEnd, intermediateEnd))}};
    report.resets = resets;
    report.usbReports = reports;
    report.totalInstructions = totalInstructions();
    assert.deepEqual(await sourcePins(), report.sourceSha256, 'Sources must remain stable for the full evidence run');
    assert.deepEqual(await runtimeEvidence(runtimeDirectory), report.runtime, 'Runtime assets must remain stable for the evidence run');
    report.phase = 'complete';
    report.passed = true;
  } catch (error) {
    report.failureSnapshot = session.snapshot();
    delete report.failureSnapshot.display;
    report.failureFlash = {commands: session.board.flash.commandLog.slice(-32),
      erases: [...session.board.flash.erases], pages: [...session.board.flash.pages]};
    report.resets = resets;
    report.usbReports = reports;
    throw error;
  } finally {session.close();}
}

export async function main(argv = process.argv.slice(2)) {
  const hostStart = performance.now();
  const argument = (name, fallback) => {
    const index = argv.indexOf(name);
    if (index === -1) return fallback;
    assert.ok(argv[index + 1], `${name} requires a value`);
    return path.resolve(argv[index + 1]);
  };
  const runtimeDirectory = argv.includes('--runtime-dir') ? argument('--runtime-dir') : undefined;
  assert.ok(!runtimeDirectory || argv.includes('--report'), 'Candidate qualification requires a separate --report destination');
  const destination = argument('--report', defaultReport);
  assert.ok(!runtimeDirectory || path.relative(defaultReport, destination) !== '',
    'Candidate results require a separate destination from the default roundtrip report');
  const report = {schema: 'opensp-virtual-updater-roundtrip-v1', timestampUtc: new Date().toISOString(), passed: false,
    scope: 'The reusable VirtualFirmwareUpdater drives actual R13-to-R14 and R14-to-R13 USB reports, guest CRC, NOR IP readback, separate completion status and retained-NOR resets in one ARM WASM session.',
    physicalDeviceAccess: false, firmwareBytesPublished: false,
    modeledClock: {gptHz: 24000000, counterReadIncrement: 24000, cpuCyclesMeasured: false},
    modeledHost: {statusCompletion: 'Guest services ENDPTCOMPLETE before the next SETUP',
      guestIdleInstructionsAfterEachControl: 25000, physicalElapsedTimeMeasured: false},
    limitations: [
      'Both images begin at the captured resident APP1 handoff; ROM, resident cold boot and physical recovery are unverified.',
      'This roundtrip covers exact preserved R13/R14 ABI1 builds and the measured Macronix profile fixture.',
      'The writer updates occupied target sectors and preserves bytes beyond them, including an older larger image tail.',
      'Host idle turns, GPT reads, ADC completion, busy durations and companion replies contain model fixtures.',
      'No physical USB, cache coherence, flash endurance, interrupted programming or audio route behavior is established.',
    ],
  };
  try {
    await run(report, runtimeDirectory);
    report.finalSourceSha256 = await sourcePins();
    report.finalRuntime = await runtimeEvidence(runtimeDirectory);
    report.sourcesStable = JSON.stringify(report.finalSourceSha256) === JSON.stringify(report.sourceSha256);
    report.runtimeStable = JSON.stringify(report.finalRuntime) === JSON.stringify(report.runtime);
    assert.equal(report.sourcesStable, true, 'Source pins remain stable throughout the roundtrip');
    assert.equal(report.runtimeStable, true, 'Runtime artifacts remain stable throughout the roundtrip');
    report.hostElapsedMs = Math.round(performance.now() - hostStart);
    await fs.mkdir(path.dirname(destination), {recursive: true});
    const replacedReport = await archiveExistingReport(destination);
    if (replacedReport) report.replacedReport = replacedReport;
    await fs.writeFile(destination, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({passed: true, report: path.relative(project, destination).replaceAll('\\', '/'),
      directions: report.directions.length, marker: report.roundtrip.marker}));
    return report;
  } catch (error) {
    report.hostElapsedMs = Math.round(performance.now() - hostStart);
    report.error = {name: error.name, message: error.message,
      phase: error.phase, code: error.code, evidence: error.evidence};
    if (report.sourceSha256) report.finalSourceSha256 = await sourcePins();
    const failed = path.join(path.dirname(destination),
      `failed-updater-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}.json`);
    await fs.mkdir(path.dirname(failed), {recursive: true});
    await fs.writeFile(failed, JSON.stringify(report, null, 2) + '\n');
    console.error(JSON.stringify({passed: false, phase: report.phase, error: report.error,
      preserved: path.relative(project, failed).replaceAll('\\', '/')}));
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
