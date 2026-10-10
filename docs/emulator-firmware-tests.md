The retained pre-oscillator [R13 machine report](../tools/emulator-evidence/r13-integration.json)
passes the complete same-image update and reset sequence on the promoted repaired
runtime, WASM SHA256
`16599c54af6da32ecce2ce52538890610a83c96e1152796ddffa2533d6440b35`.
It records 78,850,000 code-hook starts across the main session's two CPU lifetimes.
The run took 76,661 ms while browser tests also ran. That host duration is not a
performance baseline or SP timing. The separate
[candidate R13 run](../../sp404mk2/analysis/emulator/vendor_candidate_temp_lifetime_upstream_20261003/r13-integrated-return.json)
passed with the same reported hook count in 40,487 host ms before promotion. Each report
retains its actual source, runtime and firmware pins.

These counters describe observed engine hooks. The retained
[Thumb conditional qualification](emulator-thumb-conditional.md) passes 47
functional cases but fails 17 strict scheduling checks in its `20261003c`
report, with 19 count differences in a separate comparison. Passing conditional
slots can retire without their callbacks; a hook stop can allow later transfers
to execute. Exact retirement counts, timing and final-IT-slot EXC_RETURN
interception were unqualified on the earlier `16599c54…` runtime. The separate
[isolated conditional-hook candidate](../../sp404mk2/analysis/emulator/vendor_candidate_it_hook_stop_20261003/thumb-it-qualification/qualification.json)
passes all 47 cases with strict checks and twelve generic CPU cases. These
results cover their fixtures. The current local four-repair runtime incorporates
that hook repair plus host XPSR and live M7 register corrections. Its
[separate R13/R14 roundtrip](../../sp404mk2/analysis/emulator/vendor_candidate_m7_host_regs_20261003/r13-r14-roundtrip.json)
passes on clock-integrated sources with stable runtime/source pins, in73,328
host ms and148,450,000 counted starts. It forwards exact reset-target hashes
and extents, verifies20,480/16,384-byte guest IP readback and fresh markers.
The [promotion record](../../sp404mk2/analysis/emulator/vendor_candidate_m7_host_regs_20261003/local-promotion.json)
preserves the previous local bundle; this work remains undeployed.

The later [built-site qualification](../tools/emulator-evidence/m7-runtime-and-page-qualified-20261003/receipt.json)
passes165 Canary tests, including actual production Worker updates through the
shared bridge, page replacement/delayed-status cases and both-theme responsive
checks. The receipt preserves its built hashes and earlier reports before later
clock or storage changes. All private firmware inputs were present.

The preserved R13 image is 15,396 bytes, with SHA256
`4891fd9451cd107f6f50f4fb85d75f538cf5b2eb3c7fb2680f36719b32f67e8a`.
Its own startup reaches the mailbox and five decoded OLED frames. Its compiled
USB handler receives 275 DATA reports, checks transport CRC and rereads staged
RAM. Its writer executes from RAM, erases four sectors, programs 64 pages and
compares 16,384 bytes through FlexSPI IP reads. A separate GET retains state 6/error 0.
A model power cycle preserves NOR, boots the exact stored R13 bytes and returns
fresh marker `523D0001`/state 0. Two actual Node worker threads separately exercise
VOLUME values, ADC scans and firmware capture events. Resident and tail bytes
stay intact; unknown MMIO and overflow remain zero.

The reusable updater's retained pre-oscillator run passes the
[actual R13-to-R14-to-R13 roundtrip](../../sp404mk2/analysis/emulator/vendor_candidate_temp_lifetime_upstream_20261003/r13-r14-roundtrip.json).
R14 is 16,420 bytes, SHA256
`b8e582ce74fb28b209dc9b14eccc9c175745bcb20648efe0ca9a0053c9e92695`,
marker `523E0001`. Both running writers report a 65,536-byte capacity and accept
the exact target ABI1 image. The host requires source-specific preflight,
guest CRC and padded-sector comparison, then a separate state 6/error 0 status.
Passive NOR observations independently check 20,480 IP-read bytes for R14 and
16,384 for R13, erase/page bounds, padding and preservation outside target sectors.
Each retained-NOR reset reaches fresh USB state 0 and the target mailbox marker
and image hash. Pre-reset diagnostics are retained and empty. The run passes in
64,814 host ms and 148,450,000 counted hook starts across three CPU lifetimes.

