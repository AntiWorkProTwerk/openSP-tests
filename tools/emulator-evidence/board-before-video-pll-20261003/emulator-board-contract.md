# Emulator board contract

The browser board follows the original R13 drivers and the R16B sources used
to build R48. Firmware executes its own startup, display, input and USB code.
The controller models supply MMIO values and perform DMA into the CPU's memory.
No model calls a firmware helper or fabricates a firmware USB report.

The authoritative sources are
[R13 board](../../sp404mk2/sdk/examples/original_r13/board.c),
[local input](../../sp404mk2/sdk/examples/original_r13/local_input.c),
[USB controller](../../sp404mk2/sdk/examples/original_r13/usb_device.c),
[flash writer](../../sp404mk2/sdk/examples/original_r13/flash.c),
[R16B audio probe](../../sp404mk2/sdk/examples/original_r16b/audio_probe.c),
and the retained [NXP register definitions](../../sp404mk2/references/MIMXRT1062.h).
The existing [R13 CPU fixture](../../sp404mk2/sdk/examples/original_r13/test_r13.py)
provides a regression reference. Its injected peripheral values remain model
evidence, separate from the linked physical hardware reports.

## Entry and memory

R13/R16B/R48 begin with the resident's direct APP1 entry at `0x60080000`.
Their entry code copies the runtime from flash offset `0x400` into SDRAM
`0x80000000`, installs its vectors, initializes OCRAM data/BSS and sets its
stack to `0x20243000`. The owned OCRAM interval is
`0x2023F000..0x20243000`; the linker reserves the upper 4 KiB for stack.
R13 staging is `0x83000000..0x83010000`; R16B/R48 admit larger staged images.
These are APP1 handoff contracts. They do not establish a ROM/DCD/resident cold
boot. See [R13 linker](../../sp404mk2/sdk/examples/original_r13/app1.ld) and
[R48 build](../../sp404mk2/sdk/examples/original_r48/build.py).

## Implemented MMIO

| Address | Model behavior |
| --- | --- |
| GPIO1 `0x401B8000`; GPIO2 `0x401BC000` | DR, GDIR storage, PSR and DR set/clear/toggle at `+0x84/+0x88/+0x8C`. GPIO1 PSR bit0 supplies the ready-pin fixture. |
| GPIO3 `0x401C0000`; GPIO4 `0x401C4000`; GPIO5 `0x400C0000` | DR aliases and direction storage; PSR supplies driven outputs with zero fixtures for unmeasured external inputs. All five banks retain interrupt configuration/mask/edge-select; ISR is W1C. GPIO interrupt generation remains unimplemented. |
| GPIO2 OLED bits `0/1/2/3/10` | CS/DC/MOSI/CLK/reset. Rising clock edges with CS low reconstruct bytes. Commands select RAM windows and on/off; data updates 1,024 page-packed bytes. Completed data transactions publish frames. |
| GPIO2 local input | Digital column bits23..25; active-low rows20,21,22,28,26. Encoder levels use bits18/19. Analog column uses bits27,30,31 independently. |
| GPT1 `0x401EC000` | CR reset self-clears; `+0x24` returns the wrapping counter. The original driver's selected oscillator route advances at nominal24 MHz with its PR divider. A separate read-driven option reproduces the Python functional fixture. |
| UART3 `0x4018C000` | DATA `+0x1C` transfers bytes; STAT `+0x14` supplies TX-ready/complete, RX-ready and W1C errors. RX FIFO flush is modeled. CTRL receive/error enables assert IRQ22. |
| ADC1 `0x400C4000` | HC0 selects channels4/5/6/3 and the analog mux selects one of32 slots. HS `+0x20` reports completion; R0 `+0x24` consumes it. GC/GS `+0x48/+0x4C` provide calibration and injected failure paths. |
| USB1 `0x402E0000` | Eight endpoint pairs, dQH64/dTD32, SETUP at OUT dQH+40, prime/flush/status/completion, W1C, staged address and IRQ113. Host packets drive real descriptor DMA; firmware answers requests. |
| FlexSPI1 `0x402A8000` | LUT-decoded single-pad IP commands, RX/TX FIFO windows, JEDEC/SFDP/status, WEL/busy, 4 KiB erase, 256-byte page programming and IP readback. Virtual NOR mutations synchronize XIP memory. |
| XTALOSC24M MISC0 `0x400D8150`, LOWPWR_CTRL `0x400D8270` | Source resets, SET/CLR/TOG aliases, protected status and explicit tick-driven ready/stalled fixtures. [Oscillator contract](emulator-oscillator.md). |
| DCDC REG0..3 `0x40080000` | Four adjacent words, source resets/writable masks and protected DC_OK. Explicit synthetic settling and clock/power availability advance independently of GPT. [DCDC contract](emulator-dcdc.md). |
| SAI1 `0x40384000` | RX0 decoded-word injection, 32-entry FIFO, modulo64 pointers, dynamic watermark/full flags, W1C events, distinct software/FIFO reset and IRQ56. TX `+0x20` collects writes. See the receiver scope below. |
| SCS `0xE000E000` | CPUID `0x411FC271`, configuration-register storage, VTOR masking, NVIC enable/pending W1S/W1C and byte priorities. Architectural exception delivery belongs to the CPU adapter. |

