// Rooted dependency cone: keep one output node and its transitive dependency
// ancestors, laid out as a layered tree. A pure FGM to sub-FGM stage whose output
// still passes validate(), and the readable framing for a dense fact file.
//
// A `depends` edge runs source = the fact, target = the fact it depends on, so the
// walk follows OUTGOING `depends` from the root toward its inputs.
// Why the cone exists and how ranking works: ../../../../docs/internals/fact-explorer-internals.md

// A fact depended on by at least this many other facts is a hub: a shared input
// that coneLayout pins to an inputs rail instead of placing inline.
export const HUB_FANIN_THRESHOLD = 8

// fact-to-fact dependencies plus the flow-to-fact edges that let an alert seed the
// cone or a writable show its binding question. `sequential` is excluded.
const CONE_EDGE_KINDS = new Set(['depends', 'knocks-out', 'binds', 'gates', 'shows', 'displays'])
const FLOW_FACT_ENTRY = new Set(['knocks-out', 'binds', 'gates', 'shows', 'displays'])

const NODE_W = 230
const NODE_H = 64

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

const push = (map, k, v) => {
  if (!map.has(k)) map.set(k, [])
  map.get(k).push(v)
}

/** Fact ids depended on by ≥ HUB_FANIN_THRESHOLD other facts, over the WHOLE graph. */
export function hubIds(graph, threshold = HUB_FANIN_THRESHOLD) {
  const fanIn = new Map()
  for (const e of graph.edges) {
    if (e.kind === 'depends') fanIn.set(e.target, (fanIn.get(e.target) ?? 0) + 1)
  }
  const hubs = new Set()
  for (const [id, n] of fanIn) if (n >= threshold) hubs.add(id)
  return hubs
}

/**
 * Reduce the full graph to the dependency cone of one output node.
 * @param {import('./fgm.js').FormBuilderGraph} graph  the WHOLE graph
 * @param {string} rootId                            id of the output node (fact or fg-alert)
 * @param {{maxDepth?:number, hubThreshold?:number}} [opts]  cap hops / override the hub cutoff
 * @returns {import('./fgm.js').FormBuilderGraph} a valid sub-FGM (the cone)
 */
export function coneGraph(graph, rootId, { maxDepth = Infinity, hubThreshold } = {}) {
  const factIds = new Set(graph.facts.map((f) => f.id))
  const flowIds = new Set(graph.flowElements.map((e) => e.id))

  // fact → its dependencies (outgoing `depends`)
  const depOut = new Map()
  // fact → the fg-set(s) that bind it (so a writable leaf shows its question)
  const bindsByFact = new Map()
  // flow element → the facts it reaches (entry hop when the root is an alert)
  const flowEntry = new Map()

  for (const e of graph.edges) {
    if (e.kind === 'depends' && factIds.has(e.source)) push(depOut, e.source, e.target)
    if (e.kind === 'binds') {
      if (factIds.has(e.source) && flowIds.has(e.target)) push(bindsByFact, e.source, e.target)
      else if (factIds.has(e.target) && flowIds.has(e.source)) push(bindsByFact, e.target, e.source)
    }
    if (FLOW_FACT_ENTRY.has(e.kind)) {
      if (flowIds.has(e.source) && factIds.has(e.target)) push(flowEntry, e.source, e.target)
      else if (flowIds.has(e.target) && factIds.has(e.source)) push(flowEntry, e.target, e.source)
    }
  }

  const successors = (id) => {
    // Only the ROOT flow node expands into facts; a binding question reached mid-walk
    // is terminal, so the cone never bleeds through that question's other facts.
    if (factIds.has(id)) return [...(depOut.get(id) ?? []), ...(bindsByFact.get(id) ?? [])]
    if (id === rootId && flowIds.has(id)) return flowEntry.get(id) ?? []
    return []
  }

  // Breadth-first walk toward dependencies, bounded by maxDepth.
  const visible = new Set([rootId])
  let frontier = [rootId]
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next = []
    for (const id of frontier) {
      for (const s of successors(id)) {
        if (!visible.has(s)) {
          visible.add(s)
          next.push(s)
        }
      }
    }
    frontier = next
  }

  const hubs = hubIds(graph, hubThreshold)
  const tag = (n) => ({
    ...n,
    __focal: n.id === rootId,
    __hub: hubs.has(n.id) && n.id !== rootId,
    __context: false,
  })

  return {
    ...EMPTY_GRAPH_META(graph),
    flowPages: graph.flowPages, // not rendered as nodes; kept for validate()
    flowElements: graph.flowElements.filter((e) => visible.has(e.id)).map(tag),
    facts: graph.facts.filter((f) => visible.has(f.id)).map(tag),
    edges: graph.edges.filter(
      (e) => CONE_EDGE_KINDS.has(e.kind) && visible.has(e.source) && visible.has(e.target)
    ),
  }
}

