// Everything the workspace tools read out of the host's fact graph, in one place.
//
// Nothing here touches `window.factGraph`. Every read goes through `config.graph`, the port
// shared/js/graph-adapter.js defines, so a host with a different engine supplies its own adapter and
// every tool follows. Four members of that port are used and no more: paths(), getCollectionIds(),
// get() and getDefinition().
//
// See ../../../../../docs/internals/tool-panels.md

import { watchPath } from './watchlist-store.js'
import { getConfig } from '../../shared/js/config.js'

/** The document events that mean "a fact may have changed". Read late, from the host's adapter. */
export function factChangeEvents () {
  return getConfig().graph.changeEvents
}

/**
 * Subscribe `handler` to those events on `document`, and answer the unsubscribe. The event list is
 * read once and closed over, so a configure() in between cannot strand the listeners.
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
 * Every collection item id currently in the graph, sorted and deduped. The graph exposes ids one
 * collection at a time, so the roots are recovered from the dictionary's own wildcard paths:
 * `/household/*\/firstName` names the root `/household`.
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
 * A fact's current state, in the shape a tool row renders from.
 *
 * `status` is one of 'complete', 'false' (settled and negative, which the designs draw apart from
 * missing), 'incomplete' or 'unknown'. `raw` is the graph's own undecorated value, or null.
 * `value` is the reading-copy form (Yes/No, $500) and `literal` the fact graph's own
 * (true/false, 500.00), which is what Inspect prints.
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

  // Wrapped even though the port is contracted to be defensive: a host may hand in a thin wrapper
  // over a graph that throws on unknown paths, and this runs on every change event. One uncaught
  // throw here takes down a render loop rather than showing 'Unavailable' in a single row.
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
 * A fact value in reading copy: booleans as Yes/No, dollars with their sign and without the trailing
 * cents the fact graph always carries ("500.00" becomes "$500"). Anything else uses its toString.
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
 * A fact value exactly as the fact graph holds it: a boolean is true/false, a dollar keeps its cents,
 * an enum is its own option string. The undecorated counterpart to formatValue.
 */
export function formatLiteral (raw) {
  if (raw === null || raw === undefined) return '—'
  if (typeof raw === 'boolean') return String(raw)
  return safely(() => String(raw)) ?? '—'
}

/** Cut `text` to `limit` characters, ending in an ellipsis. */
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
