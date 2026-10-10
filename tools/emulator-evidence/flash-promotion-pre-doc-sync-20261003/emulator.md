# Firmware emulator

The local `/emulator/` page executes user-selected SP firmware in independent
ARM workers. The goal is a complete machine for testing stock firmware, original
firmware and USB updates in parallel. Retained reports verify R13 startup and
same-image updates, plus an actual R13-to-R14-to-R13 virtual update. An isolated
CPU candidate reaches twelve matching stock scatter regions and passes
oscillator, DCDC, ARM and VIDEO PLL setup. Stock FlexSPI behavior remains incomplete.
The published site still identifies revision `f64ec97`. This work has not been
deployed.

## Using the current build

Run `npm run dev` and open `/emulator/`. Select a local APP1 file and press Start.
The CPU engine downloads at that point. Each of up to four sessions owns its
CPU, RAM, board, flash and USB controller. Pause, instruction stepping and reset
are independent. Reset retains programmed virtual NOR and creates fresh volatile
state; replacing the file creates a new session.

The OLED comes from executed firmware GPIO transactions. The controls inject
the recorded GPIO matrix, ADC slots and UART paths. Their values are model inputs;
pressure, velocity, encoder detents and physical timing are uncalibrated. The
USB panel exchanges 64-byte HID feature reports with guest firmware and exports
bounded traces. It never opens a physical USB device. Firmware bytes stay in the
browser and are omitted from exported traces and public assets.

APP1 starts at the captured resident handoff, `0x60080001`, with incoming MSP
`0x202435B0` and BASEPRI16. It is a direct code entry, not a vector-table reset.
Full-flash input must be exactly4 MiB with a validated FCB/IVT/DCD envelope;
execution begins at its parsed resident entry with supplied post-ROM state.
ROM and DCD execution are not included. Neither path qualifies physical recovery.
ABI1 and ABI2 headers are checked at offset `0x200`, including ABI2 CRC with its
field zeroed. APP0 and oversized APP1 inputs are rejected.

## Implementation and sources

| Part | Implementation and contract |
| --- | --- |
| Image admission and hash | [image.ts](../src/lib/emulator/image.ts), [resident handoff](../../sp404mk2/RESIDENT_BOOT.md) |
| Cortex-M7 execution | [cpu.ts](../src/lib/emulator/cpu.ts), [pinned engine provenance](../public/emulator/vendor/provenance.json), [conditional-hook limits](emulator-thumb-conditional.md), [rebuild procedure](emulator-runtime-build.md) |
| GPIO, OLED, timer, UART, ADC | [board.ts](../src/lib/emulator/board.ts), [board contract](emulator-board-contract.md) |
| Crystal readiness and detection | [oscillator.ts](../src/lib/emulator/oscillator.ts), [integrated register model](emulator-oscillator.md) |
| Converter and PLL status | [DCDC](emulator-dcdc.md), [ARM PLL](emulator-pll-arm.md), [USB2 PLL](emulator-pll-usb2.md), [VIDEO PLL](emulator-pll-video.md), [AUDIO PLL](emulator-pll-audio.md) |
| Optional virtual SD fixtures | [usdhc.ts](../src/lib/emulator/usdhc.ts), [board routing and component contract](emulator-usdhc-contract.md) |
| USB controller and descriptor DMA | [usb.ts](../src/lib/emulator/usb.ts), [R13 driver](../../sp404mk2/sdk/examples/original_r13/usb_device.c) |
| FlexSPI IP transactions and NOR | [flash.ts](../src/lib/emulator/flash.ts), [R13 writer](../../sp404mk2/sdk/examples/original_r13/flash.c) |
| Exceptions and task frames | [exceptions.ts](../src/lib/emulator/exceptions.ts), [architectural scope](emulator-exceptions.md), [instruction-backed returns](emulator-exception-return.md) |
| Handoff, reset and virtual host | [session.ts](../src/lib/emulator/session.ts), [worker](../src/scripts/emulator-worker.ts) |
| Reusable browser update bridge | [worker-rpc.ts](../src/lib/emulator/worker-rpc.ts), [RPC contract](emulator-worker-rpc.md) |
| Browser interface | [page](../src/pages/emulator.astro), [controller](../src/scripts/emulator.ts), [native linked design](emulator-design.md) |

