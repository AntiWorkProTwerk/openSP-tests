# Rebuilding the browser CPU runtime

The current local bundle uses Unicorn.js wrapper commit
`1220477c7fb0f8fe4b500f4bd211de52f6dfe638`, Unicorn base commit
`8028ec436f2d9376525352dd38ed9ed6b9f6be10` and Emscripten 5.0.5. The wrapper's
pinned build driver copies its QEMU interpreter sources and applies the recorded
TCI/helper/symbol transformations. The current bundle additionally applies the
four-repair composition described below. All transformations and artifact hashes are in
[`provenance.json`](../public/emulator/vendor/provenance.json).

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `unicorn-arm.js` | 43,313 | `d8bc37b898ccbc5b429f17112add6ad33a8a9b35df4146034ba141b992dae007` |
| `unicorn-arm.wasm` | 706,188 | `399f9ca4eecc11d111d3182e251fbfb8ccc69e88f19f06650e945482eaf1a7d1` |

The [rebuild tool](../tools/rebuild-unicorn.py) intentionally retains its original
normal mode. Omitting both repair selectors rebuilds the unrepaired baseline; its
default output is `public/emulator/vendor`. It does not infer the repair from
the current bundle's provenance. To reproduce the current runtime, select the
composition explicitly and prepare an absent source directory and an absent output
directory outside `public/`:

```text
python tools/rebuild-unicorn.py --workdir <new-source-directory> --output <new-nonpublic-output-directory> --candidate-composition temp-lifetime-it-hook-stop-xpsr-hflags-m7-host-registers
```

Emscripten 5.0.5 must be on PATH. Repair mode refuses an existing source or output
directory and resolves the output before checking that it stays outside public
assets. The bundled [patch](../tools/vendor-patches/unicorn-arm-temp-lifetime.patch)
is 1,157 bytes, SHA256
`8f179f1cf100a1246bfbe5b5c4993f025b79ad614aa0b01c22df6589fc186fd3`.
The tool verifies that identity before checkout, verifies the transformed input
source, applies the repair once after the upstream transformations and before
constants generation or compilation, then verifies the repaired source before
copying artifacts. The build records source revisions, source hashes, compiler
options, license files and binary privacy checks.

The composition applies the temporary-lifetime patch, conditional-hook PC/IT
publication and stop patch, official host XPSR flag refresh, then revision-2
live M7 host-register routing. Guest MRS/MSR helper bodies remain unchanged;
saved-context APIs retain their original exported routes. Each affected source
boundary is hash-checked before and after application. The
[fresh composed build proof](../../sp404mk2/analysis/emulator/vendor_candidate_m7_host_regs_20261003/composed-build-proof.json)
pins all four patches, reconstructs their order independently and records
17 CLI guard checks. Component qualification passes47 original Thumb cases,
12 CPU groups, four finite CPS controls and nine raw-host/guest/model groups.
This source/component proof executes no whole firmware.
The earlier [single-repair reproduction](../../sp404mk2/analysis/emulator/vendor_candidate_temp_lifetime_upstream_20261003/build-proof.json)
and its eleven CLI checks remain separate evidence.
The earlier [unrepaired clean build](../../sp404mk2/analysis/emulator/vendor_candidate_clean_20261003/retained_build/clean-build-proof.json)
and original runtime remain separate history.

Qualification first uses the existing benign CPU cases, then ordinary exact-image
integration with the candidate factory supplied explicitly. The
[firmware tools](emulator-firmware-tests.md) accept `--runtime-dir` and require a
separate `--report` for isolated candidates; their real worker threads receive
the same factory. Before/after hashes must remain stable. Current retained
evidence covers R13 update/readback/reset, an R13-to-R14-to-R13 roundtrip, and
[ordinary whole-stock startup](emulator-stock-qualification.md). The stock report
passes scatter and oscillator/DCDC/ARM startup on the preceding three-repair
candidate, then waits on the missing VIDEO PLL. Earlier code10 reports remain
failed history. Neither
source reproduction nor the original-firmware passes establish complete stock,
peripheral or physical SP behavior.

The [latest promotion record](../../sp404mk2/analysis/emulator/vendor_candidate_m7_host_regs_20261003/local-promotion.json)
records the hash-verified copy after independent review and a73,328-ms ordinary
R13/R14 guest roundtrip. The exact previous seven vendor files remain in the
[archive](../../sp404mk2/analysis/emulator/vendor_before_m7_host_regs_20261003/manifest.json).
The original runtime and first promotion remain preserved separately. Subsequent
rebuilds should retain their own source proof and qualification reports before
replacing that bundle. Runtime promotion changes local website assets; it is
separate from website deployment and every physical firmware update.
Runtime compilation maps embedded source paths to `unicorn.js` and checks the
resulting binaries. Build/check log redaction is a separate publication step. The
[publication-log mapping](../tools/emulator-evidence/public-log-redaction-20261003.json)
qualifies eleven `.public.log` copies after replacing only the absolute workspace
prefix with `<workspace>`. Byte-exact original logs remain local and ignored by
Git. The three frozen receipts are unchanged; their hashes still identify the
private originals. The mapping records separate hashes for the public copies.
This log-only change does not rebuild or alter the runtime.
