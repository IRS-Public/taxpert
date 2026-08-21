// Drill-down: the ego-network of a single node (M4+).
//
// When the user has a node selected and turns on "Drill down" in the detail
// panel, the canvas swaps from the current slice to a focused *mini-graph*: the
// selected node plus its 1st-hop neighbours, connected by exactly the edges that
// touch the selected node ("immediate edges"). It answers "what does THIS node
// connect to, and nothing else?" — the per-node analogue of the page/file slice.
//
// Like slice.js / filter.js / facets.js this is a pure FGM→sub-FGM stage: it adds
// no data and the sub-FGM it returns still passes validate(). It always drills
// from the WHOLE graph (not the current slice) so the ego network is complete —
// neighbours outside the active slice are pulled in.
//
// Two view-only flags ride on node.data (same idiom as __context): the focal node
// is tagged __focal (centre of the star, kept prominent even when a neighbour is
// later selected); nothing here is dimmed — every node in a drill view is
// in-focus by construction.

const EMPTY_GRAPH_META = (graph) => ({
  version: graph.version,
  generatedAt: graph.generatedAt,
  taxYear: graph.taxYear,
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
 * Radial layout for a drill mini-graph: the focal node sits at the centre and its
 * neighbours fan out on a ring around it. Returned as a position map in the same
 * shape as the saved-layout overlay, so it can be handed straight to toReactFlow()
 * and wins over layout.js's banded placement. fitView then centres the star.
 *
 * @param {import('./fgm.js').FormBuilderGraph} drill  a drillGraph() sub-FGM
 * @param {string} focalId
 * @returns {Record<string,{x:number,y:number}>}
 */
export function egoLayout(drill, focalId) {
  const pos = {}
  // Centre the focal node's box on the origin.
  pos[focalId] = { x: -NODE_W / 2, y: -NODE_H / 2 }

  // Ring the neighbours, grouped flow-first then facts (the natural slice order)
  // so questions and facts land on distinct arcs rather than interleaving.
  const neighbours = [...drill.flowElements, ...drill.facts]
    .map((n) => n.id)
    .filter((id) => id !== focalId)

  const n = neighbours.length
  if (n === 0) return pos

  // Radius grows with neighbour count so wide node boxes never overlap on the
  // ring; a floor keeps a small star from collapsing onto the focal node.
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
