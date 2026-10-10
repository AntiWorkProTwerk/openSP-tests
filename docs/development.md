# Build and publish OpenSP

OpenSP uses Astro 7.3.5 static output, GitHub Pages and Cloudflare DNS. There is
no application server or database. Svelte is reserved for future walkthroughs
that need substantial state; the homepage does not load a framework runtime.

## Local work

Use the Node version in `.node-version` and the committed npm lockfile.

```powershell
npm ci
npm run dev
```

The development server listens on localhost. `npm run build` creates `dist/`
and checks the complete-page JavaScript budget. `npm run preview` serves that built
output. Only `dist/` is deployed; the research tools, design archives and local
connector credentials are not website assets. `site/` is the historical blank
site and is no longer the deployment source.

## Penpot to production

Keep the signed-in OpenSP editor tab active with its hosted MCP connector.
If the connector reports a missing heartbeat, focus the workspace tab rather
than the separate View-mode tab. The connection instructions are in
[penpot-connection.md](penpot-connection.md).

```powershell
npm run design:pull
npm run design:pull-guide
npm run design:tokens
git diff -- design/penpot/production.json design/penpot/homepage.json design/studies/home-copy.json src/styles/tokens.css
```

The pull reads native SP component mains, their visible linked instances,
library colors and typography. It then reads the approved white desktop
homepage's text, line breaks and guide topics. Hidden archives are excluded.
Review the diff: pulling is an explicit update, not a background sync or a
promise that any Penpot edit is ready to publish. It updates the existing
`home-copy.json` shared by the review prototype and production.

`production.json` is an API snapshot of real Penpot library assets. The token
mapper turns those assets into CSS variables; it is not an exported DTCG token
file. CI uses the committed snapshots and does not connect to Penpot. No private
connection key belongs in git or GitHub Actions secrets for this static build.

| Penpot source | Production component |
| --- | --- |
| Navigation, Wordmark, Primary links, Theme selector | `SiteHeader.astro` |
| Hero copy | Shared homepage JSON and `index.astro` |
| Section header, Release content/card, Guide row | `Section.astro`, `GuideRow.astro`, homepage slots |
| Footer | `SiteFooter.astro` |
| SP component mains and nested parts | `SPPart.astro`, `SPInstrument.astro` |
| Screen content slot and R3 poster | `SPDisplay.astro` and the shared frame player |
| Guide introduction, paragraph, heading, contents and caption mains | Shared guide template and `guide.css` |
| Guide figure mains and Menu title screen | `GuideFigure.astro`, `guide-components.json` and `guide-motion.ts` |
| Journey screen and sequence mains | `JourneyTimeline.astro`, `journey-components.json` and `journey-motion.ts` |
| Demo diagram mains and Desktop/Mobile figure mains | `ChapterDemo.astro`, `demo-components.json`, `src/lib/demos/` and `chapter-demo.ts` |

Page text is semantic HTML with responsive CSS. The instrument is inline SVG
rendered from exported native geometry, with named `data-part` and
`data-component` groups. Its screen is a separate reusable player. No full-page
image or manually redrawn instrument is used. Fonts are self-hosted Arimo and
Cousine, with their licenses retained under `design/studies/fonts/`.

The shape renderer currently supports the exported board/group, rectangle,
ellipse, path and text types, plus native geometric mask groups through SVG
clip paths. The Display uses a circular aperture shared with its browser player;
see [panel geometry](references/sp-panel.md). Before introducing alpha masks, rotated shapes,
gradients or effects in Penpot, extend and visually verify that renderer.
Compare the finished homepage against both Penpot sizes and both themes after
each pull. Native interactions still need semantic browser implementations.

## Content and interaction

The homepage preserves the owner's wording and links the seventeen published
guides. Add new guides under
`src/content/guides/`; their schema defaults to `draft: true`. Published guides
get static routes, shared typography and homepage links. Never populate a
release download with an unverified firmware artifact.

The first published guide is `/guides/first-change/`. Its narrative lives in
`src/content/first-change.json`, consumed by the page and Penpot authoring tools.
`design:pull-guide` reads the actual guide mains and four native layouts into
`guide-components.json` and `first-guide-layouts.json`. It does not replace the
article JSON with arbitrary canvas edits. Update shared copy deliberately, then
check every linked section in Penpot and the browser before publishing.

