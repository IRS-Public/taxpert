import { describe, it, expect } from 'vitest'
import { filterGraph, DEFAULT_FILTERS } from '../src/model/filter.js'
import { validate } from '../src/model/fgm.js'
import { loadMock } from './_fixtures.js'

describe('filter.filterGraph (M3 layer toggles)', () => {
  const mock = loadMock()

  it('is an identity when all layers are on', () => {
    expect(filterGraph(mock, DEFAULT_FILTERS)).toBe(mock)
  })

  it('hiding the flow layer drops flow nodes + cross-layer edges', () => {
    const g = filterGraph(mock, { flow: false, facts: true, edges: true })
    expect(g.flowElements.length).toBe(0)
    // only fact→fact (depends) edges can survive
    expect(g.edges.every((e) => e.kind === 'depends')).toBe(true)
    expect(() => validate(g)).not.toThrow()
  })

  it('hiding the fact layer drops fact nodes + cross-layer edges', () => {
    const g = filterGraph(mock, { flow: true, facts: false, edges: true })
    expect(g.facts.length).toBe(0)
    expect(g.edges.every((e) => e.kind === 'sequential')).toBe(true)
  })

  it('hiding the connector layer keeps both node layers and draws no edges at all', () => {
    const g = filterGraph(mock, { flow: true, facts: true, edges: false })
    expect(g.edges).toEqual([])
    expect(g.flowElements.length).toBe(mock.flowElements.length)
    expect(g.facts.length).toBe(mock.facts.length)
    expect(() => validate(g)).not.toThrow()
  })
})
