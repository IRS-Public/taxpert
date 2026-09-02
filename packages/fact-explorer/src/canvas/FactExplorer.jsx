import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useNodesInitialized,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { interceptFactExplorerNav } from '../config/taxpertHost.js'
import { loadGraph, loadShardIndex, loadSlice, loadScenarioIndex } from '../model/load.js'
import { buildSliceOptions, defaultSliceKey, sliceGraph, FULL_KEY } from '../model/slice.js'
import { sliceOptionsFromIndex } from '../model/shard.js'
import { drillGraph, egoLayout } from '../model/drill.js'
import { coneGraph, coneLayout } from '../model/cone.js'
import { filterGraph, DEFAULT_FILTERS } from '../model/filter.js'
import { facetGraph, defaultFacets } from '../model/facets.js'
import { matchIds } from '../model/search.js'
import { loadEngine, buildScenarioGraph, makeEvaluators } from '../model/engine.js'
import { computeVisibility, HIDDEN_STATUSES, FACT_STATUS } from '../model/visibility.js'
import {
  buildFlowContext,
  flowTrackedPaths,
  buildScenarioSummary,
} from '../model/explainContext.js'
import { scenarioFilter } from '../model/scenarioFilter.js'
import { publish as bridgePublish, subscribe as bridgeSubscribe } from '../model/bridge.js'
import { vocabularyFor } from '../model/scenarios/index.js'
import { toReactFlow } from './transform.js'
import { CATEGORY_STYLE, NODE_FALLBACK } from './style.js'
import { useFeatureFlags } from '../hooks/useFeatureFlags.js'
import Legend from './Legend.jsx'
import FgmNode from './FgmNode.jsx'
import FrameNode from './FrameNode.jsx'
import EmbeddedAppPanel from './EmbeddedAppPanel.jsx'
import ChatPanel from './ChatPanel.jsx'
import DetailPanel from '../explain/DetailPanel.jsx'
import { getLayout, setNodePosition, clearLayout } from '../annotate/store.js'
import SearchBox from './controls/SearchBox.jsx'
import FilterControls from './controls/FilterControls.jsx'
import LayerControls from './controls/LayerControls.jsx'
import ScenarioStatus from './controls/ScenarioStatus.jsx'
import DisplayOptions from './controls/DisplayOptions.jsx'
import GlobalNav from 'taxpert/react'
import ScenarioModal from 'taxpert/react/scenario-modal'

const nodeTypes = { fgm: FgmNode, fgmFrame: FrameNode }

// Above this many nodes, a slice is "large": per-node decoration that is affordable on a normal
// slice stops paying for itself, and two things switch off: the minimap and edge animation (see
// decoratedEdges below).
//
// One constant rather than two, because both were measured into the same bracket. On direct-file
// at 1600x1000 in Chromium, median frame time while panning the canvas:
//
//   flowGates.xml   1,671 nodes / 2,744 edges     8 ms — both features on, and no cost
//   Full graph      4,596 nodes / 8,622 edges   822 ms — a frozen canvas
//
// The cliff is somewhere between the two, so this sits just above the size that measured clean
// rather than in the middle of the gap nothing was measured in. Node count is a proxy for what
// actually drives both costs, which is canvas *extent*: fitView on a bigger graph zooms further
// out, and both the minimap's per-node rects and the edge layer's path lengths scale with it.
const LARGE_SLICE_NODES = 2000

function nodeColor(n) {
  return CATEGORY_STYLE[n.data?.category]?.border ?? NODE_FALLBACK.border
}

// Cheap "is this the same set of nodes" test, for comparing what React Flow is holding against
// what this component last handed it. Identity is no use (see the fit effect), and a full id
// comparison is not worth it on 4,596 nodes when the layout is document-ordered: count plus the
// two ends changes for any real change of view.
function liveNodesSig(ns) {
  return `${ns.length}|${ns[0]?.id ?? ''}|${ns[ns.length - 1]?.id ?? ''}`
}

/**
 * @param {object} props
 * @param {import('../model/apps.js').FactExplorerApp} props.app the Form Builder app being
 *   represented. App.jsx remounts this component on a change of `app.id` rather than threading the
 *   switch through every effect. The graph, the layout cache, the engine, the scenario overlay and
 *   the search index are all per-app, so a remount is the honest way to say so.
 */
