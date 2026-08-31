import { describe, it, expect } from 'vitest'
import { buildSliceOptions, defaultSliceKey, sliceGraph, FULL_KEY } from '../src/model/slice.js'
import { validate } from '../src/model/fgm.js'
import { loadMock } from './_fixtures.js'

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
