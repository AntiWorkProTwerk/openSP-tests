import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createSession} from '../src/lib/emulator/session.ts';
import {loadFirmwareImage, validateApp1ResetContract} from '../src/lib/emulator/image.ts';
import {VirtualFirmwareUpdater, prepareVirtualUpdateCandidate} from '../src/lib/emulator/update.ts';
import {boot, crc32, hash, runtimeEvidence, runtimeSessionOptions} from './test-emulator-firmware.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firmwareProject = path.resolve(project, '../sp404mk2');
const APP1_OFFSET = 0x80000;
const STATUS_FIELDS = ['version', 'state', 'error', 'length', 'received', 'crc32', 'maximum',
  'capabilities', 'jedec', 'flash_status', 'flash_error', 'programmed', 'flash_ready', 'flash_crc32', 'build_marker'];
const firmware = Object.freeze({
  R13: {name: 'R13', bytes: 15396, crc32: 0xdbd57e56, marker: 0x523d0001, signature: 'SP13', maximum: 0x10000,
    usbIdentity: 'CAFE:404D', sha256: '4891fd9451cd107f6f50f4fb85d75f538cf5b2eb3c7fb2680f36719b32f67e8a',
    manifestSha256: '540b094a2588532d629376426870321ddc86c4f4ad75beb2bf4172ec5b488dbd'},
  R16B: {name: 'R16B', bytes: 17156, crc32: 0x9877af99, marker: 0x52410001, signature: 'SP16', maximum: 0x37f000,
    usbIdentity: 'CAFE:404F', sha256: '7bcc3537ea94288451738f14a428f44d87ca4db9887a27ad5bd3f99d05a16e2d',
    manifestSha256: '0a34e4641f46dad33b5b14b73dfa565b82e82caa78159b3254089d5f2fc1ae7b'},
  R48: {name: 'R48', bytes: 17156, crc32: 0x4b72185e, marker: 0x52620001, signature: 'SP48', maximum: 0x37f000,
    usbIdentity: 'CAFE:404F', sha256: '11d7631ea73232fbfe2bb30ca6a705f416417cb1aec54290a04944a26d7edba4',
    manifestSha256: '1e7fa9ff3f358dacd24b0e7fd475d0dd644fac2a59a7b049c56bf35de61c488d'},
});
const relative = file => path.relative(project, file).replaceAll('\\', '/');
const hex = value => `0x${value.toString(16).padStart(8, '0')}`;

export function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    assert.ok(['--recipient', '--runtime-dir', '--report', '--execute'].includes(name), `Unsupported runner argument: ${name}`);
    assert.equal(args[name], undefined, `Repeated runner argument: ${name}`);
    if (name === '--execute') args[name] = true;
    else {
      assert.ok(argv[index + 1] && !argv[index + 1].startsWith('--'), `${name} requires a value`);
      args[name] = argv[++index];
    }
  }
  assert.ok(['R16B', 'R48'].includes(args['--recipient']), 'Select one exact normal recipient with --recipient R16B or R48');
  assert.ok(args['--report'], 'A fresh explicit --report destination preserves prior evidence');
  return {recipient: args['--recipient'], execute: args['--execute'] === true,
    destination: path.resolve(args['--report']),
    runtimeDirectory: args['--runtime-dir'] ? path.resolve(args['--runtime-dir']) : undefined};
}

async function sourcePins() {
  const names = (await fs.readdir(path.join(project, 'src/lib/emulator')))
    .filter(name => name.endsWith('.ts')).map(name => `src/lib/emulator/${name}`);
  names.push('tools/test-emulator-firmware.mjs', 'tools/test-emulator-larger-writer-small.mjs');
  names.sort();
  return Object.fromEntries(await Promise.all(names.map(async name => [name, hash(await fs.readFile(path.join(project, name)))])));
}

