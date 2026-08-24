# Internals: workspace configuration and the host ports

The workspace is one npm package (`taxpert`) laid over an application it does not import and cannot
name. Everything that varies between hosts arrives through this layer: a merged configuration
object, and four duck-typed ports the host fills in.

The modules are under `packages/ui/src/shared/js/`. Nothing in this directory may contain an
application's name, route, origin or fact path. If you are about to add one, it belongs in the
host's own `configure()` call.

## The modules

| Module | Role |
|---|---|
| `config.js` | The three-layer merge, `configure()`, and the override API |
| `config-schema.js` | The shape gate every stored configuration passes through |
| `graph-adapter.js` | The fact-graph port, nine members |
| `flow-dom.js` | The flow-markup port: selectors, attribute names, three predicates |
| `apps.js` | Which application the workspace is over, and where switching lands |
| `templates.js` | The `<template>` registry every bundle clones its markup from |
| `storage-keys.js` | Namespacing for every key the workspace writes |
| `outcome-kinds.js` | How a determination's rollup fact is spoken |
| `embedded.js` | Standing the chrome down inside someone else's frame |
| `modal-shell.js` | The `<dialog>` chrome the three workspace modals share |
| `favicon.js` | Replacing the application's icon with the workspace mark |
| `dom.js` | `el()` and `svgIcon()`, for genuinely data-derived construction |
| `collection-utils.js` | Splicing a collection item id into an abstract path |

## The three layers

Configuration is merged from three sources. Later wins, per key.

| Layer | Written by | Where it lives |
|---|---|---|
| Defaults | `baseConfig()` and `defaultTools()` in `config.js` | This package |
| Host | the application's `configure()` calls, plus `configureFromUrl()` | `taxpert-config.html`, `taxpert.config.json` |
| Overrides | a person, through Workspace settings | `localStorage`, under `<prefix>:configOverrides` |

`configureFromUrl()` is fetched, so it lands after the host's synchronous `configure()`. A
deployment's JSON file therefore beats the build's values, and a person's overrides still beat both.
A missing file is not an error. A file that is present and fails the schema is refused whole.

Two properties hold and are relied on elsewhere.

`getConfig()` always answers a fully populated object. Every namespace and every key exists, so no
caller writes `config.nav?.menu ?? []`.

The returned object keeps a stable identity for the life of the page. `_apply()` rewrites its
contents in place rather than building a replacement, which is what lets React hosts hold it without
a subscription. The consequence is that **elements must read `getConfig()` at render time**, not
capture values at module scope, because the contents change under them when `configure()` is called
again.

Every change dispatches `CONFIG_CHANGE_EVENT` (`taxpert:config-changed`) on `document`.

### Writes land on the host layer

`configure()` merges into the host layer rather than into the merged object. A person's override
therefore keeps winning even when the host configures again afterwards. Keys the schema does not
know are ignored, which also closes the prototype-pollution path.

Merging is one level deep per namespace. Objects merge key by key. Arrays and functions replace
outright.

## The namespaces

| Namespace | Holds |
|---|---|
| `app` | `id`, `brand`, `storagePrefix` |
| `apps` | `current` plus the `items` the workspace can be pointed at |
| `nav` | `menu`, and the destination ids where the Tools button appears |
| `endpoints` | `apiBase`, `scenariosBase`, `factDictionaryUrl` |
| `featureFlags` | `{ name, kebab, label }` records, one Workspace settings row each |
| `tools` | Workspace tools in canonical dock order |
| `determinations` | Outcome tracker content |
| `graph` | The fact-graph port |
| `flowDom` | The flow-markup port |
| `strings` | Host-overridable copy, read by whichever module shows it |

`tools`, `graph` and `flowDom` default to `null` in `baseConfig()` and are filled by `_seed()`. The
`null` distinguishes "not configured" from "configured empty", which matters for `tools`: a host
that wants no tools sets `[]`, and a host that says nothing gets the three the workspace provides.

## The override API

| Function | Answers |
|---|---|
| `getConfig()` | The merged object |
| `getBuildConfig()` | The same without the person's overrides, so the editor can show what a field reverts to. Shallow-copied |
| `getConfigOverrides()` | The stored overrides, cloned |
| `isOverridden(path)` | Whether `'tools'` or `'app.brand'` is currently overridden. Drives the editor's badges |
| `setConfigOverride(path, value)` | Override one namespace or one key inside one |
| `setConfigOverrides(all)` | Replace the set. Every other writer funnels through here, so validation and persistence happen once |
| `resetConfigOverride(path)` | Drop one, restoring the build's value |
| `resetAllConfigOverrides()` | Drop them all |

Paths are one or two segments, because the configuration is two levels deep. Three segments is an
error rather than a deep write.

Resetting the last key in a namespace deletes the namespace rather than leaving `{}` behind, so
`isOverridden()` answers no once the namespace is empty.

