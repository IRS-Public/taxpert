// The graph, cut up on disk into exactly the pieces the slice picker already offers.
//
// FX-3: the loader used to fetch the whole 8.76 MB graph before the first slice could be drawn,
// even though slice.js opens by saying the graph "is too dense to read as one blob, so the UI never
// renders it whole by default". This module is the other half of that sentence — the generator
// writes one file per option in the picker, and load.js fetches the one that was picked.
//
// The invariant that makes it safe to swap a shard in for the whole graph, and the thing
// tests/shard.test.js asserts on every option of every fixture:
//
//     sliceGraph(shardFor(key), key, opts)  ===  sliceGraph(wholeGraph, key, opts)
//
// deep-equal, for both values of `opts.neighbors`. It holds because a shard IS
// `sliceGraph(whole, key, {neighbors: true})` — focus plus its one-hop ring, `__context` already
// tagged — and re-slicing that on the same key recomputes the same focus set from the same
// flowPages and finds the same ring inside it. Nothing downstream needs to know which it got.
//
// Two consequences of that identity worth stating, because they are load-bearing rather than
// incidental:
//
//   - Every shard carries the graph's FULL flowPages list, not just the pages it covers. It is
//     ~12 KB gzipped and it is what keeps the identity byte-exact: sliceGraph copies flowPages
//     through untouched, and layout.js orders the flow spine by that list. Narrowing it would put
//     a shard's pages in a different order from the whole graph's on a fact-file slice, which is a
//     visible difference in return for a rounding error.
//   - `neighbors: false` still works offline. The ring is in the file and re-slicing drops it, so
//     the toggle stays instant instead of becoming a second fetch.
//
// React-free and fetch-free, so the generator (scripts/make-static-fgm.mjs) and the vitest suite
// both run it under plain Node. load.js fetches; this module only cuts.

import { buildSliceOptions, defaultSliceKey, sliceGraph, FULL_KEY } from './slice.js'
import { defaultFacets } from './facets.js'

/** The index every sharded app directory carries, beside the shards themselves. */
export const SHARD_DIR = 'shards'
export const SHARD_INDEX = 'index.json'

/**
 * A filename for a slice key. Keys are `pagefile::<file>.xml` / `file::<file>.xml`, which are
 * mostly filename-safe already; anything else becomes `-`, and the `::` separator becomes `__` so
 * the two namespaces cannot collide after sanitising (`file::a` and `pagefile::a` do not both
 * become `a`).
 * @param {string} key
 * @returns {string}
 */
export function shardFileName(key) {
  return `${String(key)
    .replace(/::/g, '__')
    .replace(/[^A-Za-z0-9._-]/g, '-')}.json`
}

/**
 * Cut a whole graph into one sub-FGM per slice-picker option.
 *
 * The "Full graph" option gets an index entry but no file of its own: its file is the whole graph,
 * which is already on disk and which cone, drill and search need anyway. So `shards` here holds
 * only the ones that are genuinely cheaper than the whole thing.
 *
 * @param {import('./fgm.js').FormBuilderGraph} graph
 * @param {{wholeFile?: string}} [opts] name of the whole-graph file, for the index's `full` entry
 * @returns {{index: object, shards: Map<string, import('./fgm.js').FormBuilderGraph>}}
 */
export function buildShards(graph, { wholeFile = 'form-builder-graph.json' } = {}) {
  const shards = new Map()
  const entries = []

  for (const opt of buildSliceOptions(graph)) {
    if (opt.key === FULL_KEY) {
      entries.push({
        ...opt,
        file: wholeFile,
        focus: graph.flowElements.length + graph.facts.length,
        nodes: graph.flowElements.length + graph.facts.length,
        edges: graph.edges.length,
      })
      continue
    }
    const sub = sliceGraph(graph, opt.key, { neighbors: true })
    shards.set(opt.key, sub)
    const nodes = sub.flowElements.length + sub.facts.length
    entries.push({
      ...opt,
      file: `${SHARD_DIR}/${shardFileName(opt.key)}`,
      // Focus vs. nodes is the dimmed one-hop ring: the difference is the context the picker's
      // count never mentioned and the canvas has always drawn.
      focus:
        sub.flowElements.filter((e) => !e.__context).length +
        sub.facts.filter((f) => !f.__context).length,
      nodes,
      edges: sub.edges.length,
    })
  }

  const index = {
    version: 1,
    generatedAt: graph.generatedAt,
    taxYear: graph.taxYear,
    flowTags: graph.flowTags,
    _note:
      'Generated beside the whole graph by scripts/make-static-fgm.mjs. One file per slice-picker ' +
      'option; the "full" option names the whole graph. Do not edit by hand; rerun the script.',
    defaultKey: defaultSliceKey(graph),
    // The facet vocabulary of the WHOLE graph. Derived from a shard instead, a flow tag present
    // nowhere in the current slice would have no checkbox — and facets.js derives the checkbox list
    // from what the graph contains precisely so an absent tag cannot be re-selected, which is right
    // for a whole graph and wrong for one of its pieces.
    facets: defaultFacets(graph),
    wholeFile,
    shards: entries,
  }

  return { index, shards }
}

/**
 * The picker's options, read from an index rather than derived from a graph nobody fetched.
 * Same shape `buildSliceOptions` returns, because it is the shape it returned when the index was
 * written.
 * @param {object} index
 * @returns {{key:string, group:string, label:string}[]}
 */
export function sliceOptionsFromIndex(index) {
  return (index?.shards ?? []).map(({ key, group, label }) => ({ key, group, label }))
}

/**
 * The index entry for one key, or undefined. `full` resolves to the whole graph's own file, which
 * is what makes "Full graph" a normal selection rather than a special case in the loader.
 * @param {object} index
 * @param {string} key
 */
export function shardEntry(index, key) {
  return (index?.shards ?? []).find((s) => s.key === key)
}
