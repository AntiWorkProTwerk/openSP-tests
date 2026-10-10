# Whole-stock qualification

[`test-emulator-stock.mjs`](../tools/test-emulator-stock.mjs) runs the complete,
unmodified stock v5.52 APP1 from the adjacent firmware repository. Its pinned
SHA256 is `4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80`.
The image executes its own copy, decompression and zero-region startup. The host
observes the source checkpoint `0x60080622` and checks all twelve destinations
against [`memory_map.json`](../../sp404mk2/analysis/v552/memory_map.json).
Reconstructed runtime files are never loaded into the session.

The ordinary path uses the session's initial RAM and supplied APP1 handoff.
The [static handoff check](../../sp404mk2/analysis/emulator/stock_rtos_observation_candidate_20261003/handoff-source-check.json)
source-qualifies R0=60080001 for the captured normal resident branch, which
preserves incoming VTOR. Model VTOR zero remains an assumption; the retained
contract harness uses synthetic 12340000. Stock entry overwrites R0 and writes
VTOR zero at 6008002E before scatter. No seed changed, and complete inherited
state/startup equivalence remains unqualified.
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
47 functional cases but fails 17 strict scheduling checks in its earlier retained
`20261003c` report; a separate comparison records 19 count differences.
Each stock report records separate `scatter.passed` and
`boundedExecution.passed` results, the actual stopping phase, PC, backend state,
exception status, display hash, unknown MMIO and its overflow count. A successful
budget interval leaves `completeBoot.verified` false. Stock UI startup, RTOS task
behavior, storage and audio still need acceptance checks of their own. Peripheral
backing memory can allow execution beyond an unsupported access; unknown MMIO
therefore remains part of the evidence even when the interval completes.

The earlier [flash-qualified whole-image reports](../../sp404mk2/analysis/emulator/flash_stock_ordinary_20261003/README.md)
pass all 12 scatter comparisons and separate one-million/ten-million ordinary
intervals on the four-repair runtime. Five recorded guest IP commands complete
without errors, and AUDIO selects divider32 with NUM77/DENOM100 and synthetic
LOCK. Forty passive register checkpoints show progression through formatting
to GPIO1 DR bit0 polling. No OLED frame or complete-boot oracle is reached.
The [covered conditional-hook cases](emulator-thumb-conditional.md) now pass all
47 strict cases on the current runtime; general retirement timing remains
unqualified. The reports below retain their earlier runtime pins and outcomes.

The later [GPIO-qualified run](../../sp404mk2/analysis/emulator/gpio_read_promotion_20261003/README.md)
matches 12 scatter regions after 19,016,151 starts and completes a ten-million
continuation in 8,187 host ms. It passes the former ready-pin wait, remains
healthy with stable sources/runtime and emits no OLED frame. The last 36 samples
are in `sub_D902` at `0x0000D912..D922`, a RAM timer-list insertion. The
[source review](../../sp404mk2/analysis/emulator/gpio_read_promotion_20261003/list-frontier-static/README.md)
verifies that region and BASEPRI protection in its caller. Pending PendSV and
SysTick alone do not prove missed delivery. That report contains no list-field
or live-mask readbacks. The [GPIO contract](emulator-gpio-read.md) records the per-pad mask
correction and its 49 finite cases.

The separate [ordinary observation run](../../sp404mk2/analysis/emulator/stock_list_observation_run_20261003/README.md)
passes the same scatter and ten-million-start interval in 8,008 host ms. All
forty earlier architecture/counter records match. At the thirty-six eligible
paused checkpoints, the local [observer](../tools/stock-list-observation.ts)
adds four mask/control registers and 54 distinct RAM bytes, within its 66-byte
ceiling. The head points to the insertion node, whose next and previous links
point to itself. Equal unsigned deadline comparisons keep traversal on that
node. BASEPRI is `0x60`, PRIMASK/FAULTMASK zero and CONTROL `0x06`, with PendSV14
and SysTick15 pending and two delivered/two returned exceptions throughout. The event that created
the self-link remains unknown, and no complete boot or device result is proved.

