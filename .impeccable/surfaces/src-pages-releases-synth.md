---
version: 2
slug: "src-pages-releases-synth"
primary_target: "src/pages/releases/synth.astro"
related_targets: ["src/components/releases/ReleaseSection.astro", "src/components/releases/OpenSynthScreens.astro", "src/components/releases/OpenSynthScreen.astro", "src/scripts/opensynth-screens.ts", "src/components/releases/OpenSynthPatcher.astro", "src/scripts/opensynth-patcher.ts", "src/styles/synth-release.css"]
---

# openSynth release page

Mode: Read. Route: `/releases/synth/`. The page inherits the OpenSP field-manual
layout, shared Penpot components, Arimo/Cousine fonts and semantic light/dark
colors.

On 9 October 2026 the owner asked for the final released version: present
tense, no build numbers, status badges or development history, copy edited with
the humanizer skill. The reader is an SP owner deciding whether to install. They
need to see the synth (one hero OLED animation, then one animation beside each
feature), learn the controls, build and
install it, and understand what protects their SP. Building happens on the page:
step 2 holds a dashed drop zone (whole page accepts the drop, Choose file
fallback), then a ruled four-stage progress box, then a solid ink download
button with the result SHA256. Errors sit in a ruled box under the drop zone.

Use a contents rail and one reading column; mobile moves contents above the
article. Thin rules divide sections. Features are a ruled list: Cousine uppercase
label over the text, with that feature's 2x OLED animation in a right column on
desktop and below the text on mobile. Safety facts keep the ruled definition
list. OLED tiles use whole-pixel zoom only. Patch steps use an ordered list because the sequence matters.
The page stays static and readable without JavaScript; animations are optional.

Do not invent features or claim the SP cannot be bricked. Do not host or embed
Roland firmware; link only to Roland's own v5.52 support page. Screen tiles are renders of the openSynth display code, not
device captures.
