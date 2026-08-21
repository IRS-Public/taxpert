// Layer filtering — the M3 "per-layer toggles" seam.
//
// Where slice.js scopes the graph to a *region* (one flow page / fact file),
// this scopes it by *layer*: show or hide the flow layer, the fact layer, and
// the connectors between them, independently. It is the same kind of pure
// FGM→FGM transform as sliceGraph — it adds no data and its output still passes
// validate() — and it runs right after slicing, before toReactFlow().
//
// The three flags are the *parent* toggles of the control panel's Layers
// section: each one turns a whole layer off, and the checkboxes under it
// (facets.js) narrow whatever is left. Turning a parent off therefore leaves its
// facet selection untouched, which is what lets it come back exactly as it was.
//
// `edges` replaced a narrower `crossEdges`, which hid only the flow→fact
// connectors and had no counterpart for the two within-layer kinds — a control
// nobody could describe in one word, sitting beside two that named a layer each.
//
// Edge taxonomy by endpoint layer:
//   flow → flow   sequential / exits                  (within the flow layer)
//   flow → fact   binds / gates / shows / knocks-out / displays   (cross-layer)
//   fact → fact   depends                             (within the fact layer)

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

  // Same dangling-edge discipline as facetGraph: an edge survives only when both
  // its endpoints did — and none survives at all with the connector layer off.
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
