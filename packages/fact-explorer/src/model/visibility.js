// Pure scenario-visibility computation (N3).
//
// Given an FGM and two *injected* evaluators (so this module is node-testable
// with a fake engine — see engine.js for the real ones), compute what a user who
// loaded a given scenario would and wouldn't see. This is the graph-form of the
// audit panel's showOrHideAllElements() (fg-conditions.js) plus the FGM edge
// model: which flow elements are shown/hidden, which knockouts are active, and
// which facts the user's answers actually touch.
//
// Like slice/filter/facets, this is pure — no React, no engine import. The
// caller folds the returned status onto node.data (the same idiom as
// match/searchDim/__context) and, in "hide" mode, runs scenarioFilter().

/** Flow-element statuses. */
export const FLOW_STATUS = {
  visible: 'visible',
  hidden: 'hidden',
  knockoutActive: 'knockout-active',
  knockoutInactive: 'knockout-inactive',
}

/** Fact statuses. */
export const FACT_STATUS = { seen: 'seen', unseen: 'unseen' }

// Flow→fact edge kinds that mean "this element brings this fact into view".
const SEEN_SEED_KINDS = new Set(['binds', 'shows', 'displays', 'gates', 'knocks-out'])

/**
 * @param {import('./fgm.js').FormBuilderGraph} fgm
 * @param {{ evalCond:(path:string,op:string)=>boolean, factState:(path:string)=>{hasValue:boolean,value:any,complete:boolean} }} evaluators
 * @returns {{ status: Map<string,string>, values: Map<string,object> }}
 *   status — keyed by node id (flow element ids AND fact ids).
 *   values — keyed by fact path, for every "seen" fact.
 */
export function computeVisibility(fgm, { evalCond, factState }) {
  const elById = new Map(fgm.flowElements.map((e) => [e.id, e]))

  // ── 1. Effective visibility of each flow element ────────────────────────────
  // An element with a [condition][operator] is shown iff the condition holds
  // (default-to-true lives in evalCond). An element nested under a hidden
  // container is hidden too — the parent→child hide showOrHideAllElements() does.
  const ownVisibleCache = new Map()
  const ownVisible = (el) => {
    if (ownVisibleCache.has(el.id)) return ownVisibleCache.get(el.id)
    const c = el.condition
    const v = c && c.factPath && c.operator ? !!evalCond(c.factPath, c.operator) : true
    ownVisibleCache.set(el.id, v)
    return v
  }

  const effVisibleCache = new Map()
  const effVisible = (el, seen = new Set()) => {
    if (effVisibleCache.has(el.id)) return effVisibleCache.get(el.id)
    if (seen.has(el.id)) return true // defensive: cycle in parentId, don't loop
    seen.add(el.id)
    const parent = el.parentId ? elById.get(el.parentId) : null
    const v = ownVisible(el) && (parent ? effVisible(parent, seen) : true)
    effVisibleCache.set(el.id, v)
    return v
  }

  const status = new Map()
  for (const el of fgm.flowElements) {
    const visible = effVisible(el)
    if (el.tag === 'fg-alert' && el.alert?.knockout) {
      status.set(el.id, visible ? FLOW_STATUS.knockoutActive : FLOW_STATUS.knockoutInactive)
    } else {
      status.set(el.id, visible ? FLOW_STATUS.visible : FLOW_STATUS.hidden)
    }
  }

  // ── 2. Which facts are "seen" ───────────────────────────────────────────────
  // Seed: a visible flow element binds/shows/displays/gates/knocks-out the fact.
  // Then propagate transitively over `depends` edges (a seen derived fact pulls
  // in the facts it depends on).
  const factPathById = new Map(fgm.facts.map((f) => [f.id, f.path]))
  const dependsBySource = new Map() // factId -> [dependency factId]
  for (const e of fgm.edges) {
    if (e.kind !== 'depends') continue
    if (!dependsBySource.has(e.source)) dependsBySource.set(e.source, [])
    dependsBySource.get(e.source).push(e.target)
  }

  const seenFactIds = new Set()
  for (const e of fgm.edges) {
    if (!SEEN_SEED_KINDS.has(e.kind)) continue
    const el = elById.get(e.source)
    if (el && effVisible(el) && factPathById.has(e.target)) seenFactIds.add(e.target)
  }

  // BFS over depends edges.
  const queue = [...seenFactIds]
  while (queue.length) {
    const id = queue.shift()
    for (const dep of dependsBySource.get(id) ?? []) {
      if (!seenFactIds.has(dep) && factPathById.has(dep)) {
        seenFactIds.add(dep)
        queue.push(dep)
      }
    }
  }

  // ── 3. Fact statuses + live values for seen facts ───────────────────────────
  const values = new Map()
  for (const f of fgm.facts) {
    const seen = seenFactIds.has(f.id)
    status.set(f.id, seen ? FACT_STATUS.seen : FACT_STATUS.unseen)
    if (seen) values.set(f.path, factState(f.path))
  }

  return { status, values }
}

/** Statuses that the "hide" mode drops from the canvas (scenarioFilter). */
export const HIDDEN_STATUSES = new Set([
  FLOW_STATUS.hidden,
  FLOW_STATUS.knockoutInactive,
  FACT_STATUS.unseen,
])