async function pinFirmware(name) {
  const identity = firmware[name];
  const directory = path.join(firmwareProject, `sdk/examples/original_${name.toLowerCase()}`);
  const file = path.join(directory, 'build', `original_${name.toLowerCase()}.bin`);
  const manifestFile = path.join(directory, 'build/manifest.json');
  const [bytes, manifestBytes] = await Promise.all([fs.readFile(file), fs.readFile(manifestFile)]);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(hash(manifestBytes), identity.manifestSha256, `${name} exact retained manifest`);
  assert.equal(hash(bytes), identity.sha256, `${name} exact normal binary`);
  assert.equal(bytes.length, identity.bytes);
  assert.equal(crc32(bytes), identity.crc32);
  assert.equal(manifest.binary_sha256, identity.sha256);
  assert.equal(manifest.binary_size, identity.bytes);
  assert.notEqual(manifest.proof, true, 'Proof builds are outside this runner');
  const sourceSha256 = {};
  for (const [source, expected] of Object.entries(manifest.sources ?? manifest.base_sources)) {
    let sourceFile = name === 'R48' ? path.join(firmwareProject, 'sdk/examples/original_r16b', source) : path.join(directory, source);
    if (name === 'R16B') {
      const retained = path.join(firmwareProject, 'custom_firmware/build/original_r16b/SOURCE', source);
      try {await fs.access(retained); sourceFile = retained;} catch (error) {if (error.code !== 'ENOENT') throw error;}
    }
    const actual = hash(await fs.readFile(sourceFile));
    assert.equal(actual, expected, `${name} retained build source: ${source}`);
    sourceSha256[relative(sourceFile)] = actual;
  }
  if (name === 'R48') {
    const buildFile = path.join(directory, 'build.py');
    assert.equal(hash(await fs.readFile(buildFile)), manifest.build_script_sha256);
    sourceSha256[relative(buildFile)] = manifest.build_script_sha256;
    assert.equal(manifest.identity.marker, hex(identity.marker));
    assert.equal(manifest.identity.tag, identity.signature);
    assert.equal(manifest.default_compatibility.byte_identical, true);
    assert.equal(manifest.default_compatibility.rebuilt_sha256, firmware.R16B.sha256);
  }
  const image = await loadFirmwareImage(new Uint8Array(bytes), {format: 'app1'});
  assert.equal(image.abi, 1);
  return {bytes: image.bytes, identity, evidence: {...identity, binary: relative(file),
    manifest: relative(manifestFile), buildSourceSha256: sourceSha256,
    headerSha256: hash(bytes.subarray(0x200, 0x220)), checkpoint: image.checkpoint}};
}

export function decodeProfileStatus(bytes, identity) {
  assert.equal(bytes.length, 64, 'Executed feature-report response length');
  const data = Uint8Array.from(bytes);
  const signature = String.fromCharCode(...data.subarray(0, 4));
  assert.equal(signature, identity.signature, 'Actual running status signature');
  const view = new DataView(data.buffer);
  const status = {signature, ...Object.fromEntries(STATUS_FIELDS.map((name, index) => [name, view.getUint32(4 + index * 4, true)]))};
  assert.equal(status.version, 2); assert.equal(status.capabilities, 1);
  assert.equal(status.maximum, identity.maximum); assert.equal(status.build_marker, identity.marker);
  return status;
}

function healthySnapshot(session, identity) {
  const {display, ...snapshot} = session.snapshot();
  assert.equal(snapshot.marker, identity.marker);
  assert.equal(snapshot.firmwareState, 2); assert.equal(snapshot.firmwareHash, identity.sha256);
  assert.equal(snapshot.cpuBackendFailed, false); assert.equal(snapshot.mailboxCached, false);
  assert.equal(snapshot.fault, undefined); assert.deepEqual(snapshot.unknownMmio, []);
  assert.equal(snapshot.unknownMmioOverflow, 0); assert.equal(snapshot.flash.lastError, undefined);
  return snapshot;
}

