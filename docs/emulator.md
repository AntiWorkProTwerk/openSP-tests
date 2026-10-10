# Firmware emulator

The local `/emulator/` page executes user-selected SP firmware in independent
ARM workers. The goal is a complete machine for testing stock firmware, original
firmware and USB updates in parallel. Retained reports verify R13 startup and
same-image updates, plus an actual R13-to-R14-to-R13 virtual update. The
local build reaches twelve matching stock scatter regions and passes
oscillator, DCDC, ARM, VIDEO and AUDIO PLL setup plus the modeled startup flash
status write. The qualified GPIO1/2 input model passes the former ready-pin wait.
An earlier bounded stock interval remains in a RAM timer-list insertion.
The [ordinary readbacks](../../sp404mk2/analysis/emulator/stock_list_observation_run_20261003/README.md)
show a node pointing to itself under BASEPRI protection. The earlier event that
created that state remains unknown. At the earlier pending-boundary milestone, the
[promotion](../../sp404mk2/analysis/emulator/scheduling_contract_promotion_20261003/README.md)
advanced to idle `WFI`, where the session stopped because sleep and wake were
then unimplemented. Its requested continuation failed. The current canonical
graph now passes bounded Worker WFI continuation and Pause; complete stock
boot remains open.

The visible virtual APP1 updater is applied locally. Its final checks pass
1,061 filtered Node groups, with twenty-nine retained native titles excluded,
128 Astro files with no diagnostics, and the build with eighteen existing MDX
warning messages. Build e7f53906 uses 11,507 gzip initial emulator JavaScript
bytes; the largest initial page is 12,880 and the whole site 119,050. Demand
JavaScript is 81,218 gzip bytes, including the 7,397-byte updater closure, with
706,883 raw WASM bytes.

The public File inputs and actions pass R13→R14→R13 in one Canary157 native
Worker: full padded readbacks of 20,480/16,384 bytes, state6/error0, separate
completion status and fresh state0 markers523E0001/523D0001 with target hashes.
The run retains 728 healthy statuses and 86 stable inputs in 74.1 seconds.
Declared APP1 is restored; whole NOR is not, because smaller R13 retains the
R14 tail. Thirty separate mocked-page cases pass with 44 stable inputs and
zero native requests. Four focused desktop/mobile theme views are reviewed
as readable without overflow. Sixteen native mains, four linked layouts and
eight illustrative updater states persist and export. These changes remain
local; the live site is f64ec97. No physical or deployment result follows.
[UI results](../../sp404mk2/analysis/emulator/virtual_app1_update_ui_candidate_20261003/RESULTS.md), [final qualification](../../sp404mk2/analysis/emulator/virtual_app1_update_ui_candidate_20261003/qualification.json).

The preceding twenty-target display/WFI qualification retains its 1,047
filtered groups, twelve generic CPU cases and 125 clean Astro files. The
following earlier programmatic USB and stock-browser receipts remain scoped
to build345021e5; the public updater above has its own fresh result.
[Earlier display qualification](../../sp404mk2/analysis/emulator/display_canonical_local_acceptance_20261003/qualification.json).

Fresh canonical browser USB passes R13→R14→R13 in one isolated Canary
157.0.8081.0 Worker. Full padded IP readbacks cover 20,480 and 16,384 bytes;
each update reaches state 6/error 0 with a separate completion status, then
a retained-NOR reset and fresh 523E0001/523D0001 boot. The run records 660
matching request completions, with no skipped or flaky test. Build 345021e5
and Worker f604baff bind this result to the new output. Synthetic card metadata
remains private; guest SD reads and physical USB remain unqualified.

The separate fresh stock browser check also passes. Its first WFI snapshot
has 19,789,618 starts and 64 idle quanta; subsequent progress reaches
19,806,770 starts and 320 quanta. Pause holds 19,840,346 starts unchanged for
350 ms. It retains 118 statuses and 101 stable browser inputs within the
22M-start/120-second acceptance bounds. The backend stays healthy with zero
OLED frames. These browser bounds do not establish an exact stop API or
complete stock boot.
[Fresh canonical Worker USB](../../sp404mk2/analysis/emulator/display_canonical_browser_acceptance_20261003/execution-usb/worker-rpc-browser-roundtrip.json), [stock browser receipt](../../sp404mk2/analysis/emulator/display_canonical_browser_acceptance_20261003/execution-stock/browser-receipt.json).

The longer private ordinary stock command passes twelve scatter comparisons
and 25M further starts in one hundred instruction checkpoints. Four frames
complete; the final 1,024-byte buffer has SHA a973a043, different from the
blank 5f70bf18 buffer. That digest-only report left its screen content unseen. The backend stays
healthy at 8014273C, in the source-identified finite zeroing loop. Host elapsed
time is 42,027 ms with 65 stable graph and asset inputs. Tick-work-cap events
reach 174; unsupported active eDMA channels 0 and 4 each appear once. Their
causal role remains unproved.

The child exits zero and its report passes. The original wrapper and freeze
fail because the wrapper expects one hundred full RTOS observations from an
observer capped at forty. The separate read-only admission correction passes
against forty full observations and sixty explicit zero-read checkpoint-cap
records: 600 getters, 2,560 RAM bytes and 880 scalars. It adds no guest replay
and leaves the original failed records unchanged. The fourth private 10M run
remains the earlier completed blank-frame milestone. Complete stock boot,
sampler/audio, SD and physical fidelity remain unverified.
[Private 25M report](../../sp404mk2/analysis/emulator/stock_display_transport_run_corrected_candidate_20261003/extended-25m/stock-whole-image-25m.json), [original wrapper outcome](../../sp404mk2/analysis/emulator/stock_display_transport_run_corrected_candidate_20261003/extended-25m/execution.json),
[read-only admission correction](../../sp404mk2/analysis/emulator/stock_display_transport_run_corrected_candidate_20261003/extended-25m/refined-admission.json).

A subsequent canonical browser run captures the stock firmware's changed
pixels. Review of the OLED and page captures identifies the natural SP-404
startup logo, with 564 lit pixels. Four display data transactions complete;
they do not establish four unique images. The packed canvas hash matches the
Worker and the earlier private 25M digest, a973a043. Pause holds 33,875,001
starts, four frames and the pixels unchanged for 350 ms, with a healthy backend
at sampled PC 800E2DFC. The run takes 37,060 host ms within its 60M-start and
180-second bounds, retaining 108 stable inputs and 301 statuses. The original
browser receipt's screenContentReviewed:false remains intact; the focused
results note records the subsequent capture review. This qualifies the startup
image, while complete stock UI, sampler/audio, SD and physical fidelity remain
open.
[Stock startup capture and review](../../sp404mk2/analysis/emulator/stock_display_visual_browser_candidate_20261003/RESULTS.md).

The audio source audit defines one shared eDMA owner for audio0..4 and
display6/7, four TX FIFOs/shared RX0, sixteen accesses per minor and sixty-three
minor links followed by the final major link, with DTCM admission and separate
clock/request rules. Private core V4 passes 80 controlled groups after V3's
preserved nineteen failures. Private JavaScript integration V3 passes seventeen
cases and strict typing with the real ArmCPU/Board/Session and a RecordingEngine.
Native instruction/IRQ timing, guest audio and physical fidelity remain open;
canonical audio is absent. Unsupported DMA diagnostics establish no audio-wait
cause at the sampled PC.
[Audio audit](../../sp404mk2/analysis/emulator/stock_audio_edma_source_audit_20261003/README.md), [private core](../../sp404mk2/analysis/emulator/stock_audio_edma_model_candidate_v4_20261003/finite-1/result.json), [controlled JS integration](../../sp404mk2/analysis/emulator/stock_audio_edma_integration_candidate_v3_20261003/finite-1/result.json).

