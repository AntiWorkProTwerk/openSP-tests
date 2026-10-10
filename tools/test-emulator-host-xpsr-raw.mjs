import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createCPU } from '../src/lib/emulator/cpu.ts';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2] || !process.argv[3]) throw new Error('Supply repaired candidate artifacts and a new report directory');
const candidate = await fs.realpath(path.resolve(process.argv[2]));
const output = path.resolve(process.argv[3]);
const toolchain = path.resolve(process.argv[4] ?? path.join(project, '../sp404mk2/toolchains/bin'));
const publicRoot = await fs.realpath(path.join(project, 'public'));
if (candidate === publicRoot || candidate.startsWith(`${publicRoot}${path.sep}`)) throw new Error('Use a nonpublic repaired candidate');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const provenanceBytes = await fs.readFile(path.join(candidate, 'provenance.json'));
const provenance = JSON.parse(provenanceBytes);
const repairs = provenance.candidateComposition?.repairs;
if (provenance.candidateComposition?.name !== 'temp-lifetime-it-hook-stop-xpsr-hflags-m7-host-registers' ||
    JSON.stringify(repairs?.map(repair => repair.name)) !== JSON.stringify(['temp-lifetime', 'conditional-hook-stop', 'host-xpsr-hflags', 'm7-host-registers']) ||
    repairs[2].source.sha256 !== 'cff39b686f1dfc106f9aa17ea484babe020be8d7aa45a9fbbb4cf43549410423' ||
    repairs[3].source.sha256 !== 'ce12796247de53c6e39d937fbdb65af3e949e1b1f20be448c651ae45404e161c' ||
    repairs.some(repair => repair.applicationCount !== 1)) {
  throw new Error('Run controls only on the declared approved four-repair composition');
}
for (const [name, pin] of Object.entries(provenance.files)) {
  const bytes = await fs.readFile(path.join(candidate, name));
  if (hash(bytes) !== pin.sha256 || bytes.length !== pin.bytes) throw new Error(`Candidate pin mismatch: ${name}`);
}
await fs.mkdir(output);
const source = 'tools/fixtures/emulator-host-xpsr.S';
await fs.copyFile(path.join(project, source), path.join(output, 'fixture.S'));
await fs.copyFile(fileURLToPath(import.meta.url), path.join(output, 'qualification-tool.mjs'));
const run = (name, args) => {
  const result = spawnSync(path.join(toolchain, `${name}${process.platform === 'win32' ? '.exe' : ''}`), args, {encoding: 'utf8'});
  if (result.error || result.status !== 0) throw new Error(`${name}: ${result.error ?? result.stderr}`);
  return result.stdout;
};
run('arm-none-eabi-as', ['-mcpu=cortex-m7', '-mthumb', '-o', path.join(output, 'fixture.o'), path.join(output, 'fixture.S')]);
run('arm-none-eabi-ld', ['-Ttext=0x80000000', '-e', 'setup_npriv', '-o', path.join(output, 'fixture.elf'), path.join(output, 'fixture.o')]);
run('arm-none-eabi-objcopy', ['-O', 'binary', path.join(output, 'fixture.elf'), path.join(output, 'fixture.bin')]);
const symbolText = run('arm-none-eabi-nm', ['-n', path.join(output, 'fixture.elf')]);
await fs.writeFile(path.join(output, 'symbols.txt'), symbolText);
await fs.writeFile(path.join(output, 'disassembly.txt'), run('arm-none-eabi-objdump', ['-d', path.join(output, 'fixture.elf')])
  .replaceAll(path.join(output, 'fixture.elf'), 'fixture.elf'));
const symbols = Object.fromEntries(symbolText.split(/\r?\n/).flatMap(line => {
  const match = /^(\w+)\s+\w\s+(\S+)$/.exec(line);
  return match ? [[match[2], parseInt(match[1], 16)]] : [];
}));
const binary = await fs.readFile(path.join(output, 'fixture.bin'));
const { default: factory } = await import(pathToFileURL(path.join(candidate, 'unicorn-arm.js')).href);
const report = {scope: 'Four original finite CPS arithmetic controls on the repaired composition only',
  runtime: {files: provenance.files, composition: provenance.candidateComposition, provenanceSha256: hash(provenanceBytes)},
  reference: {document: 'Arm DUI 0646C', sections: ['2.1.1', '3.12.2'],
    url: 'https://documentation-service.arm.com/static/61efd8352dd99944d05142d1'},
  sourceSha256: Object.fromEntries(await Promise.all([source, 'tools/test-emulator-host-xpsr-raw.mjs',
    'src/lib/emulator/cpu.ts'].map(async name => [name, hash(await fs.readFile(path.join(project, name)))]))),
  cases: [], limitations: [
    'Forward controls exercise the translation-time privilege decision after Thread-to-Handler host XPSR writes',
    'Reverse controls have limited sensitivity: the special-register helper also checks live privilege and can pass with stale flags',
    'No direct host access to cached HANDLER/MMUIDX is supplied by the adapter',
    'Live M7 host PRIMASK reads expose stored masks directly; architected guest MRS restrictions are qualified separately',
    'No pending IRQ, exception-return engine target, invalid instruction, firmware or device execution is present',
    'Broader ARM profiles and context register APIs remain unqualified',
  ]};