export function startFlashObservation(session, running, candidate) {
  const flash = session.board.flash;
  const paddedLength = Math.ceil(candidate.bytes.length / 4096) * 4096;
  const end = APP1_OFFSET + paddedLength;
  const sectorOrder = [...Array.from({length: paddedLength / 4096 - 1}, (_, index) => APP1_OFFSET + (index + 1) * 4096), APP1_OFFSET];
  const pageOrder = sectorOrder.flatMap(address => Array.from({length: 16}, (_, index) => address + index * 256));
  const readOrder = running.name === 'R13'
    ? Array.from({length: paddedLength / 256}, (_, index) => APP1_OFFSET + index * 256) : pageOrder;
  const before = {nor: flash.flash.slice(), commands: flash.commandLog.length, erases: flash.erases.length, pages: flash.pages.length};
  let checks = 0;
  return {
    observe() {
      checks++;
      const erases = flash.erases.slice(before.erases), pages = flash.pages.slice(before.pages);
      assert.deepEqual(erases, sectorOrder.slice(0, erases.length), 'Executed erase order stays within the occupied target sectors');
      assert.deepEqual(pages, pageOrder.slice(0, pages.length), 'Executed page order stays within the occupied target sectors');
      const commands = flash.commandLog.slice(before.commands);
      assert.ok(commands.every(command => !command.error), 'Actual NOR/IP operations succeed');
      assert.ok(commands.filter(command => command.opcode === 2 || command.opcode === 0x20)
        .every(command => command.address >= APP1_OFFSET && command.address + (command.opcode === 2 ? command.length : 4096) <= end),
      'Every mutation command is inside the target extent');
      const reads = commands.filter(command => command.opcode === 3 && command.address >= APP1_OFFSET && command.address < end);
      assert.ok(reads.every(command => command.length === 256));
      assert.deepEqual(reads.map(command => command.address), readOrder.slice(0, reads.length), 'Actual padded IP-read order matches the running writer');
      if (!erases.includes(APP1_OFFSET)) assert.deepEqual(flash.flash.subarray(APP1_OFFSET, APP1_OFFSET + 4096),
        before.nor.subarray(APP1_OFFSET, APP1_OFFSET + 4096), 'Entry sector remains unchanged until the last sector job');
    },
    finish() {
      this.observe();
      const commands = flash.commandLog.slice(before.commands), erases = flash.erases.slice(before.erases), pages = flash.pages.slice(before.pages);
      const reads = commands.filter(command => command.opcode === 3 && command.address >= APP1_OFFSET && command.address < end);
      assert.deepEqual(erases, sectorOrder); assert.deepEqual(pages, pageOrder);
      assert.deepEqual(reads.map(command => command.address), readOrder);
      assert.deepEqual(flash.flash.subarray(APP1_OFFSET, APP1_OFFSET + candidate.bytes.length), candidate.bytes);
      assert.ok(flash.flash.subarray(APP1_OFFSET + candidate.bytes.length, end).every(byte => byte === 255));
      assert.deepEqual(flash.flash.subarray(0, APP1_OFFSET), before.nor.subarray(0, APP1_OFFSET));
      assert.deepEqual(flash.flash.subarray(end), before.nor.subarray(end));
      assert.notEqual(hash(flash.flash.subarray(APP1_OFFSET, end)), hash(before.nor.subarray(APP1_OFFSET, end)));
      return {passiveChecks: checks, actualIpReadbackBytes: reads.reduce((sum, command) => sum + command.length, 0),
        paddedLength, perSector: sectorOrder.map(address => ({address: hex(address),
          erased: true, pages: pages.filter(page => page >= address && page < address + 4096).length,
          ipReads: reads.filter(command => command.address >= address && command.address < address + 4096).length,
          storedSha256: hash(flash.flash.subarray(address, address + 4096))})),
        eraseOrder: erases.map(hex), pageOrderSha256: hash(JSON.stringify(pages)), ipReadOrderSha256: hash(JSON.stringify(reads)),
        commandCount: commands.length, commandSha256: hash(JSON.stringify(commands)),
        commandCounts: commands.reduce((counts, command) => {counts[hex(command.opcode)] = (counts[hex(command.opcode)] ?? 0) + 1; return counts;}, {}),
        exactCandidateSha256: hash(flash.flash.subarray(APP1_OFFSET, APP1_OFFSET + candidate.bytes.length)),
        preservedResidentSha256: hash(flash.flash.subarray(0, APP1_OFFSET)), preservedTailSha256: hash(flash.flash.subarray(end)),
        norSha256: hash(flash.flash), residentPreserved: true, outsideTargetPreserved: true, paddedTail: 'FF'};
    },
  };
}

