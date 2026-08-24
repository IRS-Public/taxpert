// What the Inspect tool is currently pointed at.
//
// This module owns the value and <taxpert-inspect> is a view over it, kept in step through
// INSPECT_SELECT_EVENT on `document`. The selection is not persisted. See ../../../../../docs/internals/tool-panels.md.

import { setToolOn } from './tool-layout.js'

export const INSPECT_SELECT_EVENT = 'taxpert:inspect-select'

/**
 * A rendered unit: one <fg-set> or <fg-show> and the objects behind it. Every field but `title` is
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
  // Stored before setToolOn: the panel that call creates renders asynchronously and reads the
  // standing selection when it does, after the event below has been dispatched.
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
