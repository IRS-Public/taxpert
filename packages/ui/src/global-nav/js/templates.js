// The global-nav bundle's template file.
//
// Kicked off at import so the fetch is in flight before the element upgrades, unless the host has
// already put the markup on the page. getTemplate() resolves a hosted `<template id>` ahead of the
// fetched registry, so when all five are there the request buys nothing. The four Form Builder
// applications take that path. The fetch stays for hosts that do not server-render, such as Fact
// Explorer. See ../../../../../docs/internals/bundled-build.md.

import { loadTemplates, templateUrl, hasTemplate } from '../../shared/js/templates.js'

const FILE = 'global-nav.html'
const DEFAULT_URL = new URL(`../templates/${FILE}`, import.meta.url)

/**
 * Every template id <taxpert-global-nav> clones, in the order the render reaches them. All five have
 * to resolve, because the render throws on the first one missing, so a host that supplies four of
 * them has supplied none. This list says that in one place rather than at five call sites.
 */
export const NAV_TEMPLATE_IDS = Object.freeze([
  'tgn-sprite',
  'tgn-bar',
  'tgn-tool',
  'tgn-group',
  'tgn-item',
])

/** Whether the page already carries every template the bar clones. */
export function navTemplatesHosted () {
  return NAV_TEMPLATE_IDS.every(hasTemplate)
}

// Module evaluation is safe to read the document from: this bundle is loaded as `type="module"`,
// which is deferred, so a host's <template> elements are parsed by the time this runs.
//
// Swallowed here. loadTemplates() drops its memo on failure, so the awaited call below refetches and
// surfaces the error to the element that actually needs the markup.
if (!navTemplatesHosted()) loadTemplates(DEFAULT_URL).catch(() => {})

/**
 * Resolve the bar's markup. A host that server-renders every template wins outright, including over
 * its own `templates-base`, because the copy already on the page is the one getTemplate() returns.
 */
export function loadNavTemplates (element) {
  if (navTemplatesHosted()) return Promise.resolve()
  return loadTemplates(templateUrl(element, DEFAULT_URL, FILE))
}