The observer follows no links or callbacks and adds no guest execution or
writes. Its caller binds the same healthy paused CPU to exact pristine-image
identity, twelve matching scatter regions and a completed ordinary 250,000-start
slice before reading mapped RAM. All existing checkpoints and their exception
metadata remain recorded. [Thirty-four finite fake checks](../../sp404mk2/analysis/emulator/stock_list_observation_integration_20261003/qualification.json)
and strict typing qualify the local tool; it is outside the product Worker.
The separate [scheduling source review](../../sp404mk2/analysis/emulator/scheduling_contract_review_20261003/README.md)
finds incomplete pending-request reconsideration after synchronization. The
[later promotion](../../sp404mk2/analysis/emulator/scheduling_contract_promotion_20261003/README.md)
reconsiders pending exceptions at each ordinary instruction boundary. Arm's
synchronization guarantees and that model policy remain distinct. The private
candidate passes 38 fake checks; production checks then pass 776 Node groups,
12 generic CPU cases and type checking of 104 files. No causal account of the
earlier self-link's creation is established.

The promoted source's [ordinary stock report](../../sp404mk2/analysis/emulator/scheduling_contract_promotion_20261003/stock-whole-image-10m.json)
retains `passed:false`: twelve scatter regions match after 19,016,151 starts,
then the requested ten-million-start continuation stops after 769,179. The
backend remains healthy and paused at `0x0000E2DE`, with PendSV14 active, four
delivered/three returned exceptions and none pending. No OLED frame appears;
sources/runtime remain stable. Total host time is 24,102 ms. Retained pristine
bytes and source bind that next PC to the preceding `WFI` at `0x0000E2DC`, in
the scheduler's idle path. The CPU treats the implicit backend return as stopped,
and the session advances no board/SysTick time afterward. WFI sleep/wake and a
cheaper empty-pending query are being qualified separately. This source/build
promotion has no fresh browser or actual R13/R14 update acceptance; the preceding
704 Node/12 CPU/170 Canary checkpoint retains its original scope and pins.

The separate private WFI/counter graph passes 187 fake groups, strict typing and
peer review. Its scalar-only checkpoint helper passes 74 fake groups and
strict/structural checks after an object-spread reporting gap in the 70-case
proposal. The caller requests only remaining starts and reserves 64 quanta/64M
synthetic ticks before each public step. It retries only matching quantum-limit
pauses; future-event/no-event sleep and other stops remain stopped.
[Composition](../../sp404mk2/analysis/emulator/wfi_counter_composition_v2_20261003/inventory-peer-review.json),
[runner](../../sp404mk2/analysis/emulator/stock_wfi_checkpoint_candidate_20261003/revision-2/README.md).

The first actual private run retains passed:false after 12 scatter comparisons
at 19,016,151 starts and 918,355 post-scatter starts. Its fourth checkpoint is
partial 168,355. The default 16-call checkpoint allowance exhausts at 1,024 idle
quanta/614,092,867 ticks, with a healthy paused E2DE,1,029 deliveries/1,028 returns,
none pending and no OLED. Its 37 source/runtime pins stay stable; 6,711 ms is host time.
This is an explicit caller work-limit stop, without a native fault or no-event
sleep. [Failed default report](../../sp404mk2/analysis/emulator/stock_wfi_ordinary_candidate_v2_20261003/stock-whole-image-10m.json).

