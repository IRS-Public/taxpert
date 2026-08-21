// Deterministic banded graph layout (M6 / 6c). Replaces the dagre fact pass with
// a fully deterministic, swimlane-style placement that the user can read in two
// orientations.
//
//   The flow spine        fg-set questions plus the flow structure that frames
//                         them (fg-collection / fg-detail / fg-section-gate /
//                         conditional-block) stack in document order down (or
//                         across) the centre. Container elements become frames
//                         whose children stack inside them, indented.
//   Writable-fact band    every `writable` fact sits in its own band on one side
//                         of the spine, aligned with the question that binds it.
//   Derived-fact band     every `derived` fact sits in its own band on the other
//                         side, aligned with the fact/question it derives from.
//   Alert / knockout band  fg-alert + fg-alert-knockout are grouped in a single
//                         band, each aligned with the step whose answer triggers
//                         it (via the `exits` edge).
//
// Bands never overlap (a fixed BAND_GAP separates them) and nodes within a band
// never overlap (packBand enforces a minimum stride). Facts and alerts are
// anchored to the *main-axis* coordinate of the flow element they relate to, so a
// reviewer can scan one row (vertical) or one column (horizontal) and see a
// question together with the writable it binds, the deriveds it feeds, and the
// alert it can trip — all related FGM components grouped, no messy crossings.
//
// Two orientations share the same core; only the (main, cross) -> (x, y) mapping
// and the strides differ:
//   vertical    flow runs top→bottom (main = y); bands sit left→right (cross = x)
//   horizontal  flow runs left→right (main = x); bands sit top→bottom (cross = y)
//
// Pure function: takes React Flow nodes/edges (built by transform.js), the sliced
// FGM (for flowPages order + raw edges), a saved-layout map (M5), and an
// orientation. A saved manual position wins over the computed one. Frame nodes
// also receive a computed width/height in node.style so FrameNode can fill its
// bounding box.

const NODE_W = 230
const NODE_H = 64
const CHILD_INDENT = 18
const FRAME_PAD = 14
const FRAME_HEADER = 26 // space for the frame's title before its first child
const BLOCK_GAP = 24 // gap after a frame block, along the main axis
const BAND_GAP = 90 // gap between adjacent bands, along the cross axis
const FRAME_W = NODE_W + 2 * CHILD_INDENT

// Which band a node belongs to, keyed by the visual category transform.js stamps
// onto node.data.category. fg-sets share the central spine with the flow
// structure that organises them; the two alert categories share one band.
const BAND_OF = {
  'fact-writable': 'writable',
  'fact-derived': 'derived',
  'fg-set': 'flow',
  'fg-collection': 'flow',
  'fg-detail': 'flow',
  'fg-section-gate': 'flow',
  'conditional-block': 'flow',
  'fg-alert': 'alerts',
  'fg-alert-knockout': 'alerts',
}

// Cross-axis order of the bands: writable inputs, then the central flow spine,
// then the deriveds they feed, then the alert/knockout off-ramps. This reads as
// the data-flow story left→right (vertical) or top→bottom (horizontal), and keeps
// the fg-set spine centred between the two fact bands.
const BAND_ORDER = ['writable', 'flow', 'derived', 'alerts']

// Per-orientation geometry. `crossSize` is how thick each band is along the cross
// axis (the flow band is widened to fit the frame indent). `place` maps an
// abstract (main, cross) pair to canvas (x, y). `frameSize` turns a frame's
// main-axis span into a node width/height.
const ORIENT = {
  vertical: {
    mainStride: 168, // y stride per spine row / packed fact
    crossSize: { writable: NODE_W, flow: FRAME_W, derived: NODE_W, alerts: NODE_W },
    place: (main, cross) => ({ x: cross, y: main }),
    frameSize: (mainSpan) => ({ width: FRAME_W, height: mainSpan }),
  },
  horizontal: {
    mainStride: NODE_W + 70, // x stride per spine column / packed fact
    crossSize: {
      writable: NODE_H,
      flow: NODE_H + 2 * CHILD_INDENT,
      derived: NODE_H,
      alerts: NODE_H,
    },
    place: (main, cross) => ({ x: main, y: cross }),
    frameSize: (mainSpan) => ({ width: mainSpan, height: NODE_H + 2 * CHILD_INDENT }),
  },
}

const isFrame = (n) => n.type === 'fgmFrame'
const orderOf = (n) => n.data?.raw?.order ?? 0
const bandOf = (n) => BAND_OF[n.data?.category] ?? 'flow'

