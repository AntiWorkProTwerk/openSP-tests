import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createCPU } from '../src/lib/emulator/cpu.ts';
import { CortexMExceptions, EXC_RETURN } from '../src/lib/emulator/exceptions.ts';
import { captureExceptionReturn, applyPcTransferEffects } from '../src/lib/emulator/exception-return.ts';

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
    repairs[3].source.sha256 !== 'ce12796247de53c6e39d937fbdb65af3e949e1b1f20be448c651ae45404e161c' ||
    repairs.some(repair => repair.applicationCount !== 1)) throw new Error('Use the approved revision-2 four-repair composition');
for (const [name, pin] of Object.entries(provenance.files)) {
  const bytes = await fs.readFile(path.join(candidate, name));
  assert.equal(hash(bytes), pin.sha256, `Candidate pin: ${name}`);
  assert.equal(bytes.length, pin.bytes);
}
await fs.mkdir(output);
const source = 'tools/fixtures/emulator-m7-host-registers.S';
await fs.copyFile(path.join(project, source), path.join(output, 'fixture.S'));
await fs.copyFile(fileURLToPath(import.meta.url), path.join(output, 'qualification-tool.mjs'));
const run = (name, args) => {
  const result = spawnSync(path.join(toolchain, `${name}${process.platform === 'win32' ? '.exe' : ''}`), args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${name}: ${result.error ?? result.stderr}`);
  return result.stdout;
};
run('arm-none-eabi-as', ['-mcpu=cortex-m7', '-mthumb', '-o', path.join(output, 'fixture.o'), path.join(output, 'fixture.S')]);
run('arm-none-eabi-ld', ['-Ttext=0x80000000', '-e', 'thread_arithmetic', '-o', path.join(output, 'fixture.elf'), path.join(output, 'fixture.o')]);
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
const T = 0x01000000, MSP = 0x20248000, PSP = 0x20249000, VECTOR = 0x80001000;
const registers = ['pc', 'xpsr', 'control', 'msp', 'psp', 'sp', 'primask', 'basepri', 'basepri_max', 'faultmask'];
const snapshot = cpu => Object.fromEntries(registers.map(name => [name, cpu.readRegister(name)]));
const report = {
  scope: 'Original finite live M7 host/guest special-register and production exception-model controls on the repaired composition only',
  runtime: { files: provenance.files, composition: provenance.candidateComposition, provenanceSha256: hash(provenanceBytes) },
  sourceSha256: Object.fromEntries(await Promise.all([source, 'tools/test-emulator-m7-host-registers.mjs',
    'src/lib/emulator/cpu.ts', 'src/lib/emulator/exceptions.ts', 'src/lib/emulator/exception-return.ts']
    .map(async name => [name, hash(await fs.readFile(path.join(project, name)))]))),
  cases: [],
  limitations: [
    'Qualification is limited to the live selected Cortex-M7 without the security extension',
    'Saved-context register APIs, broader profiles, native NVIC delivery and full firmware remain unqualified',
    'Model exception entry/return is software-owned; the engine is stopped before BX LR and never executes an EXC_RETURN target',
    'Mapped instruction counts are deterministic hook starts, not measured Cortex-M7 cycles',
  ],
  firmwareExecuted: false, exceptionReturnEngineTargetExecuted: false, contextApiUsed: false,
};
async function qualify(name, action) {
  const board = { ticks: 0, read() { return undefined; }, write() {}, tick(cycles) { this.ticks += cycles; } };
  const cpu = await createCPU(board, { factory });
  const record = { name, checks: [], guestInstructionStarts: 0 };
  const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); record.checks.push(label); };
  const step = label => {
    const result = cpu.step(32, { entry: symbols[label] | 1, until: symbols[`${label}_exit`] });
    check(`${label} mapped exit`, result.reason !== 'fault' && result.pc === symbols[`${label}_exit`], true);
    return result;
  };
  try {
    cpu.loadMemory(0x80000000, binary);
    cpu.writeRegister('xpsr', T);
    cpu.writeRegister('msp', MSP);
    cpu.writeRegister('psp', PSP);
    cpu.writeRegister('r6', 100);
    await action({ cpu, board, record, check, step });
    check('healthy backend', cpu.backendFailed, false);
    check('tick/count agreement', board.ticks, cpu.totalInstructions);
    record.guestInstructionStarts = cpu.totalInstructions;
    record.final = snapshot(cpu);
    record.passed = true;
  } catch (error) { record.error = String(error); record.passed = false; }
  finally { cpu.close(); }
  report.cases.push(record);
}

await qualify('Raw live masks retain widths and BASEPRI_MAX semantics in unprivileged Thread', ({ cpu, check }) => {
  cpu.writeRegister('control', 1);
  cpu.writeRegister('primask', 0xffffffff);
  cpu.writeRegister('faultmask', 2);
  cpu.writeRegister('basepri', 0x1a0);
  check('host raw mask widths', [cpu.readRegister('primask'), cpu.readRegister('faultmask'), cpu.readRegister('basepri')], [1, 0, 0xa0]);
  cpu.writeRegister('faultmask', 0xffffffff);
  for (const [value, expected] of [[0, 0xa0], [0xe0, 0xa0], [0x80, 0x80], [0x140, 0x40]]) {
    cpu.writeRegister('basepri_max', value);
    check(`BASEPRI_MAX ${value}`, [cpu.readRegister('basepri'), cpu.readRegister('basepri_max')], [expected, expected]);
  }
  cpu.writeRegister('basepri', 0);
  cpu.writeRegister('basepri_max', 0x60);
  check('BASEPRI_MAX from zero and FAULTMASK width', [cpu.readRegister('basepri'), cpu.readRegister('faultmask')], [0x60, 1]);
});

await qualify('Unprivileged guest MRS reads restrictions while host retains raw masks and both stack banks', ({ cpu, check, step }) => {
  cpu.writeRegister('control', 3);
  cpu.writeRegister('msp', MSP + 0x100);
  cpu.writeRegister('psp', PSP + 0x100);
  cpu.writeRegister('primask', 1);
  cpu.writeRegister('basepri', 0x80);
  cpu.writeRegister('faultmask', 1);
  check('distinct raw banked stacks', [cpu.readRegister('msp'), cpu.readRegister('psp'), cpu.readRegister('sp')], [MSP + 0x100, PSP + 0x100, PSP + 0x100]);
  const result = step('read_special');
  check('unprivileged guest MRS values', Array.from({ length: 6 }, (_, i) => cpu.readRegister(`r${i}`)), [0, 0, 0, 0, 0, 3]);
  check('stored host values survive guest reads', registers.slice(3).map(name => cpu.readRegister(name)), [MSP + 0x100, PSP + 0x100, PSP + 0x100, 1, 0x80, 0x80, 1]);
  check('finite read count and arithmetic', [result.instructions, cpu.readRegister('r6')], [7, 101]);
});

await qualify('Unprivileged guest MSR is ignored; raw host CONTROL restores privilege for later guest MRS', ({ cpu, check, step }) => {
  cpu.writeRegister('control', 3);
  cpu.writeRegister('primask', 1);
  cpu.writeRegister('basepri', 0x80);
  cpu.writeRegister('faultmask', 1);
  const inputs = [MSP + 0x200, PSP + 0x200, 0, 0, 0x40, 0];
  inputs.forEach((value, i) => cpu.writeRegister(`r${i}`, value));
  cpu.writeRegister('r7', 0);
  const written = step('write_special');
  check('guest writes retain raw state', [cpu.readRegister('msp'), cpu.readRegister('psp'), cpu.readRegister('control'), cpu.readRegister('primask'), cpu.readRegister('basepri'), cpu.readRegister('faultmask')], [MSP, PSP, 3, 1, 0x80, 1]);
  check('finite unprivileged write count', written.instructions, 9);
  cpu.writeRegister('control', 0);
  const read = step('read_special');
  check('host CONTROL reestablishes privileged guest access', Array.from({ length: 6 }, (_, i) => cpu.readRegister(`r${i}`)), [MSP, PSP, 1, 0x80, 1, 0]);
  check('finite read count and arithmetic', [read.instructions, cpu.readRegister('r6')], [7, 102]);
});

await qualify('Privileged guest MSR keeps original stack, mask and CONTROL semantics', ({ cpu, check, step }) => {
  [MSP + 0x200, PSP + 0x200, 3, 0xa0, 0x60, 3].forEach((value, i) => cpu.writeRegister(`r${i}`, value));
  cpu.writeRegister('r7', 6);
  const written = step('write_special');
  check('privileged guest write effects', [cpu.readRegister('msp'), cpu.readRegister('psp'), cpu.readRegister('sp'), cpu.readRegister('control'), cpu.readRegister('primask'), cpu.readRegister('basepri'), cpu.readRegister('faultmask')], [MSP + 0x200, PSP + 0x200, PSP + 0x200, 6, 1, 0x60, 1]);
  const read = step('read_special');
  check('privileged guest MRS values', Array.from({ length: 6 }, (_, i) => cpu.readRegister(`r${i}`)), [MSP + 0x200, PSP + 0x200, 1, 0x60, 1, 6]);
  check('finite guest counts and arithmetic', [written.instructions, read.instructions, cpu.readRegister('r6')], [9, 7, 102]);
});

await qualify('Host CONTROL swaps canonical stack banks and retains FPCA across Thread/Handler transitions', ({ cpu, record, check }) => {
  record.transitions = [];
  for (const [control, active] of [[4, MSP], [7, PSP], [5, MSP], [6, PSP], [4, MSP]]) {
    cpu.writeRegister('control', control);
    record.transitions.push(snapshot(cpu));
    check(`Thread CONTROL ${control}`, [cpu.readRegister('control'), cpu.readRegister('msp'), cpu.readRegister('psp'), cpu.readRegister('sp')], [control, MSP, PSP, active]);
  }
  cpu.writeRegister('xpsr', T | 16);
  cpu.writeRegister('control', 7);
  check('Handler host SPSEL storage keeps MSP active', [cpu.readRegister('control'), cpu.readRegister('msp'), cpu.readRegister('psp'), cpu.readRegister('sp')], [7, MSP, PSP, MSP]);
  cpu.writeRegister('xpsr', T);
  check('XPSR mode restoration selects stored PSP', [cpu.readRegister('control'), cpu.readRegister('msp'), cpu.readRegister('psp'), cpu.readRegister('sp')], [7, MSP, PSP, PSP]);
  cpu.writeRegister('control', 0xffffffff);
  check('CONTROL supported fields', cpu.readRegister('control'), 7);
});

await qualify('Handler guest CONTROL ignores SPSEL while live host CONTROL can restore it', ({ cpu, check, step }) => {
  cpu.writeRegister('xpsr', T | 16);
  cpu.writeRegister('control', 4);
  [MSP + 0x300, PSP + 0x300, 0, 0, 0, 0].forEach((value, i) => cpu.writeRegister(`r${i}`, value));
  cpu.writeRegister('r7', 7);
  const written = step('write_special');
  check('Handler guest SPSEL remains zero', [cpu.readRegister('control'), cpu.readRegister('sp'), cpu.readRegister('msp'), cpu.readRegister('psp')], [5, MSP + 0x300, MSP + 0x300, PSP + 0x300]);
  cpu.writeRegister('control', 7);
  check('Handler host SPSEL retained', [cpu.readRegister('control'), cpu.readRegister('sp')], [7, MSP + 0x300]);
  cpu.writeRegister('xpsr', T);
  check('Thread resumes PSP with nPRIV and FPCA', [cpu.readRegister('control'), cpu.readRegister('sp')], [7, PSP + 0x300]);
  check('finite Handler guest count', written.instructions, 9);
});

for (const [mask, value] of [['primask', 1], ['basepri', 0x40], ['faultmask', 1]]) {
  await qualify(`Production exception model honors raw ${mask} and enters/returns unprivileged Thread PSP`, ({ cpu, record, check, step }) => {
    cpu.writeRegister('control', 3);
    for (let i = 0; i < 13; i++) cpu.writeRegister(`r${i}`, 0x20 + i);
    cpu.writeRegister('lr', symbols.thread_arithmetic_exit | 1);
    const thread = step('thread_arithmetic');
    check('finite Thread arithmetic count', thread.instructions, 3);
    const savedNames = ['r0', 'r1', 'r2', 'r3', 'r12', 'lr', 'pc', 'xpsr'];
    const saved = savedNames.map(name => cpu.readRegister(name));
    const vectors = new Uint8Array(128), vectorView = new DataView(vectors.buffer);
    vectorView.setUint32(16 * 4, symbols.interrupt_handler | 1, true);
    cpu.loadMemory(VECTOR, vectors);
    const model = new CortexMExceptions(cpu, { vectorTable: VECTOR, externalInterrupts: 1 });
    model.setPriority(16, 0x80);
    model.setExternalEnabled(0, true);
    model.pend(16);
    cpu.writeRegister(mask, value);
    check('raw host mask observed in unprivileged Thread', cpu.readRegister(mask), value);
    check('masked model dispatch retains pending', [model.dispatchPending(), model.pendingCount, model.activeException], [null, 1, 0]);
    cpu.writeRegister(mask, 0);
    record.entry = model.dispatchPending();
    check('PSP entry metadata', [record.entry.kind, record.entry.stack, record.entry.excReturn, record.entry.stackPointer], ['entry', 'psp', EXC_RETURN.threadPsp, PSP - 32]);
    check('Handler canonical banks and nPRIV retention', [cpu.readRegister('control'), cpu.readRegister('msp'), cpu.readRegister('psp'), cpu.readRegister('sp'), cpu.readRegister('xpsr') & 0x1ff], [1, MSP, PSP - 32, MSP, 16]);
    const frame = cpu.readMemory(PSP - 32, 32), frameView = new DataView(frame.buffer, frame.byteOffset, 32);
    check('actual basic frame contents', Array.from({ length: 8 }, (_, i) => frameView.getUint32(i * 4, true)), saved);
    const trace = [];
    let transfer;
    const unsubscribe = cpu.onInstruction((address, size) => {
      trace.push(address);
      if (address === symbols.interrupt_return) {
        transfer = captureExceptionReturn(cpu, address, size, model.activeException);
        cpu.stop();
      }
    });
    try { record.handler = cpu.step(32); } finally { unsubscribe(); }
    model.afterExecution();
    check('stop precedes BX and mapped PC remains at instruction', [record.handler.reason, record.handler.instructions, record.handler.pc], ['stopped', 2, symbols.interrupt_return]);
    check('captured production return token', [transfer?.kind, transfer?.target], ['bx', EXC_RETURN.threadPsp]);
    check('all observed hook addresses remain ordinary mapped code', trace.every(address => address >= 0x80000000 && address < 0x80000100), true);
    cpu.writeRegister('primask', 1);
    cpu.writeRegister('basepri', 0x50);
    cpu.writeRegister('faultmask', 1);
    applyPcTransferEffects(cpu, transfer);
    record.returned = model.returnFromException(transfer.target);
    check('software model return uses PSP', [record.returned.kind, record.returned.stack, model.activeException], ['return', 'psp', 0]);
    check('Thread raw stack/control restoration', [cpu.readRegister('control'), cpu.readRegister('msp'), cpu.readRegister('psp'), cpu.readRegister('sp')], [3, MSP, PSP, PSP]);
    check('basic frame registers restored exactly', savedNames.map(name => cpu.readRegister(name)), saved);
    check('callee registers and masks retain modeled effects', [cpu.readRegister('r4'), cpu.readRegister('r5'), cpu.readRegister('primask'), cpu.readRegister('basepri'), cpu.readRegister('faultmask')], [0x24 + 7, 0x55, 1, 0x50, 0]);
    check('finite model handler/Thread starts', cpu.totalInstructions, 5);
    record.handlerTrace = trace;
    record.returnTransferExecutedByEngine = false;
  });
}

report.passed = report.cases.every(record => record.passed);
report.artifactPins = Object.fromEntries(await Promise.all(['fixture.S', 'fixture.o', 'fixture.elf', 'fixture.bin',
  'symbols.txt', 'disassembly.txt', 'qualification-tool.mjs'].map(async name => {
  const bytes = await fs.readFile(path.join(output, name)); return [name, { bytes: bytes.length, sha256: hash(bytes) }];
})));
await fs.writeFile(path.join(output, 'qualification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ cases: report.cases.length, passed: report.passed,
  failed: report.cases.filter(record => !record.passed).map(({ name, error }) => ({ name, error })) }));
if (!report.passed) process.exitCode = 1;
