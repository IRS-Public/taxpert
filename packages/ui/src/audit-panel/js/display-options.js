// Display options: the state behind the global nav's Display button, and the host-page effects
// each option produces. This module owns the state and the effects, <taxpert-display-modal> owns
// the presentation. Keeping them apart lets the screens toolbar re-apply stored options on load
// without instantiating any modal UI.
//
// Persistence is sessionStorage rather than localStorage, a display preference belonging to the tab
// you are reviewing in.
//
// Several effects reach into the host's own flow markup, so they ask getConfig().flowDom which
// elements those are. Read inside the effect, never at module scope, because applyDisplayOptions()
// runs on every page load and mode switch.
//
// Inspecting rendered units is no longer one of these options. It now turns on and off with the
// Inspect tool itself, through inspect-cues.js.
//
// The option table, the per-destination rules and the expandAccordions default: ../../../../../docs/internals/audit-panel.md

import { getConfig } from '../../shared/js/config.js'
import { storageKey } from '../../shared/js/storage-keys.js'

/** The namespaced sessionStorage key this module reads and writes. Call it, never cache it. */
export function displayStorageKey () {
  return storageKey('display')
}

export const LAYOUTS = ['stack', 'wrap']

// expandAccordions has no fixed default: see resolveExpandAccordions() below.
const DEFAULTS = {
  validationText: false,
  modalsInline: false,
  expandAccordions: null,
  layout: 'stack',
}

const FIELDS = new Set(Object.keys(DEFAULTS))