export default function FactExplorer({ app }) {
  // The graph the canvas is currently reading. Sharding made this two things wearing one name: the
  // shard for the active slice, or the whole graph once something has asked for it. They are
  // interchangeable by construction — see src/model/shard.js — so nothing below this line has to
  // know which it got.
  const [graph, setGraph] = useState(null)
  const [error, setError] = useState(null)

  // The shard index: the picker's options and the default selection, without a graph. Three
  // states, and the distinction matters — `undefined` is "still in flight", `null` is "this app
  // has no shards", and only the second is a decision the loader below can act on. Collapsed to
  // one falsy value, the first render would fetch the whole graph before finding out it need not.
  //
  // Null is an ordinary answer: the mock fixture has no shards, nor does an app serving its own
  // generated graph. Everything below then derives the options from the whole graph, as it always
  // did.
  const [shardIndex, setShardIndex] = useState(undefined)

  // Latched once the whole graph is in hand. One-way: having paid for it, there is no reason to go
  // back to fetching shards, and switching slices becomes instant again.
  const [wholeLoaded, setWholeLoaded] = useState(false)
  const [selected, setSelected] = useState(null)
  // Right-edge width the embedded app panel occupies, 0 when closed. DetailPanel docks to its
  // left so the two never overlap.
  const [embedInset, setEmbedInset] = useState(0)

  // Which slice of the graph to render, and whether to pull in +1-hop context.
  const [sliceKey, setSliceKey] = useState(null)
  const [neighbors, setNeighbors] = useState(true)

  // When set, the canvas swaps the slice for this node's ego-network, centred.
  const [drillId, setDrillId] = useState(null)

  // When set, the canvas swaps the slice for this output node's rooted dependency tree.
  const [coneRootId, setConeRootId] = useState(null)

  // Per-layer toggles and fine-grained facets, both pure FGM to FGM.
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  // `null` means "whatever this graph's defaults are". They depend on the graph, whose flow-tag
  // vocabulary is its own, so they cannot be a useState initial value: the graph arrives later.
  const [facetOverride, setFacetOverride] = useState(null)

  // Raw input, plus the debounced query that actually drives highlighting.
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [matchCursor, setMatchCursor] = useState(0)

  // Bumped on "Reset layout" to force a fresh layout pass.
  const [layoutVersion, setLayoutVersion] = useState(0)

  // Banded-layout orientation, set from the Display options modal, which is where every Taxpert
  // destination arranges what it shows.
  const [orientation, setOrientation] = useState('vertical')

  // Held here rather than inside EmbeddedAppPanel because it round-trips: the Display modal's
  // checkbox docks the panel, and the panel's Close button has to flip that checkbox back off.
  const [sideBySide, setSideBySide] = useState(false)

  // `null` means "whatever this slice's size makes sensible" — the same shape as facetOverride
  // above, and for the same reason: the answer depends on a graph that arrives later. Ticking or
  // clearing the Display modal's checkbox pins it, so the threshold is a default, not a cliff.
  const [miniMapOverride, setMiniMapOverride] = useState(null)

  // Control-panel collapse state.
  const [headerOpen, setHeaderOpen] = useState(true)

  // Measured, so the chat dock pins beneath the header at either of its heights.
  const headerRef = useRef(null)
  const [headerHeight, setHeaderHeight] = useState(0)

  // The scenario overlay: the corpus index, the active scenario, and the computed per-node status
  // and per-fact values.
  //
  // How it renders is one preference, the Display modal's "Reveal items skipped in scenarios".
  // Revealed, the whole graph stays and unreached questions are dimmed. Not revealed, they are
  // structurally dropped. A third "loaded but ignored" state said the same as loading nothing.
  const [scenarioIndex, setScenarioIndex] = useState([])
  const [scenario, setScenario] = useState(null) // { filename }
  const [scenarioStatus, setScenarioStatus] = useState(new Map())
  const [scenarioValues, setScenarioValues] = useState(new Map())
  const [revealSkipped, setRevealSkipped] = useState(false)
  const [scenarioBusy, setScenarioBusy] = useState(false)
  const [scenarioError, setScenarioError] = useState(null)

  const scenarioMode = !scenario ? 'off' : revealSkipped ? 'dim' : 'hide'

  // Step one: the shard index, which is ~4 KB and is all the picker needs. A null result means
  // this app ships no shards, and the effect below then loads the whole graph as before.
  useEffect(() => {
    let live = true
    loadShardIndex(app).then((found) => {
      if (!live) return
      setShardIndex(found?.index ?? null)
      if (!found) setWholeLoaded(true) // no shards: the whole graph is the only source there is
    })
    return () => {
      live = false
    }
  }, [app])

  /**
   * The whole graph, fetched if this session has not needed it yet, and latched as the active
   * source once it arrives (see `wholeLoaded`).
   *
   * The single seam through which the expensive fetch happens. Everything that reads ACROSS the
   * graph rather than within one slice goes through here — search totals, the scenario overlay,
   * the chat context, and a dependency link that points outside the slice. `wantWhole` below is
   * the declarative half of the same rule, for the cases that need it before they can render.
   */
  const ensureWholeGraph = useCallback(async () => {
    const whole = await loadGraph(app)
    setGraph(whole)
    setWholeLoaded(true)
    return whole
  }, [app])

  // Soft-fails. With no index generated, or no scenarios at all, the picker stays empty.
  useEffect(() => {
    loadScenarioIndex(app).then((j) => setScenarioIndex(j?.scenarios ?? j ?? []))
  }, [app])

  // The last graph published, so the subscription ignores the echo of our own publish.
  // BroadcastChannel delivers to sibling instances in the same document too.
  const lastGraphRef = useRef(null)

  // So the "Explain this node" buttons can open the dock and fire a prompt in one shot.
  const chatRef = useRef(null)

  // Read-only here. useFeatureFlags layers localStorage overrides over the build-time env defaults
  // and re-renders when Workspace settings changes one.
  //
  // The two AI features are flagged apart. aiFactExplanation gates everything that reads facts back
  // (the chat dock, the Explain badges, the scenario summary). aiScenarioGeneration gates only the
  // scenario modal's Generate section.
  const featureFlags = useFeatureFlags()
  const aiFactExplanation = featureFlags.aiFactExplanation
  const aiScenarioGeneration = featureFlags.aiScenarioGeneration

  // Run the real engine on a serialized graph and overlay the computed visibility over the WHOLE
  // FGM. Shared by the picker and the inbound bridge handler. With `publishOut` set, the graph is
  // broadcast so the embedded iframe rehydrates.
  async function applyScenarioJson(json, label, { publishOut } = {}) {
    // The overlay is computed over the WHOLE FGM, not the active slice: a scenario's answer to a
    // question three slices away is what decides whether the one on screen is reached at all.
    // With shards that is a fetch rather than something already in hand, so it is awaited here
    // rather than read off `graph` — which at this moment is very likely one shard.
    const [engine, whole] = await Promise.all([loadEngine(app), ensureWholeGraph()])
    const sg = buildScenarioGraph(engine, json)
    const { status, values } = computeVisibility(whole, makeEvaluators(sg))
    setScenario({ filename: label })
    setScenarioStatus(status)
    setScenarioValues(values)
    if (publishOut) {
      const serialized = sg.toJSON()
      lastGraphRef.current = serialized
      // Namespaced by the app's own prefix: what the embedded iframe's runtime reads, and what
      // keeps two apps in one Fact Explorer from overwriting each other.
      bridgePublish(serialized, app.storagePrefix)
    }
  }

  // The real <taxpert-scenario-modal>'s "Load scenario" button fetches the selected scenario
  // file itself (fact-graph-io.js's loadScenarioFromAuditPanel, reading `#scenario-select`'s
  // value, an id the modal's header comment documents as a stable integration point) and hands
  // the JSON text to window.loadFactGraph(). In credit-assistant that global saves it and reloads
  // the page. Here it feeds Fact Explorer's own pipeline instead: run the real engine in-browser
  // and overlay the computed visibility, exactly what the old inline picker's onLoad did.
  useEffect(() => {
    window.loadFactGraph = (json) => {
      const filename = document.querySelector('#scenario-select')?.value || 'scenario'
      setScenarioBusy(true)
      setScenarioError(null)
      applyScenarioJson(json, filename, { publishOut: true })
        .catch((e) => {
          console.error(e)
          setScenarioError(e.message)
        })
        .finally(() => setScenarioBusy(false))
    }
    return () => {
      delete window.loadFactGraph
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  // CA → Fact Explorer: when a question is answered in the embedded iframe, CA broadcasts
  // its serialized graph; treat it as the active scenario and recompute. Re-bound
  // when the FGM loads (the recompute needs it). Ignores our own publish echo.
  useEffect(() => {
    if (!graph) return undefined
    return bridgeSubscribe((inbound) => {
      if (inbound === lastGraphRef.current) return
      lastGraphRef.current = inbound
      applyScenarioJson(inbound, 'live (from app)').catch((e) => {
        console.error(e)
        setScenarioError(e.message)
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 200)
    return () => clearTimeout(t)
  }, [query])

  // Track the header's rendered height (it grows/shrinks with the collapse toggle
  // and the slice/scenario controls) so the chat dock stays pinned below it.
  useEffect(() => {
    const el = headerRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(([entry]) => setHeaderHeight(entry.contentRect.height))
    ro.observe(el)
    setHeaderHeight(el.getBoundingClientRect().height)
    return () => ro.disconnect()
  }, [])

  const rf = useReactFlow()

  // From the index when there is one, so the picker is populated before any graph has been
  // fetched; from the graph otherwise. Same shape either way — the index stores what
  // buildSliceOptions() returned when it was written.
  const sliceOptions = useMemo(
    () => (shardIndex ? sliceOptionsFromIndex(shardIndex) : graph ? buildSliceOptions(graph) : []),
    [shardIndex, graph]
  )

  // The identity facets for this graph, and the effective selection over them. defaultFacets() is
  // total, so this is safe to read before the graph has loaded.
  // Whole-graph facets, carried in the index. Derived from the active graph they would narrow to
  // whatever the current shard happens to contain, so a flow tag would lose its checkbox on one
  // slice and regain it on the next — and a facet with no checkbox cannot be brought back.
  const facetDefaults = useMemo(
    () => shardIndex?.facets ?? defaultFacets(graph),
    [shardIndex, graph]
  )
  const facets = facetOverride ?? facetDefaults

  // Feed the real <taxpert-scenario-modal> its scenario vocabulary: the library <option>s (built
  // via DOM textContent, not string interpolation, so a scenario filename can't be read as markup)
  // and the filter-dropdown descriptors + filename decoder for whichever vocabulary this app
  // declared (see model/scenarios/). An app with none gets an empty `fields`, which the modal
  // renders as a plain filename list. Handed over as nodes, the element taking them directly, so
  // there is no outerHTML → parse round-trip in the middle.
  const scenarioOptions = useMemo(
    () =>
      scenarioIndex.map((s) => {
        const opt = document.createElement('option')
        opt.value = s.filename
        opt.textContent = s.filename.replace(/\.json$/, '')
        return opt
      }),
    [scenarioIndex]
  )
  const scenarioFilters = useMemo(() => vocabularyFor(app), [app])

  // Whole-graph path to fact lookup, not just the current slice, backing the
  // explain popup's labels and dependency navigation.
  const factByPath = useMemo(() => {
    const m = new Map()
    if (graph) for (const f of graph.facts) m.set(f.path, f)
    return m
  }, [graph])
  const factLabel = useMemo(() => (path) => factByPath.get(path)?.name ?? null, [factByPath])

  // M6 search hits across the WHOLE graph (so we can report in-view vs. total).
  const matchSet = useMemo(
    () => (graph && debouncedQuery ? matchIds(graph, debouncedQuery) : new Set()),
    [graph, debouncedQuery]
  )
  const searchActive = !!debouncedQuery

  // Step two: fetch the source the current view actually needs.
  //
  // `wantWhole` is the whole rule in one expression, which is the point of writing it this way —
  // adding a feature that reads across the graph means adding a term here, and forgetting to is a
  // visible bug (a partial answer) rather than a silent one.
  //
  //   Full graph   the selection IS the whole graph
  //   cone/drill   both deliberately reach outside the active slice; that is what they are for
  //   search       the hit count is reported as in-view vs. total, and "total" means total
  //
  // Search does not block on it: matchIds runs against whichever graph is loaded, so hits inside
  // the slice highlight immediately and the total corrects itself when the fetch lands.
  const wantWhole =
    wholeLoaded || sliceKey === FULL_KEY || !!coneRootId || !!drillId || searchActive

  useEffect(() => {
    if (shardIndex === undefined) return undefined // the index is still in flight
    if (shardIndex && !sliceKey) return undefined // ...and so, therefore, is the default selection
    let live = true
    const source = wantWhole || !sliceKey ? ensureWholeGraph() : loadSlice(app, sliceKey)
    source
      // A null slice is an app with no shards, or a shard the index names and the disk does not:
      // load.js has already said so on the console, and the whole graph is always a correct answer.
      .then((g) => (g === null ? ensureWholeGraph() : g))
      .then((g) => {
        if (live) setGraph(g)
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [app, shardIndex, sliceKey, wantWhole, ensureWholeGraph])

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  function centreOn(id) {
    const node = rf.getNode(id)
    if (node) {
      rf.setCenter(node.position.x + 115, node.position.y + 32, { zoom: 1, duration: 400 })
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })))
    }
  }

  // A dependency name in the explain popup selects (and, if on-canvas, centres)
  // the target fact node, the Fact Explorer analogue of the audit panel's fact-link.
  async function navigateToFact(path) {
    // A shard carries its focus nodes plus their one-hop ring, and a fact's dependencies ARE its
    // one-hop ring — so the links the detail panel offers resolve out of the shard. What lands
    // here is the hop after that: following a chain out of the slice, which is the moment the
    // whole graph is genuinely the answer.
    let fact = factByPath.get(path)
    if (!fact) fact = (await ensureWholeGraph()).facts.find((f) => f.path === path)
    if (!fact) return
    setSelected({ ...fact, __kind: 'fact' })
    centreOn(`fact:${path}`)
  }

  // "Explain this node": dispatch on the FGM node kind, build the structured
  // context (+ the fact paths whose live dependency trees ride along), and hand
  // it to the chat dock. Facts reuse the dependency-tree path the chat already
  // walks; flow elements add their binding/gate/alert metadata + 1-hop neighbours.
  async function explainNode(node) {
    if (!node || !graph || !chatRef.current) return
    if (node.__kind === 'fact') {
      chatRef.current.explain({
        prompt: `Explain the fact \`${node.path}\`: what it computes, how it is derived from its dependencies, and its current value under the loaded scenario.`,
        trackedPaths: [node.path],
        context: { kind: 'fact', path: node.path },
      })
      return
    }
    // flow element. Over the whole graph: buildFlowContext walks the element's binding, its gate
    // and its 1-hop neighbours, and an explanation assembled from one shard would be a confident
    // answer with pieces missing.
    const context = buildFlowContext(node, await ensureWholeGraph(), {
      scenarioValues,
      scenarioStatus,
    })
    const label = node.questionText || node.headingText || node.alert?.alertKey || node.tag
    chatRef.current.explain({
      prompt: `Explain this flow element (${node.tag} — "${label}"): what it does, the fact it binds or gates on, and how its 1-hop neighbours determine whether it shows or knocks the taxpayer out.`,
      trackedPaths: flowTrackedPaths(context),
      context,
    })
  }

  // Scenario-level summary: does the taxpayer reach the end of the flow, and if
  // not, exactly where/why are they disqualified? Reads the scenario overlay.
  async function summarizeScenario() {
    if (!graph || !chatRef.current || !scenario) return
    const context = buildScenarioSummary(
      await ensureWholeGraph(),
      scenarioStatus,
      scenarioValues,
      scenario.filename
    )
    const trackedPaths = context.activeKnockouts.map((k) => k.boundFactPath).filter(Boolean)
    chatRef.current.explain({
      prompt: `Summarize the outcome of scenario "${scenario.filename}". Does the taxpayer reach the end of the ${app.label} flow? If not, name exactly where (which knockout) and why they are disqualified, citing the decisive fact and its value.`,
      trackedPaths,
      context,
    })
  }

  // Default to the first flow page once the graph loads, never the full graph.
  useEffect(() => {
    if (sliceKey !== null) return
    if (shardIndex) setSliceKey(shardIndex.defaultKey)
    else if (graph) setSliceKey(defaultSliceKey(graph))
  }, [shardIndex, graph, sliceKey])

  // Drill-down and dependency-cone both short-circuit the slice chain, drawing
  // from the WHOLE graph so context outside the active slice is pulled in. Cone
  // wins if both are somehow set. Region (slice.js) → layer (filter.js) → facets
  // (facets.js): all pure FGM→FGM.
  // In 'hide' mode the scenario overlay is a pure FGM→FGM stage that runs BEFORE
  // the slice chain, dropping nodes the user wouldn't see (the all-screens-style
  // "only what they see"). 'dim'/'off' leave the structure intact (decorated in
  // decoratedNodes below). Cone/drill short-circuit as before.
  const scenarioActive = scenarioMode !== 'off' && scenarioStatus.size > 0
  const sliced = useMemo(() => {
    if (!graph) return null
    // Both draw from the WHOLE graph by design, so they render nothing until it is here rather
    // than a plausible-looking cone cut from one shard. `wantWhole` above has already started the
    // fetch; this is the frame or two before it lands.
    if (coneRootId) return wholeLoaded ? coneGraph(graph, coneRootId) : null
    if (drillId) return wholeLoaded ? drillGraph(graph, drillId) : null
    const source =
      scenarioMode === 'hide' && scenarioStatus.size > 0
        ? scenarioFilter(graph, scenarioStatus)
        : graph
    return facetGraph(filterGraph(sliceGraph(source, sliceKey, { neighbors }), filters), facets)
  }, [
    graph,
    wholeLoaded,
    coneRootId,
    drillId,
    sliceKey,
    neighbors,
    filters,
    facets,
    scenarioMode,
    scenarioStatus,
  ])

  // Positions are computed once per slice, facet or reset, NOT per keystroke, so
  // search never reshuffles the canvas. layoutVersion forces a rebuild after
  // "Reset layout" clears saved positions. Drill (radial ego) and cone (layered
  // tree) layouts override the banded placement and ignore saved drag positions.
  const base = useMemo(() => {
    if (!sliced) return { nodes: [], edges: [] }
    const overlay = coneRootId
      ? coneLayout(sliced, coneRootId, orientation)
      : drillId
        ? egoLayout(sliced, drillId)
        : getLayout()
    return toReactFlow(sliced, overlay, {}, orientation)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliced, layoutVersion, orientation, drillId, coneRootId])

  // Fold search highlight + scenario status onto the laid-out nodes (cheap map;
  // no re-layout). Scenario status rides node.data exactly like match/searchDim:
  // FgmNode reads scenarioStatus (knockout ring), scenarioDim (hidden/unseen in
  // 'dim' mode), and scenarioIncomplete (amber ring on a seen-but-incomplete fact).
  const decoratedNodes = useMemo(
    () =>
      base.nodes.map((n) => {
        const match = matchSet.has(n.id)
        const st = scenarioActive ? scenarioStatus.get(n.id) : null
        const scenarioDim = scenarioMode === 'dim' && st != null && HIDDEN_STATUSES.has(st)
        const path = n.data.raw?.__kind === 'fact' ? n.data.raw.path : null
        const v = scenarioActive && path ? scenarioValues.get(path) : null
        const scenarioIncomplete = !!(st === FACT_STATUS.seen && v && v.hasValue && !v.complete)
        return {
          ...n,
          data: {
            ...n.data,
            match,
            searchDim: searchActive && !match,
            scenarioStatus: st,
            scenarioDim,
            scenarioIncomplete,
            // The engine-computed value for this fact under the active scenario,
            // so FgmNode can render the live-value chip on the canvas (N5).
            scenarioValueState: v,
            // The per-node "Explain" badge dispatches through here (N7). Omitted
            // when AI mode is off so FgmNode renders no badge (it gates on this).
            onExplain: aiFactExplanation ? explainNode : undefined,
          },
        }
      }),
    // `explainNode` is a lazily-invoked callback stashed in node.data; including it
    // would rebuild every node on each render and defeat this memo. It reads fresh
    // closure values at call-time, so omitting it from the deps is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      base.nodes,
      matchSet,
      searchActive,
      scenarioActive,
      scenarioMode,
      scenarioStatus,
      scenarioValues,
      aiFactExplanation,
    ]
  )

  // The edge counterpart of decoratedNodes, and for now it does one thing: drop the marching-ants
  // animation on a large slice.
  //
  // Node culling is a real cost saving (the full graph went from 92,921 DOM elements under the
  // viewport to 9,881) but it is not what freezes the canvas. Panning the full graph measured
  // 788 ms per frame before the culling work and 818 ms after all of it had landed. A CPU profile
  // of that pan is 99.9% `(program)`, pure rasterisation with no JavaScript at all. Hiding one
  // layer at a time finds it: with `.react-flow__edge-path` animation suppressed the same pan runs
  // at 8 ms, identical to hiding the edges outright, while hiding the nodes or the background
  // changes nothing.
  //
  // The culprit is 102 edges. `knocks-out` is the only animated kind in EDGE_STYLE, and an animated
  // stroke-dashoffset on a path spanning the full graph's extent forces the browser to re-raster
  // the whole SVG layer every frame. The cost is in the paths' length rather than their number,
  // which is why no amount of node culling touches it and why gating on an edge count would be the
  // wrong gate.
  //
  // It lives here rather than in transform.js on purpose. transform.js is a pure FGM to React Flow
  // mapping and should not know what a viewport costs. This file already owns the other
  // size-dependent display decision (miniMapOn, just below).
  //
  // Knockout edges stay red and dashed either way, so nothing that identifies them is lost.
  const decoratedEdges = useMemo(
    () =>
      base.edges.length && base.nodes.length > LARGE_SLICE_NODES
        ? base.edges.map((e) => (e.animated ? { ...e, animated: false } : e))
        : base.edges,
    [base.edges, base.nodes.length]
  )

  // In-view (on-canvas) matches, for the counter and prev/next stepping.
  const inViewMatches = useMemo(
    () => base.nodes.filter((n) => matchSet.has(n.id)).map((n) => n.id),
    [base.nodes, matchSet]
  )
  useEffect(() => setMatchCursor(0), [debouncedQuery, sliceKey])

  const stepMatch = (dir) => {
    if (!inViewMatches.length) return
    const next = (matchCursor + dir + inViewMatches.length) % inViewMatches.length
    setMatchCursor(next)
    centreOn(inViewMatches[next])
  }

  // Persist a node's manual position when the user finishes dragging it. Skipped
  // in drill / cone mode, whose computed positions are transient and shouldn't
  // pollute the saved slice layout.
  const onNodeDragStop = (_e, node) => {
    if (drillId || coneRootId) return
    setNodePosition(node.id, node.position)
  }

  // Stable, because it is handed to the Display modal as a descriptor: a new function identity on
  // every render would have the element rebuild its footer button each time the canvas moves.
  const resetLayout = useCallback(() => {
    clearLayout()
    setLayoutVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    setNodes(decoratedNodes)
    setEdges(decoratedEdges)
  }, [decoratedNodes, decoratedEdges, setNodes, setEdges])

  const facetSig = [
    facets.knockoutsOnly,
    facets.flowTags.join(','),
    facets.factKinds.join(','),
    facets.edgeKinds.join(','),
  ].join('|')

  // What counts as a different *view* of the graph, and so as something to re-frame.
  //
  // This string used to be the <ReactFlow> `key`. Every term in it is an ordinary user
  // control — the slice picker, a layer checkbox, the orientation toggle — and keying the element
  // on them tore the whole instance down and rebuilt it on every one, discarding React Flow's
  // measurement caches and re-mounting thousands of nodes rather than diffing them. The remount
  // bought exactly one thing: the `fitView` prop firing again on the new instance. An effect on
  // the same signature buys that without the teardown.
  const fitSignature = `cone:${coneRootId ?? ''}|drill:${drillId ?? ''}|${sliceKey}|${neighbors}|${filters.flow}${filters.facts}${filters.edges}|${facetSig}|${orientation}|${layoutVersion}|scn:${scenarioMode}:${scenario?.filename ?? ''}`

  // Re-frame on a new view — but only once that view is the one React Flow actually holds, and has
  // measured it. Both halves are load-bearing, and both fail silently when you get them wrong.
  //
  // A signature change does not mean the new nodes have landed. setNodes runs in the effect above,
  // so during that commit React Flow still holds the *previous* view, and `nodesInitialized` is
  // still the previous view's answer, read during render. Fitting there frames the old geometry
  // and — if that is then recorded as "fitted" — never corrects itself. Under
  // onlyRenderVisibleElements the result is not a slightly-off viewport, it is a blank canvas: the
  // view stays parked where the last slice was and every node of the new slice is culled as
  // off-screen.
  //
  // So the condition is read from the live store at effect time (rf.getNodes()), not from a render
  // closure. It cannot be `nodes === decoratedNodes` either, tempting as that looks: React Flow
  // feeds dimension changes back through onNodesChange, and useNodesState's applyNodeChanges
  // replaces the array — so that identity holds only for the instant between setNodes and the
  // first measurement, which is both too narrow to rely on and, when it recurs on an unrelated
  // re-decoration, enough to fire a stale fit. That is what snapped the viewport back to the fit
  // position on every search keystroke.
  //
  // Fitting once per distinct signature is the contract the old `key` had: a new slice, filter,
  // facet, orientation or scenario re-frames; a search keystroke or a scenario chip re-decorates
  // the same view and must leave the viewport where the user put it.
  const nodesInitialized = useNodesInitialized()
  const fittedSig = useRef(null)
  useEffect(() => {
    if (fittedSig.current === fitSignature) return
    // Is the store holding this view yet, and has it measured it? An unmeasured node has no
    // width, and fitView would compute its bounds from a zero-sized box.
    const live = rf.getNodes()
    if (liveNodesSig(live) !== liveNodesSig(decoratedNodes)) return
    if (live.some((n) => !n.measured?.width)) return
    fittedSig.current = fitSignature
    rf.fitView({ duration: 400 })
    // nodesInitialized is not read here; it is in the deps because its flip back to true is the
    // render that makes the check above start passing.
  }, [nodesInitialized, decoratedNodes, fitSignature, rf])

  if (error) {
    return (
      <div className="fact-explorer-error">
        <h2>Failed to load graph</h2>
        <pre>{error}</pre>
      </div>
    )
  }

  const counts = sliced
    ? `${sliced.flowElements.length} flow nodes; ${sliced.facts.length} facts; ${sliced.edges.length} edges`
    : 'loading…'

  const miniMapOn = miniMapOverride ?? nodes.length <= LARGE_SLICE_NODES

  return (
    <div className="fact-explorer">
      {/* Shared global nav. Fact Explorer is this app itself, so we stay in-app; other items
          navigate to the represented app's own views (the menu is rebuilt per app in
          taxpertHost.js). workspaceLocked: Fact Explorer IS a Taxpert Workspace destination, so
          "workspace off" isn't a meaningful state here — always on, toggle disabled (see
          taxpert-global-nav.js). */}
      <GlobalNav
        app="fact-explorer"
        active="fact-explorer"
        contextLabel={app.label}
        workspaceLocked
        onSelect={interceptFactExplorerNav()}
      />

      {/* The embedded app view (N6): a same-origin iframe via the Vite proxy, kept in sync with the
          canvas through the BroadcastChannel bridge. Docked from the Display modal's "Show product
          experience side-by-side" — sideBySide is the shared state, and the panel renders nothing
          of its own when it isn't docked. */}
      <EmbeddedAppPanel
        app={app}
        onInsetChange={setEmbedInset}
        docked={sideBySide}
        onDockedChange={setSideBySide}
      />

      {/* Main Fact Explorer Canvas Container */}
      <div className="fact-explorer-canvas">
        {/* The canvas control panel: what is in view (Search, Filter) and what is drawn of it
            (Layers). Everything about how the workspace *looks* — the scenario overlay, the layout
            orientation, the side-by-side product view, Reset layout — is in the Display options
            modal instead, behind the nav's Display button, which is where every other Taxpert
            destination keeps the same choices. Export/Import went with the annotation toolbar. */}
        <header ref={headerRef} className="fe-panel">
          <button
            className="fe-panel__toggle"
            type="button"
            aria-expanded={headerOpen}
            onClick={() => setHeaderOpen((o) => !o)}
          >
            <span className="fe-panel__heading">Fact Explorer</span>
            <span className="fe-panel__chevron" aria-hidden="true">
              {headerOpen ? '⌄' : '›'}
            </span>
          </button>
          {headerOpen && (
            <div className="fe-panel__body">
              <p className="fe-panel__counts">
                Showing: {counts}; source: {import.meta.env.VITE_FGM_SOURCE ?? 'mock'}
              </p>
              <SearchBox
                query={query}
                onQuery={setQuery}
                inView={inViewMatches.length}
                total={matchSet.size}
                active={searchActive}
                cursor={matchCursor}
                onStep={stepMatch}
              />
              {/* Which app the canvas represents used to be an "App:" select here, ahead of the
                  scope picker. It is a workspace setting now — the nav's gear, "Applications" —
                  because this panel exists only in Fact Explorer, and switching app is something
                  you should be able to do from the product experience and Browse All too. See
                  config/taxpertHost.js. */}
              <FilterControls
                options={sliceOptions}
                value={sliceKey ?? ''}
                onChange={setSliceKey}
                neighbors={neighbors}
                onNeighborsChange={setNeighbors}
                knockoutsOnly={facets.knockoutsOnly}
                onKnockoutsOnlyChange={(on) => setFacetOverride({ ...facets, knockoutsOnly: on })}
              />
              <LayerControls
                filters={filters}
                onFiltersChange={setFilters}
                facets={facets}
                defaults={facetDefaults}
                onFacetsChange={setFacetOverride}
                disabled={facets.knockoutsOnly}
              />
              <ScenarioStatus
                scenario={scenario}
                busy={scenarioBusy}
                error={scenarioError}
                onSummarize={aiFactExplanation ? summarizeScenario : undefined}
              />
            </div>
          )}
        </header>

        <Legend />

        {/* No `key`: see fitSignature above. onlyRenderVisibleElements mounts only
            the nodes the viewport can see — FgmNode is 173 lines of JSX, and a large slice was
            thousands of live subtrees for a viewport showing a few dozen. React Flow force-renders
            each node once so it can be measured, and culls partially-visible nodes in, so nothing
            pops at the viewport edge and the banded layout still measures its frames. */}
        <ReactFlow
          onlyRenderVisibleElements
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_, n) => setSelected(n.data?.raw ?? null)}
          onPaneClick={() => {
            setSelected(null)
            setDrillId(null)
            setConeRootId(null)
          }}
          fitView
          minZoom={0.1}
        >
          <Background gap={16} />
          {miniMapOn && <MiniMap nodeColor={nodeColor} pannable zoomable />}
          <Controls />
        </ReactFlow>

        {aiFactExplanation && (
          <ChatPanel
            ref={chatRef}
            facts={graph?.facts ?? []}
            factByPath={factByPath}
            scenarioValues={scenarioValues}
            appLabel={app.label}
            headerBottom={12 + headerHeight}
          />
        )}

        {selected && (
          <DetailPanel
            node={selected}
            factLabel={factLabel}
            rightOffset={embedInset}
            onNavigate={navigateToFact}
            onExplain={aiFactExplanation ? explainNode : undefined}
            scenarioValue={
              scenarioActive && selected.__kind === 'fact'
                ? scenarioValues.get(selected.path)
                : null
            }
            onClose={() => setSelected(null)}
            drilled={!!drillId && selected.id === drillId}
            onToggleDrill={(on) => {
              setDrillId(on ? selected.id : null)
              if (on) setConeRootId(null)
            }}
            coned={!!coneRootId && selected.id === coneRootId}
            onToggleCone={(on) => {
              setConeRootId(on ? selected.id : null)
              if (on) setDrillId(null)
            }}
          />
        )}
      </div>

      {/* The exact same <taxpert-scenario-modal> credit-assistant's Product Experience uses —
          opens off the global nav's Scenario button (SCENARIO_DESTINATIONS includes
          'fact-explorer'; the element self-wires to nav-tool-select). Its Reset/Copy/Paste/
          Generate sections assume a live credit-assistant session (window.factGraph,
          window.loadFactGraph) that doesn't exist here; only "Load existing scenario" is
          functional in Fact Explorer, via the window.loadFactGraph shim above. */}
      <ScenarioModal
        scenarioOptions={scenarioOptions}
        scenarioFilters={scenarioFilters}
        aiScenarioGeneration={aiScenarioGeneration}
      />

      {/* The same <taxpert-display-modal> a Form Builder app opens from the nav's Display button,
          carrying Fact Explorer's own choices rather than a flow page's. */}
      <DisplayOptions
        revealSkipped={revealSkipped}
        onRevealSkipped={setRevealSkipped}
        miniMap={miniMapOn}
        onMiniMap={setMiniMapOverride}
        sideBySide={sideBySide}
        onSideBySide={setSideBySide}
        orientation={orientation}
        onOrientation={setOrientation}
        onResetLayout={resetLayout}
      />
    </div>
  )
}

FactExplorer.propTypes = {
  app: PropTypes.shape({
    id: PropTypes.string,
    label: PropTypes.string,
    storagePrefix: PropTypes.string,
  }).isRequired,
}
