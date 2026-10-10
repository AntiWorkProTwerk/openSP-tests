import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCPU } from '../src/lib/emulator/cpu.ts';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app1StartupFixtureSupplied = process.argv.includes('--r13');
const report = { scope: app1StartupFixtureSupplied
  ? 'Real ARM WASM instructions and R13 APP1 startup; no physical device evidence'
  : 'Real ARM WASM instructions; no APP1 startup or physical device evidence',
  app1StartupFixtureSupplied,
  cases: [], limitations: ['Board time counts instruction starts, not measured M7 cycles',
    'FPU access permission faults and lazy exception stacking are not verified',
    'This CPU test does not establish complete firmware peripherals or sampler operation'] };
const board = (read = () => undefined) => ({ read, writes: [], ticks: 0,
  write(address, value, width) { this.writes.push({ address, value, width }); },
  tick(cycles) { this.ticks += cycles; } });
const word = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = JSON.parse(await fs.readFile(path.join(project,
  'public/emulator/vendor/provenance.json'), 'utf8'));
for (const [name, expected] of Object.entries(provenance.files)) {
  const contents = await fs.readFile(path.join(project, 'public/emulator/vendor', name));
  assert.equal(contents.length, expected.bytes, name);
  assert.equal(hash(contents), expected.sha256, name);
}
report.runtime = { wrapperCommit: provenance.wrapperCommit, coreCommit: provenance.coreCommit,
  jsSha256: provenance.files['unicorn-arm.js'].sha256,
  wasmSha256: provenance.files['unicorn-arm.wasm'].sha256 };
report.sourceSha256 = Object.fromEntries(await Promise.all(['src/lib/emulator/cpu.ts',
  'tools/test-emulator-cpu.mjs'].map(async name => [name, hash(await fs.readFile(path.join(project, name)))])));

{
  const {default: engineFactory} = await import('../public/emulator/vendor/unicorn-arm.js');
  const module = await engineFactory();
  const OriginalEngine = module.Unicorn;
  const nonScalar = new Set([module.ARM_REG_D0, module.ARM_REG_D31,
    module.ARM_REG_Q0, module.ARM_REG_Q15, module.ARM_REG_CP_REG]);
  let rejectedEngineCalls = 0;
  module.Unicorn = function (...args) {
    const engine = new OriginalEngine(...args);
    for (const name of ['reg_read_i32', 'reg_write_i32']) {
      const original = engine[name].bind(engine);
      engine[name] = (register, ...values) => {
        // The test never sends an incompatible-width call to the real engine.
        if (nonScalar.has(register)) {
          rejectedEngineCalls++;
          throw new Error('Test intercepted a non-scalar register call');
        }
        return original(register, ...values);
      };
    }
    return engine;
  };
  const cpu = await createCPU(board(), {factory: async () => module});
  cpu.writeRegister('s30', 0xbf800000);
  cpu.writeRegister('s31', 0x3fc00000);
  assert.equal(cpu.readRegister('s30'), 0xbf800000);
  assert.equal(cpu.readRegister('s31'), 0x3fc00000, 'Adjacent scalar FP registers keep independent bits');
  cpu.writeRegister('UC_ARM_REG_R14', 0xfffffffd);
  assert.equal(cpu.readRegister('ARM_REG_LR'), 0xfffffffd, 'Prefixed scalar aliases preserve high values');
  for (const register of ['d0', 'D31', 'q0', 'ARM_REG_Q15', 'UC_ARM_REG_CP_REG']) {
    assert.throws(() => cpu.readRegister(register), /requires a wider or structured API/);
    assert.throws(() => cpu.writeRegister(register, 0), /requires a wider or structured API/);
  }
  assert.equal(rejectedEngineCalls, 0, 'Unsupported register widths are rejected before the engine binding');
  assert.equal(cpu.backendFailed, false);
  report.cases.push({name: 'Scalar FP bits and aliases; wider register APIs rejected before engine invocation',
    scalarRegisters: ['S30', 'S31', 'LR'], rejectedEngineCalls});
  cpu.close();
}