The preceding WFI checkpoint retains its own 957 filtered groups, twelve
generic CPU groups and 112-file qualification. Its 168/169 product run plus
the same case's focused 1/1 retry cover 169 unique passing checks across two
scopes. The earlier private USB pass retains its previous CPU graph; it does
not qualify the corrected graph. All three failed stock frontiers and the
third trace's matched WFI after a queued device write drains remain preserved.
[Earlier WFI qualification](../../sp404mk2/analysis/emulator/wfi_production_promotion_20261003/local-acceptance-receipt.json), [earlier private USB](../../sp404mk2/analysis/emulator/display_transport_r13_r14_usb_candidate_20261003/execution/r13-r14-roundtrip.json).

The published site still identifies revision `f64ec97`. This work has not been
deployed.

## Using the current build

Run `npm run dev` and open `/emulator/`. Select a local boot APP1 file and
press Start; the CPU engine downloads then. Each of up to four sessions owns
its CPU, RAM, board, flash and USB controller. Pause, stepping and reset are
independent. Reset keeps programmed virtual NOR and applied cards while
creating fresh volatile state. Replacing the boot file starts a new session.

Optional SD1/SD2 accept local raw read-only images from256KiB through128MiB in
256KiB increments. Select cards before Start, or pause to stage changes. Apply
cards creates a replacement from the selected boot firmware and discards old
virtual flash only after successful load. Failed reads/loads preserve the old
session. Card bytes stay in the browser; traces contain safe metadata.
[SD fixture contract](emulator-sd-fixtures.md).

After starting an R13, R14 or R15 session, choose the target APP1 binary and
its package manifest in Virtual USB, then press Update virtual APP1. Marker, byte length and SHA256 come from
the manifest's `usb_marker` and `usb_install`; filenames supply no admission
identity. The page pauses its Worker and performs the existing writer checks,
upload, flash/readback, separate status and fresh boot verification. RAM
upload progress alone does not establish completion. Wait for Update and fresh boot verified
and its receipt, which is also retained by Export trace. R13→R14→R13 has actual
public-control evidence; R15 remains source/fake admission scope.

Admission errors keep the current session editable. Cancel closes that Worker
and discards its virtual flash, leaving the cached boot file for a later Start.
Other failures after image admission also close it. A successful update keeps
the verified Worker and caches the new APP1 identity for future Start; ordinary
Reset retains its programmed NOR. Advanced reports opens the existing raw
64-byte HID feature tools. No physical USB endpoint is opened.

OLED pixels come from executed firmware GPIO transactions. Panel values are
model inputs; pressure, velocity, encoder detents and physical timing remain
uncalibrated. Firmware/card bytes stay local and are omitted from public assets
and automatic updater traces. The visible updater's actual receipts and
independent mock lifecycle scope are in the [UI qualification](../../sp404mk2/analysis/emulator/virtual_app1_update_ui_candidate_20261003/qualification.json).

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
| Optional virtual SD fixtures | [usdhc.ts](../src/lib/emulator/usdhc.ts), [board routing and component contract](emulator-usdhc-contract.md), [local card admission](emulator-sd-fixtures.md) |
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
The separate [flash-model regression](../../sp404mk2/analysis/emulator/flash_stock_promotion_20261003/README.md)
passes both directions after source-qualified status-write and RX-tail changes,
in 79,870 host ms with 148,450,000 counted starts. Its source/runtime pins remain
stable; the preserved R14 tail and fresh-boot requirements remain the same.
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
owned card bytes. Those checkpoints predate the page's optional SD selectors;
no guest storage result follows. The retained CPU
runner separately passes 12 covered groups.
The recorded pre-oscillator typecheck
covered 64 files with no errors, warnings or hints. The reusable
Worker RPC bridge has 38 injected protocol tests. A separate
[earlier production Worker roundtrip](../tools/emulator-evidence/history/worker-rpc-browser-roundtrip-e25d55afc66f842d.json)
passes actual R13-to-R14-to-R13 updates, sequential padded IP readback, separate
completion status and fresh post-reset identity through the bridge. That test
uses one unchanged production Worker on pre-clock sources. The page now consumes
the shared bridge;51 injected protocol and11 actual-controller fake-DOM groups
pass, including delayed replies, replacement races and loading/run watchdogs.
Those separate earlier browser runs cover158 distinct cases. The later
[earlier-build receipt](../tools/emulator-evidence/m7-runtime-and-page-qualified-20261003/receipt.json)
records165 passing Canary tests, including the production Worker roundtrip and
seven new page/RPC race checks. It uses the four-repair engine with ARM/USB2
clock routing. Type checks cover83 files with zero errors, warnings or hints;
the build uses7,903 gzip bytes for the initial emulator page,55,413 for its
demand-loaded JavaScript and706,188 raw WASM bytes. All ordinary pages remain
within15 KiB gzip. Desktop/mobile layouts and Axe checks pass in both themes.
These counts describe the tested local sources and built hashes, not a deployed
release. The [native design](emulator-design.md) records sixteen linked mains,
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

The separate [flash-qualified stock runs](../../sp404mk2/analysis/emulator/flash_stock_ordinary_20261003/README.md)
record five successful IP commands and AUDIO source0/divider32/NUM77/DENOM100
with synthetic LOCK and removed bypass. A one-million-start continuation samples
ordinary formatting at `0x0000FB2C`; the revised ten-million interval progresses
to GPIO1 DR bit0 polling at `0x80000B6C..84`. Neither emits an OLED frame.
The earlier unsupported-command report remains unchanged.

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

The [SD page correction receipt](../tools/emulator-evidence/sd-page-diagnostics-busy-qualification-20261003.json)
records 26 controller checks and eight native component, copy and theme checks.
The original focused Canary run retained 31 passing cases and one failure:
initial hash diagnostics remained blank before the trailing matching status.
The repair publishes initial diagnostics while keeping loading controls busy;
replacement diagnostics remain private until the new session is committed.
Review also found that an old command reply could clear busy during replacement;
busy now includes candidate preparation. The repaired
[whole mocked page suite](../../sp404mk2/analysis/emulator/sd_page_repaired_mock_browser_20261003.log)
passes all 30 cases, including four SD flows and desktop/mobile Axe checks in
both themes. These tests use browser File inputs and public controls with a
mocked Worker. The later
[built-page checkpoint](../tools/emulator-evidence/sd-page-gpio-qualified-20261003/receipt.json)
passes all 170 Canary cases in one complete run, 704 model groups and 12 CPU
groups. Of the model groups, 583 cover production and 121 exercise retained
candidates. Type checks cover 101 files with zero errors, warnings or hints.
The initial page uses 9,228 gzip bytes; demand-loaded JavaScript uses 60,225,
and WASM uses 706,188 raw bytes. The new production SD test initially used an
incorrect numeric matcher; its 169-pass/one-fail full run remains preserved.
An assertion-only correction passes the affected case and the later full suite.
The [actual product SD report](../tools/emulator-evidence/sd-page-gpio-qualified-20261003/sd-page-browser-runtime.json)
verifies both local File selectors, production Worker delivery, safe metadata
and retention through reset against downloaded page/JS/WASM hashes. R13 issues
no SD commands or reads; filesystem and card-content behavior remain unqualified.

