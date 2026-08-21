// The audit-panel bundle's template files.
//
// One module so the fetches are kicked off exactly once, at import time — before the first element
// upgrades — and so every element in the bundle awaits the same memoized promises.
//
// `new URL('../templates/…', import.meta.url)` is the one form both consumers resolve: in
// credit-assistant it lands on the vendored mirror's own templates/ dir (copy-shared-ui copies
// bundle dirs recursively), and Vite rewrites it into an emitted asset for fact-explorer.

import { loadTemplates, templateUrl } from '../../shared/js/templates.js'
import { loadModalShell } from '../../shared/js/modal-shell.js'

const FILES = [
  'audit-panel.html',
  'scenario-modal.html',
  'display-modal.html',
  'workspace-settings-modal.html',
  'all-screens-toolbar.html',
]

// One `new URL(…, import.meta.url)` per file, written out so Vite can see each of them statically
// and emit the asset. Nothing is fetched until something asks for it: fact-explorer mounts two
// of these five, and should pay for two.
const DEFAULT_URLS = new Map(
  FILES.map((file) => [file, new URL(`../templates/${file}`, import.meta.url)])
)

/**
 * Fetch (once) one of the bundle's template files, honouring a `templates-base` override on
 * `element`. Called from connectedCallback, which follows module evaluation closely enough that a
 * separate eager kickoff buys nothing — unlike the global nav, which ships in production and
 * preloads its one file from the host's <head>.
 * @param {string} file basename from FILES
 * @param {Element} [element] the custom element asking, if it may carry templates-base
 */
export function loadBundleTemplates (file, element) {
  const fallback = DEFAULT_URLS.get(file)
  if (!fallback) return Promise.reject(new Error(`taxpert: unknown template file ${file}`))
  return loadTemplates(templateUrl(element, fallback, file))
}

/** The panel shell + rail + built-in section bodies + the <audited-fact> card. */
export const loadPanelTemplates = (element) => loadBundleTemplates('audit-panel.html', element)

/** A modal's own markup plus the shared <dialog> shell it clones. */
export const loadModalTemplates = (file, element) =>
  Promise.all([loadBundleTemplates(file, element), loadModalShell()])

export const loadToolbarTemplates = (element) =>
  loadBundleTemplates('all-screens-toolbar.html', element)
