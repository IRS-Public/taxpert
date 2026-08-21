// The app registry — the one place that knows which Form Builder apps exist.
//
// Fact Explorer used to *be* the credit-assistant's viewer: the EITC app's base path was spelled
// out in the Vite proxy, the nav menu, the embedded iframe and the engine loader. This module is
// what replaced all of those literals. Every `/app/…` URL in the SPA is now derived from an entry
// here.
//
// The entries come from discovery, not registration: each app repo owns a `fact-explorer.app.json`,
// and scripts/build-registry.mjs merges every one it finds in the apps directory
// (FORM_BUILDER_APPS_DIR, else <repo root>/apps) into public/data/apps.json.
//
// React-free and fetch-free on purpose, so it is node-testable (Fact Explorer's agent rule 8) —
// load.js does the fetching, this does the validating and deriving. Same split as load.js / fgm.js.

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
 * @property {string} appId           FormBuilderApp.appId — the resources directory
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
 * The nav destinations this app actually has.
 *
 * Derived from `capabilities` rather than listed, because an app built without `--allScreens` has
 * no Browse All page: offering the link anyway means a 404, and a shorter menu is a legitimate
 * taxonomy — the workspace's nav is the host's to define. Same reasoning the cookiecutter's
 * post-gen hook already applies when it prunes those two ids from `taxpert-config.html`.
 *
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
 *
 * Deliberately shaped like fgm.js's validate(): the registry is as much a contract between the
 * generator and the SPA as the graph is, and a malformed entry should fail loudly at boot rather
 * than surface later as a 404 on a URL nobody can explain.
 *
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
 * Resolve an app id against the registry.
 *
 * Returns `null` for an id that is not there, rather than falling back to the default: a typo'd or
 * stale bookmark that silently shows a *different* app is the worst outcome available here. Callers
 * render an "unknown app" state. An absent id (no segment in the URL) is a different question —
 * that is what `defaultApp` is for.
 *
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
