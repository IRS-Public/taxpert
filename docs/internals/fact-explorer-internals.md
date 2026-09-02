# Internals: Fact Explorer

Fact Explorer is a standalone React and Vite SPA that visualizes any Form Builder app's Flow XML and
Fact Dictionaries as an interactive graph. One shared instance serves every app beside it, and
`/fact-explorer/:appId` selects which.

The package is `packages/fact-explorer/`. It is fully decoupled from the Scala apps: it reads
generated JSON, and optionally runs an app's real engine in the browser.

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm test` | `vitest run` |
| `npm run lint` | ESLint over `.js`, `.jsx`, `.mjs` |
| `npm run build-registry` | Globs each app's `fact-explorer.app.json` into `/data/apps.json` |
| `npm run make-fgm` | Regenerates the static fixture |
| `npm run copy-uswds-assets` | Copies USWDS fonts and images into `public/` (runs on postinstall) |

## The layers

| Directory | Holds |
|---|---|
| `src/model/` | The data model and every pure transform over it. React-free |
| `src/canvas/` | The React Flow canvas, its node types, layout and controls |
| `src/explain/` | The detail panel that explains one selected node |
| `src/annotate/` | Reviewer annotations |
| `src/config/` | Taxpert host registration and feature flags |
| `src/home/` | The landing page |
| `src/hooks/` | Shared React hooks |

**Most of `src/model/` is React-free and fetch-free**, so it runs under plain Node in tests.
`load.js` is the only module that fetches. `engine.js` and `bridge.js` are browser-only by nature.

## The Form Graph Model

FGM is the contract every data source satisfies and every component reads against. `model/fgm.js`
holds the JSDoc typedefs for editor hints plus a runtime `validate()` that fails loudly on a
malformed graph.

A graph is nodes and edges over two layers: the **flow** layer (pages and flow elements) and the
**fact** layer (writable and derived facts), with connector edges between them.

**Every pure transform takes an FGM and returns an FGM whose output still passes `validate()`.**
That invariant is what lets the narrowing stages compose in any combination.

## The narrowing chain

Stages run in this order, each one a pure FGM to sub-FGM step.

| Stage | Module | Narrows by |
|---|---|---|
| Scenario hide | `scenarioFilter.js` | Drops what a taxpayer would not see. Only in hide mode |
| Slice | `slice.js` | One flow page, one fact-dictionary file, or everything |
| Filter | `filter.js` | Whole layers: flow, facts, connectors |
| Facets | `facets.js` | Categories within a layer: flow tag, fact kind, edge kind, knockouts-only |

Two alternative framings replace the slice rather than extending it:

**Drill** (`drill.js`) is the ego-network of one node: itself, its first-hop neighbours, and exactly
the edges touching it, laid out radially. It always drills from the **whole** graph, so neighbours
outside the active slice are pulled in. Nothing is dimmed, and the focal node is tagged `__focal`.

**Cone** (`cone.js`) keeps one output node and its transitive dependency ancestors, laid out as a
layered tree. This is the readable framing for a dense fact file.

A `depends` edge runs source to target as fact to dependency, so the cone walk follows **outgoing**
`depends` from the root toward its inputs. It includes the flow-to-fact edges that let an alert seed
a cone or a writable show its binding question, and excludes `sequential`.

A fact depended on by at least `HUB_FANIN_THRESHOLD` others is a hub: a shared input that
`coneLayout` pins to an inputs rail rather than placing inline.

A slice is the selected partition, called the focus, plus optionally its direct edge neighbours,
tagged `__context` so the canvas dims them.

`sliceKeyForNode()` is the inverse of that partitioning: the key whose focus set holds a given node.
Search's typeahead reads it to jump to a hit — a match on another slice is not drawn, so
highlighting it is not navigation — and `tests/slice.test.js` asserts the round trip over every node
of every generated graph on disk. Keep the two in step: a key that does not actually contain the
node lands the reader on a slice where it still is not there.

Search itself never narrows anything. `matchIds()` highlights, `suggest()` offers the same hits as
typeahead rows, and both run over the whole graph so the counter can say in-view against total.

Turning a layer off in `filter.js` leaves that layer's facet selection untouched, so switching it
back on restores what was chosen.

## Loading

`model/load.js` is the only place the SPA fetches a graph, a shard, a registry or a scenario index.
Every component reads through it, so changing data source is never a component change. The mode comes
from `VITE_FGM_SOURCE`.

This module fetches. `apps.js` and `fgm.js` validate.

### Shards

The graph is cut up on disk into exactly the pieces the slice picker already offers, so the opening
view costs an index and one shard rather than the whole graph. There are three graph entry points,
and which one a caller wants is a question about scope.

| Call | Returns | Size |
|---|---|---|
| `loadShardIndex(app)` | the picker's options and the default selection, no graph at all | around 4 KB |
| `loadSlice(app, key)` | the sub-FGM for one selection, which is all the canvas needs | tens of KB |
| `loadGraph(app)` | the whole thing, for the features that read across it: search totals, the scenario overlay, cone, drill, Full graph | megabytes |

The first two return `null` when an app has no shards, which is the case for the mock fixture and for
an app serving its own graph. The caller then falls back to `loadGraph()`, which is what every caller
did before shards existed.

`model/shard.js` does the cutting and is both React-free and fetch-free, so the generator
(`scripts/make-static-fgm.mjs`) and the vitest suite can both run it under plain Node. `load.js`
fetches, and `shard.js` only cuts.

The invariant that makes a shard safe to substitute for the whole graph, asserted by
`tests/shard.test.js` on every option of every fixture and for both values of `opts.neighbors`:

    sliceGraph(shardFor(key), key, opts)  ===  sliceGraph(wholeGraph, key, opts)

It holds because a shard *is* `sliceGraph(whole, key, {neighbors: true})`, the focus plus its one-hop
ring with `__context` already tagged. Re-slicing that on the same key recomputes the same focus set
from the same `flowPages` and finds the same ring inside it. Nothing downstream needs to know which
it got.

Two consequences are load-bearing rather than incidental:

- Every shard carries the graph's **full** `flowPages` list rather than only the pages it covers. It
  is about 12 KB gzipped and it is what keeps the identity byte-exact, since `sliceGraph` copies
  `flowPages` through untouched and `layout.js` orders the flow spine by that list. Narrowing it
  would put a shard's pages in a different order from the whole graph's on a fact-file slice.
- `neighbors: false` still works offline. The ring is in the file and re-slicing drops it, so the
  toggle stays instant rather than becoming a second fetch.

`public/data/<app>/shards/` is gitignored, unlike the two committed fixture graphs. Shards are a pure
function of the graph beside them and the test rebuilds them in memory, so committing a few megabytes
of derived JSON is not worth it.

The generated graphs are written minified. The pretty-print was 15% of the bytes on the wire in dev
where nothing compressed them, and is about 2% once the `/data` middleware gzips them, so it is now a
disk and parse saving rather than a transfer one.

### Serving `public/data/` in dev

The Fact Explorer people actually open is the Vite dev server rather than the nginx in its image,
because the compose override builds `target: build` and runs `npm run dev`. Vite's dev server does
not compress and has no setting that makes it, so `vite.config.js` adds middleware that serves
`public/data/` compressed.

Caching there is deliberately revalidation rather than a `max-age`. These files are regenerated by
`npm run make-fgm` in the middle of a working session, which is the point of the dev stack, and a
real `max-age` would serve yesterday's graph until someone thought to hard-refresh. A strong ETag
makes a repeat load a 304 with no body.

## App discovery

Apps are discovered rather than registered. Each app owns a `fact-explorer.app.json` at its repo root,
and `scripts/build-registry.mjs` globs them into the registry. There is no list edited by hand
inside Fact Explorer.

`model/apps.js` holds the registry contract and derives every `/app/…` URL from an entry. An app's
descriptor may carry an `engine` block naming the Scala.js bundle and the fact dictionary.

## Running the app's real engine

`model/engine.js` runs an app's own Scala.js fact-graph engine in the browser, so Fact Explorer never
re-derives an app's logic.

It is browser-only. The ESM bundle and the fact dictionary are fetched from the app's origin through
the Vite proxy, which means **that app's dev server must be running** for engine-backed features to
work.

**A Graph built against one app's FactDictionary is meaningless to another**, so every export takes
the opaque `{ fg, dict }` pair as a parameter rather than reading a module-level current app. Keep
it that way.

Each cached engine is several megabytes of Scala.js, so entries are evicted when the app switches.

## The scenario overlay

`model/visibility.js` answers what a taxpayer who loaded a given scenario would and would not see:
which flow elements show, which knockouts are active, which facts their answers touch.

Its two evaluators are injected rather than imported, so the module stays node-testable with a fake
engine. `engine.js` builds the real ones.

The overlay has two modes:

| Mode | Effect |
|---|---|
| Dim | The graph is left intact and `node.data` is decorated with the status |
| Hide | `scenarioFilter()` drops the unseen nodes and any edge left dangling, before the slice chain |

## Layout

`canvas/layout.js` is a deterministic banded layout, a swimlane-style placement replacing an earlier
dagre pass.

| Band | Holds |
|---|---|
| The flow spine | Questions plus the structure framing them, in document order down or across the centre. Container elements become frames whose children stack inside them, indented |
| Writable facts | Each in its own band on one side, aligned with the question that binds it |
| Derived facts | Each on the other side, aligned with the fact or question it derives from |
| Alerts and knockouts | Grouped in one band, each aligned with the step whose answer triggers it, through the `exits` edge |

Bands never overlap, separated by a fixed `BAND_GAP`, and `packBand` enforces a minimum stride so
nodes within a band never overlap either.

Facts and alerts are anchored to the **main-axis** coordinate of the flow element they relate to, so
scanning one row or column shows a question together with the writable it binds, the deriveds it
feeds, and the alert it can trip.

Two orientations share the same core, differing only in the `(main, cross)` to `(x, y)` mapping and
the strides. Vertical runs the flow top to bottom with bands left to right. Horizontal runs the flow
left to right with bands top to bottom.

It is a pure function over the React Flow nodes and edges that `transform.js` builds.

## Fact Explorer as a Taxpert host

taxpert ships no menu, no endpoints and no application content. A host supplies all of it through
`configure()`, and `src/config/taxpertHost.js` is the whole of what Fact Explorer has to say.

It consumes three pieces of the workspace: the global nav, the scenario modal, and the workspace
settings modal.

Before the library was configuration-driven, Fact Explorer got here by impersonation. It rendered a
decoy `<taxpert-audit-panel>` it never imported, purely so a `document.querySelector` in the library
found something carrying the attribute it wanted. The menu it showed was the library's own default,
which was another application's routes with Fact Explorer's entry hardcoded to a localhost URL inside
the library. And two components each repeated the same "if the id is fact-explorer, do not navigate"
interception. All three were symptoms of there being no way for a host to say what it was.

`FACT_EXPLORER_FLAGS` in that file is the **single declaration** of the flags this app understands.
`src/config/featureFlags.js` derives its build-time defaults from it rather than restating the names,
which is what stops the two drifting apart.

Fact Explorer also supplies its own descriptors to the shared Display modal, in
`canvas/controls/DisplayOptions.jsx`. Its rows reveal graph nodes, its Layout arranges the canvas,
and its footer resets the layout. There is no second Display dialog.

## The live bridge

`model/bridge.js` is the shared-state bridge between Fact Explorer and a running Form Builder app in
its side-by-side panel.

The contract is the flow runtime's serialized-graph sessionStorage key plus a `BroadcastChannel`.
The Vite proxy collapses both surfaces onto one origin, so an embedded app iframe shares Fact
Explorer's sessionStorage and channel.

| Direction | How |
|---|---|
| Fact Explorer to app | `publish()` writes the storage key and posts on the channel. The iframe rehydrates through the app's own boot path |
| App to Fact Explorer | The runtime's `saveFactGraph()` posts the serialized graph, and `subscribe()` hands it back as the active scenario |

**The storage key must be namespaced, and the prefix argument is required.** This module once wrote a
bare `factGraph` while the flow runtime read a prefixed one, so the storage half wrote a key nothing
read, and only the channel path worked. With more than one app in Fact Explorer, a bare key would be
shared between them, so one app's serialized graph would rehydrate another's dictionary. There is no
sensible default for the prefix.

**The channel name and the message shape are fixed byte for byte.** `fg-graph-bridge.js` in the flow
runtime declares that a hard compatibility constraint and names this file as the other side.

The module is React-free and feature-detected, so it no-ops where `BroadcastChannel` is absent and
stays node-testable.

`storageKeyFor()` duplicates one line from the flow runtime rather than importing it, for the same
reason `makeCollectionIdPath` is duplicated: Form Builder ships as a Scala jar rather than an npm
package, and a relative path into `vendor/form-builder/` exists only inside a built app. Keep the two
identical.

## Embedding

`canvas/EmbeddedAppPanel.jsx` puts a running app in a same-origin iframe beside the canvas. The app
detects the frame through `taxpert/embedded` and stands its own workspace chrome down, so what shows
in the panel is the product rather than a second workspace.

## Gotchas

| Watch out for | Why |
|---|---|
| Importing React into `src/model/` | Most of it must run under plain Node in tests |
| Fetching outside `load.js` | Changing data source would stop being a one-module change |
| Reusing a `{ fg, dict }` pair across apps | A Graph built against one dictionary is meaningless to another |
| Adding an app to a list inside this package | Apps are discovered from their own `fact-explorer.app.json` |
| Restating a feature flag's name in `featureFlags.js` | It derives from `FACT_EXPLORER_FLAGS`, so the two cannot drift |
| Calling `publish()` without a storage prefix | Two apps would then share one serialized graph |
| Renaming the bridge channel or message shape | The flow runtime's `fg-graph-bridge.js` is the other side |
| Expecting engine features to work with the app's dev server down | The bundle and dictionary are proxied from that origin |
