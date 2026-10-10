# Virtual APP1 update host

[`VirtualFirmwareUpdater`](../src/lib/emulator/update.ts) runs the bounded ABI1
update protocol over a supplied virtual USB feature-report transport. The
transport must exchange reports with the executed guest. The host has no HID,
WebUSB or physical-device access. Its `reset` callback must recreate the guest
CPU and runtime state while retaining programmed NOR, then run the new image.

The matched contracts are R13, R14 and R15. Their normal/proof markers are
`523D0001`/`523D0002`, `523E0001`/`523E0002` and
`523F0001`/`523F0002`; signatures are `SP13`, `SP14` and `SP15`.
An unknown signature/marker pair, protocol version, capability or capacity
fails before an upload begins. These contracts accept at most 65,536 bytes.
The full-image R16B and B1/B2 writers require separate host contracts and tests.

The primary references are the preserved
[packet host](../../sp404mk2/tools/usb_upload.py),
[R13](../../sp404mk2/tools/usb_flash_r13.py),
[R14](../../sp404mk2/tools/usb_flash_r14.py) and
[R15](../../sp404mk2/tools/usb_flash_r15.py) flash hosts, plus each firmware's
USB receiver and flash driver:
[R13 USB](../../sp404mk2/sdk/examples/original_r13/USB.md),
[R13 receiver](../../sp404mk2/sdk/examples/original_r13/usb_upload.c),
[R13 flash](../../sp404mk2/sdk/examples/original_r13/flash.c),
[R14 flash](../../sp404mk2/sdk/examples/original_r14/flash.c) and
[R15 flash](../../sp404mk2/sdk/examples/original_r15/flash.c).
The fixed profile comes from the
[R11 preflight capture](../../sp404mk2/analysis/hardware/usb_r11_20260922T190757Z/preflight.json).
Review compared the R14/R15 writer paths with R13 and confirmed the same
bounded transaction, diagnostics and completion fields. R14 stops its audio
probe before flashing; R15's additional capture commands do not change this
transaction.

## Admission and preflight

The caller supplies candidate bytes, their complete SHA256 and the expected
new marker. Candidate metadata does not contain that marker, so callers must
obtain the hash/marker pair from a retained build manifest. The host copies the
bytes before hashing, checks the hash with WebCrypto and computes IEEE CRC32.
It requires the source validator's exact ABI1 envelope:

| Field | Required value |
| --- | --- |
| Image length | 2,048..65,536 bytes, divisible by four |
| Magic at `0x200` | `SPUAFW10` |
| ABI at `0x208` | `1` |
| Declared image length at `0x20C` | Exact supplied length |
| Runtime address at `0x210` | `0x80000000` |
| Runtime length at `0x214` | At least `0x400`, contained after offset `0x400` |
| Runtime offset at `0x218` | `0x400` |
| Stack at `0x21C` and initial runtime vector at `0x400` | `0x20243000` |

The running firmware must report version 2, capability 1, maximum 65,536,
state0/error0 and empty transaction fields. An optional
`expectedRunningMarker` pins the old marker. A required execution snapshot
must identify that running image and contain zero unknown MMIO, zero overflow
and no CPU or flash-model error.

Opcode5 schedules the firmware's read-only probe. Bounded status polls require
the measured JEDEC `C22016` and status `40`. Opcode7 retrieves both 56-byte
diagnostic pages, whose signature/index, complete SFDP header, nine-word legacy
BFPT and cleared diagnostic tail are compared with the captured profile.
Diagnostic phase5 attests that the executed driver accepted FCB signature,
4MiB capacity, 256-byte pages, 4KiB sectors and the SFDP geometry. This protocol
does not expose the raw FCB bytes. A separate normal status read confirms the
probe after the one-shot diagnostic selector is consumed. No BEGIN or COMMIT
is sent if any check fails.

## Transaction and completion evidence

The virtual transport carries exactly 64 payload bytes. The physical Python
host's leading HID report-ID byte belongs to its device API and must be omitted
here. Commands have opcode at byte0, packet version1 at byte1, data length at
byte2, reserved zero at byte3, a little-endian argument at bytes4..7 and at most
56 data bytes from byte8.

| Step | Executed firmware evidence required by the host |
| --- | --- |
| BEGIN1 | Exact candidate length and CRC; state1, received0 |
| DATA2 | Ordered offsets and exact cumulative acknowledgments, chunks of at most 56 bytes |
| FINISH3 | State2, exact length/CRC and complete received count; source checks transport CRC and a fresh staged-RAM reread |
| COMMIT6 | CRC XOR `0x46534C48`; accepted queued state4 or writing state5 |
| Flash completion | State6/error0, flash_error0, exact candidate CRC and padded programmed length, ready1 and unchanged chip profile |
| Separate status | A new normal report independently repeats every completion check |
| Before reset | Running image hash is unchanged; model diagnostics remain empty and are retained in the receipt |
| Fresh boot | New marker, state0 with empty transaction/probe fields, running mailbox state2 and exact candidate SHA256 |

The source writer erases occupied APP1 sectors from offset `0x80000`, writing
the first sector last. It pads the final sector with `FF` and compares every
occupied padded-sector byte through FlexSPI IP reads. A programmed byte count
alone is insufficient: a later readback error can leave that count complete.
The host requires the successful comparison's state6 and error fields.

