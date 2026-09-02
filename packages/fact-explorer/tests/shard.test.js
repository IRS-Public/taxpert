import { describe, it, expect } from 'vitest'
import {
  buildShards,
  shardFileName,
  sliceOptionsFromIndex,
  shardEntry,
} from '../src/model/shard.js'
import { buildSliceOptions, defaultSliceKey, sliceGraph, FULL_KEY } from '../src/model/slice.js'
import { validate } from '../src/model/fgm.js'
import { defaultFacets } from '../src/model/facets.js'
import { loadMock, loadAllReal } from './_fixtures.js'

// CP-5.2, the gate on FX-3. A shard that is subtly not the same slice is a graph that quietly
// tells you the wrong thing about a fact's dependencies, which is the one thing this tool exists
// to get right — so the equality is asserted over EVERY option of EVERY fixture on disk, both
// values of the neighbours toggle, rather than the three sample slices the plan asks for.
describe('shard', () => {
  const fixtures = [['mock', loadMock()], ...loadAllReal()]

  describe.each(fixtures)('%s', (_id, graph) => {
    const { index, shards } = buildShards(graph)

    it('emits one shard per picker option, and no file for the full graph', () => {
      const options = buildSliceOptions(graph)
      expect(sliceOptionsFromIndex(index)).toEqual(options)
      expect([...shards.keys()]).toEqual(
        options.filter((o) => o.key !== FULL_KEY).map((o) => o.key)
      )
      expect(shardEntry(index, FULL_KEY).file).toBe(index.wholeFile)
    })

    it('is the slice, exactly — for every option, with and without the context ring', () => {
      for (const { key } of buildSliceOptions(graph)) {
        if (key === FULL_KEY) continue
        const shard = shards.get(key)
        for (const neighbors of [true, false]) {
          expect(sliceGraph(shard, key, { neighbors })).toEqual(
            sliceGraph(graph, key, { neighbors })
          )
        }
      }
    })

    it('carries the one-hop context ring, tagged, so the toggle stays offline', () => {
      for (const [key, shard] of shards) {
        const focusOnly = sliceGraph(shard, key, { neighbors: false })
        const withHop = sliceGraph(shard, key, { neighbors: true })
        const nodes = (g) => g.flowElements.length + g.facts.length
        expect(nodes(withHop)).toBeGreaterThanOrEqual(nodes(focusOnly))
        // Everything the shard holds beyond its focus is flagged as context, which is what dims it.
        const contextIds = [...shard.flowElements, ...shard.facts]
          .filter((n) => n.__context)
          .map((n) => n.id)
        const focusIds = new Set([...focusOnly.flowElements, ...focusOnly.facts].map((n) => n.id))
        expect(contextIds.some((id) => focusIds.has(id))).toBe(false)
      }
    })

    it('emits a valid sub-FGM, so a shard is loadable by every path a graph is', () => {
      for (const shard of shards.values()) expect(() => validate(shard)).not.toThrow()
    })

    it('describes each shard truthfully enough to pick from without fetching it', () => {
      for (const entry of index.shards) {
        if (entry.key === FULL_KEY) continue
        const shard = shards.get(entry.key)
        expect(entry.nodes).toBe(shard.flowElements.length + shard.facts.length)
        expect(entry.edges).toBe(shard.edges.length)
        expect(entry.focus).toBeLessThanOrEqual(entry.nodes)
      }
    })

    it('names the same default slice the SPA would have picked from the whole graph', () => {
      expect(index.defaultKey).toBe(defaultSliceKey(graph))
      expect(index.facets).toEqual(defaultFacets(graph))
    })

    it('gives every shard a distinct filename', () => {
      const files = index.shards.map((s) => s.file)
      expect(new Set(files).size).toBe(files.length)
    })

    // The opening view is the whole point: an index plus one shard, not the whole graph.
    it('makes the default selection a small fraction of the whole graph', () => {
      const bytes = (x) => Buffer.byteLength(JSON.stringify(x))
      const opening = bytes(index) + bytes(shards.get(index.defaultKey))
      expect(opening).toBeLessThan(bytes(graph))
    })
  })

  it('keeps the two key namespaces apart after sanitising', () => {
    expect(shardFileName('file::a.xml')).not.toBe(shardFileName('pagefile::a.xml'))
    expect(shardFileName('pagefile::/some/route')).toMatch(/^[A-Za-z0-9._-]+\.json$/)
  })
})
