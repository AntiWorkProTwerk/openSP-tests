# Virtual APP1 update host

[`VirtualFirmwareUpdater`](../src/lib/emulator/update.ts) runs the bounded ABI1
update protocol over a supplied virtual USB feature-report transport. The
transport must exchange reports with the executed guest. The host has no HID,
WebUSB or physical-device access. Its `reset` callback must recreate the guest
CPU and runtime state while retaining programmed NOR, then run the new image.

The matched small-image contracts include R13, R14 and R15. Their normal/proof markers are
`523D0001`/`523D0002`, `523E0001`/`523E0002` and
`523F0001`/`523F0002`; signatures are `SP13`, `SP14` and `SP15`.
An unknown signature/marker pair, protocol version, capability or capacity
fails before an upload begins. These contracts accept at most 65,536 bytes.
The host also recognizes exact normal R16B (`SP16`/`52410001`) and R48
(`SP48`/`52620001`) recipients with maximum `0x37F000`. Their exact normal
small-image transactions now pass guest flash/readback and fresh boot to R13
and back. Their exact full-target
admission returns execution blockers, and `update()` refuses those transfers
before any USB operation. See the [larger-writer contract](emulator-larger-writer-profiles.md).
B1/B2 recipient policies remain unimplemented.

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

The running firmware must report version 2, capability 1, its exact profile maximum,
state0/error0 and empty transaction fields. An optional
`expectedRunningMarker` pins the old marker. R16B/R48 require that marker and
`expectedRunningSha256` equal their source-pinned normal image identity.
The hash is optional for the existing R13/R14/R15 callers. A required execution snapshot
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

The host forwards an explicit reset target containing the admitted length and
complete SHA256, plus the running hash captured before the transaction.
`session.reset(target)` validates the full retained target and refuses stale or
changing images/NOR before modifying volatile state. This also supplies the
complete extent for a no-ABI stock image; the old recipient's length is not an
explicit target contract. Selector-based B1 reset remains refused until guest
qualification. Structural reset validation does not attest flash completion;
the preceding guest CRC/readback and separate status remain mandatory.

## Reuse

```ts
import {VirtualFirmwareUpdater} from '../src/lib/emulator/update.ts';

const updater = new VirtualFirmwareUpdater({
  transport: async request => Array.from(session.usbReport(request)),
  reset: async target => {
    await session.reset(target);
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

[`emulator-update.test.mjs`](../tests/emulator-update.test.mjs) has 33 host
tests, including two optional local full-image admission cases that both ran
in the retained implementation check. They exercise admitted normal/proof contracts and the upper size
bound, then reject wrong metadata/hash, unknown writers, non-idle state, chip
or diagnostic mismatches, broken chunk acknowledgments, CRC/readback errors,
separate-status failure, stale boot state, old same-marker bytes, unsupported
MMIO, concurrent operations, timeout and cancellation. The larger profiles add
exact running-image pins, stale replacement and partial completion refusals,
unchanged small ABI1 admission, full-target hashes and explicit no-USB execution
blockers. Local full-target fixtures are only read and hashed; no guest executes
them and no payload is written to evidence. These are host tests.

The 19 [reset contract tests](../tests/emulator-reset-contract.test.mjs) use owned
benign images and fake CPU boundaries to check explicit extent, hash admission,
concurrent mutation and refusal before volatile changes. The
three [production Worker reset tests](../tests/emulator-worker-reset.test.mjs) execute
its message handler with fake module boundaries and verify target validation and
forwarding. These tests create no real Worker, ARM engine or browser result.
The [host qualification receipt](../tools/emulator-evidence/larger-writer-host-qualification-20261003.json)
records 130 passing image, reset, updater, Worker, RPC and page-protocol cases,
with source pins stable across the run. Both local full-target admission cases
ran. Focused strict checks and `npm run check` passed with zero errors, warnings
or hints. This result does not qualify guest execution through R16B/R48 or a
large update. The
[pre-implementation snapshot](../tools/emulator-evidence/larger-writer-pre-implementation-20261003/manifest.json)
retains the exact old source and historical source-review receipt.

The separate [small-profile runner](../tools/test-emulator-larger-writer-small.mjs)
passes [R16B-to-R13-to-R16B](../tools/emulator-evidence/r16b-r13-r16b-small-roundtrip-20261003.json)
and [R48-to-R13-to-R48](../tools/emulator-evidence/r48-r13-r48-small-roundtrip-20261003.json)
on repaired WASM `399f9ca4...`, with stable complete source/runtime pins. Each
run takes 160,675,000 observed code-hook starts; host elapsed times are 80,639
and 80,800 ms. The runner's passive observations cover 16,384 and 20,480 bytes of
actual padded IP comparison, every occupied erase/page, exact stored bytes and
preservation outside the target sectors. Its profile-aware decoder preserves
`SP16`/`SP48` and their larger advertised capacity without broadening candidate
admission.

Each leg retains RAM CRC, flash state6/error0 and a separate state6 status,
forwards exact target/current hashes into reset, observes an empty real mailbox
at zero instruction count, then runs the fresh target to its expected USB and
mailbox identity. Healthy uncached backends and zero unknown MMIO/overflow
remain visible before and after reset. The smaller R13 target preserves the
old fifth sector; the final larger original image restores the initial whole
virtual NOR hash. These results cover only the pinned normal small images in
Node sessions. Full stock/B1 transfers, selector boot, browser Worker delivery
and physical-device behavior remain separate checks. The
[earlier focused documentation](../tools/emulator-evidence/larger-writer-small-pre-doc-sync-20261003/manifest.json)
is retained unchanged.

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

The later [four-repair guest roundtrip](../../sp404mk2/analysis/emulator/vendor_candidate_m7_host_regs_20261003/r13-r14-roundtrip.json)
passes on the updated host/reset and clock-integrated sources. It took73,328
host ms with the same148,450,000 counted starts, stable source/runtime pins,
the same padded IP-read totals and fresh target identities. The reset bridge
forwards exact candidate length/hash and the expected previous image hash.
This qualification covers the preserved R13/R14 images, not large-image writers.

The declared R13 APP1 is restored, while `wholeNorRestored:false` records the
preserved R14 tail beyond R13's final occupied sector. Host time and instruction
counts describe emulator work. The separate
[production browser roundtrip](../tools/emulator-evidence/worker-rpc-browser-roundtrip.json)
qualifies the [Worker RPC bridge](emulator-worker-rpc.md) with one unchanged built
Worker. It observes both padded IP-read sequences, separate completion GETs,
retained-NOR reset acknowledgments with zero instructions and no recognized live mailbox,
then fresh R14/R13 markers and hashes. Both legs retain healthy uncached backend
flags and zero unknown MMIO/overflow. This test used source-module adapters
outside the built site; its pinned page controller did not consume the bridge.
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
