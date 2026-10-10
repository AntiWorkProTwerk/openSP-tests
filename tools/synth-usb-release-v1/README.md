# Local openSynth USB delivery integration

This additive module admits the exact hardware-working P6S restoration for a
new owner-approved test through a compatible B2 writer. It authenticates the
retained source, historical hardware and completed browser-roundtrip evidence
before accepting the supplied bytes. Selected Source16 builds and the held N1
recording candidate remain blocked. Existing catalog entries, pages,
historical adapters and their disabled gates are unchanged.

The admitted image is `SYNTH P6S!`, SHA-256
`7f9917ffb0871cca25b1ce5d281ac5c2bf790ae6b8278b04a5ffef8e3c06fd60`:
2,741,144 bytes, ABI2, image CRC32 `BA6967B2`, 2,744,320 padded bytes and
670 sectors. Its current authority comes from the
[completed physical transaction](../../../sp404mk2/analysis/hardware/p6s_webhid_roundtrip_20261006T0246Z/README.md)
and the [additive offline review](../../../sp404mk2-synth/diagnostics/synth_p6/browser_usb_delivery_v1/p6s_roundtrip_v1/PHYSICAL_ROUNDTRIP_REVIEW_01.json).
Root observed the browser session; the owner reported normal title, sample and
Synth playback, two EXIT/reentry cycles, and a later cold DEL title. Two
independent physical HIDAPI reads confirmed fresh idle B2. The offline reviewer
checked the retained structure, file hashes and raw HIDAPI framing. These
evidence kinds remain separate.

## Interface

`release.ts` exports:

- `inspectPatcherHandoff(handoffFile, candidateFile, restorationFile)` checks
  the patcher's held JSON and binds its supplied bytes. It retains
  `DO_NOT_DELIVER`, reports candidate upload disabled, and grants no writer
  authority. The patcher's Node inspector owns source/artifact verification.
- `admitQualifiedP6SRestoration(restorationFile, evidenceFilesById)` requires
  every actual `P6S_EVIDENCE` file and the exact P6S bytes. Its opaque object
  authorizes only the restoration role. Clones and caller-created objects fail.
  Another verified source builder may deliberately pass its identical P6S
  restoration through this independent path without attaching its selected
  candidate receipt.
- `admitCandidate()` always refuses. The candidate authority registry is empty.
  A first owner test needs a separate root-sealed LOCALBENCH software authority;
  changing a caller's JSON flags cannot enable it. Public release remains held
  until the new candidate passes its actual hardware and reboot checks.
- `inspectUnqualifiedCandidate(file, declaredNormalIdentity)` derives the actual
  image hash, CRC, ABI2 intervals and padded extent for a future artifact. It
  reports envelope compatibility while retaining upload, runtime and hardware
  qualification holds. The supplied title remains a declaration requiring real
  runtime and owner confirmation. The result cannot be used as a transfer token.

Inputs use the browser `File`/`Blob` interface: `size` and `arrayBuffer()`.
Evidence paths in `authority.ts` identify retained files for local preparation;
the browser admits their bytes and does not fetch those paths. This code and
private inputs belong outside `public/` and `dist/`.

For a two-file local UI, `evidence-bundle.ts` exports
`admitQualifiedP6SRestorationFromEvidenceBundle(restorationFile, evidenceBundleFile)`.
The evidence bundle contains the 21 retained files as canonical base64, with no
firmware. Its decoder enforces a 1 MiB bound, exact IDs and individual original
digests, rejects extra/duplicate fields and files, and grants no candidate
authority. The restoration still passes the independent exact-image gate.
`prepare-evidence.mjs` creates a new bundle outside the website checkout; it
refuses an existing output file or redirected input/parent path.

```powershell
node --import ./tools/register-test-typescript.mjs tools/synth-usb-release-v1/prepare-evidence.mjs --synth-root ../sp404mk2-synth --output ../sp404mk2-synth/build/openSynth-p6s-evidence-01.json
```

The local builder must keep the selected candidate held and let the owner
deliberately choose the restoration file. Selecting an evidence bundle or a
byte-identical restoration does not automatically switch the chosen firmware.