Other CCM, IOMUXC, watchdog and cache-maintenance accesses used by these drivers retain
configuration values. Electrical clock/mux effects, watchdog expiry and cache
coherency remain unimplemented. ADC calibration/conversion complete immediately.
Oscillator delays remain abstract fixture ticks. The
[conditional-execution qualification](emulator-thumb-conditional.md) shows that
depleted instruction slices can retire IT-block instructions without code hooks.
Board ticks count observed hooks and can undercount those instructions; they
cannot establish precise interrupt timing or single-instruction stepping.
The UART companion replies to the observed startup request and shutdown ACK;
this fixture covers only those packets. GPIO inputs come from explicit injection.
The55 named controls use the recorded R13 map, including all eight DEL aliases.
Encoder injection selects raw two-bit phases and does not synthesize detents.

The default NOR has the measured C22016/status40 identity and the captured R11
SFDP header/BFPT. Its default FCB contains synthesized geometry fields, and
unread SFDP bytes are FF fixture padding. A supplied full image replaces the
flash bytes. Unsupported IP commands retain a visible model error. Virtual NOR
allows writes throughout its4 MiB capacity so firmware boundary bugs remain
observable; APP1 restrictions belong to the writer.

## SAI1 receiver scope

The RX0 model follows the
[R14](../../sp404mk2/sdk/examples/original_r14/audio_probe.c) and
[R15](../../sp404mk2/sdk/examples/original_r15/audio_probe.c) polled receivers,
the retained [NXP header](../../sp404mk2/references/MIMXRT1062.h) and
[RT1060 Rev3 manual](../../sp404mk2/analysis/flash_research/IMXRT1060RM_rev3.pdf),
chapter 38. The manual's SHA256 is
`a2e342e492eded2a1d626cf955de953ca28d8db8675b10937a5176fd6f2c9200`.
Useful printed pages are 1992 (data reads),1995..1996 (flags/error recovery),
1998..1999 (resets),2019..2020 (RCSR) and2032 (FIFO pointers).

| RX register | Implemented behavior |
| --- | --- |
| RCSR `+0x88` | RE automatically sets BCE. Incoming words require RE/BCE, RCE0 and software reset clear. FEF/SEF/WSF bits18/19/20 are sticky W1C; narrow writes clear only their written byte lanes. FRF/FWF bits16/17 are read-only. Matching enable bits8..12 drive IRQ56. |
| RCR1 `+0x8C` | Five-bit watermark. FRF asserts when enabled RX0 occupancy is strictly greater than the watermark; FWF asserts at32 entries. Disabling RCE0 clears both level flags immediately. |
| RCR3 `+0x94` | RCE0 gates incoming data and level flags. Other channels and individual CFR resets remain unsupported and record unknown MMIO; CFR reads zero. |
| RCR4 `+0x98` | Retains frame configuration and implements FCONT overflow recovery. Packing/combine requests are unsupported and visible. |
| RDR0 `+0xA0` | With packing disabled, each valid 8/16/32-bit read consumes one FIFO entry, including when receive operation is disabled. Empty reads leave pointers unchanged; returned zero is a fixture because hardware supplies no valid word. Writes are ignored. |
| RFR0 `+0xC0` | Six-bit RFP at bits5..0 and WFP at bits21..16. Pointers wrap modulo64; equality means empty, XOR`0x20` means full at 32 entries. Writes are ignored. |
| RMR `+0xE0` | Zero mask is supported. A nonzero word mask is retained and records unsupported MMIO. |

Software reset SR bit24 remains asserted until software clears it. It empties
the FIFO, zeros both pointers and clears sticky flags while retaining receive
configuration. FIFO reset FR bit25 is a one-cycle action that reads zero:
it empties the queue by setting RFP to the existing WFP, preserving pointer
phase and sticky flags. The
[saved NXP driver](../../sp404mk2/analysis/audio_research/nxp_fsl_sai.c) says
both pointers become zero in its reset comment; the chip manual explicitly
allows nonzero equal pointers after FR. Historical Python receiver fixtures
also used zero pointers. Those shortcuts remain synthetic test behavior. The
driver's read/modify/write also writes observed W1C flags back as 1, which can
clear them independently of the FIFO reset action.

