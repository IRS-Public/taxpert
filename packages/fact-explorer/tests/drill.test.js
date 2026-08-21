import { describe, it, expect } from 'vitest'
import { drillGraph, egoLayout } from '../src/model/drill.js'
import { validate } from '../src/model/fgm.js'
import { loadMock } from './_fixtures.js'

// Pick a node in the mock that actually has edges, so the ego network is non-trivial.
function busiestNode(graph) {
  const deg = new Map()
  for (const e of graph.edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
  }
  return [...deg.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

describe('drill', () => {
  const mock = loadMock()
  const focalId = busiestNode(mock)

  it('yields a valid sub-FGM (the mini-graph)', () => {
    const g = drillGraph(mock, focalId)
    expect(() => validate(g)).not.toThrow()
  })

  it('keeps the focal node plus exactly its 1st-hop neighbours', () => {
    const g = drillGraph(mock, focalId)
    const ids = new Set([...g.flowElements, ...g.facts].map((n) => n.id))
    // every edge in the mini-graph is incident to the focal node…
    expect(g.edges.length).toBeGreaterThan(0)
    expect(g.edges.every((e) => e.source === focalId || e.target === focalId)).toBe(true)
    // …and the surviving nodes are exactly focal + the other endpoints.
    const expected = new Set([focalId])
    for (const e of g.edges) expected.add(e.source === focalId ? e.target : e.source)
    expect(ids).toEqual(expected)
  })

  it('flags the focal node and dims nothing', () => {
    const g = drillGraph(mock, focalId)
    const all = [...g.flowElements, ...g.facts]
    const focal = all.filter((n) => n.__focal)
    expect(focal.map((n) => n.id)).toEqual([focalId])
    expect(all.every((n) => n.__context === false)).toBe(true)
  })

  it('only keeps edges whose endpoints both survive', () => {
    const g = drillGraph(mock, focalId)
    const ids = new Set([...g.flowElements, ...g.facts].map((n) => n.id))
    expect(g.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true)
  })

  it('egoLayout centres the focal node and rings every neighbour', () => {
    const g = drillGraph(mock, focalId)
    const pos = egoLayout(g, focalId)
    // a position for every node in the mini-graph
    for (const n of [...g.flowElements, ...g.facts]) {
      expect(pos[n.id]).toBeDefined()
    }
    // neighbours sit off the origin (on the ring), the focal is the centremost
    const dist = (id) => Math.hypot(pos[id].x + 115, pos[id].y + 32)
    for (const n of [...g.flowElements, ...g.facts]) {
      if (n.id === focalId) continue
      expect(dist(n.id)).toBeGreaterThan(dist(focalId))
    }
  })
})
