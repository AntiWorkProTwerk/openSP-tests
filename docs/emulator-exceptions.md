# Cortex-M7 exceptions in the emulator

[The dispatcher](../src/lib/emulator/exceptions.ts) uses the CPU engine's registers
and memory. Entry stacks R0, R1, R2, R3, R12, LR, PC and xPSR on the selected
Thread stack, then runs the handler on MSP. Return consumes the frame at the
current MSP or PSP, allowing an RTOS to select another task's frame. R4 through
R11 remain the firmware's responsibility. Pending exceptions can tail-chain
without unstacking the interrupted frame.

An active floating-point context extends the frame from 32 to 104 bytes.
The core registers remain at offsets `0x00..0x1c`; S0 through S15 occupy
`0x20..0x5c`, and FPSCR occupies `0x60`. The reserved word at `0x64` and any
alignment padding remain untouched. S16 through S31 stay under software
control. EXC_RETURN bit 4 selects the frame type and restores CONTROL.FPCA.
Setting FPCA manually still selects an extended frame when ASPEN is disabled.

With lazy preservation enabled, entry reserves the extension and records its
S0 address in FPCAR. The first executed FP instruction saves the interrupted
low FP state before changing it. Integer handlers can nest and return without
consuming that pending save. An unused extended return clears LSPACT and leaves
the live FP registers intact, without reading the reserved extension. Once
saved, return reads the guest frame, including any changes made by an RTOS.
Architecturally UNKNOWN caller-saved FP values are retained deterministically;
firmware cannot rely on that retention as an architectural guarantee.