The final declared APP1 bytes and hash match R13. Returning to the smaller image
preserves the additional R14 sector outside R13's occupied sectors, so
`wholeNorRestored` remains false. This is the executed writer's bounded policy;
the report does not claim restoration of the initial whole-NOR hash.

The [first repaired-candidate changed-image run](../../sp404mk2/analysis/emulator/vendor_candidate_temp_lifetime_20261003/r14-integration.json)
separately passes R13-to-R14 in 66,733 host ms. It uploads 294 DATA reports,
verifies 20,480 bytes and reaches fresh R14 marker `523E0001` after reset.
The existing virtual NOR missing-WEL injection produces the compiled driver's
error 14 before any erase or program. ABORT, fresh preflight and complete
reupload recover before the successful flash. This bounded model failure case
does not establish interrupted physical programming or recovery.

The earlier [37,015-ms R13 report](../tools/emulator-evidence/r13-integration-2026-10-03T030026-250Z.json)
and [older same-image history](../tools/emulator-evidence/r13-integration-2026-10-03T020503-886Z.json)
retain their original runtime and source hashes. The original unrepaired WASM
`f9520f9a…` failed during fresh R14 startup after verified flash. Its
[frontier summary](../tools/emulator-evidence/r14-update-frontier-20261003T025229Z.json)
still links both failed runs and remains `passed:false`; no return transaction
was attempted in those runs. The later successes have separate reports. They
do not establish a firmware or physical-device defect, or prove the cause of
the historical engine traps.

The current default checks are:

```powershell
node --experimental-strip-types tools/test-emulator-firmware.mjs
node --experimental-strip-types tools/test-emulator-firmware.mjs --update-r14
node --experimental-strip-types tools/test-emulator-update.mjs
```

Both machine tools accept `--runtime-dir` for an isolated local asset directory
containing `unicorn-arm.js`, `unicorn-arm.wasm` and `provenance.json`. Asset
lengths and hashes must match provenance and are checked again after execution.
Candidate runs require an explicit separate `--report` destination and preserve
the default R13 report. The selected factory is forwarded to both real worker
threads. Existing successful destination reports are archived before replacement.
The immutable original unrepaired artifact is refused for another R14 run;
runtime identity is kept separate from the current published-default identity.
The [runtime build procedure](emulator-runtime-build.md) explains qualification
and hash-checked promotion.

The [updater contract](emulator-update-contract.md) describes mandatory snapshots,
readback and separate completion status. The reusable
[Worker RPC bridge](emulator-worker-rpc.md) has 38 injected protocol cases and a
separate passing pre-clock [production browser roundtrip](../tools/emulator-evidence/history/worker-rpc-browser-roundtrip-e25d55afc66f842d.json).
That case uses one unchanged built Worker, observes sequential 20,480/16,384-byte
padded IP readback and separate completion GET reports, then confirms fresh
target markers and hashes after retained-NOR resets. It exercises the reusable
bridge through test-only source modules. The page now consumes that API;
51 injected RPC and11 actual-controller fake-DOM groups pass, while updated
built browser acceptance passes in the later165-test checkpoint linked above. Browser traces attest the executed readback path rather than
exposing raw NOR for the Node harness's independent byte comparison.
The earlier full browser suite passed 157 cases, with this one additional
roundtrip case passing separately. Those 158 distinct passes precede oscillator
integration; the later four-repair build has its separate165-test receipt.

