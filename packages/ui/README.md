# taxpert

`taxpert` is the npm package holding the **Taxpert Workspace**: the UI harness laid over a running
application so a developer, reviewer or content author can see inside it. It ships the global nav,
the audit panel, the dockable tool panels (Inspect, Outcome tracker, Watchlist, Overrides), the
all-screens toolbar, the Display / Scenario / Workspace-settings dialogs, and the helpers those
share.

The applications it wraps are built by **Form Builder** (`gov.irs::form-builder`, at
[IRS-Public/form-builder](https://github.com/IRS-Public/form-builder)), a Scala library that turns
Flow XML plus a Fact Dictionary into a static questionnaire site. Form Builder ships the page theme
and the flow runtime itself, so an application works with none of this package installed. Taxpert
adds the ability to inspect it.

The package knows nothing about the application underneath it until a host calls `configure()`. It
carries no menu, no determinations, no feature flags, no fact paths and no route prefix of its own.
`tests/no-host-identity.test.mjs` fails the build if an application's identity leaks back in, and
`tests/fixtures/host/` mounts the whole workspace on a fictional non-tax "Pet Planner" to show that
a second host can adopt it.

It ships as raw ESM and CSS with no build step, so it can be consumed with or without a bundler.

| | |
|---|---|
| Package name | `taxpert` |
| Version | 0.1.0 |
| License | `UNLICENSED` in `package.json` |
| Repository | [github.com/IRS-Public/taxpert](https://github.com/IRS-Public/taxpert) |
| Distribution | `"private": true` — never published to a registry. Consumed as a `file:` dependency on a checkout, or through this repository's npm workspace. |
| Files it ships | `src/`, `react/`, `compose/` |

## Where it fits

| Neighbour | Relationship |
|---|---|
| [`../fact-explorer`](../fact-explorer) | Takes this package as a workspace dependency and imports it by name. Vite bundles it. |
| [`../../services/assistant`](../../services/assistant) | The chat and scenario-generation backend the audit panel posts to, at `endpoints.apiBase`. |
| [Form Builder](https://github.com/IRS-Public/form-builder) | The scaffold that builds the applications this wraps. It ships the theme and the flow runtime. |
| [The example applications](https://github.com/IRS-Public/form-builder-examples) | Two Form Builder applications that consume this package with no bundler. They live in their own repository. |

See the repository root [`../../README.md`](../../README.md) for how the three packages fit
together.

## Quickstart

Requires Node 20.19 or newer, which is the floor `jsdom` sets for the test run.

```bash
npm install
npm test          # node --test over tests/, one jsdom spec per module
npm run lint      # eslint
npm run format    # eslint --fix
```

Those three are the only scripts in `package.json`. There is no build step.

Two pages are worth opening. Both need a real HTTP server, because the bundles `fetch()` their
`<template>` markup and browsers refuse `fetch()` on `file://` URLs.

```bash
npx serve .
# http://localhost:3000/demo.html                       the global nav on its own
# http://localhost:3000/tests/fixtures/host/demo.html    the whole workspace on a fictional host
```

Read the fixture host page before adopting this package. Everything it needs is in one
`<script type="module">` at the bottom: a config object and a graph adapter.

## Layout

Each component is a self-contained **bundle directory** under `src/`, with a same-named entry module
and CSS. Within a bundle, files are split into `js/`, `templates/` and `styles/`.

| Directory | Holds |
| --- | --- |
| `src/global-nav/` | `<taxpert-global-nav>` (`taxpert-global-nav.js`): the waffle button, breadcrumb, workspace toggle, navigation taxonomy and the tool-button strip. `nav-menu-data.js` reads the host's taxonomy. |
| `src/audit-panel/` | `<taxpert-audit-panel>` (`taxpert-audit-panel.js`) plus the dialogs it creates and owns: `<taxpert-scenario-modal>` (`scenario-modal.js`), `<taxpert-display-modal>` (`display-modal.js`, state in `display-options.js`), `<taxpert-workspace-settings-modal>` (`workspace-settings-modal.js`). Also `<taxpert-screens-toolbar>` (`all-screens-toolbar.js`), `<audited-fact>` and `<fact-link>` (`audited-fact.js`), the feature-flag machinery, the fact-dictionary reader and the chat client. |
| `src/tool-panels/` | `<taxpert-tool-dock>` (`taxpert-tool-dock.js`), `<taxpert-tool-panel>`, `<taxpert-tools-modal>`, `<taxpert-add-fact-modal>`, the layout store, and the four tool bodies: `<taxpert-inspect>`, `<taxpert-outcome-tracker>`, `<taxpert-watchlist>`, `<taxpert-overrides>`. |
| `src/shared/` | Cross-bundle helpers: `config.js`, `config-schema.js`, `apps.js`, `outcome-kinds.js`, `graph-adapter.js`, `flow-dom.js`, `storage-keys.js`, `templates.js`, `dom.js`, `modal-shell.js`, `collection-utils.js`, `embedded.js`, `favicon.js`, plus `img/favicon.png`, `styles/feature-flags.css` and `styles/embedded.css`. |
| `react/` | Thin React adapters over the custom elements: `GlobalNav`, `ToolDock`, `ToolsModal`, `ScenarioModal`, `DisplayModal`, `WorkspaceSettingsModal`. React interop lives only here. |
| `compose/` | `taxpert.yml`, a Docker Compose overlay that builds and starts Fact Explorer and the assistant, for an application whose own repository does not define them. It builds from a taxpert checkout named by `TAXPERT_REPO` — there are no published images. |
| `tests/` | One `node --test` spec per module, plus `fixtures/host/` and `helpers/template-fetch.mjs`, which answers template fetches off disk under jsdom. |

Never import across bundles by deep path. Every public entry point appears in the `exports` map in
`package.json` and is imported by package name. Relative imports between siblings inside one
bundle's `js/` are fine. Crossing into another bundle goes up through `../../<bundle>/js/…`.

The map has around fifty entries and follows one convention: `taxpert/<thing>` is a module,
`taxpert/<thing>/css` is its stylesheet, and `taxpert/react/<thing>` is its React adapter.
Representative specifiers, all of them real:

| Import specifier | Resolves to |
| --- | --- |
| `taxpert` | `src/global-nav/js/taxpert-global-nav.js` |
| `taxpert/css` | `src/global-nav/styles/global-nav.css` |
| `taxpert/config` | `src/shared/js/config.js` |
| `taxpert/graph-adapter`, `taxpert/flow-dom` | the two runtime contracts, in `src/shared/js/` |
| `taxpert/audit-panel`, `taxpert/audit-panel/css` | the panel element and its stylesheet |
| `taxpert/tool-panels`, `taxpert/tool-panels/css` | the dock element and the tool-panel stylesheet |
| `taxpert/display-modal`, `taxpert/display-options` | the Display dialog and the state behind it |
| `taxpert/screens-toolbar` | `src/audit-panel/js/all-screens-toolbar.js` |
| `taxpert/react`, `taxpert/react/display-modal` | `react/GlobalNav.jsx`, `react/DisplayModal.jsx` |

## Configuration

A host calls `configure(partial)` once and gets the whole workspace. Objects merge one level deep,
key by key. Arrays and functions replace outright, because a half-merged menu is never what anyone
means. `configure()` is idempotent and re-callable, so page-level and fragment-level calls compose.

| Namespace | What it carries | Default |
| --- | --- | --- |
| `app` | `{ id, brand, storagePrefix }`. The prefix namespaces every storage key the workspace writes (`storage-keys.js`). | `{ id: '', brand: 'Taxpert', storagePrefix: 'taxpert' }` |
| `nav` | `{ menu, toolsByDestination }`. The navigation taxonomy, and which destinations show which tool buttons. | empty |
| `apps` | `{ current, items }`, each item `{ id, label, destinations: [{ id, label, href }] }`. Populates the Applications section of Workspace settings. Switching application keeps the destination you are on, so Browse All goes to Browse All. Fewer than two items hides the section. | empty |
| `endpoints` | `{ apiBase, scenariosBase, factDictionaryUrl }`. | `apiBase` is `http://localhost:8000` |
| `featureFlags` | `[{ name, kebab, label }]`. Only declared flags get a row in Workspace settings and a `ff-<kebab>` body class. | empty |
| `tools` | The tool list in canonical dock order, each `{ id, label, description, templateId }`. Overrides also takes `facts: ['/somePath']`. | Inspect, Outcome tracker, Watchlist |
| `determinations` | What the Outcome tracker follows, each with an `outcome` descriptor `{ kind: 'boolean' \| 'map' \| 'signed' \| 'value', … }`. A function is accepted but cannot be stored or edited. | empty |
| `graph` | The fact-graph port, described below. It stays code, and is the one namespace a stored config may not carry. | the `window.factGraph` adapter |
| `flowDom` | The host's flow-markup conventions, described below. | the `fg-*` conventions Form Builder's flow runtime renders |
| `strings` | Host-overridable copy, read by the module that shows each key. | empty |

Configuration arrives in three layers, and the later one wins per key:

```
defaults (this package) -> configure() from the host page, then configureFromUrl() -> user overrides in localStorage
```

`configureFromUrl(url)` applies a deployment's JSON file. A missing file is not an error. A file that
is present and invalid is refused whole rather than half applied. The user layer is what Workspace
settings (the nav's gear) edits: feature flags, which tools the workspace offers, the determinations,
the endpoints, and the whole override record as importable JSON, each field badged and resettable.
`validateConfig()` in `config-schema.js` gates both stored layers. A host's own `configure()` call is
trusted code and is not checked.

Every element re-reads configuration at render time and listens for `taxpert:config-changed`, so a
change at any layer takes effect without a reload. Read configuration late, and never capture
`getConfig()` at module scope.

## The two runtime contracts

Taxpert never imports from Form Builder, and Form Builder names no `vendor/taxpert/` path. The two
meet through duck-typed contracts a host fills in.

**`src/shared/js/graph-adapter.js`** is the fact-graph port: nine members (`paths`,
`getCollectionIds`, `get`, `set`, `getDefinition`, `toJson`, `load`, `changeEvents`).
`windowFactGraphAdapter()` is the default and reads `window.factGraph`, resolving it on every call
because the Scala.js bundle arrives asynchronously. Every reader is defensive by contract: the tools
re-read on each `fg-update`, which fires on every keystroke, so a missing graph or an unknown path
answers empty rather than throwing. `load()` is the one exception and does throw, because the Load
Fact Graph textarea needs the error to become a validation message. `set()` is used only by the
Overrides tool. A host that supplies no writer gets `set()` answering false, and the panel says so
rather than appearing to accept a value it drops.

**`src/shared/js/flow-dom.js`** describes the host's rendered markup as CSS selectors and attribute
names (`unitSelector`, `questionTag`, `displayTag`, `alertTag`, `pathAttr`, `conditionAttr`,
`operatorAttr`, `screenSelector`, and the predicates `isHidden`, `isAnswered`, `checkCondition`). The
defaults reproduce the `fg-set` / `fg-show` / `fg-alert` markup Form Builder's flow runtime renders,
so a host on that markup supplies nothing. A host with different markup overrides only the keys that
differ.

`makeCollectionIdPath()` in `src/shared/js/collection-utils.js` is duplicated on purpose in Form
Builder's `flow-runtime/js/fg-collection-utils.js`. Form Builder ships as a Scala jar rather than an
npm package, and a relative path into `vendor/form-builder/` exists only in a built application, so
neither copy can import the other. Keep the two one-line copies identical. If the function ever grows
past a pure line, revisit the split rather than extending both copies.

## Conventions

**Markup lives in `templates/`.** Each bundle's `templates/*.html` holds real `<template id="…">`
elements. An element awaits its bundle's `loadTemplates()`, clones the fragment, caches child refs
with `querySelector`, and wires listeners. An ESLint rule (`no-restricted-syntax` over
`src/**/js/*.js`) blocks assignment to `innerHTML` and `outerHTML` and calls to `insertAdjacentHTML`.
Three genuinely dynamic generators carry an inline disable naming the reason:
`shared/js/templates.js` (which parses the bundle's own template file), `audit-panel/js/chat.js` (a
markdown renderer) and `audit-panel/js/audited-fact.js` (serialized fact XML with `<fact-link>`s
spliced in). Host-supplied HTML strings go through `DOMParser`, which parses inertly.

**Connecting is asynchronous, because templates are fetched.** Every element exposes a `ready`
promise that resolves once its DOM exists. `enable()` and the `open()` methods await it, so hosts
usually do not have to. A `templates-base` attribute relocates where a bundle fetches its templates
from.

**`getTemplate(id)` checks `document.getElementById(id)` first**, then the fetched bundle registry,
then throws naming the id and every bundle URL loaded so far. A host can therefore override any
template by server-rendering a `<template>` with the same id. That is how a Form Builder application
supplies Thymeleaf-translated copies without this package needing an i18n system, and how a host
fills in a tool body (`ttp-body-inspect`, `ttp-body-outcome-tracker`) wholesale.

**Visual state is a CSS selector on an attribute the JS already sets:** `:checked`, `aria-expanded`,
`aria-checked`, `aria-current`, `hidden`, and `:has()` over them. No parallel `--selected` / `--on` /
`--active` class mirrors the same fact.

**Components are vanilla custom elements in light DOM**, with no shadow root and no build tools, so
they render natively in a Form Builder application and inside React and Vite in Fact Explorer.
Attributes are configuration read on connect. What changes afterwards changes through a property.

**CSS uses token-fallback layers.** Every `--tgn-*`, `--tap-*` and `--ttp-*` token chains through the
host's own USWDS token with a hard fallback, at zero specificity via `:where()`, so a bundle looks
right in a host that supplies those tokens and reasonable in one that does not. See the
[style guides](../../docs/internals/style-guides).

## Consuming it

**With a bundler.** [Fact Explorer](../fact-explorer) resolves this package through the root npm
workspace and imports it by name. Vite bundles the JSX adapters and the CSS.

```jsx
import GlobalNav from 'taxpert/react'
import WorkspaceSettingsModal from 'taxpert/react/workspace-settings-modal'

<GlobalNav app="fact-explorer" active="fact-explorer" onSelect={...} />
<WorkspaceSettingsModal />   {/* mount once; it self-wires to the nav's settings gear */}
```

**Without a bundler.** A Form Builder application has none. It takes this as a dev dependency — a
`file:` path to a checkout, since nothing here is published to a registry — and copies
`node_modules/taxpert/src` into its own static assets with its `make copy-shared-ui` target,
then loads the elements with plain `<script type="module">` tags and imports the CSS from its
`main.css`. Menu leaves render as real `<a href>` links, so the nav works before JS runs. The two
applications that do this live in the
[examples repository](https://github.com/IRS-Public/form-builder-examples).

That vendored mirror (`…/website-static/vendor/taxpert/`) is generated and gitignored. A fresh clone
of an application has none until a build runs, and every build target depends on `copy-shared-ui`.
Never hand-edit it and never commit it. The application's `make check-shared-ui`, part of its
`make ci`, diffs the whole tree against `node_modules/taxpert/src` and fails when it has drifted.

After changing anything here, run `npm test`, then `make copy-shared-ui` in each application you
maintain. Two example applications exist so that a change cannot quietly bake in an assumption about
one of them. Fact Explorer needs nothing, since it resolves this package through the workspace and
Vite rebuilds it.

## Gotchas

**The workspace replaces the application's favicon.** `src/shared/js/favicon.js` installs the
Taxpert mark from `src/shared/img/favicon.png` and removes the `rel="icon"` links the scaffold puts
on every page it generates, so a tab under the workspace is distinguishable from the same
application served plain. The module installs on import and takes no configuration. Applications
mount it from two fragments they own, `fragments/workspace-head.html` and
`fragments/workspace-all-screens.html`, which makes keeping an application's own favicon a one-line
deletion in a file that application already owns. `rel="apple-touch-icon-precomposed"` is left in
place, because it names the home-screen icon for a saved product page. The application's icon links
are removed rather than out-ranked, since a page carrying more than one `rel="icon"` leaves the
choice to the browser, and browsers do not all make it the same way. Fact Explorer takes the same
image from its own `public/favicon.png`, because its `index.html` is its own.

**Embedded mode.** `src/shared/js/embedded.js` sets `class="taxpert-embedded"` on `<html>` when
`self !== top`, and `src/shared/styles/embedded.css` (imported by `global-nav.css`, the one
stylesheet every workspace host loads) stands the nav, tool dock, screens toolbar and audit rail
down. That is what makes Fact Explorer's side-by-side iframe show the product with no second
workspace over it. Detection reads frame-ness rather than a URL parameter, because the flow navigates
to addresses the embedder never wrote. `?taxpert-embed=0|1` forces either side on the page carrying
it.

**The legacy audit-panel rail is present but dormant.** The tool panels replaced it. The rail markup
still exists in `src/audit-panel/templates/audit-panel.html`, and `panel-shell.css` hides it under
`body.audit-mode:not(.ff-legacy-audit-panel)`. The `legacyAuditPanel` flag (`LEGACY_RAIL_FLAG` in
`feature-flags.js`) still reveals it and still stops `applyFlags()` force-closing it, but no
application declares the flag, so nothing offers the checkbox. The gate is kept working rather than
stubbed, so that ticking the flag still does something visible. If the rail is ever deleted, delete
the flag and that CSS rule with it. The `<taxpert-audit-panel>` element stays mounted regardless,
since it still creates and owns the three dialogs.

**The stylesheet entry points load in three different ways.** `global-nav.css` is a plain stylesheet
every workspace host links unconditionally. `audit-panel.css` is loaded through a `<link disabled>`
that `taxpert-audit-panel.js` toggles, and a disabled parent link keeps its `@import`s disabled too,
so the whole panel tree stays inert until the workspace is switched on. `tool-panels.css` is the
tool-panel bundle's own `@import` root and is independent of both. `audit-panel/styles/all-screens-page.css`
is not linked by any of them: an application's own all-screens stylesheet `@import`s it.

**Adding or renaming a file** means updating the `exports` map, any in-bundle relative imports, the
React adapters, and the tests. A new file inside an existing bundle needs no build change, and
neither does a whole new bundle directory: `copy-shared-ui`, `check-shared-ui`, the Dockerfiles and
the compose bind mounts all copy, diff or mount `src/` as a whole.
