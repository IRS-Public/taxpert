// Scope the graph to one region: a flow page (partitioned by flowElement.pageId),
// a fact-dictionary file (by fact.sourceFile), or everything. A pure FGM to sub-FGM
// stage whose output still passes validate().
//
// A slice is the selected partition ("focus") plus, optionally, its direct edge
// neighbours, tagged __context so the canvas dims them.
// The full narrowing chain: ../../../../docs/internals/fact-explorer-internals.md

export const FULL_KEY = 'full'

const pageKey = (id) => `page::${id}`
const fileKey = (file) => `file::${file}`

const baseName = (file) => (file || '').replace(/\.xml$/, '')

/**
 * Derive the slice-picker options from the graph itself.
 * @param {import('./fgm.js').FormBuilderGraph} graph
 * @returns {{key:string, group:string, label:string}[]}
 */
export function buildSliceOptions(graph) {
  const opts = []

  // One option per flow page, in document order, counted by owned elements.
  const elsByPage = new Map()
  for (const e of graph.flowElements) {
    elsByPage.set(e.pageId, (elsByPage.get(e.pageId) ?? 0) + 1)
  }
  for (const p of graph.flowPages) {
    const n = elsByPage.get(p.id) ?? 0
    opts.push({
      key: pageKey(p.id),
      group: 'Flow pages',
      label: `${baseName(p.sourceFile) || p.route} (${n})`,
    })
  }

  // One option per fact file, busiest first.
  const factsByFile = new Map()
  for (const f of graph.facts) {
    factsByFile.set(f.sourceFile, (factsByFile.get(f.sourceFile) ?? 0) + 1)
  }
  for (const [file, n] of [...factsByFile.entries()].sort((a, b) => b[1] - a[1])) {
    if (!file) continue
    opts.push({ key: fileKey(file), group: 'Fact files', label: `${file} (${n})` })
  }

  const total = graph.flowElements.length + graph.facts.length
  opts.push({ key: FULL_KEY, group: '', label: `Full graph (${total} nodes)` })

  return opts
}

/** The default slice: the first flow page (never the full graph). */
export function defaultSliceKey(graph) {
  if (graph.flowPages.length) return pageKey(graph.flowPages[0].id)
  if (graph.facts.length) return fileKey(graph.facts[0].sourceFile)
  return FULL_KEY
}

/** Node ids that make up the *focus* set for a given selection key. */
function focusIdsFor(graph, key) {
  if (key.startsWith('page::')) {
    const pageId = key.slice('page::'.length)
    return new Set(graph.flowElements.filter((e) => e.pageId === pageId).map((e) => e.id))
  }
  if (key.startsWith('file::')) {
    const file = key.slice('file::'.length)
    return new Set(graph.facts.filter((f) => f.sourceFile === file).map((f) => f.id))
  }
  return null // full graph — handled by caller
}

const EMPTY_GRAPH_META = (graph) => ({
  version: graph.version,
  generatedAt: graph.generatedAt,
  taxYear: graph.taxYear,
})

/**
 * Reduce the full graph to the subgraph for `key`.
 * @param {import('./fgm.js').FormBuilderGraph} graph
 * @param {string} key                 a key from buildSliceOptions()
 * @param {{neighbors?:boolean}} [opts] include +1-hop context nodes (default true)
 * @returns {import('./fgm.js').FormBuilderGraph} a valid sub-FGM
 */
export function sliceGraph(graph, key, { neighbors = true } = {}) {
  const focus = key ? focusIdsFor(graph, key) : null
  if (!focus) return graph // full graph (or unknown key): render everything

  // Grow the visible set by one hop along edges, if requested.
  const visible = new Set(focus)
  if (neighbors) {
    for (const e of graph.edges) {
      if (focus.has(e.source)) visible.add(e.target)
      if (focus.has(e.target)) visible.add(e.source)
    }
  }

  // Flag everything outside the focus set as dimmed context.
  const tag = (n) => ({ ...n, __context: !focus.has(n.id) })

  return {
    ...EMPTY_GRAPH_META(graph),
    flowPages: graph.flowPages, // not rendered as nodes; kept for validate()
    flowElements: graph.flowElements.filter((e) => visible.has(e.id)).map(tag),
    facts: graph.facts.filter((f) => visible.has(f.id)).map(tag),
    edges: graph.edges.filter((e) => visible.has(e.source) && visible.has(e.target)),
  }
}