The retained pre-USDHC-integration model baseline passes 292 cases, including 24 isolated
[oscillator groups](emulator-oscillator.md), two board-routing groups and 25
[standalone USDHC groups](emulator-usdhc-contract.md). Thirteen new board cases
qualify explicit SD fixtures; the combined board/oscillator/controller command
passes94 cases. Later [session/Worker admission](emulator-sd-fixtures.md) supplies
optional owned card images; the page has no card input, and the
whole-firmware receipts above precede this board integration. The
[pre-integration source snapshot](../tools/emulator-evidence/usdhc-board-pre-integration-20261003/manifest.json)
retains their exact board pin. The [larger-writer proposal](emulator-larger-writer-profiles.md)
pins R16B/R48 image policies and the static reset-length finding; larger host
profiles now pass130 focused host/reset tests. Exact full
targets remain blocked before BEGIN until large CRC/pump, complete readback
observation and target-specific fresh boot are qualified.

The [post-oscillator whole-stock report](../../sp404mk2/analysis/emulator/oscillator_stock_20261003/whole-image.json)
passes all twelve scatter hashes, then stops at `0x80000CCE` with code10 and a
healthy backend. Captured stock bytes `F2 D5 54 F8` and xPSR `61005C00`/ITSTATE
`5C` establish the reported conditional-context mismatch without identifying
its mechanism. DCDC readiness remains a separate model gap. The
[isolated candidate whole-stock report](../../sp404mk2/analysis/emulator/vendor_candidate_it_hook_stop_20261003/stock-whole-image.json)
separately passes twelve scatter regions at 19,016,151 hook starts and a further
1,000,000-start budget. It ends healthy at `0x80000CC0` waiting on DCDC readiness,
with no complete-boot oracle. This is a bounded checkpoint pass on candidate
WASM `b1c7679e…`, with no full stock UI, RTOS, sampler or storage claim. The
[ordinary stock qualification](emulator-stock-qualification.md) preserves the
earlier reports and keeps complete stock boot unverified.

The later [flash-model promotion](../../sp404mk2/analysis/emulator/flash_stock_promotion_20261003/README.md)
passes 28 production MMIO groups and an actual R13-to-R14-to-R13 regression in
79,870 host ms, with stable source/runtime pins and fresh boot identities. Its
separate [ordinary stock reports](../../sp404mk2/analysis/emulator/flash_stock_ordinary_20261003/README.md)
complete modeled clock/status-write setup and reach GPIO1 bit0 polling without
an OLED frame. Those reports retain full-boot and GPIO-input limits.

The subsequent [GPIO-integrated regression](../../sp404mk2/analysis/emulator/gpio_read_promotion_20261003/r13-r14-roundtrip.json)
passes the R13/R14/R13 update in 75,198 host ms and 148,450,000 counted starts,
with actual 20,480/16,384-byte IP readback, separate completion status and fresh
identities. Its smaller-image return retains the R14 tail. The
[built-page checkpoint](../tools/emulator-evidence/sd-page-gpio-qualified-20261003/receipt.json)
passes all 170 Canary cases, including real product SD File inputs and the
production Worker update bridge. Both cards retain metadata across resets and
update boots; these guests perform no SD reads. The preserved first full run
failed the new SD test's numeric assertion; an assertion-only correction passes
the affected case and the later complete suite.

The checkpoint's twelve-case CPU report did not select `--r13`. Its broad scope
label mentions APP1 startup, but that optional case is absent from this run.
The separate browser reports establish executed R13 OLED/USB behavior. The
101-file Astro check has zero diagnostics; the successful build retains the
known MDX directive warnings recorded in its log.

All of these checks use virtual USB and NOR. APP1 starts at the captured resident
handoff, with source-built firmware executing its uploaded startup bytes. Cold
ROM boot, physical USB, electrical timing, cache coherence, flash endurance,
interrupted programming and audio-route behavior remain unverified.
