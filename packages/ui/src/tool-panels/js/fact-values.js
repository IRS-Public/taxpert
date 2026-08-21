// Everything the workspace tools need to read out of the host's fact graph, in one place.
//
// The graph is the host's, not ours: credit-assistant builds it from the Scala.js bundle and
// fact-explorer may have none at all. So nothing here touches `window.factGraph` — it goes
// through `config.graph`, the port graph-adapter.js documents, whose default reproduces exactly the
// window-graph behaviour this module used to hard-code. A host with a different graph supplies its
// own adapter and every tool follows.
//
// The port is *defensive by contract*: paths(), get() and getDefinition() answer empty rather than
// throwing, because the tools re-read on every `fg-update` — which fires on every keystroke — and an
// exception out of here lands in a render loop. That is why the local safely() below now wraps only
// the two things the port does not own: `fact.get`, the value accessor on whatever object the host's
// graph hands back, and String(raw) on that value.
//
// The port surface used, and nothing more:
//   graph.paths()                 → every abstract path in the dictionary, sorted
//   graph.getCollectionIds(root)  → the item ids currently in a collection
//   graph.get(concretePath)       → { complete, hasValue, get } | null
//   graph.getDefinition(path)     → { typeNode } | null

import { watchPath } from './watchlist-store.js'
import { getConfig } from '../../shared/js/config.js'

/**
 * The document events that mean "a fact may have changed". Tools re-read on either.
 *
 * A function rather than the const array it used to be, because the answer now comes from the host's
 * adapter and must be read late — see the read-late note in config.js. An element that subscribes
 * should keep the list it subscribed with so it unsubscribes from the same events.
 */
export function factChangeEvents () {
  return getConfig().graph.changeEvents
}

/**
 * Subscribe `handler` to those events on `document`, and answer the unsubscribe.
 *
 * Every tool panel wants the same three lines in connectedCallback and their mirror in
 * disconnectedCallback, and now that the event names are the host's the mirror can no longer just
 * ask again: a configure() in between would leave the old listeners attached for good. So the list
 * is read once, at subscribe, and closed over.
 */
export function onFactChange (handler) {
  const types = factChangeEvents()
  for (const type of types) document.addEventListener(type, handler)
  return () => {
    for (const type of types) document.removeEventListener(type, handler)
  }
}

/** The host's fact-graph port. Read through a function so it is never captured at import time. */
export function graphPort () {
  return getConfig().graph
}

/** Every abstract fact path the dictionary knows, sorted. Empty until the graph loads. */
export function factPaths () {
  return safely(() => graphPort().paths()) ?? []
}

/**
 * Every collection item id currently in the graph, across every collection, sorted and deduped.
 *
 * The graph exposes ids one collection at a time, so the collection roots are recovered from the
 * dictionary's own wildcard paths: `/household/*\/firstName` names the root `/household`. That is
 * the same derivation the Fact Inspector asked the user to do by hand in a free-text box.
 *
 * A root that is not a collection the host's persister knows about is an ordinary answer, not an
 * error — same reasoning as readFact(): a host adapter is contracted to be defensive, but this must
 * not depend on it.
 */
export function collectionIds () {
  const graph = graphPort()

  const roots = new Set()
  for (const path of factPaths()) {
    const at = path.indexOf('/*')
    if (at > 0) roots.add(path.slice(0, at))
  }

  const ids = new Set()
  for (const root of roots) {
    for (const id of safely(() => graph.getCollectionIds(root)) ?? []) ids.add(id)
  }
  return [...ids].sort()
}

