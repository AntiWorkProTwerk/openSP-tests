# Canonical selection to local build and held USB handoff

The additive `/features/local-build/` route connects the current canonical
feature-picker export to the real standalone Source16 builder. openSynth keeps
the internal feature ID `synth`; naming does not change catalog revision,
selection bytes or historical firmware titles. This recipe supports openSynth,
USB Recorder and valid registered shortcuts on Roland v5.52. The newer compact
openSynth release uses a separate source authority and is not this recipe.

The local helper authenticates the fixed source archive, owner-supplied official
firmware and Python launcher before accepting requests. A real build invokes
the unchanged standalone entrypoint through structured child arguments and
compiles 151 selected units plus the required 27-unit P6S restoration. Its
normal source verifier then checks the saved transaction and complete artifacts.
The browser checks the canonical selection, linked 128-byte configuration,
configuration marker, ownership bounds and complete candidate bytes. Its
selected-image B2 handoff remains held.

## Start the helper

Use the matching external Windows installations and exact source archive from
[STANDALONE-BUILD.md](../STANDALONE-BUILD.md). Install the repository's locked
Node dependencies. Official firmware and an existing private output folder
must be outside the website repository. From OpenSP:

```powershell
node --import ./tools/register-test-typescript.mjs tools/feature-picker-release-v1/browser-successor-v1/local-server.mjs --source-archive tools/feature-picker-release-v1/standalone-source-bundle.zip --python MATCHING_PYTHON.exe --toolchain-root ARM_ROOT --official OWNER_V552.zip --output-root PRIVATE_OUTPUT_ROOT --site-origin http://127.0.0.1:4321
```

Use the exact origin of your local preview for `--site-origin`. The closed
origin contract also admits `https://opensp.fyi`; this does not publish the new
route. `--port` optionally selects a local port; otherwise the operating system
assigns one. The server binds only `127.0.0.1` and prints a connection containing
a random capability. Paste that connection into the local-build page. The page
keeps the capability in memory, sends it only in a request header, and never
writes it to browser storage or downloaded receipts. Keep the terminal open.
Stopping the helper removes its session capability; staged files remain private.

Export a supported configuration from `/features/`, then import it on the
local-build page. Choices already saved in the same browser are loaded too.
Review the feature names, ordered shortcuts and canonical JSON. **Build locally**
creates a new run and invokes the actual compiler. Changing configuration
invalidates a prior match. **Inspect matching helper build** rechecks an existing
completed run against the current choices without compiling again.

Each run is preserved under `PRIVATE_OUTPUT_ROOT/<run-name>/`. The normal
standalone output lives in `build-run/`; `stage/` contains the matching canonical
selection, versioned receipt, complete candidate, separate restoration and held
B2 handoff. The helper serves only those five closed artifact roles. It rechecks
their hashes on each fetch. Source/tool paths, macros, caller hashes, recipes,
qualification flags and arbitrary file paths are not request fields. One build
may run at a time; failed runs expose no accepted receipt or artifact download.
The helper captures the structured child's stdout/stderr in private logs,
including refusals that happen before the builder creates its own output.
On Windows the fixed TypeScript loader is passed as a file URL to Node's
`--import`; a raw drive-letter module path is refused by Node before launch.

For an already successful standalone transaction, append
`--existing-build EXISTING_TRANSACTION_ROOT` at startup. This root is the
directory containing the standalone `REPORT.json` and `TRANSACTION.json`,
usually an existing output's `build/`. The helper re-inspects the actual source
and complete bytes against its supplied official input and fixed archive, then
stages a new `retained-proof` run. Its receipt records
`source_recompiled_this_request:false`. Use a new private output folder for each
such startup; historical evidence is not overwritten.

## Receipt and delivery boundary

`opensp-standalone-browser-receipt-v1` is an additive contract. It does not
rewrite the frozen legacy build-receipt validator. The local helper performs
the actual fixed source/artifact inspection. An imported receipt alone proves
metadata consistency; it does not authenticate compiler execution. Supplying
the matching candidate lets the browser check its full hash, actual linked
configuration, fixed title and bounded B2 envelope. A local build ID binds both
selection and candidate hashes, while the native session marker binds the
source-selected policy and configuration. Fixed historical titles are retained.

**Prepare USB handoff** saves `opensp-selected-b2-handoff-v1`, bound to that exact
selection, configuration and candidate. Its status is
`HELD_EXACT_SELECTED_IMAGE_EVIDENCE_REQUIRED`; it contains no write command or
authorization. Runtime, hardware, device operations, upload and public release
flags remain false. Qualified native entry/runtime/resource/timing evidence,
global capture and native pad recording, and the matching physical update and
normal/DEL reboot receipts remain separate gates. A controlled first hardware
test can use separately reviewed software-seal/bench authorization while public
release waits for its physical results; this source recipe has no such admitted
bench authorization. Untouched stock still has no verified normal USB-C
first-install path.

The verified P6S restoration is a separate image. The helper exposes it only
after checking its complete bytes against SHA256
`7f9917ffb0871cca25b1ce5d281ac5c2bf790ae6b8278b04a5ffef8e3c06fd60`.
Saving it is an explicit action. The separate `/releases/synth/` page describes
the release and delivery instructions; it contains no USB form. The reusable
`admitQualifiedP6SRestoration(restorationFile, evidenceFilesById)` API in
`tools/synth-usb-release-v1/release.ts` authenticates the restoration and 21
pinned release evidence files before its dedicated B2 flow. The original
owner-local P6S roundtrip harness remains the concrete qualified writer.
The companion evidence-bundle API accepts one bounded owner-local JSON bundle
containing those 21 authenticated files; it is generated separately and stays
outside public assets. Connecting that separate API to a new restoration form
is still an integration step. Neither path admits the selected candidate or silently substitutes
restoration for it. The local feature helper contains no USB transport,
compiler download or firmware download.

The website remains static. This helper is installed and run locally; there is
no hosted compilation service. Generated firmware, receipts, logs and local
paths stay outside public assets. The frozen source archive and all MIT/license
files are preserved. OS/Python standard-library and compiler-internal reads
remain untraced; source labels are not independent authorship attestations.

## Focused verification

```powershell
node --import ./tools/register-test-typescript.mjs --test tools/feature-picker-release-v1/browser-successor-v1/test-successor.mjs
```

The optional owner-local cases use `OPENSP_STANDALONE_ARCHIVE`,
`OPENSP_STANDALONE_BUILD`, `OPENSP_STANDALONE_OFFICIAL`,
`OPENSP_STANDALONE_PYTHON` and `OPENSP_STANDALONE_TOOLS`. They reuse the actual
retained fresh 151+27 transaction, exercise the real loopback helper, and run
the new production child seam through an owned inert official-input refusal.
No additional complete compilation, browser/device operation or publication
is needed. Failure cases cover changed selection/configuration/candidate,
source substitution, ownership collision, bounds, false-to-true delivery
promotion, origin/capability mismatch, unsupported request fields and failed
phase exposure.

The shared design maps `Feature local selection/helper/receipt/handoff` to the
additive native mains and linked desktop/mobile light/dark layouts. The
existing feature catalog and old workflow remain intact.