async function prepare(recipientName, report) {
  report.sourceSha256 = await sourcePins();
  const [recipient, r13] = await Promise.all([pinFirmware(recipientName), pinFirmware('R13')]);
  report.firmware = {initial: recipient.evidence, intermediate: r13.evidence, final: recipient.evidence};
  report.admission = [];
  for (const [running, candidate] of [[recipient, r13], [r13, recipient]]) {
    const plan = await prepareVirtualUpdateCandidate(candidate.bytes, {expectedMarker: candidate.identity.marker,
      expectedSha256: candidate.identity.sha256, expectedRunningMarker: running.identity.marker,
      expectedRunningSha256: running.identity.sha256}, running.identity.name);
    assert.equal(plan.target, 'writer'); assert.deepEqual(plan.blockers, []);
    assert.ok(plan.image.length <= 65536); assert.equal(plan.image.crc32, candidate.identity.crc32);
    report.admission.push({from: running.identity.name, to: candidate.identity.name, image: plan.image,
      work: plan.work, target: plan.target, blockers: plan.blockers, resetTarget: {...plan.resetTarget, expectedCurrentSha256: running.identity.sha256}});
  }
  const measuredFile = path.join(firmwareProject, 'analysis/hardware/usb_r11_20260922T190757Z/preflight.json');
  const measuredBytes = await fs.readFile(measuredFile);
  report.measuredProfile = {file: relative(measuredFile), sha256: hash(measuredBytes)};
  const measured = JSON.parse(JSON.parse(measuredBytes.toString('utf8')).steps.find(step => step.action === 'diagnostics').stdout);
  return {recipient, r13, measured};
}

