// The single seam between data and UI.
//
// Every component reads the graph ONLY through loadGraph(). Swapping mock data
// for real data is therefore never a component change — it's a source change
// behind this function. See .env.example for VITE_FGM_SOURCE.
//
// This module fetches; apps.js and fgm.js validate. Same split on both sides, and it is what keeps
// both of those node-testable without a Vite server or a fetch polyfill.
import { validate } from './fgm.js'
import { validateRegistry } from './apps.js'

/** The app-agnostic S0 fixture. Not per-app: it is one hand-authored graph that exercises every
 *  node category and edge kind, and its job is to make fact-explorer render with no build at all. */
const MOCK = '/data/form-builder-graph.mock.json'

/** The registry, written by scripts/build-registry.mjs from the apps' own fact-explorer.app.json files. */
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

/**
 * Fetch one app's generated graph, preferring the app's own build output.
 *
 * `remote` is the Scala generator's `{basePath}/resources/form-builder-graph.json`, served by the
 * running app and reached through the dev proxy — authoritative, because it comes from the same
 * parser that generated the site. `local` is the Node generator's copy under fact-explorer's public/ —
 * the offline fallback for when the app is not running. Trying them in that order is what lets an
 * app adopt `--formBuilderGraph` with no registry change.
 */
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
  // This is what lets the Scala generator ship "facts only" while flow stays
  // mocked, then add flow, etc. — incremental de-mocking, no component edits.
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
 * Load one app's scenario index.
 *
 * Behind this seam rather than fetched in a component (agent rule 1) — it was the one place that
 * still reached for `/data/…` directly. An app with no scenarios (`scenarios: null` in its
 * descriptor, as TWE has) yields an empty list rather than a 404, so the picker is simply empty.
 *
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
