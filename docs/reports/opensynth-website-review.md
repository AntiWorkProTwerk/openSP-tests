# openSynth website review, 6 October 2026

The additive release page, direct recording figure and local-build route passed
the coordinated static website checks. Nothing was published or connected to
the physical SP during this review.

`npm run check` checked 162 files with zero errors, warnings or hints.
`npm run build` emitted 24 pages and passed the private-artifact scan and script
budgets. The maximum complete-page script total was 12,880 bytes gzip, below
15 KiB. The release page used 1,571 bytes gzip of scripts; the local-build page
used 8,040 bytes. These are build measurements, not field performance results.

The first build reached the privacy scan and failed on a local helper URL
placeholder. The local-build worker changed the placeholder to plain copy and
preserved the fixed loopback restriction. The scanner remained unchanged;
the corrected build passed.

`npm test -- --workers=2` completed its model, CPU and Node checks. The browser
stage could not start a second Astro 7 preview because the existing root-owned
preview already held its lock. Its build-info matched the current 24-page
output, so only that failed stage was resumed with `OPENSP_TEST_URL` against
the existing preview. Playwright reported 200 passed and one existing optional
receipt test skipped. The six new release cases cover both themes at mobile
and desktop widths, accessibility, keyboard navigation, 320-pixel/no-script
rendering, recording limits and the held download state.

Saved browser views were inspected at mobile/light and desktop/dark; the
remaining theme/size combinations passed the same layout and accessibility
checks. The browser release layout is readable without horizontal overflow.
The final exported native release layouts have no text-frame board overflow.
They contain 73 linked component heads each, retaining shared nested OLEDs.

Native authoring initially missed Penpot's normalized slash spacing in shape
names, which prevented the intended text refit. Normalizing those names and
reflowing linked mains corrected the overlap. Reused Contents rail instances
also retained extra historical links; unused links were hidden on the additive
page while preserving the original main. These corrections were exported.

The direct recording source, scene and state contract remain frozen at these
SHA256 pins:

| Artifact | SHA256 |
| --- | --- |
| Shared design JSON | `2ec7d9d3b0881cbbb2edfcdbc9e38510654e3740d05f13555e1c8c6454a1b4a7` |
| Component export | `a118f7ad105aa6b4ecec885db807857468ebad08b9d51f9669b72c7bdd74b8be` |
| State contract | `cccb0fdf90fe1e8b903284c96bdbeaa0009455641635af6cf0b1a6baf6da61c1` |

Website checks do not qualify direct recording, pattern transport, native click
or a new firmware image. The page continues to label recording as pending.
Further website polish and native local-build copy cleanup are held following
the owner's hardware-first instruction. [Source mapping](../synth-release.md).