The subsequent [pending-boundary source/build qualification](../../sp404mk2/analysis/emulator/scheduling_contract_promotion_20261003/receipt-corrected.json)
passes 776 Node groups (655 production and 121 retained-candidate groups), 12
generic CPU cases and type checking of 104 files with zero diagnostics. The
default CPU command supplies no R13 startup fixture. Its build passes with 18
existing MDX directive warnings; initial scripts use 9,230 gzip bytes and the
on-demand JavaScript uses 60,315, with the same 706,188-byte WASM. The ordinary
stock continuation fails at idle WFI. Browser and actual guest USB acceptance
have not been repeated for this source, so the preceding complete product
checkpoint remains distinct.
The [CPU report correction](../../sp404mk2/analysis/emulator/scheduling_contract_promotion_20261003/REPORT_CORRECTION.md)
preserves an older saved JSON copied into the first seal. The fresh twelve-case
report comes from the retained stdout log; it pins the current engine and adds
no R13 startup result.

The later private WFI/counter composition passes 187 fake groups and independent
review:38 boundary,10 counter,36 CPU metadata,79 helper and 24 Session groups.
Strict typing passes against 29 exact dependency copies. The CPU preserves
executed-WFI metadata at an exact budget without changing the start count or
budget reason. It assumes unchanged opcode bytes and exposes no native halt-cause
oracle. Sleep ownership delays idle work until the next caller step; each step
permits 64 helper calls, each bounded to 1M synthetic ticks. PRIMASK wake and handler
delivery remain distinct. The earlier 178-group graph retains a final-power PC
guard gap missed by its passing matrix.
[Composition peer](../../sp404mk2/analysis/emulator/wfi_counter_composition_v2_20261003/inventory-peer-review.json),
[CPU limitation](../../sp404mk2/analysis/emulator/wfi_contract_review_20261003/stable-code/README.md).

The scalar-only checkpoint helper passes 74 fake groups, strict/structural checks
and peer review after rejecting its 70-case object-spread proposal. The first
actual private 10M request failed after 918,355 starts at the default 16-call work
limit; its 1,024 idle quanta/614,092,867 ticks and healthy E2DE remain preserved.
Profile 64 uses the qualified inclusive caps of 64 calls/4,096 quanta/4,096M ticks
per checkpoint. It passes 12 scatter/19,016,151 starts and 10M further starts in 40
fixed 250,000-start checkpoints, largest 63 calls. Total idle work is145,178
quanta/87,097,411,165 ticks;145,183 deliveries/145,181 returns leave active 14/15
at D96C. All 35 source/runtime pins remain stable; host time is41,185 ms. There is
no OLED or complete-boot result. These model ticks are separate from starts and
physical time; different run workloads do not isolate optimization speed.
[Runner repair](../../sp404mk2/analysis/emulator/stock_wfi_checkpoint_candidate_20261003/revision-2/README.md),
[failed 16-call report](../../sp404mk2/analysis/emulator/stock_wfi_ordinary_candidate_v2_20261003/stock-whole-image-10m.json),
[profile 64 report](../../sp404mk2/analysis/emulator/stock_wfi_ordinary_profile64_20261003/stock-whole-image-10m.json),
[exact freeze](../../sp404mk2/analysis/emulator/stock_wfi_ordinary_profile64_20261003/freeze.json).

At that checkpoint the private Worker scheduler retains 39 fake groups,
strict typing and source peer acceptance, with product execution still pending.
The later private composition and bounded Canary result are recorded below.
Native marker revision2's nested-call ownership gap remains historical. Revision 3 makes nested-start
exclusion sticky for each outer attempt and passes source peer review. The
extracted wrapper passes 17 fake groups, the mixed-root build driver 24, and CPU
marker revision 4 passes 58 plus strict/independent peer checks. The CPU uses the
optional native getter without opcode reads. Missing/malformed events leave
waiting metadata absent; final native halt cause remains distinct from helper
execution. The composed graph passes 209 groups against 29 stable dependencies.
[Marker](../../sp404mk2/analysis/emulator/wfi_backend_marker_candidate_20261003/revision-3/README.md),
[CPU peer](../../sp404mk2/analysis/emulator/wfi_contract_candidate_20261003/cpu/marker-revision-4/inventory-peer-review.json),
[composition](../../sp404mk2/analysis/emulator/wfi_counter_composition_v3_20261003/root-review.json).

The private native build passes exit 0 in 29.92 seconds and retains one outer/five
inner stages and 68 object fingerprints. WASM is 706,883 bytes, SHA5f10e3d7;
the canonical engine and production CPU were unchanged at that build milestone. The separate twelve generic
CPU groups pass on that engine with --r13 absent; this suite adds no APP1 startup
or positive WFI case. Driver's23/24 source-order oracle error and the first mise
launcher failure remain preserved beside their corrections.
[Build](../../sp404mk2/analysis/emulator/wfi_marker_native_build_20261003/build-receipt.json),
[generic CPU](../../sp404mk2/analysis/emulator/wfi_marker_cpu_qualification_20261003/generic-cpu.json).

The separate observer passes 101 finite checks, strict/syntax and source peer
review. Its loader failure and three draft repairs remain preserved. A corrected
run wrapper binds exact qualified source bytes before invocation. The actual
ordinary run passes 12 scatter/19,016,151 starts and 10M/40 fixed checkpoints with
54 stable inputs, exit 0/signalnull and 40,913 host ms. All 360 getters complete:
1,440 requested RAM bytes/520 scalars, no unavailable observation. The comparison
preserves every prior checkpoint field after removing only rtosObservation.
Native-marker idle totals are 145,178 quanta/87,097,411,165 paired model ticks;
final D96C stays healthy with no OLED. Current/selected words are 202BBD1C at 1 through 3,
then zero at 4 through 40 with switch guard one; software tick advances 0..0x2371A and both
head links equal sentinel 202BCF30 at each sample. Samples cannot exclude tasks
or list changes between reads. That nine-word run has no ready-global reads;
full boot and physical timing remain open.
[Observer](../../sp404mk2/analysis/emulator/stock_rtos_observation_candidate_20261003/README.md),
[actual stock](../../sp404mk2/analysis/emulator/stock_marker_rtos_run_root_20261003/README.md),
[comparison](../../sp404mk2/analysis/emulator/stock_marker_rtos_run_root_20261003/checkpoint-comparison.json).

The later base-ready observer passes 126 finite/strict/syntax/source checks after
an exact newline-anchor generator failure, preserved before module creation.
It adds only two fixed RAM getters/twelve bytes; the optional packed task-slot
word stays excluded. Its ordinary pristine-stock run passes 12 scatter/10M/40 with
90 stable inputs and 42,320 host ms. All 440 getters complete 1,920 requested RAM
bytes/640 scalars, and the comparison keeps all prior checkpoint fields, original
nine words, four masks and relationships exact. Index 0/bitmap 00000001 at 1 and
bitmap 20000001 at 2 and 3 give way to index 32/bitmap 0/override 0 at 4 through 40.
That supports sampled empty readiness, with cause, list integrity and activity
between samples unknown. Final D96C stays healthy with no OLED. Synthetic idle
totals remain 145,178 quanta/87,097,411,165 paired ticks, without physical timing.
The sealed report retains an inherited opcode-inference limitation sentence;
its exact CPU/runtime pins use native marker events. A separate
[metadata correction](../../sp404mk2/analysis/emulator/stock_ready_globals_run_root_20261003/evidence-correction.json)
binds both original stock reports without changing them or rerunning instructions.
[Ready observer](../../sp404mk2/analysis/emulator/stock_ready_globals_observer_candidate_20261003/README.md),
[actual readiness](../../sp404mk2/analysis/emulator/stock_ready_globals_run_root_20261003/README.md),
[comparison](../../sp404mk2/analysis/emulator/stock_ready_globals_run_root_20261003/checkpoint-comparison.json).

