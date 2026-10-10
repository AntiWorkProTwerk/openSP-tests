# Larger virtual APP1 writer profiles

The reusable virtual update host now recognizes the exact normal R16B and R48
writers. Exact normal R16B/R48-to-R13-and-return guest transactions now pass
through the reusable host with explicit retained-NOR resets. Their larger
staging buffers admit one pinned full image each,
but the host refuses a full transfer before any USB operation while its
execution budgets, IP-read evidence and fresh target boot remain unqualified.

The [source-pin receipt](../tools/emulator-evidence/larger-writer-source-review-20261003.json)
records checked source, reference and binary hashes. The review read files and
computed artifact hashes, lengths, CRCs and first words. It performed no builds,
guest execution or physical USB operations. Existing hardware records remain
separate evidence.

The [host implementation receipt](../tools/emulator-evidence/larger-writer-host-qualification-20261003.json)
records 130 passing host/model/protocol cases and strict type checks. It retains
the exact source before implementation and observes no guest, real Worker,
browser or physical device execution. The original 60-pin source review remains
historical; its stock-qualification reference has since changed, while the
firmware inputs and admission constants remain unchanged.

The primary contracts are [R16B USB](../../sp404mk2/sdk/examples/original_r16b/USB.md),
[R16B flash](../../sp404mk2/sdk/examples/original_r16b/FLASH.md), its
[receiver](../../sp404mk2/sdk/examples/original_r16b/usb_upload.c) and
[validator/driver](../../sp404mk2/sdk/examples/original_r16b/flash.c), plus the
[R16B host](../../sp404mk2/tools/usb_flash_r16b.py). R48 compiles the shared
R16B sources with explicit target and identity definitions in its
[build script](../../sp404mk2/sdk/examples/original_r48/build.py);
its [manifest](../../sp404mk2/sdk/examples/original_r48/build/manifest.json),
[guide](../../sp404mk2/sdk/examples/original_r48/README.md) and
[host](../../sp404mk2/tools/usb_flash_r48.py) pin the substituted full target.

| Running writer | USB and status identity | Maximum | Persistent candidates |
| --- | --- | --- | --- |
| R13/R14/R15 | Existing `SP13`/`SP14`/`SP15` profiles | `0x10000` | Existing small ABI1 contract |
| R16B | `CAFE:404F`, `SP16`, version2, capability1, normal marker `52410001` | `0x37F000` | Small ABI1 or exact unwrapped R3 |
| R48 | `CAFE:404F`, `SP48`, version2, capability1, normal marker `52620001` | `0x37F000` | Small ABI1 or exact B1-wrapped R3 |

R16B's retained proof binary uses marker `52410002`; the current virtual host
excludes it, matching the normal-marker policy in the R16B Python host. R48
defines proof marker `52620002` only under `USB_PROOF`; its supplied binary and
pinned host use the normal marker. Shared VID/PID or maximum capacity alone
cannot identify a compatible writer.

The RAM receiver accepts BEGIN lengths from 4 through `0x37F000` bytes.
Persistent small-image admission requires a length from 2,048 through 65,536,
divisible by four; `SPUAFW10` at offset `0x200`; ABI1 at `0x208`; exact declared
length at `0x20C`; runtime base `0x80000000` at `0x210`; runtime length at
`0x214` from `0x400` through `length - 0x400`; runtime offset `0x400` at
`0x218`; and stack `0x20243000` at both `0x21C` and the first runtime word at
`0x400`. The sources provide no generic larger ABI1 or ABI2 admission.

The full-image exceptions are these exact artifacts:

| Recipient | Target | Length | CRC32 | First word | Padded IP readback |
| --- | --- | ---: | --- | --- | ---: |
| R16B | Unwrapped R3 | 2,652,672 (`0x287A00`) | `2A7BB1D3` | `6801480D` | 2,654,208 bytes, 648 sectors |
| R48 | B1-wrapped R3 | 2,671,332 (`0x28C2E4`) | `2A98C325` | `BFFEF287` | 2,674,688 bytes, 653 sectors |

Unwrapped R3 is
`custom_firmware/build/original_r16b/RESTORE/SP404MKII_APP1_R3.bin`, SHA256
`2740e108d710217a3203b964a9433c123d2bb62800896dc10ae40d13b8b7dbdc`.
B1-wrapped R3 is `custom_firmware/build/usb_bridge_b1/r3/SP404MKII_APP1.bin`,
SHA256 `475835a7c076feeb6a7d4f3a4eddf50fcb215b64c3f59048d0eae40a6e061dc1`.
These paths are relative to the sibling firmware repository. The device's full
validator checks length, expected CRC and first word. FINISH and flash start
recompute CRC from staged RAM. The pinned host/build supplies SHA256 admission.

