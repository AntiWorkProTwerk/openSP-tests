# Larger virtual APP1 writer profiles

The reusable virtual update host currently implements R13, R14 and R15, each
with a 65,536-byte limit. R16B and R48 have larger staging buffers, but their
persistent image validators accept only a small ABI1 image or one pinned full
image. Extending the host requires separate contracts for the running writer,
the accepted candidate and the target's fresh boot. This is a source-review
proposal; the larger virtual host profiles and reset changes are not implemented.

The [source-pin receipt](../tools/emulator-evidence/larger-writer-source-review-20261003.json)
records checked source, reference and binary hashes. The review read files and
computed artifact hashes, lengths, CRCs and first words. It performed no builds,
guest execution or physical USB operations. Existing hardware records remain
separate evidence.

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

R16B's retained proof binary uses marker `52410002`. R48 defines proof marker
`52620002` only under `USB_PROOF`; its supplied binary and pinned host use the
normal marker. A future profile should admit a proof identity only with a
retained binary/manifest that establishes that build. Shared VID/PID or maximum
capacity alone cannot identify a compatible writer.

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

The proposed host work is:

1. Add explicit recipient profiles with source/binary pins and writer-specific
   image policies. Keep SHA verification, measured preflight, guest RAM CRC,
   complete padded IP readback, separate completion status and diagnostics
   captured before reset. Pin the expected running image as well as its status
   identity. The [current host contract](emulator-update-contract.md) supplies
   the existing transaction requirements.
2. Give retained-NOR reset an exact verified target extent and hash. In the
   reviewed [session implementation](../src/lib/emulator/session.ts), reset
   uses ABI metadata length or falls back to the old image's length. For
   R48 to B1/R3, that fallback is 17,156 bytes. This is a static finding; no
   failure fixture was executed. Reset must hash/load the complete committed
   target and execute its own prefix and startup.
3. Define a target boot contract independently of the recipient. B1 writer
   verification requires DEL input after board reset and before the first guest
   instruction, then execution of the real
   [selector](../../sp404mk2/sdk/examples/usb_bridge_b1/bridge_entry.S).
   Its active-low GPIO2 PSR bit26 selects the appended writer at `0x60308000`.
   Fresh B1 writer evidence is mailbox magic `53503443` at `0x2023F000`, state2,
   marker `52420001`, and guest `SP17`/version2/capability1/max `0x37F000`
   status on `CAFE:4050`. This establishes DEL-selected writer startup.
4. Give normal R3 startup a separate boot check. The released selector replays
   the stock entry words and branches to Thumb `0x60080005`. Normal stock USB
   is `0582:02E7`, with no original marker command. B1 writer startup does not
   establish sampler readiness. The existing
   [ordinary stock qualification](emulator-stock-qualification.md) uses pristine
   stock SHA `4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80`,
   which differs from both targets above; complete stock boot remains open.
5. Qualify bounded USB execution budgets and evidence storage for large images.
   FINISH and flash start synchronously CRC the full staged image. The current
   per-token pump limit is four million guest instructions, without a larger
   image qualification. With 56-byte chunks, these targets require 47,370 or
   47,703 DATA reports, then 648 or 653 sectors. Progress and trace summaries should stay bounded
   while retaining exact counts and verification checkpoints.
6. Retain verified flash/readback and separate-status evidence if fresh boot
   remains incomplete. An incomplete target boot must not produce a completed
   update receipt. B1 as a future recipient writer also needs its own image
   validator audit before host admission.

The first qualification should exercise small original images through each new
recipient profile and confirm a return update. Full-image qualification then
needs exact target admission, actual guest CRC/programming/readback, retained
NOR reset and B1 DEL-selected boot with the complete image extent. Normal
sampler startup remains a separate result. Historical physical evidence is in
the [R16B record](../../sp404mk2/custom_firmware/original_r16b/HARDWARE_RESULT.md)
and [R48 record](../../sp404mk2/sdk/examples/original_r48/HARDWARE_RESULT.md).