{
  const fixture = board();
  const cpu = await createCPU(fixture);
  assert.equal(cpu.cpuModel, 10, 'Actual Cortex-M7 model readback');
  // MOVS r0,#0; ADDS r0,#1; B back to ADDS.
  cpu.loadMemory(0x80000000, new Uint8Array([0x00, 0x20, 0x01, 0x30, 0xfd, 0xe7]));
  let instructions = 0;
  for (let slice = 0; slice < 12; slice++) {
    const result = cpu.step(11, slice === 0 ? { entry: 0x80000001 } : {});
    assert.notEqual(result.reason, 'fault', result.fault);
    assert.equal(result.instructions, 11, 'Exact instruction bound in repeated branch slices');
    instructions += result.instructions;
  }
  assert.equal(cpu.totalInstructions, instructions);
  assert.equal(fixture.ticks, instructions);
  assert.equal(cpu.readRegister('r0'), 66);
  for (let slice = 0; slice < 12; slice++) {
    const result = cpu.step(100_000);
    assert.equal(result.reason, 'budget');
    assert.equal(result.instructions, 100_000);
  }
  assert.equal(cpu.totalInstructions, 1_200_132);
  assert.equal(fixture.ticks, 1_200_132);
  assert.equal(cpu.readRegister('r0'), 600_066);
  for (const [register, value] of Object.entries({ msp: 0x20243000, psp: 0x20242000,
    control: 2, primask: 1, basepri: 0x20, faultmask: 1, xpsr: 0x01000000 })) {
    cpu.writeRegister(register, value);
    assert.equal(cpu.readRegister(register), value, register);
  }
  assert.throws(() => cpu.step(0));
  assert.throws(() => cpu.step(1_000_001));
  report.cases.push({ name: 'Cortex-M7 readback, exact repeated slices, special registers',
    instructions: cpu.totalInstructions, sliceSizes: [11, 100_000], repetitions: 12 });
  cpu.close();
}

{
  const fixture = board(address => address === 0x40000000 ? 123 : undefined);
  const cpu = await createCPU(fixture);
  // LDR r0,[r1]; ADDS r0,#1; STR r0,[r1,#4]; B self.
  cpu.loadMemory(0x80000000, new Uint8Array([0x08, 0x68, 0x01, 0x30, 0x48, 0x60, 0xfe, 0xe7]));
  cpu.writeRegister('r1', 0x40000000);
  const result = cpu.step(3, { entry: 0x80000001 });
  assert.equal(result.reason, 'budget');
  assert.equal(cpu.readRegister('r0'), 124);
  assert.deepEqual(fixture.writes, [{ address: 0x40000004, value: 124, width: 4 }]);
  assert.equal(word(cpu.readMemory(0x40000004, 4)), 124);
  report.cases.push({ name: 'Guest MMIO loads and stores call the board', instructions: result.instructions });
  cpu.close();
}

{
  const cpu = await createCPU(board());
  cpu.loadMemory(0x80000000, Uint8Array.from([1, 0x20, 0xfe, 0xe7]));
  cpu.writeRegister('r0', 123);
  let preparations = 0;
  const remove = cpu.onInstruction((address, size, instance) => {
    preparations++;
    instance.synchronizeInstructionState(address, size);
  });
  const result = cpu.step(1, {entry: 0x80000001});
  assert.equal(result.reason, 'fault');
  assert.match(result.fault, /no progress after 64 internal restarts/);
  assert.equal(preparations, 64);
  assert.equal(result.instructions, 0, 'Preparation retries consume no guest instruction budget');
  assert.equal(cpu.readRegister('r0'), 123);
  assert.equal(cpu.backendFailed, false, 'A bounded preparation failure preserves the healthy backend');
  remove();
  assert.equal(cpu.step(1).reason, 'budget');
  assert.equal(cpu.readRegister('r0'), 1, 'The healthy CPU resumes after the repeated preparation is removed');
  report.cases.push({name: 'Repeated instruction preparation stops after 64 retries and remains resumable',
    preparations, instructionStarts: result.instructions});
  cpu.close();
}

