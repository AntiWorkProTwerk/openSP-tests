import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/lib/emulator/session.ts';
import { createCPU } from '../src/lib/emulator/cpu.ts';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(project, '../sp404mk2');
const reportName = process.env.OPENSP_STOCK_REPORT ?? 'stock-startup.json';
assert.equal(path.basename(reportName), reportName, 'Diagnostic report must be a local filename');
const reportPath = path.join(project, 'tools/emulator-evidence', reportName);
const stockPath = path.join(source, 'firmware/v552/extracted/sp404mk2_sys_v552/SP404MKII_APP1.bin');
const map = JSON.parse(await fs.readFile(path.join(source, 'analysis/v552/memory_map.json'), 'utf8'));
const bytes = new Uint8Array(await fs.readFile(stockPath));
const sha = value => createHash('sha256').update(value).digest('hex');
const hex = value => `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
assert.equal(sha(bytes), '4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80');
const session = await createSession(bytes, { format: 'app1', name: 'SP404MKII_APP1.bin' });
const report = {
  schema: 'opensp-stock-startup-v1',
  source: 'firmware/v552/extracted/sp404mk2_sys_v552/SP404MKII_APP1.bin',
  imageSha256: sha(bytes),
  checkpoint: 'Raw stock APP1 executes its own scatter loader, then enters its real C runtime',
  scope: 'ARM WASM execution with deterministic peripherals; no physical device, ROM or reconstructed runtime substitution',
  regionChecks: [],
  stages: [],
  limitations: [
    'The resident handoff is supplied; this is not a cold ROM/resident boot.',
    'Unknown MMIO remains a recorded frontier, even when the mapped backing memory permits execution.',
    'Instruction counts and read-driven GPT are functional-model work, not measured hardware timing.',
    'This check does not establish sampler/audio/storage operation or complete stock startup.',
  ],
};
report.emulatorSha256 = Object.fromEntries(await Promise.all([
  'tools/test-emulator-stock.mjs', 'src/lib/emulator/board.ts', 'src/lib/emulator/cpu.ts',
  'src/lib/emulator/session.ts', 'src/lib/emulator/exceptions.ts', 'src/lib/emulator/image.ts',
  'src/lib/emulator/usb.ts', 'src/lib/emulator/flash.ts',
  'public/emulator/vendor/unicorn-arm.js', 'public/emulator/vendor/unicorn-arm.wasm',
].map(async name => [name, sha(await fs.readFile(path.join(project, name)))])));
report.poisonPattern = 'A5 throughout each declared zero destination, checked before execution';

const chunkBytes = 0x100000;
const a5 = new Uint8Array(chunkBytes).fill(0xa5);
const zeros = new Uint8Array(chunkBytes);
function memoryHash(address, size) {
  const digest = createHash('sha256');
  for (let offset = 0; offset < size; offset += chunkBytes)
    digest.update(session.cpu.readMemory(address + offset, Math.min(chunkBytes, size - offset)));
  return digest.digest('hex');
}
function patternHash(pattern, size) {
  const digest = createHash('sha256');
  for (let offset = 0; offset < size; offset += chunkBytes)
    digest.update(pattern.subarray(0, Math.min(chunkBytes, size - offset)));
  return digest.digest('hex');
}
for (const region of map.regions.filter(region => region.mode === 'zero')) {
  for (let offset = 0; offset < region.size; offset += chunkBytes)
    session.cpu.writeMemory(region.destination + offset, a5.subarray(0, Math.min(chunkBytes, region.size - offset)));
  const beforeSha256 = memoryHash(region.destination, region.size);
  assert.equal(beforeSha256, patternHash(a5, region.size), `Region${region.index} starts with host A5 poison`);
  report.regionChecks.push({ index: region.index, mode: 'zero', address: hex(region.destination),
    bytes: region.size, beforeSha256, expectedAfterSha256: patternHash(zeros, region.size) });
}

let phase = 'scatter';
let checkpointReached = false;
let trace = [];
const entered = [];
const codeAtScatterCheckpoint = [];
let lastPc;
session.cpu.onInstruction((address, size, cpu) => {
  if (phase === 'scatter' && address === 0x60080622) { checkpointReached = true; cpu.stop(); return; }
    if (phase !== 'scatter') {
      if (entered.length >= 96 && trace.length >= 96 && process.env.OPENSP_STOCK_STOP_PC === hex(address)) { cpu.stop(); return; }
    lastPc = address;
    const region = codeAtScatterCheckpoint.find(region => address >= region.address && address + size <= region.address + region.bytes.length);
    const code = region ? region.bytes.subarray(address - region.address, address - region.address + size)
      : address >= 0x60080000 && address + size <= 0x60080000 + bytes.length ? bytes.subarray(address - 0x60080000, address - 0x60080000 + size) : undefined;
    const row = { address: hex(address), size, bytes: code ? Buffer.from(code).toString('hex') : undefined,
      byteSource: region ? 'runtime read and hashed at scatter checkpoint' : code ? 'uploaded XIP image' : 'unavailable' };
    if (entered.length < 96) entered.push(row);
    trace.push(row);
    if (trace.length > 96) trace.shift();
  }
});
try {
  while (!checkpointReached && session.cpu.totalInstructions < 25000000) {
    const result = session.step(1000000);
    assert.notEqual(result.reason, 'fault', result.fault);
  }
  assert.equal(checkpointReached, true, 'Real scatter loader reaches 0x60080622');
  for (const region of map.regions) {
    const actualSha256 = memoryHash(region.destination, region.size);
    const expectedSha256 = region.mode === 'zero' ? patternHash(zeros, region.size) : region.sha256;
    assert.equal(actualSha256, expectedSha256, `Region${region.index} actual scatter ${region.mode}`);
    const existing = report.regionChecks.find(row => row.index === region.index);
    if (existing) Object.assign(existing, { afterSha256: actualSha256, matches: true });
    else report.regionChecks.push({ index: region.index, mode: region.mode, address: hex(region.destination),
      bytes: region.size, expectedAfterSha256: expectedSha256, afterSha256: actualSha256, matches: true });
    if (region.mode !== 'zero') codeAtScatterCheckpoint.push({ address: region.destination,
      bytes: session.cpu.readMemory(region.destination, region.size) });
  }
  report.regionChecks.sort((a, b) => a.index - b.index);
  report.stages.push({ name: 'actual scatter completion', instructions: session.cpu.totalInstructions,
    pc: hex(session.cpu.readRegister('pc')), unknownMmio: session.board.status().unknownMmio });
  console.log(`PASS: actual stock scatter, all12 regions, ${session.cpu.totalInstructions} instructions`);
  if (process.env.OPENSP_STOCK_FLUSH_TB === '1') {
    session.cpu.engine.ctl_flush_tb();
    report.diagnostic = 'Explicit host translation-cache flush after verified real scatter; firmware bytes unchanged';
  }
  phase = 'c-runtime';
  const mmio = [];
  const originalRead = session.board.read.bind(session.board);
  const originalWrite = session.board.write.bind(session.board);
  session.board.read = (address, width) => {
    const value = originalRead(address, width);
    mmio.push({ operation: 'read', address: hex(address), width, value: value === undefined ? 'unknown' : hex(value),
      pc: hex(lastPc) });
    if (mmio.length > 96) mmio.shift();
    return value;
  };
  session.board.write = (address, value, width) => {
    mmio.push({ operation: 'write', address: hex(address), width, value: hex(value), pc: hex(lastPc) });
    if (mmio.length > 96) mmio.shift();
    originalWrite(address, value, width);
  };
  let last;
  const limit = Number(process.env.OPENSP_STOCK_POST_SCATTER_INSTRUCTIONS ?? 100000);
  const start = session.cpu.totalInstructions;
  const sliceSize = Number(process.env.OPENSP_STOCK_SLICE_SIZE ?? 250000);
  for (let slices = 0; session.cpu.totalInstructions - start < limit && slices < 100000; slices++) {
    last = session.step(Math.min(sliceSize, limit - (session.cpu.totalInstructions - start)));
    if (last.reason !== 'budget' || !last.instructions) break;
  }
  report.stages.push({ name: 'real C runtime frontier', instructions: session.cpu.totalInstructions,
    postScatterInstructions: session.cpu.totalInstructions - start,
    reason: last.reason, fault: last.fault, pc: hex(last.pc),
    registers: last.reason === 'fault' ? 'Not read after WASM fault; the engine may be poisoned.'
      : Object.fromEntries(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'sp', 'lr', 'control', 'basepri', 'primask', 'xpsr']
        .map(name => [name, hex(session.cpu.readRegister(name))])),
    entered, lastExecuted: trace, mmio, unknownMmio: session.board.status().unknownMmio,
    displayFrames: session.board.status().frameCount });
  const currentRegion = codeAtScatterCheckpoint.find(region => last.pc >= region.address && last.pc + 4 <= region.address + region.bytes.length);
  report.frontier = { function: 'stock v5.52 pin-mux initialization sub_80000140',
    pc: hex(last.pc), nextBytes: currentRegion ? Buffer.from(currentRegion.bytes.subarray(last.pc - currentRegion.address, last.pc - currentRegion.address + 4)).toString('hex') : undefined,
    observedFailure: last.fault, classification: 'WASM execution failure; cause unresolved, not a demonstrated peripheral failure',
    remainingCacheRegisters: ['0xE000ED80 CCSIDR', '0xE000ED84 CSSELR'],
    preservation: 'stock-startup-first-trace-failure.json retains the first instrumented failure and its register snapshot' };
  if (process.env.OPENSP_STOCK_CLONE === '1' && last.reason !== 'fault') {
    const cpu = await createCPU({read: session.board.read.bind(session.board),
      write: session.board.write.bind(session.board), tick: session.board.tick.bind(session.board),
      setMemoryCallbacks: session.board.setMemoryCallbacks.bind(session.board)});
    for (const region of session.cpu.memoryMap) {
      for (let offset = 0; offset < region.bytes; offset += chunkBytes) {
        cpu.loadMemory(region.address + offset,
          session.cpu.readMemory(region.address + offset, Math.min(chunkBytes, region.bytes - offset)));
      }
    }
    const names = ['msp', 'psp', 'control', 'basepri', 'primask', 'faultmask',
      'r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'xpsr', 'pc'];
    for (const name of names) cpu.writeRegister(name, session.cpu.readRegister(name));
    cpu.onInstruction(address => {lastPc = address;});
    const result = cpu.step(32);
    report.cloneDiagnostic = {scope: 'Fresh ARM backend with captured full memory/registers and the same board state',
      startPc: hex(last.pc), ...result, pc: hex(result.pc)};
    if (!cpu.backendFailed) cpu.close();
  }
  await fs.mkdir(path.join(project, 'tools/emulator-evidence'), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ scatterInstructions: report.stages[0].instructions,
    checkedRegions: report.regionChecks.length, frontier: report.stages[1].pc,
    postScatterInstructions: report.stages[1].postScatterInstructions,
    reason: report.stages[1].reason, fault: report.stages[1].fault,
    unknownMmio: report.stages[1].unknownMmio.map(row => ({ ...row, address: hex(row.address) })) }, null, 2));
} finally {
  if (report.stages.at(-1)?.reason === 'fault') {
    report.cleanup = 'Engine is not reused or closed after its WASM fault; process teardown releases it.';
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } else try { session.close(); }
  catch (error) {
    report.cleanupError = String(error);
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
}
