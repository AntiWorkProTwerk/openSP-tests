import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createSession} from '../src/lib/emulator/session.ts';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firmwareProject = path.resolve(project, '../sp404mk2');
const defaultRuntime = path.join(project, 'public/emulator/vendor');
const defaultReport = path.join(project, 'tools/emulator-evidence/stock-whole-image-qualification.json');
const stockName = 'firmware/v552/extracted/sp404mk2_sys_v552/SP404MKII_APP1.bin';
const mapName = 'analysis/v552/memory_map.json';
const stockSha256 = '4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80';
const originalUnrepairedWasm = 'f9520f9aa55299b84d005390844082a1468f26137e239eb1167dde8473aecc6c';
const scatterCheckpoint = 0x60080622;
const scatterLimit = 25000000;
const postScatterMaximum = 25000000;
const normalSlice = 250000;
const historyManifest = 'tools/emulator-evidence/stock-pre-ordinary-qualification-2026-10-03T035034-963Z/manifest.json';
const sourceFiles = ['tools/test-emulator-stock.mjs', 'src/lib/emulator/board.ts',
  'src/lib/emulator/oscillator.ts',
  'src/lib/emulator/cpu.ts', 'src/lib/emulator/session.ts', 'src/lib/emulator/exceptions.ts',
  'src/lib/emulator/exception-return.ts', 'src/lib/emulator/image.ts',
  'src/lib/emulator/usb.ts', 'src/lib/emulator/flash.ts',
  `../sp404mk2/${mapName}`, `../sp404mk2/${stockName}`];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
const relative = name => path.relative(project, name).replaceAll('\\', '/');

export function parseArguments(argv, environment = process.env) {
  const forbiddenEnvironment = Object.keys(environment).filter(name => name.startsWith('OPENSP_STOCK_'));
  assert.equal(forbiddenEnvironment.length, 0,
    `Legacy stock diagnostic environment controls are unsupported: ${forbiddenEnvironment.join(', ')}`);
  const options = {report: defaultReport, postScatterInstructions: 1000000, help: false};
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    assert.ok(['--runtime-dir', '--report', '--post-scatter-instructions', '--help'].includes(flag),
      `Unsupported stock qualification argument: ${flag}`);
    assert.ok(!seen.has(flag), `Duplicate stock qualification argument: ${flag}`);
    seen.add(flag);
    if (flag === '--help') {options.help = true; continue;}
    const value = argv[++index];
    assert.ok(value && !value.startsWith('--'), `Missing value for ${flag}`);
    if (flag === '--runtime-dir') options.runtimeDirectory = path.resolve(value);
    else if (flag === '--report') options.report = path.resolve(value);
    else {
      assert.match(value, /^\d+$/, 'Post-scatter instruction limit must be an integer');
      const count = Number(value);
      assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= postScatterMaximum,
        `Post-scatter instruction limit must contain 1..${postScatterMaximum} instructions`);
      options.postScatterInstructions = count;
    }
  }
  if (!options.help) {
    assert.ok(!options.runtimeDirectory || seen.has('--report'),
      'Candidate qualification requires an explicit separate --report destination');
    assert.equal(path.extname(options.report).toLowerCase(), '.json', 'Report destination must end in .json');
    if (options.runtimeDirectory) assert.notEqual(options.report, defaultReport,
      'Candidate results must preserve the default stock qualification report');
    const historicalNames = ['stock-terminal-current.json', 'stock-startup.json',
      'stock-startup-first-trace-failure.json', 'stock-flush-after-scatter.json', 'stock-clone-before-trap.json'];
    assert.ok(!historicalNames.some(name => options.report === path.join(project, 'tools/emulator-evidence', name)),
      'Historical stock diagnostic reports are retained under their original names');
  }
  return options;
}

