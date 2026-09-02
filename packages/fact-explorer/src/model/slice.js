// Scope the graph to one region: a flow module (partitioned by flowPage.sourceFile,
// via flowElement.pageId), a fact-dictionary file (by fact.sourceFile), or everything.
// A pure FGM to sub-FGM stage whose output still passes validate().
//
// A flow module is a group of pages, not one — the generator cuts a subcategory into
// a `<page>` per screen run within one XML file, so a single sourceFile like
// `you-and-your-family-about-you.xml` owns a dozen pageIds. The picker groups by that
// file rather than by page: layout.js already lays out a multi-page slice as
// consecutive document-ordered runs (that's what the +1-hop neighbour case
// exercises), so nothing downstream assumed one page per slice — grouping here is
// purely which pageIds land in the focus set.
//
// A slice is the selected partition ("focus") plus, optionally, its direct edge
// neighbours, tagged __context so the canvas dims them.
// The full narrowing chain: ../../../../docs/internals/fact-explorer-internals.md

export const FULL_KEY = 'full'

const pageFileKey = (file) => `pagefile::${file}`
const fileKey = (file) => `file::${file}`

const baseName = (file) => (file || '').replace(/\.xml$/, '')

/** The key a flow page groups under: its source file, or its own route when that's missing. */
const pageGroupOf = (p) => p.sourceFile || p.route

/**
 * Derive the slice-picker options from the graph itself.
 * @param {import('./fgm.js').FormBuilderGraph} graph
 * @returns {{key:string, group:string, label:string}[]}
 */
export function buildSliceOptions(graph) {
  const opts = []

  // One option per flow module (source file), in document order, counted by owned
  // elements across every page the file was cut into.
  const elsByPage = new Map()
  for (const e of graph.flowElements) {
    elsByPage.set(e.pageId, (elsByPage.get(e.pageId) ?? 0) + 1)
  }
  const pagesByFile = new Map() // group key -> pages, in first-seen (document) order
  for (const p of graph.flowPages) {
    const group = pageGroupOf(p)
    if (!pagesByFile.has(group)) pagesByFile.set(group, [])
    pagesByFile.get(group).push(p)
  }
  for (const [group, pages] of pagesByFile) {
    const n = pages.reduce((sum, p) => sum + (elsByPage.get(p.id) ?? 0), 0)
    opts.push({
      key: pageFileKey(group),
      group: 'Flow pages',
      label: `${baseName(pages[0].sourceFile) || group} (${n})`,
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

/** The default slice: the first flow module (never the full graph). */
export function defaultSliceKey(graph) {
  if (graph.flowPages.length) return pageFileKey(pageGroupOf(graph.flowPages[0]))
  if (graph.facts.length) return fileKey(graph.facts[0].sourceFile)
  return FULL_KEY
}

/** Node ids that make up the *focus* set for a given selection key. */
function focusIdsFor(graph, key) {
  if (key.startsWith('pagefile::')) {
    const group = key.slice('pagefile::'.length)
    const pageIds = new Set(
      graph.flowPages.filter((p) => pageGroupOf(p) === group).map((p) => p.id)
    )
    return new Set(graph.flowElements.filter((e) => pageIds.has(e.pageId)).map((e) => e.id))
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
  // Carried through. Each of these three stages advertises "a valid sub-FGM", and validate()
  // rejects a flow tag it was not told about, so dropping the app's declared tags made a slice of
  // tax-withholding-estimator fail its own contract. Nothing re-validated a slice in place, so it
  // went unnoticed until a slice became a file load.js fetches and validates like any other graph.
  // filterGraph and facetGraph, which run after these, have always carried it.
  flowTags: graph.flowTags,
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
