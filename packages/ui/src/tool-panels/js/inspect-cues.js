// What turning the Inspect tool on puts on the host page: every question and display unit the host
// is showing becomes hoverable and clickable — hover draws a dotted outline over a tinted unit, and
// a click both opens the Inspect panel and points it at that unit. showInspectCues()/
// hideInspectCues() are called from taxpert-inspect.js's connected/disconnectedCallback, so the cues
// are on for exactly as long as the Inspect panel is mounted — there is no separate switch for them.
//
// It used to be a cue *button* pinned to each unit's top-right corner. The affordance is now the
// unit itself, which is why nothing here builds markup any more: the whole treatment is a mark this
// module puts on the host's own element (UNIT_ATTR / SELECTED_ATTR) and two rules in inspect.css.
// That deleted the anchor/slot machinery the absolutely-positioned button needed — an inline
// <fg-show> mid-sentence no longer has to borrow its block ancestor's corner, because highlighting
// the unit highlights exactly the value being explained.
//
// This operates on the HOST's flow DOM rather than the bundle's own subtree — the same arrangement
// as condition-detail.js's overlay, and the reason the queries here are document-scoped by design.
// Which elements those are, and which attributes carry their fact and condition, is the host's to
// describe: everything is read from getConfig().flowDom (see flow-dom.js), whose defaults are
// credit-assistant's `fg-*` conventions. Read at each pass, never captured — a host may configure()
// after this module loads. It lives in this bundle, beside the panel it feeds, rather than in
// display-options.js: what a click *does* is open a tool panel, and taxpert-inspect.js is what
// switches it on and off, from its own connected/disconnectedCallback.
//
// Switching the cues on must change nothing about how the flow lays out, so the highlight is an
// `outline` and a `background` and never a border, a padding or a display — see inspect.css. The
// same constraint is why the mark may not answer isRendered()'s question for it.
//
// The click is one delegated listener rather than a listener per unit: `closest()` picks the
// innermost unit under the pointer, which is the answer wanted when an <fg-show> sits inside an
// <fg-set>, and a unit revealed later needs no wiring of its own. It deliberately does not
// preventDefault — the taxpayer is still answering the question they clicked.
//
// Only units the host is actually *showing* are marked. The flow leaves a question it is not asking
// in the DOM and hides it, so the set of inspectable units changes as the taxpayer answers — which
// is why this watches the host rather than making a single pass when the option is switched on.

import { selectRenderedUnit, INSPECT_SELECT_EVENT } from './inspect-selection.js'
import { getLayout, TOOL_LAYOUT_CHANGE_EVENT } from './tool-layout.js'
import { abstractPathOf, factLabel } from './fact-definitions.js'
import { getConfig } from '../../shared/js/config.js'
import { isUncued } from '../../shared/js/flow-dom.js'

/**
 * Marks a unit the option is currently offering to inspect: what the hover treatment hangs off, what
 * the click listener looks for, and what hideInspectCues() cleans up.
 *
 * It carries a background and an outline and nothing else — no border, no padding, no display —
 * because the flow must lay out exactly as it does with the option switched off, and because a mark
 * that set the unit's `display` would be answering isRendered()'s question for it.
 */
const UNIT_ATTR = 'data-inspect-unit'

/** Marks the one unit Inspect is currently pointed at, so it can keep the heavier selected outline. */
const SELECTED_ATTR = 'data-inspect-selected'

// Whether the option is currently on, so a stray listener cannot act after it is switched off.
let wanted = false

// The element behind the current selection, kept so the previous one can be unmarked. The selection
// itself lives in inspect-selection.js and is a *description* of a unit, not the element.
let selectedUnit = null

/**
 * Turn the highlight on: adds the `inspect-rendered-units` body class and marks every unit the host
 * is showing, then keeps that in step with the flow. Idempotent — safe to call again.
 */
export function showInspectCues () {
  wanted = true
  document.body.classList.add('inspect-rendered-units')
  syncCues()
  watchHost()
  listen()
}

/** Reverse showInspectCues(): drops the body class, the listeners and every mark left on the host. */
export function hideInspectCues () {
  wanted = false
  unwatchHost()
  unlisten()
  document.body.classList.remove('inspect-rendered-units')
  for (const unit of document.querySelectorAll(`[${UNIT_ATTR}]`)) unit.removeAttribute(UNIT_ATTR)
  clearSelectedUnit()
}

