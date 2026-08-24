# Internals: the audit panel bundle

`packages/ui/src/audit-panel/` holds the workspace's page-level mount and the three dialogs the
global nav opens, plus the sub-nav that sits under the nav on the Experience Explorer's
destinations.

The bundle's name is historical. Its centre of gravity moved from the right-hand rail to the
dialogs, and the rail is now hidden by default.

| Module | Role |
|---|---|
| `taxpert-audit-panel.js` | The page-level mount. Clones the panel shell and creates the three dialogs |
| `sections.js` | Descriptors for the built-in rail sections |
| `scenario-modal.js` | "Manage scenario": reset, copy, paste, AI generation, the scenario library |
| `display-modal.js` | "Display options" |
| `display-options.js` | The state behind that dialog, and the host-page effects |
| `workspace-settings-modal.js` | "Workspace settings": flags, tools, outcomes, applications, endpoints |
| `outcomes-editor.js` | The Outcomes section of that modal |
| `feature-flags.js` | Runtime feature-flag overrides |
| `all-screens-toolbar.js` | `<taxpert-screens-toolbar>`, the sub-nav |
| `path-cursor.js` | Path Mode's point-of-progress truncation |
| `fact-graph-io.js` | Copy, load and reset the graph. Scenario loading and AI generation |
| `audited-fact.js` | The Fact Inspector's `<fact-link>` and `<audited-fact>` elements |
| `chat.js` | The Explain and Analyze chat |
| `storage.js` | sessionStorage for the panel's own state |

## The mount

`<taxpert-audit-panel>` clones the panel shell from `templates/audit-panel.html` and creates the
three page-level dialogs. Templates are fetched, so `ready` resolves once the DOM exists and
`enable()` awaits it.

The rail is hidden unless a host declares the `legacyAuditPanel` flag. The dialogs are not, so a
host mounts the panel to get them whether or not it wants a rail.

Attributes: `api-base`, `scenarios-base`, `fact-dictionary-url`, `<flag-kebab>-default`,
`templates-base`.

The element reads the host's scenario `<option>`s in `connectedCallback` before `_connect()`
replaces the light DOM, and synchronously, so nothing can mutate them while the templates are in
flight.

### The three dialogs self-wire

Each of `<taxpert-scenario-modal>`, `<taxpert-display-modal>` and
`<taxpert-workspace-settings-modal>` listens on the document for the nav's `nav-tool-select` event
and opens on its own `detail.id`. A host only has to have the elements on the page.

`<taxpert-audit-panel>` creates and owns all three, so mounting the panel is enough.

All three share the `<dialog>` chrome in `shared/templates/shared.html`, through
`shared/js/modal-shell.js`. Building one means cloning the shell and the modal's own body.

## The rail, and what left it

`sections.js` carries a descriptor per built-in section:

```
{ sectionId, dataTab, label, title, order, templateId?, wrapperClass?, ff?, eager?,
  render?(el, ctx), buildBody?(el) }
```

`render` and `buildBody` are escape hatches for host-registered sections whose body genuinely is
data-derived. credit-assistant's eligibility dashboard is the one that uses them, registered at
runtime through `registerSection()`.

Four tabs have left the rail. Their `order` values are left as gaps so the remaining sections keep
their positions.

| Was | Order | Went to | Because |
|---|---|---|---|
| Flow Inspector | 10 | Display options, as "Mark conditional items" | Its one control is a view preference |
| Graph Inspector | 30 | Manage scenario | Putting a graph on the page is a setup task |
| Scenarios | 60 | Manage scenario | Same |
| Feature Flags | 70 | Workspace settings | Choosing alpha features is not inspection |

Section labels are English-only literals in the bundle's template. This is a developer tool and
taxpert has no i18n system, but a host that server-renders a `<template>` with the same id wins over
the bundle's copy, so credit-assistant can supply translated markup without touching this package.

## Display options

`display-options.js` owns the state and the host-page effects. `display-modal.js` owns the
presentation. Keeping them apart lets the screens toolbar re-apply stored options on load without
instantiating any modal UI.

Persistence is sessionStorage rather than localStorage, because a display preference belongs to the
tab you are reviewing in.

| Option | Effect, all reversible |
|---|---|
| `validationText` | Force every visible question to render its required-field message |
| `modalsInline` | Render each modal in the page flow, under the question whose link opens it |
| `expandAccordions` | Open every `<details>` on the page |
| `layout` | `stack`, one item per row, or `wrap`, tiled across the card |

