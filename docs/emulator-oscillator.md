# Oscillator register model

[`Rt1062Oscillator`](../src/lib/emulator/oscillator.ts) owns two RT1062 analog
registers and their SET/CLR/TOG aliases. It models crystal power-up and frequency
detection with explicit synthetic ticks. The component is separate from the
board in its component qualification; these tests establish register behavior without executing guest firmware
or opening a physical device transport.

## Sources

The retained [RT1060 Rev3 manual](../../sp404mk2/analysis/flash_research/IMXRT1060RM_rev3.pdf)
defines aliases in §1.5.2, p25, frequency detection in §15.4.4, p1134,
MISC0 in §§14.8.17/15.6.1, pp1119..1122/1138..1141, and LOWPWR_CTRL in
§15.6.2, pp1142..1144. Its SHA256 is
`a2e342e492eded2a1d626cf955de953ca28d8db8675b10937a5176fd6f2c9200`.
The retained [NXP header](../../sp404mk2/references/MIMXRT1062.h) has SHA256
`1ee70ed9eb7f3a75ed89943dd799314e8330538f54c6990ea7d9cae96fd263aa`.

NXP's pinned [clock driver](https://raw.githubusercontent.com/nxp-mcuxpresso/legacy-mcux-sdk/6f3fd257cdcf978a4d26e7d6e9eed9240037422b/devices/MIMXRT1062/drivers/fsl_clock.c),
lines175..199, clears crystal power-down, polls power-up readiness, enables
frequency detection, polls XTALOK and disables detection. Deinitialization sets
power-down. The source file has SHA256
`669e2698ea0be01db0ac656f4ceef6106670d1f116b2da9f3b2ac961945a5eb3`.

## Register contract

| Primary register | Reset | Implemented oscillator fields |
| --- | --- | --- |
| MISC0 `0x400D8150` | `0x04000000` | Bit30 `XTAL_24M_PWD`: 1 powers down. Bit16 `OSC_XTALOK_EN`: enables detection. Bit15 `OSC_XTALOK`: read-only status. |
| LOWPWR_CTRL `0x400D8270` | `0x00004001` | Bit16 `XTALOSC_PWRUP_STAT`: read-only readiness. Bits15:14 retain the documented power-up delay encoding. |

SET, CLR and TOG occupy primary `+4/+8/+12`. Written ones select the operation;
written zeros leave the primary unchanged. All aliases read zero, as explicitly
required by §1.5.2. Their register-map rows repeat the primary reset value and
R/W designation; those rows do not establish alias readback.

Aligned 1/2/4-byte accesses affect only their written lanes. Reads return unsigned
values. Writes cannot set or clear oscillator status, even through an alias.
MISC0 bit17 remains reserved and has no error meaning in these sources.
Unknown addresses, unaligned accesses and unsupported widths return unhandled.

Other documented XTAL-view controls retain values without analog effects.
Bit31 uses the XTAL/PMU definition `VID_PLL_PREDIV`; the CCM view labels that
same-address bit reserved. Read-only RTC source bit29 remains a zero fixture.
Bandgap status bit7 also remains zero: the prose calls it status, while its
write-access diagram is inconsistent. Its frozen behavior is a scope choice.
PMU-only bits1/2 are omitted because the XTAL view reserves them.

## Synthetic transitions

Constructor options `powerUpTicks` and `frequencyDetectTicks` default to one
tick each. Reads and writes never advance time. `tick(n)` advances integer
abstract time; the configured delays and each tick argument accept
`0..4294967295`. Zero-duration phases still require an explicit `tick(0)` or
later tick. Batched ticks give the same state as equivalent smaller ticks.
Detection enabled before power-up uses only the remaining ticks after readiness.

`powerUpFailure` holds both statuses low. `frequencyFailure` permits power-up
readiness while holding XTALOK low. These fixed environmental fixtures survive
reset. They produce no invented error register.

The manual does not specify detector-disable retention or power-down clearing.
This model retains completed XTALOK after detector disable, clears it when the
detector is re-enabled, and clears both oscillator statuses on power-down.
These are explicit model assumptions. Reset restores the source register values
and restarts synthetic power-up with status low. That reset state is separate
from the unmeasured oscillator state at the resident APP1 handoff.

LOWPWR_CTRL's reset delay encoding means 0.5ms; MISC0's reset CLKGATE_DELAY
encoding means 1ms and controls release to analog-block digital logic. The
model preserves those fields but does not convert them to time, generate clock
waveforms or model PLLs, bandgap settling, power gates or clock routing.

## API and verification

`handles(address,width)`, `read(address,width)` and
`write(address,value,width)` use absolute addresses. Read returns `undefined`
and write returns `false` for unhandled accesses, leaving the caller responsible
for unknown-MMIO recording. `tick(n)`, `reset()` and `status()` complete the API.
Status includes fresh configuration data and the model limitations.

```powershell
node --test tests/emulator-oscillator.test.mjs
```

The 24 deterministic groups cover the driver sequence, tick batching, alias
reads, power-down, interrupted detection, fixed failures, status protection,
byte lanes, unsigned values, reset and the exact address boundary. The
[qualification record](../tools/emulator-evidence/oscillator-qualification.json)
pins the model, tests, contract and primary sources. This result does not
establish stock boot, physical clock timing or device behavior.

`SPBoard` now delegates these exact address lanes to the component and advances
its synthetic ticks independently of GPT enable, timer stalls or the read-driven
timer fixture. Board reset resets oscillator state while preserving configured
failure fixtures. Two board integration cases check that routing and reset,
including a neighboring register remaining unknown. Whole-stock execution has
separate reports; register integration alone does not establish its startup.
