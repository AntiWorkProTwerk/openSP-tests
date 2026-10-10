# DCDC register model

[`Rt1062Dcdc`](../src/lib/emulator/dcdc.ts) owns the four RT1062 DCDC registers.
Target changes clear `STS_DC_OK`; an explicit synthetic delay can set it again.
The component remains separate from `SPBoard`. Its qualification executes MMIO
tests without guest firmware or a physical device transport.

## Register contract

The retained [RT1060 Rev3 manual](../../sp404mk2/analysis/flash_research/IMXRT1060RM_rev3.pdf),
§§18.4.1,18.4.2,18.5.1, printed pages1202..1214, defines the map, resets and
access classes. The [NXP header](../../sp404mk2/references/MIMXRT1062.h) defines
the field masks. Their hashes and the pinned driver sources appear in the
[qualification receipt](../tools/emulator-evidence/dcdc-qualification.json).

| Register | Address | Reset | Writable mask |
| --- | --- | --- | --- |
| REG0 | `0x40080000` | `0x14030111` | `0x3C3F0FFF` |
| REG1 | `0x40080004` | `0x111BA29C` | `0x1FA03380` |
| REG2 | `0x40080008` | `0x00000002` | `0x18003FC0` |
| REG3 | `0x4008000C` | `0x0000010E` | `0x4100071F` |

These four adjacent words have no SET/CLR/TOG aliases. Offsets4,8 and12 are
REG1,REG2 andREG3. Aligned1/2/4-byte writes affect only the written lanes and
documented writable bits. Reserved reset bits remain unchanged, including
REG1's `0x001B801C` and REG2 bit1. Unknown addresses, unsupported widths and
unaligned accesses return unhandled for the board to record.

REG0 bit31 `STS_DC_OK` is read-only: software cannot set it, clear it or treat
it as W1C. REG0 bit29 `XTAL_24M_OK` is writable. NXP's pinned
[clock-source function](https://raw.githubusercontent.com/nxp-mcuxpresso/legacy-mcux-sdk/6f3fd257cdcf978a4d26e7d6e9eed9240037422b/drivers/dcdc_1/fsl_dcdc.c)
writes that bit for automatic selection. Its stored value establishes no
external clock availability. `XTALOK_DISABLE` and `CURRENT_ALERT_RESET` also
retain writable levels; they produce no detector status or alert interrupt.

REG3 `TRG` admits all32 encodings. `TARGET_LP` documents encodings0..4;
codes5..7 remain stored and visible as unsupported. `DISABLE_STEP` controls
target stepping. It does not block target writes: the manual describes faster
settling and possible larger overshoot when the bit is set. The SDK's wording
about locking a target does not establish a write lock.

## Synthetic settling

`settleTicks` defaults to one. Reset begins with DC_OK low; a changed TRG or
TARGET_LP clears readiness and resets elapsed settling ticks. An unchanged
target preserves pending progress or completed readiness. Changing the selected
available clock also restarts settling as an explicit model policy. Other
configuration writes retain their values without restarting target progress.

Reads and writes never advance time. `tick(n)` accepts integer abstract ticks
in `0..4294967295`; the configured delay has the same bounds. A zero-duration
delay still requires an explicit tick, including `tick(0)`. Equivalent batched
and smaller ticks produce the same state. The manual says settling depends on
load and operating mode, without supplying the model's delay. Neither ticks nor
stored targets measure physical time or output voltage.

Fixed constructor fixtures survive reset:

- `settlingFailure`, default false, holds DC_OK low.
- `converterEnabled`, default true, represents the external enable/power
  conditions assumed by this run-mode fixture.
- `internalClockAvailable`, default true, supplies a synthetic internal source.
- `externalClockAvailable`, default false, supplies an external source only when
  explicitly configured.

Forced internal selection requires an available internal fixture and
`PWD_OSC_INT=0`. Forced external selection requires its available fixture.
For automatic selection, a stored XTAL_24M_OK request selects an available
external fixture; otherwise the model falls back to the powered internal
fixture. That fallback is explicit model policy. Writing either XTAL control
cannot create an external source. Unavailable selected clocks or disabled
converter fixtures hold DC_OK low. Undocumented TARGET_LP codes also hold it
low conservatively; the manual does not define their silicon response.

Current-threshold codes6..7 appear in unsupported diagnostics. The current
detector is unmodeled, so those encodings do not change this target-settling
fixture. Other analog controls retain configuration without generating voltage,
current, ripple, protection shutdown, standby transitions, or IRQ69. The SDK's
DCM helper uses RCSCALE5 while the manual recommends4; both fit the documented
field and remain admitted.

CCGR access gating, physical supplies, PSWITCH, PMIC_ON_REQ, fuse trims and
coupling to the oscillator detector remain open integration work. The model's
literal reset values are separate from unmeasured resident-handoff state.

## API and qualification

`handles(address,width)`, `read(address,width)` and
`write(address,value,width)` use absolute addresses. Reads return unsigned
values or `undefined`; writes return false for unhandled accesses. `tick(n)`,
`reset()` and `status()` complete the API. Status copies the fixture configuration
and reports pending progress, clock selection, blocking reasons, unsupported
encodings and limits.

```powershell
node --test tests/emulator-dcdc.test.mjs
```

The29 groups pass, including a separate caller's source-matched adjustment
sequence, all TRG encodings, repeated/changed targets, protected status, exact
address boundaries, narrow writes, clock availability, reset and stalled
fixtures. Strict TypeScript checking also passes. The
[receipt](../tools/emulator-evidence/dcdc-qualification.json) pins these files,
sources and test output. Component qualification establishes no stock boot,
physical timing or electrical behavior.

Board integration should delegate only the16 owned address bytes, advance
explicit ticks independently of GPT enable, reset volatile DCDC state while
preserving the fixtures, and include DCDC status in diagnostics. Neighboring
registers must remain unknown. Clock availability needs an explicit integration
contract; a writable DCDC bit alone cannot supply it.
