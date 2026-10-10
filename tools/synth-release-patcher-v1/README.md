# Local openSynth patcher integration

N1 release, builds and testing are withdrawn after the owner reports missing pads. Use [the withdrawal guard](withdrawal-guard-v1/README.md) and `current.mjs` for the current read-only status. It refuses build, recording-test, upload and publication actions. Frozen source kits and the commands below preserve historical evidence; their passing byte receipts do not qualify sample preservation. P6S firmware restoration is not a sample or project backup, and missing-pad recovery is unestablished.

This additive command authenticates the owner's unchanged official Roland v5.52 input, exports one fixed synth-only selection and connects the existing standalone source builder to a byte-bound local handoff. Compilation uses installed Python and Arm tools. The website has no browser ARM compiler.

The compact openSynth release is being prepared for direct recording from the synth into a pad. Its visible identity is `openSynth N1`; the internal candidate identifier remains P6N1. The additive [compact source patcher](compact-v1/README.md) now admits the candidate owner's fixed source kit09 and inspects its complete core package. Its software, hardware and public eligibility remain false. `source16-build` invokes the historical 151-unit Source16 builder and its 27-unit P6S restoration. It does not build P6N1 or establish working direct pad recording. These artifact identities remain separate.

The planned openSynth workflow is REC, choose an empty pad, REC to start, then REC to stop and save. EXIT cancels the destination chooser. The owner reports a working native Skip Back preview on P6S; that result is separate from the requested direct recording workflow. Direct capture, save and pad playback still need the new candidate and physical verification.

From the OpenSP repository, export the fixed selection to a new file outside the website:

```powershell
node --import ./tools/register-test-typescript.mjs tools/synth-release-patcher-v1/run.mjs --mode selection --output NEW_PRIVATE_SELECTION.json
```

The historical source route remains available for local review:

```powershell
node --import ./tools/register-test-typescript.mjs tools/synth-release-patcher-v1/run.mjs --mode source16-build --selection NEW_PRIVATE_SELECTION.json --official OWNER_V552.zip --python PINNED_PYTHON.exe --toolchain-root PINNED_ARM_ROOT --output NEW_PRIVATE_OUTPUT
```

Use the exact external dependencies and preparation instructions in [the standalone build guide](../feature-picker-release-v1/STANDALONE-BUILD.md). The existing reviewed source-only archive is reused unchanged. Official ZIP and APP1 inputs must match their complete byte identities before any output or compiler invocation. Different firmware versions, changed inputs, caller commands, macros, hashes and source overrides are refused.

An existing complete standalone transaction can supply its exact source-built P6S fallback without another firmware build:

```powershell
node --import ./tools/register-test-typescript.mjs tools/synth-release-patcher-v1/run.mjs --mode restoration-inspect --official OWNER_V552.zip --build EXISTING_STANDALONE_TRANSACTION_BUILD --output NEW_PRIVATE_OUTPUT
```

Inspection authenticates the source archive, all source/license identities, canonical selection, official-input binding, candidate and restoration bytes, and parent/child read receipts through the existing inspector. It accepts historical combined and single-feature transactions, labels their selected candidate as historical and leaves it held. `PATCHER_HANDOFF.json` records hashes, CRCs, padded-sector extents and B2 ABI metadata for both artifacts. Paths are relative labels within the inspected transaction.

Every handoff keeps release, browser build/upload, native qualification and device operations disabled. It grants no writer authority. The separate USB adapter must authenticate its own exact-P6S delivery authority and supplied restoration bytes. P6S restoration is 2,741,144 bytes with SHA256 `7f9917ffb0871cca25b1ce5d281ac5c2bf790ae6b8278b04a5ffef8e3c06fd60`; P6S has 16 sounds and four voices, with its direct recording feature disabled. Ordinary stock USB installation remains unsupported by this workflow.

The compact core's source inventory, fixed build entry, compiler authority and derived recipe now have a separate closed admission. The later pattern and metronome joins need a distinct source/candidate authority. Normal record/SAVE/saved-pad playback, repeat-take, persistence, memory/runtime and USB acceptance remain separate requirements. A locally passing receipt cannot enable delivery.

Outputs must be new and outside the website repository. Existing successful and failed outputs are preserved. A build or receipt failure after execution writes `PATCHER_REFUSAL.json`; the underlying standalone launcher retains its own logs and refusal evidence. Inspection failures create no accepted output.

Run focused tests without compiling firmware:

```powershell
node --import ./tools/register-test-typescript.mjs --test tools/synth-release-patcher-v1/test-patcher.mjs
```

Set `OPENSP_SYNTH_PATCHER_BUILD` and `OPENSP_SYNTH_PATCHER_OFFICIAL` explicitly to exercise a retained real standalone transaction and its unchanged official input. `OPENSP_SYNTH_PATCHER_PYTHON` enables two normal build-entry refusal checks using an inert child and a matching interpreter identity. Those checks include the normal inspection command and changed candidate/restoration, receipt, authority, selection, delivery and transfer metadata refusals. They invoke no firmware compiler or device.