export async function inspectRuntime(runtimeDirectory) {
  const directory = runtimeDirectory ?? defaultRuntime;
  assert.ok((await fs.stat(directory)).isDirectory(), 'Runtime argument must identify a local asset directory');
  const provenanceBytes = await fs.readFile(path.join(directory, 'provenance.json'));
  const provenance = JSON.parse(provenanceBytes.toString('utf8'));
  assert.equal(provenance.architecture, 'arm', 'Runtime provenance must identify the ARM architecture');
  assert.match(provenance.wrapperCommit, /^[0-9a-f]{40}$/, 'Wrapper source revision is pinned');
  assert.match(provenance.coreCommit, /^[0-9a-f]{40}$/, 'Core source revision is pinned');
  assert.ok(provenance.files?.['unicorn-arm.js'] && provenance.files?.['unicorn-arm.wasm'],
    'Runtime provenance must pin both the factory and its WASM');
  const files = {};
  for (const [name, pin] of Object.entries(provenance.files)) {
    assert.ok(name && path.basename(name) === name && !name.includes('/') && !name.includes('\\'),
      'Runtime provenance asset names must remain inside the asset directory');
    assert.ok(Number.isSafeInteger(pin.bytes) && pin.bytes > 0, `${name} byte length is pinned`);
    assert.match(pin.sha256, /^[0-9a-f]{64}$/, `${name} SHA256 is pinned`);
    const bytes = await fs.readFile(path.join(directory, name));
    assert.equal(bytes.length, pin.bytes, `${name} length matches provenance`);
    assert.equal(hash(bytes), pin.sha256, `${name} SHA256 matches provenance`);
    files[name] = {bytes: bytes.length, sha256: hash(bytes)};
  }
  return {assetDirectory: relative(directory), explicitCandidateDirectory: !!runtimeDirectory,
    wrapperCommit: provenance.wrapperCommit, coreCommit: provenance.coreCommit,
    provenanceSha256: hash(provenanceBytes), files,
    originalUnrepairedArtifact: files['unicorn-arm.wasm'].sha256 === originalUnrepairedWasm,
    declaredCandidateRepair: provenance.candidateRepair,
    declaredCandidateComposition: provenance.candidateComposition};
}

export function stockSessionOptions(runtimeDirectory) {
  return {format: 'app1', name: 'SP404MKII_APP1.bin', ...(runtimeDirectory ? {cpuOptions: {
    vendorUrl: pathToFileURL(path.join(runtimeDirectory, 'unicorn-arm.js')).href,
  }} : {})};
}

async function sourcePins() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async name =>
    [name, hash(await fs.readFile(path.join(project, name)))])));
}

async function archiveExistingReport(destination) {
  let bytes;
  try {bytes = await fs.readFile(destination);}
  catch (error) {if (error.code === 'ENOENT') return undefined; throw error;}
  const previous = JSON.parse(bytes.toString('utf8'));
  const stamp = (previous.timestampUtc ?? new Date().toISOString()).replaceAll(':', '').replaceAll('.', '-');
  const archive = path.join(path.dirname(destination),
    `${path.basename(destination, '.json')}-history-${stamp}-${hash(bytes).slice(0, 12)}.json`);
  try {await fs.writeFile(archive, bytes, {flag: 'wx'});}
  catch (error) {if (error.code !== 'EEXIST') throw error;}
  assert.equal(hash(await fs.readFile(archive)), hash(bytes), 'Prior report snapshot preserves every byte');
  return {report: relative(archive), bytes: bytes.length, sha256: hash(bytes), passed: previous.passed};
}

function snapshot(session) {
  const result = session.snapshot();
  const display = Uint8Array.from(result.display);
  delete result.display;
  const architecture = session.cpu.backendFailed ? {available: false} : {
    available: true, xpsr: hex(session.cpu.readRegister('xpsr')),
    ...(session.cpu.memoryMap.some(region => (region.permissions & 4) && result.pc >= region.address &&
      result.pc + 4 <= region.address + region.bytes) ? {
        currentInstructionHex: Array.from(session.cpu.readMemory(result.pc, 4), byte => byte.toString(16).padStart(2, '0')).join(''),
      } : {instructionBytesAvailable: false}),
  };
  return {...result, pc: hex(result.pc), architecture, oscillator: session.board.oscillator.status(),
    display: {bytes: display.length, sha256: hash(display)},
    stockBootCompletionOracle: false};
}

function memoryHash(session, address, size) {
  const digest = createHash('sha256');
  for (let offset = 0; offset < size; offset += 0x100000)
    digest.update(session.cpu.readMemory(address + offset, Math.min(0x100000, size - offset)));
  return digest.digest('hex');
}

function zeroHash(size) {
  const digest = createHash('sha256');
  const zeros = new Uint8Array(0x100000);
  for (let offset = 0; offset < size; offset += zeros.length)
    digest.update(zeros.subarray(0, Math.min(zeros.length, size - offset)));
  return digest.digest('hex');
}

function executionOutcome(result, observed) {
  if (observed.cpuBackendFailed || result?.backendLost) return 'backend-unavailable';
  if (result?.reason === 'fault' || observed.state === 'fault') return 'guest-or-model-fault';
  if (!observed.powered) return 'modeled-power-off';
  if (result?.reason === 'stopped') return 'execution-stopped';
  if (!result?.instructions) return 'no-instruction-progress';
  return result.reason;
}