async function execute(prepared, report, runtimeDirectory) {
  report.runtime = await runtimeEvidence(runtimeDirectory);
  assert.equal(report.runtime.hasKnownR14Frontier, false, 'This ordinary acceptance uses a qualified repaired runtime');
  const {recipient, r13, measured} = prepared;
  const session = await createSession(recipient.bytes, runtimeSessionOptions(runtimeDirectory));
  report.scope.cpuEngineExecuted = true;
  let completedStarts = 0, current = recipient, pending, observation;
  const starts = () => completedStarts + session.cpu.totalInstructions;
  report.directions = []; report.resets = [];
  report.usbReports = {normalGets: 0, commands: {}, signatures: {}};
  try {
    report.phase = `initial ${recipient.identity.name} boot`;
    report.scope.guestFirmwareExecuted = true;
    report.initialBoot = boot(session, 5, recipient.identity.marker);
    healthySnapshot(session, recipient.identity);
    const initialNorSha256 = hash(session.board.flash.flash);
    const updater = new VirtualFirmwareUpdater({
      transport: async request => {
        const bytes = session.usbReport(request);
        if (request) report.usbReports.commands[request[0]] = (report.usbReports.commands[request[0]] ?? 0) + 1;
        else report.usbReports.normalGets++;
        const signature = String.fromCharCode(...bytes.subarray(0, 4));
        report.usbReports.signatures[signature] = (report.usbReports.signatures[signature] ?? 0) + 1;
        if (signature === current.identity.signature) {
          const status = decodeProfileStatus(bytes, current.identity);
          report.lastNormalStatus = status;
          if (status.state === 2 && request?.[0] === 3) {
            assert.ok(pending);
            assert.deepEqual(session.cpu.readMemory(0x83000000, pending.bytes.length), pending.bytes, 'Passive staged-RAM observation agrees with guest CRC');
            report.pendingDirection.stagedRamSha256 = pending.identity.sha256;
          }
        }
        observation?.observe();
        return Array.from(bytes);
      },
      snapshot: async () => healthySnapshot(session, current.identity),
      reset: async supplied => {
        assert.ok(pending && observation, 'Reset belongs to an inspected small target transaction');
        const target = validateApp1ResetContract(supplied);
        assert.deepEqual(target, {length: pending.bytes.length, sha256: pending.identity.sha256, expectedCurrentSha256: current.identity.sha256});
        report.pendingDirection.executed = observation.finish();
        report.pendingDirection.beforeResetSnapshot = healthySnapshot(session, current.identity);
        observation = undefined;
        const before = {target, runningSha256: session.image.sha256, codeHookStarts: session.cpu.totalInstructions,
          norSha256: hash(session.board.flash.flash)};
        completedStarts += before.codeHookStarts;
        await session.reset(target);
        assert.equal(hash(session.board.flash.flash), before.norSha256);
        assert.equal(session.cpu.totalInstructions, 0);
        assert.ok(session.cpu.readMemory(0x2023f000, 80).every(byte => byte === 0), 'Fresh reset leaves an empty actual mailbox before guest execution');
        assert.equal(session.board.status().frameCount, 0);
        assert.equal(session.image.sha256, pending.identity.sha256); assert.deepEqual(session.image.bytes, pending.bytes);
        const startup = boot(session, 5, pending.identity.marker);
        current = pending;
        healthySnapshot(session, current.identity);
        report.resets.push({before, after: {runningSha256: session.image.sha256, extent: session.image.bytes.length,
          norSha256: hash(session.board.flash.flash), emptyMailboxAtZeroStarts: true, startup}});
      },
    });
    for (const [running, candidate] of [[recipient, r13], [r13, recipient]]) {
      report.phase = `${running.identity.name} to ${candidate.identity.name}`;
      pending = candidate;
      observation = startFlashObservation(session, running.identity, candidate);
      const begin = starts();
      const progress = {events: 0, phaseCounts: {}, last: undefined};
      report.pendingDirection = {from: running.identity.name, to: candidate.identity.name, progress};
      const result = await updater.update(candidate.bytes, {expectedMarker: candidate.identity.marker,
        expectedSha256: candidate.identity.sha256, expectedRunningMarker: running.identity.marker,
        expectedRunningSha256: running.identity.sha256,
        onProgress: event => {progress.events++; progress.phaseCounts[event.phase] = (progress.phaseCounts[event.phase] ?? 0) + 1; progress.last = event;}});
      for (const [field, value] of Object.entries(result.preflight.diagnostics))
        assert.equal(value, measured[field === 'headerHex' ? 'header_hex' : field === 'bfptHex' ? 'bfpt_hex' : field]);
      assert.equal(result.image.sha256, candidate.identity.sha256); assert.equal(result.image.crc32, candidate.identity.crc32);
      assert.equal(result.ramVerified.state, 2); assert.equal(result.flashVerified.state, 6); assert.equal(result.separateStatus.state, 6);
      assert.equal(result.flashVerified.flash_error, 0); assert.equal(result.separateStatus.flash_crc32, candidate.identity.crc32);
      assert.equal(result.flashReadback.verifiedBytes, Math.ceil(candidate.bytes.length / 4096) * 4096);
      assert.equal(result.bootStatus.state, 0); assert.equal(result.bootStatus.build_marker, candidate.identity.marker);
      assert.equal(result.bootStatus.flash_ready, 0); assert.equal(result.bootStatus.jedec, 0);
      assert.equal(result.snapshot.firmwareHash, candidate.identity.sha256);
      assert.equal(progress.phaseCounts.upload, Math.ceil(candidate.bytes.length / 56));
      assert.equal(result.phases.at(-1).phase, 'boot-verified');
      const {phases, ...receipt} = result;
      report.directions.push({...report.pendingDirection, updater: {...receipt,
        phases: {count: phases.length, sha256: hash(JSON.stringify(phases))}}, codeHookStarts: starts() - begin});
      delete report.pendingDirection;
      console.log(`${running.identity.name} -> ${candidate.identity.name}: bounded small-image IP readback, separate status and fresh boot passed.`);
    }
    assert.equal(report.resets.length, 2); assert.equal(session.image.sha256, recipient.identity.sha256);
    const finalNorSha256 = hash(session.board.flash.flash);
    assert.equal(finalNorSha256, initialNorSha256, 'Returning the initial larger small image restores the initial virtual NOR bytes');
    report.roundtrip = {declaredApp1Restored: true, wholeVirtualNorRestored: true, sha256: recipient.identity.sha256,
      marker: hex(recipient.identity.marker), initialNorSha256, finalNorSha256};
    report.totalCodeHookStarts = starts(); report.phase = 'complete'; report.passed = true;
  } catch (error) {
    const {display, ...snapshot} = session.snapshot(); report.failureSnapshot = snapshot;
    report.failureFlash = {commands: session.board.flash.commandLog.slice(-32),
      erases: [...session.board.flash.erases], pages: [...session.board.flash.pages]};
    report.totalCodeHookStarts = starts(); throw error;
  } finally {session.close();}
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv), started = performance.now();
  try {await fs.access(args.destination); throw new Error('The --report destination already exists; select a fresh filename.');}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  const report = {schema: 'opensp-larger-writer-small-roundtrip-v1', timestampUtc: new Date().toISOString(),
    recipient: args.recipient, mode: args.execute ? 'ordinary-small-image-guest-roundtrip' : 'static-preparation', passed: false,
    phase: 'static preparation', scope: {cpuEngineExecuted: false, guestFirmwareExecuted: false,
      physicalDeviceAccess: false, browserExecuted: false, firmwareBytesPublished: false, fullStockOrB1Transfer: false, selectorApplied: false},
    modeledClock: {gptHz: 24000000, counterReadIncrement: 24000, cpuCyclesMeasured: false},
    modeledHost: {guestIdleHookStartsAfterEachControl: 25000, physicalElapsedTimeMeasured: false},
    limits: ['Exact preserved normal R16B/R48 and R13 ABI1 images only; larger stock/B1 plans remain blocked.',
      'Startup begins at the captured resident APP1 handoff; ROM/cold resident boot and physical recovery remain unqualified.',
      'Per-token control pumping and boot use bounded code-hook observations, without a general hardware retirement or timing claim.',
      'Passive NOR command observations prove only the occupied small target sectors; no large-transfer execution claim follows.',
      'This runner applies no selector, fault injection, diagnostic clone, stop-PC override or runtime cache-flush override.']};
  try {
    const prepared = await prepare(args.recipient, report);
    if (args.execute) {
      await execute(prepared, report, args.runtimeDirectory);
    } else {report.phase = 'static preparation complete'; report.prepared = true;}
    report.finalSourceSha256 = await sourcePins();
    report.sourcesStable = JSON.stringify(report.finalSourceSha256) === JSON.stringify(report.sourceSha256);
    assert.equal(report.sourcesStable, true, 'Every model/helper/runner source remains stable');
    if (report.runtime) {
      report.finalRuntime = await runtimeEvidence(args.runtimeDirectory);
      report.runtimeStable = JSON.stringify(report.finalRuntime) === JSON.stringify(report.runtime);
      assert.equal(report.runtimeStable, true, 'Runtime assets remain stable');
    }
    report.hostElapsedMs = Math.round(performance.now() - started);
    await fs.mkdir(path.dirname(args.destination), {recursive: true});
    await fs.writeFile(args.destination, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify({prepared: true, passed: report.passed, mode: report.mode, report: relative(args.destination)}));
    return report;
  } catch (error) {
    report.passed = false;
    report.hostElapsedMs = Math.round(performance.now() - started);
    report.error = {name: error.name, message: error.message, phase: error.phase, code: error.code, evidence: error.evidence};
    try {
      report.finalSourceSha256 = await sourcePins();
      report.sourcesStable = JSON.stringify(report.finalSourceSha256) === JSON.stringify(report.sourceSha256);
    } catch (pinError) {report.sourcesStable = false; report.sourcePinError = {name: pinError.name, message: pinError.message};}
    if (report.runtime) {
      try {
        report.finalRuntime = await runtimeEvidence(args.runtimeDirectory);
        report.runtimeStable = JSON.stringify(report.finalRuntime) === JSON.stringify(report.runtime);
      } catch (pinError) {report.runtimeStable = false; report.runtimePinError = {name: pinError.name, message: pinError.message};}
    }
    const failed = path.join(path.dirname(args.destination), `failed-${args.recipient.toLowerCase()}-small-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}.json`);
    await fs.mkdir(path.dirname(failed), {recursive: true});
    await fs.writeFile(failed, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
    console.error(JSON.stringify({passed: false, phase: report.phase, error: report.error, preserved: relative(failed)}));
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
