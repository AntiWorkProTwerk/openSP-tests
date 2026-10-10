# Local openSynth N1 source patcher

This fixed Windows workflow builds the compact openSynth N1 core from the owner's unchanged official Roland v5.52 firmware and the candidate owner's source kit09. The core source preserves 16 sounds and four voices and implements direct destination selection, REC start and stop/save with a 120-second cap. The in-Synth pattern chooser and metronome additions require a later source/candidate authority. Core09 does not include those joins.

The source-only archive at `source-core09.zip` is 758,411 bytes, SHA256 `7eca68d3a06edf43f94487b7e8c6bb4adcb67fa121b7bb3c8f2e2d685e011715`. The wrapper admits that exact archive, all 349 source/license members, its fixed build entry and its source/compiler contracts. It accepts no feature configuration, macros, caller hash grants, replacement commands or unreviewed archives. Historical 151-unit Source16 output cannot be substituted for N1.

Supply the reviewed external Python 3.12.14 and Arm GNU 14.3.Rel1 Windows installations and exact P6S restoration bytes. Follow [the dependency guide](DEPENDENCIES.md) for the publisher archives, Python alias and compiler metadata template. The core compiler entry authenticates those installed binary roles and all 1,874 tool inputs before compiler work. Node 22.12 or later runs the wrapper; it needs no website, browser, TypeScript loader or Python packages beyond the source-owned builder's standard-library dependencies.

From OpenSP, inspect an existing core package without compiling firmware:

```powershell
node tools/synth-release-patcher-v1/compact-v1/run.mjs --mode inspect --source-archive tools/synth-release-patcher-v1/compact-v1/source-core09.zip --official OWNER_V552.zip --restoration EXACT_P6S.bin --build EXISTING_CORE_PACKAGE --output NEW_PRIVATE_OUTPUT
```

The build mode invokes only the authenticated source entry with fixed input roles:

```powershell
node tools/synth-release-patcher-v1/compact-v1/run.mjs --mode build --source-archive tools/synth-release-patcher-v1/compact-v1/source-core09.zip --official OWNER_V552.zip --restoration EXACT_P6S.bin --python PINNED_PYTHON.exe --toolchain-root PINNED_ARM_ROOT --output NEW_PRIVATE_OUTPUT
```

Each real core build compiles 105 selected units, links them and builds the original R3/B2 envelope from source. It does not rebuild the separate P6S restoration. Use a new private output with an existing parent directory. Keep official and restoration firmware outside the website repository. The child receives structured arguments with `-I -S -B`, no shell, and a reduced environment. Source materialization, launcher logs and failures remain available for review.

Success produces `COMPACT_INSPECTION.json`, `COMPACT_HANDOFF.json` and `COMPACT_INPUT_BINDING.json`. Build mode also retains `source-kit/`, `build/` and compiler logs. Inspection checks 304 copied sources, all 105 objects and compiler dependencies, FILE ABI consumers, stack receipts, ELF loaded sections, 197 native patches and complete APP1 replay with B2. It checks exact P6S restoration bytes separately. Handoffs bind official/source/entry/recipe/report and artifact hashes, CRCs and padded-sector extents.

The existing core-package03 was assembled from authenticated units and a link in the current transaction. Its inspector records 105 reuse rows and does not call that one fresh canonical-entry execution. A future successful normal build must supply 105 fresh compiler-command rows before the owning wrapper records its completed source-entry execution. A saved receipt inspected later cannot attest that execution by itself.

Every software, hardware, upload and public-release flag stays false. The handoff grants no writer authority. Exact native audio, cold initialization, memory lifetime and runtime checks still precede root's software eligibility decision; the SP then needs direct recording, SAVE, pad playback, persistence and repeat-take tests. A distinct pattern/metronome candidate needs its own authority and checks. The tested P6S restoration retains its historical `SYNTH P6S!` identity and separate qualified B2 delivery path.

The companion source-only review package includes these wrapper files, the unchanged compact source archive, MIT LICENSE/NOTICE, dependency metadata and the separately reviewed restoration source bundle. It contains no official firmware, generated APP1, compiled module, compiler executable or hardware capture. Source origin review, promotion and publication remain separate from this local workflow. Compiler-internal, OS and Python standard-library reads remain outside the recorded Python audit scope.

Run focused checks with explicit retained evidence:

```powershell
node --test tools/synth-release-patcher-v1/compact-v1/test-compact.mjs
```

`OPENSP_COMPACT_BUILD`, `OPENSP_COMPACT_OFFICIAL` and `OPENSP_COMPACT_RESTORATION` enable real retained-package inspections and altered artifact/receipt refusals. `OPENSP_COMPACT_PYTHON` enables inert-child checks and an actual isolated source-entry refusal using an intentionally incomplete tool installation. Those checks compile no firmware and operate no device.
