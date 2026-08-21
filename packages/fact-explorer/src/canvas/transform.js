// FGM -> React Flow nodes/edges, plus the hybrid layout (M6).
//
// Flow elements and facts become color-coded nodes; container elements
// (fg-collection / fg-detail) become 'fgmFrame' group backdrops. Positions come
// from layout.js (document-order flow columns + a dagre fact DAG). Search match
// state (M6 / 6a) is folded onto node.data here from a precomputed id set, so it
// rides alongside the M2 __context dimming flag.
import { categoryOf, EDGE_STYLE, NODE_SHAPE } from './style.js'
import { layoutGraph } from './layout.js'

const NODE_W = 230

function nodeLabel(n) {
  if (n.__kind === 'fact') {
    const type = n.typeNode ? ` · ${n.typeNode}` : ''
    return { title: n.name || n.path, subtitle: `${n.path}${type}` }
  }
  // flow element
  const title =
    n.questionText?.slice(0, 60) || n.headingText?.slice(0, 60) || n.alert?.alertKey || n.tag
  const subtitle = n.factPath || n.condition?.factPath || n.tag
  return { title, subtitle }
}

/**
 * Build raw (unpositioned) React Flow nodes from the FGM.
 * @param {object} search { matchIds:Set<string>, active:boolean }
 */
function toRfNodes(graph, search) {
  const flow = graph.flowElements.map((e) => ({ ...e, __kind: 'flow' }))
  const facts = graph.facts.map((f) => ({ ...f, __kind: 'fact' }))
  const nodes = [...flow, ...facts].map((n) => {
    const category = categoryOf(n)
    const { title, subtitle } = nodeLabel(n)
    const frame = NODE_SHAPE[category] === 'frame'
    const match = search.matchIds.has(n.id)
    return {
      id: n.id,
      type: frame ? 'fgmFrame' : 'fgm',
      // __context (set by sliceGraph) marks +1-hop neighbors; match/searchDim
      // (M6) mark search hits / the rest under an active query — both dim/emphasise
      // without changing the graph.
      data: {
        title,
        subtitle,
        category,
        raw: n,
        context: !!n.__context,
        // __focal (drillGraph/coneGraph) marks the focus node; __hub (coneGraph)
        // marks a railed high-fan-in shared input. Both emphasise via node.data,
        // same as match/__context — they never change the graph.
        focal: !!n.__focal,
        hub: !!n.__hub,
        match,
        searchDim: search.active && !match,
      },
      position: { x: 0, y: 0 },
    }
  })
  // Frames first so they paint behind their (non-parented) children.
  return nodes.sort((a, b) => (a.type === 'fgmFrame' ? 0 : 1) - (b.type === 'fgmFrame' ? 0 : 1))
}

function toRfEdges(graph) {
  // An edge touching a context node is itself context (dimmed): it tells us how
  // the focus set reaches out, but shouldn't compete with in-focus edges.
  const contextIds = new Set(
    [...graph.flowElements, ...graph.facts].filter((n) => n.__context).map((n) => n.id)
  )
  return graph.edges.map((e) => {
    const sty = EDGE_STYLE[e.kind] ?? EDGE_STYLE.sequential
    const labelBits = [e.kind, e.operator, e.via].filter(Boolean)
    const context = contextIds.has(e.source) || contextIds.has(e.target)
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: labelBits.join(' · '),
      animated: sty.animated && !context,
      style: {
        stroke: sty.stroke,
        strokeWidth: 1.5,
        strokeDasharray: sty.dashed ? '5 4' : undefined,
        strokeOpacity: context ? 0.4 : (sty.strokeOpacity ?? 1),
      },
      labelStyle: { fontSize: 10, fill: sty.stroke, opacity: context ? 0.4 : 1 },
      labelBgStyle: { fill: '#fff', fillOpacity: 0.8 },
    }
  })
}

/**
 * @param {import('../model/fgm.js').FormBuilderGraph} graph
 * @param {Record<string,{x:number,y:number}>} [savedLayout] manual positions to overlay
 * @param {{matchIds?:Set<string>, active?:boolean}} [search] M6 search highlight state
 * @param {'vertical'|'horizontal'} [orientation] banded-layout flow direction
 */
export function toReactFlow(graph, savedLayout = {}, search = {}, orientation = 'vertical') {
  const s = { matchIds: search.matchIds ?? new Set(), active: !!search.active }
  const edges = toRfEdges(graph)
  const nodes = layoutGraph(graph, toRfNodes(graph, s), edges, savedLayout, orientation)
  return { nodes, edges }
}

export { NODE_W }
