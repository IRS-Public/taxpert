// The <template> registry behind every taxpert bundle.
//
// Markup lives in real .html files — one per bundle, under that bundle's `templates/` dir — and
// elements *clone* a fragment out of them rather than building DOM element by element. Both
// consumers can reach those files without a shared build story: credit-assistant vendors each
// bundle dir wholesale (`make copy-shared-ui`) and serves it as a static asset, and Vite
// statically rewrites `new URL('../templates/<bundle>.html', import.meta.url)` into an emitted
// asset URL.
//
//   loadTemplates(url) — fetch + parse once per URL; memoized Promise, safe to call anywhere.
//   getTemplate(id)    — synchronous once the owning bundle's load has resolved; returns a fresh
//                        DocumentFragment each call.
//
// getTemplate() resolves in three steps, so a host can server-render (and, in credit-assistant's
// case, eventually `#{...}`-translate) any template just by putting a <template> with the same id
// on the page — the same handshake `fragments/audit-panel.html` already uses to pass scenario
// <option>s in:
//   1. document.getElementById(id), when it is a <template>  → the host's copy wins
//   2. the fetched bundle registry
//   3. throw, naming the id and every bundle URL loaded so far (loud failure, in the spirit of
//      CreditAssistantMessageResolver's `!!key!!`)

const registry = new Map() // template id → HTMLTemplateElement (parsed, detached)
const loads = new Map() // absolute URL string → Promise<void>

const isTemplate = (node) => node?.tagName === 'TEMPLATE' && node.content != null

/**
 * Fetch and register every `<template id="…">` in a bundle's template file. Memoized per URL, so
 * modules can kick this off at import time and elements can await it again on connect for free.
 * @param {string|URL} url
 * @returns {Promise<void>}
 */
export function loadTemplates (url) {
  const key = String(url)
  let load = loads.get(key)
  if (load) return load

  load = fetch(key)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    })
    .then((html) => {
      // The one sanctioned innerHTML in the package: parsing our own build-time asset into the
      // live document, so cloned fragments carry the right ownerDocument. A <template>'s content
      // is inert — nothing here executes — and the input is a file we ship, never host data.
      const holder = document.createElement('template')
      // eslint-disable-next-line no-restricted-syntax
      holder.innerHTML = html
      for (const template of holder.content.querySelectorAll('template[id]')) {
        registry.set(template.id, template)
      }
    })
    .catch((error) => {
      // Drop the memo so a later attempt can retry rather than replaying a cached failure.
      loads.delete(key)
      throw new Error(`taxpert: could not load templates from ${key} — ${error.message}`, {
        cause: error,
      })
    })

  loads.set(key, load)
  return load
}

/**
 * A fresh clone of the template registered (or hosted) under `id`.
 * @param {string} id
 * @returns {DocumentFragment}
 */
export function getTemplate (id) {
  const hosted = document.getElementById(id)
  if (isTemplate(hosted)) return hosted.content.cloneNode(true)

  const registered = registry.get(id)
  if (registered) return registered.content.cloneNode(true)

  const loaded = [...loads.keys()]
  throw new Error(
    `taxpert: no <template id="${id}"> on the page or in any loaded bundle ` +
      `(loaded: ${loaded.length ? loaded.join(', ') : 'none'}). ` +
      'Did the owning bundle await loadTemplates() before rendering?'
  )
}

/** Whether `id` would resolve — for optional templates a host may or may not supply. */
export function hasTemplate (id) {
  return isTemplate(document.getElementById(id)) || registry.has(id)
}

/**
 * The URL a given element should load `file` from: its `templates-base` attribute when it has one
 * (for hosts that relocate assets), otherwise the bundle's own `templates/` dir.
 * @param {Element|null} element
 * @param {string|URL} bundleUrl the bundle's default template URL
 * @param {string} file the template file's basename, used to re-resolve against an override base
 */
export function templateUrl (element, bundleUrl, file) {
  const override = element?.getAttribute?.('templates-base')
  if (!override) return String(bundleUrl)
  const base = override.endsWith('/') ? override : `${override}/`
  return String(new URL(base + file, document.baseURI))
}

/** Test seam: drop every registered template and memoized load. */
export function _resetTemplates () {
  registry.clear()
  loads.clear()
}
