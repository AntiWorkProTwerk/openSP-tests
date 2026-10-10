# VIDEO PLL register model

[`Rt1062VideoPll`](../src/lib/emulator/pll-video.ts) is an isolated register
component. It owns the 16-byte VIDEO control group and two fractional words,
now routed through `SPBoard`. The selecting ordinary stock reports
stop on the unknown `0x400D80A0` poll after passing their startup checkpoints;
their VIDEO write counts do not include values, so they do not establish the
stock image's exact divider or fractional parameters.

The retained [NXP Rev3 manual](../../sp404mk2/analysis/flash_research/IMXRT1060RM_rev3.pdf),
§§14.8.11–14.8.13, printed pages 1108–1111, and
[MIMXRT1062 header](../../sp404mk2/references/MIMXRT1062.h), lines 8539–8547,
9403–9444 and 9579–9592, define the map and fields.
The [source contract](../../sp404mk2/analysis/emulator/pll_static_20261003/source-contract.json)
pins these inputs and the official driver.

| Register | Address | Reset | Writable fields |
| --- | --- | --- | --- |
| VIDEO control | `0x400D80A0` | `0x0001100C` | `0x0019F07F` |
| SET / CLR / TOG | `0x400D80A4/A8/AC` | Read zero | Selected control bits |
| NUM | `0x400D80B0` | `0x05F5E100` | `0x3FFFFFFF` |
| DENOM | `0x400D80C0` | `0x10A24447` | `0x3FFFFFFF` |

Manual §1.5.2, printed page 25, defines the alias operations on written ones.
Aligned 1/2/4-byte accesses affect only their bus lanes. LOCK bit 31 remains
read-only through every primary/alias lane. NUM and DENOM have no aliases;
`0x400D80B4..BF` and `0x400D80C4..DF` stay unhandled, as do other PLLs and MISC2.

POWERDOWN=1 prevents analog lock. DIV_SELECT supports 27..54; the literal reset
encoding 12 belongs to the powered-down reset state. NUM is signed 30-bit,
with bit 29 as its sign; DENOM is unsigned 30-bit. Eligible parameters require
`abs(NUM) < DENOM`. Invalid fractions, zero denominator, unsupported divider or
reference encodings retain their actual stored bits and hold synthetic LOCK
low. That stall is conservative model policy; undocumented silicon behavior
is unqualified.

ENABLE, BYPASS and POST_DIV_SELECT retain output configuration. Post-divider
codes 0/1/2 mean divide 4/2/1; code 3 reports reserved output behavior. The manual
places this divider after the PLL and before enable/bypass. These output fields
do not block analog lock or restart a valid delay. No waveform, output frequency,
fractional clock arithmetic, CCM routing or MISC2 division is produced.

The [pinned NXP initializer](https://github.com/nxp-mcuxpresso/legacy-mcux-sdk/blob/6f3fd257cdcf978a4d26e7d6e9eed9240037422b/devices/MIMXRT1062/drivers/fsl_clock.c#L809-L878)
sets source and bypass, writes NUM/DENOM and MISC2, programs loop/power/output
settings, polls LOCK while bypassed, then clears bypass. Its line-839 RMW clears
only loop divider and powerdown before ORing post-divider bits. The finite
source-matched caller preserves that inherited-bit behavior and records the
external MISC2 write without claiming to model it.

`lockTicks` defaults to one explicit synthetic tick. Reads/writes never advance
time. Actual changes to loop divider, reference, power or either fractional
word clear synthetic LOCK and restart progress; equivalent writes preserve it.
This transition policy is not measured physical settling behavior. A zero delay
still needs an explicit `tick(0)` or later tick. Delays and individual tick counts
accept integers in `0..4294967295`; batched ticks are equivalent to smaller calls.

Fixed fixtures `reference24MAvailable` (default true), `referenceClk1Available`
(false) and `lockFailure` (false) survive reset. Register bits cannot create a
reference. Reset restores all three primary values, clears LOCK/progress and
preserves the fixtures. Status returns independent diagnostic/configuration
copies with stored and signed fractional values, reference, power/output
settings, progress and unsupported states.

```powershell
node --test tests/emulator-pll-video.test.mjs
```

The [qualification receipt](../tools/emulator-evidence/pll-video-qualification.json)
pins the model, finite MMIO tests and primary sources. Board routing has separate
evidence. The component checks execute
no firmware, engine, browser or physical transport. Root board checks pass two
additional groups for exact ownership, adjacent PLL routes, fractional reset,
GPT-independent ticking and retained failure fixtures. The combined command
passes35 groups, and strict board typing passes. The
[original component document](../../sp404mk2/analysis/emulator/pll_video_model_20261003/source/docs/emulator-pll-video.md)
remains archived with its qualification pins. The separate
[ordinary whole-stock report](../../sp404mk2/analysis/emulator/video_pll_stock_20261003/README.md)
matches all 12 scatter regions and passes VIDEO setup with divider 31,
NUM0/DENOM1, synthetic LOCK and removed bypass. Its bounded continuation ends
healthy at `0x8001AFF8` with a FlexSPI model error and no OLED frame. It qualifies
that startup progress; complete stock boot remains unverified.
