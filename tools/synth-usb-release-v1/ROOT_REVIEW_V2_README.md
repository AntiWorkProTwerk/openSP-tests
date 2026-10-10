# Restricted first-owner review V2

Root authorized a separate first-owner scope for one short stopped-pattern
recording, SAVE, destination-pad playback and EXIT. A second CPU take is not a
prerequisite for this scope. Repeat, persistence, 120-second recording and
public release remain unqualified. V1 retains its original recording-repeat
scope and all historical held snapshots remain unchanged.

V2 uses schema `opensp-priority1-root-software-bench-review-v2`, version2,
with these required fields:

```json
{
  "first_owner_test_scope": "single-stopped-pattern-take-save-playback-exit",
  "repeat_qualified": false,
  "public_release_eligible": false,
  "same_candidate_prior_hardware_required": false
}
```

The remaining root-review fields are the exact four-hash `subject`,
`decision: APPROVED_FOR_FIRST_OWNER_TEST_ONLY`, and seven `checks` rows.
Each row binds its exact receipt IDs and limitations. Only the recording role
changes scope to `exact-linked-chooser-record-stop-save-first-take`; the other
six scopes remain the V1 values. V2 rejects unknown fields, different version
pairs, broadened scopes, empty proof references and repeat/public promotions.
The schema check grants no transfer authority. Actual bytes and the separately
root-installed manifest/seal pair remain mandatory.

The complete held proposal is
`../sp404mk2-synth/build/openSynth-n1-bench-final07-v2-02`, manifest 6,277 bytes,
SHA-256 `a988e381214427084872924860f1d8f0b62e1ff332f1841f76ee5761c59bee1d`.
Every root template row is `UNREVIEWED_HELD`; root review is the remaining
structural blocker. The registry is empty and no seal has been created.

| Exact subject | SHA-256 |
| --- | --- |
| Candidate | `7881b5c18e4cdd83a405349109c05822b23bd6e38f1df37b264eafe558756f48` |
| Module ELF | `5834f87701511527adade93e71efa1e42216a4baa1fd996efa0decbc5d92ff34` |
| Module BIN | `a0bee79362406797c201d0861e1c07867dac2a3075d81156d89ffecc825e54bb` |
| Source contract | `a11eafed062a87c459281274438f6bf9ef1bab453e356281e801a962c501c59b` |

The APP1 is 2,954,640 bytes, CRC32 `6BFFF3F6`, padded 2,957,312 bytes/722 sectors.
Thirty frozen candidate-handoff pins passed. Preparation authenticated
356 source-authority files, 310 built source files, 109 objects, 96 stack
receipts and 202 patches. The producer retained 108 units and compiled unit106
before a fresh link. Tool and prehook tracing limitations remain explicit.
B2 provider bytes match physical P6S except its two package/module size fields.
Fresh device preflight, padded readback, separately reopened status and real
reboot checks still apply. Exact P6S restoration and 21 evidence files remain.

## Frozen owner adapters and scope limits

The pattern and recording owners used `exact_subject` in their frozen receipts.
The additive adapters expose validated `subject` while retaining every original
byte as canonical base64, its original digest, declared scope and measured
subject. Twelve pattern and seven recording artifact pins passed independent
reads. The adapters grant no new qualification and leave the raw receipts
unchanged. Root reviews the raw receipts together with their adapters.

The pattern receipt contains current bounded copied-input and native-request
execution. Native worker completion remains unmeasured. Metronome V7 is a
reviewed source/byte/relocation carry of historical V5 execution, with no new
CPU run. Runtime V7 carries bounded V6 audio/timing/cold observations under
reviewed current source/object equivalence; it reports no new V7 instruction
measurement. First-take SAVE/playback/EXIT uses the owner's reviewed current
typed carry from measured final05. Current07 SAVE/playback execution, repeat
and persistence remain false in that receipt. V2 does not relabel any of these
as new execution or physical results.

## Root handoff

Root reviews all seven roles, writes a separate approved V2 review from the
held template, and supplies its exact independently checked SHA to the existing
seal CLI. The CLI does not install registry authority. Root then reviews and
installs the generated entry and separately authorizes device access, following
the [bench commands](BENCH_README.md).

`prepare-bench.mjs --root-review-version 2` creates a held V2 template; the
default remains V1. `serve-bench.mjs` selects the V2 controller/page only from
the admitted manifest's checked V2 root review. `SingleTakeBenchUsbFlow`
requires that opaque restricted token and records one take/save/playback/EXIT.
It keeps repeat, persistence, 120-second and public qualification false.
V1's controller continues to require its existing repeated-take checks.

Validation: 73 focused tests pass without skips, strict TypeScript includes the
typed V1/V2 schema fixtures, and both browser entries bundle. Schema fixtures
stay in memory and create no root approval or authority. The V2 success path
has no browser or device trial. No compiler, seal, registry, server, browser,
USB or publication action was performed here.