The private Worker composition changes three routing expressions to that
qualified graph/runtime, retaining the exact scheduler and RPC handlers.
Strict/bundle checks pass while earlier 39/209 groups are reused. In a separate
Canary 157.0.8081.0 process, the unchanged page creates a native Worker only on
Start. R13 produces 1,866 lit OLED pixels and virtual USB SP13/523D0001. Pause
stays stable; generic reset acknowledges 0 instructions, then another Start
reaches R13 in the same Worker. Four desktop/mobile light/dark views are visually
reviewed; this adds no fresh Axe or complete-suite claim. All 69 inputs stay
stable. Demand assets total 64,994 gzip JS including the client bridge and 706,883
raw WASM; initial page assets are unchanged. Full Worker updates and positive
stock WFI continuation remain outside this browser receipt.
[Worker composition](../../sp404mk2/analysis/emulator/wfi_worker_marker_composition_20261003/README.md),
[Canary result](../../sp404mk2/analysis/emulator/wfi_browser_acceptance_20261003/README.md).

The later fixed task-slot extension adds one four-byte read at 202BBD3C and
passes 141 finite groups after preserving a 140/141 harness mismatch; only the
reentry test changes, with the observer and guest loop exact. The actual pristine
stock run passes 12 scatter/10M/40 checkpoints with 120 stable inputs, 480 getters,
2,080 requested RAM bytes and 680 scalars in 40,832 host ms. Comparison preserves all
prior checkpoint fields, twelve words, four masks, relationships and first
eleven getter attempts. Packed 01000000 at 1 through 3 decodes ready; 02000000 at 4
through 40 waiting, with three priority bytes zero. Later empty readiness fields
persist. Slot reuse remains possible; wait object/cause, list integrity and
intermediate activity remain unknown. Final D96C is healthy with no OLED and
unchanged 145,178 idle quanta/87,097,411,165 paired model ticks. The current report
describes the native WFI getter correctly, preserving older metadata corrections.
[Observer 141](../../sp404mk2/analysis/emulator/stock_task_slot_observer_candidate_20261003/README.md),
[actual fixed-slot run](../../sp404mk2/analysis/emulator/stock_task_slot_run_root_20261003/README.md),
[comparison](../../sp404mk2/analysis/emulator/stock_task_slot_run_root_20261003/checkpoint-comparison.json).

The first full browser Worker update attempt fails collection before Canary or
guest work, with empty requests/stable inputs. History exclusion and explicit
ESM .mts routing repair collection without changing the protected guest body.
One actual isolated Canary 157.0.8081.0 test then passes R13-to-R14-to-R13 through
one native Worker and the canonical RPC bridge. R14/R13 image lengths 16,420/
15,396 pass full 20,480/16,384-byte IP readbacks, separate state 6/error 0 completion
and reset 0 followed by fresh 523E0001/523D0001 at 825,000/750,000 starts.
Firmware state 2/heartbeat 1 stays healthy and uncached; final R13 is paused at 1.2M.
All 82 inputs stay stable; host exit 0 has no timeout/launch/capture error.
Privacy checks cover 778 replies, 773 snapshots and one load with no failure.
Two 262,144-byte read-only synthetic cards keep reset metadata with zero guest
commands or reads. Firmware/SD bytes have no HTTP route, and physical access is
absent. Browser evidence exposes no independent whole-chip NOR comparison.
Stock WFI Worker acceptance is pending at this recorded milestone; complete stock boot remains open;
production was unchanged at that recorded milestone, and the site remained undeployed.
[Collection failure](../../sp404mk2/analysis/emulator/wfi_browser_worker_roundtrip_20261003/execution/host-receipt.json),
[actual native Worker updates](../../sp404mk2/analysis/emulator/wfi_browser_worker_roundtrip_v2_20261003/actual-notes/README.md).

The separate stock browser case now uses the unchanged page's File input,
Start/Run/Pause with one native Worker in isolated Canary 157.0.8081.0. WFI idle
evidence at 19,789,618 starts/64 quanta is followed by 19,811,058/384, adding 21,440
ordinary starts. Pause 19,865,346 remains stable 350 ms. All 92 statuses stay healthy
and 79 inputs match; observation is 9,349 host ms within its bounded acceptance.
Final OLED remains blank, 161 unknown MMIO observations with no overflow. It uses the supplied APP1
context and pinned startup source, without extra getters, IRQ/clock overrides or
repeating scatter-memory checks. Demand assets 64,994 gzip JS/706,883 raw WASM fit
the approved limits; all 15 local GETs carry no payload or firmware route. No
physical API is used. Notes verification corrected reserved PowerShell `$Host`
to `$hostReceipt` without more execution.
[Actual stock Worker](../../sp404mk2/analysis/emulator/wfi_browser_stock_continuation_20261003/actual-notes/README.md).

The later fixed wait/UART observer passes 143 finite/strict/syntax/source checks.
It adds one 8-byte fixed RAM read and one nonconsuming public `Board.status` call.
The actual pristine stock run passes 12 scatter/10M/40 checkpoints, 560 getters,
2,400 RAM bytes and 840 scalars, with 90 stable inputs and 41,448 host ms. All prior
fields/thirteen words/four masks/relationships/first twelve getters stay exact.
Early ready samples keep spec 0/ID 0; late waiting samples spec 0001F85C/ID 2.
Pristine reason 4 identifies the sampled semaphore wait. All 40 RX/TX queue lengths
are zero, without proving past traffic or a missing reply. Creator, owner,
timeout, cause, slot reuse and intermediate activity stay unknown. Healthy D96C,
no OLED and unchanged model ticks keep their timing limits. No pointer follow,
UART consumption, model response or forced IRQ is added.
[Observer 143](../../sp404mk2/analysis/emulator/stock_wait_uart_observer_candidate_20261003/RESULTS.md),
[actual wait/UART](../../sp404mk2/analysis/emulator/stock_wait_uart_run_root_20261003/README.md),
[comparison](../../sp404mk2/analysis/emulator/stock_wait_uart_run_root_20261003/checkpoint-comparison.json).
These private results establish no production promotion, complete stock boot,
filesystem, audio or physical recovery. Earlier pending stock Worker statements
retain their recorded stage; all prior seals remain unchanged.

The preceding production source passed 776 Node/12 generic CPU checks and
stopped at unsupported WFI; the 54fbe759 full browser/USB checkpoint remains historical. The separate private
direct-session R13/R14 roundtrip passes both padded-sector readbacks, separate
completion status and fresh markers. R13's declared image is restored while
R14's remaining sector stays; whole-NOR restoration is false. All 106 inputs
remain stable. That direct-session receipt establishes no Worker-driven update
or physical USB; the bounded Canary receipt above keeps its separate scope.
[Private USB result](../../sp404mk2/analysis/emulator/r13_r14_marker_graph_20261003/README.md).

The private stock and Worker runs established bounded positive continuation,
but their source routes still pointed into retained candidate folders. Promotion
copies the reviewed graph, scheduler and engine into the normal OpenSP paths.
Five Session import-prefix changes and six Worker route/vendor-URL changes
preserve donor behavior. The seven vendor files preserve their exact licensed
bytes. Image/reset admission, NOR and SD ownership, RPC/update handlers, board
models, instruction boundaries and exception-return sources stay unchanged.
The guarded runtime apply writes twenty files and skips four identical assets;
the test/README apply writes nine and skips thirty-two. All old inputs and the
Original exceptions fixture remain archived.

