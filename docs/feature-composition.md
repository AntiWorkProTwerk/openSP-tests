# Feature selection and firmware composition

The local `/features/` preview saves and exports a requested feature set for
Synth and the planned global USB recorder. No composed firmware is available
for these selections, and global recording remains unqualified. The B2 USB
update path has been verified on a modified SP that already has B2 installed;
first normal-USB installation from untouched stock remains unverified.
Autotune and stem splitting remain unavailable future work. No selected
combination has a delivery receipt in the website registry, so firmware build
and upload controls remain disabled.

## Public intent

[selection.ts](../src/lib/features/selection.ts) owns strict import, validation
and canonical export of `opensp-feature-selection` version 2. The intent binds
the board, firmware profile, registry revision, catalog digest and exact
feature versions. Each feature has an ordered symbolic shortcut or `null` for
the shared chooser. Imports are bounded to 32 KiB and reject extra fields,
stale versions, unknown controls, duplicate features and unavailable future
modules. The intent cannot carry executable code, firmware addresses or device
commands.

Configuration imports commit only while their request is current. A newer file
or any profile, feature, shortcut or reset change discards the older read and
its late errors. Failed browser storage is reported separately from a successful
import; export remains available. The
[import review](reports/feature-import-review.md) records the corrected races
and browser coverage.

```json
{
  "schema": "opensp-feature-selection",
  "version": 2,
  "registryRevision": "2026-10-04.2",
  "catalogDigest": "3a8d5663482fc19a5c56079a7cc56880ee7dae6226f312dc4a0498b8a3ed648a",
  "board": "sp-404mkii",
  "profile": "roland-5.52",
  "features": [{
    "id": "synth",
    "version": "p6s-1",
    "shortcut": {
      "controls": ["SHIFT", "RECORD_SETTING"],
      "trigger": "press-last",
      "scope": "sampler-idle",
      "rearm": "release-all"
    }
  }]
}
```

`catalogDigest` is SHA256 over the exact UTF-8 bytes of
`feature-registry.json`, one zero byte, then `physical-controls.json`. The
[catalog manifest](../src/content/feature-catalog-manifest.json) records both
source hashes and the combined digest. The
registry assigns `sampler-idle` to Synth and `normal-ui` to the recorder; the
parser checks each shortcut against its selected feature's registered scope.

`sampler-idle` is the requested idle sampler/Generator lifecycle for Synth. It
does not require audio transport to stop. The offline dispatcher uses its
`sampler-panel` context for that admission class and does not take transport
state as input. Physical Synth entry while a pattern plays remains unqualified.
`normal-ui` is the requested preview scope for sampler, pattern, FX and utility
panels. The offline dispatcher accepts those contexts and refuses unknown,
modal and update states. The native recorder adapter checks PANEL/task
readiness, but does not classify screens or inspect those uncertainty states.
Native refusal of them remains unqualified. The scope says nothing about USB
audio transport. These screen restrictions have not been verified on the SP.

For either scope, hold the first controls, press the last, then release every
control in that chord to rearm. Buttons and pads can form a chord; analog knobs
and VALUE rotation cannot. Validation refuses exact, reordered and subset
ambiguities, DEL, EXIT and SHIFT with PAD 13. Other collisions with stock
actions require review in the native compositor.

The picker stores version 2 under `opensp.feature-selection.v2`. It refuses
version 1 imports and leaves any version 1 browser value under its old key.
The frozen version 1 site source and seal remain in
[config-04 website sources](../../sp404mk2-synth/diagnostics/synth_p6/release_usb_delivery_v1/configuration/evidence/config-04/website_sources/manifest.json).

## Sources and qualification

