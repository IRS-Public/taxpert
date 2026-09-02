// The only place the SPA fetches a graph, a shard, a registry or a scenario index. Every
// component reads through these, so changing data source is never a component change. Mode comes
// from VITE_FGM_SOURCE (see .env.example).
//
// Three graph entry points since FX-3, and which one a caller wants is a question about scope:
//
//   loadShardIndex(app)   the picker's options and the default selection, ~4 KB, no graph at all
//   loadSlice(app, key)   the sub-FGM for one selection — tens of KB, and all the canvas needs
//   loadGraph(app)        the whole thing, for the features that genuinely read across it:
//                         search totals, the scenario overlay, cone, drill, Full graph
//
// Each of the first two returns null when this app has no shards — the mock fixture, or an app
// serving its own graph — and the caller falls back to loadGraph, which is what every caller did
// before the shards existed.
//
// This module fetches; apps.js and fgm.js validate.
// Source precedence and the overlay merge: ../../../../docs/internals/fact-explorer-internals.md
import { validate } from './fgm.js'
import { validateRegistry } from './apps.js'
import { SHARD_DIR, SHARD_INDEX, shardEntry } from './shard.js'

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
 * Load + validate one app's whole Form Builder Graph.
 * Modes (VITE_FGM_SOURCE): "mock" (default) | "real" | "overlay".
 *
 * Memoized per app, because FX-3 turned this from the one thing every session fetched at startup
 * into the thing fetched when a feature needs the whole graph — search across everything, the
 * scenario overlay, cone, drill, Full graph. Those arrive in any order and more than once.
 *
 * @param {import('./apps.js').FactExplorerApp} [app] omitted only in "mock" mode
 * @returns {Promise<import('./fgm.js').FormBuilderGraph>}
 */
export function loadGraph(app) {
  const cacheKey = app?.id ?? '__mock__'
  if (!wholeCache.has(cacheKey)) {
    wholeCache.set(
      cacheKey,
      fetchWholeGraph(app).catch((err) => {
        wholeCache.delete(cacheKey) // let the next attempt retry rather than caching a rejection
        throw err
      })
    )
  }
  return wholeCache.get(cacheKey)
}

/** Whole-graph promises, one per app. See loadGraph. */
const wholeCache = new Map()

async function fetchWholeGraph(app) {
  const mode = import.meta.env.VITE_FGM_SOURCE ?? 'mock'

  // FX-4: the fixture is fetched by the branches that read it, not ahead of them. Hoisted, it put
  // a serial round trip in front of the real graph's several megabytes on every load in every
  // mode — including "real", which never looks at it.
  if (mode === 'mock' || !app) return validate(await fetchJson(MOCK))

  const real = await fetchAppGraph(app)
  if (!real) {
    console.warn(`[FGM] ${app.id}: no generated graph available, falling back to the mock fixture`)
    return validate(await fetchJson(MOCK))
  }
  if (mode === 'real') return validate({ ...EMPTY, ...real })

  // overlay: take whichever slices "real" provides; fall back to mock per-slice.
  const mock = await fetchJson(MOCK)
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
 * The directory a graph file lives in, so a shard URL can be built from the same descriptor entry
 * the whole graph comes from. `/data/twe/form-builder-graph.json` -> `/data/twe`.
 */
const dirOf = (url) => url.slice(0, url.lastIndexOf('/'))

/** Shard index promises, one per app+source. A miss is memoized as null: it is a 404, not a retry. */
const indexCache = new Map()

/**
 * Load one app's shard index (FX-3), or null when it has none.
 *
 * Null is the ordinary answer, not a failure. Only the local generator writes shards; an app
 * serving its own `form-builder-graph.json` (the Scala --formBuilderGraph path) does not, and nor
 * does the mock fixture. Every caller falls back to the whole graph, which is what the loader did
 * for all of them before this existed.
 *
 * @param {import('./apps.js').FactExplorerApp} [app]
 * @returns {Promise<{index: object, base: string}|null>}
 */
export function loadShardIndex(app) {
  const local = app?.fgm?.local
  if (!local || (import.meta.env.VITE_FGM_SOURCE ?? 'mock') === 'mock') return Promise.resolve(null)
  if (!indexCache.has(local)) {
    const base = dirOf(local)
    indexCache.set(
      local,
      fetchJson(`${base}/${SHARD_DIR}/${SHARD_INDEX}`)
        .then((index) => ({ index, base }))
        .catch(() => null)
    )
  }
  return indexCache.get(local)
}

/**
 * Load the sub-FGM for one slice key: an index entry's file, validated like any other graph.
 *
 * Returns null when this app has no shards, or none for this key — the caller then loads the whole
 * graph and slices it itself, which is the pre-FX-3 behaviour and stays correct. The "full" key
 * resolves to the whole graph's own file rather than a shard, so selecting Full graph is an
 * ordinary selection here rather than a special case.
 *
 * @param {import('./apps.js').FactExplorerApp} app
 * @param {string} key  a key from the picker (src/model/slice.js)
 * @returns {Promise<import('./fgm.js').FormBuilderGraph|null>}
 */
export async function loadSlice(app, key) {
  const found = await loadShardIndex(app)
  if (!found) return null
  const entry = shardEntry(found.index, key)
  if (!entry?.file) return null
  try {
    return validate({ ...EMPTY, ...(await fetchJson(`${found.base}/${entry.file}`)) })
  } catch (err) {
    // A missing or malformed shard is a stale generation, not a dead app: say so and let the
    // caller fall back to the whole graph rather than rendering an error page.
    console.warn(`[FGM] ${app.id}: shard "${key}" unusable (${err.message}); using the whole graph`)
    return null
  }
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