`flashReadback.verifiedBytes` records that firmware-attested padded byte count.
`flash_crc32` is the candidate CRC retained after the comparison; it is not a
separate CRC over padded sectors. The host does not independently retrieve raw
NOR bytes through this report protocol. The executed integration harness also
checks actual modeled NOR bytes, `FF` padding, erase/page/IP-read bounds and
preservation outside occupied target sectors.

USB bus reset preserves completed/error transactions in these sources. A full
guest reset and a new image-hash snapshot are therefore mandatory. Checking
only a marker would let an old image pass a same-marker update. Capturing model
diagnostics before reset prevents `board.reset()` from hiding unsupported
behavior encountered during programming.

## Reuse

```ts
import {VirtualFirmwareUpdater} from '../src/lib/emulator/update.ts';

const updater = new VirtualFirmwareUpdater({
  transport: async request => Array.from(session.usbReport(request)),
  reset: async () => {
    await session.reset();
    runUntilActualFirmwareIsReady(session);
  },
  snapshot: async () => session.snapshot(),
});
const receipt = await updater.update(candidateBytes, {
  expectedSha256: retainedManifest.sha256,
  expectedMarker: retainedManifest.marker,
  expectedRunningMarker: 0x523d0001,
});
```

The reset example needs the caller's bounded guest execution loop. The host
does not invoke firmware helpers or replace USB command handling. `inspect()`
reads a normal status report; `preflight()` performs the read-only probe without
uploading. Progress events cover admission, preflight, ordered upload, RAM and
flash verification, separate status, reset and verified boot.

One host instance permits one operation at a time. Poll counts bound probe and
flash work; asynchronous transport/reset/snapshot calls also have a timeout.
Cancellation or timeout returns an error and preserves the last observed
firmware state. A queued COMMIT or outstanding callback can still finish.
The host sends no automatic ABORT or reset, and rejects another operation while
an earlier callback remains outstanding. Callers must coordinate all access to
the shared virtual transport.

## Tests and scope

[`emulator-update.test.mjs`](../tests/emulator-update.test.mjs) has 21 protocol
fake tests. They exercise admitted normal/proof contracts and the upper size
bound, then reject wrong metadata/hash, unknown writers, non-idle state, chip
or diagnostic mismatches, broken chunk acknowledgments, CRC/readback errors,
separate-status failure, stale boot state, old same-marker bytes, unsupported
MMIO, concurrent operations, timeout and cancellation. These are host tests.

[`test-emulator-update.mjs`](../tools/test-emulator-update.mjs) drives actual
R13-to-R14-to-R13 guest reports with retained-NOR resets and records source and
engine pins. Default reports belong in `tools/emulator-evidence/`; isolated
runtime qualification can use an explicit separate `--report` destination.
Run status comes from the retained report. Restoring smaller R13 preserves any larger R14 tail
beyond the new occupied sectors, so declared APP1 identity can be restored
without restoring the initial whole-NOR hash.

The [repaired-runtime roundtrip](../../sp404mk2/analysis/emulator/vendor_candidate_temp_lifetime_upstream_20261003/r13-r14-roundtrip.json)
passes both actual transactions on WASM SHA256
`16599c54af6da32ecce2ce52538890610a83c96e1152796ddffa2533d6440b35`.
It took 64,814 host ms and 148,450,000 instructions across three CPU lifetimes.
Each direction retains its admission/pre-reset snapshots, zero model diagnostics,
guest RAM CRC, full occupied-sector comparison and separate state 6/error 0
status. The harness independently observes actual IP-read byte totals of
20,480 for R14 and 16,384 for R13, bounded erase/page operations, exact stored
bytes and preservation outside target sectors. Retained-NOR resets produce
fresh USB markers `523E0001` then `523D0001`, mailbox state 2 and the exact target
hashes. Both completion receipts are present.

The declared R13 APP1 is restored, while `wholeNorRestored:false` records the
preserved R14 tail beyond R13's final occupied sector. Host time and instruction
counts describe emulator work. The separate
[production browser roundtrip](../tools/emulator-evidence/worker-rpc-browser-roundtrip.json)
qualifies the [Worker RPC bridge](emulator-worker-rpc.md) with one unchanged built
Worker. It observes both padded IP-read sequences, separate completion GETs,
retained-NOR reset acknowledgments with zero instructions and no recognized live mailbox,
then fresh R14/R13 markers and hashes. Both legs retain healthy uncached backend
flags and zero unknown MMIO/overflow. This test uses source-module adapters
outside the built site; the existing page controller does not consume the bridge.
The browser trace does not expose raw NOR for independent whole-chip comparison.

The [first reusable-host execution](../tools/emulator-evidence/failed-updater-2026-10-03T025200-812Z.json)
accepted actual R13 reports through the 20,480-byte R14 padded-sector readback
and separate completion status. The required reset then reached R14 code and
stopped with a contained WASM memory trap at `0x80000540`, before a fresh ready
marker. The updater returned an error and no completion receipt. That report
retains the original unrepaired runtime `f9520f9a…` and remains failed history;
its return transaction was not attempted. The repaired-runtime success is a
separate result and does not prove the cause of the earlier trap or establish
a firmware or peripheral defect.

This work establishes no physical USB behavior, flash endurance, power-loss
recovery, ROM/resident cold boot or independent failed-image recovery. Timing,
ADC, companion replies and flash busy periods retain the
[board model's scope](emulator-board-contract.md).
