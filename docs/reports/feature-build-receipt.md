# Local build-receipt checks

Checked October 5, 2026. The feature picker can inspect a local build receipt.
It recomputes the exact selected SPCF configuration and normal-session marker,
checks the feature/profile labels and B2 capacity, and keeps source-family,
artifact, download, upload and release verification false.

The checker now accepts custom shortcuts for synth-only and recorder-only
profiles, alongside combined custom profiles. Each label remains bound to its
feature mask, normalized family key and actual default/custom intent. Two new
Python-derived configuration vectors cover single-feature custom chords; tests
refuse default, other-mask, combined and unknown labels for those selections.
The feature suite passes 154 cases with one optional real-receipt case skipped.
Type checking reports no errors across 155 files, and the static build passes
its 15 KiB page budget at 14,672 bytes maximum. The existing Penpot layouts,
components and visible copy are unchanged by this metadata correction.
Journey, demo, feature, emulator and CPU checks complete before the full
command's browser startup conflicts with an already running Astro preview.
Using that existing local preview, the browser phase passes 194 tests with
one optional real-receipt test skipped. Four actual private Source16 v2 package
receipts separately pass metadata inspection; their files are not copied into
website output. Package/runtime/device verification remains false.

The independent review found two omissions. A changed policy could pass when
its marker was recomputed consistently, and a combined package could be labeled
as Synth-only by changing a syntactically valid profile key. The inspector now
checks the mask's current policy, normalized family key and default/custom
profile class. Separate mutants verify both corrections.

`npm run test:features` passes 143 cases when the optional real local receipt is
supplied. This includes the existing 59 selection/composition checks, four
Python-derived public configuration vectors, metadata mutations and the actual
disabled package receipt. The session checks cover changed choices, overlapping
file reads, cancellation, read failures and unavailable Web Crypto. Root review
finds another omission: after an invalid shortcut edit, the controller can check
against the last valid selection. The correction blocks reading and inspection
until the selection is valid, including recovery to the previous valid choices.
The private receipt is read through an environment
variable; neither its contents nor local paths are copied into website assets.
The [vector provenance](../../tests/fixtures/features-config-vectors.json)
pins the Python consumers and catalog.

Type checking passes for 155 files with no errors, warnings or hints. The website
build and full `npm test` pass after browser integration and the selection
correction and import-race fixes, including 195 browser checks. Receipt browser cases cover malformed
and oversized files, stale read completion, and the actual disabled local receipt
with invalidation after a shortcut edit. The existing responsive and Axe checks
pass in both themes. Desktop/mobile screenshots were visually checked against
the linked Penpot section. The maximum ordinary page budget is now 14,663 bytes
gzip against the 15 KiB limit; emulator runtime is measured separately.

The [native receipt panels](../../design/penpot/feature-receipt.json) persist
after reload, with four linked theme/size instances and shared action components.
The normal section copy is shared with `src/content/features.json`; loading,
validation and error states are implemented in the browser. These are design
and interface checks, without publication or an SP update.

The [import review](feature-import-review.md) covers a separate race in the
configuration file control. Its revision guard retires pending imports after
manual edits or a newer file, and ignores old errors. Eight added browser cases
cover those paths and the storage-unavailable message. The layout and linked
components are unchanged by that correction.

Actual delivery still needs artifact verification, qualified
source/runtime/workflow evidence and the matched USB update procedure. See
[the composition contract](../feature-composition.md).
