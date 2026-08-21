import { describe, it, expect } from 'vitest'
import { buildSliceOptions, defaultSliceKey, sliceGraph, FULL_KEY } from '../src/model/slice.js'
import { validate } from '../src/model/fgm.js'
import { loadMock } from './_fixtures.js'

describe('slice', () => {
  const mock = loadMock()

  it('defaults to the first flow page, never the full graph', () => {
    const key = defaultSliceKey(mock)
    expect(key).not.toBe(FULL_KEY)
    expect(key).toBe(`page::${mock.flowPages[0].id}`)
  })

  it('builds grouped options that include every page and the full graph', () => {
    const opts = buildSliceOptions(mock)
    expect(opts.some((o) => o.key === FULL_KEY)).toBe(true)
    for (const p of mock.flowPages) {
      expect(opts.some((o) => o.key === `page::${p.id}`)).toBe(true)
    }
  })

  it('a page slice yields a valid sub-FGM scoped to that page', () => {
    const key = defaultSliceKey(mock)
    const pageId = key.slice('page::'.length)
    const g = sliceGraph(mock, key, { neighbors: false })
    expect(() => validate(g)).not.toThrow()
    // with neighbors off, every flow node belongs to the page (focus only)
    expect(g.flowElements.every((e) => e.pageId === pageId)).toBe(true)
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
