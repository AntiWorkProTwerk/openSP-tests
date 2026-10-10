# Request-bound local portable builds

`portable-build.mjs` accepts a current canonical website export for Roland v5.52 with Synth, USB recorder, or both. Each selected feature can use the shared chooser or a valid ordered two/three-control chord. The exporter and authenticated generator reject reserved controls, repeated controls, wrong scopes and exact/subset overlap. Non-subset chords may share controls. Unsupported firmware bases and later planned features remain intent-only choices and are refused by this build path.

This is a private local CLI. The website's Build firmware and USB-C upload controls remain disabled. Receipts imported there receive metadata inspection; browser source/artifact verification and download/upload/release flags remain false. Every generated candidate remains `DO_NOT_DELIVER`, with native runtime, physical delivery and publication unqualified.

Run from the OpenSP repository with its locked Node dependencies. Supply the explicitly reviewed private dependency directory, the clean source kit, the existing sibling ARM toolchain and Python environment, and unchanged owner-supplied official v5.52 ZIP or APP1:

```powershell
node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/portable-build.mjs `
  --private-root PRIVATE_WORKSPACE `
  --dependency-root REVIEWED_REQUEST_RUNTIME `
  --kit-root REVIEWED_SOURCE_ONLY_KIT `
  --toolchain-root ../sp404mk2/toolchains `
  --python ../sp404mk2/.venv/Scripts/python.exe `
  --selection CANONICAL_EXPORTED_SELECTION `
  --official OWNER_SUPPLIED_V552_ZIP_OR_APP1 `
  --output-root EXISTING_PRIVATE_BUILD_DIRECTORY `
  --run NEW_KEY
```

The source-owned adapter admits one fixed private executable closure, SHA256 `2f3a97ebbfc89c5f408301281bd848e2884eabf91cca95070224e25d4e8be54e`. Caller family, source, compiler-command, macro, candidate or tool-hash arguments cannot grant authority. The private implementation authenticates the unchanged kit06 inventory (386 sources plus three pinned authority metadata files), imports six helpers directly from authenticated source bytes, and refuses extra files or import alternatives. Private helpers also compile source directly. The interpreter is the fixed sibling Python 3.12.14 virtual environment, with its configuration and base binary hashes checked. The ARM toolchain is the fixed installed Arm GNU 14.3.Rel1/GCC 14.3.1; 1,874 active executable/header/library inputs and exact file sets across six compiler search namespaces are checked. Roots with added specs or helper files are refused. These constraints intentionally describe the reviewed local environment.

A new selection compiles 151 units through the existing audited builder. The owning transaction then independently derives selected source/configuration/commands, configuration embedding, ELF-to-BIN placement, all 241 owner-official extraction intervals, the 269-write native recipe, original R3/B2 components and complete APP1 bytes. It writes a disabled family and receipt under the supplied private output root. Exact exports from the three historical kit06 vectors may reuse their unchanged reviewed source-family proofs and artifacts; callers cannot choose another prior run. Their [original stager](PORTABLE.md), catalogs and legacy builder semantics remain preserved.

Representative software evidence includes a shared chooser, a new Synth chord and permitted non-subset shared-control overlap. The first two complete builds preceded the source-import correction and are retained as byte/source regressions. The third compiled under the corrected import/runtime authority, then exposed an old-path comparison in the provenance addendum. Its compiled outputs pass the repaired verifier in a separate phase. The final normal entrypoint completes an original reviewed vector without recompilation. These results are not presented as three uninterrupted executions of the final successor. [The private phase report](../../../sp404mk2-synth/diagnostics/synth_p6/sol_public_build_closure_v1/attempt10/README.md) records exact evidence and limitations.

The prepared 392-member MIT source archive is not accepted directly or automatically converted into this exact private kit. It contains the same 386 source members plus six licensing/build metadata files, and omits the three private authority metadata files required here. A reviewed importer remains necessary: authenticate the exact archive/member/license manifest, preserve LICENSE and NOTICE, and materialize the canonical runtime kit with reviewed authority metadata. Keep the original package and attribution records alongside that runtime directory. Arbitrary extra files must not become executable authority. Public package integration and source promotion remain separate from this local proof.

Build audit guards cover Python file/copy endpoints after hook installation and explicit compiler launches/cwd. Code/import setup precedes that hook; OS, Python standard-library and child compiler reads remain untraced. Pinning import sources, local runtime configuration and compiler namespaces narrows the admitted inputs without claiming universal filesystem attestation. No device connection, browser build service, firmware upload, deployment or publication occurs here.

Focused parser and compatibility checks:

```powershell
node --import ./tools/register-test-typescript.mjs --test tools/feature-picker-release-v1/test-portable-build.mjs tools/feature-picker-release-v1/test-portable-stage.mjs tools/feature-picker-release-v1/test-runner.mjs
```
