# Node TypeScript test runner

The required OpenSP checks pass on Node `v24.20.0`: type checking reports zero
errors, warnings or hints across 150 files; the static build passes; `npm test`
passes 1,145 Node tests, 12 ARM WASM CPU cases and all 183 Playwright checks.
The chapter exercises and demonstration checks also pass. This is local software
verification, with no deployment or physical device operation.

## Runner change

Node's default type stripping rejected the existing constructor parameter
property in `src/lib/emulator/display-bus.ts` before its tests could run:
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. The unchanged display-bus test file fails
under the default invocation and passes all six cases when transformation is
enabled.

The local `--experimental-transform-types` flag works, and was present in the
project's minimum Node version. Node 26 removed that flag, so adding it to the
runner would narrow the declared `>=22.12.0` contract.
[Node 22.12 CLI documentation](https://nodejs.org/download/release/v22.12.0/docs/api/cli.html#--experimental-transform-types),
[Node TypeScript documentation](https://nodejs.org/dist/latest/docs/api/typescript.html).

The required test runner instead registers
[a test-only loader](../../tools/test-typescript-loader.mjs) through
[Node's module hook](../../tools/register-test-typescript.mjs). It uses the
already installed TypeScript `6.0.3` compiler. There are no new package
dependencies or lockfile changes. The loader transpiles `.ts` files only inside
the project's `src`, `tests` and `tools` roots, delegating dependencies,
JavaScript and outside paths to Node. Syntax errors are reported before module
execution. Production bundling continues through Astro.

Only the `test:emulator` value in the existing working `package.json` changed:

```text
node --import ./tools/register-test-typescript.mjs --test tests/emulator-*.test.mjs && node --import ./tools/register-test-typescript.mjs tools/test-emulator-cpu.mjs
```

Its original glob and CPU program remain intact. Four
[runner regression tests](../../tests/emulator-test-runner.test.mjs) cover
constructor parameter properties, enum forward/reverse mappings, relative
imports with erased types, and delegation outside the loader's scope. No
existing test, assertion or emulator implementation was modified. SHA256 checks
confirm all 110 pre-existing emulator, script and test files stayed unchanged
through the task. Existing unrelated package and documentation edits were
preserved.

## Verification

The [result and source pins](../../tools/test-runner-evidence/node24-typescript-20261004/result.json)
record Node `v24.20.0`, TypeScript `6.0.3`, Playwright `1.63.0`, Chromium
`153.0.8010.12`/revision `1243`, the unchanged source graph and the build hash.

| Check | Result |
|---|---|
| `npm run check` | 150 files; 0 errors, 0 warnings, 0 hints |
| `npm run build` | Passed; existing MDX directive warnings remain |
| Chapter exercises | 16 chapters passed |
| Demonstrations | 17 models, 672 states, 6,720 frames passed |
| Node model and runner tests | 1,145 passed; 0 failed or skipped |
| ARM WASM CPU stage | 12 cases passed; APP1 startup fixture not requested |
| Playwright | All 183 passed with the original 8-worker configuration |
| `npm test` | Exit 0; no test filters or assertion changes |

The first full run passed the Node and CPU stages, then browser launches failed
because the pinned Chromium headless shell was absent. It recorded 18 passing
checks, 161 launch failures and four checks that did not run. The existing
`npm run test:install` command installed the matching browser. A complete
`npm test` rerun then passed all 183 Playwright checks in 2.2 minutes. Both raw
logs remain outside the repository; their hashes are recorded in the result.

The final build-info SHA256 is
`f88d40e3249e5d419b8db6e3485dc110c114b6eedbd16a455043ff4a2e0ce891`.
The result SHA256 is
`a1855147d40ca51190f84ce2239eae8ad9c066ca17a70229f730e989afe7d278`.
Only local Node 24 was executed for this qualification. Firmware behavior on
the physical SP remains outside this runner result.