## First candidate test

`local-bench-v1.ts` implements byte-bound first-test admission using
`opensp-priority1-owner-test-eligibility-v1`. It checks actual official,
source/tool, module ELF/BIN, recipe, native APP1, bridge and final image bytes.
Root must review exact-image linked audio, cold memory/lifetime, runtime,
recording workflow and pattern/click receipts before preparing a seal. Device
authorization remains a separate root action. The
[bench workflow](BENCH_README.md) defines proof roles, files and commands.

The first flash cannot require that same candidate's post-flash hardware proof.
Those later direct recording, save, pad/pattern playback, persistence, reentry
and cold DEL checks determine public qualification. Every bench write still
requires fresh B2/profile preflight, full padded-sector verification, a separate
reopened status, and normal/cold DEL checks after actual power removal.

Core-package-03 exists as `openSynth N1`, SHA-256
`9b754c96e69f141d419049eccdb4be7375b5bd1ad8880670edee24a850f241d8`.
Its 2,950,164-byte ABI2 image fits B2: CRC32 `B14200D7`, 2,953,216 padded bytes
and 721 sectors. Manual recording incorrectly depends on a running internal
pattern clock, so stopped-pattern recording fails. This exact image has an
explicit bench hold. The proposal at
`../sp404mk2-synth/build/openSynth-n1-bench-core03-01` preserves its static
checks and missing roles. A corrected final composition needs its own exact
image, receipts and root review.

The root registry remains empty. Admission refuses unregistered manifests
before reading candidate bytes or requesting a device. The seal CLI creates
reviewed manifest/seal bytes and an installation entry; it never installs that
entry itself. After root installs an approved exact entry, the module can create
a private candidate token for `LocalBenchUsbFlow`. Clones and caller-created
objects cannot use the driver. The new private8768 UI consumes a local snapshot
and opens no HID picker when admission fails. It has no browser or hardware
test result yet.

The additive [V2 first-owner review](ROOT_REVIEW_V2_README.md) restricts the
recording scope to one short stopped-pattern take, save, pad playback and EXIT.
V1's repeat scope remains unchanged. The complete final07 proposal has all
seven actual proof roles pinned and remains held for root review, seal and
registry installation. Repeat, persistence, 120-second recording and public
qualification remain pending.

`flow.ts` supplies `SynthUsbReleaseFlow` for a local UI. Import it through the
local tool's bundler; no application server is needed for its driver. The UI
must keep Connect, Write and the post-reboot Connect actions distinct. Picker
calls must start directly from the owner's click and leave device selection to
the owner. Render the current `phase`, show progress from Write, and make the
download available after success or failure. Start a new flow after a terminal
failure; never retry automatically.

1. Inspect the held handoff, then deliberately admit its P6S restoration with
   the authenticated retained evidence. Show the selected candidate as blocked.
2. After the owner's fresh full-power DEL boot and `USB BRIDGE B2` report,
   call `flow.connect()`. It opens the browser picker and checks idle identity
   and the chip/profile using opcode5 only.
3. On a separate explicit unchanged-P6S Write action, call
   `flow.write({unchangedP6S:true,currentColdDelTitle:'USB BRIDGE B2'})`.
   Write performs its own fresh preflight, uploads sequential bounded chunks,
   checks RAM CRC, commits APP1, requires the complete padded-sector extent,
   then closes and reopens the same authorized device for a matching status.
4. Download `await flow.downloadableReceipt()`. Storage success remains
   `storage-readback-verified-reboot-pending`. Ask for actual full power removal,
   normal `SYNTH P6S!`, known sample and Synth playback, and two EXIT/reentry
   cycles. Submit the owner's exact reply through `flow.reportNormalBoot()`.
5. After a second full power removal and the owner's DEL/B2 title report,
   call `flow.confirmColdDel()` from a new owner click. It opens a separate
   picker/handle, checks fresh idle B2 and profile, sends only opcode5, and
   closes. Download the completed attempt receipt again.

