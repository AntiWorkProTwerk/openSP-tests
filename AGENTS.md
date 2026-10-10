# Website design and components

For all OpenSP website work, use the `penpot-design-system` skill and read
[docs/design-language.md](docs/design-language.md) for the shared Penpot file,
assets, and current design status. [docs/website-stack.md](docs/website-stack.md)
records the owner-approved Astro static-output plan. The production stack is
implemented; read [docs/development.md](docs/development.md) before changes or
deployment. Use one responsive template, shared content and semantic
theme tokens. Keep pages static, with small browser components for interaction;
add Svelte islands only when their state needs justify them. No application
server, database or site-wide hydrated app is planned. Follow the performance
budgets and measurement requirements in that document.

For design work in Penpot, also use the globally installed `impeccable` skill
(`impeccable/SKILL.md` in the global skills directory). Apply its typography,
layout and review guidance to the native components, then check matching desktop
and mobile views in both themes. Read the
[Teenage Engineering reference notes](docs/references/teenage-engineering.md)
first. The owner's chosen fonts, monochrome palette and monospaced section labels
take precedence over generic aesthetic defaults in the skill.

- Always use the shared Penpot assets and native reusable components. Build
  layouts with linked instances of named main components, including nested SP
  parts. Do not substitute detached copies, flattened images, or repeated SVG
  imports for components that need shared updates.
- Check Assets before creating anything. If a needed component is missing,
  create and clearly name its main component, then reuse linked instances.
  Keep responsive, theme, and interaction differences in shared variants or
  documented overrides that preserve the underlying component link.
- Make shared changes in the main component and propagate them to every
  affected instance. Verify desktop/mobile views and light/dark themes before
  calling the change complete. Do not patch individual copies to hide drift.
- Map Penpot components and tokens to shared code
  components and assets with a documented source mapping. All website uses
  must consume those shared definitions so one update reaches every use.
  Update and verify both Penpot and code; automatic synchronization is not
  currently configured and must not be assumed.
- Existing unlinked studies are migration work. Convert reused parts to linked
  components before extending those studies or using them in production.
  Preserve historical snapshots and record migration status in the design docs.

## SP display content

Keep the display bezel, screen viewport and screen sequence separate reusable
parts. All sizes and themes consume the same sequence; replace content without
redrawing the instrument. Follow [docs/sp-display.md](docs/sp-display.md).
Use original rendered frames or documented device captures, preserve their
provenance and timing uncertainty, and never label a reconstruction as a capture.
Penpot holds linked poster components; the browser implements playback. Keep a
static first frame, keyboard/touch pause, reduced-motion behavior, and pause
offscreen or hidden playback. Do not connect the public site to the physical SP.

## Production workflow

- `npm run design:pull` reads the live Penpot mains/assets and approved white
  desktop homepage. Review its snapshot and shared-copy diff before building.
  Run `npm run design:tokens` after a pull. Do not hand-edit generated geometry
  or token CSS to hide a mismatch with Penpot.
- For the first guide, `npm run design:pull-guide` snapshots its native mains
  and four layouts. `src/content/first-change.json` is the shared narrative for
  browser rendering and Penpot authoring. Review copy changes against the source
  ledger; never turn CPU checks or an owner report into a device capture claim.
- Later chapters share `src/content/journey/<slug>.json` between their Astro
  template, Penpot authoring and curated evidence. Follow
  [the authoring contract](docs/journey-authoring.md) and
  [source ledger](docs/journey-sources.md). Keep MDX wrappers in agreement with
  that source and run `npm run test:journey`. Exercises must remain original,
  offline and independent of firmware files or a connected SP.
- Chapter demonstrations share deterministic models in `src/lib/demos/`, linked
  native Penpot diagram/figure mains and `ChapterDemo.astro`. Preserve stable
  mark IDs and types, semantic controls, readable static posters and evidence
  limits. Export with `node tools/design-demos.mjs export` and
  `node tools/design-demos.mjs export-figures`, then run
  `npm run test:demos`; a model-only pass does not verify native page delivery.
  Keep browser imports split by model group so a chapter never loads all demos.
- Use the shared Astro components under `src/components/`. `SPPart` renders
  native exported geometry; `SPDisplay` owns playback. Extend the shared shape
  renderer and test new Penpot shape types before using them in production.
- Keep content in the shared homepage JSON and draft-first MDX collection.
  Never publish design-study links as finished guides or invent release claims.
- Run `npm run check`, `npm run build` and `npm test`; inspect mobile/desktop in
  both themes. The 15 KiB gzip script ceiling applies to each complete page:
  inline scripts, static dependency closure and the conservative largest lazy
  model group. Report initial, active-page and whole-site totals separately;
  do not compare the former all-site budget directly with a per-page result.
  Preserve playback/accessibility checks and distinguish lab measurements from
  physical-device/field evidence.
- The owner approved a separate on-demand emulator runtime on October2,2026.
  Keep initial page scripts and chapter demonstrations within15 KiB gzip.
  Measure emulator worker/engine JS and WASM separately, enforce their
  128 KiB gzip JS/2 MiB raw WASM limits, verify provenance and load only on Start.
  Follow [the emulator scope and evidence](docs/emulator.md); an R13 model pass
  does not establish full stock firmware or physical recovery.
- Deployment is GitHub Actions to GitHub Pages, with Cloudflare DNS-only and
  enforced HTTPS. Only `dist/` is public output. Do not move hosting, add an app
  server or expose a design credential as an incidental change.
- Commit/push/deploy only when authorized. After deployment, verify Actions,
  HTTPS, the live page and `/build-info.json`; a successful build alone is not
  proof that the requested revision is live.

## Publication privacy

- Before committing, verify the effective Git author and committer use the
  repository owner's pseudonym and GitHub no-reply email. Do not inherit a
  personal machine identity without checking it.
- Keep DNS-zone exports, credentials, account configuration and personal local
  paths outside git. Public DNS records are discoverable but do not belong in
  the project documentation.
- Review the exact staged files and run a redacted secret scan before pushing.
  Never publish an audit report containing secret values or removed identities.
- After a history rewrite, use the cleaned history. Do not merge or push an old
  clone, tag or backup into the repository.
