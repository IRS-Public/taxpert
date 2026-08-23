# Release Status

This document describes what the Taxpert repository contains, how mature each part of it is, and
what is present in the source tree without being finished or reachable. It is written for an
engineer, architect, or technical program manager deciding whether to adopt a component, contribute
to one, or depend on one. It states maturity levels and known gaps. It does not explain how to run
things step by step, and it does not argue the case for the approach.

Two names are close enough to confuse. **Taxpert** with a capital T is the whole repository and
everything in it. The **`taxpert` package** is the npm package in `packages/ui/` that supplies the
workspace UI. Where the distinction matters below, the package is written in code font.

## Related documents

- [Onboarding](./onboarding.md), how to run each piece locally
- [Why Taxpert](./why-taxpert.md), the technical and organizational rationale
- [Architecture](./architecture.md), how the pieces fit together
- [AI integration](./ai-integration.md), the current AI surfaces and their limits
- [Deployment](./deployment.md), static and full-server deployment
- [Root README](../README.md)

---

## 1. The problem

A tax application encodes rules that a legislature and an agency wrote in prose. Eligibility for the
Earned Income Tax Credit depends on filing status, age, residency, investment income, the number and
relationship of qualifying children, and half a dozen phase-out thresholds that change every year.
Withholding depends on a different set of the same kind of rules. Those rules are the product. The
screens are a way of collecting the inputs they need.

The people who own those rules are usually not the people who write the code. Policy analysts,
content designers, tax subject-matter experts, and reviewers all need to see what the application
believes and why. In a conventional web application they cannot, because the rules are spread across
conditional branches, form validation, and view logic. Asking "under what circumstances does this
screen appear" or "which facts feed this dollar amount" means reading source code, and answering it
authoritatively means reading all of it.

Auditability has the same shape. A reviewer needs to confirm that a specific published rule is
implemented, that it is implemented once, and that the implementation matches the text. That is
tractable when the rule is a declarative statement in one file. It is not tractable when the rule is
an emergent property of the order in which three components run.

Taxpert addresses this by separating the rules from the presentation and then building tooling
against the separation. The rules live in a Fact Dictionary evaluated by a dependency graph engine.
The screens live in Flow XML. A scaffold turns both into a static multi-language site. A separate,
optional workspace UI layers over the running site and shows the fact values, the conditions, and
the outcomes as you move through it. A separate visualizer draws the whole flow and dictionary as a
graph. The reasoning behind those choices is in [why-taxpert.md](./why-taxpert.md).

---

## 2. What is in this release

Each component ships from one repository, and only the middle block is in this one.

