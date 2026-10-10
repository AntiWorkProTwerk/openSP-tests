# OpenSP design language

## Production homepage

The approved homepage is implemented in Astro using the current Penpot native
component and library-asset snapshot. The instrument keeps its exported geometry;
page text uses semantic HTML, shared copy and responsive CSS. Both themes share
one template. The R3 display plays through the reusable browser component.
The [development guide](development.md) records the pull, test and deployment
workflow. The first published guide has a real article route; remaining preview
rows are marked as unpublished and do not link to the older design studies.
The history below records how the design reached this
point; references to a blank public site describe earlier checkpoints.

The shared SP now includes linked **Knob surround** and **Effects surround**
mains. Its wider OLED meets the inner circular opening and clips at that edge.
The homepage and first guide use these parts in both sizes and themes; page
copy and overall layout were preserved by that geometry change. [Panel reference and source mapping](references/sp-panel.md)
record the geometry and native propagation checks. Older unlinked studies stay
historical.

## First guide

**First guide** extends the existing field-manual layout with a desktop contents
rail and a collapsible mobile index. Its light/dark desktop and mobile boards
are paired on the canvas. **Guide components** holds the linked paragraph,
heading, caption, contents and figure mains; sections reuse those parts.
The instrument keeps the shared SP assembly, with a separate `Menu title screen`
instance in its existing viewport. The homepage's R3 sequence is unchanged.

Native posters show the browser controls and final evidence state. The browser
implements autoplay, pause, scrubbing, highlighting and disclosures; Penpot does not play
these sequences. The design uses the approved Arimo/Cousine typography and
semantic theme colors. API snapshots and the source mapping are recorded in
[the native export notes](../design/penpot/README.md) and
[development guide](development.md). [The source ledger](first-guide-sources.md)
keeps the historical title change separate from later firmware milestones.

The expanded article uses seven numbered steps with reader checkpoints. Five
figures share one timeline pattern: a play/pause arrow, a thin seek line and a
small elapsed/duration readout. Playback begins once on entering the viewport,
pauses offscreen/hidden, and stays stopped after a manual pause. Reduced motion
defaults to the complete poster. The downloadable Python exercise reproduces
only the offline comparison structure; it is not a hardware installation guide.

## Firmware emulator

The **Emulator** page extends the field-manual design with independent firmware
sessions, a shared Instrument with an initially blank OLED, execution diagnostics,
input controls, optional SD images and virtual USB reports. **Emulator components** contains sixteen
native mains. Desktop/mobile light/dark layouts use linked instances and existing
theme assets. A separate state sheet labels its ready, loading, paused and error
examples as design examples. The shared Footer now contains the emulator utility
link; the chosen primary navigation remains Releases and Guides.

[The emulator source map](emulator-design.md) connects these mains to the shared
JSON, Astro template and browser behavior. It records native exports, responsive
footer propagation, preserved failed passes and the distinction between layout
checks and firmware execution evidence.

## Design history and source

Tool: **Penpot**, connected through the signed-in Canary UI on 2026-09-28.
The **OpenSP** file is in Personal Projects / Drafts. **Desktop concepts** contains
three proposed editorial layouts, a component/state sheet and a modular panel
sheet. The owner expanded the blank-start request to design exploration.
The corrected diagrams were visually checked in Penpot and persisted through
reload. They are imported vector groups, not a published native component library.
The second page, **Mobile layouts**, contains six mobile compositions.
Native snapshots are saved in [design/penpot](../design/penpot/README.md).
The [all-page overview](../design/exports/opensp-all-pages.png), captured before
the owner's later homepage copy edits, combines all six
visible pages at 8,000×13,314 pixels. Its [export workflow](../design/exports/README.md)
preserves the original artwork and leaves the Penpot canvas unchanged.
The **Responsive comparisons** page places matching desktop/mobile views
next to each other for each article direction, with light/dark pairs. Component
and panel-part sheets follow in both themes. [Desktop review](../design/studies/desktop.html)
and [paired contact sheet](../design/studies/responsive-pairs.svg).

