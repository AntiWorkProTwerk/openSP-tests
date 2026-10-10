import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createCPU as originalCreateCPU } from '../src/lib/emulator/cpu.ts';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(project,
  'tools/emulator-evidence/thumb-it-qualification-20261003c'));
const toolchain = path.resolve(process.argv[3] ?? path.join(project,
  '../sp404mk2/toolchains/bin'));
const runtime = process.argv[4] ? path.resolve(process.argv[4]) :
  path.join(project, 'public/emulator/vendor');
const { default: suppliedFactory } = await import(pathToFileURL(path.join(runtime, 'unicorn-arm.js')).href);
const createCPU = board => originalCreateCPU(board, { factory: suppliedFactory });
// Evidence directories are write-once. Use another output path for a later run.
await fs.mkdir(output);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const source = 'tools/fixtures/emulator-thumb-it.S';
await fs.copyFile(path.join(project, source), path.join(output, 'fixture.S'));
await fs.copyFile(fileURLToPath(import.meta.url), path.join(output, 'qualification-tool.mjs'));
const runTool = (name, args) => {
  const command = spawnSync(path.join(toolchain, `${name}${process.platform === 'win32' ? '.exe' : ''}`),
    args, { encoding: 'utf8' });
  if (command.error || command.status !== 0) {
    throw new Error(`${name}: ${command.error ?? command.stderr}`);
  }
  return command.stdout;
};
runTool('arm-none-eabi-as', ['-mcpu=cortex-m7', '-mthumb', '-o', path.join(output, 'fixture.o'),
  path.join(output, 'fixture.S')]);
runTool('arm-none-eabi-ld', ['-Ttext=0x80000000', '-e', 'single', '-o',
  path.join(output, 'fixture.elf'), path.join(output, 'fixture.o')]);
runTool('arm-none-eabi-objcopy', ['-O', 'binary', path.join(output, 'fixture.elf'),
  path.join(output, 'fixture.bin')]);
const symbolsText = runTool('arm-none-eabi-nm', ['-n', path.join(output, 'fixture.elf')]);
await fs.writeFile(path.join(output, 'symbols.txt'), symbolsText);
await fs.writeFile(path.join(output, 'disassembly.txt'), runTool('arm-none-eabi-objdump',
  ['-d', path.join(output, 'fixture.elf')]).replaceAll(path.join(output, 'fixture.elf'), 'fixture.elf'));
