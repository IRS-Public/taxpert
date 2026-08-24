# Internals: the tool panels

The tool panels are the workspace's inspection surfaces. They open from the global nav's **Tools**
button into a dockable, draggable, resizable area on the right of the host page.

The bundle is `packages/ui/src/tool-panels/`. It replaced the audit panel's right-hand rail, which
is now hidden by default.

## The modules

Everything here follows one split: a module owns the state, and an element is a view over it, kept in
step through a document event.

| Module | Role |
|---|---|
| `tool-registry.js` | The tool list, and canonical order |
| `tool-layout.js` | Which tools are on, where each panel sits, how big it is |
| `taxpert-tools-modal.js` | "Tools", the switchboard the nav opens |
| `taxpert-tool-dock.js` | The dock, the floating layer, and the drag and resize gestures |
| `taxpert-tool-panel.js` | The chrome one tool wears |
| `drop-target.js` | Where a dragged panel would land. A pure function |
| `drag-resize.js` | Pointer-drag and keyboard-step plumbing |
| `fact-values.js` | Everything the tools read out of the host's fact graph |
| `fact-definitions.js` | Everything the Inspect tool reads out of the fact dictionary |
| `inspect-selection.js` | What Inspect is currently pointed at |
| `inspect-cues.js` | What turning Inspect on puts on the host page |
| `combo-box.js` | A filtering combo box, used to pick a fact path |
| `templates.js` | The bundle's template loader |

The tool bodies are `taxpert-inspect.js`, `taxpert-outcome-tracker.js`, `taxpert-watchlist.js` and
`taxpert-overrides.js`, plus `watchlist-store.js` and `taxpert-add-fact-modal.js`.

## The tool list

`config.tools` is the list, seeded by `defaultTools()` in `config.js` and replaceable by a host.

**Array position is the canonical order.** Every insertion is placed against it rather than appended,
so the dock's left-to-right order survives whatever order the checkboxes were ticked in.
`canonicalIndex()` in `tool-registry.js` enforces that, and the Workspace settings modal writes the
filtered build list for the same reason.

Every export in the registry is a function, so the config is read when a caller asks rather than
captured at module scope.

A tool descriptor carries `id`, `label`, `description` and `templateId`. Some tools read extra keys:
Overrides reads `facts`.

## Layout state

`tool-layout.js` holds it and persists it to localStorage under the `toolLayout` key.

```
on        Set of tool ids that are switched on
columns   [{ flex, ids: [...] }]   docked columns, left to right. Each `ids` is a top-down stack
floating  Map id -> { x, y, w, h } undocked panels, in px
width     dock width in px, or null for the CSS default
```

`<taxpert-tools-modal>` and `<taxpert-tool-dock>` are peer views over this and re-sync from
`TOOL_LAYOUT_CHANGE_EVENT`. The checkbox and the panel stay in step through this module rather than
through any path between the two elements.

**Sizes are stored as flex ratios rather than pixels**, because the CSS does the arithmetic. The dock
measures, clamps and writes ratios, and layout itself is CSS.

localStorage rather than sessionStorage, because a panel arrangement is something you set up once and
keep.

## Dragging

`<taxpert-tool-dock>` is the only surface that knows where panels sit relative to each other, so it
owns dragging. Everything it decides is written to `tool-layout.js` and read back from there.

`drop-target.js` answers where a dragged panel would land, as a pure function over the pointer and
the rectangles on screen. The dock measures, calls it, draws the drop indicator from the answer, and
on `pointerup` hands the same answer to `tool-layout.js`. `EDGE_ZONE` is how close to a column edge
counts as "make a new column here".

`drag-resize.js` binds move and up on `window`, so a drag that outruns the cursor still tracks. A
body class carries the cursor and `user-select: none` for the duration. Every handle takes arrow keys
as well as the pointer.

`onMove` receives deltas from the press point rather than from the previous frame, so a handler never
accumulates rounding drift.

## Reading the host's data

Two modules, and the distinction matters.

`fact-values.js` reads the fact **graph**: what a fact is currently worth. Nothing in it touches
`window.factGraph`. Every read goes through `config.graph`, so a host with a different engine
supplies its own adapter and every tool follows.

The port surface it uses, and nothing more:

| Call | Answers |
|---|---|
| `graph.paths()` | Every abstract path in the dictionary, sorted |
| `graph.getCollectionIds(root)` | The item ids currently in a collection |
| `graph.get(concretePath)` | `{ complete, hasValue, get }` or `null` |
| `graph.getDefinition(path)` | `{ typeNode }` or `null` |

`fact-definitions.js` reads the fact **dictionary**: what a fact is for. The XML is the audit
panel's, fetched once and exported as a live binding, so this module reads that rather than fetching
a second copy. Every read is defensive, the document being null until that fetch resolves.

`describeCondition()` answers as data, `{ text, strong }` parts, rather than as markup, which keeps
callers inside the no-innerHTML rule.

## Inspect

`inspect-selection.js` owns what Inspect is pointed at, and `<taxpert-inspect>` is a view over it,
kept in step through `INSPECT_SELECT_EVENT` on `document`. The selection is not persisted.

