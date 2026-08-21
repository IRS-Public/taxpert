// Display options — the state behind the global nav's Display button, and the host-page effects
// each option produces.
//
// These controls used to be scattered: "Show conditions" was a checkbox in the audit panel's Flow
// Inspector rail tab, and "Horizontal layout" was a checkbox in the Browse All / Path Mode toolbar.
// Both were view preferences rather than inspection, so they now live in one place — the shared
// <taxpert-display-modal> (display-modal.js), which is the only UI over this module.
//
// This module owns the state + the effects; the modal owns the presentation. Keeping them apart
// means the toolbar can re-apply the stored options on load without instantiating any modal UI.
//
// Persistence is sessionStorage (matching the audit panel's other state, and deliberately not
// localStorage: a display preference belongs to the tab you're reviewing in, not to the browser).
//
// Option effects, all reversible:
//   validationText   — force every visible question to render its required-field message
//   modalsInline     — render each modal in the page flow, under the question whose link opens it
//   expandAccordions — open every <details> on the page
//   layout           — 'stack' (one item per row) | 'wrap' (tile across the card)
//
// Several of those effects reach into the host's own flow markup, so they ask getConfig().flowDom
// which elements those are rather than assuming credit-assistant's `fg-*` tags. Read inside the
// effect, never at module scope: applyDisplayOptions() runs on every page load and mode switch, so
// a host that configure()s late still gets its own markup addressed.
//
// Inspecting rendered units is not one of these options any more — it used to be, but a hover/click
// treatment that had to be switched on separately from the Inspect tool it fed was one control too
// many. It now turns on and off with the tool itself: see inspect-cues.js's showInspectCues() /
// hideInspectCues(), called from taxpert-inspect.js's connected/disconnectedCallback.

import { getConfig } from '../../shared/js/config.js'
import { storageKey } from '../../shared/js/storage-keys.js'

// Called at each read and write, never captured in a module-scope const: this module is imported
// before the host calls configure(), so a captured key would pin the default 'taxpert:' prefix
// forever and a host's own namespace would silently never take effect.
//
// A host that adopts a storagePrefix therefore drops back to the default display options once, on
// the next load. That is accepted — they are a handful of checkboxes, and migration code for them
// would outlive its usefulness by years.
/** The namespaced sessionStorage key this module reads and writes. Call it; never cache it. */
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

// ── What each destination offers ─────────────────────────────────────────────
//
// Not every option means something everywhere. The Product Experience shows one screen's questions
// in a fixed reading order, so there is no arrangement to choose. Path Mode is a reading of one
// taxpayer's route — "what did this person see, and why" — so what it offers is the annotations
// that answer *why*: the validation copy, the condition cues, and the explanations behind the links
// on the route (plus Inspect's rendered-unit cues, which are the tool's own and not an option here).
//
// Showing modals inline is one of those annotations rather than a rearrangement, which is why it is
// offered here and expanding every accordion and tiling the card are not. A modal on this route is
// the answer to "what did this link say?" — a question you can only otherwise settle by opening each
// overlay in turn and losing your place in the path. Expanding accordions and wrapping the card
// genuinely do rearrange a listing, which is Browse All's job.
//
// A destination this table says nothing about offers everything.
//
// **An option a destination does not offer is applied at its DEFAULT, not at its stored value.** The
// stored value survives — switch back to Browse All and your wrap layout is still there — but a
// control that is not on screen must not still be moving the page underneath it. Stack is the
// layout default, which is why Path Mode always stacks.
const MODE_OPTIONS = new Map([
  ['product', ['validationText', 'modalsInline', 'expandAccordions']],
  ['path', ['validationText', 'modalsInline']],
])

