# Whole-stock qualification

[`test-emulator-stock.mjs`](../tools/test-emulator-stock.mjs) runs the complete,
unmodified stock v5.52 APP1 from the adjacent firmware repository. Its pinned
SHA256 is `4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80`.
The image executes its own copy, decompression and zero-region startup. The host
observes the source checkpoint `0x60080622` and checks all twelve destinations
against [`memory_map.json`](../../sp404mk2/analysis/v552/memory_map.json).
Reconstructed runtime files are never loaded into the session.

The ordinary path uses the session's initial RAM and captured APP1 handoff.
Zero-region hashes establish the resulting contents; initially zero model RAM
does not independently demonstrate that the guest cleared previously nonzero
bytes. The earlier poisoned-RAM check remains historical evidence in the
[preserved tool and report manifest](../tools/emulator-evidence/stock-pre-ordinary-qualification-2026-10-03T035034-963Z/manifest.json).
That snapshot also retains the earlier cache-flush and cloned-backend diagnostics.
Their original files and failed status are preserved.

After the scatter hashes match, ordinary execution continues for the requested
counted-hook budget. These observed starts do not guarantee architectural
retirement counts or a stop before every conditional instruction. The
[Thumb conditional qualification](emulator-thumb-conditional.md) preserves
47 functional cases but fails 17 strict scheduling checks in its retained
`20261003c` report; a separate comparison records 19 count differences.
Each stock report records separate `scatter.passed` and
`boundedExecution.passed` results, the actual stopping phase, PC, backend state,
exception status, display hash, unknown MMIO and its overflow count. A successful
budget interval leaves `completeBoot.verified` false. Stock UI startup, RTOS task
behavior, storage and audio still need acceptance checks of their own. Peripheral
backing memory can allow execution beyond an unsupported access; unknown MMIO
therefore remains part of the evidence even when the interval completes.

The [public-runtime post-oscillator report](../../sp404mk2/analysis/emulator/oscillator_stock_20261003/whole-image.json)
passes all twelve scatter hashes after 19,016,148 observed hook starts. It
requests 1,000,000 further starts, then counts 500,001 before
`UC_ERR_INSN_INVALID`/code 10 at `0x80000CCE`. The backend remains healthy
(`cpuBackendFailed:false`), the display has emitted no frame, and unknown MMIO
is retained with zero overflow. No exception is active. Source and runtime
hashes remain stable. The
report keeps `scatter.passed:true`, `boundedExecution.passed:false` and
`completeBoot.verified:false`; its overall `passed` value is false. This
observation does not identify the cause of the invalid-instruction result.

The integrated [oscillator model](emulator-oscillator.md) passes 24 isolated
component groups and two board-routing groups. This whole-image run reaches
synthetic power-up readiness and crystal detection, and oscillator addresses
no longer appear as unknown accesses. These transitions do not establish
physical clock timing or complete clock routing.

The [read-only frontier review](../../sp404mk2/analysis/emulator/oscillator_stock_20261003/stock-frontier-static.md)
compares captured bytes `F2 D5 54 F8` with the pristine image. The first halfword
is a valid BPL at `0x80000CCE`; the normal stream's preceding ITT PL block has
already completed. Captured xPSR `0x61005C00` contains ITSTATE `0x5C`, which is
inconsistent with that instruction context. This narrows the mismatch to
conditional state or translation context without establishing its mechanism.
The benign conditional fixtures use ordinary mapped targets, with no EXC_RETURN
execution. Strict slice stopping, retirement counts and final-IT-slot session
transfer interception remain unqualified on that public runtime.

