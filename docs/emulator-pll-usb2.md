# USB2 PLL register model

[`Rt1062Usb2Pll`](../src/lib/emulator/pll-usb2.ts) owns the16-byte USB2 PLL
group at `0x400D8020`, including SET/CLR/TOG at `+4/+8/+12`. It is separate
from the historical USB1 readiness fixture and the ARM PLL model.

The [source contract](../../sp404mk2/analysis/emulator/pll_static_20261003/source-contract.json)
pins NXP's Rev3 manual, §14.8.3, printed pages1098..1100, the register header
and the clock driver. Reset is `0x00012000`; writable mask `0x0001F042`
covers divider bit1, USB phase output bit6, analog POWER bit12, ENABLE bit13,
reference source bits15:14 and BYPASS bit16. LOCK bit31 is read-only.
Aligned1/2/4-byte writes affect their lanes; aliases read zero and act on
written ones. Reserved bytes outside the group remain unhandled.

USB POWER=1 enables analog locking. Both divider encodings select the
documented20/22 multiplier. The driver at lines689..705 powers and configures
the PLL, polls LOCK while bypassed, then removes bypass. ENABLE, EN_USB_CLKS
and BYPASS retain their settings without blocking lock. No clock waveform,
USBPHY gating or output frequency is generated.

`lockTicks`, default1, advances only through explicit ticks. Power, divider
and reference changes clear synthetic LOCK and restart progress; repeated
configuration and output-gate changes preserve it. This restart policy is a
fixture, not measured silicon timing. Zero delay still requires `tick(0)` or
another explicit tick. Reads and writes never advance time.

Fixed `reference24MAvailable=true`, `referenceClk1Available=false` and
`lockFailure=false` defaults are configurable and survive reset. Source0
selects24MHz; source1 selects CLK1. Reserved2/3 remain stored and visibly
stall the synthetic lock. Register settings cannot create a reference.
Status copies configuration and reports actual retained source, divider,
power/output gates, lock progress and blocking reasons.

The reviewed [whole-stock report](../../sp404mk2/analysis/emulator/arm_pll_stock_20261003/whole-image.json)
passes all12 scatter hashes and ARM PLL startup. Its next wait was initially
misidentified from a decimal address as SYS, then USB2 PLL. Exact hexadecimal
conversion identifies VIDEO PLL `0x400D80A0`. The USB2 model is useful independent
coverage, but does not address that wait. Actual stock ARM divider is100,
distinct from the standalone driver's fixture88.

The12 component groups and strict type check pass. Two board tests verify
aliases, independent/chunked ticks, reset, failure fixtures and separate
neighboring PLL routes. The [44-group clock report](../tools/emulator-evidence/pll-board-model-tests-20261003.tap)
also includes ARM component/integration tests. Board type checking requires
`--allowImportingTsExtensions`, matching the repository's existing imports.

The [post-integration whole-stock report](../../sp404mk2/analysis/emulator/usb2_pll_stock_20261003/whole-image.json)
still waits at `0x80001138` on VIDEO PLL. USB2 retains its unpowered reset
controls; that run does not exercise its initialization. The source-correct
POWER=1 policy remains intact. The initial motivation label/receipt are
[preserved](../tools/emulator-evidence/board-before-usb2-pll-20261003/manifest.json).
Remote-wakeup hardware changes, coupled clocks, PHY operation and full stock
startup remain open; no physical lock timing is established.
