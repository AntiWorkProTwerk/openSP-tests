# Emulator native design

The OpenSP Penpot file has **Emulator components** and **Emulator** pages.
Four linked layouts show the initial single-session page at 1440px and 390px,
in light and dark themes. Four separate interaction examples show ready,
loading, paused and worker-error states. Their label states that firmware does
not run on the Penpot canvas. The browser implementation and its evidence are
described in [emulator.md](emulator.md).

The layouts extend the existing field-manual design. Arimo carries reading text;
Cousine carries technical values and navigation. Colors reference the existing
semantic library assets. Mobile stacks the instrument and execution controls,
uses a four-column pad grid and keeps the USB report controls in the reading
column. Theme and size overrides retain their component links.

## Source mapping

| Native component or asset | Browser source | Shared definition |
| --- | --- | --- |
| Emulator introduction, desktop/mobile | `src/pages/emulator.astro` | `src/content/emulator.json` |
| Emulator session, desktop/mobile | `src/pages/emulator.astro`, `src/scripts/emulator.ts` | Session structure and shared state labels |
| Instrument and its nested panel parts | `src/components/SPInstrument.astro`, `src/lib/penpot.ts` | Existing exported SP geometry |
| Emulator blank OLED | `canvas[data-oled]` in the shared Instrument screen slot | Empty 128×64 screen; firmware output supplies pixels at runtime |
| Emulator execution, desktop/mobile | `.emulator-session-controls` | Shared diagnostics and copy |
| Emulator inputs, desktop/mobile | `.emulator-inputs` | Sixteen pad actions; named model controls |
| Emulator USB, desktop/mobile | `.emulator-usb` | Local virtual 64-byte HID exchange |
| Emulator action and status variants | Semantic browser buttons and session status | Shared labels; runtime enables actions and reports errors |
| Footer → Utility link | `src/components/SiteFooter.astro` | `emulator.json` title and `/emulator/` target |

Fourteen emulator mains nest linked instances. Each session retains the shared
Instrument and swaps its OLED content slot to the blank main, preserving the
circular aperture. The default has no firmware, marker or report. The homepage's
R3 sequence and canonical Instrument main remain unchanged. Native button opacity
depicts the initial disabled controls; the browser enables file selection after
initialization. The browser implements labels, focus, announcements, disclosures
and keyboard/pointer input. Penpot records their visual states.

The existing shared Footer main now contains a linked Utility link. Its text is
24px high; the browser gives the link a minimum 44px target. Desktop places it
beside the page metadata. Mobile places it on a separate row. The two chosen
primary navigation actions and existing footer wording are preserved.

## Snapshots and checks

The current native API exports are
[emulator-components.json](../design/penpot/emulator-components.json),
[emulator-layouts.json](../design/penpot/emulator-layouts.json),
[emulator-states.json](../design/penpot/emulator-states.json) and
[emulator-footer-components.json](../design/penpot/emulator-footer-components.json).
The [propagation record](../design/penpot/emulator-footer-propagation.json) and
[text-bound readback](../design/penpot/emulator-footer-bounds.json) cover the
80 Footer instances on Homepage, First guide, Guide series, Guide index and
Emulator. These exports supplement the preserved older native archives; they
are editable structure snapshots rather than a replacement `.penpot` archive.

Native design status: saved and reviewed locally. The website has not been
deployed in this task. The [source manifest](../design/penpot/emulator-manifest.json)
records snapshot hashes and the scope of the parent review. A fresh reviewer
agent could not start because the agent thread limit was reached; the parent
reviewed all four native canvas captures together. It found no concrete design
defect. The light desktop hover outline remains a documented capture artifact.

`node tools/design-emulator.mjs export` reads the saved mains, layouts and state
sheet. `node tools/design-emulator.mjs pull-copy` reads visible `copy/` fields
from the component snapshot into the shared JSON. It rejects disagreements
between responsive variants and retains accessibility and dynamic strings that
are absent from the canvas. Review that diff before building. There is no
automatic Penpot/code synchronization. Browser behavior and firmware tests remain
separate from `node --test tests/emulator-design.test.mjs`.

The authoring helpers guard the file and active page before edits. Component
creation refuses an existing or partial board. Inspect the current native
structure before repeating a stage. Footer verification uses read-only proxies
while the smaller Emulator page stays active; do not reload the entire Guide
series canvas for a bounds check.

## Preserved failures and limits

The first session assembly could not find the qualified OLED slot name. Its
partial board remains hidden as **Archive / Emulator session first attempt**.
The corrected lookup preserves the original nested component links.

The first whole-page footer pass displayed Canary's Out of Memory page and
timed out. Its cause is unknown. Reopening the owned tab directly on Emulator
recovered the MCP connection; readback confirmed the saved mains and layouts.
The shared utility had reached all 64 Guide series Footers, but its mobile
placement still needed adjustment. An inactive-page edit was rejected before
its first property changed. The
[failure record](../design/penpot/emulator-footer-failed-pass.json) preserves
those observations.

The successful pass fits one active Footer per request, filters matching
components before walking visibility and grows a parent board only when the
new footer actually exceeds its bottom edge. These changes bound the work;
they do not establish the earlier crash's cause. Text readback found a wrapped
mobile checkpoint value exceeding its frame. The shared mobile execution main
and its linked uses now reserve enough height for that value.

The focused design test also caught narrow loading/resume labels and a wrapped
worker-error message on the state sheet. Both shared status mains now reserve
space for the longer labels and recovery text. The final seven structural checks
cover shared copy, component links, initial diagnostics and saved text bounds.
The first PNG export timed out. A subsequent native SVG export completed after
the owned Canary tab was focused; the SVG retains official Penpot font URLs for
Arimo and Cousine. That timing does not establish why the PNG export failed.
Two later SVG requests timed out at the hosted task's 120-second limit. The
remaining review uses full-page images assembled from unedited strips of the
owned canvas, at 0.65 desktop zoom and 1 mobile zoom. The light desktop canvas
retains an editor hover outline; its completed SVG supplies the clean native
export. [Image-export status](../design/penpot/emulator-image-export-status.json)
records that limitation. Capture pixels and their manifest stay in the ignored
review directory.

The exported layouts show interface design, not boot or recovery evidence.
Peripheral and CPU coverage remain incomplete. R13 browser/model results,
stock startup faults and virtual flash results must retain the limits recorded
in the emulator evidence. Physical audio, updates and recovery require separate
device verification.
