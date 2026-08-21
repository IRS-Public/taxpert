// What the Inspect tool is currently pointed at.
//
// Same split as watchlist-store.js and tool-layout.js: this module owns the value, and
// <taxpert-inspect> is a view over it. Selecting dispatches INSPECT_SELECT_EVENT on `document`, so
// two open Inspect panels — or a host that selects from its own UI — stay in step without either
// surface knowing about the other.
//
// The value is deliberately *not* persisted. A watchlist belongs to the scenario and a panel layout
// belongs to the workbench, but a selection belongs to the moment: restoring one on the next page
// load would point the panel at a question that isn't on screen.
//
// selectRenderedUnit() also switches the Inspect tool on, which is the whole interaction behind the
// cue buttons — a click out in the flow both opens the panel and fills it. The order matters: the
// value is stored *before* setToolOn, because the panel that call creates renders asynchronously
// (its templates are a separate fetch) and reads the selection when it does, long after the event
// below has been and gone.

import { setToolOn } from './tool-layout.js'

export const INSPECT_SELECT_EVENT = 'taxpert:inspect-select'

/**
 * A rendered unit — one <fg-set> or <fg-show> and the objects behind it. Every field but `title` is
 * nullable: a question with no gate has no `flow`, and copy with no <span condition> has no `text`.
 * @typedef {{
 *   title: string,
 *   fact: {path: string} | null,
 *   flow: {path: string, operator: string} | null,
 *   text: {path: string, operator: string} | null,
 * }} RenderedUnit
 */

let selection = null

/** The selected unit, or null. @returns {RenderedUnit | null} */
export function getInspectSelection () {
  return selection
}

/**
 * Point Inspect at a rendered unit and open the tool.
 * @param {RenderedUnit | null} unit
 */
export function selectRenderedUnit (unit) {
  selection = unit ?? null
  setToolOn('inspect', true)
  document.dispatchEvent(new CustomEvent(INSPECT_SELECT_EVENT, { detail: selection }))
}

/** Return the panel to its "Select an item to get started" state, without closing it. */
export function clearInspectSelection () {
  if (!selection) return
  selection = null
  document.dispatchEvent(new CustomEvent(INSPECT_SELECT_EVENT, { detail: null }))
}