### Two circularity notes

`_overridesKey()` reads the storage prefix off the host layer directly rather than calling
`storageKey()`. Going through `storageKey()` would recurse, because it reads `getConfig()`, which is
the thing being built.

For the same reason `app.storagePrefix` cannot be overridden. It is stripped on read with a warning.
An override that could relocate its own record would be unreachable on the next load.

The override layer is re-read when the key itself moves. That happens once on a normal page: this
module is imported before the host calls `configure()`, so the first read runs under the default
prefix.

## The schema gate

`validateConfig()` checks anything destined for storage, which means a person's overrides and a
deployment's `taxpert.config.json`. A host's own `configure()` call is trusted code and is not
checked.

Validation is shape only. Whether a fact path exists is the graph's business, and this module has no
graph.

It is also all-or-nothing. The answer covers the whole partial and the caller drops the lot. A
half-applied override would leave a workspace nobody could reproduce from either the file or the
build.

The `graph` namespace is code-only. It is functions over the host's engine and cannot survive JSON,
so storing it is refused. `allowCodeOnly` lifts that for validating what a host passed to
`configure()` directly.

## The fact-graph port

`config.graph` is the only surface the workspace touches on a host's graph. A host that can answer
these nine members gets the whole workspace, whatever engine is underneath.

| Member | Answers |
|---|---|
| `paths()` | Every abstract path the dictionary knows |
| `getCollectionIds(root)` | The item ids currently in a collection |
| `get(concretePath)` | `{ complete, hasValue, get }` or `null` |
| `set(concretePath, value)` | Write one fact. Returns whether it took |
| `getDefinition(abstractPath)` | `{ typeNode }` or `null` |
| `toJson()` | The graph serialized, for Copy Fact Graph |
| `load(json)` | Replace the graph. May reload the page |
| `changeEvents` | Document events meaning "a fact may have changed" |

Every reader is defensive by contract. The tools re-read on every change event, which fires on every
keystroke, so a missing graph or an unknown path answers empty rather than throwing.

`load()` is the deliberate exception and does throw. The Load Fact Graph textarea needs the throw in
order to turn it into a validation message before the form submits.

`windowFactGraphAdapter()` is the default, over `window.factGraph` and `window.loadFactGraph`. It
resolves the graph on every call rather than capturing it, because the graph arrives asynchronously
from the Scala.js bundle and the workspace may render first.

Writing takes three steps and only the first belongs to the graph: set the fact, persist, then tell
the page. Persistence is the host's `save` option, because a write that is not persisted vanishes on
the next navigation.

An empty value deletes rather than writes. That mirrors a cleared flow field, where an empty Dollar
is unanswered rather than zero, and the difference decides whether a determination has settled.

`normalizeAdapter()` fills in whatever a partial adapter left out, so a host can supply three methods
and still be safe to call. Missing readers answer empty. A missing `set` returns `false`, so the
tools say the write failed rather than silently dropping a value.

## The flow-markup port

The workspace reads the rendered page as well as the graph. Inspect makes questions hoverable, the
path cursor truncates at the first unanswered question, and "Mark conditional items" chips each
condition.

`defaultFlowDom()` reproduces the `fg-*` markup Form Builder's flow runtime renders, so a host on
that markup supplies nothing and any other host overrides only the keys that differ. It is returned
fresh on each call, so a host mutating its copy cannot corrupt the defaults.

The descriptor is selectors and attribute names plus three predicates.

| Predicate | Default behaviour |
|---|---|
| `isHidden(el)` | `hidden`, a `hidden` class, or no layout box. `offsetParent === null` catches `display:none` from any source, and the `getClientRects()` fallback covers `position:fixed`, whose `offsetParent` is null even when visible |
| `isAnswered(el)` | The host's element wins when it exposes `isAnswered()` or a `value` getter. Reading form controls is the fallback. Overridable because whether an empty string counts is a host judgement |
| `checkCondition(path, operator)` | Returns `true`. Evaluating a real condition needs the graph and the host's operator vocabulary, so the default concedes rather than guessing |

`modalLinkSelector` and `modalTag` are separate keys because "show modals inline" has to pair them
up. An overlay is authored at the foot of its page, and only the link says which question it belongs
to.

`uncuedPaths` is empty by default, so every display unit earns an Inspect cue. The paths that should
not are application facts, so the host names them.

## Applications and destination-preserving switching

Which application the workspace is over is a workspace setting. `configure({ apps: { current, items } })`
populates the Applications section at the top of Workspace settings.

Each item carries its own `destinations: [{ id, label, href }]`, and the rule `switchTarget()`
encodes is that **a switch keeps the destination**. Browse All in one application goes to Browse All
in the next, falling back to the target's first destination when it has no match.

The hosts write the destination URLs. This package cannot know what `browse-all` means as a URL, and
a sibling application on another origin is not derivable from a base path.

