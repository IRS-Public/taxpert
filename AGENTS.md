# AGENTS.md: taxpert

Taxpert is the workspace laid over a running
[Form Builder](https://github.com/IRS-Public/form-builder) and [Fact Graph](https://github.com/IRS-Public/fact-graph) application to make it understandable. It
holds a global nav, an audit panel, dockable tool panels that show which facts produced the screen
you are on, a graph view of the whole flow, and an LLM backend that answers questions about the fact
dictionary. No application is built in this repository. Every part of it is optional, and an
application runs the same whether or not you attach any of it.

[docs/README.md](docs/README.md) is the documentation index. Section 10 of
[docs/architecture.md](docs/architecture.md) is the authoritative table of where a change belongs,
and `docs/internals/` holds the reasoning behind each component.

## Where this fits

| Repository | What it is |
|---|---|
| [fact-graph](https://github.com/IRS-Public/fact-graph) | `gov.irs::factgraph`, the rules engine. |
| [form-builder](https://github.com/IRS-Public/form-builder) | `gov.irs::form-builder`, the scaffold. Required for an application to exist. Ships the theme and the flow runtime inside its jar. |
| **taxpert** (here) | The optional workspace UI and its companion services. |
| [form-builder-template](https://github.com/IRS-Public/form-builder-template) | Cookiecutter that generates a new application. |
| [form-builder-examples](https://github.com/IRS-Public/form-builder-examples) | The reference applications: Credit Assistant (EITC), the Tax Withholding Estimator, and Benefits Enrollment. |

Neither package imports the other, in either direction. The workspace reaches the running flow
through runtime contracts only. `shared/js/graph-adapter.js` takes the fact graph off a known
global, and `shared/js/flow-dom.js` reads flow markup by CSS selector. Form Builder's templates name
no `vendor/taxpert/` path, and every workspace mount goes through an application-owned fragment for
which the scaffold ships an empty default. An application generated with
`include_taxpert_workspace=no` has no reference to this package anywhere.

## Layout

| Path | What it is |
|---|---|
| `packages/ui/` | The `taxpert` npm package: global nav, audit panel, tool panels, the all-screens toolbar, and the Scenario, Display and Workspace settings modals. `src/` is raw ES modules and CSS and is the source of truth. `npm run build` adds a bundled `dist/` for hosts with no bundler, described in [docs/internals/bundled-build.md](docs/internals/bundled-build.md). |
| `packages/fact-explorer/` | React and Vite single-page application that draws an application's flow and facts as an interactive graph. |
| `services/assistant/` | FastAPI service (Python 3.12, managed with `uv`) behind the audit panel's chat and the scenario generator. |
| `apps/` | Mount point for the application checkouts the tools read. `TAXPERT_APPS_DIR` moves it for the stack, `FORM_BUILDER_APPS_DIR` for Fact Explorer's scripts run natively. |
| `docs/` | Architecture, deployment, release status, style guides, internals, and `QUICKSTART.md`, the setup document for the whole ecosystem. |
| `docker-compose.yml`, `docker-compose.override.yml`, `Makefile` | The service stack and a thin wrapper over `docker compose`. |

The repository root is a private npm workspace named `taxpert-workspace` covering `packages/*`.
`services/assistant` is Python and sits outside it, with its own `Makefile` and `pyproject.toml`.

## Deciding where a change belongs

Apply one test. If an application with no tooling attached would still need the code, it belongs in
`form-builder`, whose jar ships the theme and the flow runtime. Otherwise it belongs here.

The theme and the flow runtime used to live in this repository, which made the optional package a
hard build dependency of every application. Both moved into the scaffold. Keep that true, and do
not add anything back here that a workspace-less application would need.

`makeCollectionIdPath` in `packages/ui/src/shared/js/collection-utils.js` is duplicated in
form-builder's flow runtime deliberately, because form-builder is a Scala jar rather than an npm
package and cannot be imported from here. Keep the two one-line copies identical.

## Conventions in `packages/ui/`

1. **The package knows no host.** It has no menu, no determinations, no feature flags, and no route
   prefix until a host calls `configure()`. `tests/no-host-identity.test.mjs` fails the build if an
   application's identity leaks in, and `tests/fixtures/host/` mounts the whole workspace on a
   fictional non-tax "Pet Planner" to prove it. Never add an application name, URL segment, or fact
   path to this package.
2. **One bundle per directory, split by asset type.** `src/global-nav/`, `src/audit-panel/`,
   `src/tool-panels/`, and `src/shared/`, each with `js/`, `templates/`, `styles/`, `images/`, and
   `fonts/`. A new top-level bundle needs nothing outside this package, because every consumer
   copies, diffs, and mounts `src/` whole.
3. **No deep-path imports across bundles.** Add every public entry to the `exports` map in
   `package.json` and import through the map (`taxpert`, `taxpert/react`, `taxpert/audit-panel`,
   and so on). Relative sibling imports within one bundle's `js/` are fine.
4. **Markup that does not vary lives in the bundle's `templates/*.html`** as a `<template id="...">`
   element. An element awaits `loadTemplates()`, clones the fragment, caches child references with
   `querySelector`, and wires listeners. Assigning `innerHTML` is an ESLint error, with a documented
   allowlist for genuinely data-derived output such as one node per menu item. `getTemplate(id)`
   checks `document.getElementById(id)` first, so a host can server-render and translate any
   template without touching this package.
5. **Visual state is a CSS selector on an attribute the JavaScript already sets**, such as
   `:checked`, `aria-expanded`, `aria-current`, `hidden`, or `:has()`. Avoid a parallel
   `--selected` or `--active` class that mirrors one of those.
6. **Components are vanilla custom elements with no shadow root and no build step**, so they render
   natively in an application and inside React and Vite in Fact Explorer. React interop lives only
   in `react/`.
7. **CSS uses token-fallback layers.** `--tgn-*` and `--tap-*` chain through the host's real USWDS
   tokens with hard fallbacks, so a bundle looks right in a host that supplies the tokens and
   reasonable in one that does not.
8. **Display options is one dialog with two kinds of contents.** A host whose display is not a flow
   page passes in `visibilityOptions`, `layoutOptions`, and `footerAction` and gets the same dialog
   off the same nav button. Pass options into it rather than building a second one.

Conventions for CSS, browser JavaScript, and Thymeleaf are in
[docs/internals/style-guides/](docs/internals/style-guides/README.md).

## Propagating a change to consumers

- **Fact Explorer** takes `packages/ui` as a `file:` npm dependency and picks up a change on
  rebuild.
- **An application** has no bundler. Its `make copy-shared-ui` mirrors `packages/ui/src/**` into
  `website-static/vendor/taxpert/`. That mirror is generated and gitignored, so it must never be
  committed or hand-edited. The application's `make check-shared-ui`, part of its `make ci`, fails
  if the mirror has drifted. Shared UI also must not be reimplemented inside an application's own
  `website-static/` or `templates/`, which are for application-specific behavior.

Run `npm test` in `packages/ui/` after any change, and keep a spec per module.

## Commands

| Where | Commands |
|---|---|
| root | `npm test`, `npm run lint`, `npm run format` fan out over `packages/*` with `--if-present`. They do not reach `services/assistant`. `make tidy` formats and lints only the sub-projects with uncommitted changes. |
| `packages/ui/` | `npm test` (`node --test` with jsdom), `npm run lint`, `npm run format` |
| `packages/fact-explorer/` | `npm run dev`, `npm test` (`vitest run`), `npm run lint`, `npm run build`, `npm run build-registry` |
| `services/assistant/` | `make install`, `make dev`, `make test`, `make lint`, `make format`, `make index`, `make chroma` |
| the stack | `make up`, `make down`, `make logs`, `make ps`, `make build`, `make rebuild`, each taking `PROFILES` |

`PROFILES` defaults to `--profile explorer --profile ai`. Narrow it with
`make up PROFILES=--profile explorer`. Every port a service binds is listed in
[docs/QUICKSTART.md](docs/QUICKSTART.md#ports). Ollama always runs natively on the host and is never
part of this stack.

## Capabilities are opt-in

Nothing here starts by default. Each capability pairs a Form Builder build flag, which makes the
application emit what the tool reads, with a compose profile that runs the service.

| Capability | Build the application with | Run |
|---|---|---|
| Workspace UI | `--auditMode` | nothing, the application vendors it |
| Fact Explorer | `--formBuilderGraph` | `--profile explorer` |
| Chat and scenario generation | `--aiFactExplanation`, `--aiScenarioGeneration` | `--profile ai` |
| Author Mode | `--authorMode` | nothing, form-builder runs its own server in-process on port 3004 |

## Gotchas

- **The services need an application to point at.** `TAXPERT_APPS_DIR` names the host directory of
  checkouts for the stack, and `FORM_BUILDER_APPS_DIR` does the same for Fact Explorer's scripts run
  natively. Other `.env.example` variables default to Credit Assistant on `localhost:3003/app/eitc`.
- **Ollama stays on the host.** A Linux-container Ollama on macOS runs CPU only and is slow.
  `LLM_MODEL` can name a hosted provider instead, but `nomic-embed-text` still has to be in a local
  Ollama, because the document index is embedded locally either way.
- **`make rebuild` drops the `chroma-data` volume**, which a plain `make down` and `make up`
  preserves. The document index has to be repopulated with `make index` afterwards.
- **An application announces itself to Fact Explorer by owning a `fact-explorer.app.json`** at its
  repository root. `npm run build-registry` globs every descriptor under the apps directory, so
  nothing is added to a list inside this repository.
- **A declared feature flag has to move something.** The `legacyAuditPanel` gate was once removed
  while an application still declared the flag, which left a checkbox that did nothing.
- **The `chromadb/chroma` image is pinned** to match the Python client in
  `services/assistant/uv.lock`. The 1.x server is wire-incompatible with 0.5.x clients.