const symbols = Object.fromEntries(symbolsText.trim().split(/\r?\n/).map(line => {
  const match = /^(\w+)\s+\w\s+(\S+)$/.exec(line);
  return match ? [match[2], parseInt(match[1], 16)] : [];
}).filter(pair => pair.length));
const provenance = JSON.parse(await fs.readFile(path.join(runtime, 'provenance.json'), 'utf8'));
for (const [name, pin] of Object.entries(provenance.files)) {
  const bytes = await fs.readFile(path.join(runtime, name));
  if (digest(bytes) !== pin.sha256 || bytes.length !== pin.bytes) throw new Error(`Runtime pin mismatch: ${name}`);
}
const report = {
  scope: 'Original legal register-only Thumb IT/ITE/ITTTT functional qualification; no firmware or physical device execution',
  architectureSource: { name: 'Armv7-M Architecture Reference Manual, DDI 0403E.e',
    url: 'https://documentation-service.arm.com/static/606dc36485368c4c2b1bf62f',
    sections: ['A7.3.1-A7.3.3 conditional execution and ITSTATE', 'A7.7.38 IT', 'B1.4.2 EPSR'] },
  runtime: { wrapperCommit: provenance.wrapperCommit, coreCommit: provenance.coreCommit,
    files: provenance.files, candidateComposition: provenance.candidateComposition,
    explicitCandidateDirectory: Boolean(process.argv[4]),
    provenanceSha256: digest(await fs.readFile(path.join(runtime, 'provenance.json'))) },
  sourceSha256: Object.fromEntries(await Promise.all([source, 'tools/test-emulator-thumb-it.mjs',
    'src/lib/emulator/cpu.ts', 'public/emulator/vendor/provenance.json'].map(async name =>
    [name, digest(await fs.readFile(path.join(project, name)))]))),
  assembler: runTool('arm-none-eabi-as', ['--version']).split(/\r?\n/)[0],
  cases: [], limitations: [
    'Small register-only fixtures do not establish firmware startup, interrupts, peripheral timing or full instruction coverage',
    'Code-hook observations are recorded separately from expected architectural retirement',
    'No incoming IT state is changed manually; CPU/session sources remain unchanged',
  ],
};
const binary = await fs.readFile(path.join(output, 'fixture.bin'));
const initial = { r1: 0x31, r2: 0x52, r3: 0x63, r4: 0x84, r5: 0xa5, r6: 0xb6, r7: 0xc7 };
const itBits = xpsr => ((xpsr >>> 25) & 3) | ((xpsr >>> 8) & 0xfc);
const advance = state => (state & 7) === 0 ? 0 : (state & 0xe0) | ((state << 1) & 0x1f);
const definitions = [
  { name: 'single', mask: 8, conditions: [true], apply: expected => { expected.r1 = 0x71; } },
  { name: 'alternate', mask: 12, conditions: [true, false], apply: (expected, eq) => {
    if (eq) expected.r1 += 3; else expected.r2 -= 2;
  } },
  { name: 'four', mask: 1, conditions: [true, true, true, true], apply: expected => {
    expected.r1 += 1; expected.r2 -= 2; expected.r3 = 0x43; expected.r4 ^= expected.r5;
  } },
];
const failures = [];
for (const definition of definitions) for (const eq of [true, false]) {
  const start = symbols[definition.name];
  const exit = symbols[`${definition.name}_exit`];
  const slotAddresses = definition.conditions.map((_, index) => start + 4 + index * 2);
  const finalAddress = start + 4 + definition.conditions.length * 2;
  const expectedRegisters = { r0: eq ? 0 : 1, ...initial, r6: 0x66 };
  if (definition.name === 'alternate' || eq) definition.apply(expectedRegisters, eq);
  const expectedFlags = eq ? 0x60000000 : 0x20000000;
  const expectedHooks = [start, start + 2,
    ...slotAddresses.filter((_, index) => definition.conditions[index] === eq), finalAddress];
  const stateAt = new Map([[start, 0], [start + 2, 0], [finalAddress, 0], [exit, 0]]);
  let state = definition.mask;
  for (const address of slotAddresses) { stateAt.set(address, state); state = advance(state); }
  const schedules = [{ name: 'full', budgets: [64] }, { name: 'unit', budgets: [1] },
    { name: 'mixed', budgets: [2, 1, 3] },
    ...expectedHooks.slice(1).map(address => ({ name: `hook-stop-${address - start}`, budgets: [64], yieldAddress: address }))];
  for (const schedule of schedules) {
    const board = { ticks: 0, read() { return undefined; }, write() {}, tick(cycles) { this.ticks += cycles; } };
    const cpu = await createCPU(board);
    cpu.loadMemory(0x80000000, binary);
    for (const [register, value] of Object.entries({ ...initial, r0: eq ? 0 : 1 })) cpu.writeRegister(register, value);
    const record = { block: definition.name, conditionEqual: eq, schedule: schedule.name,
      expected: { registers: expectedRegisters, nzcv: expectedFlags, hooks: expectedHooks,
        itStateAtAddress: Object.fromEntries(stateAt) }, hooks: [], slices: [], checks: {} };
    let yielded = false;
    const remove = cpu.onInstruction((address, size, instance) => {
      const xpsr = instance.readRegister('xpsr');
      record.hooks.push({ address, size, xpsr, itState: itBits(xpsr) });
      if (!yielded && address === schedule.yieldAddress) { yielded = true; instance.stop(); }
    });
    try {
      for (let index = 0; index < 24; index++) {
        const result = cpu.step(schedule.budgets[index % schedule.budgets.length],
          { ...(index === 0 ? { entry: start | 1 } : {}), until: exit });
        const xpsr = cpu.readRegister('xpsr');
        const snapshot = { ...result, xpsr, itState: itBits(xpsr),
          expectedItState: stateAt.get(result.pc),
          registers: Object.fromEntries(['r0', ...Object.keys(initial)].map(register => [register, cpu.readRegister(register)])) };
        record.slices.push(snapshot);
        if (result.reason === 'fault' || result.pc === exit) break;
      }
      const last = record.slices.at(-1);
      record.checks.mappedExit = last.pc === exit;
      record.checks.healthyBackend = !cpu.backendFailed && record.slices.every(slice => slice.reason !== 'fault');
      record.checks.registers = Object.entries(expectedRegisters).every(([register, value]) => last.registers[register] === value);
      record.checks.flagsPreserved = (last.xpsr & 0xf0000000) >>> 0 === expectedFlags;
      record.checks.sliceItState = record.slices.every(slice => slice.expectedItState === slice.itState);
      record.checks.terminalItState = last.itState === 0;
      // A requested hook stop invokes that callback again on continuation if the instruction has not retired.
      const predictedTrace = schedule.yieldAddress === undefined ? expectedHooks :
        expectedHooks.flatMap(address => address === schedule.yieldAddress ? [address, address] : [address]);
      record.expected.hookTraceWithStop = predictedTrace;
      record.checks.hookTrace = JSON.stringify(record.hooks.map(hook => hook.address)) === JSON.stringify(predictedTrace);
      record.checks.hookItState = record.hooks.every(hook => hook.itState === stateAt.get(hook.address));
      record.checks.countMatchesReference = cpu.totalInstructions === expectedHooks.length;
      record.checks.countMatchesTicks = cpu.totalInstructions === board.ticks &&
        cpu.totalInstructions === record.slices.reduce((sum, slice) => sum + slice.instructions, 0);
      record.instructions = cpu.totalInstructions;
      record.boardTicks = board.ticks;
      record.yieldObserved = yielded;
      if (schedule.yieldAddress !== undefined) record.checks.hookYieldOccurred = yielded;
    } catch (error) { record.error = String(error); record.checks.execution = false; }
    finally { remove(); cpu.close(); }
    for (const [check, passed] of Object.entries(record.checks)) if (!passed) {
      failures.push({ block: definition.name, conditionEqual: eq, schedule: schedule.name, check });
    }
    report.cases.push(record);
  }
}
for (const name of ['final_bx', 'final_pop']) for (const eq of [true, false]) {
  const start = symbols[name];
  const target = symbols[`${name}_target`];
  const exit = symbols[`${name}${eq ? '_target' : ''}_exit`];
  for (const schedule of ['full', 'unit', ...(eq ? ['hook-stop-before-transfer'] : [])]) {
    const board = { ticks: 0, read() { return undefined; }, write() {}, tick(cycles) { this.ticks += cycles; } };
    const cpu = await createCPU(board);
    cpu.loadMemory(0x80000000, binary);
    const stack = 0x20004000;
    const stackWord = new Uint8Array(4);
    new DataView(stackWord.buffer).setUint32(0, target | 1, true);
    cpu.writeMemory(stack, stackWord);
    for (const [register, value] of Object.entries({ ...initial, r0: eq ? 0 : 1,
      r7: target | 1, sp: stack })) cpu.writeRegister(register, value);
    const record = { block: name, conditionEqual: eq, schedule, mappedTarget: target,
      expected: { exit, r6: eq ? 0x77 : 0x66, sp: stack + (name === 'final_pop' && eq ? 4 : 0),
        requestedStopPc: start + 4 }, hooks: [], slices: [], checks: {} };
    let yielded = false;
    const remove = cpu.onInstruction((address, size, instance) => {
      const xpsr = instance.readRegister('xpsr');
      record.hooks.push({ address, size, xpsr, itState: itBits(xpsr) });
      if (schedule === 'hook-stop-before-transfer' && !yielded && address === start + 4) {
        yielded = true; instance.stop();
      }
    });
    try {
      for (let index = 0; index < 12; index++) {
        const result = cpu.step(schedule === 'unit' ? 1 : 64,
          { ...(index === 0 ? { entry: start | 1 } : {}), until: exit });
        const xpsr = cpu.readRegister('xpsr');
        record.slices.push({ ...result, xpsr, itState: itBits(xpsr), r6: cpu.readRegister('r6'),
          sp: cpu.readRegister('sp') });
        if (result.reason === 'fault' || result.pc === exit) break;
      }
      const last = record.slices.at(-1);
      record.checks.mappedExit = last.pc === exit;
      record.checks.healthyBackend = !cpu.backendFailed && record.slices.every(slice => slice.reason !== 'fault');
      record.checks.registerEffects = last.r6 === record.expected.r6 && last.sp === record.expected.sp;
      record.checks.flagsPreserved = (last.xpsr & 0xf0000000) >>> 0 === (eq ? 0x60000000 : 0x20000000);
      record.checks.terminalItState = last.itState === 0;
      record.checks.hookItState = record.hooks.every(hook => hook.itState === (hook.address === start + 4 ? 8 : 0));
      record.checks.countMatchesReference = cpu.totalInstructions === (eq ? 4 : 3);
      if (schedule === 'hook-stop-before-transfer') {
        const first = record.slices[0];
        record.checks.stopBeforeTransfer = yielded && first.pc === start + 4 && first.r6 === initial.r6 && first.sp === stack;
        record.yieldObserved = yielded;
      }
      record.instructions = cpu.totalInstructions;
      record.boardTicks = board.ticks;
    } catch (error) { record.error = String(error); record.checks.execution = false; }
    finally { remove(); cpu.close(); }
    for (const [check, passed] of Object.entries(record.checks)) if (!passed) failures.push({ block: name,
      conditionEqual: eq, schedule, check });
    report.cases.push(record);
  }
}
report.artifactPins = Object.fromEntries(await Promise.all(['fixture.S', 'fixture.o', 'fixture.elf',
  'fixture.bin', 'symbols.txt', 'disassembly.txt', 'qualification-tool.mjs'].map(async name => {
  const bytes = await fs.readFile(path.join(output, name)); return [name, { bytes: bytes.length, sha256: digest(bytes) }];
})));
report.failures = failures;
report.passed = failures.length === 0;
await fs.writeFile(path.join(output, 'qualification.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ cases: report.cases.length, passed: report.passed, failures }));
if (failures.length) process.exitCode = 1;