`inspect-cues.js` is what turning the tool on puts on the host page. Every question and display unit
the host is showing becomes hoverable and clickable. Hover draws a dotted outline over a tinted unit,
and a click both opens the panel and points it at that unit.

`showInspectCues()` and `hideInspectCues()` are called from `<taxpert-inspect>`'s connected and
disconnected callbacks, so the cues are on for exactly as long as the panel is mounted. There is no
separate switch for them, a treatment that had to be turned on separately from the tool it fed being
one control too many.

**The affordance is the unit itself**, which is why nothing in that module builds markup. The whole
treatment is a mark on the host's own element plus two rules in `inspect.css`. It used to be a cue
button pinned to each unit's corner, which needed anchor and slot machinery so an inline display
element mid-sentence could borrow its block ancestor's corner.

## The tool bodies

Each of these is the same shape: the element owns no state, another module holds it, `fact-values.js`
reads the current values, and the element renders the two together.

| Element | Replaced | Reacts to |
|---|---|---|
| `<taxpert-inspect>` | The Fact Inspector and Flow Inspector rail tabs | `INSPECT_SELECT_EVENT`, then `fg-load`/`fg-update` |
| `<taxpert-outcome-tracker>` | credit-assistant's Eligibility Inspector section | `fg-load`/`fg-update` |
| `<taxpert-watchlist>` | The Fact Inspector's tracked facts | `WATCHLIST_CHANGE_EVENT`, then `fg-load`/`fg-update` |
| `<taxpert-overrides>` | tax-withholding-estimator's hand-built "Override Date" | `fg-load`/`fg-update` |

**A change to the set of rows reconciles rows. A change to a value refreshes rows in place.** That
split is the point: `fg-update` fires on every keystroke, and rebuilding the rows on each one would
throw away an open `<details>` and any focus inside the panel.

Each of these answers the two questions you actually stand there asking, has this settled and to
what, and keeps the fact-by-fact working behind a `<details>`. The rail tabs they replaced printed
serialized XML into a `<pre>` and left the reader to work out what it meant.

### The watchlist store

An entry is `{ path, collectionId }`: the abstract path, which may carry a `*` wildcard, and the
collection item id that resolves it, `''` for a plain fact. **The pair is the identity**, so the same
abstract path pinned for two household members is two entries.

Persistence is sessionStorage rather than localStorage, unlike the tool layout, because a pinned fact
belongs to the scenario you are working through.

Every mutator dispatches `WATCHLIST_CHANGE_EVENT` on `document`, so a second watchlist panel, or a
host that adds a fact from its own UI, stays in step without either surface knowing about the other.

### Overrides

Setting a fact directly, without walking the flow to the screen that asks for it. This is the generic
answer to a control every host grows its own version of.

The fact paths are the host's, in `config.tools`:

```js
{ id: 'overrides', label: 'Overrides', templateId: 'ttp-body-overrides',
  facts: ['/overrideDate'] }
```

Adding one is therefore configuration, an entry in a host's config or a row typed into Workspace
settings, rather than a code change in this package.

## The combo box

`.usa-combo-box` is enhanced and then driven by `uswds.min.js` through delegated, document-level
listeners bound to its own class names. Fact Explorer loads no USWDS JavaScript at all, so the
component would render as an inert `<select>` there. credit-assistant does load it, so those
delegated handlers would run against a combo box this package built and USWDS never enhanced.
Borrowing the class names inherits both problems.

So the markup is the bundle's, the behaviour is `combo-box.js`, and USWDS's look comes from
`watchlist.css`.

The interaction is the ARIA combobox pattern: typing filters and opens the list, arrow keys move the
active option through `aria-activedescendant` while the input keeps focus, and Enter commits.

## Templates

One module, so each file is fetched exactly once and every element in the bundle awaits the same
memoized promise.

`new URL('../templates/…', import.meta.url)` is the one form both a vendored copy and a Vite build
resolve, and each URL is written out statically so Vite can see it and emit the asset.

`<taxpert-tool-panel>` is what appends a tool's `templateId` fragment, so it is what must import the
tool body modules and have their tags defined first.

## Gotchas

| Watch out for | Why |
|---|---|
| Appending a tool rather than placing it by canonical index | Dock order would then depend on the order the checkboxes were ticked |
| Capturing `config.tools` at module scope | Every registry export is a function for that reason |
| Storing panel sizes in pixels | The CSS does the arithmetic. Store flex ratios |
| Rebuilding rows on `fg-update` | It fires on every keystroke, and would drop an open `<details>` and any focus |
| Reading `window.factGraph` from a tool | Go through `config.graph`, or a host with another engine loses the tool |
| Returning markup from `fact-definitions.js` | It answers `{ text, strong }` parts, to stay inside the no-innerHTML rule |
| Borrowing `.usa-combo-box` class names | USWDS's delegated handlers would then fight this implementation |
| Reusing an id across the Tools and Workspace settings modals | Both are mounted at once, and a USWDS checkbox is clicked through its `<label for>`. Guarded by `unique-ids.test.mjs` |
