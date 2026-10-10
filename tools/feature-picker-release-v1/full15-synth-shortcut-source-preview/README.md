Start this helper from OpenSP with Node from `.node-version`:

```powershell
node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/full15-synth-shortcut-source-preview/local-server.mjs --sp-root ../sp404mk2 --python PYTHON.exe --tool-prefix ../sp404mk2/toolchains/bin/arm-none-eabi- --official OWNER_V552.zip --output-root ../sp404mk2/diagnostics/source-preview-runs --site-origin http://127.0.0.1:4321
```

Use an existing private output directory in the SP checkout and the exact browser origin. Paste the printed connection into the existing Full15 local-build page. Its capability stays in browser memory. Recipe v2 and catalog revision v2 are explicit; prior Full15 selections are not silently relabelled. Full14 and historical P6S use their existing pages and helpers.

Select Synth, then optionally add the global recorder on the same picker page. A native chooser selection keeps config marker zero. Selecting a Synth chord explicitly assigns that combination to Synth and emits the 128-byte config with marker one. Two or three mapped buttons or pads are supported; DEL, EXIT and SHIFT + PAD 13 remain reserved. Recorder capture starts from the PC. Hardware recorder shortcuts and recorder-only builds are unsupported.

Both source variants compile all 129 units afresh. The Synth-only reference has 25 fresh and 104 inherited objects; the combined reference has 129 fresh and no inherited objects. Turning the optional recorder off restores the pinned Synth-only source preimages and feature mask one. Turning it on joins the global OLED/control route with mask three while keeping the recorder shortcut entry disabled. The browser verifies this choice, config, counts, full ELF bytes and receipt.

The helper requires the reviewed combined source-builder checkout, exact official v5.52 ZIP or APP1, Python and ARM toolchain. Compilation needs no SP connection. This output is a source module, not installable firmware. Native launch, whole-SP screen/control/audio behavior, firmware admission and hardware acceptance remain unqualified. The helper exposes no firmware candidate or device operation.
