import { describe, it, expect } from 'vitest'
import { matchIds, searchableText, suggest } from '../src/model/search.js'
import { loadMock, loadRealOrNull } from './_fixtures.js'

describe('search.matchIds', () => {
  const mock = loadMock()

  it('returns an empty set for a blank query (no active search)', () => {
    expect(matchIds(mock, '').size).toBe(0)
    expect(matchIds(mock, '   ').size).toBe(0)
    expect(matchIds(mock, undefined).size).toBe(0)
  })

  it('is case-insensitive', () => {
    const lower = matchIds(mock, 'filing')
    const upper = matchIds(mock, 'FILING')
    expect(upper).toEqual(lower)
    expect(lower.size).toBeGreaterThan(0)
  })

  it('only returns ids whose haystack actually contains the query', () => {
    const q = 'filing'
    const ids = matchIds(mock, q)
    const byId = new Map([
      ...mock.facts.map((f) => [f.id, f]),
      ...mock.flowElements.map((e) => [e.id, e]),
    ])
    for (const id of ids) {
      expect(searchableText(byId.get(id))).toContain(q)
    }
  })

  it('matches across facts and flow elements', () => {
    // "tax year" appears in both a fact name and flow text in the fixture.
    const ids = matchIds(mock, 'tax')
    const factHit = mock.facts.some((f) => ids.has(f.id))
    const flowHit = mock.flowElements.some((e) => ids.has(e.id))
    expect(factHit || flowHit).toBe(true)
  })

  it('finds EITC across the real graph when present', () => {
    const real = loadRealOrNull()
    if (!real) return // S1 data not generated; covered by the mock cases above
    const ids = matchIds(real, 'eitc')
    expect(ids.size).toBeGreaterThan(0)
  })
})

describe('search.suggest', () => {
  const mock = loadMock()

  it('is empty for a blank query, like matchIds', () => {
    expect(suggest(mock, '')).toEqual([])
    expect(suggest(mock, '   ')).toEqual([])
    expect(suggest(mock, undefined)).toEqual([])
  })

  // The rule the box is built on: rows are fact paths and nothing else, the same vocabulary the
  // chat dock's fact picker offers. Question text stays in the highlight, not in the dropdown.
  it('suggests fact paths only, never a flow element', () => {
    const factIds = new Set(mock.facts.map((f) => f.id))
    const rows = suggest(mock, '/')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.path.startsWith('/')).toBe(true)
      expect(factIds.has(row.id)).toBe(true)
    }
  })

  it('leaves question text to the highlight: a screen word no path spells suggests nothing', () => {
    // Spelled out rather than mined from the fixture, so it cannot quietly stop testing anything
    // the day a fact path happens to contain the word the search picked out of a question.
    const graph = {
      flowPages: [],
      edges: [],
      flowElements: [
        {
          id: 'flow:q',
          tag: 'fg-boolean',
          pageId: 'page:a',
          questionText: 'Do you have a qualifying child?',
        },
      ],
      facts: [{ id: 'fact:/qualifiesForEitc', path: '/qualifiesForEitc', kind: 'derived' }],
    }
    expect(matchIds(graph, 'qualifying').size).toBe(1) // the canvas still highlights it
    expect(suggest(graph, 'qualifying')).toEqual([]) // but there is no address to offer for it
  })

  // Narrower than matchIds by design (it reads names and descriptions too), but never wider: a
  // suggestion is always one of the hits the counter is counting.
  it('only suggests nodes matchIds also matched', () => {
    const q = mock.facts[0].path.slice(1, 5).toLowerCase()
    const ids = matchIds(mock, q)
    const rows = suggest(mock, q)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(ids.has(row.id)).toBe(true)
  })

  it('every row visibly contains what was typed, as the datalist itself would filter', () => {
    const q = 'a'
    for (const row of suggest(mock, q)) expect(row.path.toLowerCase()).toContain(q)
  })

  it('resolves each row back to exactly one fact, by id', () => {
    const byId = new Map(mock.facts.map((f) => [f.id, f]))
    for (const row of suggest(mock, '/')) {
      expect(byId.get(row.id)?.path).toBe(row.path)
    }
  })

  it('never repeats a path, so a pick is unambiguous', () => {
    const paths = suggest(mock, '/').map((r) => r.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('ranks a path prefix above a hit in the middle, then alphabetically', () => {
    const fact = mock.facts[0]
    const q = fact.path.slice(0, 5).toLowerCase()
    const rows = suggest(mock, q)
    expect(rows[0].path.toLowerCase().startsWith(q)).toBe(true)
    const prefixes = rows.filter((r) => r.path.toLowerCase().startsWith(q)).map((r) => r.path)
    expect(prefixes).toEqual([...prefixes].sort((a, b) => a.localeCompare(b)))
  })

  it('caps the list, so the whole graph is affordable per keystroke', () => {
    const real = loadRealOrNull()
    if (!real) return // S1 data not generated; the mock is far below any cap
    expect(suggest(real, '/', { limit: 10 }).length).toBeLessThanOrEqual(10)
    expect(suggest(real, '/').length).toBeLessThanOrEqual(50)
  })
})