| Component | What it does | Location | README |
|---|---|---|---|
| Fact Graph | Rules engine. Declarative facts, derived and writable, with `Incomplete` propagation. Scala 3, cross-compiled to the JVM and to JavaScript. | [IRS-Public/fact-graph](https://github.com/IRS-Public/fact-graph) | [README](https://github.com/IRS-Public/fact-graph) |
| Form Builder | The scaffold. Reads Flow XML plus a Fact Dictionary and generates a static multi-language site. Also ships the browser theme and the flow runtime inside its jar. | [IRS-Public/form-builder](https://github.com/IRS-Public/form-builder) | [README](https://github.com/IRS-Public/form-builder) |
| form-builder-template | Cookiecutter that emits a new Form Builder application: flow, facts, locales, brand CSS, `Main.scala`, and five optional feature toggles. | [IRS-Public/form-builder-template](https://github.com/IRS-Public/form-builder-template) | [README](https://github.com/IRS-Public/form-builder-template#readme) |
| `taxpert` | The optional workspace UI package. Raw ES modules and CSS, no build step. Surfaces listed separately below. | `packages/ui/` | [README](../packages/ui/README.md) |
| Fact Explorer | React and Vite single-page application that draws any Form Builder application's flow and fact dictionary as an interactive graph, with the live application embedded beside it. | `packages/fact-explorer/` | [README](../packages/fact-explorer/README.md) |
| api | FastAPI backend running LLM tool-calling loops over LiteLLM: fact-dictionary search, IRS publication retrieval from ChromaDB, and draft scenario generation. | `services/assistant/` | [README](../services/assistant/README.md) |
| Style guides | HTML, CSS, and JavaScript conventions for contributions. | `docs/style-guides/` | [README](./style-guides/README.md) |
| Credit Assistant | A Form Builder application implementing the EITC eligibility flow in eight languages. Serves from `/app/eitc`. | [form-builder-example](https://github.com/IRS-Public/form-builder-example), `credit-assistant/` | [README](https://github.com/IRS-Public/form-builder-example/blob/main/credit-assistant/README.md) |
| Tax Withholding Estimator | A second Form Builder application, in English and Spanish. It exercises every extension point the scaffold offers, including a custom flow node type and two custom input types. | [form-builder-example](https://github.com/IRS-Public/form-builder-example), `tax-withholding-estimator/` | [README](https://github.com/IRS-Public/form-builder-example/blob/main/tax-withholding-estimator/README.md) |

The last two are the example applications. They were carved out of this repository so that nothing
here depends on an application, which is the same position any adopter's app is in.

### The `taxpert` workspace, by surface

Every surface below ships in one npm package and is mounted by an application through four HTML
fragments the scaffold ships empty. Nothing in `form-builder/` names a path inside the package.

| Surface | What it does | Entry module |
|---|---|---|
| Global nav | Top bar with the application taxonomy, the destination switcher, and the buttons that open the modals and the tool dock. | `src/global-nav/js/taxpert-global-nav.js` |
| Audit panel | Element that owns the three modals and the legacy rail. Stays mounted whether or not the rail is shown. | `src/audit-panel/js/taxpert-audit-panel.js` |
| Tool dock | Dockable, draggable, resizable right-side area holding the tool panels. | `src/tool-panels/js/taxpert-tool-dock.js` |
| Inspect (tool) | Shows the facts, flow elements, and text behind whatever is selected on the page. | `src/tool-panels/js/taxpert-inspect.js` |
| Outcome tracker (tool) | Tracks the determinations the host application declares, as they resolve. | `src/tool-panels/js/taxpert-outcome-tracker.js` |
| Watchlist (tool) | Tracks the current value and completeness of arbitrary fact paths. | `src/tool-panels/js/taxpert-watchlist.js` |
| Overrides (tool) | Edits a declared list of fact paths directly. Configured per host and off by default. | `src/tool-panels/js/taxpert-overrides.js` |
| All-screens toolbar | Controls for the Browse All and Path Mode pages the scaffold generates. | `src/audit-panel/js/all-screens-toolbar.js` |
| Display options modal | Visibility, layout, and language controls. A host whose display is not a flow page passes in its own option descriptors. | `src/audit-panel/js/display-modal.js` |
| Scenario modal | Reset, copy, paste, load a saved Fact Graph scenario, and (behind a flag) generate one with an LLM. | `src/audit-panel/js/scenario-modal.js` |
| Workspace settings modal | Application switcher, tool selection, feature flags, endpoint overrides, and a JSON view of the whole override record. | `src/audit-panel/js/workspace-settings-modal.js` |

The three default tools are Inspect, Outcome tracker, and Watchlist, defined in `defaultTools()` in
`packages/ui/src/shared/js/config.js`. Overrides is a fourth tool that a host declares explicitly.
Tax Withholding Estimator is the only application that declares it today.

---

## 3. Maturity levels

### What the levels mean

| Level | API stability | Test coverage | Support expectation |
|---|---|---|---|
| General availability | The public surface is stable. Breaking changes would be deliberate and versioned. | Covered by an automated suite that runs in CI, and exercised by at least one shipping application. | Report bugs against it. Behavior is documented in a README. |
| Beta | The surface is settled in shape but may still change. Feature set is deliberately narrower than the eventual target. | Covered in part. Some paths are only exercised by hand. | Usable for real work. Expect rough edges and read the code before relying on an edge case. |
| Alpha or experimental | No stability promise. Modules, routes, and prompts may be renamed or removed. | Unit tested against mocks. The end-to-end path depends on external services and is not covered. | For evaluation. Off by default. Do not put it in front of a taxpayer. |

Test numbers below are from running the suites in this working tree:

| Suite | Command | Result |
|---|---|---|
| `taxpert` | `cd taxpert && npm test` | 496 tests, 496 pass, 36 test files |
| Fact Explorer | `cd fact-explorer && npm test` | 145 tests, 145 pass, 19 test files |
| api | `cd api && make test` | 60 tests, 60 pass |
| Form Builder browser assets | `cd form-builder && npm test` | 16 tests, 16 pass |

The Scala suites were not run here, because they compile two cross-built projects. Their size is
countable from the tree: 110 spec files under `fact-graph/`, 26 under `tax-withholding-estimator/`,
21 under `credit-assistant/`, and 4 under `form-builder/`.

### Capability table

| Capability | Level | Why |
|---|---|---|
| Fact Graph engine | GA | 110 spec files across the shared, JVM, and Scala.js source sets. Both applications and the browser runtime depend on it for every value they compute. |
| Form Builder scaffold (parser, generators, template engine) | GA | Both applications are configuration over it. All five extension seams are exercised, and Tax Withholding Estimator uses each one at least once (`FormBuilderApp.nodeTypes`, `inputTypes`, a template override, layered locales, the workspace mount fragments). |
| The generated questionnaire (theme, flow runtime, navigation, validation) | GA | Ships inside the `form-builder` jar and is extracted by `FormBuilderAssets.scala`. 15 JavaScript modules and 15 stylesheets, rendered through 36 Thymeleaf templates. Credit Assistant generates eight languages from it, Tax Withholding Estimator two. |
| form-builder-template cookiecutter | GA | Emits a complete application with five documented toggles (`include_all_screens`, `include_scenario_mode`, `include_taxpert_workspace`, `include_fact_explorer`, `include_docker`). Answering `no` to the workspace toggle produces a project with no `taxpert` dependency anywhere, which is the check that the optionality is real. |
| `taxpert` workspace package | GA | 496 passing tests over 36 files. Consumed three ways: vendored by both Scala applications, and bundled by Vite in Fact Explorer. |
| Global nav | GA | Declared by both applications' `taxpert-config.html`, with the same taxonomy shape. Covered by `taxpert-global-nav.test.mjs` and `nav-menu-data.test.mjs`. |
| Tool dock, Inspect, Outcome tracker, Watchlist | GA | The three default tools. Both applications get them without declaring anything. Covered by `taxpert-tool-dock.test.mjs`, `inspect.test.mjs`, `outcome-tracker.test.mjs`, `watchlist.test.mjs`, `tool-layout.test.mjs`, `tools-modal.test.mjs`. |
| Overrides tool | GA | Same registry, same tests (`overrides.test.mjs`). Declared by one application rather than two, so the configuration path has one real consumer. |
| Browse All and Path Mode (all-screens page and toolbar) | GA | Generated by `AllScreens.scala` and dressed by the workspace toolbar. Both applications declare `allScreens: true` in their Fact Explorer descriptor and pass `--allScreens` in `make dev`. Covered by `taxpert-screens-toolbar.test.mjs`. |
| Display options modal | GA | Both applications expose the Display nav button. Fact Explorer reuses the same dialog with its own option descriptors, which is what proves the host-supplied path works. Covered by `display-modal.test.mjs` and `display-options.test.mjs`. |
| Workspace settings modal | GA | Both applications expose the settings gear. Covers the application switcher, tool selection, feature flags, endpoint overrides, and JSON import and export of the whole override record. Covered by `workspace-settings-modal.test.mjs` and `config-overrides.test.mjs`. |
| Scenario mode: loading and running saved scenarios | GA | Build flag `--scenarioMode`. The scaffold copies a `scenarios/` directory into the site and the Scenario modal loads a chosen file into the Fact Graph. Credit Assistant ships 114 scenario JSON files and enables the flag in every dev target. Covered by `scenario-modal.test.mjs`. Note that Tax Withholding Estimator sets `scenarioMode: false` and ships no scenarios, so this feature has one real consumer. |
| Fact Explorer | GA | 145 passing tests over 19 files. Both applications own a `fact-explorer.app.json` descriptor, and the registry is built by globbing them rather than by editing a list. Serves flow, facts, search, annotation, side-by-side embedding, and the shared Display and Workspace settings modals. |
| Author Mode | Beta | Build flag `--authorMode`, plus a loopback-only HTTP backend on port 3004. The header on `AuthoringServer.scala` states the surface is deliberately confined to the MVP: constant `<Dollar>` and `<Rational>` values, a fact `<Description>`, and on-screen `question`, `hint`, and `fg-alert` heading text. No XML is ever re-serialized from a parsed model. Credit Assistant declares `authorMode: true`; Tax Withholding Estimator declares `false`. One dedicated Scala spec exists (`credit-assistant/src/test/scala/gov/irs/creditassistant/authoring/SubtractSubtrahendSwapSpec.scala`). |
| Form Builder Graph generator (`--formBuilderGraph`) | Beta | Emits the JSON Fact Explorer reads. The doc comment on `FormBuilderGraph.scala` records that it agrees exactly with the Node generator on `flowPages`, `flowElements`, and `facts` for Tax Withholding Estimator, and that it does not yet emit `shows` edges, `exits` edges, or the `displays` edges derived from `fg-show` paths (3 versus 81). Off by default for that reason, reached through each application's `make fact-explorer` target. |
| api backend service | Alpha | 60 passing tests, all against mocks. The live path needs Ollama, ChromaDB, and a served fact dictionary. Behavior varies with the model behind `LLM_MODEL`, and there is no evaluation harness for output quality. |
| AI fact explanation (`--aiFactExplanation`, `POST /chat`) | Alpha | Off by default in every build target except `make dev-ai`. The tool-calling loop caps at 10 iterations and the model is free-form over two tools. See section 4: the surface that renders it in the Scala applications is currently unreachable. |
| AI scenario generation (`--aiScenarioGeneration`, `POST /scenario/generate`) | Alpha | Off by default. Produces a draft Fact Graph JSON that the server validates only for writable paths and wrapper shape, leaving the browser as the final validator. The backend never writes to disk, so the result is downloaded and placed in `scenarios/` by hand. This is a different feature from scenario mode above, which loads scenarios that already exist. |
| RAG retrieval and ChromaDB indexing | Alpha | `make index` embeds documents through Ollama and upserts into Chroma. Chunking heuristics are tuned to the IRS Drupal page structure (`_ROLE_DEPTH` in `indexer.py`) and will not generalize. PDF indexing is present but commented out (section 4). There is no retrieval quality metric. |

---

## 4. What is stubbed, incomplete, or dormant

Each item below was verified against the source in this working tree.

**The legacy audit panel rail is present and hidden.** `LEGACY_RAIL_FLAG = 'legacyAuditPanel'` is
defined in `packages/ui/src/audit-panel/js/feature-flags.js`, and
`packages/ui/src/audit-panel/styles/panel-shell.css` hides `.audit-panel` under
`body.audit-mode:not(.ff-legacy-audit-panel)`. Neither application declares the flag. Tax
Withholding Estimator's `taxpert-config.html` records that it was the last holdout and removed it.
The `<taxpert-audit-panel>` element itself stays mounted, because it owns the three modals.

**The AI chat surface in the Scala applications is unreachable as configured.** The Explain and
Analyze section is a rail section. It is declared in `packages/ui/src/audit-panel/js/sections.js` with
`ff: 'ai-fact-explanation'`, its markup is the `tap-explain` template inside
`packages/ui/src/audit-panel/templates/audit-panel.html`, and both live inside `.audit-panel`, which the
rule above hides. `initChat()` still runs from `taxpert-audit-panel.js`. Turning on
`--aiFactExplanation` in a Form Builder application therefore reveals nothing unless
`legacyAuditPanel` is also turned on, and no application offers that switch. Fact Explorer has its
own chat dock (`packages/fact-explorer/src/canvas/ChatPanel.jsx`, gated by `VITE_AI_FACT_EXPLANATION`), which
is the one reachable consumer of `POST /chat` today.

**`fg-section-gate` is parsed, schema'd, templated, and never used.**
`form-builder/src/main/scala/gov/irs/formbuilder/parser/FgSectionGate.scala` defines the node and its
`parse`, `FlowConfig.rng` defines `fg-section-gate-module` and references it in four places, and
`templates/nodes/fg-section-gate.html` renders it. The tag is absent from `FlowNodeTypes.builtIn` in
`FlowParser.scala`, no application registers it through `FormBuilderApp.nodeTypes`, and neither
application's flow XML contains the element. `FgSectionGate.parse` has no caller, so a flow using
the tag would fall through to the generic HTML branch instead.

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

**Source-level markers.** The tree is close to free of them. A repository-wide grep for `TODO`,
`FIXME`, and `NotImplemented` across `services/assistant/src`, `packages/ui/src`, `packages/fact-explorer/src`, and
`form-builder/src/main/scala` returns one genuine work item,
`form-builder/src/main/scala/gov/irs/formbuilder/parser/Input.scala:140`
(`// TODO validate that the options match the num path`). The other matches are the
`# TODO: translate` sentinel machinery in `Locale.scala`, which is a working feature rather than an
unfinished one.

**One configuration inconsistency.** `credit-assistant/src/main/scala/gov/irs/creditassistant/Main.scala`
sets `defaultPort = 3002`, while the application's Makefile uses `PORT ?= 3003` and its
`fact-explorer.app.json` declares `devPort: 3003`. Every documented path passes the port explicitly,
so the stale default only surfaces on a bare `sbt run --serve`. The descriptor file asks that these
be kept in step.

---

## 5. How to run each maturity tier

Full instructions, prerequisites, and troubleshooting are in [onboarding.md](./onboarding.md). One
command per tier:

| Tier | Command | What you get |
|---|---|---|
| GA, everything at once | `make up` (repository root) | Docker stack: both applications, Fact Explorer, the api service, and ChromaDB. |
| GA, one application natively | `cd credit-assistant && make dev` | Credit Assistant on port 3003 with the workspace, Browse All, and scenario mode. Tax Withholding Estimator uses the same target on port 3000. |
| Beta, Author Mode | `cd credit-assistant && make dev-author` | The same, plus the structured editor at `/app/eitc/author/` and its loopback-only backend on port 3004. |
| Alpha, the AI features | `cd api && make dev`, then `cd credit-assistant && make dev-ai` | The api service on port 8000, plus an application build with `--aiScenarioGeneration` and `--aiFactExplanation`. Also needs Ollama on port 11434 and, for retrieval, ChromaDB on port 8001. |

Running an application natively for the first time needs the two Scala libraries published to the
local Ivy cache and the npm tooling installed. See [onboarding.md](./onboarding.md).

---

## 6. Versions and support

| Component | Version | Artifact |
|---|---|---|
| fact-graph | `3.1.0-SNAPSHOT` (Scala 3.3.6) | `gov.irs:factgraph`, local Ivy |
| form-builder | `0.1.0-SNAPSHOT` (Scala 3.7.2) | `gov.irs::form-builder`, local Ivy |
| credit-assistant | `0.1.0-SNAPSHOT` | static site |
| tax-withholding-estimator | `0.1.0-SNAPSHOT` | static site |
| `taxpert` | `0.1.0` | npm package, `"private": true` |
| fact-explorer | `0.0.1` | static SPA, `"private": true` |
| api | `0.1.0` (Python 3.12 or later) | Python service |
| form-builder-template | cookiecutter, pins `form_builder_version` `0.1.0-SNAPSHOT` and `factgraph_version` `3.1.0-SNAPSHOT` | template |

### What the snapshot versions imply

Both Scala libraries are `-SNAPSHOT` and are published with `sbt publishLocal` to
`~/.ivy2/local/`. Neither is on Maven Central or any other public repository. A consumer outside
this repository therefore has to build both from source before an application will resolve, and
there is no way to pin a reproducible build to a published artifact. Snapshot resolution also means
two developers on the same nominal version can be running different code.

None of the npm packages is published to a registry, and all three are marked
`"private": true` so that npm refuses rather than relies on nobody trying. Fact Explorer resolves
`taxpert` through the npm workspace at this repository's root, and a Scala application vendors
`node_modules/taxpert/src` into its own resource tree through `make copy-shared-ui`, from a
`file:` dependency on a checkout. Those vendored directories are generated and gitignored, and
`make check-shared-ui` fails a build if one has drifted.

Nor are there published container images. `packages/ui/compose/taxpert.yml` used to name
`ghcr.io/IRS-Public/taxpert-fact-explorer` and `-assistant`; it now builds both from a checkout
named by `TAXPERT_REPO`. That closes the last route by which any part of this ecosystem could ask a
consumer for a credential — ghcr.io is GitHub Packages, and a pull from a non-public image there
needs a personal access token.

### Licensing is inconsistent

Only two components declare a license:

| Path | License |
|---|---|
| `fact-graph/LICENSE.md` | United States public domain, with a worldwide CC0 1.0 Universal dedication |
| `credit-assistant/LICENSE.md` | Same |

There is no license file at the repository root, and none for `form-builder/`,
`tax-withholding-estimator/`, `taxpert/`, `fact-explorer/`, `api/`, or `form-builder-template/`. Two
`package.json` files (`taxpert` and `form-builder`'s asset tooling) declare `"license": "UNLICENSED"`,
which contradicts the CC0 intent visible in the two license files. Anyone planning to redistribute
or depend on a component should resolve this before doing so. It is a paperwork gap rather than a
technical one, and it is worth closing before any external adoption.
