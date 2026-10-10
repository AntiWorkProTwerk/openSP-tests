# GPIO1/2 read contract

GPIO1/2 DR now selects stored output data or the supplied input sample according
to GDIR. Enabled GPIO inputs therefore return the same sample through DR and
PSR. Writes and SET/CLEAR/TOGGLE aliases preserve the output latch even while a
pin is an input. The existing ready, matrix and encoder values remain synthetic
fixtures; they do not identify physical signal timing or electrical behavior.

The implementation is [gpio-read.ts](../src/lib/emulator/gpio-read.ts), wired
into [board.ts](../src/lib/emulator/board.ts). Its primary contract is the pinned
[NXP RT1060 Rev.3 manual](../../sp404mk2/analysis/flash_research/IMXRT1060RM_rev3.pdf):
section 12.5.1, printed page 957, and sections 12.6.1.2 through 12.6.1.4,
pages 959 through 962. An output DR read returns its latch. An input DR read
returns the routed input sample, or zero when the input path is disabled.
PSR returns the supplied routed sample independently of direction.

GPIO1/2 routing also checks each pad's ALT5 mux selection and the ordinary-bank
bits in GPR26/27. Sections 11.3.27 and 11.3.28, page 371, select GPIO1/2 rather
than GPIO6/7. The [public field fixture](../tests/fixtures/gpio12-mux-fields.json)
binds all 64 pad layouts to manual sections/pages and retained NXP header lines
and hashes. Tests require no private repository, source PDF or firmware file.

## The field-width correction

The first candidate passed 44 finite groups but used one three-bit mux mask for
every pad. Independent source review found that this falsely reduced ALT13 to
ALT5 on wider fields. GPIO_AD_B0_00 through 08, 12 and 13 have three-bit fields;
the other 53 scoped pads have four-bit fields. The promoted revision uses the
correct mask per pad. The first proposal's source, pass and rejection remain in
the [revision history](../../sp404mk2/analysis/emulator/gpio_read_candidate_20261003/revision-2/README.md).

The [49-group suite](../tests/emulator-board.test.mjs) preserves the preceding
expected values and adds checks for all 64 layouts, all 16 written low-field
values with and without SION, mapped DR/PSR routing, preserved output latches
and scoped lookup guards. Independent review reran all 49 groups and strict
typing before promotion. Production qualification also passes all 49 groups
and strict typing; the
[promotion receipt](../../sp404mk2/analysis/emulator/gpio_read_promotion_20261003/promotion.json)
records the source and import transformations.

Section 12.6.1, page 958, supports 32-bit GPIO accesses only. Existing byte and
halfword GPIO tests verify retained browser-adapter compatibility, with no
hardware access-width claim. SION electrical loopback, synchronization wait
states, GPIO clocks, settling and debounce remain unmodeled. GPIO3 through
GPIO9 are outside this read contract. The remaining pad samples retain their
existing fixtures, including latch-derived output levels.

## Ordinary firmware evidence

The [unmodified stock 10M report](../../sp404mk2/analysis/emulator/gpio_read_promotion_20261003/stock-whole-image-10m.json)
passes all 12 scatter comparisons after 19,016,151 reported code-hook starts
and completes another 10,000,000 starts in ordinary 250,000-start slices. Its
sources and runtime stay stable, with a healthy backend and zero OLED frames.
It advances beyond the former GPIO1 bit 0 gate. The final 36 checkpoints lie in
`0000D912..0000D922`, an ordered RAM timer-list insertion routine. This is a
different source path from the earlier GPIO wait; full stock boot is unverified.

The [source review](../../sp404mk2/analysis/emulator/gpio_read_promotion_20261003/list-frontier-static/README.md)
maps the captured instructions to pristine TCM bytes. List links and actual
mask-register values are absent from the report, so a self-link, cycle or cause
remains unproved. Its caller raises BASEPRI during the insertion; pending
exceptions alone do not establish missing delivery. A source-derived passive
plan records bounded list fields and masks after ordinary slices. This region
does not justify adding another peripheral model.

The [actual R13→R14→R13 virtual update](../../sp404mk2/analysis/emulator/gpio_read_promotion_20261003/r13-r14-roundtrip.json)
passes both firmware update legs, including separate status, padded-sector IP
readback and fresh post-reset markers. It reports 148,450,000 code-hook starts
and 75,198 host milliseconds with stable sources and runtime. The restored APP1
matches R13; the whole NOR retains the recorded intermediate tail. These are
virtual firmware results, without physical-device or cold-boot proof.
