This Windows helper builds Full14 source modules for the separate `/features/source-preview/` catalog. The historical P6S picker and standalone builder use their existing recipe and are unchanged.

Start it from the OpenSP checkout with the reviewed SP checkout beside it:

```powershell
node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/full14-source-preview/local-server.mjs --sp-root ../sp404mk2 --python PYTHON.exe --tool-prefix ../sp404mk2/toolchains/bin/arm-none-eabi- --official OWNER_V552.zip --output-root ../sp404mk2/diagnostics/source-preview-runs --site-origin http://127.0.0.1:4321
```

Use an existing private output directory. The helper authenticates the reviewed builder and official v5.52 input before printing a loopback connection. Paste that connection into `/features/source-preview/local-build/`. Its capability stays in browser memory and is never part of an artifact or request URL.

Choose openSynth alone for the core Full14 source profile. Add USB Recorder for the separate optional-global source profile. Both requests invoke the real source runner with fixed local paths and structured arguments. After the compiler and linker complete, the helper checks the exact selection, source-profile reference and complete ELF bytes. It offers the module and source receipt for local download.

These are source modules, not installable firmware files. The optional global cohort has 206 intervals and is not admitted by the N4 patcher. Recording acceptance, native firmware build admission and physical release tests remain separate. No USB or SP device command is implemented by this helper.

The source preview preserves native SHIFT + RECORD SETTING. Unsupported custom chords and recorder-only selections are refused before compilation. The dispatcher port will need a new reviewed source profile before custom launches can be exposed here. Whole-SP screen/control recording requires patched firmware; stock provides USB audio.
