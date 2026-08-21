// The tool-panels bundle's template files. Same shape as audit-panel/js/templates.js: one module so
// each file is fetched exactly once and every element in the bundle awaits the same memoized
// promise.
//
// `new URL('../templates/…', import.meta.url)` is the one form both consumers resolve: in
// credit-assistant it lands on the vendored mirror's own templates/ dir (copy-shared-ui copies
// bundle dirs recursively), and Vite rewrites it into an emitted asset for a bundled host.

import { loadTemplates, templateUrl } from '../../shared/js/templates.js'
import { loadModalShell } from '../../shared/js/modal-shell.js'

const FILES = [
  'tools-modal.html',
  'tool-panel.html',
  'tool-dock.html',
  'watchlist.html',
  'outcome-tracker.html',
  'inspect.html',
  'overrides.html',
]

const DEFAULT_URLS = new Map(
  FILES.map((file) => [file, new URL(`../templates/${file}`, import.meta.url)])
)

/**
 * Fetch (once) one of the bundle's template files, honouring a `templates-base` override on
 * `element`.
 * @param {string} file basename from FILES
 * @param {Element} [element] the custom element asking, if it may carry templates-base
 */
export function loadBundleTemplates (file, element) {
  const fallback = DEFAULT_URLS.get(file)
  if (!fallback) return Promise.reject(new Error(`taxpert: unknown template file ${file}`))
  return loadTemplates(templateUrl(element, fallback, file))
}

/** The Tools modal's own markup plus the shared <dialog> shell it clones. */
export const loadToolsModalTemplates = (element) =>
  Promise.all([loadBundleTemplates('tools-modal.html', element), loadModalShell()])

/** The panel chrome and the three stub tool bodies. */
export const loadToolPanelTemplates = (element) =>
  loadBundleTemplates('tool-panel.html', element)

/** The dock, its columns, splitters and drop indicator — plus the panel markup it fills them with. */
export const loadToolDockTemplates = (element) =>
  Promise.all([loadBundleTemplates('tool-dock.html', element), loadToolPanelTemplates(element)])

/**
 * The Inspect body: its empty state, accordion rows, the two detail shapes and the host-page cue.
 *
 * Called with no element by inspect-cues.js, which runs out in the flow DOM rather than from inside
 * a component — there is nothing there to carry a `templates-base` override, and the default URL is
 * the right one.
 */
export const loadInspectTemplates = (element) =>
  loadBundleTemplates('inspect.html', element)

/** The Outcome tracker body: its determination accordions, section headings and fact rows. */
export const loadOutcomeTrackerTemplates = (element) =>
  loadBundleTemplates('outcome-tracker.html', element)

/** The Watchlist body, its rows, and the combo box its Add fact dialog is built from. */
export const loadWatchlistTemplates = (element) =>
  loadBundleTemplates('watchlist.html', element)

/** The Add fact dialog: the Watchlist's own markup plus the shared <dialog> shell. */
export const loadAddFactModalTemplates = (element) =>
  Promise.all([loadWatchlistTemplates(element), loadModalShell()])

/** The Overrides tool's body: its rows, its empty state, and the hint above them. */
export const loadOverridesTemplates = (element) =>
  loadBundleTemplates('overrides.html', element)