const snapshot = cpu => Object.fromEntries(['pc', 'xpsr', 'control', 'primask', 'r2', 'r3', 'r4', 'sp'].map(register => [register, cpu.readRegister(register)]));
for (const forward of [true, false]) for (const disable of [true, false]) {
  const board = {ticks: 0, read() {return undefined;}, write() {}, tick(cycles) {this.ticks += cycles;}};
  const cpu = await createCPU(board, {factory});
  const initialPrimask = disable ? 0 : 1;
  const initialException = forward ? 0 : 16;
  const finalException = forward ? 16 : 0;
  const observation = disable ? 'observe_disable' : 'observe_enable';
  const record = {direction: forward ? 'unprivileged Thread to Handler' : 'Handler to unprivileged Thread',
    operation: disable ? 'CPSID i' : 'CPSIE i', initialPrimask, expectedPrimask: forward ? (disable ? 1 : 0) : initialPrimask,
    checks: {}, hostXpsrWriteBetweenCompletedCalls: true};
  try {
    cpu.loadMemory(0x80000000, binary);
    cpu.writeRegister('msp', 0x20008000);
    cpu.writeRegister('psp', 0x20007000);
    cpu.writeRegister('sp', 0x20008000);
    cpu.writeRegister('xpsr', 0x01000000 | initialException);
    cpu.writeRegister('primask', initialPrimask);
    cpu.writeRegister('r2', 0x20);
    cpu.writeRegister('r3', 100);
    cpu.writeRegister('r4', 0x94);
    record.initial = snapshot(cpu);
    record.checks.initialPrivilegedMask = record.initial.primask === initialPrimask;
    record.setup = cpu.step(32, {entry: symbols.setup_npriv | 1, until: symbols.setup_npriv_exit});
    record.afterSetup = snapshot(cpu);
    record.checks.setupCompleted = record.setup.reason !== 'fault' && record.setup.pc === symbols.setup_npriv_exit;
    record.checks.guestControlEstablished = record.afterSetup.control === 1 && record.afterSetup.r2 === 0x21;
    record.setupGetterScope = 'Raw live M7 host getter exposes the stored mask in either mode';
    record.checks.setupGetterRead = record.afterSetup.primask === initialPrimask;
    if (!record.checks.setupCompleted || !record.checks.guestControlEstablished) throw new Error('Finite setup did not establish the required state');
    const transitionedXpsr = ((record.afterSetup.xpsr & ~0x1ff) | 0x01000000 | finalException) >>> 0;
    cpu.writeRegister('xpsr', transitionedXpsr);
    record.afterHostWrite = snapshot(cpu);
    record.checks.setupPreservedMaskAndMode = (forward ? record.afterHostWrite.primask : record.afterSetup.primask) === initialPrimask &&
      (record.afterSetup.xpsr & 0x1ff) === initialException;
    record.checks.hostModeAndControl = (record.afterHostWrite.xpsr & 0x1ff) === finalException && record.afterHostWrite.control === 1;
    record.observation = cpu.step(32, {entry: symbols[observation] | 1, until: symbols[`${observation}_exit`]});
    record.final = snapshot(cpu);
    record.checks.observationCompleted = record.observation.reason !== 'fault' && record.observation.pc === symbols[`${observation}_exit`];
    record.finalGetterScope = 'Raw live M7 host getter exposes the stored mask in either mode';
    record.observedStoredPrimask = record.final.primask;
    record.checks.expectedMask = record.observedStoredPrimask === record.expectedPrimask;
    record.checks.arithmeticCompleted = record.final.r3 === 105 && record.final.r4 === 0x44 && record.final.r2 === 0x21;
    record.checks.finalModeAndControl = (record.final.xpsr & 0x1ff) === finalException && record.final.control === 1;
    record.checks.healthyBackend = !cpu.backendFailed;
    record.checks.finiteCounts = record.setup.instructions === 4 && record.observation.instructions === 3 &&
      cpu.totalInstructions === 7 && board.ticks === 7;
    record.totalInstructions = cpu.totalInstructions;
    record.boardTicks = board.ticks;
  } catch (error) {record.error = String(error); record.checks.execution = false;}
  finally {cpu.close();}
  record.passed = Object.values(record.checks).every(Boolean);
  report.cases.push(record);
}
report.passed = report.cases.every(record => record.passed);
report.artifactPins = Object.fromEntries(await Promise.all(['fixture.S', 'fixture.o', 'fixture.elf', 'fixture.bin',
  'symbols.txt', 'disassembly.txt', 'qualification-tool.mjs'].map(async name => {
  const bytes = await fs.readFile(path.join(output, name)); return [name, {bytes: bytes.length, sha256: hash(bytes)}];
})));
await fs.writeFile(path.join(output, 'qualification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({cases: report.cases.length, passed: report.passed,
  failed: report.cases.filter(record => !record.passed).map(record => ({direction: record.direction, operation: record.operation, checks: record.checks}))}));
if (!report.passed) process.exitCode = 1;