Several effects reach into the host's own flow markup, so they ask `getConfig().flowDom` which
elements those are rather than assuming credit-assistant's `fg-*` tags. The descriptor is read
inside the effect, never at module scope, because `applyDisplayOptions()` runs on every page load and
mode switch.

### Not every option means something everywhere

`MODE_OPTIONS` lists what each destination offers. A destination the table says nothing about offers
everything.

| Destination | Offers |
|---|---|
| `product` | `validationText`, `modalsInline`, `expandAccordions` |
| `path` | `validationText`, `modalsInline` |
| `browse` | everything |

The Product Experience shows one screen's questions in a fixed reading order, so there is no
arrangement to choose. Path Mode is a reading of one taxpayer's route, so what it offers is the
annotations that answer why: the validation copy and the condition cues.

Showing modals inline is an annotation rather than a rearrangement, which is why Path Mode offers it
and offers neither expanding accordions nor tiling the card. A modal on the route answers "what did
this link say", a question you can otherwise only settle by opening each overlay and losing your
place.

**An option a destination does not offer is applied at its default, not at its stored value.** The
stored value survives, so switching back to Browse All restores your wrap layout, but a control that
is not on screen must not still be moving the page underneath it. Stack is the layout default, which
is why Path Mode always stacks.

### `expandAccordions` has no fixed default

The screen listings exist to show every question at once, so they open every `<details>` by default.
The Product Experience is a real walkthrough, where a collapsed accordion is the intended design, so
there the default is off. Once someone touches the checkbox their choice is stored and wins in both
places.

`resolveExpandAccordions()` asks the destination rather than the page's markup. The test used to be
"is there a `<taxpert-screens-toolbar>` on the page", which stopped meaning "this is a listing" the
moment the Product Experience grew the same sub-nav bar.

### The Display dialog serves two kinds of host

Unset, the Visibility and Layout sections are built from `display-options.js`. A host whose display
is not a flow page instead assigns `visibilityOptions`, `layoutOptions` and `footerAction`
descriptors, each carrying the current value and a callback, and gets the same dialog over its own
state off the same nav button.

Fact Explorer is that host. Its rows reveal graph nodes, its Layout arranges a canvas, and its
footer resets the layout.

Do not build a second Display modal. Pass options into this one.

The dialog is built once. `open()` refreshes the controls rather than rebuilding them.

### How "show modals inline" places things

A flow authors its overlays at the foot of the page, after every `<section>`, which is where the
scaffold's schema requires them. Making them visible in place is only half the job, because on their
own they pile up in a block at the bottom, several questions away from the copy they explain.

Inline mode renders each one under the question that links to it, and takes it back down when the
option goes off. The placement is the same in all three destinations, because all three render the
same page content.

**The pairing is by link, never by declaration order.** Whichever question contains the link
pointing at an overlay's id is the question it belongs under. A link that is not inside a question
anchors to the block it sits in, so the overlay lands under the sentence that mentions it.

**What is placed is always a copy, and the authored overlay never moves.** This is what keeps inline
mode from breaking the overlay it renders. An element can only be in one place at a time, and
`showModal()` lifts it into the top layer, so an overlay that had been moved under its question
vanished the moment you clicked its link and popped back when you closed it. The marker telling the
stylesheet "render this in the flow" travelled with it too, so the thing in the top layer was still
statically positioned with its close button hidden, landing off-centre with no way to dismiss it.

The copy is stripped of every id, because the original is what the link opens and what the host's
own scripts reach for, and a duplicate id makes `getElementById` a coin toss. Being a `<dialog>` with
no `open` attribute, the original stays invisible where it sits. Only the copy carries
`data-taxpert-modal-inline`, which is what the stylesheet renders.

Two consequences of pairing by link, both of them the point:

- **One overlay, several questions.** Four of credit-assistant's modals are linked from two questions
  on the same page, and a reviewer reading the second should not have to scroll back to the first.
  Copying per link gives that for free.
- **An overlay nothing links to is left alone.** credit-assistant's tax-year change confirmation is
  opened by its own JavaScript and explains no question, so there is nothing to put it under.
  Rendering it in the flow would leave a stray box at the foot of the page, which is the thing this
  feature exists to remove. This is why the stylesheet keys on `[data-taxpert-modal-inline]` rather
  than on every `dialog`.

**Nothing is placed twice.** `applyDisplayOptions()` re-runs on every load and mode switch, so each
link is placed once and remembered. A link that arrives later, such as a collection row
materializing, is picked up by the next run. Restoring is a deletion, so nothing has to be put back.

