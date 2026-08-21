// Embedded mode — the workspace chrome stands down when the page is inside someone else's frame.
//
// Fact Explorer's side-by-side view puts a running Form Builder app in a same-origin iframe next to
// the canvas. The app renders its own workspace (global nav, tool dock, screens toolbar), so what
// you get is a workspace inside a workspace: two nav bars, two Display buttons, two sets of tools,
// none of which the outer one can drive. The product is what belongs in that frame; its chrome is
// the host's job.
//
// Detection is frame-ness, not a query parameter, because the flow *navigates*: the taxpayer
// answers a question and the frame loads the next screen at a URL the embedder never wrote. A
// parameter would survive exactly one page. `?taxpert-embed=0` / `=1` is still honoured on the
// page that carries it, for a host that wants to force either side.
//
// The effect is one class on <html> — every rule keyed to it lives in shared/styles/embedded.css —
// set from the document element rather than <body>, since this module is imported from <head>
// scripts and <body> does not exist yet.

export const EMBEDDED_CLASS = 'taxpert-embedded'

const OVERRIDE_PARAM = 'taxpert-embed'

/**
 * Whether this page is being rendered inside another page's frame.
 *
 * @param {Window} [view] the window to test; defaults to the ambient one.
 * @returns {boolean}
 */
export function isEmbedded (view = globalThis) {
  const override = new URLSearchParams(view.location?.search ?? '').get(OVERRIDE_PARAM)
  if (override === '1' || override === 'true') return true
  if (override === '0' || override === 'false') return false
  // A cross-origin top is still comparable — `window.top` is a WindowProxy, and identity is all
  // this asks of it.
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
