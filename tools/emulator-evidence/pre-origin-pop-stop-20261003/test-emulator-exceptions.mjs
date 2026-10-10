import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = ['src/lib/emulator/exceptions.ts', 'src/lib/emulator/cpu.ts',
  'src/lib/emulator/session.ts', 'tests/emulator-exceptions.test.mjs',
  'tests/emulator-exceptions-fpu.test.mjs', 'tools/fixtures/emulator-exceptions-fpu.S',
  'tools/emulator-evidence/exception-fpu-fixture.o',
  'docs/emulator-exceptions.md', 'tools/test-emulator-exceptions.mjs'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = {};
for (const filename of sourceFiles) {
  const contents = await fs.readFile(path.join(root, filename));
  files[filename] = { bytes: contents.length, sha256: sha(contents) };
}
const tests = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
  'tests/emulator-exceptions.test.mjs', 'tests/emulator-exceptions-fpu.test.mjs'],
  { cwd: root, encoding: 'utf8', timeout: 30_000 });
assert.equal(tests.status, 0, tests.stdout + tests.stderr);
const summary = (name) => Number(tests.stdout.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1]);
assert.equal(summary('tests'), 54); assert.equal(summary('pass'), 54); assert.equal(summary('fail'), 0);
const typecheck = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--ignoreConfig',
  '--noEmit', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler',
  '--strict', 'src/lib/emulator/exceptions.ts'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
assert.equal(typecheck.status, 0, typecheck.stdout + typecheck.stderr);
const runtime = JSON.parse(await fs.readFile(path.join(root, 'public/emulator/vendor/provenance.json'), 'utf8'));
for (const name of ['unicorn-arm.js', 'unicorn-arm.wasm']) {
  const contents = await fs.readFile(path.join(root, 'public/emulator/vendor', name));
  assert.equal(sha(contents), runtime.files[name].sha256, name);
}
const report = {
  scope: 'Offline architectural model and executed Cortex-M7 WASM fixtures; no physical SP evidence or stock RTOS completion',
  files,
  primarySources: [
    { document: 'Armv7-M Architecture Reference Manual DDI0403E.e, ID021621',
      url: 'https://documentation-service.arm.com/static/606dc36485368c4c2b1bf62f',
      bytes: 5957561, sha256: '76500176d20f897eaf05eeadb5a6202cef641e332073b107905c8898e0ee0747',
      printedPages: ['B1-532..B1-535: PushStack, ExceptionTaken, UpdateFPCCR',
        'B1-540..B1-543: EXC_RETURN and PopStack', 'B1-565..B1-566: ExecuteFPCheck and PreserveFPState',
        'B3-615..B3-618: FP register access and control registers'],
      retention: 'PDF retained in the private documentation cache; copyrighted manual is not redistributed here' },
    { document: 'Cortex-M7 Generic User Guide DUI0646B',
      url: 'https://documentation-service.arm.com/static/61efd6602dd99944d051417b',
      bytes: 2016314, sha256: '4b474102e4dc490fdb759dde329715b1f348ebe433e97830f585bb92481f463a',
      printedPages: ['2-25: basic and extended frame diagram', '4.2..4.4: NVIC, SCB and SysTick', '4.7: FPU'],
      retention: 'PDF retained in the private documentation cache; Figure2-2 visually checked' },
    { document: 'Pinned Unicorn M-profile VFP translator',
      url: `https://github.com/unicorn-engine/unicorn/blob/${runtime.coreCommit}/qemu/target/arm/translate-vfp.inc.c#L110-L168`,
      relevance: 'FPCA-dependent first-use FPSCR initialization is emitted while translating, before instruction hooks' },
  ],
  validation: { commands: ['node --test tests/emulator-exceptions.test.mjs tests/emulator-exceptions-fpu.test.mjs',
    'node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict src/lib/emulator/exceptions.ts'],
    passedGroups: 54, failedGroups: 0, registerMemoryGroups: 44, realM7Groups: 10, strictTypecheck: 'passed' },
  executedCases: ['Hardware core-frame edit and software-owned R4',
    'Original VFP activation and preserved integer-only refusal', 'Legacy POP fetch-token observation with explicit model return',
    'Eager FP handler restores low registers while S16 remains software-owned',
    'Lazy FP handler publishes interrupted S0 before VMOV with exact two-instruction budget',
    'IT-skipped VFP produces no hook, FP activation or lazy save',
    'ASPEN automatic/manual activation and FPDSCR across adjacent FP instructions',
    'VLDR/VSTR/VPUSH/VPOP/VMRS/VMSR execute', 'Round-positive 1+2^-24 yields 3F800001',
    'Modeled CPACR denial stops before VFP execution; no NOCP handler was fabricated'],
  failedApproaches: [
    { evidence: 'tools/emulator-evidence/exception-fpu-boundary.json',
      observation: 'An unterminated VFP fixture aborted translation before any retired instruction; closing the lost backend trapped again',
      status: 'Historical failure retained; corrected terminated fixture passes' },
    { observation: 'Writing FPSCR Rmode00400000 and FPCA1 inside the first VMOV hook produced FPSCR0',
      expected: '00400000', observed: '00000000',
      cause: 'The translated first-use reset was already compiled from backend FPDSCR',
      correction: 'synchronizeInstructionState leaves the engine, invalidates the stale translation, and retries with the prepared context',
      regression: 'Actual arithmetic result3F800001 establishes applied rounding, beyond a final status write' },
  ],
  runtime: { wrapperCommit: runtime.wrapperCommit, coreCommit: runtime.coreCommit,
    files: { 'unicorn-arm.js': runtime.files['unicorn-arm.js'], 'unicorn-arm.wasm': runtime.files['unicorn-arm.wasm'] } },
  historicalIntegerOnly: 'tools/emulator-evidence/exceptions-integer-only/manifest.json',
  limits: ['Counts are model instruction starts/source ticks, not measured M7 cycles',
    'NOCP escalation and derived stacking faults are explicit model errors',
    'Late arrival, non-base Thread return, sleep and exclusive monitors remain unmodeled',
    'Architecturally UNKNOWN caller-saved FP registers retain deterministic values',
    'Production EXC_RETURN interception is separately qualified by exception-return-qualification.json; the legacy fetch observation does not qualify arbitrary fetch recovery',
    'Frame fixtures do not establish stock RTOS boot, sampler/audio, complete USB classes or physical SP behavior'],
};
await fs.writeFile(path.join(root, 'tools/emulator-evidence/exception-fpu-qualification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passedGroups: 54, realM7Groups: 10, report: 'tools/emulator-evidence/exception-fpu-qualification.json' }));
