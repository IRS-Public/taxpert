// Embedded mode: the workspace chrome stands down when the page is inside someone else's frame.
//
// Fact Explorer's side-by-side view puts a running Form Builder app in a same-origin iframe next to
// the canvas. The app renders its own workspace, so without this you get two nav bars, two Display
// buttons and two sets of tools, none of which the outer workspace can drive.
//
// Detection is frame-ness rather than a query parameter, because the flow navigates: the next
// screen is an address the embedder never wrote, so a parameter would survive exactly one page.
//
// The effect is one class on <html>, and every rule keyed to it lives in shared/styles/embedded.css.
// It is set on the document element because this module is imported from <head> scripts, before
// <body> exists.
//
// See ../../../../../docs/internals/workspace-configuration.md

export const EMBEDDED_CLASS = 'taxpert-embedded'

const OVERRIDE_PARAM = 'taxpert-embed'

/**
 * Whether this page is being rendered inside another page's frame. `?taxpert-embed=0|1` forces
 * either answer on the page that carries it.
 *
 * @param {Window} [view] the window to test. Defaults to the ambient one.
 * @returns {boolean}
 */
export function isEmbedded (view = globalThis) {
  const override = new URLSearchParams(view.location?.search ?? '').get(OVERRIDE_PARAM)
  if (override === '1' || override === 'true') return true
  if (override === '0' || override === 'false') return false
  // A cross-origin top is still comparable, `window.top` being a WindowProxy and identity being
  // all this asks of it.
  try {
    return view.self !== view.top
  } catch {
    return true
  }
}

/**
 * Mark the document when it is embedded, so the stylesheet can stand the chrome down. Idempotent;
 * called at import time by the global nav, which every workspace host loads.
 *
 * @param {Document} [doc]
 * @param {Window} [view]
 */
export function applyEmbedded (doc = globalThis.document, view = globalThis) {
  const root = doc?.documentElement
  if (!root) return false
  const embedded = isEmbedded(view)
  root.classList.toggle(EMBEDDED_CLASS, embedded)
  return embedded
}
