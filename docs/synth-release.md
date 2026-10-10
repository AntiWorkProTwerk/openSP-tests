# openSynth page and examples

`/releases/synth/` is the openSynth page. The older `/opensynth/` URL redirects
here. The page carries an in-browser patcher: the visitor drops Roland's official
v5.52 update and the browser builds `SP404MKII_APP1.bin` locally. OpenSP never
hosts, embeds or receives Roland firmware. The page keeps `noindex` until release
day; removing it is a deliberate publication step, not a copy edit.

## Page structure (schema 2, final-release copy, 9 October 2026)

The owner asked for four parts, in order: a brief introduction with screen
animations, features with how-to steps, how to patch, and why it won't brick the
SP. On 9 October 2026 the owner asked for the copy to read as the released
product, in present tense, edited with the `humanizer` skill. So the page has no
build numbers, status badges, "in testing" or "pending" wording, and no
development history. It still describes only features the openSynth source
implements (checked against the sp404mk2 `STORY.md` openSynth chapters and the
P19 `sp_p6_view.c`, `sp_p6_menu.c` and `sp_p4_controls.c`). Whether every feature
has passed on hardware is tracked in sp404mk2, not on this page.

`src/content/releases/synth.json` (schema 2) holds all copy; section IDs are
`features`, `patch` and `safety`. Feature rows are `{label, text}` only. Control
facts used: VALUE turn picks the sound, held VALUE + turn changes octave, VALUE
click steps OSC/AMP/TONE/MOD, SHIFT + VALUE press opens the menu (SOUND, VOICE
MONO/POLY, LOGO), SHIFT + VALUE turn is synth level, VOLUME stays master. On-screen
knob names are MIX/DET/PW, ATK/DEC/REL, CUT/RES/ENV, RATE/DEP/GLIDE.