Guide figures autoplay once when visible and retain play/pause and seek controls.
The menu demonstration highlights
SHIFT and pad 13 on the exported instrument; the title screen is a separate
linked main passed through `SPInstrument`'s `screenPart` prop. Memory and byte
comparisons have bounded, pausable sequences. Reduced motion defaults to
the static result. All content and static figures remain readable without
JavaScript. These illustrations are reconstructions, not device recordings.

Normal links and browser history remain native. Cross-document view transitions
last 120 ms where supported and are disabled for reduced motion. Future guide
links opt into hover/intent prefetching. There is no Astro ClientRouter or
cross-route hydration. Theme selection persists locally and follows system
changes when set to System.

The [display contract](sp-display.md) covers source fidelity, swapping sequences,
pause/seek and reduced motion. The homepage replay uses the preserved R3 trace,
with its original omissions and timing uncertainty. No browser talks to the SP.

## Published guide series

Commit `f50e5e4` published sixteen later chapters and the `/guides/` index,
bringing the series to seventeen guides. The live build record and all 88
tests were verified for that release. The chapter demonstrations described below
extend that release with a separate interactive explanation for each guide.

Later chapters share `src/content/journey/<slug>.json` and the `JourneyGuide`
template. MDX wrappers carry route metadata; validation checks it against the
JSON. Curated evidence and Python example endpoints use that same source.

[The source ledger](journey-sources.md) maps the coverage and evidence limits.
[The authoring contract](journey-authoring.md) defines the schema and exercise
restrictions. `npm run test:journey` checks all sixteen chapters and runs every
in-memory Python example against its exact expected output. Add
`-- --local-sources` to check the retained reports in the adjacent workspaces.

The release includes five native Journey mains, sixty-four article layouts and
four index layouts. Each index contains seventeen linked guide rows. The native
copy, component-link and reading-text bounds checks passed; the
[design review](reports/journey-design-review.md) records the visual sample and
its limits. That release's 7,274-byte JavaScript result used the former
whole-site accounting and is not directly comparable with the per-page figures
defined below.

## Chapter-specific demonstrations

Seventeen native diagram mains use a 480 × 320 canvas under
`OpenSP / Demonstrations`. Thirty-four linked figure mains provide Desktop and
Mobile compositions under `OpenSP / Demo figures`. Their editable posters use
the shared colors and typography; the browser supplies semantic controls and
playback. `node tools/design-demos.mjs export` reads the real diagram mains into
`design/penpot/demo-components.json`.

`src/lib/demos/` contains the deterministic models, controls and explanatory
copy. `ChapterDemo.astro` renders the exported native poster through `SPPart`.
`chapter-demo.ts` paints the same named marks, handles input and loads only the
current chapter's `early`, `systems` or `audio` model group. The poster remains
readable while that import loads or if it fails. Controls appear only after
initialization. No framework runtime or device interface is added.

Most later guides lead with their demonstration. Their original screen sequence
remains in a closed "Read the milestone sequence" disclosure. The R3 replay
stays inline with its original provenance; its new mechanism demonstration
appears later in the article. Models use invented data or explicitly identified
recorded facts and never imply additional hardware success.

`npm run test:demos` checks all models and their exported native posters.
`npm test` runs that check and the chapter exercises before Playwright. The
`--models-only` option is a diagnostic subset, not proof of native delivery.
All 68 article layouts now use linked demo figures. The September 30 local
verification passes type checking, the 20-page build and all 133 tests, including
native component/copy/text-bound checks and 44 demonstration tests. Desktop and
mobile browser views were reviewed in both themes. Maximum initial scripts are
7,257 bytes gzip; the conservative active-page bound is 13,463 bytes and the
whole-site inventory is 27,737 bytes. The owner requested publication after that
verification. See
[the review and verification record](reports/chapter-demonstrations.md).

## Checks and deployment

```powershell
npm run check
npm run build
npm run test:install
npm test
```

Playwright checks eight widths in both themes, the native component structure,
keyboard navigation, disclosures, theme persistence, playback lifecycle,
JavaScript-disabled and failed-media fallbacks. Axe checks desktop/mobile in
both themes. Build checks reject private design references and unexpected source
artifacts and verify asset paths. `tools/check-build.mjs` enforces a 15 KiB gzip
ceiling for each page's initial scripts and its active chapter demonstration.
On October2,2026, the owner approved a separate, measured runtime for the
[firmware emulator](emulator.md), loaded only after Start. Its worker and engine
have a128 KiB gzip JavaScript limit and a2 MiB raw WASM limit. Build information
records both separately; this exception leaves the ordinary page budget intact.
The October2 local21-page build measures7,786 bytes gzip of initial emulator
scripts,35,913 bytes gzip for worker/engine JS, and704,806 raw/237,484 gzip WASM
bytes. Maximum ordinary active-page JS remains13,463 bytes; the whole-site JS
inventory is69,865 bytes. These measurements identify an undeployed working
build; use its exact `build-info.json` hashes when comparing later revisions.