// Edge kinds that tie a fact directly to a flow element; used to anchor a fact's
// main-axis position to the question/step it serves.
const FLOW_FACT_KINDS = new Set(['binds', 'gates', 'shows', 'displays'])

/**
 * @param {import('../model/fgm.js').FormBuilderGraph} graph  sliced FGM (page order + raw edges)
 * @param {object[]} nodes   React Flow nodes (unpositioned)
 * @param {object[]} edges   React Flow edges (unused; raw graph.edges carry kinds)
 * @param {Record<string,{x:number,y:number}>} [savedLayout]
 * @param {'vertical'|'horizontal'} [orientation]
 * @returns {object[]} positioned nodes (frames carry a sized style)
 */
export function layoutGraph(graph, nodes, edges, savedLayout = {}, orientation = 'vertical') {
  const O = ORIENT[orientation] ?? ORIENT.vertical
  const positions = new Map() // id -> {x,y}
  const sizes = new Map() // frameId -> {width,height}
  const mainPos = new Map() // id -> main-axis coordinate (pre-orientation)
  const crossOffset = new Map() // flow-node id -> extra cross offset (frame indent)

  const flowNodes = nodes.filter((n) => bandOf(n) === 'flow')
  const writableNodes = nodes.filter((n) => n.data?.category === 'fact-writable')
  const derivedNodes = nodes.filter((n) => n.data?.category === 'fact-derived')
  const alertNodes = nodes.filter((n) => bandOf(n) === 'alerts')

  const flowIds = new Set(flowNodes.map((n) => n.id))
  const factIds = new Set([...writableNodes, ...derivedNodes].map((n) => n.id))
  const alertIds = new Set(alertNodes.map((n) => n.id))

  // ── Flow spine: one document-ordered run along the main axis ──────────
  //
  // Pages are concatenated in flowPages order (the default slice is a single
  // page, so this is usually just one run). Within a page, top-level elements
  // stack by `order`; a frame reserves a header then stacks its children one
  // stride apart, indented on the cross axis, then leaves a BLOCK_GAP after.
  const pageOrder = graph.flowPages
    .map((p) => p.id)
    .filter((pid) => flowNodes.some((n) => n.data.raw.pageId === pid))
  for (const n of flowNodes) {
    const pid = n.data.raw.pageId
    if (pid && !pageOrder.includes(pid)) pageOrder.push(pid)
  }

  let cursor = 0
  for (const pid of pageOrder) {
    const els = flowNodes.filter((n) => n.data.raw.pageId === pid)
    const present = new Set(els.map((n) => n.id))
    const isChild = (n) => n.data.raw.parentId && present.has(n.data.raw.parentId)
    const topLevel = els.filter((n) => !isChild(n)).sort((a, b) => orderOf(a) - orderOf(b))

    for (const n of topLevel) {
      if (isFrame(n)) {
        const kids = els
          .filter((c) => c.data.raw.parentId === n.id)
          .sort((a, b) => orderOf(a) - orderOf(b))
        const frameStart = cursor
        let cm = cursor + FRAME_HEADER
        for (const k of kids) {
          mainPos.set(k.id, cm)
          crossOffset.set(k.id, CHILD_INDENT)
          cm += O.mainStride
        }
        const span = FRAME_HEADER + Math.max(kids.length, 1) * O.mainStride + FRAME_PAD
        mainPos.set(n.id, frameStart)
        crossOffset.set(n.id, 0)
        sizes.set(n.id, O.frameSize(span))
        cursor = frameStart + span + BLOCK_GAP
      } else {
        mainPos.set(n.id, cursor)
        crossOffset.set(n.id, 0)
        cursor += O.mainStride
      }
    }
  }
  const spineEnd = cursor // where leftover (un-anchored) facts begin stacking

  // ── Anchor facts to the flow element they serve ───────────────────────
  //
  // A fact's desired main-axis coordinate is the position of the nearest (lowest
  // main coord) flow element it binds/gates/shows/displays. Facts that only
  // connect to other facts inherit, by averaging, the anchors of their `depends`
  // neighbours over a few relaxation passes. Anything still unanchored stacks
  // after the spine, ordered by id for determinism.
  const want = new Map()
  const noteWant = (id, m) => {
    if (m == null) return
    const cur = want.get(id)
    if (cur == null || m < cur) want.set(id, m)
  }
  for (const e of graph.edges) {
    if (!FLOW_FACT_KINDS.has(e.kind)) continue
    if (flowIds.has(e.source) && factIds.has(e.target)) noteWant(e.target, mainPos.get(e.source))
    else if (flowIds.has(e.target) && factIds.has(e.source))
      noteWant(e.source, mainPos.get(e.target))
  }

  const depAdj = new Map()
  const addAdj = (a, b) => {
    if (!depAdj.has(a)) depAdj.set(a, new Set())
    depAdj.get(a).add(b)
  }
  for (const e of graph.edges) {
    if (e.kind === 'depends' && factIds.has(e.source) && factIds.has(e.target)) {
      addAdj(e.source, e.target)
      addAdj(e.target, e.source)
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    for (const fid of factIds) {
      if (want.has(fid)) continue
      const neigh = depAdj.get(fid)
      if (!neigh) continue
      let sum = 0
      let count = 0
      for (const nb of neigh)
        if (want.has(nb)) {
          sum += want.get(nb)
          count++
        }
      if (count) want.set(fid, sum / count)
    }
  }

  // ── Anchor alerts to their triggering step ────────────────────────────
  // `exits` runs step -> alert; fall back to the knocked-out fact's position.
  const alertWant = new Map()
  for (const e of graph.edges) {
    if (e.kind === 'exits' && alertIds.has(e.target)) {
      const cur = alertWant.get(e.target)
      const m = mainPos.get(e.source)
      if (m != null && (cur == null || m < cur)) alertWant.set(e.target, m)
    }
  }
  for (const e of graph.edges) {
    if (e.kind === 'knocks-out' && alertIds.has(e.source) && !alertWant.has(e.source)) {
      noteWantInto(alertWant, e.source, mainPos.get(e.target))
    }
  }

  // ── Pack each band along the main axis (no overlap, order preserved) ──
  // Anchored nodes sort by desired coord then id; each is pushed down just enough
  // to clear the previous. Un-anchored nodes trail after, starting past the spine.
  const packBand = (ids, wantMap) => {
    const anchored = []
    const free = []
    for (const id of ids) (wantMap.has(id) ? anchored : free).push(id)
    anchored.sort((a, b) => wantMap.get(a) - wantMap.get(b) || (a < b ? -1 : 1))
    free.sort()
    let prev = -Infinity
    for (const id of anchored) {
      const c = Math.max(wantMap.get(id), prev + O.mainStride)
      mainPos.set(id, c)
      prev = c
    }
    for (const id of free) {
      const c = Math.max(spineEnd, prev + O.mainStride)
      mainPos.set(id, c)
      prev = c
    }
  }
  packBand(
    writableNodes.map((n) => n.id),
    want
  )
  packBand(
    derivedNodes.map((n) => n.id),
    want
  )
  packBand(
    alertNodes.map((n) => n.id),
    alertWant
  )

  // ── Cross-axis: lay the bands out side by side, skipping empty ones ───
  const bandNodes = {
    writable: writableNodes,
    flow: flowNodes,
    derived: derivedNodes,
    alerts: alertNodes,
  }
  const crossOrigin = {}
  let acc = 0
  for (const b of BAND_ORDER) {
    if (!bandNodes[b].length) continue
    crossOrigin[b] = acc
    acc += O.crossSize[b] + BAND_GAP
  }

  for (const n of nodes) {
    const b = bandOf(n)
    const main = mainPos.get(n.id) ?? 0
    let cross = crossOrigin[b] ?? 0
    if (b === 'flow') cross += crossOffset.get(n.id) ?? 0
    positions.set(n.id, O.place(main, cross))
  }

  // ── Apply: saved positions win; frames carry their computed size ──────
  return nodes.map((n) => {
    const computed = positions.get(n.id) ?? { x: 0, y: 0 }
    const saved = savedLayout[n.id]
    const out = { ...n, position: saved ? { x: saved.x, y: saved.y } : computed }
    if (isFrame(n)) {
      const sz = sizes.get(n.id) ?? O.frameSize(FRAME_HEADER + O.mainStride + FRAME_PAD)
      out.style = { ...(n.style ?? {}), width: sz.width, height: sz.height }
      out.zIndex = 0
    }
    return out
  })
}

// Record the lower of two candidate main coords into an arbitrary want-map.
function noteWantInto(map, id, m) {
  if (m == null) return
  const cur = map.get(id)
  if (cur == null || m < cur) map.set(id, m)
}