The self-hosted engine uses pinned Unicorn.js and Unicorn revisions, rebuilt
with Emscripten5.0.5. GPL license, authors and credits accompany its JS/WASM.
Build checks verify every artifact against provenance. The first build embedded
private source paths and was rejected; its rejection metadata records that the
superseded binary was not retained. The replacement maps source paths to a
public build name and passes the privacy scan.

The recorded core commit is the base Unicorn revision. The pinned wrapper's
build driver copies its QEMU5.0.1 interpreter sources, applies TCI, helper-adapter
and symbol patches, then regenerates symbol aliases. The source paths, pinned
URLs and hashes are recorded in provenance; the bundled WASM uses these
transformed sources. The current local bundle combines temporary-lifetime,
conditional-hook stop, host XPSR flag refresh and raw live M7 register repairs.
Its WASM is 706,188 bytes, SHA256
`399f9ca4eecc11d111d3182e251fbfb8ccc69e88f19f06650e945482eaf1a7d1`.
The [fresh source/build proof](../../sp404mk2/analysis/emulator/vendor_candidate_m7_host_regs_20261003/composed-build-proof.json)
pins each transformation and output. The original and single-repair runtimes
remain preserved in their separate archives. The
[latest local promotion](../../sp404mk2/analysis/emulator/vendor_candidate_m7_host_regs_20261003/local-promotion.json)
follows independent review and ordinary guest-update acceptance. These findings
do not establish the cause of every earlier trap.

Unicorn's MCLASS option replaced the selected M7 with M33 in this pinned core.
The adapter uses Thumb with explicit M7 selection and checks the actual model
before execution. The adapter queues guest-triggered DMA and NOR writes until
execution returns, then publishes memory and invalidates translated code.
Covered CPU fixtures verify DMA visibility, warmed XIP publication and slice
accounting. The [conditional qualification](emulator-thumb-conditional.md)
passes the covered stops and counts; general retirement timing remains
unqualified. A terminal WASM trap preserves the last healthy diagnostics and
requires a fresh CPU; ordinary guest fetch faults remain distinguishable.

The default fast-regression fixture advances GPT by24,000 nominal ticks per
counter read. Virtual USB lets the guest consume endpoint completion and then
requests an idle turn with a 25,000-start budget before the next control request. These choices make
the tests deterministic; they are not measured host or device intervals.
The NOR fixture exposes the measured C22016/status40 identity and SFDP profile,
synthesized FCB geometry and explicitly padded unread bytes. The chip model
permits its entire capacity so executing writers must prove their own bounds.

## Execution evidence

The [R13 integration report](../tools/emulator-evidence/r13-integration.json)
pins actual firmware SHA
`4891fd9451cd107f6f50f4fb85d75f538cf5b2eb3c7fb2680f36719b32f67e8a`,
15,396 bytes, marker `523D0001`, all relevant sources and the engine. It records
startup, five OLED frames, descriptor enumeration, HID, writer rejection/ABORT,
read-only preflight and diagnostics, a275-report RAM upload with guest CRC and
reread, four sector erases,64 page programs and16,384-byte IP readback.
A separate GET confirms state6; retained NOR reset and a new CPU reach fresh
state0 and the R13 marker. Resident and tail bytes remain intact.
This pre-oscillator report covers a same-image update and 78,850,000 counted
main-session hook starts. The promoted-runtime run took 76,661 ms while browser tests also ran;
that host measurement is not a performance baseline or SP timing. Two Node
workers independently produce different VOLUME samples and matching compiled
capture events. [Focused firmware evidence](emulator-firmware-tests.md) retains
the separate candidate runs and historical source pins.