**Homepage** in Penpot holds the homepage proposal with exactly two centered
primary navigation links: Releases and Guides. The responsive preview is
[home.html](../design/studies/home.html); [home-pairs.svg](../design/studies/home-pairs.svg)
keeps desktop/mobile next to each other in both themes. The owner-selected hero
title is “OpenSP”. The owner later expanded the introduction to include tools
and a sentence about GitHub. Exact current wording is in
[home-copy.json](../design/studies/home-copy.json). Large introductory
type, the modular SP illustration, a release-index placeholder and three sample
guide links establish the structure. Links open design studies, not finished
guides; no release/version/download claims are invented. Generate with
`python design/studies/home.py`. This page is a proposal, not a public deployment.
The earlier native checkpoint preserves the imported homepage before migration.
The latest [native snapshot](../design/penpot/README.md) contains four linked
Homepage boards: desktop/mobile in light and dark, paired side by side.
The hero no longer includes the method strip, guide CTA or instrument caption.
Releases and Guides are independent native HTML disclosures in the preview,
open initially, with keyboard support and navigation links that reopen them.
Penpot shows the expanded visual state, not a wired accordion prototype.
The owner prefers the original monospaced section typography inspired
by the Teenage Engineering guide, now without the numeric prefixes:
`RELEASES` and `GUIDES`. The current native layouts and browser preview
use Cousine for both top navigation links, the project eyebrow and section labels.
Arimo carries the title and reading text. The hero has modest negative tracking;
desktop sections share the restored 272px label rail plus a 48px gap. The release
preview sits below its copy, and guide descriptions sit beneath their titles.
The owner preferred this earlier grouping to the side-by-side proposal.
Mobile retains its single reading column.
The owner wants the SP to dominate the hero. Its linked Instrument instance is
now 440px wide on desktop and 320px on mobile, up from 240px and 180px. The full
panel keeps its proportions and all nested component links. These are homepage
scale overrides; the canonical SP component and other pages retain their sizes.
Sections move down with the taller image but keep their internal layout.
The browser hero stacks at 720px, with the SP clamped to the available width.
The current native boards are 1440×1592 and 390×1904, with matching theme geometry.
The white desktop board supplied the updated copy for all four views. The hero
uses separate paragraphs, mobile shows both section descriptions, and the longer
footer wraps. The owner-hidden preview notice is hidden throughout and its gap
removed. Five shared component mains were updated; section-specific wording
remains an instance override. All four copy/bounds checks pass. Twenty-four
browser width/theme checks pass with the updated wording.
[Reference notes](references/teenage-engineering.md) distinguish TE
observations from OpenSP choices. Impeccable is installed globally and required
by this repository's AGENTS.md for Penpot design work.

The first whole-page migration hung before saving. A later attempt used bounded
steps and skipped hidden archived SVG trees. Each homepage board retains 11 linked
top-level instances (the preview notice is hidden); its Instrument contains 54
nested component heads before the screen addition described below.
The old imported homepage and compatibility sample are hidden archive layers.
The older article concept pages remain unlinked migration work.

**SP components** holds native main components under **Assets → Components → SP**:
Display, Knob, Pad - idle, Pad - active, Button, Enclosure, Pad grid,
Effect buttons, Control section, Performance buttons, and Instrument.
The SP main components were converted to native shapes and editable text.
Instrument now nests linked part instances, Pad grid uses 16 linked pads, and
the control/performance sections use the shared Button. The original SVG groups
are retained as hidden archive layers inside their main components. Earlier
imported article layout illustrations remain unlinked; the new homepage uses
the native Instrument component.
Source vectors: [components](../design/studies/components/),
generated by `python design/studies/components.py` from `panel.py`.
The owner caught the straight effect-button columns: the shared source now
uses mirrored slanted outer buttons tucked toward the screen, following
Roland's panel illustration on p.6. This is a simplified drawing, not CAD.

The homepage now uses the [reusable SP display](sp-display.md) for the original
AntiWorkProTwerk R3 animation. A new `SP/Screens/AntiWorkProTwerk R3` native main
is nested in the Display's content slot and reaches all four linked homepage
views. Each instrument now has 55 nested component heads. Penpot shows its
editable poster; the browser review plays the same 64 original renderer frames.
The stock caption/UI are absent from that trace and 50 ms timing is a preview
assumption. Poster, player and provenance are separate from the instrument shell.
Desktop/mobile content fits are derived from the existing OLED window; no other
homepage geometry or copy changed. The earlier native archive and overview
predate this addition.

**Design system** contains 12 additional website components: Wordmark, Primary
links, Theme selector, Section label, Navigation, Hero copy, Section header,
Release card, Release content, Guide row, Footer and Preview notice. The file also has named
light/dark color assets and 15 shared typography styles. The owner approved
Arimo and Cousine for native editable text after Penpot rejected Arial and
Courier New as unregistered fonts. The homepage preview self-hosts the approved
fonts, with licenses in `design/studies/fonts/`. Typography assets remain linked.
A shared Navigation tracking change was verified in all four homepage views.
Text-color overrides can prevent component-level text changes from propagating;
edit shared typography assets for global font changes, then verify each theme.
Penpot 2.18.1 left paragraph leading at 1.2 when applying/updating typography
assets. `sync-home-leading.js` explicitly propagates each shared style's leading
to the mains and homepage copies without removing color or typography references.
Responsive sizes and dark color references are documented instance overrides.

The owner approved switching from the mismatched local MCP 2.15.4 connector
to Penpot's official hosted MCP. [Connection instructions](penpot-connection.md)
cover the encrypted credential and repository client. The earlier hang's cause
remains unknown. Scripts in `design/penpot/` are staged operations, not safe
repeatable whole-file rebuild commands. `compact-home.js` records the tighter
hero and the superseded side-by-side sections. `restore-sections.js` restores
only the earlier section geometry, preserving the hero, navigation and SP.
Neither `compact-home.js` nor `refine-home.js` should be rerun as the current layout.
`enlarge-home-sp.js` applies the later hero scale override in bounded batches,
checking that navigation, hero copy and section internals remain unchanged.

