// Drill-down: the ego-network of one node (itself plus its 1st-hop neighbours and
// exactly the edges touching it), laid out radially. A pure FGM to sub-FGM stage
// whose output still passes validate().
//
// Always drills from the WHOLE graph, so neighbours outside the active slice are
// pulled in. Nothing is dimmed; the focal node is tagged __focal.
// How this relates to slice and cone: ../../../../docs/internals/fact-explorer-internals.md

const EMPTY_GRAPH_META = (graph) => ({
  version: graph.version,
  generatedAt: graph.generatedAt,
  taxYear: graph.taxYear,
  // Carried, not dropped. Each of these three stages advertises "a valid sub-FGM", and without the
  // app's declared flow tags that is only true of an app that declares none: validate() rejects a
  // tag it was not told about, so a slice of tax-withholding-estimator failed its own contract.
  // Nothing re-validated a slice in place, so it went unnoticed until FX-3 made a slice a file
  // that load.js fetches and validates like any other graph. filterGraph and facetGraph, which run
  // after these, have always carried it.
  flowTags: graph.flowTags,
})

/**
 * Reduce the full graph to the ego-network of one node.
 * @param {import('./fgm.js').FormBuilderGraph} graph  the WHOLE graph
 * @param {string} focalId                           id of the selected node
 * @returns {import('./fgm.js').FormBuilderGraph} a valid sub-FGM (the mini-graph)
 */
export function drillGraph(graph, focalId) {
  // "Immediate edges" = every edge incident to the focal node.
  const incident = graph.edges.filter((e) => e.source === focalId || e.target === focalId)

  // 1st-hop neighbours = the other endpoint of each immediate edge.
  const neighbours = new Set()
  for (const e of incident) neighbours.add(e.source === focalId ? e.target : e.source)

  const visible = new Set([focalId, ...neighbours])
  const tag = (n) => ({ ...n, __focal: n.id === focalId, __context: false })

  return {
    ...EMPTY_GRAPH_META(graph),
    flowPages: graph.flowPages, // not rendered as nodes; kept for validate()
    flowElements: graph.flowElements.filter((e) => visible.has(e.id)).map(tag),
    facts: graph.facts.filter((f) => visible.has(f.id)).map(tag),
    edges: incident,
  }
}

const NODE_W = 230
const NODE_H = 64

/**
 * Radial layout for a drill mini-graph: focal node at the centre, neighbours on a ring. Returned
 * as a position map in the saved-layout shape, so it overrides layout.js's banded placement.
 * @param {import('./fgm.js').FormBuilderGraph} drill  a drillGraph() sub-FGM
 * @param {string} focalId
 * @returns {Record<string,{x:number,y:number}>}
 */
export function egoLayout(drill, focalId) {
  const pos = {}
  // Centre the focal node's box on the origin.
  pos[focalId] = { x: -NODE_W / 2, y: -NODE_H / 2 }

  // Flow-first then facts, so questions and facts land on distinct arcs.
  const neighbours = [...drill.flowElements, ...drill.facts]
    .map((n) => n.id)
    .filter((id) => id !== focalId)

  const n = neighbours.length
  if (n === 0) return pos

  // Radius grows with neighbour count so boxes never overlap; the floor keeps a
  // small star from collapsing onto the focal node.
  const stride = 300
  const radius = Math.max(340, (n * stride) / (2 * Math.PI))

  neighbours.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2 // start at top, go clockwise
    pos[id] = {
      x: radius * Math.cos(angle) - NODE_W / 2,
      y: radius * Math.sin(angle) - NODE_H / 2,
    }
  })
  return pos
}
