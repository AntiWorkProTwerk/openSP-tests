# Standalone local feature build

`standalone-build.mjs` connects a canonical OpenSP feature-picker export to the reviewed standalone source builder. Each real build compiles the selected 151-unit module and its required 27-unit P6S restoration from the two licensed source archives. This entry path has no private workspace, template, history, family-catalog or retained-firmware dependency.

Use the current canonical export for Roland v5.52 with Synth and/or USB Recorder. Supply the owner's unchanged official v5.52 ZIP or APP1, matching external Windows Python 3.12.14 and Arm GNU 14.3.Rel1 installation, and the reviewed source bundle. Matching version labels alone do not admit an interpreter or compiler: their actual binary identities must match the archived authority. The command authenticates the archive and trusted launcher against pins in its code; caller hashes, macros, commands and source lists are refused.

From the OpenSP repository, replace the placeholders with explicit local paths:

```powershell
node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/standalone-build.mjs --source-archive REVIEWED_SOURCE.zip --python PYTHON_31214.exe --toolchain-root ARM_ROOT --selection CANONICAL_EXPORT.json --official OWNER_V552.zip --output NEW_LOCAL_OUTPUT
```

The exact reviewed source archive is included at `tools/feature-picker-release-v1/standalone-source-bundle.zip`; use that path for `REVIEWED_SOURCE.zip`. Its two licensed source archives and metadata remain unchanged. It contains source and build glue, with no compiler, firmware image, captured RAM or historical build artifact.

The output's parent must already exist. Choose a new output outside the website repository, separate from supplied source/tool/firmware inputs. Official firmware must also stay outside the website repository; source archives and selection files must stay outside `public/` and `dist/`. Python runs with `-I -S -B`, structured arguments, no shell and a reduced environment. The source launcher authenticates the interpreter's base binaries and the compiler's 1,874 pinned inputs and six exact search namespaces.

The admitted archive is 1,032,317 bytes, SHA256 `3abb90aafe7ecc1ca669a3f3e35885ddbf3803200db96768ef43fdd16b424117`. Its authority is `ef933914f014d27ba18632906423546aa2394e281167e231314bd59eccd95ed5`; trusted launcher SHA256 is `74c95a38c9bdce75b8842b214774eabc083bf69f5e04507ec724c1906ed13744`. The original licensed archives and all LICENSE, NOTICE, build and provenance files remain intact. Each extracted source role keeps its six metadata files beside its source subtree.

## Matching external installations

Static publisher-archive inspection on October 5, 2026 established the exact external distributions below. It matches all seven Python base-file roles, both admitted launchers, 1,873 Arm publisher members and six compiler search namespaces. The remaining compiler pin is the project's 245-byte metadata template. The inspection installed or executed neither distribution and performed no new firmware build.