The reusable [virtual update host](../src/lib/emulator/update.ts) requires an
exact running R13/R14/R15 profile, candidate SHA/marker, measured preflight,
guest RAM CRC, padded-sector readback, separate completion status and fresh
boot hash. The [actual R13-to-R14-to-R13 report](../../sp404mk2/analysis/emulator/vendor_candidate_temp_lifetime_upstream_20261003/r13-r14-roundtrip.json)
passes both transactions on its pre-oscillator sources in 64,814 host ms and
148,450,000 counted hook starts. It checks 20,480 bytes for R14 and 16,384 for R13,
with fresh USB markers and exact image hashes after retained-NOR resets.
R13's declared APP1 is restored; the larger R14 tail outside R13's occupied
sectors remains, so the initial whole-NOR hash is not restored.
The later [four-repair roundtrip](../../sp404mk2/analysis/emulator/vendor_candidate_m7_host_regs_20261003/r13-r14-roundtrip.json)
passes the same guest sequence on clock-integrated sources in 73,328 host ms,
with stable source/runtime pins. Its updater forwards an exact target extent,
hash and expected current hash to retained-NOR reset.
The [larger-writer host profiles](emulator-larger-writer-profiles.md) now implement
R16B/R48 identity and exact-target admission. Their 130 focused checks cover
host/reset behavior. Separate guest runs pass R16B-to-R13-to-R16B and
R48-to-R13-to-R48 in 80,639 and 80,800 host ms, each with 160,675,000 counted
starts. Both verify actual IP readback, separate completion status, fresh
identities and restored virtual NOR. Those small-image results have
[immutable receipts](emulator-larger-writer-profiles.md). Large transfers stop before USB until large guest CRC
budgets, aggregate IP-read evidence and target-specific fresh boots are qualified.

The [real browser report](../tools/emulator-evidence/browser-runtime.json)
uses production workers in isolated Canary. It verifies demand loading, actual
R13 OLED/USB, SHIFT and pad capture, independent RAM uploads and bad-image
replacement. The separate interface suite uses mocked workers for layout,
accessibility and failure controls; those tests cannot establish ARM execution.
The pre-oscillator full suite passed 157 browser tests, including five production
worker cases and 19 mocked emulator interface cases, on the repaired engine.
The retained pre-USDHC-integration model baseline passes 292 cases: the earlier
241 plus 24 isolated oscillator groups, two board-routing groups and 25
standalone USDHC groups. Thirteen new USDHC board cases pass; their combined
board/oscillator/controller check passes 94 cases. Optional `sd1`/`sd2` fixtures
now route through `SPBoard`; later session/Worker/RPC loading accepts optional
owned card bytes. The page supplies no SD controls, and no guest storage result
follows. The retained CPU
runner separately passes 12 covered groups.
The recorded pre-oscillator typecheck
covered 64 files with no errors, warnings or hints. The reusable
Worker RPC bridge has 38 injected protocol tests. A separate
[production Worker roundtrip](../tools/emulator-evidence/worker-rpc-browser-roundtrip.json)
passes actual R13-to-R14-to-R13 updates, sequential padded IP readback, separate
completion status and fresh post-reset identity through the bridge. That test
uses one unchanged production Worker on pre-clock sources. The page now consumes
the shared bridge;51 injected protocol and11 actual-controller fake-DOM groups
pass, including delayed replies, replacement races and loading/run watchdogs.
Those separate earlier browser runs cover158 distinct cases. The later
[current-build receipt](../tools/emulator-evidence/m7-runtime-and-page-qualified-20261003/receipt.json)
records165 passing Canary tests, including the production Worker roundtrip and
seven new page/RPC race checks. It uses the four-repair engine with ARM/USB2
clock routing. Type checks cover83 files with zero errors, warnings or hints;
the build uses7,903 gzip bytes for the initial emulator page,55,413 for its
demand-loaded JavaScript and706,188 raw WASM bytes. All ordinary pages remain
within15 KiB gzip. Desktop/mobile layouts and Axe checks pass in both themes.
These counts describe the tested local sources and built hashes, not a deployed
release. The [native design](emulator-design.md) records fourteen linked mains,
four responsive/theme layouts, four state examples and 80 completed footer
instances; those canvas checks do not execute firmware.
Private firmware cases require the adjacent research checkout and skip when
their input is absent. A public CI pass alone therefore cannot establish them.

The [post-oscillator whole-stock report](../../sp404mk2/analysis/emulator/oscillator_stock_20261003/whole-image.json)
executes pristine v5.52 through its own scatter loader in 19,016,148 hook starts.
All twelve destination hashes match without reconstructed-runtime substitution
or poisoned RAM. Of the requested 1,000,000 further starts, 500,001 are counted
before `UC_ERR_INSN_INVALID`/code 10 at `0x80000CCE`. The backend remains healthy,
with no active exception or OLED frame. Captured bytes `F2 D5 54 F8` match stock;
xPSR `61005C00` contains ITSTATE `5C`, inconsistent with the normal stream at
that branch. The [static review](../../sp404mk2/analysis/emulator/oscillator_stock_20261003/stock-frontier-static.md)
narrows the conditional-context mismatch without establishing its cause.
Oscillator accesses are handled; DCDC readiness remains an independent model
gap. Unknown MMIO is retained with zero overflow. The overall report remains
`passed:false`; complete stock boot, RTOS, sampler, audio and storage are
unverified. The [earlier repaired-runtime report](../../sp404mk2/analysis/emulator/vendor_candidate_temp_lifetime_upstream_20261003/stock-whole-image.json)
keeps its original `0x80002880` frontier and failed status.
[The stock procedure](emulator-stock-qualification.md) explains the checkpoint
and model limits.

