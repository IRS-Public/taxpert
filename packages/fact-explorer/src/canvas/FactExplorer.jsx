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
import { loadGraph, loadScenarioIndex } from '../model/load.js'
import { buildSliceOptions, defaultSliceKey, sliceGraph } from '../model/slice.js'
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

function nodeColor(n) {
  return CATEGORY_STYLE[n.data?.category]?.border ?? NODE_FALLBACK.border
}

/**
 * @param {object} props
 * @param {import('../model/apps.js').FactExplorerApp} props.app the Form Builder app being
 *   represented. App.jsx remounts this component on a change of `app.id` rather than threading the
 *   switch through every effect. The graph, the layout cache, the engine, the scenario overlay and
 *   the search index are all per-app, so a remount is the honest way to say so.
 */
export default function FactExplorer({ app }) {
  const [graph, setGraph] = useState(null)
  const [error, setError] = useState(null)
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

  useEffect(() => {
    loadGraph(app)
      .then(setGraph)
      .catch((e) => setError(e.message))
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
    const engine = await loadEngine(app)
    const sg = buildScenarioGraph(engine, json)
    const { status, values } = computeVisibility(graph, makeEvaluators(sg))
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

  // Auto-focus on first load. The `fitView` prop only fits when the ReactFlow
  // instance initializes, but our nodes are populated one render later (via the
  // setNodes effect), so that initial fit finds an empty canvas and the view is
  // left parked at the origin/bottom. Once the nodes have actually been measured
  // (useNodesInitialized), do a one-shot fitView. Subsequent slice/cone/drill
  // changes remount ReactFlow via its `key`, where the `fitView` prop takes over.
  const nodesInitialized = useNodesInitialized()
  const didFitRef = useRef(false)
  useEffect(() => {
    if (nodesInitialized && !didFitRef.current) {
      didFitRef.current = true
      rf.fitView({ duration: 400 })
    }
  }, [nodesInitialized, rf])

  const sliceOptions = useMemo(() => (graph ? buildSliceOptions(graph) : []), [graph])

  // The identity facets for this graph, and the effective selection over them. defaultFacets() is
  // total, so this is safe to read before the graph has loaded.
  const facetDefaults = useMemo(() => defaultFacets(graph), [graph])
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
  function navigateToFact(path) {
    const fact = factByPath.get(path)
    if (!fact) return
    setSelected({ ...fact, __kind: 'fact' })
    centreOn(`fact:${path}`)
  }

  // "Explain this node": dispatch on the FGM node kind, build the structured
  // context (+ the fact paths whose live dependency trees ride along), and hand
  // it to the chat dock. Facts reuse the dependency-tree path the chat already
  // walks; flow elements add their binding/gate/alert metadata + 1-hop neighbours.
  function explainNode(node) {
    if (!node || !graph || !chatRef.current) return
    if (node.__kind === 'fact') {
      chatRef.current.explain({
        prompt: `Explain the fact \`${node.path}\`: what it computes, how it is derived from its dependencies, and its current value under the loaded scenario.`,
        trackedPaths: [node.path],
        context: { kind: 'fact', path: node.path },
      })
      return
    }
    // flow element
    const context = buildFlowContext(node, graph, { scenarioValues, scenarioStatus })
    const label = node.questionText || node.headingText || node.alert?.alertKey || node.tag
    chatRef.current.explain({
      prompt: `Explain this flow element (${node.tag} — "${label}"): what it does, the fact it binds or gates on, and how its 1-hop neighbours determine whether it shows or knocks the taxpayer out.`,
      trackedPaths: flowTrackedPaths(context),
      context,
    })
  }

  // Scenario-level summary: does the taxpayer reach the end of the flow, and if
  // not, exactly where/why are they disqualified? Reads the scenario overlay.
  function summarizeScenario() {
    if (!graph || !chatRef.current || !scenario) return
    const context = buildScenarioSummary(graph, scenarioStatus, scenarioValues, scenario.filename)
    const trackedPaths = context.activeKnockouts.map((k) => k.boundFactPath).filter(Boolean)
    chatRef.current.explain({
      prompt: `Summarize the outcome of scenario "${scenario.filename}". Does the taxpayer reach the end of the ${app.label} flow? If not, name exactly where (which knockout) and why they are disqualified, citing the decisive fact and its value.`,
      trackedPaths,
      context,
    })
  }

  // Default to the first flow page once the graph loads, never the full graph.
  useEffect(() => {
    if (graph && sliceKey === null) setSliceKey(defaultSliceKey(graph))
  }, [graph, sliceKey])

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
    if (coneRootId) return coneGraph(graph, coneRootId)
    if (drillId) return drillGraph(graph, drillId)
    const source =
      scenarioMode === 'hide' && scenarioStatus.size > 0
        ? scenarioFilter(graph, scenarioStatus)
        : graph
    return facetGraph(filterGraph(sliceGraph(source, sliceKey, { neighbors }), filters), facets)
  }, [
    graph,
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
    setEdges(base.edges)
  }, [decoratedNodes, base.edges, setNodes, setEdges])

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

  const facetSig = [
    facets.knockoutsOnly,
    facets.flowTags.join(','),
    facets.factKinds.join(','),
    facets.edgeKinds.join(','),
  ].join('|')

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

        <ReactFlow
          key={`cone:${coneRootId ?? ''}|drill:${drillId ?? ''}|${sliceKey}|${neighbors}|${filters.flow}${filters.facts}${filters.edges}|${facetSig}|${orientation}|${layoutVersion}|scn:${scenarioMode}:${scenario?.filename ?? ''}`}
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
          <MiniMap nodeColor={nodeColor} pannable zoomable />
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