{
  const cpu = await createCPU(board());
  const instructions = 70;
  // MOVS r0,#index throughout a bounded path, followed by B self.
  const code = new Uint8Array(instructions * 2 + 2);
  for (let index = 0; index < instructions; index++) code.set([index, 0x20], index * 2);
  code.set([0xfe, 0xe7], instructions * 2);
  cpu.loadMemory(0x80000000, code);
  const prepared = new Set();
  cpu.onInstruction((address, size, instance) => {
    if (prepared.has(address)) return;
    prepared.add(address);
    instance.synchronizeInstructionState(address, size);
  });
  const result = cpu.step(instructions, {entry: 0x80000001});
  assert.equal(result.reason, 'budget', JSON.stringify({result, preparations: prepared.size}));
  assert.equal(result.instructions, instructions);
  assert.equal(prepared.size, instructions, 'Progress resets the consecutive preparation limit');
  assert.equal(cpu.readRegister('r0'), instructions - 1);
  report.cases.push({name: 'One preparation per progressing instruction preserves the original slice budget',
    preparations: prepared.size, instructionStarts: result.instructions});
  cpu.close();
}

{
  const {default: engineFactory} = await import('../public/emulator/vendor/unicorn-arm.js');
  const actions = {
    reg_read_i32: cpu => cpu.readRegister('r0'),
    reg_write_i32: cpu => cpu.writeRegister('r0', 1),
    mem_read: cpu => cpu.readMemory(0x80000000, 2),
    mem_write: cpu => cpu.writeMemory(0x80000000, Uint8Array.from([0, 0xbf])),
    ctl_remove_cache: cpu => cpu.synchronizeInstructionState(0x80000000, 2),
    emu_stop: cpu => cpu.stop(),
    hook_del: cpu => cpu.close(),
    close: cpu => cpu.close(),
  };
  for (const [target, action] of Object.entries(actions)) {
    const module = await engineFactory();
    const OriginalEngine = module.Unicorn;
    let armed = false, injected = false, callsAfterFailure = 0;
    module.Unicorn = function (...args) {
      const engine = new OriginalEngine(...args);
      for (const name of [...Object.keys(actions), 'emu_start']) {
        const original = engine[name].bind(engine);
        engine[name] = (...values) => {
          if (injected) {callsAfterFailure++; throw new Error('Test blocked reuse after injected terminal failure');}
          if (armed && name === target) {
            injected = true;
            throw new WebAssembly.RuntimeError(`Injected ${target} failure`);
          }
          return original(...values);
        };
      }
      return engine;
    };
    const cpu = await createCPU(board(), {factory: async () => module, sdramBytes: 0x10000});
    cpu.loadMemory(0x80000000, Uint8Array.from([0, 0xbf]));
    cpu.writeRegister('ARM_REG_PC', 0x80000001);
    armed = true;
    assert.throws(() => action(cpu), WebAssembly.RuntimeError, target);
    assert.equal(cpu.backendFailed, true, target);
    assert.equal(cpu.readRegister('UC_ARM_REG_PC'), 0x80000000, 'Cached PC accepts the documented prefixes');
    assert.throws(() => cpu.readMemory(0x80000000, 2), /unavailable/);
    assert.throws(() => cpu.writeRegister('r0', 0), /unavailable/);
    assert.throws(() => cpu.synchronizeInstructionState(0x80000000, 2), /unavailable/);
    assert.throws(() => cpu.queueDeviceWrite(0x80000000, Uint8Array.from([0])), /unavailable/);
    cpu.stop();
    cpu.close();
    assert.equal(callsAfterFailure, 0, target);
  }
  report.cases.push({name: 'Injected public API and cleanup failures mark the backend terminal before reuse',
    injectedMethods: Object.keys(actions), backendCallsAfterFailure: 0});
}

