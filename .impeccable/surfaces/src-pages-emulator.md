---
version: 1
slug: "src-pages-emulator"
primary_target: "src/pages/emulator.astro"
related_targets:
  - "src/styles/emulator.css"
  - "src/scripts/emulator.ts"
---

# OpenSP firmware emulator

Route: `/emulator/`. Mode: Operate. This extends the existing OpenSP field manual.
The owner approved a larger runtime downloaded on Start, and requested native
Penpot layouts with shared component links. The browser CPU/peripheral work has
its own evidence and incomplete coverage; this brief covers the interface and
its native source.

THESIS: A local firmware file should lead to an inspectable session whose
display, execution status and model limits stay together.

OWN-WORLD: Preserve regular Arimo, Cousine technical labels, the monochrome
semantic colors, thin rules, square controls and the linked SP Instrument.

FIRST VIEWPORT: Shared header; title and short scope; session controls;
the Instrument with a blank OLED beside firmware selection and execution
diagnostics. Mobile stacks those regions. Inputs and virtual USB follow the
same session rather than opening a separate tool.

FORM: Extend the owner-selected field-manual composition. The session is the
working unit. Rules separate its execution, inputs and report exchange.
Repeated sessions share the same template. The main navigation keeps its two
chosen actions; discoverability comes from a small shared Footer utility link.

STATE: The native default has one session, no firmware file, an empty screen and
initial diagnostics. Separate examples label ready, loading, paused and worker
failure. Browser behavior provides keyboard access, focus, status announcements
and local file handling. The page has no physical SP connection.

FINISH: Inspect actual desktop/mobile light/dark native exports, compare the
browser structure, check editable component links and text bounds, and preserve
the evidence limits. See [the source map](../../docs/emulator-design.md).
