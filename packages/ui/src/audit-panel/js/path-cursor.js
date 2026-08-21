// Path Mode's point-of-progress cursor.
//
// Path Mode shows the product experience — one question at a time — as a single scrollable page:
// only the content and questions a user actually encounters on one path, and only up to how far
// they've actually got. This module is the "how far" half. It walks the rendered screens in
// document order and marks everything past the point of progress with `off-path`, which
// all-screens.css hides while `body.path-mode` is on.
//
// The walk ends at the first thing that would stop a real user:
//   - a question with no answer yet — they'd be sitting on it, so it's the last visible item; or
//   - a revealed knockout alert — the path is over.
// Everything after that point is off path. If neither is found, every question is answered and
// the whole path renders through the end (a completed or disqualified graph).
//
// Which elements those are — question, alert, modal, screen — and which attributes gate them is the
// host's to describe, via getConfig().flowDom (see flow-dom.js); the defaults are credit-assistant's
// `fg-*` conventions, so nothing about this walk changed when it stopped hardcoding them. The
// descriptor is read per call, never captured, so a host may configure() after this module loads.
//
// Two deliberate choices:
//   - Conditions are evaluated here (via the host's checkCondition) rather than read off the
//     `.hidden` class that fg-conditions.js applies, so this pass never depends on whether the
//     host's own fg-update listener has run yet.
//   - Off-path elements get `off-path`, never `.hidden` — showOrHideAllElements() deletes the
//     facts behind `.hidden` questions, and truncating the view must never touch the Fact Graph.

import { getConfig } from '../../shared/js/config.js'

export const OFF_PATH_CLASS = 'off-path'

// Modals are on-demand overlays a link opens, not steps along the path. A page's <modal-dialog>s
// render (as <dialog>) after its <section>, so the point-of-progress truncation would sweep them up
// as "past the cursor" and hide them with off-path → display:none. Then showModal() opens a hidden
// dialog and nothing appears — breaking every modal link, and the tax-year / filing-status change
// confirmations, on the very screen the user is sitting on. So dialogs are never marked off-path,
// and the walk never treats one as a step on the path.
//
// That still holds under "show modals inline", which moves each dialog out from under the section
// to sit directly after the question it explains (display-options.js). A dialog parked past the
// cursor must not show, but marking it here would put us back to hiding a dialog its link may still
// open — so the hiding is display-modal.css's, keyed off the `.off-path` this pass puts on the
// question immediately before it.
//
// The three are compared against `.tagName`, which is uppercase, so the descriptor's tag names are
// upper-cased once per pass rather than lower-casing every element the walk touches.
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
// `stopAt` — the standard "hide everything after this point in the tree" walk.
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
//   checkCondition — (conditionPath, operator) => boolean; the host's condition evaluator.
//   isAnswered     — (questionElement) => boolean; true when the question already has a value.
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
        // A revealed knockout is the end of the road — it's visible, nothing after it is.
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
