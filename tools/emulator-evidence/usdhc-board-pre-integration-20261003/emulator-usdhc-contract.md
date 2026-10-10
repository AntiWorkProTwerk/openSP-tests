# USDHC and virtual SD component contract

[usdhc.ts](../src/lib/emulator/usdhc.ts) provides a separate controller model and
an owned, read-only SD image. Its tests operate the register interface. It is not
wired into `SPBoard`, the worker or a guest runtime. No filesystem, project,
sample-loading or stock storage result follows from these component tests.
The existing [storage ABI verification](../../sp404mk2/tools/verify_storage_abi.py)
uses filesystem/RTOS leaf stubs and does not qualify this controller.

## Interface and fixtures

```ts
const sd = new USDHCController({
  image: new Uint8Array(262144),  // copied into this instance
  instance: 1,                  // or 2
  inserted: true,
  commandTicks: 1,
  maximumTransferBytes: 1048576,
  onIrq: (irq, asserted) => {},
});
sd.read(offset, width);         // relative offsets; widths 1/2/4
sd.write(offset, value, width);
sd.tick(turns);                 // nominal scheduler turns
sd.resetController();           // host reset, preserves card protocol state
sd.setInserted(boolean);
sd.status();                   // diagnostics and counters, excludes image bytes
```

The retained NXP header assigns USDHC1 base `0x402C0000`/IRQ110 and USDHC2
base `0x402C4000`/IRQ111. Physical SP pin routing remains unknown here.
The presence input, idle-high CMD/DATA lines, stable clock and command/busy/reset
latencies are named virtual fixtures. They are not electrical measurements.

The initial card profile is synthetic SDSC, with a CSDv1 and byte-addressed
reads. Images must contain exactly `256KiB..128MiB` in 256KiB units. No padding or
capacity rounding occurs. `READ_BL_LEN=9`, `C_SIZE_MULT=7` and
`C_SIZE=imageBytes/262144-1` describe the exact admitted capacity; the CSD
representation itself permits up to 1GiB. The constructor refuses other image
sizes before copying them. SDHC/SDXC addressing is outside this profile.

Synthetic CID fields identify OEM `OS`, product `VSDRO`, revision1.0 and serial1;
the date 2026-10 is fixture metadata. CSD command classes are basic, block read
and application commands, with permanent write protection. SCR bytes
`02 05 00 00 00 00 00 00` advertise SD2.0 and one/four-bit widths, with no CMD23
support. CID/CSD CRC7/end bits are calculated. None of these fields identifies
an owner card or establishes card-product compatibility.

## Commands and PIO

CMD0 resets the card protocol to idle. CMD8 is qualified in idle, CMD55/ACMD41
advance initialization, CMD2 returns CID, and CMD3 assigns RCA1. CID/CSD queries
CMD9/10 are qualified in standby. CMD7 selects/deselects the card. CMD13 reports
status, CMD16 accepts 512-byte blocks, ACMD6 selects one/four-bit width, and
ACMD51 returns SCR through the same data port used for sectors. Repeated CMD55
preserves authorization; undefined ACMD numbers fall back to the normal command.
R1/R6 state bits describe the state when the card receives the command, before
its resulting transition. Accepted application commands set APP_CMD.

CMD17 reads one 512-byte sector. CMD18 requires matching multiblock mode,
`BCEN=1` and a finite block count. Zero block count transfers no data. Each
nonzero transfer must fit the exact image and configured byte limit. Its data
is copied into a bounded private transfer buffer. A final sector and exact-end
multiblock read pass; unaligned addresses and out-of-range ranges return the
defined card errors without data. No read synthesizes filesystem content.

The qualified data path requires little endian, aligned 32-bit port reads,
matching one/four-bit card/host width, and a watermark of 1..128 words. PIO batches
end at the watermark or current block boundary. The short 8-byte SCR remains
readable with a 128-word watermark. BRR is sticky W1C; BREN reflects the ready
batch. The fixture refills a drained batch on a later tick after BRR has been
acknowledged. This scheduling policy does not reproduce a physical FIFO clock.
Reading without a ready batch returns fixture zero and records a diagnostic.

TC occurs after all requested data has been drained. Single-block reads return
the card to transfer state. Finite CMD18 without AutoCMD12 leaves sending-data
state until CMD12; the qualified manual-stop path follows the completed drain.
AutoCMD12 stores its pre-stop R1 status in RSP3 and returns transfer state.
R1b checking produces CC first, then TC on a later nominal tick. The ordinary
NXP CMD7 R1 configuration is also accepted.

RM§26.6.2 requires a short burst at **each** block boundary. The pinned upstream
`USDHC_ReadDataPort` instead limits bursts by total transfer words. That rule
crosses boundaries when a multiblock watermark does not divide 128 words.
The tests retain this discrepancy: a 40-word caller following that helper reads
32 words without a ready batch at the first boundary. A caller using that driver
must use a watermark dividing 128 for the qualified multiblock path. The positive
tests calculate bursts from MMIO watermark/block size, without using private
FIFO counts to choose the reads.

## Controller state and limits