Profile 64 changes only the bounded caller profile to the qualified inclusive
caps:64 calls, 4,096 quanta and 4,096,000,000 ticks per checkpoint. The same pristine
image, scatter validation and 10M-start interval pass in 40 fixed 250,000-start
checkpoints; the largest uses 63 calls. Final PC is0x0000D96C, healthy and paused,
with PendSV14/SysTick15 active,145,183 delivered/145,181 returned and none pending.
Separate idle totals are 145,178 quanta/87,097,411,165 ticks. All 35 source/runtime
pins remain stable. Host time is41,185 ms. No OLED frame or complete-boot oracle is
reached; synthetic idle ticks establish no hardware time, and different workloads
do not isolate scan cost.
[Profile 64 report](../../sp404mk2/analysis/emulator/stock_wfi_ordinary_profile64_20261003/stock-whole-image-10m.json),
[freeze](../../sp404mk2/analysis/emulator/stock_wfi_ordinary_profile64_20261003/freeze.json).

That earlier profile64 run uses the private 187-case graph and existing repaired
engine. Its CPU inference assumes unchanged executed bytes and supplies no
general native halt-cause proof. The retained marker revision 2 source had a
nested native-call ownership gap. Those sources/reports keep their original scope.

The later marker revision 3 passes source review, and its private five-repair
engine compiles successfully. CPU revision 4 uses the optional native getter
without opcode reads; the private graph passes 209 finite groups/strict/source
review against 29 dependencies. Twelve generic CPU groups pass on the new engine
with --r13 absent; they add no APP1 startup or positive WFI case.
[Native build](../../sp404mk2/analysis/emulator/wfi_marker_native_build_20261003/build-receipt.json),
[graph](../../sp404mk2/analysis/emulator/wfi_counter_composition_v3_20261003/root-review.json),
[generic CPU](../../sp404mk2/analysis/emulator/wfi_marker_cpu_qualification_20261003/generic-cpu.json).

The passive nine-word observer passes 101 finite/strict/syntax checks and source
peer review after preserving its loader failure and three draft findings. The
actual private ordinary run passes 12 scatter/19,016,151 starts and the same 10M
continuation in 40 completed 250,000-start slices, exit 0/signalnull. All 54 inputs
stay stable. Its 360 getters complete 1,440 requested RAM bytes/520 scalars with
no unavailable sample. Every earlier checkpoint record matches after removing
only the new observation. Idle totals are 145,178 quanta/87,097,411,165 paired
ticks; final D96C is healthy, no OLED, host 40,913 ms. These are model ticks and
observed starts, without physical timing or general native halt-cause proof.
[Actual report](../../sp404mk2/analysis/emulator/stock_marker_rtos_run_root_20261003/stock-whole-image-10m.json),
[execution freeze](../../sp404mk2/analysis/emulator/stock_marker_rtos_run_root_20261003/freeze.json),
[checkpoint comparison](../../sp404mk2/analysis/emulator/stock_marker_rtos_run_root_20261003/checkpoint-comparison.json).

Current/selected task words are 202BBD1C at checkpoints 1 through 3, then zero at 4 through 40 with
switch guard one while software tick advances 0..0x2371A. Both head links equal the
202BCF30 sentinel at every sample; idle suppression/PRIMASK/FAULTMASK stay zero.
The samples show empty fixed timer heads, without excluding intermediate tasks
or list changes. Selected zero does not establish an empty ready set. Selection
loss and the preceding formatted-output path need source review.
[Run scope](../../sp404mk2/analysis/emulator/stock_marker_rtos_run_root_20261003/README.md).

The later [source-only bootstrap review](../../sp404mk2/analysis/emulator/stock_marker_initial_task_readiness_plan_20261003/README.md)
binds sampled 202BBD1C initially to slot 1/inittsk, entry 1103D/priority 1/stack
0x800; later reuse remains possible. The selection change is bounded only by
the 250,000-start interval between samples 3 and 4. Shared formatter PCs do not
identify their indirect output callback or prove a blocking operation. Ready
removal has several source routes. An indefinite wait can self-link its task
timer without global insertion, so empty sampled heads are compatible with a
blocked task. At that source-only seal, the [twelve-byte ready plan](../../sp404mk2/analysis/emulator/stock_marker_initial_task_readiness_plan_20261003/source-plan.json)
has no implemented observer or added guest read. The later private implementation
passes 126 finite/strict/syntax/source checks after preserving a generator's
CRLF/LF anchor failure before module creation. It adds two fixed RAM getters and
excludes the optional task-slot word.
[Observer qualification](../../sp404mk2/analysis/emulator/stock_ready_globals_observer_candidate_20261003/README.md).

