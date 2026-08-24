// The structural hide companion to computeVisibility(): given its status map, drop
// the nodes a taxpayer would not see and any edge left dangling. Runs before the
// slice chain, and only when the overlay is in hide mode. Dim mode leaves the graph
// intact and decorates node.data instead.
//
// Overlay modes: ../../../../docs/internals/fact-explorer-internals.md
import { HIDDEN_STATUSES } from './visibility.js'

/**
 * @param {import('./fgm.js').FormBuilderGraph} fgm
 * @param {Map<string,string>} status node id -> status (computeVisibility().status)
 * @returns {import('./fgm.js').FormBuilderGraph}
 */
export function scenarioFilter(fgm, status) {
  if (!status || status.size === 0) return fgm

  const keep = (id) => !HIDDEN_STATUSES.has(status.get(id))

  const flowElements = fgm.flowElements.filter((e) => keep(e.id))
  const facts = fgm.facts.filter((f) => keep(f.id))

  const keptIds = new Set([...flowElements.map((e) => e.id), ...facts.map((f) => f.id)])
  // A page survives only if one of its elements did, so the slice picker stays honest.
  const flowPages = fgm.flowPages.filter((p) => p.elementIds?.some((id) => keptIds.has(id)))
  for (const p of flowPages) keptIds.add(p.id)

  const edges = fgm.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target))

  return { ...fgm, flowPages, flowElements, facts, edges }
}
