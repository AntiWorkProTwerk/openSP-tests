import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = {};
for (const filename of ['src/lib/emulator/exception-return.ts', 'src/lib/emulator/exceptions.ts',
  'src/lib/emulator/cpu.ts', 'src/lib/emulator/session.ts', 'src/lib/emulator/instruction-boundary.ts', 'tests/emulator-exception-return.test.mjs',
  'tools/fixtures/emulator-exception-return.S', 'tools/emulator-evidence/exception-return-fixture.o',
  'docs/emulator-exception-return.md', 'tools/test-emulator-exception-return.mjs']) {
  const contents = await fs.readFile(path.join(root, filename));
  files[filename] = { bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') };
}
const tests = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/emulator-exception-return.test.mjs'],
  { cwd: root, encoding: 'utf8', timeout: 30_000 });
assert.equal(tests.status, 0, tests.stdout + tests.stderr);
for (const [name, expected] of [['tests', 45], ['pass', 45], ['fail', 0]]) {
  assert.equal(Number(tests.stdout.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1]), expected);
}
const typed = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--ignoreConfig', '--noEmit',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--allowImportingTsExtensions',
  '--strict', 'src/lib/emulator/exception-return.ts'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
assert.equal(typed.status, 0, typed.stdout + typed.stderr);
const runtime = JSON.parse(await fs.readFile(path.join(root, 'public/emulator/vendor/provenance.json'), 'utf8'));
for (const name of ['unicorn-arm.js', 'unicorn-arm.wasm']) {
  const contents = await fs.readFile(path.join(root, 'public/emulator/vendor', name));
  assert.equal(createHash('sha256').update(contents).digest('hex'), runtime.files[name].sha256, name);
}
const report = {
  scope: 'Offline instruction decoding, model transfers, and benign mapped-target Cortex-M7 branches; no engine EXC_RETURN faults or physical SP operations',
  files,
  source: { document: 'Arm DDI0403E.e, ID021621',
    url: 'https://documentation-service.arm.com/static/606dc36485368c4c2b1bf62f',
    sha256: '76500176d20f897eaf05eeadb5a6202cef641e332073b107905c8898e0ee0747',
    printedPages: ['A2-31: BXWritePC and LoadWritePC', 'A7-215: BX',
      'A7-242..245: LDMIA/LDMDB encodings and post-PC writeback', 'A7-246..251: LDR immediate/literal/register',
      'A7-319..320: POP encodings and pre-load SP update', 'B1-539..543: exception return interpretation and unstack'],
    method: 'Retained manual text/pseudocode checked; independent read-only architecture review confirmed masks and writeback boundary' },
  validation: { command: 'node --test tests/emulator-exception-return.test.mjs',
    passedGroups: 45, failedGroups: 0, registerMemoryGroups: 26, benignRealM7Groups: 19, strictTypecheck: 'passed' },
  qualified: ['BX register', 'POP narrow/wide and single-register LDR alias',
    'LDMIA/LDMDB without writeback, with all otherwise legal bases',
    'General LDM writeback limited to R4-R11; LDMIA SP! is POP alias',
    'LDR PC immediate positive/negative, pre/post-indexed, shifted register, literal positive/negative',
    'Passing condition, final IT position, aligned source memory, exact six raw tokens',
    'Fresh immutable transfer applies only software loads/writeback, never hidden context or PC'],
  executedEvidence: { ordinaryInstructionForms: 17, target: '80002001 (mapped normal branch)',
    observations: ['Each form retires one instruction, reaches80002000, and matches its decoded load/writeback values',
      'Passing final IT BX is hooked; skipped IT BX is omitted',
      'Stopping before a normal POP leaves a fresh plan; software application updatesR4/SP while PC/IPSR remain unchanged'],
    boundary: 'The real-engine tests do not execute EXC_RETURN. Hardware-unstack interaction is a separate register/memory fixture.' },
  failedAttempt: { observation: 'The first17 benign-branch assertions compared unsigned decoded targets with a signed JavaScript bitwise expected value',
    correction: 'Expected target converted to unsigned with >>>0; no instruction-byte or engine change was required' },
  refused: ['Thread mode and unrelated PC writers cannot be interpreted as EXC_RETURN',
    'Raw even/reserved tokens are not normalized from fetch PCs', 'Stale source code, data, registers or mode',
    'Reserved/unpredictable operands and unaligned PC-load addresses', 'Device/system-memory source reads',
    'General LDM writeback through R0-R3, R12, LR, and LDMDB SP'],
  unmodeled: ['Post-return behavior for excluded general LDM writebacks', 'Fault rollback, MPU/MMIO load effects and interrupted multiple-load continuation',
    'Physical timing, stock RTOS completion, complete USB/audio/sampler behavior'],
  runtime: { wrapperCommit: runtime.wrapperCommit, coreCommit: runtime.coreCommit,
    files: { 'unicorn-arm.js': runtime.files['unicorn-arm.js'], 'unicorn-arm.wasm': runtime.files['unicorn-arm.wasm'] } },
};
await fs.writeFile(path.join(root, 'tools/emulator-evidence/exception-return-qualification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passedGroups: 45, benignRealM7Groups: 19, report: 'tools/emulator-evidence/exception-return-qualification.json' }));
