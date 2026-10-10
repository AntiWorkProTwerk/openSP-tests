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

The selecting [whole-stock report](../../sp404mk2/analysis/emulator/arm_pll_stock_20261003/whole-image.json)
passes all12 scatter hashes and ARM PLL startup, then polls USB2 PLL at its
one-million-start work boundary. The initial internal label called it SYS
PLL; checking the pinned map corrected that before implementation. SYS PLL
is at `0x400D8030`. Actual stock ARM divider is100, distinct from the
standalone driver's test fixture88.

The component remains separate from the board pending its own MMIO and strict
type checks. Tests use finite source-matched register callers; no guest firmware
or physical device runs establish USB2 lock timing. Remote-wakeup hardware
changes, coupled clocks, PHY operation and full stock startup remain open.