Commands launch through `CMD_XFR_TYP+0x0C`; transfer flags live in `MIX_CTRL+0x48`.
CMD_ARG writes are ignored while CIHB is set. Data/busy commands observe CDIHB;
command-only status traffic can coexist with a read. Short responses modify
RSP0 only. R2 maps CID/CSD bits127..8 into
`{RSP3[23:0],RSP2,RSP1,RSP0}` and preserves RSP3's unmodified high byte.

INT_STATUS_EN gates newly generated events; INT_SIGNAL_EN gates IRQ delivery
from the latched status. Byte-lane W1C cannot clear unwritten higher bits.
ERR is derived from the listed error bits. Disabling status generation preserves
an existing generic latch, a declared policy where the retained RM is silent.
Insertion/removal status reasserts while its condition and enable remain active.

RSTC clears the pending command/CC and preserves data. RSTD clears the data
buffer/activity, CREQ and BRR/BWR/DINT/BGE/TC; sticky errors survive. RSTA resets
host registers while preserving presence, capability and card protocol state.
CMD0 is required to reset the card. INITA is write-one-start and self-clears on
a nominal tick. Resetting unfinished data is outside the RM's documented
software procedure and records a diagnostic. Diagnostics survive host resets.

DMA/ADMA, writes/erase, MMC/SDIO, high-speed/UHS/tuning, block-gap modes and
SD status are explicit refusals. The hardware capability reset values retain
advertised features which this subset cannot execute; a DMA attempt fails
visibly. Unknown registers return `undefined` with bounded diagnostics.
Some refused modes use CTOE/DTOE/DMAE as a deterministic model error indication;
their precise physical failure timing is unqualified. No raw device, filesystem
or host-media API exists in this module.

## Evidence and verification

The retained [MIMXRT1062.h](../../sp404mk2/references/MIMXRT1062.h) has SHA256
`1ee70ed9eb7f3a75ed89943dd799314e8330538f54c6990ea7d9cae96fd263aa`.
The [RT1060RM revision3](../../sp404mk2/analysis/flash_research/IMXRT1060RM_rev3.pdf)
has SHA256 `a2e342e492eded2a1d626cf955de953ca28d8db8675b10937a5176fd6f2c9200`.
Relevant printed pages are1475 (ready requests),1528 (PIO bursts),1531 (resets),
1535 (CMD_ARG),1538 (command fields),1542 (response packing),1546..49 (present
state),1554..55 (reset scope),1558..66 (interrupts) and1575..77 (watermarks/mixer).
The zero-based PDF index is printed page minus one.

Pinned official NXP sources:

| Source | SHA256 |
| --- | --- |
| [fsl_usdhc.c](https://raw.githubusercontent.com/nxp-mcuxpresso/mcux-sdk/8a289764d763ad06e0c3a05c885644ed98b970af/drivers/usdhc/fsl_usdhc.c) | `dd5a5bf74e7886c3f5314086afebfe8bc27b728fe2d987919e7e004cb4d168b0` |
| [fsl_usdhc.h](https://raw.githubusercontent.com/nxp-mcuxpresso/mcux-sdk/8a289764d763ad06e0c3a05c885644ed98b970af/drivers/usdhc/fsl_usdhc.h) | `a8c9771d02cde72698b23f72c307184551389044c8747edc3c3ea8769525593b` |
| [fsl_sdmmc_spec.h](https://raw.githubusercontent.com/nxp-mcuxpresso/mcux-sdk-middleware-sdmmc/d9666d0fcb3177295cad91046e5b2cdaa98451e9/common/fsl_sdmmc_spec.h) | `ed07de340a96525d2b63dd45bf5a2956f3758fd958c14bd1b1f38342fd012adf` |
| [fsl_sd.c](https://raw.githubusercontent.com/nxp-mcuxpresso/mcux-sdk-middleware-sdmmc/d9666d0fcb3177295cad91046e5b2cdaa98451e9/sd/fsl_sd.c) | `8cb1784b450942686298dd2242a451d3a0b9ca257a4ccffd7dc2a8f04d0637de` |
| [fsl_sdmmc_common.c](https://raw.githubusercontent.com/nxp-mcuxpresso/mcux-sdk-middleware-sdmmc/d9666d0fcb3177295cad91046e5b2cdaa98451e9/common/fsl_sdmmc_common.c) | `249bbf46d4d436d5b768873ac14e093a48761fc3e366aef457a926e92edd9631` |

The SD Association's [Physical Layer6.00 Table4-42](https://www.sdcard.org/cms/wp-content/themes/sdcard-org/dl.php?f=Part1_Physical_Layer_Simplified_Specification_Ver6.00.pdf)
defines response state and APP_CMD. The [5.10 application-command section4.3.9.1](https://www.sdcard.org/cms/wp-content/themes/sdcard-org/dl.php?f=Part1_Physical_Layer_Simplified_Specification_Ver5.10.pdf)
defines repeated CMD55 and normal-command fallback. These passages were checked
through the official indexed documents; a local copy of those PDFs was not
captured. The NXP sources provide the card register decoders and initialization
sequence used by the tests.

Run `node --test tests/emulator-usdhc.test.mjs` for the 25-case component suite. It covers
capacity decoding, ownership, response packing, PIO bytes/boundaries, card state,
busy/IRQ/W1C, resets and explicit failures. Strict TypeScript checking also
passes. These tests execute the JavaScript controller model, without a firmware
CPU, browser or physical device.
