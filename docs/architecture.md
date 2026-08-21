# Architecture

This document explains how the pieces of the Taxpert platform fit together: the four layers, what
happens at build time, what happens in the browser, how the optional workspace UI mounts over a
running application, the five points at which an application extends the scaffold, and how a
change should be routed to the directory that owns it. It is written for an engineer or architect
reading the codebase for the first time, and for a reviewer deciding where a change belongs.

Two names are close enough to collide. "Taxpert" or "the Taxpert platform" means the whole
repository. "The `taxpert` package" or "the workspace UI" means the npm package in `packages/ui/`,
which is one optional component inside it.

## Related documents

- [Onboarding](./onboarding.md), for running everything locally.
- [Release status](./release-status.md), for the component inventory and maturity.
- [Why Taxpert](./why-taxpert.md), for the rationale.
- [AI integration](./ai-integration.md), for the LLM surfaces and the `api/` backend.
- [Deployment](./deployment.md), for hosting topologies and CI.
- The root [README](../README.md).

## 1. The layer model

Four layers. Every dependency arrow points down, and nothing points back up.

```
+---------------------------------------------------------------+
| TOOLING (all optional)                                        |
|                                                               |
|  taxpert            fact-explorer          api                |
|  workspace UI       React + Vite SPA       FastAPI + LiteLLM   |
|  raw ESM + CSS      port 5180              port 8000          |
+---------------------------------------------------------------+
      | mounted by an app     | reads app descriptors    ^ HTTP
      v                       v                          | (CORS)
+---------------------------------------------------------------+
| APPLICATIONS                                                  |
|                                                               |
|  credit-assistant (EITC)      tax-withholding-estimator (TWE) |
|  /app/eitc, port 3003         /app/tax-withholding-estimator, |
|                               port 3000                       |
+---------------------------------------------------------------+
      | libraryDependencies "gov.irs" %% "form-builder"
      v
+---------------------------------------------------------------+
| SCAFFOLD:  gov.irs::form-builder  (Scala 3.7.2)               |
|                                                               |
|  parser, generators, Thymeleaf engine, node templates,        |
|  chrome locales, RNG schemas, Author Mode server, and the     |
|  browser assets: theme CSS + flow runtime JS, inside the jar  |
+---------------------------------------------------------------+
      | libraryDependencies "gov.irs" %% "factgraph"
      v
+---------------------------------------------------------------+
| RULES ENGINE:  gov.irs:factgraph:3.1.0-SNAPSHOT               |
|  Scala 3.3.6, cross-compiled JVM + Scala.js (ES module)       |
+---------------------------------------------------------------+
```

