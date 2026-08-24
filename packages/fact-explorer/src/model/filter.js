// Scope the graph by layer: the flow layer, the fact layer and the connectors
// between them, each dropped whole. A pure FGM to sub-FGM stage that runs right
// after slicing. The three flags are the parent toggles of the Layers control, and
// turning one off leaves its facet selection (facets.js) untouched.
//
// Edge taxonomy by endpoint layer: ../../../../docs/internals/fact-explorer-internals.md

export const DEFAULT_FILTERS = { flow: true, facts: true, edges: true }

const metaOf = (graph) => ({
  version: graph.version,
  generatedAt: graph.generatedAt,
  taxYear: graph.taxYear,
})

/**
 * Drop whole node layers and/or every connector between what is left.
 * @param {import('./fgm.js').FormBuilderGraph} graph
 * @param {{flow?:boolean, facts?:boolean, edges?:boolean}} [filters]
 * @returns {import('./fgm.js').FormBuilderGraph} a valid sub-FGM
 */
export function filterGraph(graph, filters = DEFAULT_FILTERS) {
  const { flow = true, facts = true, edges: keepEdges = true } = filters
  if (flow && facts && keepEdges) return graph

  const keptFlow = flow ? graph.flowElements : []
  const keptFacts = facts ? graph.facts : []
  const present = new Set([...keptFlow.map((e) => e.id), ...keptFacts.map((f) => f.id)])

  // An edge survives only when both endpoints did, and none at all with `edges` off.
  const edges = keepEdges
    ? graph.edges.filter((e) => present.has(e.source) && present.has(e.target))
    : []

  return {
    ...metaOf(graph),
    flowPages: graph.flowPages,
    flowElements: keptFlow,
    facts: keptFacts,
    edges,
  }
}