{
  const cpu = await createCPU(board());
  assert.throws(() => cpu.readMemory(0x90000000, 4), /unmapped/i);
  assert.throws(() => cpu.writeMemory(0x90000000, Uint8Array.from([0, 0, 0, 0])), /unmapped/i);
  assert.equal(cpu.backendFailed, false, 'Ordinary API memory errors preserve the backend');
  cpu.writeRegister('r0', 42);
  assert.equal(cpu.readRegister('r0'), 42);
  cpu.close();
  assert.throws(() => cpu.readMemory(0x80000000, 2), /CPU is closed/);
  assert.throws(() => cpu.readRegister('r0'), /CPU is closed/);
  cpu.stop();
  report.cases.push({name: 'Ordinary memory API errors remain recoverable; closed CPU APIs are rejected'});
}

{
  const cpu = await createCPU(board());
  // Assembled from tools/fixtures/emulator-cpu.S with Arm GNU14.3.Rel1.
  cpu.loadMemory(0x80000000, new Uint8Array([
    0x00, 0xee, 0x10, 0x0a, 0x00, 0xee, 0x90, 0x1a, 0x30, 0xee,
    0x20, 0x1a, 0x11, 0xee, 0x10, 0x2a, 0x00, 0xbf, 0xfe, 0xe7,
  ]));
  cpu.writeRegister('r0', 0x3fc00000); //1.5
  cpu.writeRegister('r1', 0x40200000); //2.5
  const result = cpu.step(4, { entry: 0x80000001 });
  assert.equal(result.reason, 'budget', result.fault);
  assert.equal(cpu.readRegister('r2'), 0x40800000); //4.0
  report.cases.push({ name: 'Actual VFP single-precision VMOV/VADD', resultBits: '40800000' });
  cpu.close();
}

{
  const cpu = await createCPU(board());
  cpu.loadMemory(0x80000000, new Uint8Array([0x01, 0x20, 0x02, 0x30, 0xfe, 0xe7]));
  const remove = cpu.onInstruction((address, _size, instance) => {
    if (address === 0x80000002) instance.stop();
  });
  const result = cpu.step(10, { entry: 0x80000001 });
  assert.equal(result.reason, 'stopped');
  assert.equal(result.instructions, 1);
  assert.equal(cpu.readRegister('r0'), 1, 'Stop callback runs before guest instruction');
  remove();
  assert.equal(cpu.step(1).instructions, 1);
  assert.equal(cpu.readRegister('r0'), 3);
  cpu.writeRegister('pc', 0x90000000);
  const fault = cpu.step(1);
  assert.equal(fault.reason, 'fault');
  assert.match(fault.fault, /unmapped/i);
  assert.equal(cpu.backendFailed, false, 'Ordinary guest fetch faults preserve the backend');
  assert.equal(cpu.readMemory(0x80000000, 1)[0], 1);
  report.cases.push({ name: 'Pre-instruction stop, resume, and unmapped fetch fault' });
  cpu.close();
}