Staging occupies `[0x83000000,0x8337F000)`, a maximum of 3,665,920 bytes.
The APP1 writer uses flash offsets `[0x80000,0x3FF000)`, mapped at
`[0x60080000,0x603FF000)`. It retains resident/APP0 and the final 4 KiB sector.
For every sector it checks the chip/profile, erases, programs 256-byte pages,
compares the full 4 KiB through IP reads and then advances progress. The final
sector is padded with `FF`; sector zero is written last.

USB bus reset clears endpoint configuration and one-shot reports. It preserves
queued, writing, complete and error states (`4/5/6/7`), including the flash job
and result; earlier upload states reset. Fresh CPU and volatile-state
initialization is required for a post-update boot check.

All 24 shared inputs listed in the R48 manifest match their current files.
The retained R48 binary hashes to
`11d7631ea73232fbfe2bb30ca6a705f416417cb1aec54290a04944a26d7edba4`.
Its retained default-compatibility binary and historical R16B binary both hash
to `7bcc3537ea94288451738f14a428f44d87ca4db9887a27ad5bd3f99d05a16e2d`.
This review checked those artifacts without rebuilding. The historical R16B
package manifest and the later parameterized R48 source manifest remain
distinct records.

## Host admission and reset

[`prepareVirtualUpdateCandidate`](../src/lib/emulator/update.ts) owns the supplied
bytes, checks the recipient's policy, SHA256, CRC32 and first word, and returns
the exact reset extent, DATA-report count, sector count and padded readback size.
Select `target:'stock-r3'` for R16B or `target:'b1-r3-del-writer'` for R48.
Generic larger ABI1 and ABI2 images remain refused. The full-target plan contains
three explicit blockers: `large-control-budget`, `large-ip-observer` and
`target-fresh-boot`. Calling `update()` with such a plan's input returns
`large-execution-unqualified` before even a normal status read. No caller option
bypasses those blockers.

Small updates through R16B/R48 require `expectedRunningMarker` and
`expectedRunningSha256`. The latter must equal the retained normal binary:
R16B `7bcc3537ea94288451738f14a428f44d87ca4db9887a27ad5bd3f99d05a16e2d`,
R48 `11d7631ea73232fbfe2bb30ca6a705f416417cb1aec54290a04944a26d7edba4`.
The execution snapshot must agree before preflight, and the hash must remain
unchanged through the separate completion status. The
[update contract](emulator-update-contract.md) retains RAM CRC, successful
padded-sector comparison, fresh marker/state and exact target hash checks.

The new `App1ResetContract` supplies `length`, `sha256` and
`expectedCurrentSha256` to [`session.reset(target)`](../src/lib/emulator/session.ts).
Reset validates the complete retained target before changing the image, CPU or
board. It refuses stale running hashes, partial targets and concurrent changes
to the image or NOR during hashing. Explicit extent avoids the old no-ABI
fallback to the recipient's length: for R48 to B1/R3 that would have been
17,156 bytes. That defect was found statically; no fault fixture was run.
Generic no-target reset retains the existing ABI-length behavior.

The [Worker](../src/scripts/emulator-worker.ts) validates and forwards the target,
and the [RPC bridge](emulator-worker-rpc.md) preserves the argument. A runner's
reset callback must forward it as well: `reset: async target => { await
session.reset(target); /* bounded real guest boot */ }`. A successful small
ABI1 reset through the old length fallback does not establish this forwarding.

The optional selector value `b1-del-writer` names only the exact wrapped-R3
extent and SHA256. Runtime reset with that selector is refused while guest
qualification is absent. A later qualification must apply DEL after board reset
and before the first guest instruction, then execute the real
[selector](../../sp404mk2/sdk/examples/usb_bridge_b1/bridge_entry.S).
Active-low GPIO2 PSR bit26 selects the appended writer at `0x60308000`.
Required fresh evidence is mailbox magic `53503443` at `0x2023F000`, state2,
marker `52420001`, and guest `SP17`/version2/capability1/max `0x37F000`
status on `CAFE:4050`. Those fields describe writer startup; sampler readiness
needs a separate check.