/**
 * Bring the marks in line with what the page is rendering right now: one on every visible unit, none
 * on a unit the flow has hidden or removed. Idempotent, so it serves both as the first pass and as
 * the observer's callback.
 */
function syncCues () {
  // One read per pass: the descriptor answers both which elements are units and which of them are
  // worth marking, and reading it here rather than at module scope is what lets a host configure()
  // after this module has loaded.
  const flowDom = getConfig().flowDom

  for (const unit of document.querySelectorAll(`[${UNIT_ATTR}]`)) {
    if (unit.matches(flowDom.unitSelector) && shouldCue(unit, flowDom)) continue
    unit.removeAttribute(UNIT_ATTR)
    if (unit === selectedUnit) clearSelectedUnit()
  }

  for (const unit of document.querySelectorAll(flowDom.unitSelector)) {
    if (!shouldCue(unit, flowDom)) continue
    unit.setAttribute(UNIT_ATTR, '')
  }
}

/**
 * Whether this unit should be offering itself for inspection: worth it at all, and currently on
 * screen.
 *
 * "Worth it" is flowDom.uncuedPaths, applied by isUncued(). Some facts are constants a host splices
 * into copy all over the flow — credit-assistant's tax year turns up in headings, question labels
 * and hint text — so highlighting every occurrence would litter the page with boxes that all lead to
 * the same unconditional fact. It applies to display units only; a question *writing* one of those
 * paths is still a question worth inspecting.
 */
function shouldCue (unit, flowDom) {
  return !isUncued(flowDom, unit) && isRendered(unit)
}

/**
 * Whether the host is actually showing this unit. A question whose flow condition is false stays in
 * the document and is hidden — credit-assistant adds a `hidden` class, other hosts may use the
 * `hidden` attribute — so "in the DOM" is not "on the page". Marking one of those arms a click
 * target over nothing.
 *
 * This asks the host's cascade a question, so nothing the option puts on the page may take part in
 * answering it: a mark that set the unit's `display` would report every unit it had ever marked as
 * still on screen, and the question the flow had since hidden would keep its highlight. That is why
 * the mark carries only a background and an outline — see UNIT_ATTR and inspect.css.
 *
 * Read through the document's own view rather than the ambient `window`: these elements belong to
 * the page the marks are drawn on, which is not necessarily the global one.
 */
function isRendered (unit) {
  if (!unit.isConnected) return false
  // The browser's own answer where there is one: it also catches the ways a unit can be unrendered
  // without a `display: none` of its own — a closed <details>, `content-visibility`.
  if (typeof unit.checkVisibility === 'function') return unit.checkVisibility()

  const view = document.defaultView
  if (!view) return true
  for (let node = unit; node; node = node.parentElement) {
    if (node.hidden) return false
    if (view.getComputedStyle(node).display === 'none') return false
  }
  return true
}

// ── The click ─────────────────────────────────────────────────────────────────

let listening = false

function listen () {
  if (listening) return
  listening = true
  document.addEventListener('click', onClick)
  document.addEventListener(INSPECT_SELECT_EVENT, onSelectionChange)
  document.addEventListener(TOOL_LAYOUT_CHANGE_EVENT, onLayoutChange)
}

function unlisten () {
  if (!listening) return
  listening = false
  document.removeEventListener('click', onClick)
  document.removeEventListener(INSPECT_SELECT_EVENT, onSelectionChange)
  document.removeEventListener(TOOL_LAYOUT_CHANGE_EVENT, onLayoutChange)
}

/**
 * A click anywhere inside a marked unit selects it. Delegated, so a unit the flow reveals later is
 * live the moment it is marked; `closest()` from the target picks the innermost unit, which is what
 * an <fg-show> inside an <fg-set> needs.
 *
 * Nothing is prevented or stopped: the click is also the taxpayer choosing a radio, opening the
 * question's help accordion, or following a link, and inspection must not take that away.
 */
function onClick (event) {
  if (!wanted) return
  const unit = event.target?.closest?.(`[${UNIT_ATTR}]`)
  if (!unit) return
  markSelectedUnit(unit)
  selectRenderedUnit(describeRenderedUnit(unit))
}