Whether a placed copy is actually *shown* is the stylesheet's half. `display-modal.css` hides one
whose immediately preceding question is conditioned out or truncated away by Path Mode. Doing it
there means nothing has to re-run when a condition flips or the path cursor moves, because a placed
copy is always the element right after its anchor, which is a selector.

## The screens toolbar

`<taxpert-screens-toolbar>` is the sub-nav under the global nav on all three Experience Explorer
destinations. The name is historical: it began as the two screen listings' toolbar.

The Product Experience gained the same bar because a workspace destination should say which
destination it is. The nav tells you where you can go, the bar tells you where you are. There it is
only that, one title block, because a walkthrough has no listing to filter and no path to truncate.
Everything below the identity block is skipped in that mode rather than rendered inert.

Path Mode renders without the per-section tab strip, one continuous path not being a thing you
filter by section.

### Where `mode` comes from

Property first, then the `mode` attribute, then the URL.

Browse All and Path Mode are separate destinations in the global nav rather than a checkbox on one
page, so the mode comes from `?mode=path` and switching modes is a navigation. Hosts serving the two
from genuinely different routes can set the `mode` property instead.

The Product Experience is a different generated template altogether and no `?mode=` says so, so the
host states it in the markup as `<taxpert-screens-toolbar mode="product">`. An attribute rather than
a property, because that mount is a server-rendered tag with no script beside it.

### Properties

| Property | Meaning |
|---|---|
| `sections` | `[{ slug, title }]`, rendered as section tabs |
| `mode` | `product`, `browse` or `path` |
| `checkConditionFn` | `(conditionPath, operator) => boolean`. Unset, falls back to `getConfig().flowDom.checkCondition` with a one-time warning |
| `isAnsweredFn` | `(questionElement) => boolean`. Defaults to the element's own `isComplete()`, then to `getConfig().flowDom.isAnswered` |

It dispatches `section-select` with `{ slug }`, bubbling and composed.

The "force collections to render" bootstrap that manipulates core flow elements stays in the host,
in `all-screens-bootstrap.js`.

### What the toolbar drives on the host page

| It does | Notes |
|---|---|
| Shows one section | `hidden` on each section, because the comparison is between two elements' attribute values and no CSS selector expresses that |
| Reflects `mode` to the host | So the stylesheet can select on it. `[mode="product"]` is what hides the section tabs |
| Tells the nav which destination you are on | See below |
| Carries `?mode=` across the language selector | See below |
| Re-evaluates gated screens on `fg-update` | So editing an answer on the page updates what is shown |
| Truncates at the point of progress | In Path Mode only, through `path-cursor.js` |

**It tells the nav which destination you are on.** Browse All and Path Mode are two nav destinations
served by one generated page, told apart by `?mode=path` at runtime, so the host can only
server-render one `active` value for both. The mode is known here and nowhere else. Without this,
Path Mode wore Browse All's identity and got Browse All's tool strip.

**It carries the destination across a language switch.** The page's language selector holds one
route per locale, written by the server, which sees a path and never a query string, so every one of
those routes points at Browse All. Switching language from Path Mode would otherwise quietly change
which listing you are reading. This is done here rather than in the Display modal that shows the
control, because this element is the only thing on the page that reads `?mode=`. A route that
already carries a query is left alone, that being a host writing its own destinations.

**Timing on a cold load.** The toolbar waits a tick for collection instances to materialize before
opening `<details>` and rendering condition annotations. The point-of-progress walk asks each
question whether it is answered, so it needs the element upgraded, and on a cold load the host's
fact-graph module can still be fetching its dictionary. It therefore re-applies once the custom
element definition lands, skipping that when the host's `questionTag` is a built-in element, since
there is nothing to upgrade and `whenDefined()` throws on a name without a hyphen.

**An unreadable path counts as answered.** A collection item that has not materialized cannot be
read, and showing more of the path is better than truncating it on a question the person is not
actually sitting on.

## The path cursor

Path Mode shows the product experience as one scrollable page: only the content a person actually
encounters on one path, and only up to how far they have got. `path-cursor.js` is the "how far"
half. It walks the rendered screens in document order and marks everything past the point of
progress with `off-path`, which `all-screens.css` hides while `body.path-mode` is on.

The walk ends at the first thing that would stop a real user:

- a question with no answer yet, since they would be sitting on it, or
- a revealed knockout alert, since the path is over.

If neither is found, every question is answered and the whole path renders through the end.

Two deliberate choices:

Conditions are evaluated here through the host's `checkCondition` rather than read off the `.hidden`
class the flow runtime applies, so the pass never depends on whether the host's own `fg-update`
listener has run yet.