| Dependency | Exact publisher archive | Bytes | SHA256 |
| --- | --- | ---: | --- |
| Astral CPython 3.12.14, release 20260901, Windows AMD64, install_only_stripped | [Python tar.gz](https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14%2B20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz) | 21,980,728 | `7c45c9622400d578709a9b2cddbe8124cc21d382409d9f13406d706d28e31b14` |
| Arm GNU 14.3.Rel1, Windows x86_64, arm-none-eabi | [Arm ZIP](https://armkeil.blob.core.windows.net/developer/Files/downloads/gnu/14.3.rel1/binrel/arm-gnu-toolchain-14.3.rel1-mingw-w64-x86_64-arm-none-eabi.zip) | 290,006,806 | `864c0c8815857d68a1bbba2e5e2782255bb922845c71c97636004a3d74f60986` |

The Python digest is supported by [Astral release metadata](https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/20260901); the Arm digest matches its [publisher checksum](https://armkeil.blob.core.windows.net/developer/Files/downloads/gnu/14.3.rel1/binrel/arm-gnu-toolchain-14.3.rel1-mingw-w64-x86_64-arm-none-eabi.zip.sha256asc). Other dates, Python distributors and tool versions are not established substitutes for these pinned identities.

1. Verify each downloaded archive against the table before extraction. Extract the Arm ZIP into `ARM_ROOT`, retaining the complete `bin`, `lib`, `libexec` and `arm-none-eabi` directories found directly at its root. Extra files inside the six declared search namespaces are refused.
2. Copy [compiler_manifest.template.json](compiler_manifest.template.json) byte-for-byte to `ARM_ROOT/compiler_manifest.json`. This project metadata file is absent from Arm's ZIP. It is 245 bytes, SHA256 `3e30983bd1b2607f2b9c63614186dce060ac6ff5f18b758dc41d534a633e725c`; it grants no different tool identity.
3. Extract the Python tar.gz separately and use its `python` directory as `PYTHON_ROOT`. Retain its DLLs, `Lib`, `DLLs` and other runtime contents. Add `PYTHON_ROOT/python3.exe` as a byte-identical copy of `PYTHON_ROOT/python.exe`; this required alias is absent from the publisher archive.
4. Supply `PYTHON_ROOT/python.exe` directly as `--python`. A virtual environment is optional and must retain that exact base interpreter/DLL set. Its archive-supplied `Lib/venv/scripts/nt/python.exe` matches the second admitted launcher. A version-manager shim is not an admitted interpreter merely because it selects the right version.

From OpenSP, the two local preparation copies are:

```powershell
Copy-Item -LiteralPath ./tools/feature-picker-release-v1/compiler_manifest.template.json -Destination ARM_ROOT/compiler_manifest.json
Copy-Item -LiteralPath PYTHON_ROOT/python.exe -Destination PYTHON_ROOT/python3.exe
```

The current complete workflow proof ran on Windows 11 Pro x64. The bundle requires Windows and these AMD64 binaries; no minimum complete-workflow Windows version or ARM64/Wine/Linux/macOS compatibility is established. Python, its DLLs and Arm/vendor dependencies retain their own licenses and are not included in this source bundle. Keep downloaded executables outside website assets. This installation guidance adds no hardware or release qualification.

## Results and checks

On success, `NEW_LOCAL_OUTPUT` contains:

- `source-bundle/`: the twelve authenticated source-bundle files.
- `build/`: the actual standalone transaction, source roles, current ELF/object/recipe outputs, selected candidate and P6S restoration.
- `LOCAL_BUILD_REPORT.json`: input-bound source/artifact inspection with candidate hashes and all delivery/readiness fields false.
- `launcher.stdout.log` and `launcher.stderr.log`: private local execution diagnostics.

The candidate is `build/selected-build/candidate.disabled.bin`; restoration is `build/restore-build/restore-p6s.disabled.bin`. The wrapper checks the exact selection/configuration, complete candidate/restoration bytes, source/license identities and parent/child read receipts. A success claim without its matching saved transaction is refused. No report becomes an upload command or a browser-admitted source family. Keep the generated firmware and raw diagnostics outside public assets.

Preflight failures create no output. After launch, refusal or receipt mismatch produces `REFUSAL_REPORT.json` and no accepted local success report. A failed phase may leave partial source/build files; retain them for review and choose a new output for a corrected request. Generic refusal reports leave compiler-call count unknown. The source launcher validates canonical intent after source materialization and before starting compiler children.

OS/Python standard-library and compiler-internal reads remain untraced. Source-origin labels do not independently establish authorship. These local checks add no native runtime, hardware, USB delivery, public/browser build or upload qualification; every corresponding flag remains false. Publication, deployment and device operations are separate actions.

Run the small tests without compiling firmware:

```powershell
node --import ./tools/register-test-typescript.mjs --test tools/feature-picker-release-v1/test-standalone-build.mjs
```

The owner-local integration cases also use `OPENSP_STANDALONE_ARCHIVE`, `OPENSP_STANDALONE_BUILD`, `OPENSP_STANDALONE_OFFICIAL`, `OPENSP_STANDALONE_PYTHON` and `OPENSP_STANDALONE_TOOLS` to read the existing fresh transaction and exercise an inert child. They perform no new source compilation. The original `run.mjs`, `portable-stage.mjs` and `portable-build.mjs` commands remain available.