At the earlier WFI qualification, five canonical suites added 210 qualified finite cases. The existing 38 boundary
cases and 121 retained candidate cases stayed intact. The staging inventory
proposed 986 Node groups, but that included 29 legacy native titles. That
root run used `--test-skip-pattern='^real (M7|Cortex-M7)'`: 957 pass, zero fail
and zero reported skips. The excluded source tests remain preserved; 986 is
not a completed full-suite result. No minimized native WFI, nested-start or
EXC_RETURN reproduction is added by this qualification.

Twelve generic CPU groups passed without `--r13` or APP1 startup. Astro checked
112 files without diagnostics, and the build passed with 18 existing MDX
warnings. Its Start-loaded closure is 64,535 gzip JS bytes, including the client
bridge, plus 706,883 raw WASM bytes. Worker SHA fac86b1a and runtime SHA 5f10e3d7
identify this build; prior private browser receipts retain their original pins.
Journey's sixteen chapter exercises and demonstrations also passed their own
checks.

The promoted public driver then builds once from fresh external source/output
directories. Emscripten 5.0.5 completes in 28.2974 seconds with exit 0; six output
assets and provenance match the donor exactly. The bundle and promoted vendor
stay stable, and the output is not copied back. The older 29.92-second donor
build and initially unexecuted driver note remain historical. The current
driver README links the later result. The first canonical product run then passes 168 of 169 cases on stable sources.
Its mocked load-timeout case treats the loading label as proof that a Worker
exists, although the lazy RPC import can still be pending. The narrow test fix
awaits the actual load command before advancing the paused clock. The original
44,999 ms plus 1 ms timeout assertions stay intact; no runtime flow or build
changes. A focused single-case retry passes. These two scopes cover 169 unique
product checks; the failed first run remains intact, and no single all-pass
169-case rerun is claimed. Product visual checks retain their own evidence.

The separate canonical R13-to-R14-to-R13 Worker USB run passes full padded IP
readbacks, separate completion status and fresh reset/firmware identities.
The whole-stock product path also passes on the exact dist Worker, JS and WASM
with 87 stable inputs. One native Worker records 92 healthy statuses: WFI at
19,789,618 starts/64 idle quanta is followed by 19,811,058/384, then Pause at
19,865,346 stays stable for 350 ms. Final OLED frames remain zero. This browser
case adds no scatter-memory comparison or full-boot proof. Firmware stays local;
no physical USB or deployment occurs.
[Canonical qualification](../../sp404mk2/analysis/emulator/wfi_production_promotion_20261003/local-acceptance-receipt.json),
[product run](../../sp404mk2/analysis/emulator/wfi_canonical_browser_acceptance_20261003/execution-product/host-receipt.json), [focused retry](../../sp404mk2/analysis/emulator/wfi_canonical_mock_timeout_fix_20261003/execution-focused/host-receipt.json),
[Worker USB](../../sp404mk2/analysis/emulator/wfi_canonical_browser_acceptance_20261003/execution-usb/worker-rpc-browser-roundtrip.json), [stock Worker](../../sp404mk2/analysis/emulator/wfi_canonical_stock_continuation_20261003/execution/browser-receipt.json).

A separate read-only extension then samples four bytes at 80592238. Its module
retains 224 passing finite checks and strict typing; the positional reversal
repair remains beside a failed source preparation that preceded fake execution.
The one canonical ordinary run passes twelve scatter checks and ten million
post-scatter starts in forty observations. All 600 getters, 2,560 requested RAM
bytes and 880 scalars complete, with 149 stable inputs. The comparison preserves
every prior checkpoint field after removing only the added scalar, final getter
and exact budget increments: fifteen words, four masks, two queue lengths,
fourteen attempts and relationships remain exact.

The display completion word is zero in the first three samples and 2 in the
remaining 37, matching wait object ID 2 with semaphore-class specification
0001F85C. This supports the display-completion owner candidate at those sampled
boundaries. Numeric equality leaves allocation epoch, queue membership and
reuse unknown; the samples do not reconstruct DMA progress, IRQ delivery,
callbacks or the cause of the wait. OLED remains blank.

At the preceding attribution milestone, the private transport design followed pristine eDMA6/7 and LPSPI4, including
the stock byte lane 3 and scatter/gather terminal TCR command. Its register
behavior and firmware callback route are source-backed. At that milestone finite qualification and a separate reviewed ordinary run
were pending. That source design established no model success, stock OLED,
sampler/audio, filesystem or physical behavior.
[Actual attribution](../../sp404mk2/analysis/emulator/stock_display_completion_id_canonical_comparison_20261003/README.md), [transport source design](../../sp404mk2/analysis/emulator/stock_display_transport_source_design_20261003/README.md).
[Local promotion](../../sp404mk2/analysis/emulator/wfi_production_promotion_20261003/README.md),
[qualification](../../sp404mk2/analysis/emulator/wfi_production_promotion_20261003/local-acceptance-receipt.json).

The later private transport gate records 67 cases across separate 32/19/16
runs and strict typing over 74 files including sixteen project sources. Earlier
Board preparation/cancellation failures and incorrect eDMA reset defaults stay
retained. CR reset 400 and stock-initialized 490 are separate facts. Staged CPU
callbacks and post-await guards repair Session ownership; explicit TAP output
repairs a false qualifier rejection. Two separate eight-case Session runs and
strict checks pass. The private CPU final-attempt activity correction passes
66 controlled cases; its NodeNext context failure precedes a passing
ESNext/Bundler strict retry.

Both ordinary root runs match twelve scatter regions, then fail the requested
ten-million-start continuation after 903,895 starts (19,920,046 total) at healthy
E2DE with PendSV14 active. Each has no OLED frame, 182 shifted SPI words, 563
transport phases and no model error or diagnostic. The second retains 142
stable inputs and 703 idle quanta. Three RTOS observations are eligible; the
fourth is ineligible. The wrapper accumulates getter totals only after all forty
checkpoints complete, so its zero aggregate does not mean no getters ran.
Correcting the activity defect proved in the fake cases did not move this
actual frontier or establish its cause.

The separate private R13-to-R14-to-R13 native virtual USB run passes full
20,480/16,384-byte padded IP readbacks, state 6/error 0, separate status and fresh
state 0 markers 523E0001/523D0001. Each boot/reset produces five startup OLED
frames, with 148 stable inputs. Whole NOR is not restored: smaller R13 preserves
the R14 tail. This is a direct Session result; frontend Worker, physical USB and
deployment are outside its scope.

The private transport and CPU changes remain unpromoted. Timing, readiness and
SIN are declared model fixtures; unsupported forms park without manufactured
completion. Complete stock boot/OLED, sampler/audio, filesystem, physical timing
and recovery remain unqualified. At the two-run checkpoint, scalar stop evidence was still pending.

### Queued-write WFI correction and blank-frame qualification

The third ordinary run again matches twelve scatter regions, then fails after
903,895 further starts, or 19,920,046 total, at healthy E2DE with no OLED frame
and 81 stable inputs. Its final record has ten native attempts and three final
starts, one pending device write, no invalidation, no internal yield and a
successful drain. Explicit stop, fault, callback/backend failure, callback PC
change and configured-until guards are false. The diagnostic query matches the
approved two-byte WFI at E2DC with resume PC E2DE; the normal gate is false and
no sleep is published. This measures the queued-write classification exclusion
at that frontier. The write's address, value and origin are unrecorded; RX DMA
remains a source-backed hypothesis.

The diagnostic CPU passes 77 controlled cases and the trace helper fourteen,
each with strict typing. Their extra query admits no sleep or retry. The
separate corrected CPU passes 74 controlled cases and strict typing; the
corrected Session passes eight cases and strict typing. Normal classification
now admits matching WFI after successful device-write drain, with the other
exclusions retained.

