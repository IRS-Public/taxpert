# Fact Explorer

Fact Explorer is a standalone React 18 + Vite 6 single-page app that renders a Form Builder
application's Flow XML and Fact Dictionaries as one interactive graph. Questions, alerts,
collections, writable facts and derived facts become nodes, and the relationships between them
(which question binds which fact, which fact gates which page, which chain of deriveds produces a
knockout) become edges. It exists so that a UX designer, a subject-matter expert or an engineer can
read a whole tax product on one canvas rather than across a few dozen XML files.

**Form Builder** (`gov.irs::form-builder`, at
[IRS-Public/form-builder](https://github.com/IRS-Public/form-builder)) is the Scala scaffold that
turns Flow XML plus a Fact Dictionary into a working static questionnaire site. Anything built on it
is a _Form Builder application_. **None of them lives here.** Every application is its own
repository. The two this was developed against are the examples,
[`credit-assistant`](https://github.com/IRS-Public/form-builder-examples/tree/main/credit-assistant)
(EITC) and
[`tax-withholding-estimator`](https://github.com/IRS-Public/form-builder-examples/tree/main/tax-withholding-estimator).

One Fact Explorer instance serves every application it can see. Each application declares itself in
a descriptor file at its own repo root, which a build script discovers by scanning the **apps
directory**: `FORM_BUILDER_APPS_DIR`, or `<repo root>/apps` by default, where you clone or symlink
your checkouts (see [`../../apps/README.md`](../../apps/README.md)). Fact Explorer therefore has no
build-time dependency on any application and runs with no Scala toolchain installed.

## Where it fits

| Neighbour                                                                                                                            | Relationship                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| [Form Builder](https://github.com/IRS-Public/form-builder)                                                                           | The scaffold whose Flow XML and Fact Dictionary this visualizes. It can also emit the graph JSON itself, under `--formBuilderGraph`. |
| The applications under [`../../apps/`](../../apps/), for example [the examples](https://github.com/IRS-Public/form-builder-examples) | What is being visualized. Each owns a `fact-explorer.app.json` at its repo root.                                                     |
| [`../ui`](../ui)                                                                                                                     | The `taxpert` workspace UI (global nav, modals). Resolved through the root npm workspace and bundled by Vite.                        |
| [`../../services/assistant`](../../services/assistant)                                                                               | The FastAPI backend behind the optional AI explanation chat, at `http://localhost:8000/chat`.                                        |

See the repository root [`../../README.md`](../../README.md) for the whole picture.

## Requirements

Node 20 or newer (the Docker image builds on `node:20-alpine`). No Java, sbt or Python is needed for
the default setup.

## Quickstart

```bash
npm install              # postinstall vendors USWDS fonts into public/uswds/
npm run build-registry   # discover the apps under ../../apps (or FORM_BUILDER_APPS_DIR)
npm run dev              # opens http://localhost:5180
```

With no application there, `build-registry` fails naming the directory it scanned, and `npm run dev`
warns and serves the mock fixture with an empty proxy table.

The canvas loads the hand-authored mock fixture by default, so it renders with no Scala build and no
backend. To see a real application's graph, generate it and switch the source:

```bash
npm run make-fgm                          # parse every discovered application's XML
cp .env.example .env.local                # then set VITE_FGM_SOURCE=real
npm run dev
```

The `Makefile` wraps the same scripts (`make dev`, `make check`, `make make-fgm APP=twe`) if you
prefer that entry point.

## Routes

The application id is a path segment, and the History API drives view state. There is no router
library.

| Path                       | Shows                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                        | The landing page: the Taxpert global nav over a hero. Choosing which application the workspace is over happens in the nav's Workspace settings, so there are no application cards here. |
| `/fact-explorer`           | Normalized with `replaceState` to the default application's URL.                                                                                                                        |
| `/fact-explorer/:appId`    | The graph canvas for that application.                                                                                                                                                  |
| `/fact-explorer/<unknown>` | An error page naming the ids this instance knows. A typo'd bookmark deliberately does not fall back to a different application.                                                         |

The default application is the first discovered one, unless an optional `form-builder-apps.json`
beside the apps names a `defaultAppId`. Routing lives in [`src/App.jsx`](src/App.jsx).

## App discovery

Each Form Builder application owns a `fact-explorer.app.json` at its repo root.
[`scripts/build-registry.mjs`](scripts/build-registry.mjs) scans the apps directory one level deep
for `<dir>/fact-explorer.app.json`, resolves every path to an absolute URL, and writes
`public/data/apps.json`, which the SPA fetches at boot. Dropping a repo into the apps directory is
the whole of the wiring, and there is no list in this project to append to.

**Symlinks count.** The scan accepts a `Dirent` that reports either `isDirectory()` or
`isSymbolicLink()`, so `ln -s ~/code/my-app apps/my-app` works as well as a clone.
`vite.config.js` repeats the same test for its proxy table.

`appsDir()` in `scripts/build-registry.mjs` is the single definition of where the applications are.
`vite.config.js` and `scripts/make-static-fgm.mjs` both import it, so the dev proxy, the generator
and the registry cannot disagree.

### Adding an application

1. Add `fact-explorer.app.json` to the application's repo root. `cookiecutter form-builder-template`
   emits one already. Otherwise copy the one in
   [an example application](https://github.com/IRS-Public/form-builder-examples/blob/main/credit-assistant/fact-explorer.app.json).
2. Clone or symlink the repo into `../../apps/`, or point `FORM_BUILDER_APPS_DIR` at wherever it is.
3. Run `npm run build-registry`, then restart `npm run dev`. The Vite proxy table is read once, at
   config evaluation.
4. If you deploy with Docker, mount the application at `/apps/<name>`. The image bakes an empty
   registry and its entrypoint rescans that mount at start, so nothing about the image is tied to a
   particular application. `TAXPERT_APPS_DIR` is the compose-level spelling of the same thing.

### Descriptor fields

| Field                                | Meaning                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                 | The `:appId` URL segment and the registry key.                                                                                                                                  |
| `label`                              | Display name in the nav and on the homepage.                                                                                                                                    |
| `appId`                              | `FormBuilderApp.appId`, the resources directory name.                                                                                                                           |
| `basePath`                           | `FormBuilderApp.basePath`, for example `/app/eitc`. Also the Vite proxy key.                                                                                                    |
| `storagePrefix`                      | Namespaces the sessionStorage key the live bridge shares with the application.                                                                                                  |
| `devPort` / `devOrigin`              | Where that application's dev server runs. Overridable per application with `VITE_APP_ORIGIN_<ID>`.                                                                              |
| `resourceRoot`, `taxYear`            | Where the XML lives, and which tax year it is.                                                                                                                                  |
| `engine.bundle`, `engine.dictionary` | Paths, relative to `basePath`, to the Scala.js fact-graph bundle and `fact-dictionary.xml`.                                                                                     |
| `capabilities`                       | `allScreens`, `scenarioMode`, `authorMode`. The nav prunes destinations an application was not built with, so a missing capability means one fewer menu entry instead of a 404. |
| `scenarios`                          | `{ dir, vocabulary }`, or `null` for an application with no scenarios.                                                                                                          |
| `customFlowTags`                     | Flow node types the application registers beyond the built-in set. Must mirror `FormBuilderApp.nodeTypes`.                                                                      |
| `pagePrefixes`                       | Route prefix to short id, used by the node generator when it mints node ids.                                                                                                    |

## The data model: FGM

Everything the UI draws is one **Form Graph Model** object, defined by JSDoc typedefs plus a runtime
`validate()` in [`src/model/fgm.js`](src/model/fgm.js). It has four independent slices:

| Slice          | Contents                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `flowPages`    | One entry per flow page: route, title, source file, the ids of its elements.                                                  |
| `flowElements` | Questions, alerts, collections, gates and conditional blocks, each with its tag, parent, order, bound fact path and metadata. |
| `facts`        | One entry per `<Fact>`: path, `writable` or `derived`, type node, source file, dependency paths, raw XML.                     |
| `edges`        | Typed relationships between any two of the above.                                                                             |

`EDGE_KINDS` is `sequential`, `exits`, `gates`, `binds`, `shows`, `knocks-out`, `displays`,
`depends`. `FLOW_TAGS`, the built-in flow tags, is `fg-set`, `fg-alert`, `fg-collection`,
`fg-detail`, `fg-section-gate`, `conditional-block`.

`validate()` throws on the first problem it finds: a missing slice, a duplicate node id, an unknown
edge kind, a dangling edge endpoint, a fact whose `kind` is neither `writable` nor `derived`, or a
flow element carrying a tag nobody declared. An application with its own node types declares them in
the graph's `flowTags` array, sourced from `customFlowTags` in its descriptor. `allowedFlowTags()`
unions the two. The allow-list stays closed on purpose, so a typo'd tag fails validation loudly.

The registry has a matching contract and a matching `validateRegistry()` in
[`src/model/apps.js`](src/model/apps.js). Both modules are React-free and fetch-free so they run
under plain Node in tests.

## Where the graph comes from

[`src/model/load.js`](src/model/load.js) is the only place the app fetches a graph. Every component
reads through `loadGraph()`, so changing data source is never a component change. The mode comes from
`VITE_FGM_SOURCE` (copy `.env.example` to `.env.local`).

| `VITE_FGM_SOURCE` | Reads                                                                                                                                 | Needs the application built or running? |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `mock` (default)  | `public/data/form-builder-graph.mock.json`, a hand-authored application-agnostic fixture exercising every node category and edge kind | No                                      |
| `real`            | The selected application's graph                                                                                                      | Yes                                     |
| `overlay`         | Real slices over mock ones, falling back per slice                                                                                    | Partly                                  |

In `real` and `overlay` mode there are two candidate sources, tried in order:

1. **remote**, `{basePath}/resources/form-builder-graph.json`, served by the running application and
   reached through the dev proxy. This is authoritative because the Scala generator that writes it
   is the same parser that builds the site. Produce it with `make fact-explorer` in the
   application's repo, which runs `sbt 'run --formBuilderGraph'`.
2. **local**, `public/data/<app>/form-builder-graph.json`, written by
   [`scripts/make-static-fgm.mjs`](scripts/make-static-fgm.mjs) (`npm run make-fgm`). This Node
   generator parses the same XML with `fast-xml-parser` and is the offline fallback for when the
   application is not running.

If neither resolves, the loader logs a warning and falls back to the mock fixture rather than failing
the boot.

`overlay` mode merges slice by slice: any slice the real graph provides replaces the mock one, and
real edges win over mock edges sharing an id. That lets the Scala generator ship facts first, then
flow, with no UI changes.

## The rendering pipeline

The full graph for a real application runs to hundreds of nodes and roughly a thousand edges, which
is unreadable as a single blob. The canvas narrows it through a chain of pure FGM-to-sub-FGM stages,
each of which returns something that still passes `validate()`:

| Stage            | Module                                                   | What it does                                                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Scenario hide | [`model/scenarioFilter.js`](src/model/scenarioFilter.js) | Drop what the loaded scenario's taxpayer would never see. Only runs in hide mode. The default dims those nodes and leaves the graph intact.                                                                                 |
| 2. Slice         | [`model/slice.js`](src/model/slice.js)                   | Scope to one flow page, one fact-dictionary file, or the whole graph, with an optional one-hop context ring.                                                                                                                |
| 3. Layer filter  | [`model/filter.js`](src/model/filter.js)                 | Turn the flow layer, the fact layer and cross-layer edges on or off.                                                                                                                                                        |
| 4. Facets        | [`model/facets.js`](src/model/facets.js)                 | Narrow within a layer by flow tag, fact kind and edge kind, plus a knockouts-only view.                                                                                                                                     |
| 5. Transform     | [`canvas/transform.js`](src/canvas/transform.js)         | Convert to React Flow nodes and edges, folding search and dimming state onto `node.data`.                                                                                                                                   |
| 6. Layout        | [`canvas/layout.js`](src/canvas/layout.js)               | Deterministic banded placement: a flow spine down the middle, writable facts in one band, deriveds in another, alerts and knockouts in a third, each aligned with the step it relates to. Works vertically or horizontally. |

Two alternative framings replace steps 1 to 4 entirely and always work from the whole graph.
[`model/drill.js`](src/model/drill.js) keeps one node and its immediate neighbours, and
[`model/cone.js`](src/model/cone.js) keeps the transitive dependency ancestors of a chosen output.
The cone is what makes a dense fact-dictionary file readable, since a file of a few hundred derived
facts has no flow spine for the banded layout to hang off.

Search ([`model/search.js`](src/model/search.js)) never narrows the graph. It returns a set of
matching node ids, which the canvas turns into per-node highlight and dim flags.

It also offers the matches as a typeahead: `suggest()` ranks and caps the same hits, the search box
renders them as a `<datalist>`, and choosing one **jumps** to that node — selects it, switches to
the slice it lives on (`sliceKeyForNode()`), and centres it once that slice is drawn. Highlighting
alone is not navigation on a sliced app, where most of what search finds is on some other slice.
The detail panel's dependency links take the same path.

Visual vocabulary (colors, shapes, edge styles) lives once in
[`canvas/style.js`](src/canvas/style.js), which both `FgmNode.jsx` and `Legend.jsx` read so the
legend cannot drift from the canvas.

## Working against a live application

Several features run the application's real engine rather than reimplementing its logic, and they all
need that application's dev server running (`make dev` in its repo).

- **Vite proxy.** [`vite.config.js`](vite.config.js) builds one proxy entry per discovered
  application, keyed on its `basePath`. That puts the application's assets on the 5180 origin, so
  there is no CORS and the two surfaces share `sessionStorage`.
- **Engine.** [`model/engine.js`](src/model/engine.js) fetches the application's Scala.js fact-graph
  ESM bundle and its fact dictionary through that proxy and evaluates conditions with the same engine
  the questionnaire uses. Only one engine is kept in memory at a time, since each is around 15 MB.
- **Scenario overlay.** [`model/visibility.js`](src/model/visibility.js) computes what a taxpayer who
  loaded a given scenario would and would not see, then dims or hides accordingly.
- **Live bridge.** [`model/bridge.js`](src/model/bridge.js) reads and writes the flow runtime's
  serialized-graph sessionStorage key (namespaced by `storagePrefix`) and posts on a
  `BroadcastChannel`, so state moves both ways.
- **Embedded application panel.** [`canvas/EmbeddedAppPanel.jsx`](src/canvas/EmbeddedAppPanel.jsx)
  docks the application itself in a same-origin iframe beside the graph. Taxpert stands its own
  chrome down inside a frame, so the panel shows the product with no second workspace over it.

## Taxpert workspace integration

The global nav, the Scenario modal, the Display modal and the Workspace settings modal all come from
the [`taxpert`](../ui) package. Fact Explorer is a _host_: taxpert ships no menu or endpoints of its
own, and [`src/config/taxpertHost.js`](src/config/taxpertHost.js) is where this app declares what it
is. It calls `configure()` with the menu for the currently represented application (built from that
application's `capabilities`), the list of switchable applications, and its feature-flag descriptors.

Fact Explorer's own nav entry carries no `href`. It emits a select event that `App.jsx` intercepts and
turns into a route change, because one SPA covers every application.

### Reusing the Display modal

There is one Display dialog across the whole workspace. A host whose display is a canvas rather than
a flow page supplies its own contents to that same dialog.
[`src/canvas/controls/DisplayOptions.jsx`](src/canvas/controls/DisplayOptions.jsx) renders
`taxpert/react/display-modal` with three descriptors:

| Descriptor          | Fact Explorer's contents                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `visibilityOptions` | An array of `{ id, label, checked, onChange }` rows: "Reveal items skipped in scenarios" and "Show product experience side-by-side". |
| `layoutOptions`     | `{ options, value, onChange }` for the vertical or horizontal canvas orientation.                                                    |
| `footerAction`      | `{ label, onSelect }` for "Reset layout".                                                                                            |

State stays in `FactExplorer.jsx`. The descriptors carry the current value and the callback and are
reassigned on each change, which keeps the dialog in step with a canvas the user may also be driving
from the banner.

## Layout

```
public/data/form-builder-graph.mock.json    hand-authored fixture, application-agnostic, committed
public/data/apps.json                       generated registry (gitignored)
public/data/<app>/form-builder-graph.json   generated per-application graph (gitignored)
public/data/{credit-assistant,twe}/         the two exceptions: committed real-app corpora (see below)
public/uswds/                               vendored USWDS fonts and images (gitignored)
scripts/
  build-registry.mjs        discover <apps dir>/*/fact-explorer.app.json -> public/data/apps.json
  make-static-fgm.mjs       parse an application's Flow + Fact XML -> per-application FGM JSON
  copy-uswds-assets.mjs     vendor USWDS static assets (runs on postinstall)
src/
  App.jsx  main.jsx         routing and boot
  model/                    FGM contract, registry, loader, and the pure graph stages
  canvas/                   React Flow host, node and frame renderers, layout, legend, controls/
  explain/                  the slide-out detail panel: fact derivation, flow metadata, raw XML
  annotate/                 per-node notes and manual layout, persisted to localStorage
  home/                     the landing page
  config/                   taxpert host registration and feature flags
  hooks/  util/             resizable panels, feature-flag hook, HTML and Markdown helpers
  styles/                   plain CSS plus uswds.scss
tests/                      vitest suites, one per model or util module
```

## Scripts, testing and building

Every npm script in `package.json`:

| Command                                   | Does                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | `vite`, on port 5180 with `open` and `host: true`.                                                                                                                                                                                                                                                               |
| `npm run build` / `npm run preview`       | Production Vite build to `dist/`, and a local preview of it.                                                                                                                                                                                                                                                     |
| `npm run build-registry`                  | `node scripts/build-registry.mjs`. Scans the apps directory and writes `public/data/apps.json`. `--root <dir>` scans elsewhere, `--empty` writes a registry with no applications, `--out <file>` redirects the output.                                                                                           |
| `npm run make-fgm` / `npm run make-mock`  | Both run `node scripts/make-static-fgm.mjs`, which parses every discovered application's Flow and Fact XML with `fast-xml-parser` into `public/data/<app>/form-builder-graph.json` and rewrites the registry alongside it. `-- --app <id>` limits it to one. The two script names are aliases for the same file. |
| `npm run copy-uswds-assets`               | `node scripts/copy-uswds-assets.mjs`. Copies `@uswds/uswds`'s `dist/fonts` and `dist/img` into `public/uswds/`, which the compiled Sass references by absolute path.                                                                                                                                             |
| `npm run postinstall`                     | Runs `copy-uswds-assets` after every `npm install`.                                                                                                                                                                                                                                                              |
| `npm test`                                | `vitest run` over `tests/`. Mostly pure model modules under Node, with jsdom where DOM rendering is under test. Currently 149 tests in 20 files.                                                                                                                                                                 |
| `npm run lint` / `npm run lint:fix`       | ESLint over `.js`, `.jsx`, `.mjs`.                                                                                                                                                                                                                                                                               |
| `npm run format` / `npm run format:check` | Prettier.                                                                                                                                                                                                                                                                                                        |

`make check` runs `lint-fix`, `format`, `format-check` and `test` in one go.

Docker is available for a deployed static build. [`Dockerfile`](Dockerfile) builds with the repo root
as its context, because `taxpert` resolves to `packages/ui` through the root npm workspace, bakes an
empty registry, and serves `dist/` from nginx with a client-side-route fallback. The root
[`docker-compose.yml`](../../docker-compose.yml) brings it up on port 5180 under `--profile explorer`,
with your apps directory mounted read-only at `/apps`.

## Gotchas

- **`public/data/` is generated and gitignored, with two deliberate exceptions.** A fresh clone has
  no `apps.json`, and the first thing the SPA does is fetch it, so without `npm run build-registry`
  you get "Cannot load the app registry". The exceptions are `public/data/credit-assistant/` and
  `public/data/twe/`: generated graphs kept under version control as **test fixtures**, because the
  applications left this repository and nothing here can regenerate a real one. `tests/_fixtures.js`
  feeds them to the generator, cone, search, visibility and scenario-filter suites, and those suites
  skip themselves when the fixtures are absent. Refresh them by pointing `FORM_BUILDER_APPS_DIR` at a
  checkout of those applications and running `npm run make-fgm`. Never hand-edit them.
- **Restart the dev server after adding an application.** `vite.config.js` reads the descriptors once
  when the config is evaluated, so a new proxy entry does not appear in a running server.
- **The Vite proxy reads the committed descriptors directly.** It deliberately ignores the generated
  `apps.json`, because the config is evaluated before any build step could have written that file.
- **A new application needs no Dockerfile change.** The image bakes an empty registry and its
  entrypoint rescans whatever is mounted at `/apps` on start, so discovery works the same in the
  image as in the dev server. An unmounted image says "no apps" instead of showing a stale list.
- **Custom flow tags must be declared.** A node type registered in an application's
  `FormBuilderApp.nodeTypes` but missing from `customFlowTags` is dropped by the node generator, and
  would fail `validate()` if it reached the graph.
- **Live features need the application running.** The engine, the scenario overlay and the embedded
  panel all fetch through the proxy. With the application down they degrade rather than crash, but
  they show nothing useful.
- **`taxpert` resolves through the npm workspace, so `node_modules/taxpert` is a symlink** to
  `packages/ui`, whose real path is outside this project root. `server.fs.allow` in `vite.config.js`
  has to name the package directory, because taxpert's bundles fetch their own `templates/*.html` at
  runtime and Vite's default allow-list rejects paths outside the project root.
- **AI features are off by default.** `VITE_AI_FACT_EXPLANATION` and `VITE_AI_SCENARIO_GENERATION`
  gate the chat dock and scenario generation. They share their names and localStorage keys with the
  Form Builder build flags, so a flag name here must match its name there exactly.

## Known limitations

- The Scala `--formBuilderGraph` generator is not yet at parity with the Node generator. It emits
  `binds`, `gates`, `knocks-out`, `displays`, `sequential` and `depends` edges, and omits `shows` and
  `exits`. Because `load.js` prefers the application-served graph wherever it finds one, building an
  application with that flag by default would hand Fact Explorer the sparser graph. That is why
  `make fact-explorer` is a separate target in each application rather than part of `make dev`.
- The mock fixture is still the default data source.
- The annotation store exposes `exportObject()` and `mergeImport()`, but no UI calls them, so notes
  live only in the browser's localStorage.