The declarations behind those arrows. Paths under `packages/` and `services/` are in this
repository; the application ones are in
[the example applications' repository](https://github.com/IRS-Public/form-builder-example), and hold for any Form
Builder app:

| Layer | File | What it declares |
|---|---|---|
| fact-graph | `fact-graph/build.sbt` | No platform dependency. Third-party only (scalatest, scala-xml, upickle, fs2). |
| form-builder | `form-builder/build.sbt` | `"gov.irs" %% "factgraph" % "3.1.0-SNAPSHOT"`, plus Thymeleaf, jsoup, circe, os-lib, smol. |
| credit-assistant | `credit-assistant/build.sbt` | `"gov.irs" %% "form-builder" % "0.1.0-SNAPSHOT"` and scalatest. Everything else arrives transitively. |
| tax-withholding-estimator | `tax-withholding-estimator/build.sbt` | The same form-builder dependency, plus scala-csv for its own UAT scenario suite. |
| taxpert | `packages/ui/package.json` | No runtime dependencies at all. Only dev dependencies (eslint, jsdom, neostandard). |
| fact-explorer | `packages/fact-explorer/package.json` | `"taxpert": "*"`, resolved to `packages/ui` through the root npm workspace, as a real dependency, alongside React, Vite and `@xyflow/react`. |
| an application | `credit-assistant/package.json`, `tax-withholding-estimator/package.json` | `taxpert` as a **dev** dependency, used only so `make copy-shared-ui` has something to mirror. A published version once taxpert is on npm; a `file:` path or `make link-taxpert` against a checkout until then. |

Three consequences worth holding onto:

- The `taxpert` package imports nothing from form-builder, and form-builder names no path inside
  `vendor/taxpert/`. Section 4 explains the contract that replaces the import.
- An application can drop the workspace entirely. The cookiecutter's `include_taxpert_workspace=no`
  emits an app with no `taxpert` dependency and no reference to the package anywhere.
- The theme and the flow runtime are shared but live in `/form-builder/`, because an app without a
  workspace still needs styling and a working questionnaire. To place any shared front-end code,
  ask whether a workspace-less app needs it. Yes puts it in
  `form-builder/src/main/resources/form-builder/website-static/`, no puts it in `packages/ui/src/`.

## 2. Build-time pipeline

`make dev` in `credit-assistant/` runs `copy-fg`, then `copy-shared-ui`, then
`sbt -Dsmol.port=3003 '~run --serve --auditMode --allScreens --scenarioMode'`. Expanded:

```
  make dev
    |
    |-- 1. make copy-fg
    |      ../fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs
    |        -> website-static/vendor/fact-graph/factgraph-3.1.0.js
    |      (skipped with a warning if the sibling has not been built)
    |
    |-- 2. make copy-shared-ui
    |      node_modules/taxpert/src/**  ->  website-static/vendor/taxpert/
    |      (target emptied first, the mirror is generated and gitignored)
    |
    `-- 3. sbt ~run --serve --auditMode --allScreens --scenarioMode
             |
             |-- resolves gov.irs::form-builder and gov.irs:factgraph
             |   from the local Ivy cache (~/.ivy2/local)
             |
             `-- FormBuilder.run(app, args)
                   |
                   |-- parse flags into a Map[String, Boolean]
                   |-- regenerate(app, flags)
                   |     |-- loadFactDictionary(app)       os.read
                   |     |-- parseFlow(app, dictionary)    os.read
                   |     |-- generateFlowLocaleFile(...)   writes flow_en.yaml
                   |     |-- Website.generate(...)         page x locale
                   |     `-- site.save(out/app/eitc, app)
                   |           |-- write every page's index.html
                   |           |-- copy website-static/ -> resources/
                   |           |-- FormBuilderAssets.extractInto(resources)
                   |           `-- write fact-dictionary.xml (+ manifests)
                   |
                   |-- start the Author Mode API, only under --authorMode
                   `-- start the smol static server, only under --serve
```

Step by step, with the file that proves each one:

1. **sbt resolves the two local artifacts.** Both `gov.irs:factgraph:3.1.0-SNAPSHOT` and
   `gov.irs::form-builder:0.1.0-SNAPSHOT` are published with `sbt publishLocal` into the local Ivy
   cache. Neither is on a public repository, so a first build needs both siblings published.
2. **`FormBuilder.run(app, args)` is the app's entire Scala entry point.** `credit-assistant/src/main/scala/gov/irs/creditassistant/Main.scala`
   is roughly thirty lines: one `FormBuilderApp` value and `@main def main(args: String*) =
   FormBuilder.run(app, args)`. Argument parsing is a regex over `--(\w*)` in `FormBuilder.scala`.
3. **The parser reads Flow XML and the Fact Dictionary from disk.** `FormBuilder.resolvedFlowConfig`
   calls `os.read(app.flowDir / "index.xml")` and splices in every `<module src="..."/>` it names,
   stamping each spliced page with the module it came from. `os.read` rather than
   `Source.fromResource` is deliberate: Author Mode patches XML on disk and calls `regenerate` again
   in process, which makes sbt's `~run` watcher rebuild `target/.../classes` underneath the running
   JVM, leaving the classpath copy stale or transiently missing. Only the library's own templates,
   base locales and browser assets come off the classpath, because nothing edits those at runtime.
4. **Generators emit one HTML file per page per locale.** `generators/Website.scala` loops the
   locale codes, builds a `FormBuilderTemplateEngine` per language, and renders the `page` template
   once per flow page. `WebsitePage.filepath` puts the default locale at the site root and every
   other locale under `/{code}/`. `--allScreens` adds a Browse All page per locale,
   `--authorMode` adds the authoring page, `--singleQuestionPerScreen` splits pages first and emits
   `flow-manifest.json`, and `--formBuilderGraph` emits `form-builder-graph.json`.
5. **`FormBuilderAssets.scala` extracts the library's browser assets out of the jar.** `extractInto`
   walks `/form-builder/website-static` on the classpath and copies it to `resources/vendor/form-builder/`,
   handling both a `file:` URL (running inside `/form-builder/` itself) and a `jar:` URL (an app
   consuming the published artifact). The `vendor/form-builder/` shape is a fixed contract: the flow
   runtime derives its own base path by looking for `/vendor/form-builder/flow-runtime/js/` inside
   `import.meta.url`.
6. **`make copy-shared-ui` mirrors the workspace UI.** It empties
   `website-static/vendor/taxpert/` and copies `node_modules/taxpert/src/.` into it. The directory
   is emptied rather than removed because `docker-compose.override.yml` bind-mounts over it.
   `make check-shared-ui` runs a recursive diff and fails the build if the mirror has drifted, which
   is how a hand-edit of the mirror gets caught.
7. **`make copy-fg` places the Scala.js bundle.** It copies `main.mjs` and its source map out of
   `../fact-graph/js/target/scala-3.3.6/factgraph-fastopt/`. That bundle is committed, unlike the
   taxpert mirror, so the copy is skipped with a message when the sibling has not been built.

The result under `out/`, as credit-assistant produces it:

```
out/app/eitc/
  index.html                      default locale at the root
  filing-status/index.html        one directory per flow route
  agi/  qualifying-children/  results/
  all-screens/index.html          --allScreens only
  es/  ht/  ko/  ru/  vi/  zh-hans/  zh-hant/    one subtree per locale
  resources/                      a copy of the app's website-static/
    fact-dictionary.xml           written by Website.save
    form-builder-graph.json       --formBuilderGraph only
    flow-manifest.json            --singleQuestionPerScreen only
    taxpert.config.json           per-deployment workspace overrides
    js/  styles/  img/  scenarios/
    vendor/
      form-builder/               extracted from the jar
        theme/styles/...
        flow-runtime/js/...
      taxpert/                    the mirrored workspace UI
        global-nav/ audit-panel/ tool-panels/ shared/
      fact-graph/factgraph-3.1.0.js
      uswds-3.13.0/
```

`site.save` deletes the target directory first, so `out/` is always a clean product of the current
inputs.

## 3. Runtime architecture in the browser

```
  index.html  (static, generated)
    |
    |  <meta name="form-builder:storage-prefix" content="credit-assistant">
    |  <meta name="form-builder:base-path"      content="/app/eitc">
    |
    |  <script type="module" src=".../resources/js/fg-components.js">
    |        |
    |        `-- import '../vendor/form-builder/flow-runtime/js/flow-runtime.js'
    |              |
    |              |-- fg-fact-graph.js
    |              |     fetch fact-dictionary.xml
    |              |     fg.FactDictionaryFactory.importFromXml(text)
    |              |     read sessionStorage['<prefix>:factGraph']
    |              |     GraphFactory.fromJSON(...) or .apply(...)
    |              |     window.factGraph = graph
    |              |     document.dispatchEvent('fg-load')
    |              |
    |              |-- fg-set.js / fg-collection.js / fg-display.js
    |              |     upgrade <fg-set>, <fg-collection>, <fg-show>
    |              |
    |              |-- fg-conditions.js      show/hide on every fg-update
    |              |-- continue-handlers.js  Continue button pipeline
    |              |-- fg-validation.js      per-section validation
    |              `-- fg-navigator.js       single-question navigation
    |
    `-- app-owned modules loaded after the runtime:
          fg-knockout-handlers.js, fg-flow-confirmations.js
```

The generated page is static HTML. Nothing renders server-side at request time.

The runtime bootstraps the fact graph by fetching the app's own `fact-dictionary.xml`, importing it
into a `FactDictionary` through the Scala.js engine, and rehydrating a serialized graph out of
`sessionStorage` if one is present. It publishes the live graph as `window.factGraph` and fires
`fg-load` on `document`. Every write path calls `saveFactGraph()`, which serializes back to
`sessionStorage` and fires `fg-update`. Those two events are the entire change notification
protocol.

Configuration reaches the runtime as two `<meta>` tags rendered by
`form-builder/templates/fragments/head.html`:

| Meta name | Value | Read by |
|---|---|---|
| `form-builder:storage-prefix` | `FormBuilderApp.storageKeyPrefix`, defaulting to `appId` | `runtime-config.js` `storageKey()` |
| `form-builder:base-path` | `FormBuilderApp.basePath` | `runtime-config.js`, as a fallback for `runtime-paths.js` |

Those tags are rendered ungated, outside the `--auditMode` block. A questionnaire runs whether or
not it has a workspace over it, and the values used to arrive only through the workspace's own
configuration fragment, which meant a build without `--auditMode` fell back to a shared default
prefix and two apps on one origin rehydrated each other's graph. `<meta>` rather than a configuring
script, because `fg-fact-graph.js` reads stored state with a top-level `await`, so a script would
have to execute before it. Meta tags are parsed before any module runs, so there is no ordering to
get wrong. `runtime-config.js` reads them lazily on first use and never captures them at module
scope.

`runtime-paths.js` derives the rest. It finds `/vendor/form-builder/flow-runtime/js/` inside its own
`import.meta.url` and takes everything before it as the app's `resources/` directory, which is why
two apps mounted at different route prefixes both work with nothing configured.

## 4. The workspace layer and its contract

The `taxpert` package mounts over a running Form Builder app without either side importing the other.

```
   form-builder (the jar)              the application
   ----------------------              ---------------
   fragments/head.html              templates/fragments/
     the workspace slot,              workspace-head.html         filled
     gated on --auditMode             taxpert-config.html         filled
       |                              workspace-enable.html       filled
       |  th:replace                  workspace-all-screens.html  filled
       +--------------------------->  app-head.html   (separate, ungated)
                                            |
   ships an EMPTY default for each          | names paths into
                                            v
                                    resources/vendor/taxpert/
                                      global-nav/js/...
                                      audit-panel/js/...
                                      tool-panels/js/...
                                            |
                                            | reads the running app
                                            v
                              +-----------------------------+
                              | duck-typed runtime contracts|
                              |  graph-adapter.js reads     |
                              |    window.factGraph and     |
                              |    fg-load / fg-update      |
                              |  flow-dom.js reads flow     |
                              |    markup by CSS selector   |
                              +-----------------------------+
```

**Four fragments carry the mount.** `workspace-head` holds the stylesheet link, the preload for the
nav's markup, and the element modules. `taxpert-config` holds the `configure()` call. `workspace-enable`
calls `enable()` at the end of `<body>`. `workspace-all-screens` supplies the Browse All page's
toolbar in two halves, `-head` and `-body`, and is the one seam not gated on `--auditMode`, because
that page only exists under `--allScreens` and is chrome all the way down. The library ships an empty
`<th:block th:fragment="...">` for each.

`app-head` does **not** belong to that list. It is a separate, ungated seam for anything an app
wants in `<head>` (a vendored library, a font, an extra module), and it is replaced unconditionally
at the bottom of `head.html`. TWE fills it, and credit-assistant does not.

**Why there is no import.** Naming `resources/vendor/taxpert/audit-panel/styles/audit-panel.css`
inside the library would hardcode the internal file layout of a package the library neither depends
on nor versions, and would make `include_taxpert_workspace: no` a conditional inside a library
template instead of a file that is simply never emitted. The rule is checkable by reading: grep
`form-builder/src/main/resources/form-builder/templates` for `vendor/taxpert` and every hit is prose in a
comment. The cost is about thirty lines of mount markup per app rather than once in the library, and
both apps plus the cookiecutter carry a copy.

**What replaces the import.** Two duck-typed contracts, both in `packages/ui/src/shared/js/`:

- `graph-adapter.js` defines a nine-method port over the fact graph: `paths`, `getCollectionIds`,
  `get`, `set`, `getDefinition`, `toJson`, `load`, plus `changeEvents`. `windowFactGraphAdapter()`
  is the default implementation, and it resolves `window.factGraph` on every call rather than
  capturing it, because the graph arrives asynchronously from the Scala.js bundle. Every read is
  defensive by contract, because the tools re-read on every `fg-update`, which fires on every
  keystroke. A host with a different graph supplies its own adapter through `configure({ graph })`.
- `flow-dom.js` describes the host's flow markup as data: `questionTag`, `displayTag`, `alertTag`,
  `pathAttr`, `conditionAttr`, `screenSelector` and so on. The defaults reproduce credit-assistant's
  `fg-*` elements exactly, which are also TWE's. A host with different markup overrides only the
  keys that differ.

**`configure()`** is the single place a host says what application the workspace is wrapping: nav
taxonomy, apps and destinations, determinations for the Outcome tracker, endpoints, feature flags,
the graph adapter, `flowDom` overrides. It merges three layers in order: this package's defaults,
the host's `configure()` call, and a person's overrides in `localStorage`. A deployment can add a
fourth as data with `configureFromUrl('/app/eitc/resources/taxpert.config.json')`, which lands after
the build's own values and still loses to a person's overrides. Elements read `getConfig()` at
render time and listen for `taxpert:config-changed`, so late or repeated configuration works. A host
that configures nothing gets a working workspace with no content, which is the deliberate default:
an empty Outcome tracker states honestly that the workspace has been told nothing.

**`makeCollectionIdPath` exists in both packages on purpose.** It is one line,
`abstractPath.replace('*', '#' + id)`, and it lives in both `packages/ui/src/shared/js/collection-utils.js`
and `form-builder/.../flow-runtime/js/fg-collection-utils.js`. Sharing is unavailable in either
direction: form-builder ships as a Scala jar rather than an npm package, so taxpert cannot import from
it, and a relative path into `vendor/form-builder/` exists only in a built app, so it would break
taxpert's `node --test` run and fact-explorer's Vite bundle. The runtime used to import taxpert's
copy, which was the last thing making a required package depend on an optional one. Keep the two
byte-identical, and revisit the split rather than extending both if it ever grows.

## 5. The five extension seams

| # | Seam | Mechanism | Real example |
|---|---|---|---|
| 1 | Templates | Two `ClassLoaderTemplateResolver`s in `FormBuilderTemplateEngine.scala`. `/{appId}/templates/` at order 1, `/form-builder/templates/` at order 2, both with `setCheckExistence(true)` so the first reports "not found" instead of claiming the name. | TWE overrides `nodes/inputs/date.html` and adds `nodes/inputs/single-checkbox.html` plus two `fg-withholding-adjustments-*.html` node templates. It inherits every other node template untouched. |
| 2 | Locales | Three layers resolved app-first in `Locale.get`: the app's `{lang}.yaml` from disk, then the library's `{lang}.yaml` from the classpath (the `components.*` and `workspace.tools.*` chrome), then the generated `flow_{lang}.yaml`. | Both apps carry only their own words. Locale tests must assert against the layered result, which is what each app's `YamlValidatorSpec` does. |
| 3 | Node types | `FormBuilderApp.nodeTypes: Map[String, FlowNodeParser]`, merged over the built-ins so an app can also replace one. Anything still unmatched is treated as ordinary HTML. | TWE registers `"fg-withholding-adjustments" -> FgWithholdingAdjustments`, a roughly fifty-line parser in its own source tree. |
| 4 | Input types | `FormBuilderApp.inputTypes: Map[String, InputParser]`, same merge rules. Registering an existing name replaces the built-in. | TWE registers `"single-checkbox" -> SingleCheckbox`, which the scaffold does not ship, and `"date" -> YearRangeDate`, which replaces the built-in date input. |
| 5 | Workspace mount | The four app-owned fragments of section 4, for which the library ships empty defaults. | Both apps fill all four. The cookiecutter emits them, and `include_taxpert_workspace=no` omits them. |

Everything else about an application is data in its `FormBuilderApp` value: `appId`, `basePath`,
`outSubdir`, `locales`, `defaultPort`, `brand`, `storagePrefix`, `resourceRoot`. Credit-assistant is
the proof that the three names are independent: it lives in `credit-assistant/`, keeps resources
under `credit-assistant/`, and serves from `/app/eitc`. Adding an app's name, URL segment or storage
prefix to a file inside `/form-builder/` is a bug.

## 6. Fact Explorer's data path

Fact Explorer is a standalone React and Vite SPA at `localhost:5180` that visualizes any Form Builder
app's flow and facts. One instance holds every app beside it.

**Apps are discovered rather than registered.** Each app owns a `fact-explorer.app.json` at its repo
root carrying its id, label, `basePath`, `storagePrefix`, `devPort`, tax year, engine bundle and
dictionary paths, capability flags, scenario configuration and any `customFlowTags` it registers.
`npm run build-registry` (`scripts/build-registry.mjs`) globs every sibling directory that carries
one, absolutises the paths, and writes the generated, gitignored `public/data/apps.json`. Adding an
app is putting its repo beside the others. An optional `form-builder-apps.json` beside the apps may set
`defaultAppId` and `order`.

**The graph itself has two source tiers plus a fixture.** A registry entry carries an `fgm` object
with two URLs, and `fetchAppGraph` in `src/model/load.js` tries them in order:

| Tier | URL | Produced by |
|---|---|---|
| `remote` | `{basePath}/resources/form-builder-graph.json`, reached through the dev proxy | The Scala generator, `generators/FormBuilderGraph.scala`, when the app is built with `--formBuilderGraph`. Authoritative, because it comes from the parser that generated the site. |
| `local` | `/data/<app>/form-builder-graph.json` under fact-explorer's own `public/` | The Node generator, `scripts/make-static-fgm.mjs` (`npm run make-fgm`), which parses the same XML with fast-xml-parser. The offline fallback for when the app is not running. |

Separately, `VITE_FGM_SOURCE` selects the loader mode: `mock` (the default) validates the
app-agnostic hand-authored fixture at `public/data/form-builder-graph.mock.json`, `real` validates
whichever tier answered, and `overlay` takes each slice from the real graph when it is non-empty and
falls back to the mock per slice, which is what allows incremental de-mocking with no component
change. Every component reads the graph only through `loadGraph()`.

**Routing is the History API with no router library.** `src/App.jsx` has a twenty-line `routeFor`
that maps `/` to the home view and `/fact-explorer/<id>` to that app, `pushState` on navigation, and
a `popstate` listener. A bare `/fact-explorer` is normalised with `replaceState` to the default app's
URL, because other apps' nav links point at it. The app id is a path segment rather than a query
parameter so there is one router rather than two.

**The scenario overlay and the dev proxy.** `vite.config.js` reads the same committed descriptors
(the generated `apps.json` does not exist in a fresh clone) and builds one proxy entry per app,
keyed on that app's `basePath` and targeting `VITE_APP_ORIGIN_<ID>` if set, else the descriptor's
`devOrigin` or `http://localhost:<devPort>`. The id is upper-cased with hyphens replaced by
underscores, so credit-assistant's override is `VITE_APP_ORIGIN_CREDIT_ASSISTANT`. The proxy
collapses both surfaces onto the 5180 origin, which lets an embedded app iframe share
fact-explorer's `sessionStorage` and `BroadcastChannel`. `src/model/bridge.js` and the runtime's
`fg-graph-bridge.js` are the two halves of that live-sync contract, and the storage key it writes
must carry the app's prefix. Each app has to be running for its own overlay to work.

## 7. The api backend's place

`api/` is a FastAPI service on port 8000 that powers the audit panel's chat. It is optional and off
by default: both AI surfaces sit behind the `--aiScenarioGeneration` and `--aiFactExplanation` build
flags, and the corresponding runtime feature flags in the workspace. The browser reaches it directly
over CORS at the `endpoints.apiBase` a host configures, so it is never part of a static build.

It exposes two POST routes, `/chat` and `/scenario/generate`, plus a `GET /health`. It runs an LLM
tool-calling loop through LiteLLM against Ollama, with keyword search over the fact dictionary and
cosine-similarity retrieval over IRS publications in ChromaDB. See [AI integration](./ai-integration.md)
for the surfaces, prompts, limits and proposed expansion, and [onboarding](./onboarding.md) for how
to run it.

## 8. Embedding

A Form Builder app rendered inside another page's frame shows the product without a second workspace.

`packages/ui/src/shared/js/embedded.js` exports `isEmbedded()` and `applyEmbedded()`. The latter toggles
the class `taxpert-embedded` on `documentElement`, and it is called at import time by the global
nav, which every workspace host loads. `shared/styles/embedded.css` is `@import`ed by
`global-nav.css` and stands the nav, tool dock, screens toolbar and audit rail down under that class.
The class goes on `<html>` rather than `<body>` because the module is imported from `<head>` scripts.

Detection is frame-ness (`view.self !== view.top`, with a `try/catch` returning `true` for a
cross-origin top) rather than a URL parameter, because the flow navigates: answering a question
loads the next screen at an address the embedder never wrote, and a parameter would survive exactly
one page. `?taxpert-embed=1` or `=true` forces embedded mode on and `?taxpert-embed=0` or `=false`
forces it off, on the page that carries the parameter.

This is what makes Fact Explorer's side-by-side view a product view rather than a workspace nested
inside a workspace.

## 9. State and storage

Two independent namespaces. The flow runtime's prefix comes from `<meta name="form-builder:storage-prefix">`,
which renders `FormBuilderApp.storageKeyPrefix` and defaults to `appId`. The workspace's prefix comes
from `configure({ app: { storagePrefix } })` and defaults to the literal `taxpert`. The two never
share a key name, so the prefixes are independent by construction and neither package has to import
the other to stay in step. Both packages call their `storageKey()` at each read and write rather
than capturing it at module scope, because both modules load before configuration lands.

| Key | Storage | Owner | Contents |
|---|---|---|---|
| `<form-builder-prefix>:factGraph` | session | `flow-runtime/js/fg-fact-graph.js` | The serialized fact graph. The one key the runtime writes. |
| `<taxpert-prefix>:auditPanel` | session | `audit-panel/js/storage.js` | Panel open state, width, active tab, tracked facts. |
| `<taxpert-prefix>:display` | session | `audit-panel/js/display-options.js` | Visibility and layout choices from the Display dialog. |
| `<taxpert-prefix>:allScreens` | session | `audit-panel/js/all-screens-toolbar.js` | Browse All section and layout state. |
| `<taxpert-prefix>:watchlist` | session | `tool-panels/js/watchlist-store.js` | Watched fact paths. |
| `<taxpert-prefix>:generatedScenario` | session | `audit-panel/js/fact-graph-io.js` | The last AI-generated scenario. |
| `<taxpert-prefix>:auditPanelChat` | session | `audit-panel/js/chat.js` | Chat history. |
| `<taxpert-prefix>:toolLayout` | local | `tool-panels/js/tool-layout.js` | Which tools are open, and the dock geometry. |
| `<taxpert-prefix>:featureFlags` | local | `audit-panel/js/feature-flags.js` | Runtime overrides of the build-time AI flags. |
| `<taxpert-prefix>:configOverrides` | local | `shared/js/config.js` | Workspace-settings overrides. Built without `storageKey()`, since it feeds the config that function reads. |
| `fact-explorer:v1` | local | `packages/fact-explorer/src/annotate/store.js` | Annotations and canvas layout, keyed by FGM node id. localStorage rather than session because notes are meant to survive reloads and be exported. |

There is no migration when a host adopts a prefix. All of the workspace keys hold dev-tool state
that costs seconds to recreate, and the loss happens once, on the next load.

## 10. Where a change belongs

Two tests, applied in order. The first separates domain content (the flow, the facts, the words, the
brand) from platform capability, and domain content belongs to the application. The second asks
whether a second application would want the same thing, and anything that passes belongs to the
library.

| Kind of change | Directory | Notes |
|---|---|---|
| Flow pages, `<fg-set>`, conditional visibility, knockouts | `credit-assistant/.../flow/` or `tax-withholding-estimator/.../flow/` | Validated by `make validate-xml` against `FlowConfig.rng`. |
| `<Fact>` definitions, derived and writable facts, constants | the app's `.../facts/` | Validated against `FactDictionaryModule.rng`. |
| Locale strings for an app's own words | the app's `.../locales/{lang}.yaml` | Never edit the generated `flow_{lang}.yaml` by hand. |
| Chrome strings every app shares (`components.*`, `workspace.tools.*`) | `form-builder/src/main/resources/form-builder/locales/` | Then `sbt publishLocal` and re-run both apps. |
| A node template or input template every app uses | `form-builder/.../templates/nodes/` | An app-specific variant goes in the app's own `templates/`, where app-first resolution finds it. |
| A new node type or input type for one app | the app's Scala source, registered in its `FormBuilderApp` | Ship its template beside it. |
| Parser or generator behavior | `form-builder/src/main/scala/gov/irs/formbuilder/` | Run `sbt test publishLocal`, then `make ci` in **both** apps. The second app is what catches an app-specific assumption. |
| Theme CSS, flow runtime JS | `form-builder/src/main/resources/form-builder/website-static/` | Shipped in the jar. A `~run` session will not hot-reload these, so republish and restart. |
| Workspace UI: global nav, audit panel, tool panels, screens toolbar | `packages/ui/src/` | Then `npm test` in `packages/ui/`, then `make copy-shared-ui` in each app. Never hand-edit `website-static/vendor/taxpert/`, and never reimplement shared UI inside an app's own `website-static/`. |
| Brand CSS, an app's own custom elements, its Thymeleaf overrides | the app's `website-static/` and `templates/` | App-specific behavior only. |
| Canvas rendering, node shapes, legend, layout | `packages/fact-explorer/src/canvas/` | The FGM schema and `validate()` live in `src/model/fgm.js`. Data source logic lives in `src/model/load.js`. |
| Backend routes and request/response shapes | `services/assistant/src/api/` | Agent loop and prompts in `services/assistant/src/agent/`, fact search and RAG in `services/assistant/src/facts/` and `services/assistant/src/rag/`. |
| A new application | `form-builder-template/`, then a new sibling directory | Its `fact-explorer.app.json` is the whole of its Fact Explorer registration. |