The new actual ordinary run passes 12 scatter at 19,016,151 starts and 10M in 40 fixed
checkpoints, with 90 stable inputs and 42,320 host ms. All 440 getters/1,920 requested
RAM bytes/640 scalars complete. Comparison keeps every prior checkpoint field,
the original nine words/four masks/relationships and first nine getter attempts
exact. Checkpoint 1 is index 0/bitmap 00000001/override 0; checkpoints 2 and 3 are
index 0/bitmap 20000001/override 0. Checkpoints 4 through 40 are index 32/bitmap 0/
override 0, source-consistent empty readiness bookkeeping. Cause, list integrity
and intermediate task activity remain unknown, and priority bits establish no
task count or identity. Final healthy D96C/no OLED and 145,178 idle quanta/
87,097,411,165 paired model ticks retain their timing limits. The sealed report's
inherited opcode-inference sentence is preserved; exact CPU/runtime pins use
native marker events. The separate [metadata correction](../../sp404mk2/analysis/emulator/stock_ready_globals_run_root_20261003/evidence-correction.json)
records both report bindings without new execution.
[Actual ready-globals result](../../sp404mk2/analysis/emulator/stock_ready_globals_run_root_20261003/README.md),
[comparison](../../sp404mk2/analysis/emulator/stock_ready_globals_run_root_20261003/checkpoint-comparison.json).

The separate fixed task-slot observer adds only 202BBD3C, a four-byte word.
Its first 140/141 finite result preserves a reentry-harness mismatch; corrected 141
cases pass with the observer/guest runner unchanged. The actual ordinary run
passes 12 scatter/10M/40 checkpoints, 480 getters/2,080 requested RAM bytes/680
scalars, 120 stable inputs and 40,832 host ms. All prior fields/twelve words/four
masks/relationships/first eleven getter attempts remain exact. Packed 01000000
at 1 through 3 decodes state 1 ready; 02000000 at 4 through 40 state 2 waiting. All three
priority bytes are zero, and later empty readiness fields persist. Fixed-slot
reuse remains possible, with no wait object/cause, list integrity or intermediate
activity established. Final healthy D96C/no OLED and unchanged synthetic idle
totals keep their timing limits. This report uses correct native WFI metadata;
older sealed reports/corrections remain intact.
[Observer 141](../../sp404mk2/analysis/emulator/stock_task_slot_observer_candidate_20261003/README.md),
[actual task-slot result](../../sp404mk2/analysis/emulator/stock_task_slot_run_root_20261003/README.md),
[comparison](../../sp404mk2/analysis/emulator/stock_task_slot_run_root_20261003/checkpoint-comparison.json).

The subsequent wait/UART extension passes 143 finite checks, strict typing,
syntax and source review. One fixed 8-byte RAM getter and one nonconsuming public
`Board.status` call retain the wait-specification value, object ID and current
RX/TX queue lengths. The actual ordinary pristine run passes 12 scatter/10M/40,
560 getters/2,400 RAM bytes/840 scalars, 90 stable inputs and 41,448 host ms. Comparison
preserves all preceding fields, thirteen words, four masks, relationships and
first twelve getter attempts. Early ready samples have spec 0/ID 0; late waiting
samples spec 0001F85C/ID 2. Pristine descriptor reason 4 identifies a sampled
semaphore wait. UART lengths are zero at all forty samples, without cumulative-
traffic or missing-reply proof. Creator, owner, timeout, cause, reuse and
intermediate activity remain unknown. No pointer is followed or UART drained.
Final healthy D96C/no OLED and synthetic idle totals retain their timing limits.
[Actual wait/UART](../../sp404mk2/analysis/emulator/stock_wait_uart_run_root_20261003/README.md),
[comparison](../../sp404mk2/analysis/emulator/stock_wait_uart_run_root_20261003/checkpoint-comparison.json).