Root executes the corrected ordinary wrapper once. Twelve scatter matches and
the full 10M continuation pass in forty checkpoints, with 600 completed getters,
2,560 RAM bytes and 880 scalars. All 68 source/import/runtime inputs remain
stable. Total starts are 29,016,151; final PC 8014274A returns for budget with a
healthy backend. Host elapsed time is 20,510 ms, not calibrated SP timing. LPSPI
shifts 1,064 words and finishes with held RX and PCS false; eDMA CR is 490, with
error and interrupt state zero.

The report first records one completed OLED frame and displayOn true. A retained
hash comparison establishes that its 1,024 bytes match the initial all-zero
buffer (SHA 5f70bf18). It is a completed blank transfer, with no demonstrated
nonblank stock UI. Diagnostics retain 42 tick-work-cap events and one active
unsupported-channel event each for eDMA channels 0 and 4. These results prove
bounded transport and instruction progress; complete stock boot, sampler/audio,
SD, physical timing and fidelity remain open.

At the fourth private-run milestone, canonical promotion was staged and the
live site was f64ec97. Its earlier private R13/R14 USB pass belonged to the
previous CPU graph. The later twenty-target application passes fresh filtered
Node, generic CPU, Astro and build checks, followed by canonical Worker USB
and bounded stock Run/Pause acceptance. These changes remain local; the live
site is f64ec97.
[Canonical qualification](../../sp404mk2/analysis/emulator/display_canonical_local_acceptance_20261003/qualification.json), [twenty-target application](../../sp404mk2/analysis/emulator/display_production_promotion_candidate_20261003/apply-receipt.json).
[Fresh canonical Worker USB](../../sp404mk2/analysis/emulator/display_canonical_browser_acceptance_20261003/execution-usb/worker-rpc-browser-roundtrip.json), [stock browser receipt](../../sp404mk2/analysis/emulator/display_canonical_browser_acceptance_20261003/execution-stock/browser-receipt.json).

### Local promotion and the extended private stock interval

The longer private ordinary stock command passes twelve scatter comparisons
and 25M further starts in one hundred instruction checkpoints. Four frames
complete; the final 1,024-byte buffer has SHA a973a043, different from the
blank 5f70bf18 buffer. That digest-only report left its screen content unseen. The backend stays
healthy at 8014273C, in the source-identified finite zeroing loop. Host elapsed
time is 42,027 ms with 65 stable graph and asset inputs. Tick-work-cap events
reach 174; unsupported active eDMA channels 0 and 4 each appear once. Their
causal role remains unproved.

The child exits zero and its report passes. The original wrapper and freeze
fail because the wrapper expects one hundred full RTOS observations from an
observer capped at forty. The separate read-only admission correction passes
against forty full observations and sixty explicit zero-read checkpoint-cap
records: 600 getters, 2,560 RAM bytes and 880 scalars. It adds no guest replay
and leaves the original failed records unchanged. The fourth private 10M run
remains the earlier completed blank-frame milestone. Complete stock boot,
sampler/audio, SD and physical fidelity remain unverified.
[Private 25M report](../../sp404mk2/analysis/emulator/stock_display_transport_run_corrected_candidate_20261003/extended-25m/stock-whole-image-25m.json), [original wrapper outcome](../../sp404mk2/analysis/emulator/stock_display_transport_run_corrected_candidate_20261003/extended-25m/execution.json),
[read-only admission correction](../../sp404mk2/analysis/emulator/stock_display_transport_run_corrected_candidate_20261003/extended-25m/refined-admission.json).

A subsequent canonical browser run captures the stock firmware's changed
pixels. Review of the OLED and page captures identifies the natural SP-404
startup logo, with 564 lit pixels. Four display data transactions complete;
they do not establish four unique images. The packed canvas hash matches the
Worker and the earlier private 25M digest, a973a043. Pause holds 33,875,001
starts, four frames and the pixels unchanged for 350 ms, with a healthy backend
at sampled PC 800E2DFC. The run takes 37,060 host ms within its 60M-start and
180-second bounds, retaining 108 stable inputs and 301 statuses. The original
browser receipt's screenContentReviewed:false remains intact; the focused
results note records the subsequent capture review. This qualifies the startup
image, while complete stock UI, sampler/audio, SD and physical fidelity remain
open.
[Stock startup capture and review](../../sp404mk2/analysis/emulator/stock_display_visual_browser_candidate_20261003/RESULTS.md).

[Third trace](../../sp404mk2/analysis/emulator/stock_display_transport_run_trace_candidate_20261003/stock-whole-image-10m.json), [corrected CPU](../../sp404mk2/analysis/emulator/stock_transport_cpu_drained_write_candidate_20261003/README.md), [Session qualification](../../sp404mk2/analysis/emulator/stock_display_transport_run_corrected_candidate_20261003/qualification.json),
[fourth ordinary result](../../sp404mk2/analysis/emulator/stock_display_transport_run_corrected_candidate_20261003/stock-whole-image-10m.json).
[Diagnostic qualification](../../sp404mk2/analysis/emulator/stock_transport_cpu_stop_provenance_candidate_20261003/README.md), [helper qualification](../../sp404mk2/analysis/emulator/stock_display_transport_run_trace_candidate_20261003/qualification.json),
[prepared source snapshot](../../sp404mk2/analysis/emulator/stock_display_transport_run_corrected_candidate_20261003/prepared-source-freeze.json), [actual execution freeze](../../sp404mk2/analysis/emulator/stock_display_transport_run_corrected_candidate_20261003/freeze.json).

[Model](../../sp404mk2/analysis/emulator/stock_display_transport_model_candidate_20261003/README.md), [CPU fixtures](../../sp404mk2/analysis/emulator/stock_transport_cpu_final_attempt_candidate_20261003/README.md), [Session 1](../../sp404mk2/analysis/emulator/stock_display_transport_run_candidate_20261003/qualification.json), [Session 2](../../sp404mk2/analysis/emulator/stock_display_transport_run_candidate_v2_20261003/qualification.json),
[first stock failure](../../sp404mk2/analysis/emulator/stock_display_transport_run_candidate_20261003/stock-whole-image-10m.json), [second stock failure](../../sp404mk2/analysis/emulator/stock_display_transport_run_candidate_v2_20261003/stock-whole-image-10m.json), [private virtual USB](../../sp404mk2/analysis/emulator/display_transport_r13_r14_usb_candidate_20261003/execution/r13-r14-roundtrip.json).
[Reset and cancellation correction](../../sp404mk2/analysis/emulator/stock_display_transport_source_design_20261003/CORRECTIONS.md).

### The updater reaches the public controls, October 3, 2026

The qualified virtual writer previously required programmatic commands. Binary
and package-manifest fields now drive that bridge from the public page, with
RAM upload progress, later verification phases and a completed receipt. A
format follow-up keeps cached verified APP1 bytes in APP1 mode without retiring
the updated Worker; thirty-two controller cases pass. Admission errors keep
the current session editable. Cancel or later admitted failures close the
owned Worker and discard its virtual flash. R15 remains source/fake admission
coverage, with actual updates qualified separately for R13/R14.

Preparation exposes several mistakes. The first driver replaces a placeholder
in a comment and leaves the actual JSON unresolved; the corrected load reuses
the helper. A 1e-6 tolerance then repairs a floating-point fitting guard. API
text matches while four desktop glyphs and two existing dark USB headings
remain stale on canvas; a one-pixel size change and restoration refresh them.
The first Astro run finds an implicit-any message listener, corrected with a
MessageEvent annotation. Structural tests first fail three stale counts, then
one strengthened state-bounds check because hidden inherited buttons enter
the export. Ancestor-visibility filtering fixes the export without changing
geometry or relaxing visible bounds. Its first reverse guard refuses before
writes because the predicate also appears in layout export; a state-scoped
guard passes. These failures remain preserved in the focused results note.