[feature-registry.json](../src/content/feature-registry.json) describes
evidence, source pins, requirements, conflicts and readiness. The selectable
versions `p6s-1` and `spg1-v552-20` remain evidence pins; they are not a final
linked source family. The P6S physical trial covers Synth entry/reentry and its
PC recording path. The global SPG1 adapter targets v5.52 but has no complete
physical global recording result. Untouched stock supports USB audio/MIDI; it
supplies no verified display/control stream adapter. No qualified stem source
was found.

The [portable shortcut core](../../sp404mk2-synth/diagnostics/synth_p6/release_shortcuts_v1/README.md)
matches the symbolic shortcut fields. Its frozen handoff pins a 96-byte owner
and a 40-byte configuration; 32 compiled ARM groups cover ordering, rearm,
gaps, task/epoch/authentication, cancellation and pending tokens. The native
adapter must preserve stock dispatch, provide authenticated storage and route
accepted intents through actual feature owners. CPU tests do not establish
native page reachability, cold initialization or device behavior.

[composition.ts](../src/lib/features/composition.ts) checks a version 2
receipt's registry revision, catalog digest, canonical selection digest,
component pins, dependencies, exclusive owners, patch and memory overlaps,
lifecycle checks and bounded ABI2 APP1 image. It recomputes the digest from the
canonical version 2 export and always returns `uploadReady:false`. The checker
uses synthetic examples; receipt fields and supplied booleans do not establish
firmware qualification. The browser does not accept or trust these receipts.

## Local package metadata

[buildReceipt.ts](../src/lib/features/buildReceipt.ts) checks the version 3
local USB package contract against the current selection. It recomputes the
canonical intent digest and the 128-byte SPCF configuration from the public
control map, including each shortcut's final trigger. The configuration hash,
normal-session marker and chooser label must match that result. It also checks
source/module pins, profile labels and policies, declared section overlaps,
candidate extents and the exact B2 profile. An unknown dynamic arena address remains unknown; a metadata pass
does not establish allocator ownership or runtime performance.

The parser bounds JSON to 128 KiB and rejects duplicate fields. Package paths
remain metadata: the checker does not open files, fetch URLs or access a device,
and its returned summary omits paths. Private first-test grants and claimed
device qualification are refused by this disabled-package contract. Source-family
and artifact verification, download, upload and release readiness remain false.
The picker can inspect a local receipt without transferring it to a server.
Changing features or shortcuts clears the result, and pending reads cannot
restore an older selection's result. Invalid choices refuse inspection until
they are corrected. Build and upload controls stay disabled.
`npm run test:features` runs its cross-language vectors,
receipt mutations and existing selection checks, and is included in `npm test`.
The [receipt section](../design/penpot/feature-receipt.json) uses linked native
desktop/mobile components in both themes. Its shared copy is in
`src/content/features.json`; `FeatureReceipt.astro` supplies the semantic controls,
and `receiptSession.ts` owns asynchronous inspection and cancellation.

## Build and delivery path

This static website has no remote compiler or build service. Its public output
is a JSON intent. The [version 2 source-profile consumer](../../sp404mk2-synth/diagnostics/synth_p6/release_usb_delivery_v1/configuration/profile_successor_v2/README.md)
binds the intent and catalog digest to a checked 128-byte configuration table
and source profile. Its outputs are configuration data and build records, not
an APP1 image or device capability. The source-family lock pins the exact
synth-only, global-only and combined linked profiles; the combined profile is
owned by the full compositor. None of these profile records authorizes delivery.

Changing a selected feature currently needs a newly composed full APP1 image.
Independent runtime feature uploads and hot swapping are unverified. New full
images require the matched B2 ABI2 writer recipe; the older sender119 recipe
cannot deliver the newer full219/`.full_midi` layout. Roland v5.52 target
support does not identify or install B2. B2 must already be installed and
freshly identified; a first normal USB installation from untouched stock is
unverified.

Actual delivery must identify the running writer, check its chip/profile and
candidate format/size, verify complete flash readback and a separate status,
then confirm the exact new build after a real reboot. The picker performs no
device connection or delivery operation.