The patch steps follow the documented APP1-only SD route: SP-formatted card,
APP1 file at the root as `SP404MKII_APP1.bin` with no other update BINs, SHIFT at
power-on, `APP1 UPDATER FOUND`, `UPDATE COMPLETE PLEASE POWER OFF`, then a normal
boot and the Synth menu title. The safety section says what protects the user
(APP1 only; resident loader with the SHIFT + power SD updater, APP0 and fuses
never written; an SD card with Roland's official update as the way back) without
claiming the SP cannot be bricked.

## Browser patcher

The owner asked on 9 October 2026 for the patcher to be a utility on the page:
link to Roland's download, drop the file, get a progress bar and a download.
This replaces the source-patcher block on the page. The source-patcher route
(`synth-source-patcher.json`, `tools/source-patcher-publication.*`) is kept as
tooling and still guarded by `check-build`, but the page no longer renders it.

Why the earlier browser patcher was retired: the October 2026 publication rule
was "source patcher only", because the openSynth build `.incbin`s authenticated
official intervals (vendor instructions and glyph data) and copies stock bytes
for base corrections, so the compiled APP1/module contains Roland bytes, and the
withdrawn P6S payload targeted a superseded build. All of those Roland-derived
bytes are verbatim copies of the stock image, so a patch can express them as
copy operations from the visitor's own file. The current patch format makes that
a hard property (below), which is why the browser route came back.

### Patch format (`opensynth-binpatch/1`)

`public/opensynth/patch/opensynth-v552.ospatch`: the ASCII magic `OSPATCH1`, a
u32 header length, a JSON header (`input` and `output` name/bytes/SHA256,
`zipEntry`), then operations: `01 from:u32 len:u32` copies from the visitor's
APP1, `02 len:u32 bytes` stores openSynth bytes, `00` ends. All integers are
little endian. `tools/opensynth-patcher/make-patch.mjs` builds it from the stock
APP1 and a finished openSynth APP1 and writes the pins to
`src/content/releases/synth-patch.json`:

```sh
node tools/opensynth-patcher/make-patch.mjs --official STOCK_V552_APP1.bin --target OPENSYNTH_APP1.bin --build "LABEL"
```

The generator copies every run of 8 or more bytes that occurs anywhere in the
stock image (exhaustive hash-chain check), so no 8-byte window of stored data
occurs in Roland's image; it refuses to write otherwise. The stock APP1 is read
from the sp404mk2 workspace (`firmware/v552/extracted/sp404mk2_sys_v552/`) and is
never copied into this repository.

The shipped patch is a development build from the openSynthP20 candidate
(sp404mk2 `diagnostics/opensynth_p12_combined_build_12/final-build-001`, APP1
SHA256 `909b92107a5c93b50ff2382dfb0c79cec0835319f93829b2576d5f2ff957e718`),
which is not hardware verified. Regenerate it from the final hardware-verified
APP1 before release and commit the new `.ospatch` and `synth-patch.json`
together.

### Page behaviour

`OpenSynthPatcher.astro` renders inside step 2 of the patch steps (steps are
strings or `{text, link?, patcher?}` objects in `synth.json`; copy lives in
`synth.json` `patcher`). `src/scripts/opensynth-patcher.ts` (about 1.1 KiB gzip)
handles the drop zone, file picker and a whole-page drop target, and starts
`opensynth-patcher-worker.ts` only when a file arrives. The worker fetches the
patch, reads the file with progress, and `src/lib/opensynth/patcher.ts` checks
the patch SHA256 against the pin in the page, accepts Roland's ZIP
(`sp404mk2_sys_v552.zip`, deflate or stored) or the bare `SP404MKII_APP1.bin`,
checks the APP1 size and SHA256 against the header, applies the operations and
offers `SP404MKII_APP1.bin` only when the result matches the output SHA256. The
four stages (reading, verifying, patching, checking) drive one progress bar.
Errors name the problem and the fix. Without JavaScript a note explains that the
patcher needs it. Roland's v5.52 page:
`https://www.roland.com/global/support/by_product/sp-404mk2/updates_drivers/174cc2fc-ddb2-4128-87a0-848b882cdcea/`
(checked 9 October 2026; Roland asks visitors to accept its license first).

Penpot: `node tools/design-opensynth-page.mjs patcher` loads
`design/penpot/opensynth-patcher-library.js`, creates the six state mains
`openSynth patcher Drop zone|Working|Done (Desktop|Mobile)` on Release
components (path `OpenSP / Releases`), redraws the `Synth release patch` mains in
place with a linked Drop zone instance inside step 2 (layout instances follow),
and builds the `openSynth patcher / States` review board on Synth release with
every state, size and theme as linked instances. On 9 October 2026 the first
run created five state mains (all but Done Mobile) under the bare names
`<State> (Desktop|Mobile)` before the hosted MCP plugin stopped sending
heartbeats; a reload did not restore it. The library adopts and renames those
mains on the next run instead of duplicating them. The patch-section redraw,
Done Mobile, the review board and `export` are still to run. Browser captures of
all four states at 1440/390 px in both themes are in
`design/exports/opensynth-page/patcher/`.

`tools/check-build.mjs` allows exactly one `.ospatch`, at the pinned URL, whose
bytes and SHA256 match `synth-patch.json` and whose header targets the official
v5.52 APP1. Loose JSON patch formats stay refused.

### Held direct-USB groundwork

`src/lib/opensynth/r50-webhid.ts` is the unexposed browser transport for the
second half of the stock-first route. It does not discover `navigator.hid`, ask
for a device or add a page control. A caller must inject the exact
`CAFE:404F`, `SP404 STOCK FLASH R50`, vendor `FF00/1` endpoint. The read-only
attestor requires explicit real-power-cycle and fresh-connection confirmations,
reads two matching fresh `SP50` reports and sends nothing.

The guarded installer owns and hash-checks the patch result, rechecks the B2
envelope, probes C22016/status40, uploads ordered 56-byte chunks, verifies RAM
CRC, sends COMMIT once, waits for full-sector state6, closes and reopens the
device, then requires two matching terminal reports. Its receipt remains
incomplete until normal OpenSynth boot and cold-DEL B2 return are recorded. The
read-only completion attestor requires a real normal power cycle and the exact
`openSynthP29` screen identity, then a separate cold DEL-held power cycle. It
accepts only `CAFE:4050`, `SP404 USB BRIDGE B2`, vendor `FF00/1`, and two matching
fresh `SP17` reports with marker `52420201`; it sends zero reports.
Errors after a possible COMMIT are marked uncertain and must not be retried.
The public patcher still downloads a file; no browser device picker or physical
SP connection is shipped.

## Screen animations

`tools/opensynth-render/render.py --source-root SP404MK2_CHECKOUT` compiles
`render.c` with the P19 build_11 openSynth view, controls, voice, visual, volume
and DSP sources plus the REC modal view (`p7/sp_p6_rec_modal_view.c`) and the
pattern chooser view (`p7/sp_p6_pattern_transport_view.c`) (`ziglang` host
compiler) and writes native 128x64 1-bit frames plus `SOURCES.json` (source
SHA256 pins) to `design/assets/screens/opensynth/frames/`. The harness stubs only
native SP state: pattern slots/current/next (bank A, six patterns), REC CLK on,
a pattern diagnostic line that reports no pad press (so the chooser draws its
own hint line; on the device a pad press replaces it with a status line) and
zeroed REC save diagnostics. SAVING is not rendered because it prints
diagnostic fields. The play-page header's menu title carries a build name, so no
menu frames are used. Existing frames re-render byte for byte.
`tools/build-opensynth-screens.py` then builds one vertical sprite per animation
in `public/opensynth/screens/<id>.png`, 4x first-frame Penpot posters in
`design/assets/screens/opensynth/` and `src/content/releases/opensynth-screens.json`
(frame timings, frame SHA256s and the display-source pins). Renders are not
device captures and frame timing is chosen for the page; no Roland firmware or
stock screen is used.

On 9 October 2026 the owner asked for every feature to have its display
animation next to it. Each feature row in `synth.json` names its animation
(`screen`, optional `screenCaption` for alt text and caption):

| Feature row | Animation | Frames |
| --- | --- | --- |
| Sixteen sounds | `sounds` | play page: Soft Sine, Wide Saw chord, Acid Pulse, Slow Pad, Soft Organ, Sub Bass |
| TONE, OSC, AMP and MOD pages | `pages` | Wide Saw chord on each page in VALUE order |
| Scope and pictures | `amp` | Slow Pad AMP envelope dot through release |
| MIX and PW | `mix-pw` | existing `mix`, `pw` and `pwlock` frames |
| MONO or POLY | `voice` | Wide Saw chord in POLY4 (3/4) then MONO (1/4) |
| Synth level | `level` | real `sp_p6_volume` steps 24, 22, 18, 14, 18, 22, 26 with the VOL footer |
| BUS FX | `scope` | Slow Pad release; caption says the scope is pre-BUS FX |
| Fixed velocity | `velocity` | Pluck on four pads; the synth voice takes no velocity |
| Patterns | `patterns` | openSynth chooser (none, A03 current, A06 next), then the play page |
| Record to a pad | `record` | REC prompt, ARMED pad 3, RECORDING frame count, SAVED |

The introduction shows one 4x hero screen (`detune`; 3x below 1180px, 2x on
phones) instead of the former six-tile grid, so no animation repeats.
`OpenSynthScreen.astro` renders one tile at whole-pixel zoom (2x in rows);
feature rows are a `ul.release-features` with an `h3` label, text and the tile
(right column on desktop, below the text under 760px). `OpenSynthScreens.astro`
is a page-wide `<opensynth-screens>` controller around the article:
`src/scripts/opensynth-screens.ts` observes each tile, steps only visible
ones, pauses all while the page is hidden, starts paused under reduced motion,
and syncs the two Play/Pause buttons (hero and features). Without JavaScript the
first frames show and the buttons stay hidden. The manifest keeps the earlier
`mix`, `pw` and `pw-lock` entries for the Penpot posters.

The earlier interactive `SynthExamples` model and `DirectRecordingFlow` remain in
the repository with their model tests but are no longer on this page; their copy
describes P11 behaviour (for example VOLUME as synth gain) and would need review
before reuse. The homepage card in `src/content/releases/opensynth.json` still
uses "In testing" badges and is outside this page's scope.

## Penpot source

Use the existing shared OpenSP file
`24d9d841-759d-81bc-8008-b518bc70d8b3` and its Synth components, Synth UX,
Release components and Synth release pages. Reuse linked Instrument, OLED
header/footer, CTRL-triplet and the existing P6 screen mains. Source mappings:

| Export or component | Use |
| --- | --- |
| `production.json` / `SPInstrument` | Shared instrument and nested panel parts |
| `synth-release-components.json` | Shared introduction and section mains |
| `synth-release-layouts.json` | Desktop/mobile layouts in both themes |
| `synth-direct-recording-components.json` | Preserved earlier recording concepts |
| `synth-pattern-transport-components.json` | Existing linked pattern poster |
| `SynthExamples.astro` | Earlier interactive example (not on the schema-2 page) |
| `openSynth screen tile` / `OpenSynthScreen.astro` | Hero and per-feature screen animations; sprites from `opensynth-screens.json` |
| `openSynth page introduction` + `Synth release features/patch/safety` | Schema-2 page mains; layouts in `opensynth-page-layouts.json` |

The earlier recording concept exports retain their historical geometry. P11's
current recorder uses an 8 by 2 pad-number layout, so their captions explicitly
identify them as earlier concepts. They are not device captures or exact P11
screenshots. Do not refresh frozen contracts as a side effect of website work.

The native handoff requests export of the existing P6 poster mains and a refresh
of release copy in all four linked layouts. Native propagation and visual review
must be verified separately; code does not automatically synchronize Penpot.

### Schema-2 openSynth page in Penpot

`node tools/design-opensynth-page.mjs components|layouts|export` loads
`synth-release-library.js` plus `design/penpot/opensynth-page-library.js`. It added
mains on Release components (path `OpenSP / Releases`): `openSynth screen tile`
(OLED bezel + Screen image + Title + Caption; instances override only those),
`openSynth page introduction (Desktop|Mobile)` with six linked tiles, and
`Synth release features|patch|safety (Desktop|Mobile)` built from linked Article
heading/paragraph. Mobile tiles override child geometry only. Four layouts
`openSynth page / Desktop|Mobile / Light|Dark` on the Synth release page use
linked Wordmark, Contents rail, intro and section instances; export is
`design/penpot/opensynth-page-layouts.json`. The earlier `Synth release / ...`
layouts and mains are preserved unchanged as history. `refresh-components` clears
and redraws the existing openSynth mains in place (linked instances follow) and
`refresh-layouts` replaces the four openSynth page layouts. The pinned
`design-synth-release.mjs refresh*` plan targets the old six section IDs and will
refuse schema-2 copy by design. PNG checks:
`design/exports/opensynth-page/penpot-*.png`; browser captures sit beside them.
The Penpot tab must stay focused during exports or its plugin heartbeat suspends.
`node tools/design-opensynth-page.mjs features` (9 October 2026) redraws only the
introduction mains (one linked hero tile, geometry override to 4x on desktop)
and the features mains (one linked `openSynth screen tile` per row, poster,
title and caption overridden, beside the text on desktop and below it on mobile)
in place; then `refresh-layouts` and `export`. Each of the four layouts has 11
linked tile instances. The feature-aware `section` is installed as
`d.section0` because the patcher library wraps that name. The patch section in
the Penpot layouts still shows the older source-patcher copy (patcher redraw
pending, see Browser patcher).

## Verification

Run `npm run check`, `npm run build` and `npm test`, plus the focused model suite:

```sh
node --import ./tools/register-test-typescript.mjs --test tests/synth-examples.test.mjs
```

`tests/opensynth-patcher.test.mjs` (`npm run test:opensynth-patcher`) covers
patch apply from raw APP1 and both ZIP methods, wrong-file, wrong-entry,
truncated-ZIP, damaged/substituted patch and output-mismatch refusals, and, when
the stock APP1 is present locally (or `OPENSP_STOCK_APP1` is set), scans the
shipped patch for Roland runs and rebuilds the pinned output from the real APP1
and ZIP. `tests/opensynth-r50-webhid.test.mjs` adds eight injected-transport cases:
64-byte report framing and CRC, zero-write boot attestation, a complete synthetic
B2 write with one COMMIT and reopened status, pre-COMMIT refusals, uncertain
post-COMMIT failure, zero-write completion, completion refusals and a source check
that forbids browser discovery. These are
host fixtures, not hardware evidence. `tests/opensynth-patcher.spec.ts` drops a synthetic file (synthetic
patch served by route, so no Roland bytes are committed) and checks the stages,
SHA256 and download in both themes, the mobile file picker, error and reset.
`tests/synth-release.spec.ts` checks the four-part structure, one animation
per feature row with the expected alt text and caption, whole-pixel tile zoom, final-release copy
(no status badges, testing or build-number wording), the Roland link, the patcher,
sprite loading, axe, no horizontal scroll at 390/1440px in both themes, the
no-JS first frame and the reduced-motion/toggle/offscreen lifecycle. The schema-2
page's only module script measured 1,135 bytes gzip (plus the shared inline
theme script) on 9 October 2026. Run Playwright against the built output with
`OPENSP_TEST_URL` when another dev server already holds port 4321.

See the retained [website review](reports/opensynth-website-review.md) and
[N1 copy audit](reports/opensynth-n1-copy-audit.md) for their historical scopes.
Website model and build checks do not qualify firmware or storage on hardware.