The final qualification passes 1,061 filtered groups, 128 clean type files and
the build. Reload/export retains sixteen mains, four linked layouts and eight
new illustrative updater states, with twelve unrelated mains exact. The actual
public R13→R14→R13 case passes in one native Worker with 728 healthy statuses,
86 stable inputs, full padded readbacks, separate completion statuses and fresh
markers/hashes. Thirty mock cases pass separately with no native requests.
Four focused theme/size views and two full-page captures are reviewed; the
full-page skip-link offset remains a capture artifact. The declared APP1 is
restored while smaller R13 retains R14's tail. Complete stock boot, sampler,
audio and SD remain open. These changes remain local; the live site is f64ec97.
[UI results and preserved corrections](../../sp404mk2/analysis/emulator/virtual_app1_update_ui_candidate_20261003/RESULTS.md), [final qualification](../../sp404mk2/analysis/emulator/virtual_app1_update_ui_candidate_20261003/qualification.json).

### Shared audio DMA and controlled integration, October 3, 2026

The startup logo qualifies an early screen, leaving the remaining stock
behavior open. Pristine stock and NXP sources define the audio extension as
part of the existing global eDMA bank. Audio channels0..4 share ERQ, INT, ERR,
priorities and reset with display6/7. Four SAI1 TX FIFOs and the existing RX0
endpoint use sixteen accesses per minor. Linked sixty-four-minor descriptors
issue sixty-three minor links and only the final major link. Buffer admission
must include mapped DTCM alongside SDRAM; independent clock gates and explicit
external-clock/word fixtures govern progress. These sources supply no causal
evidence that the sampled PC waits for audio.

Private review first finds display-eligibility and sticky interrupt cancellation
gaps, then an old reset-then-throw callback entering fresh diagnostics. V3 checks
ownership before classifying that error. Its actual run passes61/80 and fails19,
while strict typing and all51 retained display groups pass. Signed JavaScript
bitmasks compare unequal to positive0x90000000. V4 changes only two comparisons
to unsigned values; the unchanged eighty cases then all pass, with strict0,
no skips and24 stable inputs. This is controlled core qualification.

The first integration preparation remains unexecuted after review finds caller
fixture ownership acquired only after a loader await. V2 takes its owned copy
before that await; all17 runtime cases pass, but a private Board class passed
to the canonical display binder causes strict exit2, so aggregate qualification
fails. V3 copies the binder's unchanged body/fixtures with private Board type
routing. The same17 cases and strict typing pass. Actual JavaScript ArmCPU queue
and drain, Board IRQ levels and Session lifecycle run with a RecordingEngine;
they execute no native ARM/WASM or guest firmware. Stock audio, architectural
IRQ timing, physical rate/routing and full sampler behavior remain unqualified.
The first ordinary audio run now passes twelve scatter hashes and 25 million
post-scatter starts in one hundred checkpoints, preserving 58 input pins in
69.495 seconds. Four completed frames retain the reviewed startup-logo digest.
Audio DMA remains zero: channels 0/4 are refused, all TX counters stay zero and
RX fills to 32. Stock CR 0x490 exposes V4's blanket EMLM guard, which the earlier
reset-CR controlled cases missed. This supplies no cause for incomplete boot.

NXP's plain-count form on printed pages 119/120/158 permits EMLM with both minor-offset
enables clear. Private V5 passes 82/82 controlled cases and strict typing while
retaining offset-enabled refusal. V4 JavaScript integration passes 17/17 and
strict typing with unchanged bodies and stable sources. These controlled cases use a RecordingEngine; the subsequent ordinary guest
results are separate evidence.

The corrected graph then passes a separate ordinary run: twelve scatter
hashes, 25 million post-scatter starts and one hundred checkpoints complete in
61.842 seconds on 59 stable inputs and 32 graph sources. The backend is healthy
at 44,016,151 total starts, sampled PC 0x801425C0. RX records 1,759,209 words;
TX lanes record 1,759,174/1,759,172/1,759,170/1,759,168. The first three link
counters each record 1,717 major and 108,233 minor links. Blocked channels and
eDMA errors are absent; the sole transport diagnostic is 42 tick-work-cap events.
One completed 1,024-byte OLED frame is blank, digest 5f70bf18, compared with the
first run's four logo transactions. Both original results remain preserved.
[Second ordinary result](../../sp404mk2/analysis/emulator/stock_audio_edma_whole_stock_candidate_v2_20261003/RESULTS.md).

A separate slotTicks 128 comparison completes the same twelve scatter hashes
and 25M/100 budget in 88.669 seconds on 65 stable pins and 32 graph sources.
RX records 756,359 words; TX lanes record 756,368/756,367/756,367/756,367.
The first three link counters each record 738 major and 46,536 minor links.
Exception deliveries and returns both total 3,263. Four OLED transactions
complete with final logo digest a973a043, restoring the retained logo outcome.
Blocked channels and eDMA errors remain absent, while tick-work-cap records
1,365,375 events. This diagnostic count remains a limitation of bounded work.
The healthy backend still totals 44,016,151 starts; sampled PC 0x00002F90 and
these counters do not establish full boot or the cause of the earlier blank frame.
[Clock128 result](../../sp404mk2/analysis/emulator/stock_audio_edma_clock128_candidate_20261003/RESULTS.md).

The twelve-target audio integration and six-target browser preset are now
applied locally. The preset uses synthetic slotTicks 128 only for the exact
pristine v5.52 APP1 hash; reset selects fixtures again for the current admitted
image. The joint qualification retains 99 controlled cases, 1,112 selected
Node passes and 137 clean Astro files. Its build records 85,704 gzip bytes of
on-demand JavaScript and 706,883 raw WASM bytes. The new public Worker passes
R13 to R14 to R13 flash/readback, separate status and fresh boot-marker checks
in 71.612 seconds with 90 stable pins. Declared APP1 is restored; the whole NOR
is not restored because the smaller R13 image leaves a trailing R14 region.
[Local qualification](../../sp404mk2/analysis/emulator/audio_canonical_site_qualification_20261003/stock-browser-qualified.json).

The first wider Node run passed 1,099 cases and failed 13 because three retained
VM Worker harnesses did not stub the added preset import. Their exact import
routes and fixtures were corrected with all case bodies and assertions retained.
The focused 57 and full 1,112-case retries pass. The first host wrapper also
omitted the actual Worker pin and expected excluded native test titles to appear
as TAP skips. The corrected retry records 173 stable pins including that Worker;
excluded titles are omitted from the counts, with zero TAP skips.
[Retained failure and correction](../../sp404mk2/analysis/emulator/stock_audio_edma_canonical_filtered_suite_20261003/RESULTS.md).

The public stock-preset browser run now passes Start, Run and Pause in a fresh
owned Canary 157 with one native Worker. It reaches 38,450,001 starts in 83.218
seconds. Four OLED data transactions produce the retained SP-404 logo, with 564
lit pixels; the packed canvas matches the delivered Worker framebuffer.
Transactions may repeat an image. Under synthetic slotTicks 128 and sixteen
zero input words, RX reaches 714,508 and TX reaches
714,517/714,516/714,516/714,516. DMA errors and blocked channels are zero.
Audio counters, instruction count, frame count and rendered pixels remain
unchanged across the 350 ms Pause check.
[Stock browser result](../../sp404mk2/analysis/emulator/stock_audio_edma_browser_stock_candidate_20261003/RESULTS.md).

