import { describe, it, expect } from 'vitest'
import { validate } from '../src/model/fgm.js'
import { loadAllReal, loadRealOrNull } from './_fixtures.js'

// Generator self-check (stands in for the Scala FormBuilderGraphSpec until P1). Skips cleanly when
// nothing has been generated (a mock-only checkout).
//
// These are *structural invariants*, deliberately not a snapshot of node counts. The counts used to
// be pinned (5 pages / 108 elements / 337 facts / 900 edges) and that worked while there was one
// app whose flow rarely moved. With two apps under live flow authoring, a pinned count breaks on
// every legitimate XML edit — and a test that cries wolf is one people delete rather than read.
// What actually needs guarding is that the graph is well-formed, which is true of every app forever.

const graphs = loadAllReal()
const named = (id) => graphs.find(([appId]) => appId === id)?.[1] ?? null

describe.skipIf(!graphs.length)('generated graphs', () => {
  it('generated at least one', () => {
    expect(graphs.length).toBeGreaterThan(0)
  })

  it.each(graphs)('%s: passes the FGM contract (validate)', (_appId, graph) => {
    expect(() => validate(graph)).not.toThrow()
  })

  it.each(graphs)('%s: has no dangling edges', (_appId, graph) => {
    const ids = new Set([...graph.flowElements.map((e) => e.id), ...graph.facts.map((f) => f.id)])
    expect(graph.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true)
  })

  it.each(graphs)('%s: every flowPage.elementIds resolves to an element', (_appId, graph) => {
    const ids = new Set(graph.flowElements.map((e) => e.id))
    for (const page of graph.flowPages) {
      expect(page.elementIds.every((id) => ids.has(id))).toBe(true)
    }
  })

  it.each(graphs)('%s: every element belongs to a declared page', (_appId, graph) => {
    const pages = new Set(graph.flowPages.map((p) => p.id))
    expect(graph.flowElements.every((e) => pages.has(e.pageId))).toBe(true)
  })

  it.each(graphs)('%s: every binds edge targets a fact', (_appId, graph) => {
    const factIds = new Set(graph.facts.map((f) => f.id))
    const binds = graph.edges.filter((e) => e.kind === 'binds')
    expect(binds.every((e) => factIds.has(e.target))).toBe(true)
  })

  it.each(graphs)('%s: node ids are unique across every slice', (_appId, graph) => {
    const all = [
      ...graph.flowPages.map((p) => p.id),
      ...graph.flowElements.map((e) => e.id),
      ...graph.facts.map((f) => f.id),
    ]
    expect(new Set(all).size).toBe(all.length)
  })

  it.each(graphs)('%s: declares every non-built-in tag it uses', (_appId, graph) => {
    // The other half of the flowTags contract: validate() rejects an undeclared tag, and this
    // catches the generator emitting one it forgot to declare — the same bug from the other side.
    const BUILT_IN = [
      'fg-set',
      'fg-alert',
      'fg-collection',
      'fg-detail',
      'fg-section-gate',
      'conditional-block',
    ]
    const used = new Set(graph.flowElements.map((e) => e.tag))
    for (const tag of used) {
      if (!BUILT_IN.includes(tag)) expect(graph.flowTags ?? []).toContain(tag)
    }
  })
})

// One app-specific spec, kept because it is the thing the whole multi-app change had to not break:
// tax-withholding-estimator registers a node type the scaffold has never heard of, and before this
// work its elements were dropped silently by the generator and then hidden by the facet defaults.
describe.skipIf(!named('twe'))('tax-withholding-estimator: app-registered node type', () => {
  const twe = named('twe')

  it('emits the custom elements rather than dropping them', () => {
    const custom = twe.flowElements.filter((e) => e.tag === 'fg-withholding-adjustments')
    expect(custom.length).toBeGreaterThan(0)
  })

  it('reads the shared vocabulary off them and keeps the rest in attrs', () => {
    const [first] = twe.flowElements.filter((e) => e.tag === 'fg-withholding-adjustments')
    expect(first.factPath).toMatch(/^\//)
    expect(first.rawXml).toContain('fg-withholding-adjustments')
    // `form-type` means nothing to the scaffold, so it survives verbatim rather than being parsed.
    expect(first.attrs?.['form-type']).toBeTruthy()
  })
})

// credit-assistant is the corpus most other specs were written against; a smoke check that it is
// still substantial catches a generator that silently produced almost nothing.
describe.skipIf(!loadRealOrNull())('credit-assistant: corpus smoke check', () => {
  const ca = loadRealOrNull()

  it('is a real graph, not an empty shell', () => {
    expect(ca.flowPages.length).toBeGreaterThan(1)
    expect(ca.flowElements.length).toBeGreaterThan(50)
    expect(ca.facts.length).toBeGreaterThan(100)
    expect(ca.edges.length).toBeGreaterThan(100)
  })

  it('exercises every edge kind the FGM defines except none', () => {
    const kinds = new Set(ca.edges.map((e) => e.kind))
    for (const k of ['sequential', 'binds', 'gates', 'knocks-out', 'displays', 'depends']) {
      expect(kinds).toContain(k)
    }
  })
})
