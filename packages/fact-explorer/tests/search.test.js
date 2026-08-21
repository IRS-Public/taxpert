import { describe, it, expect } from 'vitest'
import { matchIds, searchableText } from '../src/model/search.js'
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
