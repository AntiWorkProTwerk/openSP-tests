# ARM PLL register model

[`Rt1062ArmPll`](../src/lib/emulator/pll-arm.ts) owns the 16-byte ARM PLL
control group at `0x400D8000`, routed through `SPBoard` with an independent
`armPll` fixture and status. Component tests execute deterministic MMIO callers;
ordinary firmware execution has its own report below.

The retained [NXP manual](../../sp404mk2/analysis/flash_research/IMXRT1060RM_rev3.pdf)
defines reset `0x00013063`, LOCK status and control fields in §14.8.1,
printed pages 1093..1094. §1.5.2, page 25, defines SET/CLR/TOG at primary
`+4/+8/+12`: aliases read zero; written ones select an operation on the
primary. Narrow 1/2/4-byte accesses affect only aligned bus lanes.

Configuration mask `0x0001F07F` covers DIV_SELECT bits 6:0, POWERDOWN bit 12,
ENABLE bit 13, BYPASS_CLK_SRC bits 15:14 and BYPASS bit 16. LOCK bit 31 is
read-only through every address and width. The generated
[header](../../sp404mk2/references/MIMXRT1062.h) also defines PLL_SEL bit 19,
which the manual labels reserved. The model keeps it zero and counts written
requests in diagnostics, without disturbing a valid pending or completed lock.
Other reserved bits remain zero.

POWERDOWN=1 prevents locking. ENABLE controls the output gate; BYPASS chooses
the output path. Neither blocks analog lock. The pinned
[NXP initializer](https://raw.githubusercontent.com/nxp-mcuxpresso/legacy-mcux-sdk/6f3fd257cdcf978a4d26e7d6e9eed9240037422b/devices/MIMXRT1062/drivers/fsl_clock.c),
lines 581..597, configures and powers the PLL, waits for LOCK while BYPASS=1,
then clears bypass. A separate test caller follows those actual register writes.

`lockTicks` defaults to one explicit synthetic tick. Reads and writes never
advance time. Power transitions and changed divider/reference fields clear
synthetic LOCK and restart progress. Unchanged writes preserve progress;
ENABLE/BYPASS changes also preserve it. Reset restores the source controls and
clears LOCK, progress and request counters. Clearing/restarting LOCK on these
changes is model policy, without measured hardware timing.

`reference24MAvailable`, default true, and `referenceClk1Available`, default
false, are fixed environmental fixtures. Source 0 selects 24 MHz; source 1 selects
CLK1_N/P. Register writes cannot create a reference. The fixtures and
`lockFailure`, default false, survive reset. Missing references or forced lock
failure hold LOCK low. DIV_SELECT 54..108 is documented; other encodings remain
stored and visible as unsupported. Reserved source codes 2/3 likewise remain
stored. Holding LOCK low for those states is conservative model policy;
undocumented silicon behavior remains unknown.

Configured delays and each `tick(n)` accept integer ticks in `0..4294967295`.
Equivalent batched/smaller ticks produce the same state. A zero delay still
requires an explicit tick, including `tick(0)`, after eligible power-up. The hot
tick path uses boolean guards without allocating diagnostic arrays.

`handles(address,width)`, `read(address,width)` and
`write(address,value,width)` use absolute addresses. Unhandled reads return
`undefined`; writes return false. `tick(n)`, `reset()` and `status()` complete
the API. Status copies configuration and diagnostics, exposing actual retained
divider/source, power, bypass/output controls, LOCK and progress. Output enable
is a stored control; no waveform or output frequency is produced.

```powershell
node --test tests/emulator-pll-arm.test.mjs
```

The 28 groups pass, including all 128 divider encodings, source availability,
bypassed/output-disabled lock, pending changes/repeats, failure/reset, aliases,
protected status, reserved selector requests, byte lanes and exact boundaries.
Strict TypeScript checking also passes. The
[receipt](../tools/emulator-evidence/pll-arm-qualification.json) pins the model,
tests, contract, primary sources and TAP output.

The selecting [ordinary stock report](../../sp404mk2/analysis/emulator/dcdc_stock_20261003/whole-image.json)
records 332,283 ARM PLL reads and two writes after passing bounded startup.
It records no write values, so the component tests do not claim stock's actual
divider/reference selection. Two board cases pass for exact routing, aliases,
independent/chunked ticks, reset and unavailable reference fixtures. The first
adjacent-USB assertion incorrectly expected configured bits before a write;
[the original test and correction](../tools/emulator-evidence/board-before-arm-pll-20261003/initial-board-test-correction.txt)
are preserved. Correcting the assertion required no model change.

The [post-integration ordinary stock report](../../sp404mk2/analysis/emulator/arm_pll_stock_20261003/whole-image.json)
passes all12 scatter hashes and one million later starts with a healthy backend.
Passive status shows source0, divider100 and locked, unbypassed output. It
finishes on its budget at `0x80001138` with VIDEO PLL `0x400D80A0` still missing.
The original standalone [source/receipt](../tools/emulator-evidence/board-before-arm-pll-20261003/manifest.json)
remains preserved. Other PLLs, PFD flags, CCM handshakes, physical
clock routing, oscillator coupling and resident/ROM clock state remain open.