The model follows the [Cortex-M7 Generic User Guide](https://documentation-service.arm.com/static/61efd6602dd99944d051417b),
sections 2.1.3, 2.3, 4.2 through 4.4 and 4.7, and the
[ARMv7-M Architecture Reference Manual, DDI 0403E.e](https://documentation-service.arm.com/static/606dc36485368c4c2b1bf62f),
sections B1.5.6 through B1.5.8, B1.6.3 and B3.2.20 through B3.2.23.
The [source ledger and qualification record](../tools/emulator-evidence/exception-fpu-qualification.json)
pin the downloaded manuals by hash and identify the relevant pages. M7 stack
alignment stays enabled. PRIGROUP, BASEPRI, PRIMASK and FAULTMASK determine
delivery. SysTick reloads on a separate source edge and coalesces pending wraps.
Interrupt count, priority bits and VTOR alignment are emulator configuration,
not a new SP hardware survey. Supplied ticks count model events; instruction
starts are not measured processor cycles or physical time.

`dispatchPending()` and `returnFromException()` run at instruction boundaries.
The [instruction-boundary handler](../src/lib/emulator/instruction-boundary.ts)
first queries deliverable pending requests. It publishes interrupt metadata
before stopping, then checks a qualified return transfer and invokes
`beforeInstruction(address, size)` last in its instruction
callback, after any decision to stop for an interrupt or return. That callback
must omit conditionally skipped instructions. The current M7 backend does so
in the retained IT/VFP test. `afterExecution()` runs after each CPU slice,
before dispatch or return, while the backend remains available. It normalizes
the backend's automatic FPCA behavior when modeled ASPEN is disabled.

The [pending-boundary promotion](../../sp404mk2/analysis/emulator/scheduling_contract_promotion_20261003/README.md)
reconsiders requests on every ordinary hook, including a request first latched
under a mask. Its immediate boundary policy is broader than Arm's guaranteed
visibility after synchronization. Thirty-eight finite fake cases cover query
ownership, metadata ordering and failure guards. The subsequent ordinary stock
run reached idle `WFI` and stopped healthy before sleep/wake was modeled.
The earlier timer-node self-link's creating event remains unproved.

At the private counter/WFI milestone, 187 fake groups and peer review passed;
production then retained the boundary model without sleep/wake.
One private write owner keeps the count of all latched pending bits, including
disabled, masked and active requests. Empty delivery checks return before CPU
access or a pending-array scan; nonempty selection and failure ordering are
preserved. Wake selection ignores PRIMASK while delivery honors it; BASEPRI,
FAULTMASK and active priorities still constrain eligible asynchronous requests.
Current wake queries cover NMI, PendSV, SysTick and enabled external requests.
Only future-event prediction is limited to enabled processor-clock SysTick.
[Private graph](../../sp404mk2/analysis/emulator/wfi_counter_composition_v2_20261003/inventory-peer-review.json).

CPU revision 3 retains two-byte WFI evidence at an exact budget, preserving
reason/count. Post-call opcode inference assumes unchanged instruction bytes
and supplies no general native halt-cause proof. Session owns sleep by CPU,
generation and resume PC; exact-budget sleep adds no idle time before the next
call. Each step allows 64 helper calls and 64 consecutive transitions without
instruction progress. Each helper advances at most 1M synthetic ticks, separate
from starts. No-event sleep advances nothing. Reset/close/replacement invalidate
ownership, and callbacks cannot publish old counters into a replacement.
Helper-v2's 70 passing cases missed its final power callback changing PC after
validation; v3 observes power before the last current-PC read and passes 79.
Observational register reads and readonly owned metadata remain API assumptions.
[CPU limitation](../../sp404mk2/analysis/emulator/wfi_contract_review_20261003/stable-code/README.md),
[helper repair](../../sp404mk2/analysis/emulator/wfi_contract_candidate_20261003/model/revision-3/README.md),
[Session](../../sp404mk2/analysis/emulator/wfi_contract_candidate_20261003/session/README.md).

The earlier private profile64 run passes 12 scatter/10M starts with model wake
accounting under CPU revision 3's unchanged-byte assumption. Its report remains
historical. The later marker revision 3 suppresses evidence for any outer native
attempt containing a nested start; only the real condition-passing two-byte WFI
helper on the selected nonsecurity M7 profile publishes. Source peer review
passes, followed by a separately sealed private native build. CPU revision 4 uses
that optional getter after existing admission guards, projects three scalars
and makes no opcode reads. Missing/malformed events leave metadata absent;
ordinary getter errors retain healthy unclassified results, while terminal
RuntimeError marks backend loss and blocks later calls. The marker identifies
helper execution; work-present returns and final native halt cause remain distinct.
[Marker](../../sp404mk2/analysis/emulator/wfi_backend_marker_candidate_20261003/revision-3/README.md),
[CPU peer](../../sp404mk2/analysis/emulator/wfi_contract_candidate_20261003/cpu/marker-revision-4/inventory-peer-review.json),
[native build](../../sp404mk2/analysis/emulator/wfi_marker_native_build_20261003/build-receipt.json).

The composed marker graph passes 209 finite groups and strict/source checks;
twelve generic CPU groups pass on the new engine with --r13 absent. The latter
suite supplies no APP1 startup or positive WFI case. A separate ordinary stock
run passes 12 scatter/10M starts with positive marker-backed continuation and
forty completed bounded observations. All prior checkpoint records match after
removing only the observation; 54 inputs stay stable. Idle totals are 145,178
quanta/87,097,411,165 paired ticks, final D96C healthy/no OLED. Those ticks establish
no hardware timing. Sampled software ticks advance while current/selected task
words become zero; intermediate task execution and complete boot remain unqualified.
[Graph](../../sp404mk2/analysis/emulator/wfi_counter_composition_v3_20261003/root-review.json),
[generic CPU](../../sp404mk2/analysis/emulator/wfi_marker_cpu_qualification_20261003/generic-cpu.json),
[actual ordinary result](../../sp404mk2/analysis/emulator/stock_marker_rtos_run_root_20261003/README.md).

The private composition retains the reviewed scheduler and marker graph/runtime.
Its separate product Worker case now continues ordinary stock Run after observed
native WFI idle work and holds stable Pause. It adds no new scatter-memory
checks, startup register getters or physical timing result. The direct-session
wait/UART observer identifies sampled semaphore reason 4/object ID 2, with zero
current UART lengths; creator, owner, timeout, cause, reuse and intermediate
activity remain unknown. Stock OLED remains blank and full boot unverified.
The marker graph and scheduler are now locally promoted with canonical model,
generic CPU, type/build, product retry, native Worker USB and stock Run/Pause
acceptance. The 168/169 product run and one focused retry cover 169 unique checks
across scopes, without a single all-pass 169-case run.
[Canonical qualification](../../sp404mk2/analysis/emulator/wfi_production_promotion_20261003/local-acceptance-receipt.json),
[product run](../../sp404mk2/analysis/emulator/wfi_canonical_browser_acceptance_20261003/execution-product/host-receipt.json), [focused retry](../../sp404mk2/analysis/emulator/wfi_canonical_mock_timeout_fix_20261003/execution-focused/host-receipt.json),
[Worker USB](../../sp404mk2/analysis/emulator/wfi_canonical_browser_acceptance_20261003/execution-usb/worker-rpc-browser-roundtrip.json), [stock Worker](../../sp404mk2/analysis/emulator/wfi_canonical_stock_continuation_20261003/execution/browser-receipt.json).
The separate canonical fixed display-ID reading matches late wait ID 2 at 37
boundaries; allocation epoch, queue membership, reuse and cause stay unknown.
The transport design remains source evidence with private model qualification
pending.
[Attribution](../../sp404mk2/analysis/emulator/stock_display_completion_id_canonical_comparison_20261003/README.md), [transport source](../../sp404mk2/analysis/emulator/stock_display_transport_source_design_20261003/README.md). WFE, wide WFI, external
sleep clocks, deep sleep and other SCR effects remain unqualified.
[Positive stock Worker](../../sp404mk2/analysis/emulator/wfi_browser_stock_continuation_20261003/actual-notes/README.md),
[sampled semaphore wait](../../sp404mk2/analysis/emulator/stock_wait_uart_run_root_20261003/README.md).

Translated engines also need `synchronizeInstructionState(address, size)` when
the hook prepares a new FP context. The pinned Unicorn translator can compile
a first-use FPSCR reset before the hook runs. Setting FPSCR in that hook alone
failed the first rounding-mode test. The CPU now leaves execution, invalidates
the stale translation and resumes with the prepared context. Retried hooks do
not add instruction starts to the budget. The retained arithmetic test checks the
result of `1 + 2^-24` under rounding toward positive infinity, so a final FPSCR
write cannot satisfy the test by itself.

Core peripheral accesses route through `readMmio()` and `writeMmio()`, including
CPACR, FPCCR, FPCAR and FPDSCR. Unowned addresses return `undefined` and `false`.
CP10/CP11 permissions are checked before FP use and eager save/restore.
Permission denial raises an explicit model error: NOCP fault delivery remains
unimplemented. Changing ASPEN/LSPEN requires disabled FP access and clear FPCA.
Scalar S-registers and FPSCR use the engine's 32-bit register API.

The session captures a qualified Handler-mode BX or PC-load instruction before
the engine executes it. The [return adapter](emulator-exception-return.md)
checks its condition, operands, source memory and strict raw token, then applies
software loads/writeback before unstacking. An arbitrary top-nibble-F fetch
error no longer triggers session recovery. The low-level `fromFetch` model
option remains for preserved register/memory checks. The current POP engine test
stops before the transfer, applies its decoded software effects and passes the
raw target to model unstack. The
[prior fetch-token test and qualification](../tools/emulator-evidence/pre-origin-pop-stop-20261003/manifest.json)
remain historical evidence; production execution uses the originating instruction.

[Integer tests](../tests/emulator-exceptions.test.mjs) and
[FP tests](../tests/emulator-exceptions-fpu.test.mjs) run together with:

```powershell
node --test tests/emulator-exceptions.test.mjs tests/emulator-exceptions-fpu.test.mjs
```

The 54 passing groups include 44 register/memory model groups and ten groups
using the real M7 WASM engine. They cover eager/lazy handlers, low FP restore,
software-owned upper FP registers, conditional skipping, FP memory and status
instructions, permission refusal and actual rounding. Model cases also cover
nested frames, tail chaining, PSP replacement, untouched reserved words and
failed lazy stores. These checks do not establish a running stock RTOS,
complete USB classes, audio or physical SP behavior.

`floatingPoint: false` preserves the initial refusal behavior. Its
[source, test and document snapshots](../tools/emulator-evidence/exceptions-integer-only/manifest.json)
remain pinned separately. The initial VFP fixture omitted a terminating loop;
translation aborted before execution and closing that backend raised another
WASM error. The corrected fixture passes, and the
[failed attempt](../tools/emulator-evidence/exception-fpu-boundary.json) remains
preserved. Instruction budgets alone do not bound all translation failures.

Late arrival, fault escalation, derived faults during FP stacking, non-base
Thread return, sleep and exclusive monitors remain outside the model.
Overlapping manually activated lazy contexts fail explicitly. AIRCR reset
actions require board reset integration. Terminal backend failures require
replacement of the CPU worker.
