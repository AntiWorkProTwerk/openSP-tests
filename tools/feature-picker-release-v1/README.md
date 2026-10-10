# Local feature-picker build and staging

For the reviewed standalone workflow, use
[`standalone-build.mjs`](standalone-build.mjs) and
[its build and installation guide](STANDALONE-BUILD.md). Supply a canonical
feature-picker export, the owner's unchanged official v5.52 firmware, matching
external Windows Python/Arm tools and the included authenticated source archive.
Each build compiles the selected 151-unit module and its 27-unit P6S restoration
without adjacent private workspace, template or history dependencies. Its local
report keeps expanded hardware, browser build/upload and public release flags
false; generated firmware stays outside website assets.

The [additive local browser workflow](browser-successor-v1/README.md) connects
that canonical selection to the same real local builder, checks the matching
source/artifact receipt and complete candidate, and prepares a held B2 handoff.
Its selected-image upload and public release flags remain false.

## Historical private-workspace build and staging

`run.mjs` connects the current OpenSP configuration export to the real local
Source16 builder and stages a matching disabled candidate and receipt. It uses
the supplied official Roland v5.52 bytes to derive the pinned R3 baseline, then
replays the actual native recipe and B2 package APIs. Every result remains
`DO_NOT_DELIVER`. Native feature routes, runtime ownership, startup, recording
and physical delivery still need qualification.

Run these commands from the OpenSP repository root. The adjacent
`sp404mk2-synth` and `sp404mk2` workspaces must contain the frozen
[Source16 handoff](../../../sp404mk2-synth/diagnostics/source16_local_build_v1/HANDOFF-02.json),
its source foundation, private package inputs and installed ARM toolchain.
This is a workflow for the existing private workspaces. It is not a standalone
public compiler distribution. The verified environment is Node 24.20.0,
Python 3.14.6 and the existing local ARM toolchain. Install OpenSP's locked
Node dependencies before using its TypeScript loader. `--python` can select
another installed Python executable; `--synth-root` can locate the adjacent
private workspace. Dependencies retain their pinned hashes.

On the local `/features/` page, choose supported features and valid shortcuts,
then use **Export configuration**. Save the resulting
`opensp-feature-selection-v2.json` outside `public/` and `dist/`. The CLI
accepts exactly the canonical bytes from the current exporter, including its
final newline. The pinned catalog revision is `2026-10-04.2`, digest
`3a8d5663482fc19a5c56079a7cc56880ee7dae6226f312dc4a0498b8a3ed648a`.

Supply your unchanged official `sp404mk2_sys_v552.zip` or its unchanged
`SP404MKII_APP1.bin`. The ZIP has 1,966,465 bytes and SHA256
`ffe5cbbbc971383bcbef34959ea32cb36470d3c9eadad296f52bc4ea6a3cb3c5`;
APP1 has 2,652,672 bytes and SHA256
`4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80`.
The CLI never downloads firmware. It copies seven authenticated R3 patch
intervals onto those supplied official bytes and requires the full derived
image to match R3 SHA256
`2740e108d710217a3203b964a9433c123d2bb62800896dc10ae40d13b8b7dbdc`.
The existing private R3 candidate supplies those intervals; this dependency
must be retained for local staging.

For a repeatable example, these variables select the retained configuration
export with custom Synth and recorder chords. Change `$pickerSelection` to
your newly exported file for normal use:

```powershell
$pickerSelection = '../sp404mk2-synth/build/source16-local-build-v1/runs/custom-combined-pad34-05/selection.json'
$pickerOfficial = '../sp404mk2/firmware/v552/sp404mk2_sys_v552.zip'
$pickerRunner = 'tools/feature-picker-release-v1/run.mjs'
```

Plan mode validates the configuration and dependencies, derives R3 from the
supplied official input and saves the exact builder command. It performs no
compilation. Each invocation requires a new run key; existing attempts remain
untouched, including failed ones.

```powershell
node --import ./tools/register-test-typescript.mjs $pickerRunner `
  --mode plan --selection $pickerSelection --official-base $pickerOfficial `
  --run my-selection-plan-01
```

Build mode compiles all 151 Source16 translation units for the selected features
and shortcuts, prepares their recipe, validates the source family, emits a
disabled package and replays it from the supplied-file-derived R3 baseline.
It stages the resulting bytes only after the current website receipt inspector
accepts the exact selection and keeps all readiness flags false.

```powershell
node --import ./tools/register-test-typescript.mjs $pickerRunner `
  --mode build --selection $pickerSelection --official-base $pickerOfficial `
  --run my-selection-build-01
```

The builder's output for that command is
`../sp404mk2-synth/build/source16-local-build-v1/runs/picker-my-selection-build-01/LOCAL_BUILD_REPORT.json`.
Stage mode can reuse that successful report. It validates the original compile
evidence and replays the package without compiling again:

```powershell
node --import ./tools/register-test-typescript.mjs $pickerRunner `
  --mode stage --selection $pickerSelection --official-base $pickerOfficial `
  --build-report ../sp404mk2-synth/build/source16-local-build-v1/runs/picker-my-selection-build-01/LOCAL_BUILD_REPORT.json `
  --run my-selection-stage-01
