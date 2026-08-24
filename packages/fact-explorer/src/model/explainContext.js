// Pure builders for the "Explain this node" feature (no React, no fetch, so they
// stay node-testable, per CLAUDE.md rule #8).
//
// They turn an FGM node + the active scenario overlay into the structured
// `context` payload the FastAPI /chat agent reasons over, plus the flat list of
// fact paths whose live dependency trees ride along as `tracked_facts`.
//
//  - Fact node   → the bounded dependency tree (fact-explorer's debugFactRecurse()).
//  - Flow element → its binding/gate/alert metadata + bound fact + 1-hop neighbours.
//  - Scenario     → where (if anywhere) the taxpayer is knocked out vs. reaches the end.
//
// buildFactTree / buildTrackedFacts / factValue were lifted verbatim out of
// ChatPanel.jsx so both the manual fact picker and the explain dispatcher share
// one implementation.
import { FLOW_STATUS } from './visibility.js'

// Mirror audit-panel.js: keep the attached dependency tree bounded so a deeply
// nested fact doesn't blow up the prompt.
export const FACT_TREE_MAX_DEPTH = 4
export const FACT_TREE_MAX_NODES = 50

// Current value/completeness of a fact under the active scenario overlay. Returns
// nulls when no scenario is loaded or the fact wasn't "seen".
export function factValue(path, scenarioValues) {
  const v = scenarioValues?.get(path)
  if (v && v.hasValue) return { value: String(v.value), complete: !!v.complete }
  return { value: null, complete: false }
}

// Recursively resolve a fact + its (non-wildcard) dependencies to current values,
// bounded by depth/node count. ``seen`` guards against cycles/repeats.
export function buildFactTree(path, depth, counter, seen, factByPath, scenarioValues) {
  if (depth > FACT_TREE_MAX_DEPTH || counter.n >= FACT_TREE_MAX_NODES) return null
  if (seen.has(path)) return { path, repeated: true }
  seen.add(path)
  counter.n++

  const { value, complete } = factValue(path, scenarioValues)
  const node = { path, value, complete }

  const fact = factByPath.get(path)
  const children = []
  for (const dep of fact?.dependencyPaths ?? []) {
    if (counter.n >= FACT_TREE_MAX_NODES) break
    if (dep.wildcard) continue // can't resolve abstract collection paths statically
    const child = buildFactTree(
      dep.resolvedAbstract,
      depth + 1,
      counter,
      seen,
      factByPath,
      scenarioValues
    )
    if (child) children.push(child)
  }
  if (children.length) node.dependencies = children
  return node
}

export function buildTrackedFacts(paths, factByPath, scenarioValues) {
  return paths.map((path) => {
    const { value, complete } = factValue(path, scenarioValues)
    const tree = buildFactTree(path, 0, { n: 0 }, new Set(), factByPath, scenarioValues)
    return { path, value, complete, dependencies: tree?.dependencies ?? [] }
  })
}

// ── flow-element context ─────────────────────────────────────────────────────

// Whittle a flow element down to the fields the agent cares about (drops the bulky
// rawXml and internal layout fields).
function elementMeta(el) {
  return {
    id: el.id,
    tag: el.tag,
    pageId: el.pageId,
    factPath: el.factPath ?? null,
    inputType: el.inputType ?? null,
    optionsPath: el.optionsPath ?? null,
    gate: el.gate ?? null,
    condition: el.condition ?? null,
    alert: el.alert ?? null,
    collection: el.collection ?? null,
    fgShowPaths: el.fgShowPaths ?? [],
    questionText: el.questionText ?? null,
    headingText: el.headingText ?? null,
  }
}

/**
 * Structured context for a flow element: its own metadata, the live tree of the
 * fact it binds, and its 1-hop neighbours (facts + other flow nodes) reached over
 * the FGM edges. Pure: every lookup is derived from `graph`.
 *
 * @param {object} el  the FGM flow element (node.data.raw with __kind 'flow')
 * @param {import('./fgm.js').FormBuilderGraph} graph
 * @param {{ scenarioValues?: Map<string,object>, scenarioStatus?: Map<string,string> }} overlay
 */