export function getDisplayOptions () {
  try {
    const raw = sessionStorage.getItem(displayStorageKey())
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

// What each destination offers. One a destination does not offer is applied at its DEFAULT, not at
// its stored value: the stored value survives, but a control that is not on screen must not still
// be moving the page underneath it. A destination absent from this table offers everything.
const MODE_OPTIONS = new Map([
  ['product', ['validationText', 'modalsInline', 'expandAccordions']],
  ['path', ['validationText', 'modalsInline']],
])

/**
 * The destination being displayed. Read off the screens toolbar, the only element that knows, since
 * one generated page serves both Browse All and Path Mode. Read at call time, never cached, because
 * applyDisplayOptions() runs from the toolbar's own init once the element has upgraded.
 *
 * @returns {'product'|'browse'|'path'}
 */
export function displayMode () {
  const toolbar = document.querySelector('taxpert-screens-toolbar')
  if (!toolbar) return 'product'
  return toolbar.mode ?? 'browse'
}

/** Whether `key` is one of the options this destination offers a control for. */
export function offersDisplayOption (key, mode = displayMode()) {
  const offered = MODE_OPTIONS.get(mode)
  return !offered || offered.includes(key)
}

export function setDisplayOption (key, value) {
  if (!FIELDS.has(key)) throw new Error(`Unsupported display option: ${key}`)
  const next = { ...getDisplayOptions(), [key]: value }
  try {
    sessionStorage.setItem(displayStorageKey(), JSON.stringify(next))
  } catch { /* storage unavailable */ }
  return next
}

// The listings open every <details> by default. The Product Experience is a real walkthrough, where
// a collapsed accordion is the intended design, so there the default is off.
//
// Asked of the destination rather than of the page's markup. The test used to be "is there a
// screens toolbar on the page", which stopped meaning "this is a listing" the moment the Product
// Experience grew the same sub-nav bar.
function resolveExpandAccordions (stored) {
  if (typeof stored === 'boolean') return stored
  return displayMode() !== 'product'
}

// ── Individual effects ────────────────────────────────────────────────────────

// Validation copy is normally only reachable by trying to navigate past an unanswered question.
// Both calls are optional, so a host whose questions do not implement them gets a no-op.
function applyValidationText (on) {
  document.querySelectorAll(getConfig().flowDom.questionTag).forEach((question) => {
    try {
      if (on) {
        if (!question.classList.contains('hidden')) question.validateRequiredFields?.()
      } else {
        question.clearValidationError?.()
      }
    } catch { /* an element that hasn't upgraded yet has nothing to validate */ }
  })
}

// ── "Show modals inline": the placement half ─────────────────────────────────
//
// A flow authors its overlays at the foot of the page, so making them visible in place is only half
// the job. Inline mode renders a copy of each one under the question whose link points at it.
//
// Three rules govern this, and breaking any of them breaks the overlay it renders:
//
//   1. Pair by LINK, never by declaration order.
//   2. Place a COPY. The authored overlay never moves, because showModal() lifts an element into
//      the top layer and a moved overlay vanishes from the flow the moment its link is clicked.
//   3. Strip every id from the copy. The original is what the link opens and what the host's own
//      scripts reach for.
//
// Whether a placed copy is shown is the stylesheet's half, keyed off the question before it, so
// nothing re-runs when a condition flips or the path cursor moves.
//
// The reasoning in full, including the two consequences of pairing by link: ../../../../../docs/internals/audit-panel.md

/** The inline copies on the page, which restoring deletes outright. */
const modalCopies = new Set()

/** Links already placed, so a re-run does not stack a second copy under the same question. */
let placedLinks = new WeakSet()

// Scoped to the link's own screen where there is one. Browse All puts every page in one document,
// so an id that is unique per page need not be unique in it.
function modalFor (link, flowDom) {
  const id = link.getAttribute(flowDom.modalLinkAttr)
  if (!id) return null
  const scope = link.closest(flowDom.screenSelector) ?? document
  const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(id) : id.replace(/["\\]/g, '\\$&')
  return scope.querySelector(`${flowDom.modalTag}[id="${escaped}"]`)
}

// A copy is page content, never an overlay, so `open` is dropped along with every id. One cloned
// mid-open would otherwise arrive claiming to be a dialog that is showing.
function copyOf (modal) {
  const copy = modal.cloneNode(true)
  copy.removeAttribute('id')
  copy.removeAttribute('open')
  for (const el of copy.querySelectorAll('[id]')) el.removeAttribute('id')
  // → data-taxpert-modal-inline, which display-modal.css selects on.
  copy.dataset.taxpertModalInline = 'true'
  return copy
}

function relocateModals () {
  const flowDom = getConfig().flowDom
  const selector = `${flowDom.modalLinkSelector}[${flowDom.modalLinkAttr}]`

  for (const link of document.querySelectorAll(selector)) {
    if (placedLinks.has(link)) continue

    const modal = modalFor(link, flowDom)
    if (!modal) continue

    // A link inside the overlay it points at would anchor the overlay's own copy inside it.
    if (modal.contains(link)) continue

    const anchor = link.closest(flowDom.questionTag) ?? link.parentElement
    if (!anchor?.parentNode) continue

    placedLinks.add(link)

    const copy = copyOf(modal)
    anchor.after(copy)
    modalCopies.add(copy)
  }
}

function restoreModals () {
  for (const copy of modalCopies) copy.remove()
  modalCopies.clear()
  placedLinks = new WeakSet()
}

// A collection row's questions live in a <template> until the row is added, so they are genuinely
// not on the page to place. Re-run when one arrives, on the next tick, because the row is rendered
// by the host's own click handler and this one may run first.
function bindCollectionAdds () {
  document.querySelectorAll(getConfig().flowDom.collectionAddSelector).forEach((element) => {
    if (element.dataset.modalsInlineBound === 'true') return
    element.dataset.modalsInlineBound = 'true'
    element.addEventListener('click', () => {
      setTimeout(() => {
        if (getDisplayOptions().modalsInline) relocateModals()
      }, 0)
    })
  })
}

function applyModalsInline (on) {
  document.body.classList.toggle('display-modals-inline', on)
  if (on) {
    relocateModals()
    bindCollectionAdds()
  } else {
    restoreModals()
  }
}

function applyExpandAccordions (on) {
  document.querySelectorAll('details').forEach((d) => {
    d.open = on
  })
}

function applyLayout (layout) {
  document.body.classList.toggle('layout--horizontal', layout === 'wrap')
}

// ── Apply-all ─────────────────────────────────────────────────────────────────

/**
 * Push the stored options onto the host page. Safe to call repeatedly, every effect being a
 * set-to-current-state rather than a toggle. Call it once the page's flow elements exist.
 */
export function applyDisplayOptions (options = getDisplayOptions()) {
  // An option this destination offers no control for is applied at its default. See MODE_OPTIONS.
  const mode = displayMode()

  applyLayout(offersDisplayOption('layout', mode) ? options.layout : DEFAULTS.layout)
  applyExpandAccordions(resolveExpandAccordions(
    offersDisplayOption('expandAccordions', mode) ? options.expandAccordions : DEFAULTS.expandAccordions
  ))
  applyModalsInline(offersDisplayOption('modalsInline', mode) ? options.modalsInline : DEFAULTS.modalsInline)
  applyValidationText(offersDisplayOption('validationText', mode) ? options.validationText : DEFAULTS.validationText)
}

/** Store one option and apply just that option's effect. Used by the modal's controls. */
export function updateDisplayOption (key, value) {
  setDisplayOption(key, value)
  if (key === 'layout') applyLayout(value)
  else if (key === 'expandAccordions') applyExpandAccordions(value)
  else if (key === 'modalsInline') applyModalsInline(value)
  else if (key === 'validationText') applyValidationText(value)
}

/** The effective value of expandAccordions, with the per-destination default resolved. */
export function expandAccordionsEnabled (options = getDisplayOptions()) {
  return resolveExpandAccordions(options.expandAccordions)
}