The isolated [conditional-hook candidate qualification](../../sp404mk2/analysis/emulator/vendor_candidate_it_hook_stop_20261003/thumb-it-qualification/qualification.json)
passes all 47 benign cases with their strict checks. Its twelve generic CPU
cases also pass. Candidate WASM SHA256 is
`b1c7679ea8c045c955f075bc1aed87cd150f6314ecebae8a8e379d95b8752d0c`,
705,109 bytes; the public artifact at that checkpoint was `16599c54…`. The separate
[candidate whole-image report](../../sp404mk2/analysis/emulator/vendor_candidate_it_hook_stop_20261003/stock-whole-image.json)
passes twelve scatter regions at 19,016,151 hook starts and the complete
1,000,000-start post-scatter budget, with outcome `budget`. Its backend remains
healthy and its final PC is `0x80000CC0`, polling unmodeled DCDC readiness.
No OLED frame or complete-boot acceptance oracle is reached. The report's
`passed:true` covers those bounded checkpoints; `completeBoot.verified` remains
false. The candidate's conditional checks do not qualify every instruction
path, final-IT-slot EXC_RETURN or host xPSR mode writes.

The public-runtime report retains 165,716 unknown reads of DCDC REG0 at `0x40080000`,
plus one read/write of REG3 at `0x4008000C`. DCDC readiness is a separate missing
peripheral model. The [USDHC contract](emulator-usdhc-contract.md) now has 25
component cases and thirteen board integration cases for explicit `sd1`/`sd2`
fixtures. These retained whole-image reports supplied no SD fixture and precede
that board integration. Stock storage remains unverified.

The [earlier repaired-runtime report](../../sp404mk2/analysis/emulator/vendor_candidate_temp_lifetime_upstream_20261003/stock-whole-image.json)
keeps its `0x80002880` frontier and failed status. Its
[original static review](../../sp404mk2/analysis/emulator/vendor_candidate_temp_lifetime_upstream_20261003/stock-frontier-static.md)
identified the then-missing oscillator behavior without captured guest bytes
or xPSR. The later model and passive observations have separate source pins.

The recorded post-oscillator run used the promoted default runtime from
`opensp`, with an explicit report path:

```powershell
node tools/test-emulator-stock.mjs --report ../sp404mk2/analysis/emulator/oscillator_stock_20261003/whole-image.json --post-scatter-instructions 1000000
```

The candidate directory must contain `unicorn-arm.js`, `unicorn-arm.wasm` and
`provenance.json`. Every listed asset is checked against its declared length and
SHA256 before session creation and after execution. The report also hashes the
provenance, firmware image, scatter reference and
emulator sources, including exception returns, oscillator, DCDC, optional
USDHC, SD fixture admission and ARM/USB2/VIDEO PLL modules. Source or asset changes make
the qualification fail. A candidate run requires `--report` and cannot replace
the default or historical report names. Any existing destination is copied to
a hash-checked history file before replacement.

The original unrepaired WASM SHA256
`f9520f9aa55299b84d005390844082a1468f26137e239eb1167dde8473aecc6c` has a
retained stock failure. The new tool refuses that exact artifact before guest
execution. This identity check also applies to a supplied candidate directory.
The current local repaired WASM is 706,188 bytes, SHA256
`399f9ca4eecc11d111d3182e251fbfb8ccc69e88f19f06650e945482eaf1a7d1`,
and can use the default asset path. Reports
describe the actual selected runtime and outcome without assigning the earlier
failure's function or cause to a new run.

The command's scatter budget is fixed at 25,000,000 counted hook starts.
Post-scatter execution accepts 1..25,000,000, defaulting to 1,000,000, in ordinary
slices of at most 250,000. Conditional blocks can retire uncounted instructions
and defer a requested stop; these work limits do not establish precise
instruction boundaries or CPU cycles. Legacy `OPENSP_STOCK_*` environment controls and unsupported
arguments are rejected. The qualification path provides no clone, custom stop
PC, cache flush, instruction patch, minimized image or adjustable tiny-slice
mode. `--help` describes the command without creating a session.

These are virtual application-startup checks. The supplied handoff does not
exercise cold ROM or resident boot, and the regression GPT clock represents
modeled scheduling rather than measured hardware timing. No physical device
transport is opened. The tool's
[39 metadata checks](../tools/emulator-evidence/stock-tool-metadata-validation-20261003.json)
executed no guest code. The ordinary whole-image run has its separate report
above. [Runtime rebuild instructions](emulator-runtime-build.md) preserve the
original artifact and require explicit selection of the exact repair.
