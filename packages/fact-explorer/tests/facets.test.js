import { describe, it, expect } from 'vitest'
import { facetGraph, defaultFacets, flowTagsOf } from '../src/model/facets.js'
import { validate, FLOW_TAGS, EDGE_KINDS } from '../src/model/fgm.js'
import { loadMock } from './_fixtures.js'

const noDangling = (g) => {
  const ids = new Set([...g.flowElements.map((e) => e.id), ...g.facts.map((f) => f.id)])
  return g.edges.every((e) => ids.has(e.source) && ids.has(e.target))
}

describe('facets.facetGraph', () => {
  const mock = loadMock()
  const DEFAULTS = defaultFacets(mock)

  it('is an identity (same reference) when everything is selected', () => {
    expect(facetGraph(mock, DEFAULTS)).toBe(mock)
  })

  it('defaults to the graph identity when no facets are passed', () => {
    expect(facetGraph(mock)).toBe(mock)
  })

  it('knockouts-only keeps only knockout alerts + their facts, no dangling', () => {
    const g = facetGraph(mock, { ...DEFAULTS, knockoutsOnly: true })
    expect(g.flowElements.length).toBeGreaterThan(0)
    expect(g.flowElements.every((e) => e.tag === 'fg-alert' && e.alert?.knockout)).toBe(true)
    // resolving knocks-out edges survive…
    expect(g.edges.some((e) => e.kind === 'knocks-out')).toBe(true)
    // …and point at facts that are present (no dangling).
    expect(noDangling(g)).toBe(true)
    expect(() => validate(g)).not.toThrow()
  })

  it('filtering to writable facts drops derived facts and depends edges', () => {
    const g = facetGraph(mock, { ...DEFAULTS, factKinds: ['writable'] })
    expect(g.facts.every((f) => f.kind === 'writable')).toBe(true)
    expect(g.edges.some((e) => e.kind === 'depends')).toBe(false)
    expect(noDangling(g)).toBe(true)
  })

  it('deselecting an edge kind removes exactly that kind', () => {
    const g = facetGraph(mock, {
      ...DEFAULTS,
      edgeKinds: EDGE_KINDS.filter((k) => k !== 'binds'),
    })
    expect(g.edges.some((e) => e.kind === 'binds')).toBe(false)
    expect(() => validate(g)).not.toThrow()
  })

  it('hiding all flow tags leaves only facts (and fact→fact edges)', () => {
    const g = facetGraph(mock, { ...DEFAULTS, flowTags: [] })
    expect(g.flowElements.length).toBe(0)
    expect(g.edges.every((e) => e.kind === 'depends')).toBe(true)
    expect(noDangling(g)).toBe(true)
  })

  it('every EDGE_KIND is a recognised facet key', () => {
    // Guards against a new kind being added without a facet for it. flowTags has no equivalent
    // assertion: it is derived from the graph, not from the constant — see below.
    expect(DEFAULTS.edgeKinds).toEqual(EDGE_KINDS)
  })
})

describe('facets.flowTagsOf', () => {
  const mock = loadMock()

  it('derives the tag universe from the graph, built-ins in canonical order', () => {
    const tags = flowTagsOf(mock)
    expect(tags.length).toBeGreaterThan(0)
    expect(tags.every((t) => FLOW_TAGS.includes(t))).toBe(true)
    // Canonical order preserved, so the checkbox row does not reshuffle between graphs.
    expect(tags).toEqual(FLOW_TAGS.filter((t) => tags.includes(t)))
  })

  it('includes an app-declared custom tag, after the built-ins', () => {
    const custom = {
      ...mock,
      flowTags: ['fg-withholding-adjustments'],
      flowElements: [
        ...mock.flowElements,
        {
          id: 'twe:fg-withholding-adjustments:w4',
          pageId: mock.flowPages[0].id,
          tag: 'fg-withholding-adjustments',
          order: 99,
        },
      ],
    }
    const tags = flowTagsOf(custom)
    expect(tags).toContain('fg-withholding-adjustments')
    expect(tags[tags.length - 1]).toBe('fg-withholding-adjustments')
  })

  it('a custom tag is selected by default, so the node is not filtered off the canvas', () => {
    // The regression this guards: DEFAULT_FACETS used to be seeded from the FLOW_TAGS constant, so
    // an app-registered node type was hidden by default *and* had no checkbox to restore it.
    const custom = {
      ...mock,
      flowTags: ['fg-withholding-adjustments'],
      flowElements: [
        ...mock.flowElements,
        {
          id: 'twe:fg-withholding-adjustments:w4',
          pageId: mock.flowPages[0].id,
          tag: 'fg-withholding-adjustments',
          order: 99,
        },
      ],
    }
    expect(defaultFacets(custom).flowTags).toContain('fg-withholding-adjustments')
    expect(facetGraph(custom, defaultFacets(custom))).toBe(custom)
  })

  it('falls back to the built-in vocabulary with no graph', () => {
    expect(flowTagsOf(undefined)).toEqual(FLOW_TAGS)
    expect(defaultFacets(undefined).flowTags).toEqual(FLOW_TAGS)
  })
})