The released selector replays stock entry words and branches to Thumb
`0x60080005`. Normal stock USB is `0582:02E7`, with no original marker command.
The [ordinary stock qualification](emulator-stock-qualification.md) uses pristine
stock SHA `4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80`,
which differs from both targets above. Complete stock boot remains open.

## Small-image guest qualification

The separate [small-image runner](../tools/test-emulator-larger-writer-small.mjs)
checks retained binary/manifests and source admission before execution. Its
default mode only prepares evidence; `--execute` runs one exact normal recipient
to R13 and back. It refuses other candidates and unknown arguments, requires
a fresh report filename and pins every emulator module, helper and runtime
asset before and after the run.

| Retained guest receipt | Host elapsed | Observed code-hook starts | Fresh markers |
| --- | ---: | ---: | --- |
| [R16B to R13 to R16B](../tools/emulator-evidence/r16b-r13-r16b-small-roundtrip-20261003.json) | 80,639 ms | 160,675,000 | `523D0001`, `52410001` |
| [R48 to R13 to R48](../tools/emulator-evidence/r48-r13-r48-small-roundtrip-20261003.json) | 80,800 ms | 160,675,000 | `523D0001`, `52620001` |

Both runs use repaired WASM
`399f9ca4eecc11d111d3182e251fbfb8ccc69e88f19f06650e945482eaf1a7d1`.
Their board `e35cb1f5...`, session `c0e47e2b...`, flash `2a887edf...`, VIDEO
and SD-fixture source pins remain stable within each receipt. Later model
changes require their own qualification. Host elapsed time describes these
emulator runs and may include concurrent host work; it is not SP timing.

The actual guest accepts its measured chip/profile, uploads and CRC-checks
15,396-byte R13 or the exact 17,156-byte recipient, then programs and compares
16,384 or 20,480 padded bytes. Passive command observations retain every
occupied sector's erase, sixteen pages and sixteen 256-byte IP reads. R16B/R48
compare each sector before advancing progress, with sector zero last; R13
compares its final image in ascending address order. Stored target bytes,
`FF` padding, resident prefix and all bytes outside the target sectors match
their guards. Installing smaller R13 preserves the recipient's fifth sector.

Each leg retains guest RAM state2, flash state6/error0 and a separate state6
status before forwarding exact target length/hash and the previous running
hash to `session.reset(target)`. At reset the instruction count is zero and
the actual mailbox is empty. Bounded guest execution then produces the new
marker, fresh idle USB fields and exact target hash. Both legs retain healthy
uncached backends and zero unknown MMIO/overflow. Returning the initial larger
small image restores each session's initial whole virtual NOR hash.

These Node sessions execute no browser Worker or physical USB API, transfer no
full stock/B1 target and apply no selector or injected fault. The
[prior focused prose](../tools/emulator-evidence/larger-writer-small-pre-doc-sync-20261003/manifest.json)
is preserved alongside the earlier source and host/mock receipts.

```sh
node tools/test-emulator-larger-writer-small.mjs --recipient R16B --execute --report tools/emulator-evidence/r16b-small-new.json
node tools/test-emulator-larger-writer-small.mjs --recipient R48 --execute --report tools/emulator-evidence/r48-small-new.json
```

## Remaining execution checks

FINISH and flash start synchronously CRC the full staged image. The current
per-token pump allows four million observed code-hook starts; large-image work
has no passing result under that bound. These targets need 47,370 or 47,703 DATA
reports and 648 or 653 sectors. A future runner must retain bounded aggregate
counts and exact sequential IP-comparison coverage, with a source-pinned bound
for CRC/control work. It must retain flash/readback and separate-status evidence
if fresh boot remains incomplete, without issuing a completed update receipt.
B1 as a recipient also needs its own validator audit before host admission.

Full-image qualification still needs exact target admission, actual guest
CRC/programming/readback, retained
NOR reset and B1 DEL-selected boot with the complete image extent. Normal
sampler startup remains a separate result. Historical physical evidence is in
the [R16B record](../../sp404mk2/custom_firmware/original_r16b/HARDWARE_RESULT.md)
and [R48 record](../../sp404mk2/sdk/examples/original_r48/HARDWARE_RESULT.md).

The small-image runner forwards `App1ResetContract`, pins the actual recipient
SHA256 and normal marker, and preserves status/frontier evidence on failure.
A future full-target boot branch must distinguish normal stock from B1's `SP17`
writer. Neither is an R13/R14/R15 boot receipt, and B1 is not yet admitted as a
recipient. Raising a poll limit or receiving a complete programmed-byte count
does not remove the execution blockers.
