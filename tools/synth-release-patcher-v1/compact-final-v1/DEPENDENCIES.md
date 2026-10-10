# Exact external build dependencies

The source authority admits Windows AMD64 Python 3.12.14 and Arm GNU 14.3.Rel1. These publisher archives were matched to the existing frozen binary authority by static inspection on October 5, 2026. Archive version labels alone do not admit a different installation. The builder checks installed Python roles, 1,874 Arm inputs and six compiler search namespaces before compiling.

| Distribution | Publisher archive | Bytes | SHA256 |
| --- | --- | ---: | --- |
| Astral CPython 3.12.14, release 20260901, Windows AMD64, install_only_stripped | [Python tar.gz](https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14%2B20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz) | 21,980,728 | `7c45c9622400d578709a9b2cddbe8124cc21d382409d9f13406d706d28e31b14` |
| Arm GNU 14.3.Rel1, Windows x86_64, arm-none-eabi | [Arm ZIP](https://armkeil.blob.core.windows.net/developer/Files/downloads/gnu/14.3.rel1/binrel/arm-gnu-toolchain-14.3.rel1-mingw-w64-x86_64-arm-none-eabi.zip) | 290,006,806 | `864c0c8815857d68a1bbba2e5e2782255bb922845c71c97636004a3d74f60986` |

Verify the complete archive hashes before extraction. Keep the extracted Python `python` directory intact, including its DLLs and library files. Use its actual `python.exe`, with a byte-identical `python3.exe` alias beside it. A version-manager shim is not an admitted launcher. Keep the Arm archive's `bin`, `lib`, `libexec` and `arm-none-eabi` directories directly under the supplied toolchain root.

Copy the companion `compiler_manifest.template.json` unchanged to `ARM_ROOT/compiler_manifest.json`. This project file is absent from Arm's publisher ZIP. Its 245 bytes have SHA256 `3e30983bd1b2607f2b9c63614186dce060ac6ff5f18b758dc41d534a633e725c`. The metadata grants no different compiler identity. The Python alias and this metadata copy are the two required preparation steps beyond preserving the downloaded distributions.

Python, compiler and vendor components retain their own licenses and are supplied separately. This source package includes no compiler or interpreter binary. The workflow is for the pinned Windows AMD64 roles; no Linux, macOS, ARM64 or Wine compatibility is established. The installation guidance establishes dependency identities and adds no source-build, runtime or hardware qualification.

The optional `tools/feature-picker-release-v1/standalone-source-bundle.zip` is the unchanged reviewed standalone source archive, SHA256 `3abb90aafe7ecc1ca669a3f3e35885ddbf3803200db96768ef43fdd16b424117`. It contains source and authenticated build glue for the older selected/restoration pipeline, with no firmware. Its isolated `launch.py` can regenerate the exact P6S fallback from official firmware and its accepted canonical selection. That older pipeline compiles 151 selected units and 27 restoration units; it is separate from the compact N1 builder and runs no recovery compilation by default here.