`injectAudioRx(words, {wordStart?,syncError?,frameStart?})` supplies completed
decoded RX0 words and explicit events, returning the accepted word count.
No event cadence or physical slot phase is inferred from a block. Overflow
preserves queued words and latches FEF without advancing WFP. R14/R15 set
FCONT=1, so explicit continuation can be accepted after a word is drained even
while FEF remains set. The caller supplies retries; the model has no serial
shift register or automatic clock-driven continuation. With FCONT=0, injected
words remain discarded until FEF is cleared and a new explicit frame starts.

RE/BCE disable takes effect immediately in this model; hardware waits for the
current frame to end. External clock generation, serial framing, additional
RX channels, packing, combining, masks and DMA remain open. Enabling RX DMA
records unsupported MMIO. TX is only a bounded write collector, with no TX
FIFO status or audio delivery model. Physical input routes remain unknown.

The 30 board tests include 11 SAI groups covering the matched initialization,
watermarks0/16/31, full32 and repeated wrap, gating, W1C lanes, reset phase,
narrow/empty reads, overflow recovery, IRQ enables and unsupported requests.
These are deterministic MMIO tests, independent of guest execution and device
audio evidence.

Final review caught side effects using unmasked high bits from a narrow write.
The correction masks SAI side effects to the written bus lanes; an 8-bit write
cannot clear high status flags or request FIFO reset. Tests now include values
with deliberately unwritten high bits. The
[preserved source note](../tools/emulator-evidence/sai-byte-lane-source-preservation.json)
records the exact pre-correction snapshot and hash, recovered by reversing
that local patch after it was applied. Earlier candidate qualification keeps
its original source pins; the correction has separate model-test evidence.

## CPU and host interface

`SPBoard` exposes `read(address,width)`, `write(address,value,width)`,
`tick(cycles)` and `setMemoryCallbacks(readMemory,writeMemory)`. Widths are
aligned1/2/4-byte accesses. `onFrame`, `onIrq` and `onPower` callbacks expose
external changes. `status()` copies the display and reports unknown MMIO,
flash errors, source fixtures and limitations. Reset clears volatile board
state and preserves NOR.

`usb.hostSetup(bytes8)`, `usb.hostIn(endpoint)` and
`usb.hostOut(bytes,endpoint)` perform host tokens. The host must run the CPU
between tokens. Standard descriptors and64-byte HID feature reports therefore
come from executed firmware. Unknown MMIO returns `undefined` and records the
address, width, operation and count; it cannot be counted as supported hardware.
ADC_ETC, eDMA, guest storage and the remaining stock peripherals are open work.
Optional USDHC fixtures qualify a read-only PIO subset; absent controllers and
unsupported accesses remain unknown. ARM PLL lock is the next observed stock
clock gap after oscillator and DCDC setup.

The53 initial board/USB/flash tests exercise synthetic MMIO and DMA. They verify
these contracts independently of firmware execution. A stock boot, full audio,
storage, cold recovery and accurate timing require broader models and separate
execution evidence.

## Actual stock startup frontier

`node tools/test-emulator-stock.mjs` starts the pristine v5.52 APP1 by its
resident handoff. It poisons every declared zero region with A5 and checks the
entire region before execution. At the actual `0x60080622` handoff after
19,016,148 instructions, all eight copy/decompression hashes match the retained
scatter map and all four zero regions match full-length zero hashes. The test
does not load reconstructed runtime regions into the CPU.

The actual C runtime then executes2,520 instructions into stock pin-mux
initialization `sub_80000140`. The current WASM engine stops at `0x80000402`
with "memory access out of bounds". The next bytes `C0F80031` decode as
`STR.W r3,[r0,#0x100]`; the preceding trace has `r0=0x401F8014`.
Its cause remains unresolved. This is an emulator execution frontier, not proof
that the stock instruction or target register fails on hardware. The added
GPIO/CCGR2/daisy storage removes the earlier unknown pin-initialization MMIO;
CCSIDR/CSSELR remain unmodeled. Stock OLED/audio/storage have not been reached.

[The report](../tools/emulator-evidence/stock-startup.json) pins the emulator
sources/runtime and the raw firmware. The
[first trace failure](../tools/emulator-evidence/stock-startup-first-trace-failure.json)
retains the original register snapshot and trace. Later one-instruction slices
reproduced the same fault; a local debugger found the apparent long run was
already in a failed engine's `uc_mem_read`, called while collecting trace bytes.
The harness now captures runtime trace bytes at the verified scatter checkpoint
and avoids engine reads/cleanup after a WASM trap. That correction preserves
the execution failure as evidence without treating it as a peripheral result.