The separate controls V3 model now passes its first pure Node qualification:
124/124, including 110 retained cases and fourteen added cases, with zero
failures, skips, cancellations or todos. The run takes 0.297 seconds, captures
24,224 bytes and preserves 22 source/candidate rows. The original preparation
freeze and source-review notes remain unchanged; the later
[result](../../sp404mk2/analysis/emulator/stock_controls_model_candidate_v3_20261003/RESULTS.md)
and output freeze record the actual run.

V1 was held before execution because nested ticks could resume an older IRQ
continuation and callback exceptions could leave the model active. V2 corrected
those boundaries, but source review then found stale snapshot getters after
reset-return and unbounded HC copying. Neither earlier candidate ran. V3 checks
ownership immediately after callbacks, after each declared field read and after
numeric coercions. It reads at most four HC indices, with no object spread or
iterator traversal. [V1 finding](../../sp404mk2/analysis/emulator/stock_controls_model_candidate_20261003/SOURCE_REVIEW.md),
[V2 finding](../../sp404mk2/analysis/emulator/stock_controls_model_candidate_v2_20261003/SOURCE_REVIEW.md),
[V3 review](../../sp404mk2/analysis/emulator/stock_controls_model_candidate_v3_20261003/SOURCE_REVIEW.md).

These cases exercise the pure peripheral model and a fake WFI adapter. Its
supplied wake flag and readonly fake PC execute no ARM instructions. The private
Board/Session binding is being staged and remains unqualified. Its
[ticket correction](../../sp404mk2/analysis/emulator/stock_controls_board_session_binding_plan_20261003/TICKET_ADDENDUM.md)
preserves the CPU for diagnostics after fault or power-off while retiring both
peripheral owners; reset, close and creation failure release the captured CPU.
Review and qualification of that private binding under controlled callbacks
are the next check.

The [DWT plan](../../sp404mk2/analysis/emulator/dwt_source_plan_20261003/PLAN.md) retains twelve
source pins; the plan itself stages no model or tests. On October 4, the separate
[counter candidate](../../sp404mk2/analysis/emulator/dwt_model_candidate_20261003/README.md) now passes
53/53 pure cases with zero failures, cancellations, skips or todos: 0.233 seconds,
10,733 captured bytes, empty stderr and fourteen stable source rows, preparation
freeze and Node executable. Its additive
[result](../../sp404mk2/analysis/emulator/dwt_model_candidate_20261003/RESULTS.md) preserves the
original source-preparation status. The declared deterministic fixtures use CTRL
capability `0x0D000000`, gates initially off, zero for the UNKNOWN reset value,
zero reads with retained writes while TRCENA is disabled, and delivered WFI
ticks in the synthetic Board domain. Instruction/WFI, Pause, GPT and replacement
cases use supplied calls and qualify no actual Board/Session/browser wiring.
The actual enable caller, inherited state, hardware capability and physical
timing remain unknown. The saved 1,476 unknown reads supply no boot-cause
evidence. Guest SD filesystem access, architectural control IRQ
delivery, full boot, PCM fidelity, physical timing and sampler behavior remain
unqualified. The [original controls contract](../../sp404mk2/analysis/emulator/stock_controls_source_plan_20261003/source-contract.json)
keeps the source-defined ISR DONE0/mux and PIT0-trigger correction reachable.

[First ordinary result](../../sp404mk2/analysis/emulator/stock_audio_edma_whole_stock_candidate_20261003/RESULTS.md),
[EMLM audit](../../sp404mk2/analysis/emulator/stock_audio_edma_model_candidate_v5_20261003/EMLM_AUDIT.md),
[V5 core](../../sp404mk2/analysis/emulator/stock_audio_edma_model_candidate_v5_20261003/finite-1/result.json),
[V4 integration](../../sp404mk2/analysis/emulator/stock_audio_edma_integration_candidate_v4_20261003/finite-1/result.json).
[Source audit](../../sp404mk2/analysis/emulator/stock_audio_edma_source_audit_20261003/README.md), [V3 core failure](../../sp404mk2/analysis/emulator/stock_audio_edma_model_candidate_v3_20261003/finite-1/result.json), [V4 core pass](../../sp404mk2/analysis/emulator/stock_audio_edma_model_candidate_v4_20261003/finite-1/result.json),
[V2 integration failure](../../sp404mk2/analysis/emulator/stock_audio_edma_integration_candidate_v2_20261003/finite-1/result.json), [V3 controlled integration](../../sp404mk2/analysis/emulator/stock_audio_edma_integration_candidate_v3_20261003/finite-1/result.json).

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
| Stock startup and RTOS | The twenty-target canonical display/WFI graph passes fresh local qualification and Worker USB/Run/Pause acceptance. Complete stock startup and task switches, the earlier timer self-link's creator, and general timing remain unqualified. |
| Floating-point context | Tested eager/lazy paths are qualified; full stock task preservation, derived faults and escalation remain open. |
| Audio and sampler | [Clock128](../../sp404mk2/analysis/emulator/stock_audio_edma_clock128_candidate_20261003/RESULTS.md) passes 12scatter/25M/100 with linked DMA and four logo transactions; retain the earlier DMA0/logo and slot8/blank results. Zero eDMA errors coexist with 1,365,375 tick-work-cap events. The locally active exact-stock-hash preset128 is synthetic and reselected on reset. [Local qualification](../../sp404mk2/analysis/emulator/audio_canonical_site_qualification_20261003/stock-browser-qualified.json) passes 99 controlled/1112 Node/137 Astro/build/public USB; the [public stock browser](../../sp404mk2/analysis/emulator/stock_audio_edma_browser_stock_candidate_20261003/RESULTS.md) passes 83.218s/38,450,001 starts/four logo transactions/564 lit pixels with Worker/canvas equality, RX714508/TX714517,714516,714516,714516 and zero DMA errors/blocks. Pause remains stable for 350ms. Controls V3 passes 124 pure cases; review and qualify the private Board/Session binding, which is being staged, and guest SD filesystem access separately. The separate DWT counter passes 53 pure fixture cases; actual Board/Session wiring, startup state and physical timing remain unqualified. Physical timing/routes, PCM, complete boot, effects, pads, patterns and recording remain unqualified. |
| Storage | Page SD1/SD2 selectors supply owned read-only card images through the [USDHC contract](emulator-usdhc-contract.md). Qualify guest card reads, filesystem/project/sample operations and bounded failure behavior. |
| Controller and timing | Broader BMC protocol, power/watchdog behavior, DCDC readiness, clock routing and explicit calibration limits. |
| USB families | Stock audio/MIDI, CDC, bulk/isochronous transfers, reset/reconnect and all original/custom writer protocols. |
| Firmware matrix | Extend the [qualified small-image writer profiles](emulator-larger-writer-profiles.md) to full-size targets, then qualify stock patches, synth and autotune candidates with exact identities. |
| Boot and recovery | Actual ROM/DCD/resident execution, failed-image paths and reset semantics, separated from physical recovery qualification. |
| Parallel test service | Repeatable batch/replay runs, injected failures, snapshots and evidence usable by firmware CI. |
| Website delivery | The linked visible APP1 updater passes [actual public R13/R14 and30 mock cases](../../sp404mk2/analysis/emulator/virtual_app1_update_ui_candidate_20261003/qualification.json). Preserve native exports and obtain authorized deployment; the live site remains f64ec97. |

Completing the R13 case does not close these requirements. Emulator results
remain separate from physical SP boot, flash endurance and recovery evidence.
The closed-enclosure and resident/APP0/fuse no-write gates remain in force.
