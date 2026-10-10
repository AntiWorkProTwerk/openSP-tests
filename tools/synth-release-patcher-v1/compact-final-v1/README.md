# openSynth N1 source patcher

This fixed Windows workflow uses sealed source kit11 and the owner's unchanged official Roland v5.52 firmware. It builds 109 units for the sixteen-sound, four-voice synth, direct recording to an empty pad, pattern controls and native recording click. Direct recording has a 120-second limit. Source admission does not qualify those features on the SP.

The included `source-final11.zip` is 773,860 bytes with SHA256 `9a2cf2547002893cc76113263a7c9b3e06fa212e79a057d35f710b3d4ac4ac55`. The patcher admits its 358 source and license members, fixed compiler entry, 310 module inputs and compiler authority. Caller feature switches, hashes, macros and replacement commands are refused. Historical core09 and Source16 outputs have separate preserved workflows and cannot enter this recipe.

Supply exact official firmware and P6S restoration bytes, the admitted Windows Python 3.12.14 and Arm GNU 14.3.Rel1 installations, and a new output directory outside website assets. Follow [the dependency guide](DEPENDENCIES.md) for the publisher archives, Python alias and compiler metadata template. Node 22.12 or later runs this CLI without website or browser dependencies. The source entry checks installed Python roles and 1,874 Arm inputs before compiler work.

Inspect a retained final package without compiling firmware:

```powershell
node tools/synth-release-patcher-v1/compact-final-v1/run.mjs --mode inspect --source-archive tools/synth-release-patcher-v1/compact-final-v1/source-final11.zip --official OWNER_V552.zip --restoration EXACT_P6S.bin --build EXISTING_FINAL_PACKAGE --output NEW_PRIVATE_OUTPUT
```

Build through the authenticated source entry:

```powershell
node tools/synth-release-patcher-v1/compact-final-v1/run.mjs --mode build --source-archive tools/synth-release-patcher-v1/compact-final-v1/source-final11.zip --official OWNER_V552.zip --restoration EXACT_P6S.bin --python PINNED_PYTHON.exe --toolchain-root PINNED_ARM_ROOT --output NEW_PRIVATE_OUTPUT
```

The output's parent directory must exist. The child receives structured arguments with `-I -S -B`, a reduced environment and no shell. A normal build compiles all 109 units, links them and builds the original R3/B2 envelope from source. It does not regenerate the separate P6S restoration. Source materialization, compiler logs and refusal records remain available for review.

Success produces `COMPACT_INSPECTION.json`, `COMPACT_HANDOFF.json` and `COMPACT_INPUT_BINDING.json`. Inspection verifies the copied sources, objects, dependencies, FILE ABI consumers, stack receipts, ELF sections, fixed link command, 202 native patches and complete APP1 replay. It independently checks the 2,954,632-byte candidate, padded 722-sector extent, CRC and exact 670-sector P6S restoration. Handoffs bind the official input, source, entry, recipe, report and artifact identities.

The retained final-package05 was assembled with 101 authenticated reused units, eight newly compiled units and a fresh link. Its handoff records those counts and leaves `canonical_entry_completed` false. A normal successful build must provide 109 fresh compiler-command rows before the owning patcher attests its own completed entry. Inspecting saved receipts later provides no execution attestation.

Pattern and click source joins are present. Their normal-route and combined-start qualification remain false, as do software eligibility, hardware qualification, public release and every delivery flag. A handoff grants no writer authority. Root's separate runtime decision and physical recording, SAVE, pad playback, persistence, repeat-take and USB checks are still required. The P6S fallback keeps its historical `SYNTH P6S!` identity and independently qualified restoration path.

The companion source-only review ZIP preserves MIT attribution and vendor exclusions. It includes the wrapper, compact source, dependency metadata and unchanged restoration source bundle. It contains no official firmware, generated firmware, compiler binaries or hardware captures. Source promotion and publication remain separate. Compiler-internal, OS and Python standard-library reads are outside the recorded Python audit scope.

The focused review passes 44 checks with zero skips, including actual final-package replay, historical kit09/core03 refusals, altered link and component receipts, an inert child refusal and the actual isolated entry's incomplete-tool refusal. No firmware compiler, browser or device ran. To repeat with retained evidence, set `OPENSP_COMPACT_FINAL_BUILD`, `OPENSP_COMPACT_FINAL_OFFICIAL`, `OPENSP_COMPACT_FINAL_RESTORATION`, `OPENSP_COMPACT_FINAL_PYTHON`, `OPENSP_COMPACT_FINAL_HISTORICAL_SOURCE` and `OPENSP_COMPACT_FINAL_HISTORICAL_BUILD`, then run:

```powershell
node --test tools/synth-release-patcher-v1/compact-final-v1/test-compact.mjs
```