{
  const {default: engineFactory} = await import('../public/emulator/vendor/unicorn-arm.js');
  const module = await engineFactory();
  const OriginalEngine = module.Unicorn;
  let injected = false, callsAfterFailure = 0;
  module.Unicorn = function (...args) {
    const engine = new OriginalEngine(...args);
    for (const name of ['mem_read', 'mem_write', 'reg_read_i32', 'reg_write_i32', 'emu_stop', 'close']) {
      const original = engine[name].bind(engine);
      engine[name] = (...values) => {if (injected) callsAfterFailure++; return original(...values);};
    }
    engine.emu_start = () => {injected = true; throw new WebAssembly.RuntimeError('Injected engine failure');};
    return engine;
  };
  const cpu = await createCPU(board(), {factory: async () => module});
  cpu.loadMemory(0x80000000, Uint8Array.from([1, 0x20, 0xfe, 0xe7]));
  const result = cpu.step(1, {entry: 0x80000001});
  assert.equal(result.reason, 'fault');
  assert.equal(result.backendLost, true);
  assert.equal(cpu.backendFailed, true);
  assert.equal(result.pc, 0x80000000, 'Attempted entry survives a trap before the first code hook');
  assert.match(result.fault, /RuntimeError/);
  assert.throws(() => cpu.readMemory(0x80000000, 4), /unavailable/);
  assert.throws(() => cpu.writeMemory(0x80000000, Uint8Array.from([0])), /unavailable/);
  assert.throws(() => cpu.writeRegister('r0', 0), /unavailable/);
  assert.equal(cpu.readRegister('pc'), 0x80000000);
  assert.equal(cpu.step(1).backendLost, true);
  cpu.close(); // Deliberately performs no calls into the trapped instance.
  assert.equal(callsAfterFailure, 0, 'A lost engine is never called during diagnostics or cleanup');
  report.cases.push({name: 'Injected terminal engine failure blocks backend reuse and permits worker teardown',
    attemptedPc: '80000000', instructionStarts: result.instructions, backendLost: true});
}

{
  const cpu = await createCPU(board());
  const address = 0x20201000;
  const initial = Uint8Array.from([5, 0, 0, 0]);
  cpu.loadMemory(address, initial);
  cpu.loadMemory(0x80000000, Uint8Array.from([0, 0x68, 0xfe, 0xe7]));
  cpu.writeRegister('r0', address);
  let published = false;
  cpu.onInstruction((pc) => {
    if (pc !== 0x80000000 || published) return;
    published = true;
    const replacement = Uint8Array.from([9, 0, 0, 0]);
    cpu.loadMemory(address, replacement);
    replacement.fill(0);
    assert.equal(word(cpu.readMemory(address, 4)), 9, 'Callback reads observe owned pending data');
  });
  const result = cpu.step(2, {entry: 0x80000001});
  assert.equal(result.reason, 'budget', result.fault);
  assert.equal(result.instructions, 2);
  assert.equal(cpu.readRegister('r0'), 9, 'The current guest load sees data published before it executes');
  report.cases.push({name: 'Instruction-boundary context publication precedes the guest load',
    instructions: result.instructions, guestLoadedValue: 9});
  cpu.close();
}

{
  let readDevice, writeDevice;
  let overlayObserved = false;
  const fixture = board();
  fixture.setMemoryCallbacks = (read, write) => {readDevice = read; writeDevice = write;};
  fixture.write = (address, _value, _width) => {
    if (address !== 0x40000000) return;
    writeDevice(0x60090000, Uint8Array.from([7, 0x20, 0x70, 0x47]));
    const data = Uint8Array.from([0x78, 0x56, 0x34, 0x12]);
    writeDevice(0x60090040, data);
    // Queue entries own their data instead of keeping mutable device buffers.
    data.fill(0);
    overlayObserved = word(readDevice(0x60090040, 4)) === 0x12345678;
  };
  const cpu = await createCPU(fixture);
  cpu.loadMemory(0x60090000, Uint8Array.from([1, 0x20, 0x70, 0x47]));
  cpu.loadMemory(0x80000000, Uint8Array.from([0x08, 0x60, 0x1a, 0x68, 0xa0, 0x47, 0xfe, 0xe7]));
  cpu.writeRegister('lr', 0x80000001);
  assert.equal(cpu.step(2, {entry: 0x60090001}).reason, 'budget');
  assert.equal(cpu.readRegister('r0'), 1); // Prime the original XIP translation.
  cpu.writeRegister('r0', 99); cpu.writeRegister('r1', 0x40000000);
  cpu.writeRegister('r3', 0x60090040); cpu.writeRegister('r4', 0x60090001);
  const result = cpu.step(5, {entry: 0x80000001});
  assert.equal(result.reason, 'budget', result.fault);
  assert.equal(result.instructions, 5, 'Internal device yield preserves the original slice budget');
  assert.equal(cpu.readRegister('r0'), 7, 'Guest executes newly published XIP instructions');
  assert.equal(cpu.readRegister('r2'), 0x12345678, 'Next guest load observes retired device DMA');
  assert.equal(overlayObserved, true, 'Device reads observe their queued writes');
  assert.equal(fixture.ticks, 7);
  report.cases.push({name: 'Retired device DMA and modified XIP resume within the original budget',
    instructions: result.instructions, changedInstructionResult: 7, nextGuestLoad: '12345678'});
  cpu.close();
}

