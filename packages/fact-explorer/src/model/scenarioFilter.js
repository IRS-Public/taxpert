// Pure structural hide stage (N3) — the "hide" companion to computeVisibility().
//
// A pure FGM→FGM filter, like sliceGraph/filterGraph/facetGraph: given a status
// map (from computeVisibility), drop the nodes a user wouldn't see and any edge
// left dangling, returning a valid sub-FGM that still passes validate(). This is
// the all-screens-style "only what they see" view. The default overlay mode is
// "dim" (which leaves the graph intact and only decorates node.data); "hide"
// runs this stage before the slice chain.
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
  // Flow pages survive if any of their elements survived (keeps the slice picker
  // honest); an empty page is dropped.
  const flowPages = fgm.flowPages.filter((p) => p.elementIds?.some((id) => keptIds.has(id)))
  for (const p of flowPages) keptIds.add(p.id)

  const edges = fgm.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target))

  return { ...fgm, flowPages, flowElements, facts, edges }
}
