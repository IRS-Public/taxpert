// The <template> registry every bundle's markup is cloned out of.
//
// getTemplate(id) resolves in three steps: a <template> with that id already on the page, so a host
// can server-render an overriding or translated copy, then the fetched registry, then a throw
// naming every bundle loaded so far.
//
// See ../../../../../docs/internals/workspace-configuration.md

const registry = new Map() // template id → HTMLTemplateElement (parsed, detached)
const loads = new Map() // absolute URL string → Promise<void>

const isTemplate = (node) => node?.tagName === 'TEMPLATE' && node.content != null

/** Parse a bundle's template file and register every `<template id="…">` in it. */
function register (html) {
  // Parsed into the live document so cloned fragments carry the right ownerDocument. A
  // <template>'s content is inert, and the input is this package's own shipped asset.
  const holder = document.createElement('template')
  // eslint-disable-next-line no-restricted-syntax
  holder.innerHTML = html
  for (const template of holder.content.querySelectorAll('template[id]')) {
    registry.set(template.id, template)
  }
}

/**
 * Register a bundle's templates from markup already in hand, as though loadTemplates() had just
 * fetched `url`. The ids go in the registry and that URL is marked resolved, so an element that
 * awaits loadTemplates(url) on connect gets the memo rather than a request.
 *
 * The bundled build (scripts/build.mjs) inlines all fourteen template files and calls this for each
 * one, so a bundled host fetches no templates at all. A host that would rather fetch them never
 * calls this, and a host that overrides one with `templates-base` still fetches its own, because
 * templateUrl() hands loadTemplates a different key.
 * See ../../../../../docs/internals/bundled-build.md.
 *
 * @param {string|URL} url the URL this markup stands in for
 * @param {string} html    the template file's contents
 */
export function registerTemplates (url, html) {
  register(html)
  loads.set(String(url), Promise.resolve())
}

/**
 * Fetch and register every `<template id="…">` in a bundle's template file. Memoized per URL, so
 * modules can start it at import time and elements can await it again on connect.
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
    .then(register)
    .catch((error) => {
      // Drop the memo so a later attempt retries rather than replaying a cached failure.
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

/** Whether `id` would resolve, for optional templates a host may or may not supply. */
export function hasTemplate (id) {
  return isTemplate(document.getElementById(id)) || registry.has(id)
}

/**
 * Where an element loads `file` from: its `templates-base` attribute when it has one, otherwise the
 * bundle's own `templates/` directory.
 * @param {Element|null} element
 * @param {string|URL} bundleUrl the bundle's default template URL
 * @param {string} file the template file's basename, re-resolved against an override base
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