The [retained benign Thumb qualification](emulator-thumb-conditional.md) passes
47 functional cases with arithmetic, flags and ordinary mapped BX/POP targets.
Its strict scheduling checks fail in 17 cases, and a separate comparison records
19 count differences. Conditional slots can retire without counted hooks, and
hook stops can allow later transfers to execute. These counts do not guarantee
retirement counts, instruction timing or interception of final-IT-slot EXC_RETURN.
The separate [source-built conditional-hook candidate](../../sp404mk2/analysis/emulator/vendor_candidate_it_hook_stop_20261003/thumb-it-qualification/qualification.json)
passes all 47 cases with their strict checks, plus twelve generic CPU cases.
Its [whole-stock report](../../sp404mk2/analysis/emulator/vendor_candidate_it_hook_stop_20261003/stock-whole-image.json)
passes twelve scatter regions at 19,016,151 hook starts and a further
1,000,000-start budget. It ends healthy at `0x80000CC0`, polling unmodeled DCDC
readiness, with no OLED frame or complete-boot oracle. These results apply to
the isolated `b1c7679e…` candidate at that checkpoint. They qualify the covered conditional hooks and bounded interval,
without establishing complete stock boot or host xPSR mode-write behavior.

The later [four-repair CPU candidate](../../sp404mk2/analysis/emulator/vendor_candidate_m7_host_regs_20261003/README.md)
also refreshes host XPSR mode flags and separates raw live M7 register access
from guest privilege restrictions. Its47 Thumb,12 CPU, four CPS and nine
host/guest/model groups pass. Separate ordinary R13/R14 acceptance now passes,
and this engine is the current local bundle. Its updated checks pass438 model
groups,13 CPU/startup groups and54 exception groups; those counts overlap.
The rejected first context guard was never built or executed.

The current [stock clock observation](../../sp404mk2/analysis/emulator/usb2_pll_stock_20261003/README.md)
uses the preceding three-repair candidate. It passes12 scatter hashes and1M
bounded later starts, showing ARM source0/divider100/LOCK and then waiting at
`0x80001138` on VIDEO PLL `0x400D80A0`. ARM/USB2 component and board routing
checks pass44 groups. USB2 retains reset controls in that stock path; its
independent coverage did not advance VIDEO startup. The mistaken address label
and earlier failed reports remain preserved. Synthetic readiness/reference
fixtures do not establish physical clock outputs or full stock boot.

The later [VIDEO whole-image report](../../sp404mk2/analysis/emulator/video_pll_stock_20261003/README.md)
uses the current four-repair runtime and stable sources with optional SD loading.
It matches12 scatter hashes and1M later starts, with VIDEO source0/divider31,
NUM0/DENOM1, synthetic LOCK and removed bypass. It ends healthy at `0x8001AFF8`
without an OLED frame. The flash model reports two commands and an unsupported
LUT/transfer-size error; the exact command sequences were not retained.
Complete stock boot remains unverified. The [SD fixture contract](emulator-sd-fixtures.md)
passes27 new finite ownership/admission/privacy/reset groups; its138 focused
checks include earlier groups and execute no guest storage code.

The [VIDEO/SD built checkpoint](../tools/emulator-evidence/video-sd-qualified-20261003/receipt.json)
passes32 focused Canary tests, including production Worker updates, and500 model
groups excluding the separate AUDIO component. Type checks cover90 files with
zero errors, warnings or hints. Initial scripts remain7,903 gzip bytes;
demand-loaded JavaScript is59,009 gzip bytes and WASM706,188 raw bytes.
That browser roundtrip supplies no card images; real optional-card transfer
passed in the separate [AUDIO/SD browser checkpoint](../tools/emulator-evidence/audio-sd-card-qualified-20261003/receipt.json).
That run retains two synthetic 256 KiB cards through initial reset and actual
R13-to-R14-to-R13 update boots, with safe metadata in 750 Worker replies and
746 observed snapshots. It executes no guest SD commands. The integrated build
passes 537 production model groups and a 93-file check with zero diagnostics;
demand-loaded JavaScript is 59,564 gzip bytes. The [AUDIO model](emulator-pll-audio.md) now routes through
the board. Its 35 component and two board groups pass, alongside strict typing
and independent source review. Ordinary firmware acceptance remains separate.

