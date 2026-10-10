# Rebuilding the WFI marker engine

The marker driver maps to `tools/vendor-build/wfi-marker/rebuild-wfi-marker.py`. Its bundle contains `staging.py`, the pinned `staging-manifest.json`, and the preserved `before/rebuild-unicorn.py` and `before/upstream-build.py` drivers. The canonical `tools/rebuild-unicorn.py` remains the historical non-marker driver.

The bundle has six patches: `marker-wrapper.patch`, `unicorn-arm-temp-lifetime.patch`, `unicorn-arm-conditional-hook-stop.patch`, `unicorn-arm-xpsr-hflags.patch`, `unicorn-arm-m7-host-registers.patch` and `marker-inner.patch`. The manifest pins their bytes, wrapper/core revisions and affected sources before and after each stage. The staging helper checks those pins and applies each patch once.

Run from the OpenSP repository root with Git, Python and Emscripten 5.0.5 available. Choose two explicit absolute directories outside the repository. Both must be absent, separate and nonnested. For example, in PowerShell:

```powershell
python tools/vendor-build/wfi-marker/rebuild-wfi-marker.py --workdir C:\opensp-build\wfi-source --output C:\opensp-build\wfi-output
```

The driver clones the pinned source into `--workdir` and writes six assets plus `provenance.json` into `--output`: `unicorn-arm.js`, `unicorn-arm.wasm`, `LICENSE-GPL-2.0.txt`, `UNICORN-COPYING.txt`, `UNICORN-AUTHORS.txt` and `UNICORN-CREDITS.txt`. Keep those license and attribution files with the engine. Preserve the patches' upstream wrapper, Unicorn and QEMU copyright, licensing and source attribution.

The promoted runtime retains the donor's exact six assets and provenance. Its successful 29.92-second Emscripten 5.0.5 build is historical evidence. This public driver changes repository discovery and the external source/output path policy only.

On October 3, 2026, one guarded [public-driver rebuild](../../../../sp404mk2/analysis/emulator/wfi_canonical_acceptance_20261003/public-driver-result.json) completed in 28.2974 seconds with exit 0 and Emscripten 5.0.5. All six assets and provenance matched the promoted donor byte-for-byte; the source bundle and live vendor files stayed unchanged. Outputs remained outside the repository, with no asset promotion, guest, browser or device operation. Keep the [source and patch pins](staging-manifest.json) with the [runtime provenance](../../../public/emulator/vendor/provenance.json).
