import { describe, it, expect } from 'vitest'
import { scenarioFilter } from '../src/model/scenarioFilter.js'
import { computeVisibility } from '../src/model/visibility.js'
import { validate } from '../src/model/fgm.js'
import { loadMock, loadRealOrNull } from './_fixtures.js'

// Build a status map by running computeVisibility with given fake evaluators.
function statusFor(graph, evaluators) {
  return computeVisibility(graph, evaluators).status
}

describe('scenarioFilter', () => {
  const allVisible = {
    evalCond: () => true,
    factState: () => ({ hasValue: false, complete: false }),
  }
  const allHidden = {
    evalCond: () => false,
    factState: () => ({ hasValue: false, complete: false }),
  }

  it('returns the graph unchanged when status is empty', () => {
    const mock = loadMock()
    expect(scenarioFilter(mock, new Map())).toBe(mock)
  })

  it('drops hidden/unseen/knockout-inactive nodes and dangling edges, staying valid', () => {
    const mock = loadMock()
    const status = statusFor(mock, allHidden)
    const out = scenarioFilter(mock, status)
    expect(() => validate(out)).not.toThrow()

    // Every surviving edge connects two surviving nodes.
    const keptIds = new Set([
      ...out.flowPages.map((p) => p.id),
      ...out.flowElements.map((e) => e.id),
      ...out.facts.map((f) => f.id),
    ])
    for (const e of out.edges) {
      expect(keptIds.has(e.source)).toBe(true)
      expect(keptIds.has(e.target)).toBe(true)
    }
  })

  it('keeps everything reachable when all conditions pass', () => {
    const mock = loadMock()
    const status = statusFor(mock, allVisible)
    const out = scenarioFilter(mock, status)
    expect(() => validate(out)).not.toThrow()
    // No flow element is hidden when every condition passes, so all survive.
    expect(out.flowElements.length).toBe(mock.flowElements.length)
  })

  const real = loadRealOrNull()
  it.skipIf(!real)('produces a valid sub-FGM from the real graph', () => {
    const status = statusFor(real, allHidden)
    const out = scenarioFilter(real, status)
    expect(() => validate(out)).not.toThrow()
    expect(out.flowElements.length).toBeLessThanOrEqual(real.flowElements.length)
  })
})