/**
 * The destination being displayed: 'product' | 'browse' | 'path'. Read off the screens toolbar,
 * the only element that knows — one generated page serves Browse All and Path Mode, told apart by
 * `?mode=path`. Read at call time, never cached: applyDisplayOptions() runs from the toolbar's own
 * init, by which point the element has upgraded and can answer.
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

// The screen-listing destinations (Browse All / Path Mode) exist to show every question at once, so
// they open every <details> by default the way they always have. The Product Experience is a real
// walkthrough, where a collapsed accordion is the intended design — so there the default is off.
// Once the user touches the checkbox their choice is stored and wins in both places.
//
// Asked of the destination rather than of the page's markup: the test used to be "is there a
// <taxpert-screens-toolbar> on the page?", which stopped meaning "this is a listing" the moment the
// Product Experience grew the same sub-nav bar — and silently opened every accordion in the
// walkthrough the accordions were designed for.
function resolveExpandAccordions (stored) {
  if (typeof stored === 'boolean') return stored
  return displayMode() !== 'product'
}

// ── Individual effects ────────────────────────────────────────────────────────

// Validation copy is normally only reachable by trying to navigate past an unanswered question.
// Asking each question element to validate itself surfaces that copy in place for review; clearing
// calls the element's own teardown so the aria-describedby/error classes come back off cleanly.
//
// validateRequiredFields()/clearValidationError() are optional — a host whose questions don't
// implement them gets a no-op rather than an error, which is why both are called optionally.
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
// A flow authors its overlays at the foot of the page — after every <section>, which is where the
// scaffold's schema requires them — so making them visible in place is only half the job: on their
// own they pile up in a block at the bottom of the screen, several questions away from the copy they
// explain. Inline mode renders each one under the question that links to it, and takes it back down
// when the option goes off. That is the same placement in all three destinations, because all three render
// the same page content: the Product Experience one screen at a time, Browse All and Path Mode with
// every screen on one page.
//
// The pairing is by *link*, never by declaration order: whichever question contains the link
// pointing at an overlay's id is the question it belongs under. A link that is not inside a question
// anchors to the block it sits in, so the overlay lands under the sentence that mentions it.
//
// **What is placed is always a copy, and the authored overlay never moves.** This is the whole of
// what keeps inline mode from breaking the overlay it is rendering. An element can only be in one
// place at a time, and `showModal()` lifts it into the top layer — so an overlay that had been
// *moved* under its question vanished from the page the moment you clicked its link and popped back
// when you closed it, a flicker with no explanation from the reader's side. Worse, the marker that
// tells the stylesheet "render this in the flow" travelled with it: the thing in the top layer was
// still `position: static; inset: auto` with its close button hidden, so the opened overlay landed
// off-centre and had no [X]. Leaving the original where the flow authored it means the link opens
// exactly the overlay it always opened, dressed by the host's own modal CSS, while the inline copy
// sits still underneath the backdrop.
//
// The copy is stripped of every id — the original is the one the link opens and the one the host's
// own scripts reach for, and a duplicate id would make `getElementById` a coin toss. Being a
// `<dialog>` with no `open` attribute, the original stays invisible where it sits; only the copy
// carries `data-taxpert-modal-inline`, which is what the stylesheet renders.
//
// Two further consequences of pairing by link, each of them the point rather than a side effect:
//
//   - **One overlay, several questions.** Four of credit-assistant's modals are linked from two
//     questions on the same page ("What counts as a valid Social Security Number?" is asked of both
//     filers), and inline mode has to put a copy under each — a reviewer reading question two should
//     not have to scroll back to question one. Copying per link gives that for free.
//   - **An overlay nothing links to is left alone.** credit-assistant's tax-year change confirmation
//     is opened by its own JS, never by a link, and it is not an explanation of any question — so
//     there is no question to put it under, and rendering it in the flow would leave a stray box at
//     the foot of the page (the thing this feature exists to get rid of). No link means no copy,
//     which is why the stylesheet's inline treatment is keyed to `[data-taxpert-modal-inline]`
//     rather than to every `dialog` on the page.
//
// **Nothing is placed twice.** applyDisplayOptions() re-runs on every load and mode switch, so each
// link is placed once and remembered (`placedLinks`); a link that arrives later — a collection row
// materializing — is picked up by the next run. Restoring is a deletion: the copies go, and nothing
// has to be put back.
//
// Being *shown with* its question is the stylesheet's half, not this one's: `data-taxpert-modal-inline`
// marks what has been placed, and display-modal.css hides one whose immediately-preceding question is
// conditioned out (`.hidden`) or truncated away by Path Mode (`.off-path`). Doing it there rather
// than here means nothing has to re-run when a condition flips or the path cursor moves — a placed
// copy is always the element right after its anchor, which is a selector.

/** The inline copies on the page, which restoring deletes outright. */
const modalCopies = new Set()

/** Links already placed, so a re-run does not stack a second copy under the same question. */
let placedLinks = new WeakSet()

// The overlay a link points at. Scoped to the link's own screen where there is one: Browse All puts
// every page in one document, so an id that is unique per page need not be unique on that page.
function modalFor (link, flowDom) {
  const id = link.getAttribute(flowDom.modalLinkAttr)
  if (!id) return null
  const scope = link.closest(flowDom.screenSelector) ?? document
  const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(id) : id.replace(/["\\]/g, '\\$&')
  return scope.querySelector(`${flowDom.modalTag}[id="${escaped}"]`)
}

// The copy that sits under the question. Every id inside it is dropped (see above), and `open` with
// them: a copy is page content, never an overlay, and one cloned mid-open would otherwise arrive
// claiming to be a dialog that is showing.
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

// A collection row's questions — and the links inside them — live in an <fg-collection>'s <template>
// until a row is added, so they are genuinely not on the page to place. Re-run when one arrives, the
// same trigger and the same one-binding-per-control shape the condition cues use above. On the next
// tick, because the row is rendered by the host's own click handler and this one may run first.
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
 * Push the stored options onto the host page. Safe to call repeatedly — every effect is a
 * set-to-current-state, not a toggle. Call it once the page's flow elements exist (the screens
 * toolbar does so on its deferred init, the audit panel from enable()).
 */
export function applyDisplayOptions (options = getDisplayOptions()) {
  // An option this destination offers no control for is applied at its default — see MODE_OPTIONS.
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
