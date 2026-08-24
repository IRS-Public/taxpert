// What a taxpayer who loaded a given scenario would and would not see: which flow
// elements show, which knockouts are active, which facts their answers touch.
//
// The two evaluators are injected rather than imported, so this stays node-testable
// with a fake engine (engine.js builds the real ones). Callers fold the returned
// status onto node.data, and in hide mode run scenarioFilter().
// The scenario overlay end to end: ../../../../docs/internals/fact-explorer-internals.md

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
 *   status  keyed by node id, both flow element ids and fact ids.
 *   values  keyed by fact path, for every "seen" fact.
 */
export function computeVisibility(fgm, { evalCond, factState }) {
  const elById = new Map(fgm.flowElements.map((e) => [e.id, e]))

  // An element with a condition/operator shows iff the condition holds (evalCond
  // defaults to true), and an element under a hidden container is hidden too.
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
    if (seen.has(el.id)) return true // a cycle in parentId must not loop
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

  // Seed from visible flow elements, then propagate transitively over `depends`:
  // a seen derived fact pulls in the facts it depends on.
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