`activeDestination()` reads the mounted nav's `active` attribute rather than configuration, because
the page knows where it is and the configuration does not.

The Applications section hides itself below two applications, via `hasAppChoice()`. A host may
intercept `APP_SELECT_EVENT` (`taxpert:app-select`) to switch in-app rather than navigate.

## Templates

Markup lives in each bundle's `templates/*.html` as real `<template id="…">` elements, per ADR-001.
Elements clone a fragment and wire it rather than building DOM node by node.

`getTemplate(id)` resolves in three steps.

1. A `<template>` with that id already on the page. This is what lets a host server-render an
   overriding or translated copy.
2. The fetched registry.
3. A throw naming every bundle loaded so far, which is the error you want when a bundle forgot to
   await its templates.

`loadTemplates(url)` is memoized per URL, so modules can start the fetch at import time and elements
can await it again on connect. A failed load drops the memo, so a later attempt retries rather than
replaying a cached failure.

Because templates are fetched, elements expose a `ready` promise that resolves once their DOM
exists.

`templateUrl()` honours a `templates-base` attribute on the element, for a host serving the bundle's
markup from somewhere other than the bundle's own directory.

## Storage keys

`storageKey(name)` prefixes with `app.storagePrefix`, which defaults to `taxpert`.

Callers pass the bare name (`watchlist`, `toolLayout`, `display`, `auditPanel`, `allScreens`,
`featureFlags`), not a prefixed one.

The keys were global before this existed, which is fine while exactly one Form Builder app is served
per origin. It stops being fine when two are served together under one origin on different route
prefixes: same `localStorage`, one shared watchlist full of the other application's fact paths.

There is one exception. `<prefix>:configOverrides` is prefixed without going through this function,
because `storageKey()` reads the config that key helps build. See `_overridesKey()` in `config.js`.

**There is no migration.** A host that adopts a `storagePrefix` loses its existing watchlist and
panel layout once, on the next load. All of it is dev-tool state that costs seconds to recreate, and
migration code for it would outlive its usefulness by years. Put it in the host's release note.

## Embedded mode

Fact Explorer's side-by-side view puts a running Form Builder app in a same-origin iframe next to the
canvas. The app renders its own workspace, so without intervention you get two nav bars, two Display
buttons and two sets of tools, none of which the outer workspace can drive. The product is what
belongs in that frame, and the chrome is the host's job.

`embedded.js` sets one class on `<html>`, and every rule keyed to it lives in
`shared/styles/embedded.css`. That stylesheet is `@import`ed by `global-nav.css`, the one stylesheet
every workspace host loads.

It is set on the document element rather than `<body>`, because the module is imported from `<head>`
scripts and `<body>` does not exist yet.

Detection is frame-ness rather than a query parameter, because the flow navigates. The taxpayer
answers a question and the frame loads the next screen at a URL the embedder never wrote, so a
parameter would survive exactly one page. `?taxpert-embed=0` and `=1` are still honoured on the page
that carries them, for a host that wants to force either side.

## Outcome kinds

A determination's rollup fact is spoken through a JSON descriptor rather than a function, so it can
be edited in Workspace settings, shipped in a `taxpert.config.json`, or pasted between browsers. A
function is still accepted and passes through untouched, but cannot be stored or edited.

| Kind | Reads |
|---|---|
| `boolean` | `descriptor.true` / `descriptor.false`, strictly on `=== true` |
| `map` | `descriptor.values`, keyed by the stringified raw value |
| `signed` | `positive` / `negative` / `zero`, with `{abs}` replaced |
| `value` | The formatted value as-is |

Every kind falls back to `value`, which is the same fact already run through the tracker's formatter.
A Dollar arrives as `"$1,240"`, an enum as its option name.

`signed` strips the leading minus when substituting `{abs}`, because the templates already name the
direction ("Refund of ...") and the formatted value carries the sign, so it would otherwise be said
twice.

`resolveOutcome()` lives in `shared/` because two surfaces speak a rollup and have to say the same
words.

## Gotchas

| Watch out for | Why |
|---|---|
| Capturing config values at module scope | The merged object is rewritten in place. Read `getConfig()` at render time |
| Adding a namespace to `config.js` only | `config-schema.js` has its own `NAMESPACES` list, and an unlisted key is refused on load |
| Expecting `app.storagePrefix` to be overridable | It is stripped on read, deliberately |
| Assuming `tools: []` and no `tools` key mean the same thing | `null` means unset and yields the three defaults. `[]` means none |
| Writing a fact without a `save` option configured | The write lands in the graph and vanishes on the next navigation |
| A host that supplies `set` but no persistence | `set()` answers `true`, because the graph accepted it |
| `collection-utils.js` drifting from its twin | Form Builder keeps a byte-identical copy in `flow-runtime/js/fg-collection-utils.js`. Neither package can import the other |
