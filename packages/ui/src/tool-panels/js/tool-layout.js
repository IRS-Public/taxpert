// The layout state behind the Tools modal and the tool dock: which tools are on, where each panel
// sits, and how big it is.
//
// This module owns the state and its persistence; <taxpert-tools-modal> and <taxpert-tool-dock> are
// two views over it — the display-options.js split. The difference from display-options is that
// these two are *peers*: ticking a checkbox shows a panel, and closing [x] a panel unticks the
// checkbox. So every mutator dispatches TOOL_LAYOUT_CHANGE_EVENT on `document` and both surfaces
// re-sync from it, the way feature-flags.js already notifies read-side consumers it can't reach.
//
// Persistence is localStorage (not sessionStorage like display-options): a panel arrangement is
// something you set up once and keep, not a preference belonging to the tab you're reviewing in.
//
// Sizes are stored as flex ratios, not pixels or percentages, because the CSS does the arithmetic:
// panels in a column and columns in the dock are all `flex: <ratio> 1 0`, so three panels with no
// stored ratio split the height three ways on their own. Nothing here computes 33%.
//
// State shape (in memory):
//   on        Set of tool ids that are switched on
//   columns   [{ flex, ids: [...] }]  docked columns, left→right; each `ids` is a top→bottom stack
//   floating  Map id → { x, y, w, h }  undocked panels, in px
//   width     dock width in px, or null for the CSS default
//   heights   Map id → flex ratio within its column
//
// Internal lookups go through Maps and Sets rather than plain objects so no read is a dynamic
// `obj[name]` computed member access — the same reason feature-flags.js uses a Map.

import { toolIds, canonicalIndex, inCanonicalOrder } from './tool-registry.js'
import { storageKey } from '../../shared/js/storage-keys.js'

export const TOOL_LAYOUT_CHANGE_EVENT = 'taxpert:tool-layout-changed'

// storageKey('toolLayout') is called at each read and write, never captured in a module-scope const:
// this module is imported before the host calls configure(), so a captured key would pin the
// default 'taxpert:' prefix forever and the host's namespace would silently never take effect.
//
// A host that adopts a storagePrefix therefore loses its panel arrangement once, on the next load.
// That is accepted — it is dev-tool state that costs seconds to set up again, and migration code
// for it would outlive its usefulness by years.

/** Panel and column minimum, in px. Mirrors --ttp-min-width in tool-panel.css. */
export const PANEL_MIN_WIDTH = 300

/** The host content area never narrows past this — the USWDS tablet breakpoint. */
export const HOST_MIN_WIDTH = 640

/** Floating panels only. Mirrors --ttp-min-height in tool-panel.css. */
export const PANEL_MIN_HEIGHT = 300

const DEFAULT_DOCK_WIDTH = 480

let state = null
// The tool list `state` was revived under. reviveState() drops any stored id the tool registry does
// not know, and the registry is the *host's* — which arrives after this module loads. Without this,
// the first read (under the library's three defaults) would memoize a state with a host's fourth
// tool already discarded, and it would stay discarded for the life of the page.
let revivedUnder = null

// ── Persistence ───────────────────────────────────────────────────────────────

function emptyState () {
  return { on: new Set(), columns: [], floating: new Map(), width: null, heights: new Map() }
}

