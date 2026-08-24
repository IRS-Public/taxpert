// Path Mode's point-of-progress cursor: the "how far did this person get" half of Path Mode.
//
// It walks the rendered screens in document order and marks everything past the point of progress
// with `off-path`, which all-screens.css hides while `body.path-mode` is on. The walk ends at the
// first unanswered question or the first revealed knockout alert.
//
// Which elements those are, and which attributes gate them, is the host's to describe via
// getConfig().flowDom. Read per call, never captured.
//
// Two deliberate choices. Conditions are evaluated here through the host's checkCondition rather
// than read off the `.hidden` class the flow runtime applies, so this pass never depends on whether
// the host's fg-update listener has run yet. And off-path elements get `off-path`, NEVER `.hidden`,
// because the runtime deletes the facts behind hidden questions and truncating a view must not
// touch the graph.
//
// See ../../../../../docs/internals/audit-panel.md

import { getConfig } from '../../shared/js/config.js'

export const OFF_PATH_CLASS = 'off-path'

// Dialogs are never marked off-path. They render after their <section>, so the truncation would
// hide one that its link may still open, and showModal() would then open a dialog that never
// appears. Under "show modals inline" the hiding is display-modal.css's instead, keyed off the
// `.off-path` this pass puts on the question immediately before it.
//
// Upper-cased once per pass because the walk compares against `.tagName`.
function tagNames (flowDom) {
  return {
    QUESTION: flowDom.questionTag.toUpperCase(),
    ALERT: flowDom.alertTag.toUpperCase(),
    MODAL: flowDom.modalTag.toUpperCase(),
  }
}

// Clear the marks from a previous pass so a re-run (fg-update, mode switch) starts clean.
export function clearPathCursor (root = document) {
  root.querySelectorAll(`.${OFF_PATH_CLASS}`).forEach((el) => el.classList.remove(OFF_PATH_CLASS))
}

// Mark every following sibling of `node`, at every level from `node` up to (but not including)
// `stopAt`, the standard "hide everything after this point in the tree" walk.
function markAfter (node, stopAt, MODAL) {
  let current = node
  while (current && current !== stopAt) {
    let sibling = current.nextElementSibling
    while (sibling) {
      if (sibling.tagName !== MODAL) sibling.classList.add(OFF_PATH_CLASS)
      sibling = sibling.nextElementSibling
    }
    current = current.parentElement
  }
}

// Apply the point-of-progress truncation to `root`.
//
//   checkCondition  (conditionPath, operator) => boolean, the host's condition evaluator.
//   isAnswered      (questionElement) => boolean, true when the question already has a value.
//
// Both default to the descriptor's own implementations, so a host that has configured flowDom need
// not pass anything; an explicitly injected function still wins, which is how credit-assistant's
// toolbar hands in the core checkCondition it already has.
//
// Returns { cursor, terminal } where terminal is 'question' (stopped on an unanswered question),
// 'knockout' (stopped on a revealed knockout alert), or 'end' (nothing truncated).
export function applyPathCursor (root = document, { checkCondition, isAnswered } = {}) {
  clearPathCursor(root)

  const flowDom = getConfig().flowDom
  const { QUESTION, ALERT, MODAL } = tagNames(flowDom)
  const evaluate = typeof checkCondition === 'function' ? checkCondition : flowDom.checkCondition
  const answered = typeof isAnswered === 'function' ? isAnswered : flowDom.isAnswered

  const onPath = (el) => {
    const condition = el.getAttribute(flowDom.conditionAttr)
    const operator = el.getAttribute(flowDom.operatorAttr)
    if (!condition || !operator) return true
    return evaluate(condition, operator)
  }

  // The first element that stops the path, or null if the walk reaches the end.
  let cursor = null
  let terminal = 'end'

  // Depth-first over element children, in document order. Returns true once terminal, which
  // unwinds the recursion so the caller can stop.
  const walk = (parent) => {
    for (const el of parent.children) {
      if (el.tagName === MODAL) continue // on-demand overlay, not a step on the path
      if (!onPath(el)) continue // conditioned out — not on this path at all

      if (el.tagName === QUESTION) {
        // An optional question can't block the real flow, so it can't terminate the path either:
        // show it and keep going.
        if (el.getAttribute(flowDom.optionalAttr) === 'true' || answered(el)) continue
        cursor = el
        terminal = 'question'
        return true
      }

      if (el.tagName === ALERT && el.getAttribute(flowDom.knockoutAttr) === 'true') {
        // A revealed knockout is the end of the road. It is visible, nothing after it is.
        cursor = el
        terminal = 'knockout'
        return true
      }

      if (el.children.length > 0 && walk(el)) return true
    }
    return false
  }

  const screens = Array.from(root.querySelectorAll(flowDom.screenSelector))
  for (const [index, screen] of screens.entries()) {
    // Screens whose page-level gate is false aren't on this path; the toolbar already hides them.
    const gate = screen.dataset.gateCondition
    const gateOperator = screen.dataset.gateOperator
    if (gate && gateOperator && !evaluate(gate, gateOperator)) continue

    if (!walk(screen)) continue

    // Terminal found: hide the rest of this screen, then every screen after it. Section elements
    // themselves are never marked, so the headings for sections ahead stay listed.
    markAfter(cursor, screen, MODAL)
    for (const later of screens.slice(index + 1)) later.classList.add(OFF_PATH_CLASS)
    return { cursor, terminal }
  }

  return { cursor, terminal }
}