```

Each successful build or stage places `selection.json`, `receipt.json` and
`candidate.disabled.bin` together in
`../sp404mk2-synth/build/feature-picker-release-v1/runs/<run-key>/stage/`.
Import that `selection.json` on `/features/`, then choose its `receipt.json`
under **Check a build receipt**. The page compares metadata with the current
choices. `STAGE_REPORT.json` and the candidate's SHA256 identify the matching
private firmware bytes. Changing the selection invalidates that match. The
browser does not read the candidate file or authenticate its source family.
Build, download, upload and release readiness remain false.

`REQUEST.json` records the exact selection hash, supplied official input,
frozen dependency hashes, builder command, local glue hashes and interpreter
versions. `BASE_PROOF.json`, `PACKAGE_REPLAY.json`, `WEBSITE_INSPECTION.json`
and `STAGE_REPORT.json` record the derivation, strict private validation and
metadata match. The stage report pins its originating build report, source
family and compile ledger. `source_recompiled` is true only for build mode;
the replay helper itself always reports that it did no compilation. A failed
attempt saves `FAILED.json` after its private run directory is created. Input
and dependency refusals can happen before that directory exists.

The frozen handoff, public catalog, exporter, receipt inspector, local builder,
strict validator and package entry points are checked before execution.
Direct config/build/preparation/B2 helpers are pinned too. Staging rechecks
these dependencies, the supplied input and saved artifacts before accepting its
result. The strict family validator separately checks the foundation-derived
565-file source snapshot, 1,099 inherited provider inputs, copied controls
files, 151-object compile ledger and ordered native recipe. Build reports or
receipts claiming native, hardware or delivery eligibility are refused.

The build report's selection, compile ledger, source manifest, ELF, module BIN,
configuration and recipe must also match the selected source-family pins.

Verification uses the actual private artifacts and current website modules:

```powershell
node --import ./tools/register-test-typescript.mjs --test tools/feature-picker-release-v1/test-runner.mjs
node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/test-cli.mjs
node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/verify-integration.mjs
```

The CLI refusal test creates new private fixture folders with a unique key;
an optional final argument supplies that key. The integration verifier checks
the retained examples by default, including the fresh build. An optional first
argument names a new report key; following arguments select existing stage
run keys. Both commands preserve prior reports and require the local evidence
files referenced in their source.

The October 5 check passes 18 runner tests and 16 real CLI refusal cases in
`../sp404mk2-synth/build/feature-picker-release-v1/cli-review-04/REPORT.json`.
The earlier `cli-review-02` attempt stopped when the website inspector refused
a forged receipt sooner than the test expected: the fixture changed the
candidate hash but left its nested file hash unchanged. Correcting both fields
allowed the intended native-replay refusal to be tested. The original inputs
remain unchanged. Static review then found that the report's compile-ledger
pointer lacked a direct comparison with the selected family's pointer. The
corrected glue checks that binding and refuses substitution of another genuine
151-object ledger. Pre-fix acceptance was not reproduced. The eight-stage
independent verification is
`../sp404mk2-synth/build/feature-picker-release-v1/integration-report-04.json`.
It reruns the current receipt inspector and checks all 151 fresh object files,
ELF and module BIN in each of the two fresh builds against their saved pins.

The fresh `combined-build-02` command compiles 151 units and produces a
3,016,664-byte candidate with SHA256
`842aba547178221a0546b919e3ef1908fa3dfa5daf3c3d0ee5cff601da5e7cdf`.
Its build report SHA256 is
`b5f6f1b530b6f89d03204bbe0fcc20d4c4ded6c490be8add76be45d4ecdbfd7b`.
`combined-app1-stage-02` independently stages the same candidate from the bare
official APP1 input. The earlier custom Synth, recorder, combined and shared
chooser stages remain preserved. Final `combined-build-04` recompiles all 151
units with the report-to-family binding guard and produces the same candidate
hash. Its build report SHA256 is
`123c823af9cdc837bd21aacb9abf9e1275902246341564deaf26a8005d11eea9`;
its staged receipt SHA256 is
`a1c22fcea2ce88f1da1e1920bbf95ea454858e45d916e2bc16995488b14e3db2`.
These are offline build and package results. No browser connection, device
operation or publication occurred.

All generated firmware, receipts, raw logs and test fixtures stay under the
adjacent private synth `build/` tree. This tool directory contains source and
instructions only, and no browser module imports the private runner. Never
copy its outputs into OpenSP `public/`, `src/`, `dist/` or committed website
assets. Receipt JSON is selected locally for inspection; it is not a site
asset. Request and failure records may contain local paths and stay private.

The standalone entry above provides the reviewed source/build dependency path;
this historical runner retains its private dependencies. Public feature-picker
delivery still needs qualified native shortcut and shared-chooser entry,
startup and runtime ownership, recording/SAVE/reentry/playback and resource/timing
evidence for the selected candidate. The standalone report has no browser source
family admission, and selection-to-build-to-upload remains held.

The [exact unchanged P6S roundtrip](../../../sp404mk2/analysis/hardware/p6s_webhid_roundtrip_20261006T0246Z/ROUNDTRIP_REVIEW.json)
has physical WebHID storage, all 670 padded-sector
comparisons by B2, separate final status and owner-reported normal/DEL cold-boot
evidence. Expanded candidates, global capture and native recording into pads
remain unqualified. A different candidate needs its own established USB writer
preflight, full padded verification, separate status and fresh normal/DEL reboot
evidence. Untouched stock has no verified normal USB-C first-install path. These
local CLIs contain no device transport and provide no delivery authorization.

[Separate portable local staging](PORTABLE.md) admits three exact reviewed private
portable profiles through an external pinned verifier. It leaves this legacy
builder/family contract intact and preserves the delivery and publication holds.

[Request-bound portable local builds](PORTABLE-BUILD.md) accept canonical supported
Roland v5.52 Synth/recorder exports through a fixed private source/compiler/verifier
authority. The website build/upload controls remain disabled. The legacy family
validator permits shared chord controls only when they are SHIFT; the separate
portable path retains the current exporter's non-subset overlap semantics.