Owner declarations are reports, and browser-returned fields describe that
browser's observations. A downloaded receipt alone cannot authenticate physical
transport. An external observer can preserve its own evidence as root did for
the retained trial. This flow accepts no imported old boot or DEL receipt as
confirmation of a new attempt. The reset edge remains unmeasured.

## Writer and receipts

The supported endpoint is CAFE:4050, vendor usage FF00:1, product name
`SP404 USB BRIDGE B2`, report ID0/body64, protocol2, marker `52420201`,
maximum `37F000`, capability1. Each new write requires JEDEC `C22016`,
status `40`, ready1 and zero errors. The normal Roland endpoint is rejected.
Untouched-stock USB first installation is unsupported. Resident, APP0 and fuse
writes are absent.

`b2-driver.ts` preserves the physical trial's transport section byte-for-byte;
[DRIVER_PROVENANCE.json](DRIVER_PROVENANCE.json) pins the original source and
section. Types and bounded binary/JSON helpers were extracted, and private byte
ownership now comes from the exact P6S or root-sealed local bench gate. The historical adapter and
browser bundle retain their original hashes. `port-driver.mjs` reproduces the
port only from that exact source, and `seal-p6s-authority.mjs` authenticates the
retained authority files before producing their pins. Neither script builds
firmware or accesses a device.

B2 compares each padded sector internally and returns CRC over image bytes.
It supplies no host flash download or flash SHA-256. Success receipts retain
before/RAM/stored/separate parsed statuses, padded verification extent, progress,
image pin and reboot state. Failure receipts retain the failure stage and whether
commit may have been accepted. A timeout or disconnect preserves uncertainty;
it does not authorize another commit. Completion does not change candidate,
expanded/global/native recording or public readiness flags.

## Offline review

From the OpenSP checkout, inspect the retained transaction without compiling
firmware, opening a browser, or accessing HID:

```powershell
node --import ./tools/register-test-typescript.mjs tools/synth-usb-release-v1/inspect.mjs --synth-root ../sp404mk2-synth --restoration ../sp404mk2-synth/build/standalone-source-picker-v1/whole-02/restore-build/restore-p6s.disabled.bin --handoff ../sp404mk2-synth/build/synth-release-patcher-v1/retained-inspection-01/PATCHER_HANDOFF.json --build-root ../sp404mk2-synth/build/standalone-source-picker-v1/whole-02
node --import ./tools/register-test-typescript.mjs --test tools/synth-usb-release-v1/test-release.mjs
```

The handoff/build arguments are optional as a pair. The standalone inspection
also supports deliberate P6S restoration admission from another verified
source family. The tests require the real retained inputs and fail if they are
missing; `OPENSP_SYNTH_USB_EVIDENCE_ROOT` can identify their synth checkout.
Protocol tests use an explicit host model with no physical qualification.
No firmware compilation or device operation occurs.

## Existing local writer

The previously tested writer remains
[the exact P6S harness](../../../sp404mk2-synth/diagnostics/synth_p6/browser_usb_delivery_v1/p6s_roundtrip_v1/README.md).
From the synth checkout, its documented startup commands are:

```powershell
node diagnostics/synth_p6/browser_usb_delivery_v1/p6s_roundtrip_v1/serve.mjs --prepare-only
node diagnostics/synth_p6/browser_usb_delivery_v1/p6s_roundtrip_v1/serve.mjs 8767
```

This prepares a new local test record and bundles browser JavaScript with the
installed OpenSP esbuild dependency. It builds no firmware. The source-built
restoration remains `build/standalone-source-picker-v1/whole-02/restore-build/restore-p6s.disabled.bin`;
the preserved matching package remains
`build/p6r-reentry-p2-package-1/SYNTH_P6S_OFFLINE_APP1.bin`.
The server authenticates its fixed historical evidence and serves an in-memory
snapshot at `http://127.0.0.1:8767/`. Keep the separate read-only8766 page distinct.
Existing source/bundle pins and historical preparations remain the reference;
starting a new test does not rewrite its previous physical outcome. Root owns
browser/device access and fresh owner consent.
