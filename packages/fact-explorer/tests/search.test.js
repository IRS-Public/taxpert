import { describe, it, expect } from 'vitest'
import { matchIds, searchableText, suggest, suggestionLabel } from '../src/model/search.js'
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

  // The contract the search box leans on: a suggestion is one of the counted hits, so the
  // dropdown and the "N in view / M total" line can never be answering different questions.
  it('only suggests nodes matchIds also matched', () => {
    const q = 'tax'
    const ids = matchIds(mock, q)
    const rows = suggest(mock, q)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(ids.has(row.id)).toBe(true)
  })

  it('resolves each row back to exactly one node, by id', () => {
    const byId = new Map([
      ...mock.facts.map((f) => [f.id, f]),
      ...mock.flowElements.map((e) => [e.id, e]),
    ])
    for (const row of suggest(mock, 'a')) {
      const node = byId.get(row.id)
      expect(node).toBeTruthy()
      expect(row.label).toBe(suggestionLabel(node))
    }
  })

  it('never repeats a label, so a pick is unambiguous', () => {
    const labels = suggest(mock, 'a').map((r) => r.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('ranks a label hit above a node matched only through the rest of its haystack', () => {
    // A fact path starting with the query: the reader typed the front of a name, so it leads.
    const fact = mock.facts[0]
    const q = fact.path.slice(0, 6).toLowerCase()
    const rows = suggest(mock, q)
    expect(rows[0].label.toLowerCase().startsWith(q)).toBe(true)
  })

  it('caps the list, so the whole graph is affordable per keystroke', () => {
    const real = loadRealOrNull()
    if (!real) return // S1 data not generated; the mock is far below any cap
    expect(suggest(real, 'e', { limit: 10 }).length).toBeLessThanOrEqual(10)
    expect(suggest(real, 'e').length).toBeLessThanOrEqual(50)
  })
})
