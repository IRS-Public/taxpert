// The global-nav bundle's template file.
//
// Kicked off at import so the fetch is in flight before the element upgrades. Unlike the audit
// panel — invisible until enable() — the nav ships in production and is the first thing on the
// page, so hosts should also preload it (credit-assistant does, in fragments/head.html) and
// global-nav.css reserves the bar's height so nothing shifts when it lands.

import { loadTemplates, templateUrl } from '../../shared/js/templates.js'

const FILE = 'global-nav.html'
const DEFAULT_URL = new URL(`../templates/${FILE}`, import.meta.url)

// The rejection is swallowed here; loadTemplates() drops its memo on failure, so the awaited call
// below refetches and surfaces the error to the element that actually needs the markup.
loadTemplates(DEFAULT_URL).catch(() => {})

export function loadNavTemplates (element) {
  return loadTemplates(templateUrl(element, DEFAULT_URL, FILE))
}