/**
 * A watchlist entry's current state, in the shape a row renders from.
 *
 * `status` is what the row's icon and its wording key off:
 *   'complete'   settled, with a value           → green check
 *   'false'      settled, and the answer is no   → red cross (a settled `false` is a real outcome,
 *                                                  not a missing one, and the designs draw it apart)
 *   'incomplete' still waiting on an answer      → the part-drawn ring
 *   'unknown'    no graph, or the path is gone   → the part-drawn ring, said plainly
 *
 * `raw` is the graph's own value, undecorated — the Outcome tracker maps a filing-status enum onto
 * its own wording and has to tell a boolean apart from a string, neither of which survives
 * `formatValue`. `null` whenever there is nothing to report.
 *
 * `value` and `literal` are the same number said two ways: `value` is the reading-copy form the
 * Watchlist and the Outcome tracker show (a boolean is Yes/No, a dollar is $500), and `literal` is
 * the fact graph's own (true/false, 500.00) — which is what Inspect prints, because Inspect is where
 * you go to read the fact rather than the answer.
 *
 * @param {{path: string, collectionId: string}} entry
 * @returns {{path: string, collectionId: string, concretePath: string, status: string,
 *            value: string, literal: string, raw: *, typeLabel: string}}
 */
export function readFact (entry) {
  const concretePath = watchPath(entry)
  const base = {
    ...entry,
    concretePath,
    status: 'unknown',
    value: 'Unavailable',
    literal: 'Unavailable',
    raw: null,
    typeLabel: '',
  }

  // Wrapped even though the port is *contracted* to be defensive. windowFactGraphAdapter() honours
  // that, but a host may hand in a thin wrapper over a graph that throws on unknown paths — the
  // Scala.js one does — and readFact() runs on every change event, i.e. on every keystroke in the
  // flow. One un-caught throw here takes down a render loop rather than showing 'Unavailable' in a
  // single row. The fixture host caught this; keep it.
  const graph = graphPort()
  const definition = safely(() => graph.getDefinition(entry.path))
  const typeLabel = humanizeType(definition?.typeNode)

  const fact = safely(() => graph.get(concretePath))
  if (!fact) return { ...base, typeLabel }

  if (!fact.complete) {
    return { ...base, typeLabel, status: 'incomplete', value: 'Incomplete', literal: 'Incomplete' }
  }

  const raw = fact.hasValue ? safely(() => fact.get) : null
  return {
    ...base,
    typeLabel,
    raw: raw ?? null,
    status: raw === false ? 'false' : 'complete',
    value: formatValue(raw, definition?.typeNode),
    literal: formatLiteral(raw),
  }
}

// Run `read`, answering undefined rather than throwing. Only for what the port does not cover: the
// `fact.get` accessor and String() on whatever it returns, both of which are the host's own object.
function safely (read) {
  try {
    return read()
  } catch {
    return undefined
  }
}

/**
 * A fact value as the designs write it: booleans as Yes/No, dollars with their sign and without the
 * trailing cents the fact graph always carries ("500.00" → "$500"). Anything else is whatever the
 * value's own toString says, which is how the Fact Inspector card showed it.
 */
export function formatValue (raw, typeNode) {
  if (raw === null || raw === undefined) return '—'
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'

  const text = safely(() => String(raw)) ?? '—'
  if (typeNode?.startsWith('Dollar')) {
    const negative = text.startsWith('-')
    const digits = (negative ? text.slice(1) : text).replace(/\.00$/, '')
    return `${negative ? '-' : ''}$${digits}`
  }
  return text
}

/**
 * A fact value exactly as the fact graph holds it: a boolean is true/false, a dollar keeps its
 * cents, an enum is its own option string. The undecorated counterpart to formatValue above — what
 * `factGraph.debugFact()` prints, and what Inspect shows as the fact's current value.
 */
export function formatLiteral (raw) {
  if (raw === null || raw === undefined) return '—'
  if (typeof raw === 'boolean') return String(raw)
  return safely(() => String(raw)) ?? '—'
}

/**
 * Cut `text` to `limit` characters, ending in an ellipsis. Enum values are the reason: an option
 * string is as long as the copywriter made it, and the Inspect panel's value column is one line.
 */
export function truncate (text, limit = 40) {
  const value = String(text ?? '')
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value
}

// The node names whose plain-English word isn't just the name with 'Node' cut off.
const TYPE_ALIASES = new Map([['Int', 'Integer']])

/** 'DollarNode' → 'Dollar'. The dictionary's node names are the only type the graph exposes. */
export function humanizeType (typeNode) {
  if (!typeNode) return ''
  const name = typeNode.replace(/Node$/, '')
  return TYPE_ALIASES.get(name) ?? name
}
