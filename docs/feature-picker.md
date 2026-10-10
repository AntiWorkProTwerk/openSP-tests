# Feature picker preview

The local `/features/` route lets people choose the current release features,
request button shortcuts, save choices in browser storage and import or export
versioned JSON. Its version 2 intent binds registry revision `2026-10-04.2` and
the exact feature and physical-control catalog digest. It explains each
feature's evidence and build blockers. Build and USB upload remain disabled
because no exact selected-image receipt is registered. [The composition
contract](feature-composition.md) defines the manifest and local build path.

## Shared design

The OpenSP Penpot file is `24d9d841-759d-81bc-8008-b518bc70d8b3`. Feature mains
live on page `7d39c61f-08fe-80d5-8008-bcada932404d`; linked desktop/mobile light
and dark layouts live on page `7d39c61f-08fe-80d5-8008-bcada934b82f`. The native
layouts illustrate one selected Synth feature. The browser begins with an empty
selection and renders arbitrary valid requested combinations.

| Native component | Shared implementation |
| --- | --- |
| Feature choice, Feature row | [FeatureRow.astro](../src/components/features/FeatureRow.astro) |
| Feature shortcut | [FeatureShortcut.astro](../src/components/features/FeatureShortcut.astro) |
| Feature summary | [FeatureSummary.astro](../src/components/features/FeatureSummary.astro) |
| Feature introduction, Feature update notes | [features.astro](../src/pages/features.astro) |
| Shared Wordmark and action | Existing header and semantic button styles |

Copy comes from [features.json](../src/content/features.json), feature data from
the shared registry, and controls from the pinned physical profile. Native
geometry and links are exported in
[feature-components.json](../design/penpot/feature-components.json) and
[feature-layouts.json](../design/penpot/feature-layouts.json). Arimo/Cousine,
monochrome semantic colors, divider rows and 44-pixel controls extend the
existing site. The responsive browser uses shared semantic components rather
than full-page image exports.

The guarded authoring tools inspect Assets before creating mains and refuse to
replace existing layouts. `node tools/design-feature-picker.mjs export` reads
the saved native definitions. `tools/refine-feature-picker.mjs` synchronizes
the final shortcut labels and upload copy while preserving links. Main changes
propagate into linked instances; documented light/dark overrides are checked
afterward. There is no automatic design-to-code synchronization.
Two separate width-change requests refresh Penpot's cached rendered positions
after moving themed text overrides. Inspect exported ink bounds as well as the
shape boxes; a changed box alone can leave the canvas text at its old position.

The linked global PC recorder successor is separately exported at
`../sp404mk2-synth/design/global-recorder-v1.json`. Its 1280×800 main preserves
the P6 OLED, pad and knob components, carries declared SPG1 capability and
shows unobserved controls and pressure as unknown. Its six native variants
are design examples, with no captured frame or physical global result.

In the version 2 public model, Synth uses the idle sampler/Generator lifecycle
scope and the recorder uses normal PANEL scope on sampler, pattern, FX and
utility screens. Unknown, modal and update states are refused. Audio transport
state is outside the offline dispatcher model. Physical Synth entry while a
pattern plays remains unqualified.

## Validation

The selection suite covers the strict version 2 roundtrip, stale catalog and
registry inputs, feature-specific scope, reserved and ambiguous chords,
chooser behavior, gap and rearm dispatch, and synthetic composition ownership.
Browser checks cover 320, 390, 768 and 1440 pixels in both themes,
accessibility, persistence, transactional import, conflict recovery and the
static fallback.

```powershell
node --test tests/features-selection.test.mjs
npx playwright test tests/features.spec.ts
npm run check
npm run build
npm test
```

The selection suite passes 59 cases and the feature picker has 13 browser
checks. Astro check, the static build and full `npm test` pass; the full run
includes 184 Playwright cases.

The UI detector reports no primary findings. Its typography advisories concern
the existing native 28/40-pixel headings and the 12-pixel mobile status label;
these documented surface sizes preserve the shared design. No public site was
deployed, and no firmware or device operation was performed.