if (app1StartupFixtureSupplied) {
  const source = path.resolve(project, '../sp404mk2/sdk/examples/original_r13/build');
  const image = new Uint8Array(await fs.readFile(path.join(source, 'original_r13.bin')));
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
  assert.equal(hash(image), manifest.binary_sha256, 'R13 firmware manifest pin');
  const symbols = Object.fromEntries((await fs.readFile(path.join(source, 'symbols.txt'), 'utf8'))
    .split('\n').map(line => line.trim().split(/\s+/)).filter(parts => parts.length === 3)
    .map(([address, _kind, name]) => [name, Number.parseInt(address, 16)]));
  const fixture = board();
  const cpu = await createCPU(fixture);
  cpu.loadMemory(0x60080000, image);
  cpu.loadMemory(symbols.__bss_start, new Uint8Array(symbols.__bss_end - symbols.__bss_start).fill(0xa5));
  cpu.writeRegister('msp', 0x202435b8);
  cpu.writeRegister('psp', 0x20242800);
  cpu.writeRegister('control', 2);
  cpu.writeRegister('basepri', 16);
  cpu.writeRegister('lr', 4);
  cpu.writeRegister('r0', 0x60080001);
  let reached = false;
  cpu.onInstruction((address, _size, instance) => {
    if (address === symbols.firmware_main) { reached = true; instance.stop(); }
  });
  const result = cpu.step(100_000, { entry: symbols.app1_entry | 1 });
  assert.equal(result.reason, 'stopped', result.fault);
  assert.equal(reached, true, 'Actual R13 firmware_main reached');
  const runtimeBytes = symbols.__runtime_end - symbols.__runtime_start;
  assert.deepEqual(cpu.readMemory(symbols.__runtime_start, runtimeBytes),
    image.slice(symbols.__runtime_load - 0x60080000, symbols.__runtime_load - 0x60080000 + runtimeBytes));
  assert.deepEqual(cpu.readMemory(symbols.__data_start, symbols.__data_end - symbols.__data_start),
    image.slice(symbols.__data_load - 0x60080000, symbols.__data_load - 0x60080000 + symbols.__data_end - symbols.__data_start));
  assert.equal(cpu.readMemory(symbols.__bss_start, symbols.__bss_end - symbols.__bss_start).some(Boolean), false);
  assert.equal(word(cpu.readMemory(0xe000ed08, 4)), symbols.vector_table);
  assert.equal(cpu.readRegister('msp'), symbols.__stack_top);
  assert.equal(cpu.readRegister('control'), 0);
  assert.equal(cpu.readRegister('basepri'), 0);
  assert.equal(cpu.readRegister('r0'), 0x60080001);
  assert.equal(cpu.readRegister('r1'), 0x20242800);
  assert.equal(cpu.readRegister('r2'), 4);
  assert.equal(cpu.readRegister('r3'), 2);
  report.cases.push({ name: 'R13 original APP1 startup reaches firmware_main',
    firmwareSha256: hash(image), firmwareBytes: image.length, runtimeBytes,
    instructions: result.instructions, pc: result.pc,
    checks: ['Full runtime relocation', 'Initialized data copy', 'BSS cleared',
      'Own VTOR/stack/control', 'Captured incoming arguments'] });
  cpu.close();
}

const reportArgument = process.argv.indexOf('--report');
if (reportArgument !== -1) {
  const destination = path.resolve(process.argv[reportArgument + 1]);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