A separate private product Worker case uses the built page's File input,
Start/Run/Pause to execute the complete stock APP1. Ordinary Run adds 21,440 starts
after the first observed native WFI idle work, and Pause stays exact 350 ms.
One isolated Canary/native Worker produces 92 healthy statuses with 79 stable
inputs, no OLED and 161 unknown MMIO/no overflow. This browser acceptance does
not repeat the twelve scatter-memory checks, add register getters or establish
full boot. The supplied APP1 context remains source-bound. R13/R14 Worker USB
has its separate readback/reset scope. Local WFI source promotion now passes
957 filtered Node groups, twelve generic CPU cases without R13 startup, 112 clean
type files and the build. The original product run passes 168/169 and the focused
load-clock repair passes one case; 169 unique checks are covered across scopes,
without a single all-pass 169-case run. Separate canonical native Worker USB and
whole-stock Run/Pause pass on exact built assets, preserving blank OLED and
unverified complete boot.
[Canonical qualification](../../sp404mk2/analysis/emulator/wfi_production_promotion_20261003/local-acceptance-receipt.json),
[product run](../../sp404mk2/analysis/emulator/wfi_canonical_browser_acceptance_20261003/execution-product/host-receipt.json), [focused retry](../../sp404mk2/analysis/emulator/wfi_canonical_mock_timeout_fix_20261003/execution-focused/host-receipt.json),
[Worker USB](../../sp404mk2/analysis/emulator/wfi_canonical_browser_acceptance_20261003/execution-usb/worker-rpc-browser-roundtrip.json), [stock Worker](../../sp404mk2/analysis/emulator/wfi_canonical_stock_continuation_20261003/execution/browser-receipt.json).

The separate canonical fixed display-ID observer completes forty observations,
600 getters, 2,560 RAM bytes and 880 scalars, with 149 stable inputs, after twelve
scatter checks and the full 10M continuation. All prior fields/fifteen words/
four masks/two queue lengths/relationships/fourteen attempts stay exact. The
numeric display completion word is zero at samples 1 through 3 and 2 at 4 through
40, matching wait ID 2 at the later 37 boundaries. This supports the display-
completion owner candidate, without epoch, queue membership, reuse or blocking-
cause proof. The source eDMA6/7-LPSPI4 design includes byte lane 3 and the
scatter/gather terminal command; its private model has no qualified result yet.
Complete stock boot/OLED, storage, audio and physical recovery remain open.
[Canonical attribution](../../sp404mk2/analysis/emulator/stock_display_completion_id_canonical_comparison_20261003/README.md),
[source transport](../../sp404mk2/analysis/emulator/stock_display_transport_source_design_20261003/README.md).
[Positive stock Worker](../../sp404mk2/analysis/emulator/wfi_browser_stock_continuation_20261003/actual-notes/README.md),
[native Worker USB](../../sp404mk2/analysis/emulator/wfi_browser_worker_roundtrip_v2_20261003/actual-notes/README.md).

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
transfer interception remain unqualified on that earlier runtime.

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
node tools/test-emulator-stock.mjs --report ../sp404mk2/analysis/emulator/stock_next_ordinary/whole-image.json --post-scatter-instructions 10000000
```

The candidate directory must contain `unicorn-arm.js`, `unicorn-arm.wasm` and
`provenance.json`. Every listed asset is checked against its declared length and
SHA256 before session creation and after execution. The report also hashes the
provenance, firmware image, scatter reference and
emulator sources, including exception returns, oscillator, DCDC, optional
USDHC, SD fixture admission, GPIO reads and ARM/USB2/VIDEO/AUDIO PLL modules. Source or asset changes make
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
