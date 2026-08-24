// Category-level narrowing within a layer: by flow tag, fact kind and edge kind,
// plus a knockouts-only view. Where filter.js drops a whole layer, this narrows
// what is left. A pure FGM to sub-FGM stage; runs after filterGraph.
//
// The full narrowing chain: ../../../../docs/internals/fact-explorer-internals.md

import { FLOW_TAGS, EDGE_KINDS } from './fgm.js'

const FACT_KINDS = ['writable', 'derived']

const metaOf = (graph) => ({
  version: graph.version,
  generatedAt: graph.generatedAt,
  taxYear: graph.taxYear,
  flowTags: graph.flowTags,
})

/**
 * The flow tags this graph actually contains: built-ins in canonical order, then app-declared tags
 * alphabetically. Derived from the graph, since a tag missing here has no checkbox to bring it back.
 * @param {import('./fgm.js').FormBuilderGraph} [graph]
 * @returns {string[]}
 */
export function flowTagsOf(graph) {
  const present = new Set((graph?.flowElements ?? []).map((e) => e.tag))
  if (!present.size) return [...FLOW_TAGS]
  const builtIn = FLOW_TAGS.filter((t) => present.has(t))
  const custom = [...present].filter((t) => !FLOW_TAGS.includes(t)).sort()
  return [...builtIn, ...custom]
}

/**
 * The "everything selected" facets for a graph, the identity of `facetGraph`. Total: with no graph
 * it falls back to the built-in tag vocabulary, so callers never null-check the result.
 * @param {import('./fgm.js').FormBuilderGraph} [graph]
 */
export function defaultFacets(graph) {
  return {
    flowTags: flowTagsOf(graph),
    factKinds: [...FACT_KINDS],
    edgeKinds: [...EDGE_KINDS],
    knockoutsOnly: false,
  }
}

const hasAll = (selected, all) => all.every((x) => selected.includes(x))

/** True when the facets select everything and add no special view → fast-path. */
function isIdentity(f, base) {
  return (
    !f.knockoutsOnly &&
    hasAll(f.flowTags, base.flowTags) &&
    hasAll(f.factKinds, FACT_KINDS) &&
    hasAll(f.edgeKinds, EDGE_KINDS)
  )
}

/**
 * Narrow the graph by category-level facets.
 * @param {import('./fgm.js').FormBuilderGraph} graph
 * @param {ReturnType<typeof defaultFacets>} [facets]
 * @returns {import('./fgm.js').FormBuilderGraph} a valid sub-FGM
 */
export function facetGraph(graph, facets) {
  const base = defaultFacets(graph)
  const f = { ...base, ...facets }
  if (isIdentity(f, base)) return graph

  const flowTags = new Set(f.flowTags)
  const factKinds = new Set(f.factKinds)
  const edgeKinds = new Set(f.edgeKinds)

  let keptFlow
  let keptFacts

  if (f.knockoutsOnly) {
    const koAlertIds = new Set(
      graph.flowElements.filter((e) => e.tag === 'fg-alert' && e.alert?.knockout).map((e) => e.id)
    )
    keptFlow = graph.flowElements.filter((e) => koAlertIds.has(e.id))
    const koTargets = new Set(
      graph.edges
        .filter((e) => e.kind === 'knocks-out' && koAlertIds.has(e.source))
        .map((e) => e.target)
    )
    keptFacts = graph.facts.filter((x) => koTargets.has(x.id))
  } else {
    keptFlow = graph.flowElements.filter((e) => flowTags.has(e.tag))
    keptFacts = graph.facts.filter((x) => factKinds.has(x.kind))
  }

  const present = new Set([...keptFlow.map((e) => e.id), ...keptFacts.map((x) => x.id)])

  // Keep an edge only when both endpoints survived and its kind is still selected.
  const edges = graph.edges.filter(
    (e) => present.has(e.source) && present.has(e.target) && edgeKinds.has(e.kind)
  )

  return {
    ...metaOf(graph),
    flowPages: graph.flowPages,
    flowElements: keptFlow,
    facts: keptFacts,
    edges,
  }
}
