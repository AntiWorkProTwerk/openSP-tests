# AUDIO PLL register model

[`Rt1062AudioPll`](../src/lib/emulator/pll-audio.ts) owns the documented AUDIO
control/alias group and standalone NUM and DENOM words. The board routes only
those addresses and advances synthetic lock progress independently of GPT.
Source and finite MMIO coverage do not establish an audio waveform or a selecting
stock AUDIO wait.

The [NXP Rev3 manual](../../sp404mk2/analysis/flash_research/IMXRT1060RM_rev3.pdf),
§§14.8.8–14.8.10, printed pages 1104–1107, defines the fields. Its memory map on
printed page 1091 gives the reset words. The
[MIMXRT1062 header](../../sp404mk2/references/MIMXRT1062.h), lines 8531–8538,
9211–9252 and 9387–9400, confirms the layout and masks. These sources and the
official driver are pinned in the
[source contract](../../sp404mk2/analysis/emulator/pll_static_20261003/source-contract.json).

| Register | Address | Reset | Writable fields |
| --- | --- | --- | --- |
| AUDIO control | `0x400D8070` | `0x00011006` | `0x0019F07F` |
| SET / CLR / TOG | `0x400D8074/78/7C` | Read zero | Selected control bits |
| NUM | `0x400D8080` | `0x05F5E100` | `0x3FFFFFFF` |
| DENOM | `0x400D8090` | `0x2964619C` | `0x3FFFFFFF` |

Manual §1.5.2, printed page 25, defines the alias operations on written ones.
Aligned 1/2/4-byte accesses affect only their bus lanes. LOCK bit 31 stays
read-only through primary and alias writes. NUM and DENOM have no aliases;
the reserved ranges `0x400D8084..8F` and `0x400D8094..9F` remain unhandled.
SYS, VIDEO, MISC2 and other neighboring registers stay outside ownership.

POWERDOWN=1 prevents analog lock. DIV_SELECT supports 27..54; the literal reset
encoding 6 belongs to the powered-down state. NUM is signed 30-bit with bit 29
as its sign, and DENOM is unsigned 30-bit. Eligible parameters require
`abs(NUM) < DENOM`. Invalid fractions, zero denominator, unsupported loop
dividers and reserved reference encodings retain their bits and conservatively
hold synthetic LOCK low. Their undocumented silicon behavior is unqualified.

ENABLE, BYPASS and POST_DIV_SELECT retain output settings. Post-divider codes
0/1/2 mean divide 4/2/1; code 3 reports reserved output behavior. These fields
do not block analog lock or restart eligible progress. Output frequency,
fractional clock arithmetic and generated waveforms remain unmodeled.

The [pinned NXP AUDIO initializer](https://github.com/nxp-mcuxpresso/legacy-mcux-sdk/blob/6f3fd257cdcf978a4d26e7d6e9eed9240037422b/devices/MIMXRT1062/drivers/fsl_clock.c#L722-L800)
sets source and bypass, writes NUM/DENOM, writes MISC2, programs loop/power/output
settings, polls LOCK while bypassed, then clears bypass. Its line-752 RMW clears
only loop divider and powerdown before ORing post-divider bits. The finite
caller preserves inherited POST bits, including combinations that produce code 3.
The deinitializer writes `0x1000` to AUDIO control and leaves NUM/DENOM intact.

MISC2 AUDIO uses split bits 15 and 23, combined mask `0x00808000`. Manual
§14.8.19, printed pages 1126–1129, and header lines 10944–10978 describe them.
The SDK changes only those bits, preserving VIDEO_DIV and all unrelated fields.
Its combined AUDIO divider encodings 00/01/10/11 mean divide 1/2/1/4, also
confirmed by the [driver's frequency getter](https://github.com/nxp-mcuxpresso/legacy-mcux-sdk/blob/6f3fd257cdcf978a4d26e7d6e9eed9240037422b/devices/MIMXRT1062/drivers/fsl_clock.c#L1051-L1065).
Tests record this external MISC2
write without giving the AUDIO component ownership or producing a clock.

`lockTicks` defaults to one explicit synthetic tick. Reads and writes never
advance time. Actual loop/source/power/NUM/DENOM changes clear synthetic LOCK
and restart progress; equivalent writes preserve it. This transition policy
does not measure physical settling. Zero delay still needs an explicit tick,
including `tick(0)`. Delay and individual tick values accept integers in
`0..4294967295`; batched ticks are equivalent to smaller calls.

Fixed fixtures `reference24MAvailable` (default true), `referenceClk1Available`
(false) and `lockFailure` (false) survive reset. Stored selectors cannot create
a reference. Reset restores all three primary values and clears LOCK/progress.
Status returns independent diagnostic/configuration copies. MISC2 division,
CCM routing, oscillator coupling, SAI and DMA remain outside this component.

```powershell
node --test tests/emulator-pll-audio.test.mjs
```

The [qualification receipt](../tools/emulator-evidence/pll-audio-qualification.json)
pins the sources and finite tests. Component qualification executes no CPU
engine, guest firmware, browser or physical transport. The separate
[board qualification](../tools/emulator-evidence/pll-audio-board-qualification-20261003.json)
passes 35 component and two board groups, plus strict board typing. It checks
exact ownership, neighboring VIDEO routing, reset, ticking and retained failure
fixtures. The [pre-integration archive](../tools/emulator-evidence/board-before-audio-pll-20261003/manifest.json)
retains the original component document. Ordinary whole-image acceptance remains
separate work.