async function runWholeImage(options, report) {
  report.phase = 'artifact admission';
  report.sourceSha256 = await sourcePins();
  report.runtime = await inspectRuntime(options.runtimeDirectory);
  assert.equal(report.runtime.originalUnrepairedArtifact, false,
    'The original unrepaired WASM has a retained stock failure; ordinary qualification requires a changed runtime artifact');
  const bytes = new Uint8Array(await fs.readFile(path.join(firmwareProject, stockName)));
  assert.equal(hash(bytes), stockSha256, 'The complete pristine stock v5.52 APP1 is used');
  const map = JSON.parse(await fs.readFile(path.join(firmwareProject, mapName), 'utf8'));
  assert.equal(map.version, '552');
  assert.equal(map.flash_base, 0x60080000);
  assert.equal(map.regions.length, 12, 'Stock scatter reference contains all twelve regions');
  for (const region of map.regions) {
    assert.ok(Number.isSafeInteger(region.destination) && region.destination >= 0 &&
      Number.isSafeInteger(region.size) && region.size > 0 && region.destination + region.size <= 0x100000000);
    assert.ok(['copy', 'decompress', 'zero'].includes(region.mode), 'Known stock scatter operation');
    if (region.mode !== 'zero') assert.match(region.sha256, /^[0-9a-f]{64}$/);
  }
  report.image = {source: `../sp404mk2/${stockName}`, bytes: bytes.length, sha256: hash(bytes),
    format: 'app1', suppliedHandoff: true, reconstructedRuntimeSubstitution: false};
  report.phase = 'session initialization';
  const session = await createSession(bytes, stockSessionOptions(options.runtimeDirectory));
  let unsubscribe;
  try {
    report.initialSnapshot = snapshot(session);
    report.initialMemory = {mode: 'Ordinary session RAM; no host poison, runtime replacement or instruction patch',
      zeroRegions: map.regions.filter(region => region.mode === 'zero').map(region => ({
        index: region.index, address: hex(region.destination), bytes: region.size,
        beforeSha256: memoryHash(session, region.destination, region.size),
      }))};
    report.phase = 'stock scatter startup';
    let reached = false;
    unsubscribe = session.cpu.onInstruction((address, _size, cpu) => {
      if (address === scatterCheckpoint) {reached = true; cpu.stop();}
    });
    let last;
    while (!reached && session.cpu.totalInstructions < scatterLimit) {
      last = session.step(Math.min(1000000, scatterLimit - session.cpu.totalInstructions));
      report.lastStep = {...last, pc: hex(last.pc)};
      if (last.reason !== 'budget' || last.instructions === 0) break;
    }
    unsubscribe(); unsubscribe = undefined;
    report.scatter = {passed: false, checkpoint: hex(scatterCheckpoint), checkpointReached: reached,
      instructionLimit: scatterLimit, instructions: session.cpu.totalInstructions,
      snapshot: snapshot(session), lastStep: report.lastStep, regionChecks: []};
    assert.equal(reached, true, `Real stock scatter loader reaches ${hex(scatterCheckpoint)} within its bound`);
    for (const region of map.regions) {
      const actualSha256 = memoryHash(session, region.destination, region.size);
      const expectedSha256 = region.mode === 'zero' ? zeroHash(region.size) : region.sha256;
      report.scatter.regionChecks.push({index: region.index, mode: region.mode,
        address: hex(region.destination), bytes: region.size, actualSha256, expectedSha256,
        matches: actualSha256 === expectedSha256});
      assert.equal(actualSha256, expectedSha256, `Region${region.index} actual stock scatter ${region.mode}`);
    }
    report.scatter.passed = true;
    console.log(`PASS: whole stock image executes its own scatter startup; all twelve region hashes match (${session.cpu.totalInstructions} instructions).`);
    report.phase = 'bounded stock C runtime';
    const begin = session.cpu.totalInstructions;
    while (session.cpu.totalInstructions - begin < options.postScatterInstructions) {
      last = session.step(Math.min(normalSlice, options.postScatterInstructions - (session.cpu.totalInstructions - begin)));
      report.lastStep = {...last, pc: hex(last.pc)};
      if (last.reason !== 'budget' || last.instructions === 0) break;
    }
    const observed = snapshot(session);
    const count = session.cpu.totalInstructions - begin;
    report.boundedExecution = {passed: count === options.postScatterInstructions && last.reason === 'budget' &&
      !observed.cpuBackendFailed && observed.powered,
      requestedInstructions: options.postScatterInstructions, instructions: count,
      fixedSliceInstructions: normalSlice, outcome: executionOutcome(last, observed),
      lastStep: report.lastStep, snapshot: observed};
    report.frontier = {phase: report.phase, pc: observed.pc, outcome: report.boundedExecution.outcome,
      state: observed.state, fault: observed.fault, cpuBackendFailed: observed.cpuBackendFailed,
      unknownMmio: observed.unknownMmio, unknownMmioOverflow: observed.unknownMmioOverflow,
      displayFrames: observed.frames, pendingInterrupts: observed.pendingInterrupts,
      completeStockBootVerified: false};
    assert.equal(report.boundedExecution.passed, true,
      'Ordinary stock C runtime must complete the requested instruction budget without a fault or premature stop');
    report.phase = 'bounded checkpoints complete';
    report.passed = true;
  } catch (error) {
    report.failureSnapshot = snapshot(session);
    report.frontier = {phase: report.phase, pc: report.failureSnapshot.pc,
      outcome: executionOutcome(report.lastStep, report.failureSnapshot),
      state: report.failureSnapshot.state, fault: report.failureSnapshot.fault,
      cpuBackendFailed: report.failureSnapshot.cpuBackendFailed,
      unknownMmio: report.failureSnapshot.unknownMmio,
      unknownMmioOverflow: report.failureSnapshot.unknownMmioOverflow,
      displayFrames: report.failureSnapshot.frames, completeStockBootVerified: false};
    throw error;
  } finally {
    unsubscribe?.();
    report.finalSnapshot = snapshot(session);
    const backendFailed = session.cpu.backendFailed;
    session.close();
    report.cleanup = backendFailed ? 'Closed through the terminal backend guard; no further Unicorn calls'
      : 'Session closed after its final passive snapshot';
  }
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const options = parseArguments(argv, environment);
  if (options.help) {
    console.log('Usage: node tools/test-emulator-stock.mjs [--runtime-dir LOCAL_ASSET_DIRECTORY --report REPORT.json] [--post-scatter-instructions 1..25000000]\nRuns the complete pristine v5.52 APP1, verifies real scatter startup, then executes a bounded ordinary C-runtime interval. Complete stock boot remains a separate unverified milestone.');
    return;
  }
  const begin = performance.now();
  const report = {schema: 'opensp-stock-whole-image-qualification-v2', timestampUtc: new Date().toISOString(),
    instructionCountUnit: 'Reported code-hook starts; conditional blocks can retire uncounted instructions, as retained in thumb-it-qualification-20261003c',
    passed: false, phase: 'preparation',
    scope: 'Complete unmodified stock APP1 on an isolated ARM WASM session and deterministic virtual peripherals',
    configuration: {scatterCheckpoint: hex(scatterCheckpoint), scatterInstructionLimit: scatterLimit,
      postScatterInstructionLimit: options.postScatterInstructions, ordinarySliceInstructions: normalSlice},
    completeBoot: {verified: false, reason: 'No complete stock boot/UI/audio/storage acceptance oracle is exercised'},
    preservedHistory: {manifest: historyManifest,
      manifestSha256: hash(await fs.readFile(path.join(project, historyManifest)))},
    limitations: [
      'The captured APP1 handoff is supplied; cold ROM/resident boot is outside this qualification.',
      'Ordinary RAM starts with the session defaults. Matching zero regions verifies contents but does not independently prove writes to previously nonzero memory.',
      'Unknown MMIO and its bounded overflow counter remain in the report; mapped backing memory can permit execution past an unsupported peripheral.',
      'GPT advances by the session regression fixture; instructions and timer ticks are modeled work, not measured hardware timing.',
      'Stock boot completion, RTOS scheduling, sampler/audio/storage operation and physical behavior require their own evidence.',
    ]};
  try {await runWholeImage(options, report);}
  catch (error) {report.passed = false; report.error = {name: error.name, message: error.message};}
  if (report.sourceSha256) {
    try {
      report.finalSourceSha256 = await sourcePins();
      report.sourcesStable = JSON.stringify(report.finalSourceSha256) === JSON.stringify(report.sourceSha256);
      report.finalRuntime = await inspectRuntime(options.runtimeDirectory);
      report.runtimeStable = JSON.stringify(report.finalRuntime) === JSON.stringify(report.runtime);
      if (!report.sourcesStable || !report.runtimeStable) {
        report.passed = false;
        report.stabilityError = 'Emulator sources or runtime assets changed during qualification';
      }
    } catch (error) {report.passed = false; report.stabilityError = {name: error.name, message: error.message};}
  }
  report.hostElapsedMs = Math.round(performance.now() - begin);
  await fs.mkdir(path.dirname(options.report), {recursive: true});
  const replacedReport = await archiveExistingReport(options.report);
  if (replacedReport) report.replacedReport = replacedReport;
  await fs.writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({passed: report.passed, report: relative(options.report), phase: report.phase,
    scatterPassed: report.scatter?.passed ?? false,
    boundedExecutionPassed: report.boundedExecution?.passed ?? false,
    completeStockBootVerified: false, frontier: report.frontier, error: report.error,
    sourcesStable: report.sourcesStable, runtimeStable: report.runtimeStable,
    hostElapsedMs: report.hostElapsedMs}, null, 2));
  if (!report.passed) process.exitCode = 1;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
