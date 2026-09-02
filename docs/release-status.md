# Release Status

This document describes what the Taxpert repository contains, how mature each part of it is, and
what is present in the source tree without being finished or reachable. It is written for an
engineer, architect, or technical program manager deciding whether to adopt a component, contribute
to one, or depend on one. It states maturity levels and known gaps. 


## What the levels mean

| Level | API stability | Test coverage | Support expectation |
|---|---|---|---|
| General availability | The public surface is stable. Breaking changes would be deliberate and versioned. | Covered by an automated suite that runs in CI, and exercised by at least one shipping application. | Report bugs against it. Behavior is documented in a README. |
| Beta | The surface is settled in shape but may still change. Feature set is deliberately narrower than the eventual target. | Covered in part. Some paths are only exercised by hand. | Usable for real work. Expect rough edges and read the code before relying on an edge case. |
| Alpha or experimental | No stability promise. Modules, routes, and prompts may be renamed or removed. | Unit tested against mocks. The end-to-end path depends on external services and is not covered. | For evaluation. Off by default. Do not put it in front of a taxpayer. |

## Capability table

| Capability                                    | Level | Why                                                                                                     |
|-----------------------------------------------| --- |---------------------------------------------------------------------------------------------------------|
| `taxpert` workspace package                   | GA | Shared package consumed across both applications and internal tooling.                                  |
| Fact Explorer                                 | GA | Fully integrated tool supporting visual flow navigation, searching, and fact analysis.                  |
| Scenario mode                                 | GA | Fully supported feature for loading and running saved scenario data in live applications.               |
| Browse All and Path Mode                      | GA | Fully supported administration and view features active in both applications.                           |
| Tool dock, Inspect, Outcome tracker, Watchlist | GA | Default user-facing tools included out of the box for all applications.                                 |
| Global nav                                    | GA | Unified navigation structure deployed across both applications.                                         |
| Overrides tool                                | GA | Active tool deployed and supported in production.                                                       |
| Display options modal                         | GA | Shared UI modal proven to support custom configuration across host applications.                        |
| Workspace settings modal                      | GA | Full-featured workspace management (tool selection, feature flags, data import/export).                 |
| Author Mode                                   | Beta | Functional but the full lifecycle has not been extensively tested                                       |
| Form Builder Graph generator                  | Beta | Operational for basic graphing, but missing several visual relationship edges.                          |
| AI API backend service                        | Alpha | Experimental service with a minimal evaluation harness. Behavior varies with the underlying AI model. |
| AI fact explanation                           | Alpha | Experimental service with a minimal evaluation harness. Behavior varies with the underlying AI model. |
| AI scenario generation                        | Alpha | Experimental service with a minimal evaluation harness. Behavior varies with the underlying AI model. |
| RAG retrieval and ChromaDB indexing           | Alpha | Experimental service with a minimal evaluation harness. Behavior varies with the underlying AI model. |
---

## Known Gaps

**The legacy audit panel rail is present and hidden.** `LEGACY_RAIL_FLAG = 'legacyAuditPanel'` is
defined in `packages/ui/src/audit-panel/js/feature-flags.js`, and
`packages/ui/src/audit-panel/styles/panel-shell.css` hides `.audit-panel` under
`body.audit-mode:not(.ff-legacy-audit-panel)`. Neither application declares the flag. 
The `<taxpert-audit-panel>` element itself stays mounted, because it owns the three modals.

**Fact Explorer's annotation export and import have no UI.** `exportObject()` and `mergeImport()` in
`packages/fact-explorer/src/annotate/store.js` are exported and covered by `tests/store.test.js`, and nothing
in `src/` calls either. Annotations therefore live only in the browser's localStorage. The
fact-explorer README lists this under its own "Current gaps" heading.

**PDF indexing is commented out.** In `services/assistant/src/rag/indexer.py`, `extract_pdf_chunks()` and
`_iter_pdfs()` are complete and `pymupdf` is a declared dependency, but the loop over PDFs in
`main()` is commented out, so only HTML is indexed. A `client.delete_collection(...)` line above it
is also commented out.

**`taxpert:reveal-fact` has no listener.** `packages/ui/src/tool-panels/js/taxpert-watchlist.js` defines
and dispatches the event for its "Reveal in canvas" row action, with a comment saying it is stubbed
on purpose because the canvas belongs to Fact Explorer. No listener exists in `packages/ui/src`,
`packages/fact-explorer/src`, or either application's own client JavaScript, so the action is currently
inert.

**Fact Explorer still defaults to the mock fixture.** `loadGraph()` in
`packages/fact-explorer/src/model/load.js` reads `VITE_FGM_SOURCE` and falls back to `'mock'`, and
`fact-explorer/.env.example` sets `mock`. The Docker development overlay sets `real`. Running the
Vite dev server from the checked-in example environment therefore shows the hand-authored fixture
rather than a real application's graph until the variable is changed.