Off-path elements get `off-path`, never `.hidden`. The flow runtime deletes the facts behind
`.hidden` questions, and truncating a view must never touch the fact graph.

### Modals are never off-path

A page's overlays render after its `<section>`, so the truncation would sweep them up as "past the
cursor" and hide them. `showModal()` would then open a hidden dialog and nothing would appear,
breaking every modal link on the very screen the person is sitting on.

Dialogs are therefore never marked off-path, and the walk never treats one as a step on the path.

## Feature flags

Which flags exist is the host's, through `config.featureFlags`. Each entry carries three things:

| Field | Used as |
|---|---|
| `name` | camelCase. The localStorage key, and what `getFlag`/`setFlag` take |
| `kebab` | The `data-ff` value, the `ff-` body class, the stem of the panel's build-default attribute, and the stem of a host's CLI switch |
| `label` | The wording Workspace settings puts on the flag's row |

The effective value is the localStorage override, falling back to the build-time attribute default.

A flag is a statement about a host's roadmap, so the list defaults to empty. What lives in this
module is the machinery: the override, the body class, and the change event.

### The DOM convention

Anything gated by a flag carries `data-ff="<kebab>"`. It is always rendered, and CSS hides it unless
`<body>` carries the matching `ff-<kebab>` class, which `applyFlags()` sets. One class in one place,
rather than a JavaScript fan-out reaching into each surface separately.

### Cross-app reactivity

`setFlag()` dispatches `FLAG_CHANGE_EVENT` (`taxpert:feature-flags-changed`) on `document`, so a
consumer keeping its own read-side state can resync without polling. Fact Explorer's
`useFeatureFlags` hook is that consumer.

The event name and the storage key are shared with Fact Explorer by naming convention rather than by
importing this module, because a Vite app's build defaults come from env vars rather than a DOM
attribute.

**The feature-flags storage key must not move for the hosts that exist today.** It was the literal
`taxpert:featureFlags`, and both credit-assistant and Fact Explorer configure
`storagePrefix: 'taxpert'`, so both still resolve to exactly that string. Since Fact Explorer reads
it by convention rather than by import, a prefix change here would quietly decouple the two. A host
that sets its own prefix gets its own flag overrides, which is the intent.

## Where the two endpoint bases come from

`fact-graph-io.js` and `chat.js` resolve a base the same way: the panel attribute, then
`config.endpoints`, then nothing.

The attribute is first because it is the page's answer, and credit-assistant server-renders it per
build. The config is the answer for a host with no panel element to hang attributes on. Reading only
the attribute meant Fact Explorer had to mount a decoy `<taxpert-audit-panel>` carrying
credit-assistant's URLs just to make scenarios load.

The graph itself goes through `config.graph` rather than `window.factGraph` and
`window.loadFactGraph`, which is what used to pin these files to one host.

## The outcomes editor

`config.determinations` is editable in the browser because `outcome` is declarative. A determination
used to carry a function, so the Outcome tracker's content could only change by editing a host's
JavaScript and rebuilding.

There is no draft state. Every control writes the whole determinations array back through
`setConfigOverride('determinations', …)` on `change`, and the section re-renders from the config it
just wrote. The array is small and the tracker rebuilds on the same event anyway, so there is
exactly one copy of the truth. A draft layer would need saving, discarding, and a story for a host
that re-configures mid-edit.

It listens on `change` rather than `input`, so a half-typed fact path never reaches the config and
the tracker does not flicker through every keystroke.

## Storage keys are functions

Every module here that stores something exports or holds its key as a function and calls it at each
read and write. These modules are imported before the host calls `configure()`, so a captured key
would pin the default `taxpert:` prefix and a host's own namespace would silently never take effect.

Adopting a prefix costs a one-time reset of panel state, chat transcript, display options and
selected section. See the migration note in `workspace-configuration.md`.

## Gotchas

| Watch out for | Why |
|---|---|
| Caching a `storageKey()` result in a module-scope const | It pins the default prefix forever |
| Marking anything off-path with `.hidden` | The flow runtime deletes the facts behind hidden questions |
| Treating a dialog as a step on the path | It breaks every modal link on the current screen |
| Assuming an unoffered display option keeps its stored value | It is applied at its default while the control is off screen |
| Testing for a screens toolbar to detect a listing | The Product Experience has one too. Ask `displayMode()` |
| Renaming the `featureFlags` storage key or `FLAG_CHANGE_EVENT` | Fact Explorer matches both by convention, not by import |
| Adding a second Display dialog for a non-flow host | Pass `visibilityOptions` / `layoutOptions` / `footerAction` into this one |