export function buildFlowContext(el, graph, { scenarioValues, scenarioStatus } = {}) {
  const factById = new Map(graph.facts.map((f) => [f.id, f]))
  const factByPath = new Map(graph.facts.map((f) => [f.path, f]))
  const elById = new Map(graph.flowElements.map((e) => [e.id, e]))

  const oneHopFacts = []
  const oneHopFlow = []
  const seenNeighbor = new Set()
  for (const edge of graph.edges) {
    let otherId = null
    if (edge.source === el.id) otherId = edge.target
    else if (edge.target === el.id) otherId = edge.source
    if (!otherId || seenNeighbor.has(otherId)) continue
    seenNeighbor.add(otherId)

    const f = factById.get(otherId)
    if (f) {
      const { value, complete } = factValue(f.path, scenarioValues)
      oneHopFacts.push({ path: f.path, kind: f.kind, value, complete, via: edge.kind })
      continue
    }
    const nb = elById.get(otherId)
    if (nb && nb.id !== el.id) {
      oneHopFlow.push({
        id: nb.id,
        tag: nb.tag,
        alertKey: nb.alert?.alertKey ?? null,
        knockout: nb.alert?.knockout ?? false,
        scenarioStatus: scenarioStatus?.get(nb.id) ?? null,
        via: edge.kind,
      })
    }
  }

  const boundFact = el.factPath
    ? buildFactTree(el.factPath, 0, { n: 0 }, new Set(), factByPath, scenarioValues)
    : null

  return {
    kind: 'flow',
    element: elementMeta(el),
    scenarioStatus: scenarioStatus?.get(el.id) ?? null,
    boundFact,
    oneHopFacts,
    oneHopFlow,
  }
}

// Fact paths whose dependency trees should ride along in tracked_facts for a flow
// explain: the bound fact + every 1-hop fact.
export function flowTrackedPaths(context) {
  const paths = []
  if (context.element?.factPath) paths.push(context.element.factPath)
  for (const f of context.oneHopFacts ?? []) paths.push(f.path)
  return [...new Set(paths)]
}

// ── scenario summary ─────────────────────────────────────────────────────────

// For a knockout alert element, the fact whose value triggered it: its gating
// condition fact, else any fact it `knocks-out`/`gates` over the edges.
function knockoutFactPath(el, graph, factById) {
  if (el.condition?.factPath) return el.condition.factPath
  for (const e of graph.edges) {
    if (e.source !== el.id) continue
    if (e.kind === 'knocks-out' || e.kind === 'gates') {
      const f = factById.get(e.target)
      if (f) return f.path
    }
  }
  return null
}

/**
 * Walk the scenario overlay for active knockouts. If there are none the taxpayer
 * reaches the end of the flow; otherwise each active knockout names where and why
 * they're disqualified. Pure.
 *
 * @param {import('./fgm.js').FormBuilderGraph} graph
 * @param {Map<string,string>} scenarioStatus  node id → status (computeVisibility)
 * @param {Map<string,object>} scenarioValues  fact path → {hasValue,value,complete}
 * @param {string|null} filename
 */
export function buildScenarioSummary(graph, scenarioStatus, scenarioValues, filename = null) {
  const elById = new Map(graph.flowElements.map((e) => [e.id, e]))
  const factById = new Map(graph.facts.map((f) => [f.id, f]))

  const activeKnockouts = []
  for (const [id, st] of scenarioStatus) {
    if (st !== FLOW_STATUS.knockoutActive) continue
    const el = elById.get(id)
    if (!el) continue
    const boundFactPath = knockoutFactPath(el, graph, factById)
    const { value } = boundFactPath ? factValue(boundFactPath, scenarioValues) : { value: null }
    activeKnockouts.push({
      id: el.id,
      pageId: el.pageId,
      alertKey: el.alert?.alertKey ?? null,
      boundFactPath,
      value,
    })
  }

  let seenFactCount = 0
  for (const v of scenarioValues?.values() ?? []) if (v?.hasValue) seenFactCount++

  return {
    kind: 'scenario',
    filename,
    reachedEnd: activeKnockouts.length === 0,
    activeKnockouts,
    seenFactCount,
  }
}