// Anything unrecognised is dropped rather than trusted: the stored value outlives the tool list, so
// a renamed or removed tool must not resurrect itself as an empty panel.
function reviveState (raw) {
  const next = emptyState()
  if (!raw || typeof raw !== 'object') return next

  for (const id of Array.isArray(raw.on) ? raw.on : []) {
    if (toolIds().includes(id)) next.on.add(id)
  }

  const placed = new Set()
  for (const column of Array.isArray(raw.columns) ? raw.columns : []) {
    const ids = (Array.isArray(column?.ids) ? column.ids : [])
      .filter((id) => next.on.has(id) && !placed.has(id))
    for (const id of ids) placed.add(id)
    if (ids.length) next.columns.push({ flex: numberOr(column?.flex, 1), ids })
  }

  for (const [id, rect] of Object.entries(raw.floating ?? {})) {
    if (!next.on.has(id) || placed.has(id) || !rect) continue
    placed.add(id)
    next.floating.set(id, {
      x: numberOr(rect.x, 0),
      y: numberOr(rect.y, 0),
      w: Math.max(numberOr(rect.w, PANEL_MIN_WIDTH), PANEL_MIN_WIDTH),
      h: Math.max(numberOr(rect.h, PANEL_MIN_HEIGHT), PANEL_MIN_HEIGHT),
    })
  }

  for (const [id, flex] of Object.entries(raw.heights ?? {})) {
    if (placed.has(id)) next.heights.set(id, numberOr(flex, 1))
  }

  next.width = raw.width === null || raw.width === undefined ? null : numberOr(raw.width, null)

  // A tool switched on but placed nowhere (a half-written value, or one saved before a tool was
  // added) still needs a home, or its checkbox would read as on with no panel to show for it.
  for (const id of toolIds()) {
    if (next.on.has(id) && !placed.has(id)) insertDocked(next, id)
  }
  return next
}

