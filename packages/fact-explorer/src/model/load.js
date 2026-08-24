// The only place the SPA fetches a graph, a registry or a scenario index. Every
// component reads through loadGraph(), so changing data source is never a component
// change. Mode comes from VITE_FGM_SOURCE (see .env.example).
//
// This module fetches; apps.js and fgm.js validate.
// Source precedence and the overlay merge: ../../../../docs/internals/fact-explorer-internals.md
import { validate } from './fgm.js'
import { validateRegistry } from './apps.js'

/** Hand-authored, app-agnostic fixture exercising every node category and edge kind. */
const MOCK = '/data/form-builder-graph.mock.json'

/** Written by scripts/build-registry.mjs from the apps' own fact-explorer.app.json files. */
const REGISTRY = '/data/apps.json'

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`)
  return res.json()
}

const EMPTY = { flowPages: [], flowElements: [], facts: [], edges: [] }

// Real edges win; mock edges are kept only if no real edge shares their id.
function mergeEdges(mockEdges = [], realEdges = []) {
  if (!realEdges.length) return mockEdges
  const realIds = new Set(realEdges.map((e) => e.id))
  return [...mockEdges.filter((e) => !realIds.has(e.id)), ...realEdges]
}

let registryPromise = null

/**
 * Load + validate the app registry. Memoized: it is fetched once per session.
 * @returns {Promise<import('./apps.js').FactExplorerRegistry>}
 */
export function loadRegistry() {
  if (!registryPromise) {
    registryPromise = fetchJson(REGISTRY)
      .then(validateRegistry)
      .catch((err) => {
        registryPromise = null // let the next attempt retry rather than caching a rejection
        throw new Error(
          `${err.message}\nRun \`npm run build-registry\` — it discovers every fact-explorer.app.json in the apps directory (FORM_BUILDER_APPS_DIR, else <repo root>/apps).`
        )
      })
  }
  return registryPromise
}

/** Fetch one app's generated graph: `remote` (served by the running app) first, then `local`. */
async function fetchAppGraph(app) {
  for (const url of [app.fgm?.remote, app.fgm?.local].filter(Boolean)) {
    try {
      return await fetchJson(url)
    } catch (err) {
      console.warn(`[FGM] ${app.id}: ${err.message}`)
    }
  }
  return null
}

/**
 * Load + validate one app's Form Builder Graph.
 * Modes (VITE_FGM_SOURCE): "mock" (default) | "real" | "overlay".
 * @param {import('./apps.js').FactExplorerApp} [app] omitted only in "mock" mode
 * @returns {Promise<import('./fgm.js').FormBuilderGraph>}
 */
export async function loadGraph(app) {
  const mode = import.meta.env.VITE_FGM_SOURCE ?? 'mock'

  const mock = await fetchJson(MOCK)
  if (mode === 'mock' || !app) return validate(mock)

  const real = await fetchAppGraph(app)
  if (!real) {
    console.warn(`[FGM] ${app.id}: no generated graph available, falling back to the mock fixture`)
    return validate(mock)
  }
  if (mode === 'real') return validate({ ...EMPTY, ...real })

  // overlay: take whichever slices "real" provides; fall back to mock per-slice.
  return validate({
    version: real.version ?? mock.version,
    generatedAt: real.generatedAt ?? mock.generatedAt,
    taxYear: real.taxYear ?? mock.taxYear,
    flowTags: real.flowTags ?? mock.flowTags,
    flowPages: real.flowPages?.length ? real.flowPages : mock.flowPages,
    flowElements: real.flowElements?.length ? real.flowElements : mock.flowElements,
    facts: real.facts?.length ? real.facts : mock.facts,
    edges: mergeEdges(mock.edges, real.edges),
  })
}

/**
 * Load one app's scenario index. An app with no scenarios yields an empty list, not a 404.
 * @param {import('./apps.js').FactExplorerApp} app
 * @returns {Promise<Array<object>>}
 */
export async function loadScenarioIndex(app) {
  if (!app?.scenarios?.index) return []
  try {
    return await fetchJson(app.scenarios.index)
  } catch {
    return []
  }
}