The build record keeps three measurements distinct:

- `initialJavascriptGzipBytes`: inline scripts plus each page's static script
  dependency closure, deduplicated by file.
- `activeJavascriptGzipBytes`: that initial graph plus the largest of the three
  lazy model groups and its static dependencies, again deduplicated. This is a
  conservative bound; the browser selects only one group. The maximum across
  pages is reported as `javascriptGzipBytes` and must stay within 15 KiB.
- `totalJavascriptGzipBytes`: every generated script plus the largest page's
  inline total. This whole-site inventory includes the emulator JS and is
  reported separately from the enforced page budget.

`emulatorRuntime` records the worker dependency graph, engine artifact hashes,
JavaScript gzip bytes and WASM raw/gzip bytes. The vendor provenance must match
all emitted engine and license files. Browser tests verify that the engine is
absent before Start, uses the production worker and never uploads selected
firmware or connects to a physical SP. Native emulator models run through
`npm run test:emulator`; actual firmware integration additionally requires the
adjacent private research inputs. See [the coverage record](emulator.md).

"Initial" names the static dependency graph, not a promise that the dynamic
import waits for reader input or first paint. Check the actual browser requests
as well as the build graph when changing loading behavior.

Historical first-guide builds measured 3,518 bytes gzip of JavaScript and about
10.8 KiB gzip of guide HTML at launch, then 5,415 bytes under the old whole-site
script accounting after the seven-step expansion. That expansion passed 54
tests. These figures and the Lighthouse results below describe those earlier
revisions, not the current demonstrations. They are lab results, not physical
phone measurements or real-user Core Web Vitals.

`public/examples/menu-title-check.py` is an intentional, narrowly allowlisted
download. It is an original, in-memory reading exercise, not imported research
source. Other Python files and private artifacts remain rejected by the build.
See [the source ledger](first-guide-sources.md) for its limits.

Initialize the mobile contents disclosure before parsing the article. Deferring
that collapse to a module caused a measured 0.238 layout shift on cold load.
The parser-time setup preserves expanded links without JavaScript and leaves
the settled layout unchanged. The corrected local mobile Lighthouse run scored
100 in all four categories, with 1.36 s LCP, 0 ms blocking time and CLS 0.00014.
See [the curated lab summary](reports/first-guide-mobile-summary.json). Lighthouse
saved a valid report with no audit warnings, then its Windows temporary-profile
cleanup failed with `EPERM`; the CLI exit code alone does not describe this run.

`.github/workflows/pages.yml` runs install, type checks, build and browser tests
on pull requests and pushes. A successful `main` build uploads only `dist/` and
deploys through GitHub's Pages environment using its short-lived OIDC token.
The deployment job alone has Pages write permission. Dependabot proposes npm
and Actions updates; nothing auto-merges.

The first npm Dependabot job reached GitHub's PR-creation service, which returned
HTTP 500. Its follow-up error-reporting endpoint also failed. GitHub rejected a
retry of that dynamic run. The failed maintenance job
is separate from the successful build/deployment jobs; the next scheduled update
check remains enabled. No dependency PR was merged and production is unaffected.

Deployments require a user request or a clearly authorized release task. Commit
the reviewed source/design snapshot, push `main`, watch the workflow, then check
the live homepage, screen assets, mobile/theme behavior and HTTPS redirects.
`/build-info.json` identifies the deployed commit and artifact/design hashes.
For rollback, revert the release commit through a new reviewed commit and let
the same pipeline redeploy. Never force-reset the shared branch.

Cloudflare remains DNS-only. GitHub's certificate now covers `opensp.fyi` and
`www.opensp.fyi`, with HTTPS enforcement enabled. The stuck initial certificate
was restarted by removing and immediately restoring the same custom-domain
setting, following GitHub's documented procedure; DNS was unchanged.
[Certificate provisioning](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https),
[Astro on GitHub Pages](https://docs.astro.build/en/guides/deploy/github/).

Known build notice: Astro/MDX emits a Rolldown warning for
`use astro:head-inject` on the guide modules. Type checks and the static build
pass. The first guide's emitted HTML includes its scripts, and playback,
contents and no-JavaScript tests verify asset propagation. The warning has not
been suppressed. The older draft still has no public route.