function numberOr (value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function serialize (value) {
  return {
    on: [...value.on],
    columns: value.columns,
    floating: Object.fromEntries(value.floating),
    width: value.width,
    heights: Object.fromEntries(value.heights),
  }
}

// Re-reads when the tool list itself moves, which on a normal page happens exactly once: this module
// is imported before the host calls configure(), so a first read can land under the library's
// defaults and the host's own tools arrive a moment later. Re-reading from storage rather than
// patching the cached state keeps one revival path — and anything already written in this session
// has been committed, so nothing in memory is lost by parsing it again.
function load () {
  const signature = toolIds().join(' ')
  if (state && revivedUnder === signature) return state
  revivedUnder = signature
  try {
    state = reviveState(JSON.parse(localStorage.getItem(storageKey('toolLayout')) ?? 'null'))
  } catch {
    state = emptyState()
  }
  return state
}

function commit () {
  try {
    localStorage.setItem(storageKey('toolLayout'), JSON.stringify(serialize(state)))
  } catch { /* storage unavailable */ }
  document.dispatchEvent(new CustomEvent(TOOL_LAYOUT_CHANGE_EVENT, { detail: getLayout() }))
}

/** Drop the in-memory cache so the next read re-parses storage. For tests. */
export function _resetToolLayout () {
  state = null
  revivedUnder = null
}

// ── Placement helpers ─────────────────────────────────────────────────────────

/**
 * Put `id` in the last docked column at its canonical position among the panels already there —
 * never appended blindly. This is what makes "displays in order 1-3 no matter what order the
 * checkboxes were selected in" true.
 */
function insertDocked (value, id) {
  const column = value.columns.at(-1)
  if (!column) {
    value.columns.push({ flex: 1, ids: [id] })
    return
  }
  const index = canonicalIndex(id)
  const at = column.ids.filter((other) => canonicalIndex(other) < index).length
  column.ids.splice(at, 0, id)
}

/** Take `id` out of wherever it is, pruning a column left empty. */
function detach (value, id) {
  value.floating.delete(id)
  for (const [index, column] of value.columns.entries()) {
    const at = column.ids.indexOf(id)
    if (at === -1) continue
    column.ids.splice(at, 1)
    if (!column.ids.length) value.columns.splice(index, 1)
    return
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * A structural snapshot for the dock to render from. Columns and stacks are plain arrays; sizes are
 * flex ratios with 1 as the default, so a consumer never has to know which of them were stored.
 * @returns {{ columns: {flex:number, ids:string[], panels:{id:string,flex:number}[]}[],
 *             floating: {id:string, x:number, y:number, w:number, h:number}[],
 *             width: number|null, on: string[] }}
 */
export function getLayout () {
  const value = load()
  return {
    on: inCanonicalOrder([...value.on]),
    width: value.width,
    columns: value.columns.map((column) => ({
      flex: column.flex,
      ids: [...column.ids],
      panels: column.ids.map((id) => ({ id, flex: value.heights.get(id) ?? 1 })),
    })),
    floating: [...value.floating].map(([id, rect]) => ({ id, ...rect })),
  }
}

export function isToolOn (id) {
  return load().on.has(id)
}

/** Every switched-on tool, in canonical order. */
export function activeTools () {
  return inCanonicalOrder([...load().on])
}

export function dockWidth () {
  return load().width ?? DEFAULT_DOCK_WIDTH
}

/**
 * The widest the dock may get: whatever is left after the host content area keeps HOST_MIN_WIDTH,
 * but never less than one panel's minimum.
 */
export function maxDockWidth (viewport = window.innerWidth) {
  return Math.max(PANEL_MIN_WIDTH, viewport - HOST_MIN_WIDTH)
}

/**
 * Whether the dock can hold `count` side-by-side columns at the current viewport. Two-up needs
 * ~1240px and three-up ~1540px, which is exactly PANEL_MIN_WIDTH × count + HOST_MIN_WIDTH.
 */
export function fitsColumns (count, viewport = window.innerWidth) {
  return maxDockWidth(viewport) >= count * PANEL_MIN_WIDTH
}

// ── Writes ────────────────────────────────────────────────────────────────────

export function setToolOn (id, on) {
  const value = load()
  if (!toolIds().includes(id) || value.on.has(id) === Boolean(on)) return
  if (on) {
    value.on.add(id)
    insertDocked(value, id)
  } else {
    value.on.delete(id)
    detach(value, id)
    value.heights.delete(id)
  }
  commit()
}

/**
 * Dock `id` into column `columnIndex` at stack position `index`. Passing a columnIndex one past the
 * end — or `newColumn` — opens a fresh column, which is how a side-by-side layout is made.
 */
export function dockTool (id, { columnIndex, index = 0, newColumn = false } = {}) {
  const value = load()
  if (!value.on.has(id)) return
  detach(value, id)
  if (newColumn || columnIndex === undefined || columnIndex >= value.columns.length) {
    const at = Math.min(Math.max(columnIndex ?? value.columns.length, 0), value.columns.length)
    value.columns.splice(at, 0, { flex: 1, ids: [id] })
  } else {
    const column = value.columns.at(Math.max(columnIndex, 0))
    column.ids.splice(Math.min(Math.max(index, 0), column.ids.length), 0, id)
  }
  commit()
}

/** Undock `id` to a free-floating box at viewport coordinates. */
export function floatTool (id, { x, y, w, h }) {
  const value = load()
  if (!value.on.has(id)) return
  detach(value, id)
  value.heights.delete(id)
  value.floating.set(id, {
    x: Math.max(Math.round(x), 0),
    y: Math.max(Math.round(y), 0),
    w: Math.max(Math.round(w), PANEL_MIN_WIDTH),
    h: Math.max(Math.round(h), PANEL_MIN_HEIGHT),
  })
  commit()
}

export function isFloating (id) {
  return load().floating.has(id)
}

export function setDockWidth (px) {
  const value = load()
  value.width = Math.min(Math.max(Math.round(px), PANEL_MIN_WIDTH), maxDockWidth())
  commit()
}

// Sizes are always written as a *pair*. Dragging a splitter redistributes the two boxes that share
// it and leaves every other sibling alone, so committing one side without the other would be a
// layout nobody asked for — and would cost a second render to correct.

export function setColumnFlexPair (columnIndex, before, after) {
  const value = load()
  const first = value.columns.at(columnIndex - 1)
  const second = value.columns.at(columnIndex)
  if (!first || !second) return
  first.flex = Math.max(before, 0.05)
  second.flex = Math.max(after, 0.05)
  commit()
}

export function setPanelFlexPair (firstId, secondId, before, after) {
  const value = load()
  value.heights.set(firstId, Math.max(before, 0.05))
  value.heights.set(secondId, Math.max(after, 0.05))
  commit()
}

/**
 * Send every open panel back to the default right-side arrangement: one column, canonical order,
 * nothing floating, no stored sizes — so equal flex gives 100% / 50% / 33% for 1 / 2 / 3 panels.
 * Which tools are *on* is left alone; this is the modal's "Reset tool layout" button, not a
 * "turn everything off".
 */
export function resetToolLayout () {
  const value = load()
  value.columns = []
  value.floating.clear()
  value.heights.clear()
  value.width = null
  for (const id of inCanonicalOrder([...value.on])) insertDocked(value, id)
  commit()
}
