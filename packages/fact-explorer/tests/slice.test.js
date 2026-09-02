import { describe, it, expect } from 'vitest'
import {
  buildSliceOptions,
  defaultSliceKey,
  sliceGraph,
  sliceKeyForNode,
  FULL_KEY,
} from '../src/model/slice.js'
import { validate } from '../src/model/fgm.js'
import { loadMock, loadAllReal } from './_fixtures.js'

describe('slice', () => {
  const mock = loadMock()

  it('defaults to the first flow module, never the full graph', () => {
    const key = defaultSliceKey(mock)
    expect(key).not.toBe(FULL_KEY)
    expect(key).toBe(`pagefile::${mock.flowPages[0].sourceFile}`)
  })

  it('builds grouped options that include every flow module (one per source file) and the full graph', () => {
    const opts = buildSliceOptions(mock)
    expect(opts.some((o) => o.key === FULL_KEY)).toBe(true)
    const sourceFiles = new Set(mock.flowPages.map((p) => p.sourceFile))
    for (const file of sourceFiles) {
      expect(opts.some((o) => o.key === `pagefile::${file}`)).toBe(true)
    }
    // one option per distinct source file, not per page — the fixture happens to be 1:1, so this
    // only proves grouping doesn't fan a single-page file out into duplicates.
    const flowPageOpts = opts.filter((o) => o.group === 'Flow pages')
    expect(flowPageOpts.length).toBe(sourceFiles.size)
  })

  it('a flow-module slice yields a valid sub-FGM scoped to every page cut from that file', () => {
    const key = defaultSliceKey(mock)
    const file = key.slice('pagefile::'.length)
    const pageIds = new Set(mock.flowPages.filter((p) => p.sourceFile === file).map((p) => p.id))
    const g = sliceGraph(mock, key, { neighbors: false })
    expect(() => validate(g)).not.toThrow()
    // with neighbors off, every flow node belongs to one of the file's pages (focus only)
    expect(g.flowElements.every((e) => pageIds.has(e.pageId))).toBe(true)
  })

  it('+1 hop adds dimmed context nodes beyond the focus set', () => {
    const key = defaultSliceKey(mock)
    const focusOnly = sliceGraph(mock, key, { neighbors: false })
    const withHop = sliceGraph(mock, key, { neighbors: true })
    const total = (g) => g.flowElements.length + g.facts.length
    expect(total(withHop)).toBeGreaterThanOrEqual(total(focusOnly))
    // context nodes are flagged so the canvas can dim them
    const ctx = [...withHop.flowElements, ...withHop.facts].filter((n) => n.__context)
    expect(ctx.length).toBeGreaterThan(0)
  })

  it('the full-graph key returns everything', () => {
    const g = sliceGraph(mock, FULL_KEY, { neighbors: true })
    expect(g.flowElements.length).toBe(mock.flowElements.length)
    expect(g.facts.length).toBe(mock.facts.length)
  })
})

describe('slice.sliceKeyForNode', () => {
  const mock = loadMock()

  // The property the search jump depends on: the key it returns must be one the picker offers,
  // and slicing on it must put the node in the FOCUS set — not in some other slice's dimmed
  // one-hop ring, which is drawn but is not what "take me to this node" means.
  it('names a slice that actually holds the node, for every node in the graph', () => {
    const keys = new Set(buildSliceOptions(mock).map((o) => o.key))
    for (const node of [...mock.facts, ...mock.flowElements]) {
      const key = sliceKeyForNode(mock, node.id)
      expect(keys.has(key)).toBe(true)
      const sliced = sliceGraph(mock, key, { neighbors: false })
      const found = [...sliced.facts, ...sliced.flowElements].find((n) => n.id === node.id)
      expect(found, `${node.id} is not in ${key}`).toBeTruthy()
      expect(found.__context).toBeFalsy()
    }
  })

  // The same property over every generated graph on disk, which is where the shapes the mock does
  // not have live: a flow file cut into a dozen pages, a fact file with thousands of facts, and
  // (direct-file) an element whose page is not the one its route suggests.
  it.each(loadAllReal())('holds for every node of %s', (_appId, graph) => {
    const keys = new Set(buildSliceOptions(graph).map((o) => o.key))
    const focusByKey = new Map()
    for (const node of [...graph.facts, ...graph.flowElements]) {
      const key = sliceKeyForNode(graph, node.id)
      expect(keys.has(key)).toBe(true)
      if (!focusByKey.has(key)) {
        const sliced = sliceGraph(graph, key, { neighbors: false })
        focusByKey.set(key, new Set([...sliced.facts, ...sliced.flowElements].map((n) => n.id)))
      }
      expect(focusByKey.get(key).has(node.id), `${node.id} is not in ${key}`).toBe(true)
    }
  })

  it('falls back to the full graph for a node the picker has no option for', () => {
    expect(sliceKeyForNode(mock, 'fact:/nothing-here')).toBe(FULL_KEY)
    const orphan = { ...mock.facts[0], id: 'fact:/orphan', sourceFile: undefined }
    expect(sliceKeyForNode({ ...mock, facts: [...mock.facts, orphan] }, 'fact:/orphan')).toBe(
      FULL_KEY
    )
  })
})
