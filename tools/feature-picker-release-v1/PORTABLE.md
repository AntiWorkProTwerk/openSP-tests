# Separate portable local staging

`portable-stage.mjs` stages exactly three reviewed private portable builds: the combined custom selection, synth-only PAD3 selection and recorder-only PAD4 selection. It authenticates their actual source/artifact bytes through an explicitly supplied pinned private verifier, then runs the current website metadata inspector. The existing `run.mjs` legacy builder and family validation remain unchanged.

This is a local source-owned adapter with external private dependencies. Its bounded registry accepts two reviewed catalogs:

| Catalog | SHA256 |
| --- | --- |
| Original kit05 proof, preserved `PORTABLE_CATALOG_SHA256` export | `5a3fbbd3b96efc4993626f2d9a4ac619592c4ea6bb7f6fd14d21993da3ecc5cc` |
| Additive kit06 official-extraction proof, `PORTABLE_KIT06_CATALOG_SHA256` export | `4e0f545043f00a6e1ad0431110e2a82726eace51a3c12be36b2221475d80cceb` |

Each catalog pins its private verifier/projection, reviewed bundle, exact family/anchor digests, source-kit roots and three candidate/selection vectors. A replacement catalog cannot authorize itself by supplying its own digest. Future profiles and dependency revisions require another explicit reviewed catalog admission in the source. The original export and legacy entry point remain supported.

Use the repository's Node version and Python with the local private evidence. Every root and admission value is explicit:

```powershell
node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/portable-stage.mjs --private-root PRIVATE_WORKSPACE --evidence-root REVIEWED_EVIDENCE_ROOT --kit-root REVIEWED_KIT_ROOT --dependency-catalog PRIVATE_CATALOG --dependency-catalog-sha 5a3fbbd3b96efc4993626f2d9a4ac619592c4ea6bb7f6fd14d21993da3ecc5cc --profile combined --family REVIEWED_FAMILY --family-sha REVIEWED_FAMILY_DIGEST --anchor-sha REVIEWED_ANCHOR_DIGEST --official OWNER_V552_ZIP_OR_APP1 --stage-root EXISTING_PRIVATE_BUILD_DIRECTORY --run NEW_KEY
```

Run from the OpenSP root. Select `combined`, `synth-only` or `recorder-only`, with that profile's exact family, anchor and source-kit values from the admitted private catalog. `--stage-root` must already exist inside the supplied private workspace's `build/` directory, separate from OpenSP. The run key names a new directory; existing outputs are refused. The pinned prototype currently expects the reviewed sibling workspace layout and fixed evidence roots named by its catalog. This adapter does not make that private prototype a general portable public verifier.

Before execution, the adapter hashes all catalog dependencies and profile artifact pins. It invokes the private stage dependency with Python `-I -B`, authenticates its result, checks copied candidate/selection/receipt bytes and exact canonical selection, and runs the actual `buildReceipt.ts` inspector. It rechecks dependencies, input, adapter/inspector source and staged bytes before recording success. The private verifier checks the 386-file source kit, 345 selected module inputs, 151 compiled objects, configuration embedding, ELF-to-BIN placement, official preimages, 269 native writes, original R3/B2 components and full APP1 replay. It also pins the exact source-built P6S restoration handoff and its 119-file kit. No compiler is invoked during staging.

Only verified firmware outputs and metadata are written into the explicit private stage. They never enter OpenSP assets or build output. `PRIVATE_STAGE_PROOF.json`, `WEBSITE_INSPECTION.json` and `STAGE_REPORT.json` distinguish local byte verification from browser metadata inspection. The browser's `sourceFamilyVerified`, `artifactVerified`, `downloadReady`, `uploadReady` and `releaseReady` remain false. Upload, delivery, source promotion, source redistribution, public readiness and new hardware qualification remain held. The receipt's existing private-family admission hold and legacy-admission field remain false; success names this separate bounded local workflow, without granting admission to the legacy runner or arbitrary future builds.

The original kit05 retains 36 literal native bytes in `native_cold_v552.inc` and `native_publish_v552.inc`. Kit06 replaces those inputs with bounded extraction from the authenticated owner-supplied official image. Three genuine kit06 builds reproduce the same 151 object sets, ELF/modules and complete APP1s. Its v2 family verifies all 241 extraction rows, including the two added include intervals, and pins source provenance, the source/extraction review, independent bounded source review through its catalog bundle and exact source-built P6S restoration. The frozen provenance summary inherited 239 groups; a separate addendum records the actual authenticated plan's 241, preserving the source inventory.

The private kit/verifier are still required, and source redistribution has not been approved. Native activation, recording/SAVE/reentry/playback, memory lifetime, runtime/interrupt budgets and physical USB/readback/reboot qualification remain open. Build audit guards cover Python opens/copy endpoints after hook installation and explicit compiler programs/cwd; imports/code-pin reads precede the hook and compiler-internal reads are untraced. Staging supplies post-build byte authentication and does not expand that audit scope.

Focused verification uses the actual private evidence:

```powershell
node --import ./tools/register-test-typescript.mjs --test tools/feature-picker-release-v1/test-portable-stage.mjs tools/feature-picker-release-v1/test-runner.mjs
node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/verify-portable-stage.mjs [the same explicit arguments as above]
```

The integration command uses the supplied run key to create three new private stages, thirteen refusal attempts and a review directory. It derives the other two profiles' exact pins/roots from the admitted catalog and checks each real candidate and current inspector result. Refusals include family/anchor/catalog substitution, wrong explicit roots, profile mismatch, invalid official bytes, website output and output reuse. Legacy CLI and retained-stage tests remain separate. No browser session, device, public asset, source kit or historical bundle is changed.