The original `f9520f9a…` runtime's [stock failure](../tools/emulator-evidence/stock-startup.json)
and [R14 reset failure](../tools/emulator-evidence/failed-updater-2026-10-03T025200-812Z.json)
remain historical failed evidence. The poisoned-RAM stock check stopped at
`0x80000402`; the first R14 update verified flash but stopped at `0x80000540`
before fresh USB readiness and issued no completed receipt. The later repaired
runs have separate reports. An earlier [unrepaired clean-build proof](../../sp404mk2/analysis/emulator/vendor_candidate_clean_20261003/retained_build/clean-build-proof.json)
resolved source-copy ambiguity while reproducing the original artifact bytes;
it did not qualify those failed firmware cases.

Eager/lazy floating-point context tests now pass54 exception groups, including
ten real M7 groups. Extended frames use104 bytes with core registers first;
S16–S31 remain software-owned. A hook-only FPSCR preparation failed because the
engine had already translated a first-use reset. Leaving execution and
retranslating the prepared instruction corrects actual positive-infinity
rounding. [The qualification record](../tools/emulator-evidence/exception-fpu-qualification.json)
pins the Arm sources and fixtures on the repaired engine. The instruction-backed
[return suite](emulator-exception-return.md) passes 45 groups, including 19 real
M7 groups, and refuses unsupported raw-token origins instead of inferring a
return from a later top-F fetch. Final-IT-slot transfer interception remains
outside that passing scope. The [pre-promotion architecture reports](../tools/emulator-evidence/pre-promoted-architecture-20261003/manifest.json)
retain their original hashes. Fault escalation, full RTOS scheduling and
physical deadlines remain open.

```powershell
npm run check
npm run build
npm run test:emulator
npm run test:emulator:firmware
node tools/test-emulator-update.mjs
npm test
```

On this Windows machine, use an isolated Canary executable for Playwright:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = Join-Path $env:LOCALAPPDATA 'Google/Chrome SxS/Application/chrome.exe'
npx playwright test --workers=4
```

This starts test-owned profiles and leaves the existing signed-in session alone.
The ordinary command requires `npm run test:install` first. Preserve exact
failure reports and rerun relevant evidence after source changes; do not
relabel an old source pin as a new pass.

## Remaining full-machine work

| Area | Required evidence |
| --- | --- |
| Stock startup and RTOS | Resolve the current FlexSPI compatibility gap, then qualify complete startup, task switches and interrupt paths from pristine bytes. Covered conditional-hook cases pass; general timing remains unqualified. |
| Floating-point context | Tested eager/lazy paths are qualified; full stock task preservation, derived faults and escalation remain open. |
| Audio and sampler | Synchronized SAI RX/TX, eDMA, slot alignment, real PCM input/output, effects, pads, patterns and recording. |
| Storage | Qualify guest use of the optional USDHC fixtures, then test SD/card images, filesystem/project/sample operations and bounded failure behavior. |
| Controller and timing | Broader BMC protocol, power/watchdog behavior, DCDC readiness, clock routing and explicit calibration limits. |
| USB families | Stock audio/MIDI, CDC, bulk/isochronous transfers, reset/reconnect and all original/custom writer protocols. |
| Firmware matrix | Extend the [qualified small-image writer profiles](emulator-larger-writer-profiles.md) to full-size targets, then qualify stock patches, synth and autotune candidates with exact identities. |
| Boot and recovery | Actual ROM/DCD/resident execution, failed-image paths and reset semantics, separated from physical recovery qualification. |
| Parallel test service | Repeatable batch/replay runs, injected failures, snapshots and evidence usable by firmware CI. |
| Website delivery | Preserve linked native layouts and matching exports; connect the qualified update bridge to product controls and obtain authorized deployment. |

Completing the R13 case does not close these requirements. Emulator results
remain separate from physical SP boot, flash endurance and recovery evidence.
The closed-enclosure and resident/APP0/fuse no-write gates remain in force.