[Open the OpenSP canvas](https://design.penpot.app/#/workspace?team-id=a5ac146a-5787-80fa-8008-b51846f04474&file-id=24d9d841-759d-81bc-8008-b518bc70d8b3&page-id=24d9d841-759d-81bc-8008-b518bc70d8b4).
Access requires the owner's Penpot account; this is not a public sharing link.

## Penpot and repository-owned tokens

[Penpot design tokens](https://help.penpot.app/user-guide/design-systems/design-tokens/)
support named colors, typography, spacing, dimensions, borders and shadows,
including aliases, sets, themes and JSON import/export in DTCG format.
Use the visual canvas to compare directions, then export agreed values into
this repository. Import/export is a file workflow; automatic GitHub syncing
has not been established for this setup.

For collaboration directly in the website, we can also build a browser style
guide here: swatches, type specimens, spacing, buttons, cards and article
examples. The owner reviews the real rendered design, and agreed changes
become versioned tokens and CSS.

## Next together

The [stack decision](website-stack.md) chooses Astro static output, with Svelte
only for interactive pieces that need it. No production framework is installed
or deployed. Shared content should feed one responsive template in both themes;
Penpot-to-code updates still require review.

Choose parts from the [local review page](../design/studies/index.html):
A field manual, B lab journal, C guided walkthrough, D shared states, E panel parts.
The public homepage remains blank. These are proposals, not approved styling.
Keep agreed design values as
exported JSON in `design/tokens.json` when we have actual tokens to export;
retain this document for rationale and usage rules. Build the browser style
guide after choosing the first article direction. Arimo and Cousine are approved;
the current monochrome theme values remain proposals.

## Reference-led studies / September 28

- [Teenage Engineering EP–133 guide](https://teenage.engineering/guides/ep-133):
  numbered sections, hardware-first diagrams and generous whitespace.
- [Bartosz Ciechanowski](https://ciechanow.ski/mechanical-watch/): interactive
  illustrations explaining cause and effect alongside the narrative.
- [Red Blob Games](https://www.redblobgames.com/grids/hexagons/): readable
  technical prose combined with explorable diagrams.

The first SP drawing incorrectly rearranged the physical controls. The owner
flagged this. The replacement follows the panel illustration and control lists
on pp. 6–11 of [Roland's reference manual](https://static.roland.com/assets/media/pdf/SP-404MK2_v4_reference_eng02_W.pdf).
It restores the circular display bezel, flanking effect buttons, lower VALUE
knob and control rows, left four-column pad grid and right performance column.
Shapes and proportions are simplified, not measured CAD; display content is invented.

The owner requested composition from parts. [panel.py](../design/studies/panel.py)
provides separate enclosure, knob body/indicator, display bezel/screen, effect
buttons, record/edit controls, banks, individual pads and performance buttons.
Named SVG groups allow independent states/animation. The browser study connects
pad selection, CTRL 1, display, play/pause/reset and manual steps; it has no
hardware connection or sound. Pointer/keyboard, mobile width, SVG IDs and
JavaScript smoke checks pass with [check_studies.py](../design/studies/check_studies.py).
Generate with `python design/studies/build_studies.py`. Fonts are preliminary
system-font studies. SVG import is manual; there is no automatic Penpot sync.

## Mobile and themes

The [responsive article review](../design/studies/mobile.html) provides three
switchable layouts with actual reflow, not scaled-down desktop screenshots.
On mobile, contents collapse, captions replace margin notes, columns stack,
and the guided direction presents one explanation at a time. Full-size pad
selection, previous/next, and knob controls supplement the small panel targets.
All three [390px compositions](../design/studies/mobile-concepts.svg) have light
and dark variants in Penpot. Desktop illustrations also have dark SVG variants.

[theme.css](../design/studies/theme.css) uses semantic paper/surface/ink/muted/line
values; dark paper is charcoal, text is off-white, and the OLED stays dark.
Light/Dark/System selection is keyboard-accessible, persists locally, and reacts
to OS changes in System mode. Motion is opt-in and honors reduced motion.
The values are implementation proposals, not exported Penpot design tokens.

Smoke checks cover 30 width/layout/theme combinations at 320, 390, 430, 768 and
1280px, overflow, pad selection, step navigation, theme persistence and system
changes. The public `site/` remains unchanged; these are repository review files.
An additional ten desktop checks verify every study loads its matching light
and dark SVG at full 1200px source width. All generated SVG IDs are unique.

## Previously considered alternative: Figma with Tokens Studio

[Tokens Studio](https://docs.tokens.studio/token-storage/remote/) supports
remote token storage, including GitHub, alongside a visual Figma workflow.
This is a useful option if the owner already prefers Figma. Account connection,
plan requirements and plugin installation have not been configured here.

## What we should codify together

1. Personality and visual references: what the project should feel like.
2. Colors, typography, spacing, layout widths, borders and motion.
3. Reusable elements: navigation, journal entries, milestone cards and evidence labels.
4. Editorial rules: voice, captions, and clear distinctions between proposals,
   emulator results and physical hardware observations.

Keep the rationale in a design-language document, values in a token file,
and visible examples in a browser style guide. Tokens encode the repeatable
values; examples and prose explain how to use them. These are proposed next
steps, not an implemented design system.