const MAIN_STRIDE = 150 // distance between ranks (root → leaves)
const CROSS_STRIDE = 270 // distance between siblings within a rank

// Orient an edge root->leaf so ranks increase toward the inputs. A `binds` edge is
// flipped so a writable's question sits one rank deeper than the writable.
function orient(e, flowIds) {
  if (e.kind === 'depends') return [e.source, e.target]
  const flowEnd = flowIds.has(e.source) ? e.source : e.target
  const factEnd = flowIds.has(e.source) ? e.target : e.source
  return e.kind === 'binds' ? [factEnd, flowEnd] : [flowEnd, factEnd]
}

/**
 * Layered layout for a cone: rank is the longest dependency distance from the root, each rank
 * ordered by its parents' barycentre, hubs lifted into a rail past the deepest rank. Returned as
 * a position overlay in the same shape as egoLayout.
 * @param {import('./fgm.js').FormBuilderGraph} cone  a coneGraph() sub-FGM
 * @param {string} rootId
 * @param {'vertical'|'horizontal'} [orientation]
 * @returns {Record<string,{x:number,y:number}>}
 */
export function coneLayout(cone, rootId, orientation = 'vertical') {
  const nodes = [...cone.flowElements, ...cone.facts]
  const flowIds = new Set(cone.flowElements.map((e) => e.id))
  const isHub = new Map(nodes.map((n) => [n.id, !!n.__hub]))

  // Directed root→leaf adjacency + predecessors, from the cone's own edges.
  const succ = new Map()
  const preds = new Map()
  for (const e of cone.edges) {
    const [from, to] = orient(e, flowIds)
    push(succ, from, to)
    push(preds, to, from)
  }

  // Longest-path rank from the root (DAG → relaxation, bounded by node count).
  const rank = new Map(nodes.map((n) => [n.id, 0]))
  for (let i = 0; i < nodes.length; i++) {
    let changed = false
    for (const n of nodes) {
      for (const to of succ.get(n.id) ?? []) {
        const cand = rank.get(n.id) + 1
        if (cand > rank.get(to)) {
          rank.set(to, cand)
          changed = true
        }
      }
    }
    if (!changed) break
  }

  // Split into non-hub ranks + a hub rail one column past the deepest non-hub rank.
  const byRank = new Map()
  let maxRank = 0
  for (const n of nodes) {
    if (isHub.get(n.id)) continue
    const r = rank.get(n.id)
    push(byRank, r, n.id)
    if (r > maxRank) maxRank = r
  }
  const railRank = maxRank + 1
  const hubRailIds = nodes.filter((n) => isHub.get(n.id)).map((n) => n.id)

  const pos = {}
  const orderIndex = new Map()

  // Vertical: (x = cross, y = main). Horizontal: (x = main, y = cross). Offset to
  // centre each box, since React Flow positions are top-left.
  const place = (main, cross) => {
    const [x, y] = orientation === 'horizontal' ? [main, cross] : [cross, main]
    return { x: x - NODE_W / 2, y: y - NODE_H / 2 }
  }

  // Barycentre of a node's already-placed parents; unplaced → trail to the end.
  const bary = (id) => {
    const ps = (preds.get(id) ?? []).map((p) => orderIndex.get(p)).filter((v) => v != null)
    return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.POSITIVE_INFINITY
  }

  // Order each rank by parent barycentre (ties by id) and centre the row on 0.
  const placeRow = (ids, r) => {
    const sorted = [...ids].sort((a, b) => bary(a) - bary(b) || (a < b ? -1 : 1))
    const offset = ((sorted.length - 1) / 2) * CROSS_STRIDE
    sorted.forEach((id, i) => {
      orderIndex.set(id, i)
      pos[id] = place(r * MAIN_STRIDE, i * CROSS_STRIDE - offset)
    })
  }

  for (let r = 0; r <= maxRank; r++) placeRow(byRank.get(r) ?? [], r)
  placeRow(hubRailIds, railRank)

  return pos
}
