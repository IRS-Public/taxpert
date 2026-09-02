// The global-nav bundle's template file.
//
// Kicked off at import so the fetch is in flight before the element upgrades — unless the host has
// already put the markup on the page, in which case there is nothing to fetch. getTemplate()
// resolves a hosted `<template id>` ahead of the fetched registry, so when all five are there the
// request buys nothing and its round trip is pure latency in front of the bar's first render. The
// four Form Builder applications take that path, inlining the five templates into their generated
// <head> (see each app's fragments/workspace-head.html, and `make validate-nav-templates`).
//
// The fetch stays for hosts that do not server-render, which is not a hypothetical: Fact Explorer
// imports this bundle through Vite into a page whose <head> it does not write.

import { loadTemplates, templateUrl, hasTemplate } from '../../shared/js/templates.js'

const FILE = 'global-nav.html'
const DEFAULT_URL = new URL(`../templates/${FILE}`, import.meta.url)

/**
 * Every template id <taxpert-global-nav> clones, in the order the render reaches them. All five have
 * to resolve — the render throws on the first one missing — so a host that supplies four of them has
 * not supplied them, and this list is what says so in one place rather than five call sites.
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
 * its own `templates-base` — the two say contradictory things, and the copy already on the page is
 * the one getTemplate() is going to return.
 */
export function loadNavTemplates (element) {
  if (navTemplatesHosted()) return Promise.resolve()
  return loadTemplates(templateUrl(element, DEFAULT_URL, FILE))
}
