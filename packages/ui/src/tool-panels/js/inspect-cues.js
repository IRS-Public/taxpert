// What turning the Inspect tool on puts on the host page: every question and display unit the host
// is showing becomes hoverable and clickable. showInspectCues() and hideInspectCues() are called
// from taxpert-inspect.js's connected and disconnected callbacks, so the cues are on for exactly as
// long as the panel is mounted.
//
// The affordance is the unit itself, so nothing here builds markup. The whole treatment is a mark
// on the host's own element (UNIT_ATTR / SELECTED_ATTR) plus two rules in inspect.css.
//
// This operates on the HOST's flow DOM rather than the bundle's own subtree, which is why the
// queries are document-scoped by design. Which elements those are is the host's to describe, read
// from getConfig().flowDom at each pass and never captured.
//
// Three constraints hold throughout:
//
//   1. Switching the cues on must change nothing about how the flow lays out, so the highlight is
//      an `outline` and a `background`, never a border, a padding or a display.
//   2. The click is one delegated listener, so a unit revealed later needs no wiring. It does not
//      preventDefault: the taxpayer is still answering the question they clicked.
//   3. Only units the host is actually showing are marked, and the flow hides a question rather
//      than removing it, so this watches the host instead of making a single pass.
//
// See ../../../../../docs/internals/tool-panels.md

import { selectRenderedUnit, INSPECT_SELECT_EVENT } from './inspect-selection.js'
import { getLayout, TOOL_LAYOUT_CHANGE_EVENT } from './tool-layout.js'
import { abstractPathOf, factLabel } from './fact-definitions.js'
import { getConfig } from '../../shared/js/config.js'
import { isUncued } from '../../shared/js/flow-dom.js'

/**
 * Marks a unit currently on offer to inspect: what the hover treatment hangs off, what the click
 * listener looks for, and what hideInspectCues() cleans up. Background and outline only, per
 * constraint 1 above.
 */
const UNIT_ATTR = 'data-inspect-unit'

/** Marks the one unit Inspect is currently pointed at, so it can keep the heavier selected outline. */
const SELECTED_ATTR = 'data-inspect-selected'

// Whether the option is currently on, so a stray listener cannot act after it is switched off.
let wanted = false

// Kept so the previous selection can be unmarked. The selection itself lives in
// inspect-selection.js and is a description of a unit rather than the element.
let selectedUnit = null

/**
 * Turn the highlight on: adds the body class, marks every unit the host is showing, and keeps that
 * in step with the flow. Idempotent.
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
  // One read per pass rather than at module scope, so a host may configure() after this loads.
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
 * Whether this unit should offer itself for inspection: worth it at all, and currently on screen.
 *
 * "Worth it" is flowDom.uncuedPaths, applied by isUncued(). Some facts are constants a host splices
 * into copy all over the flow, so highlighting every occurrence would litter the page with boxes
 * that all lead to the same unconditional fact. It applies to display units only. A question
 * writing one of those paths is still worth inspecting.
 */
function shouldCue (unit, flowDom) {
  return !isUncued(flowDom, unit) && isRendered(unit)
}

/**
 * Whether the host is actually showing this unit. A question whose condition is false stays in the
 * document and is hidden, so "in the DOM" is not "on the page", and marking one arms a click target
 * over nothing.
 *
 * This asks the host's cascade a question, so nothing the option puts on the page may take part in
 * answering it. That is the reason for constraint 1: a mark that set `display` would report every
 * unit it had ever marked as still on screen.
 *
 * Read through the document's own view rather than the ambient `window`, these elements belonging
 * to the page the marks are drawn on rather than necessarily the global one.
 */
function isRendered (unit) {
  if (!unit.isConnected) return false
  // The browser's own answer where there is one. It also catches the ways a unit can be
  // unrendered without a `display: none` of its own, such as a closed <details>.
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
 * The panel can be emptied without a click, through clearInspectSelection() or a host selecting
 * from its own UI, so the mark follows the selection rather than only the pointer.
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

// The flow shows and hides questions as facts change, and adds collection rows, so the marks cannot
// be a one-shot pass. Every way a host does that lands as a class, a `hidden` attribute, an inline
// style or a node insertion, which is what this watches.
let observer = null

function watchHost () {
  const view = document.defaultView
  if (observer || !view?.MutationObserver) return
  observer = new view.MutationObserver(() => {
    // Detached while it re-syncs. Marking a unit is itself a mutation of the watched tree.
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
    // `open` is in the list for <details>, the flow's accordions holding questions too.
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
 * inside its copy, which is exactly what the designs' three accordion rows are. Which attributes
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
  // The first conditional phrase in the copy. A question with several is rare, and the row names
  // one object. The rest stay reachable through the "Mark conditional items" overlay.
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
 * substitutions the copy contains, which is why this is read from the DOM rather than composed from
 * the dictionary. Where that copy lives, and what counts as chrome rather than content, are
 * flowDom.titleSelector and flowDom.notTitleSelector. A display unit has no question of its own, so
 * it falls back to the fact's name.
 */
function unitTitle (element, path, flowDom) {
  const question = element.querySelector(flowDom.titleSelector)
  if (question) {
    // Read from a detached copy. The required-field hint and any injected condition chips belong
    // to the overlay, and stripping them from the live DOM would erase them.
    const copy = question.cloneNode(true)
    for (const chrome of copy.querySelectorAll(flowDom.notTitleSelector)) chrome.remove()
    const text = copy.textContent.replace(/\s+/g, ' ').trim()
    if (text) return text
  }
  if (path) return factLabel(abstractPathOf(path))
  return element.tagName.toLowerCase()
}
