# Private openSynth first-test workflow

The local bench gate prepares an exact candidate for its first owner test.
Root reviews software evidence and installs a specific manifest/seal hash pair.
Public release and candidate hardware qualification remain false. Root
authorizes device access separately. No same-candidate post-flash proof is
required before that first test.

The retained proposal is `../sp404mk2-synth/build/openSynth-n1-bench-core03-01`.
Manifest SHA-256: `258021914c5f83ea2ddc22ea3b2916e04ad9187137ef4b92bcc17cc7468cae71`.
Actual source authority, built source, object and stack receipt reads passed
(347, 304, 105 and 92 files). The source/tool/module/image receipt preserves
the producer's multiphase compiler provenance and read-tracing limitations.
Toolchain authority declares 1,874 pinned tool files; the qualifying source
receipt owns their verification. No compiler was rerun.

Core03's stopped-pattern recording defect prevents sealing. Its static B2
size/profile check remains useful. Audio, cold memory/lifetime, runtime,
recording flow, final pattern/click composition and root review remain missing.
A corrected successor needs new exact-byte snapshots and receipts.

The successor now has a separate [held final05 proposal](FINAL05_README.md).
Its exact 722-sector APP1 and kit11 source replay pass static byte checks;
linked software roles and root review remain pending. The first-test runtime
scope permits software timing models and static memory headroom with their
stated fixture limits. Physical deadline, durable save/persistence and
120-second recording are later owner acceptance checks.

The next single-entry correction has a separate
[held final06 proposal](FINAL06_README.md), with exact successor hashes,
108 retained units and one newly compiled entry5 unit. Narrow receipt retargets
preserve their limits. Actual pattern and SAVE/lifetime reviews remain pending;
the root registry stays empty.

Root has authorized an additive [restricted V2 review](ROOT_REVIEW_V2_README.md)
for one stopped-pattern take, save, playback and EXIT. V1's repeat scope is
unchanged. The complete07 V2 proposal is held solely for root review; its
receipts retain their carryforward, measurement and physical-test limits.

## Files and proof scopes

`prepare-bench.mjs` snapshots 20 artifacts: official ZIP, source archive/handoff,
source/toolchain authorities, source contract, builder entry, build report,
module ELF/BIN/map/ELF map, recipe, native APP1, compiler ledger, read boundary,
B2 ELF/tail/hook and B2 contract. Candidate and restoration remain separate.
The exact P6S restoration passes its unchanged 21-file evidence admission.

Each qualifying JSON receipt must contain `subject` with exactly
`candidate_sha256`, `module_elf_sha256`, `module_sha256` and
`source_contract_sha256`. Hashing an inventory or arithmetic receipt grants no
runtime authority. Root reviews these exact scopes:

| Role | Required scope |
| --- | --- |
| `source_tool_module_image` | `exact-final-source-tools-module-image` |
| `b2_size_profile` | `exact-abi2-b2-capacity-and-qualified-chip-profile-contract` |
| `audio` | `exact-linked-native-audio-64-frame-path` |
| `cold_memory_lifetime` | `exact-linked-cold-clear-owner-lifetime-memory` |
| `runtime` | `exact-linked-runtime-deadline-and-headroom` |
| `recording_flow` | `exact-linked-chooser-record-stop-save-repeat` |
| `composition` | `exact-final-pattern-click-composition` |

`ROOT_SOFTWARE_REVIEW.template.json` starts with held conclusions. An approved
review uses schema `opensp-priority1-root-software-bench-review-v1`, version1,
the exact subject, decision `APPROVED_FOR_FIRST_OWNER_TEST_ONLY`, and `checks`
containing all seven roles. Each check has exactly `scope`, `conclusion`,
`receipt_ids` and `limitations`; its conclusion is `PASS_FOR_FIRST_OWNER_TEST`.
Receipt IDs must match the manifest's exact role references. Public eligibility
and same-candidate prior hardware requirements remain false. Missing proofs,
changed subjects, unsupported scopes or the known core03 defect prevent sealing.

## Preparation and root seal

Run from OpenSP. A proof config maps the seven role names to arrays of actual
receipt paths. Use a final joined package and its corresponding source kit and
receipts. Outputs must be new directories outside the website checkout.

```powershell
node --import ./tools/register-test-typescript.mjs tools/synth-usb-release-v1/prepare-bench.mjs --package-root FINAL_PACKAGE --source-kit FINAL_SOURCE_KIT --source-archive FINAL_SOURCE_ARCHIVE --source-handoff FINAL_SOURCE_HANDOFF --official ../sp404mk2/firmware/v552/sp404mk2_sys_v552.zip --restoration ../sp404mk2-synth/build/standalone-source-picker-v1/whole-02/restore-build/restore-p6s.disabled.bin --evidence-bundle ../sp404mk2-synth/build/openSynth-p6s-evidence-01.json --proof-config EXACT_PROOF_PATHS.json --output NEW_PROPOSAL_DIRECTORY
node --import ./tools/register-test-typescript.mjs tools/synth-usb-release-v1/seal-bench.mjs --transaction NEW_PROPOSAL_DIRECTORY --root-review ACTUAL_ROOT_REVIEW.json --root-review-sha256 ROOT_REVIEW_SHA256 --output NEW_SEALED_DIRECTORY
```

The seal CLI checks the independently approved review digest and every owned
byte binding. It emits a revised eligibility manifest, `ROOT_BENCH_SEAL.json`
and `ROOT_BENCH_AUTHORITY_ENTRY.json`. Root must review and install the entry's
four exact size/hash fields in `root-seals-v1.ts`. The CLI never installs it.
The frozen registry is empty. Caller flags and copied objects cannot admit an
image. Device authorization remains separate.

## Private browser handoff

After root installs the exact entry and authorizes a device test:

```powershell
node --import ./tools/register-test-typescript.mjs tools/synth-usb-release-v1/serve-bench.mjs NEW_SEALED_DIRECTORY 8768
```

The server snapshots fixed files at `http://127.0.0.1:8768/`, accepts GET/HEAD
only, and bundles JavaScript without compiling firmware. It stays separate
from P6S writer8767 and read-only8766. The page authenticates the manifest/seal
and all bytes before enabling Connect. Serving the held core03 proposal enables
offline inspection; its page cannot admit an image or open a HID picker. This
new page has no physical or browser-control test result.

The B2 transport section is unchanged from the completed P6S trial. Connect,
explicit Write and fresh cold-DEL Connect remain separate owner actions. Write
performs fresh identity/chip/profile preflight, all padded sectors and a status
read through a reopened handle. Storage success remains reboot pending.
Owner checks cover normal title/sample/Synth/reentry, stopped-pattern recording,
chooser/save/pad playback, repeat, pattern/click and a separate cold DEL boot.
A new idle B2 read follows that report. Downloadable attempt receipts separate
owner reports from browser observations, preserve write uncertainty and forbid
automatic retries. They grant no public or physical qualification themselves.

Focused checks run with:

```powershell
node tools/synth-usb-release-v1/validate.mjs VALIDATION_04.json
```

Tests require retained real artifacts and use a host protocol model. They
exercise refusals and the existing exact P6S transport model. A root-registered
candidate success path remains unexercised until actual qualifying receipts
and an approved successor exist. No firmware compilation, device operation
or publication occurs.