/**
 * The panel can be emptied without going through a click — clearInspectSelection(), or a host
 * selecting from its own UI — so the mark follows the selection rather than only the pointer.
 */
function onSelectionChange (event) {
  if (!event.detail) clearSelectedUnit()
}

/** Closing the Inspect tool takes the selected outline with it: it points at a panel that is gone. */
function onLayoutChange () {
  if (!getLayout().on.includes('inspect')) clearSelectedUnit()
}

function markSelectedUnit (unit) {
  if (selectedUnit === unit) return
  selectedUnit?.removeAttribute(SELECTED_ATTR)
  selectedUnit = unit
  unit.setAttribute(SELECTED_ATTR, '')
}

function clearSelectedUnit () {
  selectedUnit?.removeAttribute(SELECTED_ATTR)
  selectedUnit = null
}

// ── Watching the host ─────────────────────────────────────────────────────────

// The flow shows and hides questions as facts change, and adds rows to a collection, so the marks
// cannot be a one-shot pass. Every way a host does that lands as a class, a `hidden` attribute, an
// inline style or a node insertion — which is exactly what this watches.
let observer = null

function watchHost () {
  const view = document.defaultView
  if (observer || !view?.MutationObserver) return
  observer = new view.MutationObserver(() => {
    // Detached while it re-syncs: marking a unit is itself a mutation of the tree being watched.
    observer.disconnect()
    try { syncCues() } finally { observeHost() }
  })
  observeHost()
}

function observeHost () {
  observer?.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    // `open` is in the list for <details>: the flow's accordions hold questions too.
    attributeFilter: ['class', 'hidden', 'style', 'open'],
  })
}

function unwatchHost () {
  observer?.disconnect()
  observer = null
}

// ── Reading a unit ────────────────────────────────────────────────────────────

/**
 * Read the objects behind one rendered unit off its markup.
 *
 * The three come from three different places: the fact is the element's own path attribute, the flow
 * condition is its condition/operator pair, and a text condition is a <span> carrying that same pair
 * inside its copy — which is exactly what the designs' three accordion rows are. Which attributes
 * those are is flowDom's to say.
 *
 * @param {Element} element a question or display unit, per flowDom.unitSelector
 * @returns {import('./inspect-selection.js').RenderedUnit}
 */
export function describeRenderedUnit (element) {
  const flowDom = getConfig().flowDom
  const path = element.getAttribute(flowDom.pathAttr) ?? ''
  const condition = element.getAttribute(flowDom.conditionAttr)
  const operator = element.getAttribute(flowDom.operatorAttr)
  // The first conditional phrase in the copy. A question with several is rare, and the row names one
  // object; the rest stay reachable through the "Mark conditional items" overlay.
  const text = element.querySelector(`span[${flowDom.conditionAttr}][${flowDom.operatorAttr}]`)

  return {
    title: unitTitle(element, path, flowDom),
    fact: path ? { path } : null,
    flow: condition && operator ? { path: condition, operator } : null,
    text: text
      ? {
          path: text.getAttribute(flowDom.conditionAttr),
          operator: text.getAttribute(flowDom.operatorAttr),
        }
      : null,
  }
}

/**
 * The unit's title: the question exactly as the page renders it, so it carries whatever display-unit
 * substitutions the copy contains — that is why this is read from the DOM rather than composed from
 * the dictionary. Where that copy lives, and what counts as chrome rather than content, are
 * flowDom.titleSelector and flowDom.notTitleSelector. A display unit has no question of its own, so
 * it falls back to the fact's name.
 */
function unitTitle (element, path, flowDom) {
  const question = element.querySelector(flowDom.titleSelector)
  if (question) {
    // Read from a detached copy: the required-field hint and any injected condition chips are the
    // overlay's, not the question's, and stripping them from the live DOM would erase them.
    const copy = question.cloneNode(true)
    for (const chrome of copy.querySelectorAll(flowDom.notTitleSelector)) chrome.remove()
    const text = copy.textContent.replace(/\s+/g, ' ').trim()
    if (text) return text
  }
  if (path) return factLabel(abstractPathOf(path))
  return element.tagName.toLowerCase()
}
