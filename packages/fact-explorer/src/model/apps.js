// The app registry: which Form Builder apps this instance knows, and every `/app/…`
// URL derived from one. Entries come from discovery (scripts/build-registry.mjs
// globs each app repo's own fact-explorer.app.json), never from a list edited here.
//
// React-free and fetch-free, so it runs under plain Node in tests. load.js fetches.
// Discovery and the descriptor contract: ../../../../docs/internals/fact-explorer-internals.md

/**
 * @typedef {Object} FactExplorerAppEngine
 * @property {string} bundle      absolute URL of the Scala.js fact-graph module
 * @property {string} dictionary  absolute URL of fact-dictionary.xml
 */

/**
 * @typedef {Object} FactExplorerAppView
 * @property {string} id     a taxpert nav destination id
 * @property {string} label
 * @property {string} href   absolute, already prefixed with basePath
 */

/**
 * @typedef {Object} FactExplorerApp
 * @property {string} id              the URL segment in /fact-explorer/:id, and the registry key
 * @property {string} label
 * @property {string} appId           FormBuilderApp.appId, the resources directory
 * @property {string} basePath        FormBuilderApp.basePath, no trailing slash
 * @property {string} storagePrefix   namespaces the bridge's sessionStorage key
 * @property {number} [taxYear]
 * @property {FactExplorerAppEngine} engine
 * @property {FactExplorerAppView[]} views
 * @property {{allScreens: boolean, scenarioMode: boolean, authorMode: boolean}} capabilities
 * @property {{base: string, index: string, vocabulary: string}|null} scenarios
 * @property {{remote: string, local: string}} fgm
 * @property {string[]} customFlowTags
 */

/**
 * @typedef {Object} FactExplorerRegistry
 * @property {number} version
 * @property {string} defaultAppId
 * @property {FactExplorerApp[]} apps
 */

/** Every nav destination a fully-featured app offers, in menu order. */
const VIEW_TEMPLATES = [
  { id: 'product-experience', label: 'Product Experience', suffix: '/', capability: null },
  {
    id: 'path-mode',
    label: 'Path Mode',
    suffix: '/all-screens/?mode=path',
    capability: 'allScreens',
  },
  { id: 'browse-all', label: 'Browse All', suffix: '/all-screens/', capability: 'allScreens' },
  { id: 'authoring-suite', label: 'Authoring Suite', suffix: '/author/', capability: 'authorMode' },
]

/** Join a base path and a suffix without doubling the slash between them. */
export function appUrl(app, suffix = '') {
  const base = app.basePath.replace(/\/$/, '')
  if (!suffix) return `${base}/`
  return `${base}/${String(suffix).replace(/^\//, '')}`
}

/**
 * The nav destinations this app actually has, pruned by its declared capabilities.
 * @param {FactExplorerApp} app
 * @returns {FactExplorerAppView[]}
 */
export function viewsFor(app) {
  return VIEW_TEMPLATES.filter((v) => !v.capability || app.capabilities?.[v.capability]).map(
    (v) => ({ id: v.id, label: v.label, href: appUrl(app, v.suffix) })
  )
}

/** The two destinations the embedded iframe panel can show (Path Mode is a query on Browse All). */
export function embeddableViews(app) {
  return viewsFor(app).filter((v) => v.id === 'product-experience' || v.id === 'browse-all')
}

const isNonEmptyString = (x) => typeof x === 'string' && x.length > 0

/**
 * Validate a registry. Returns it on success; throws with a precise message on the first problem.
 * @param {any} registry
 * @returns {FactExplorerRegistry}
 */
export function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object') {
    throw new Error('registry: not an object')
  }
  if (!Array.isArray(registry.apps)) {
    throw new Error('registry: missing or non-array "apps"')
  }
  if (!registry.apps.length) {
    throw new Error(
      'registry: no apps — mount or clone a Form Builder app that carries a fact-explorer.app.json (see apps/README.md)'
    )
  }

  const seen = new Set()
  for (const app of registry.apps) {
    if (!isNonEmptyString(app?.id)) throw new Error('registry: an app has a missing/invalid id')
    if (seen.has(app.id)) throw new Error(`registry: duplicate app id "${app.id}"`)
    seen.add(app.id)
    if (!isNonEmptyString(app.basePath) || !app.basePath.startsWith('/')) {
      throw new Error(`registry: app "${app.id}" needs a basePath starting with "/"`)
    }
    if (!isNonEmptyString(app.storagePrefix)) {
      throw new Error(`registry: app "${app.id}" needs a storagePrefix`)
    }
  }

  if (!isNonEmptyString(registry.defaultAppId) || !seen.has(registry.defaultAppId)) {
    throw new Error(
      `registry: defaultAppId "${registry.defaultAppId}" does not name one of ${[...seen].join(', ')}`
    )
  }
  return registry
}

/**
 * Resolve an app id against the registry. Returns null for an unknown id (callers render an
 * "unknown app" state) rather than falling back to the default; an absent id is `defaultApp`.
 * @param {FactExplorerRegistry} registry
 * @param {string|null|undefined} id
 * @returns {FactExplorerApp|null}
 */
export function findApp(registry, id) {
  if (!id) return null
  return registry.apps.find((a) => a.id === id) ?? null
}

/** @param {FactExplorerRegistry} registry @returns {FactExplorerApp} */
export function defaultApp(registry) {
  return findApp(registry, registry.defaultAppId) ?? registry.apps[0]
}
