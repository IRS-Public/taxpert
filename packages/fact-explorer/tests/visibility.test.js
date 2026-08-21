import { describe, it, expect } from 'vitest'
import { computeVisibility, FLOW_STATUS, FACT_STATUS } from '../src/model/visibility.js'
import { validate } from '../src/model/fgm.js'
import { loadMock, loadRealOrNull } from './_fixtures.js'

// ── A small synthetic FGM exercising every status branch ──────────────────────
// elements: a visible fg-set, a hidden fg-set, a hidden container + its child
// (parent→child hide), an active knockout, an inactive knockout.
function fixture() {
  const flowElements = [
    { id: 'p:fg-set:a', pageId: 'page:p', tag: 'fg-set', parentId: null, order: 0, factPath: '/a' },
    {
      id: 'p:fg-set:b',
      pageId: 'page:p',
      tag: 'fg-set',
      parentId: null,
      order: 1,
      factPath: '/b',
      condition: { factPath: '/condB', operator: 'isTrue' },
    },
    {
      id: 'p:fg-detail:cont',
      pageId: 'page:p',
      tag: 'fg-detail',
      parentId: null,
      order: 2,
      condition: { factPath: '/condCont', operator: 'isTrue' },
    },
    {
      id: 'p:fg-set:c',
      pageId: 'page:p',
      tag: 'fg-set',
      parentId: 'p:fg-detail:cont',
      order: 3,
      factPath: '/c',
    },
    {
      id: 'p:fg-alert:ko1',
      pageId: 'page:p',
      tag: 'fg-alert',
      parentId: null,
      order: 4,
      alert: { alertType: 'error', alertKey: 'ko1', knockout: true },
      condition: { factPath: '/condKo1', operator: 'isTrue' },
    },
    {
      id: 'p:fg-alert:ko2',
      pageId: 'page:p',
      tag: 'fg-alert',
      parentId: null,
      order: 5,
      alert: { alertType: 'error', alertKey: 'ko2', knockout: true },
      condition: { factPath: '/condKo2', operator: 'isTrue' },
    },
  ]
  const facts = [
    { id: 'fact:/a', path: '/a', kind: 'writable' },
    { id: 'fact:/b', path: '/b', kind: 'writable' },
    { id: 'fact:/c', path: '/c', kind: 'writable' },
    { id: 'fact:/koFact', path: '/koFact', kind: 'derived' },
    { id: 'fact:/dep', path: '/dep', kind: 'derived' },
    { id: 'fact:/orphan', path: '/orphan', kind: 'derived' },
  ]
  const edges = [
    { id: 'e1', source: 'p:fg-set:a', target: 'fact:/a', kind: 'binds' },
    { id: 'e2', source: 'p:fg-set:b', target: 'fact:/b', kind: 'binds' },
    { id: 'e3', source: 'p:fg-set:c', target: 'fact:/c', kind: 'binds' },
    { id: 'e4', source: 'p:fg-alert:ko1', target: 'fact:/koFact', kind: 'knocks-out' },
    { id: 'e5', source: 'p:fg-alert:ko2', target: 'fact:/koFact', kind: 'knocks-out' },
    { id: 'e6', source: 'fact:/koFact', target: 'fact:/dep', kind: 'depends' },
  ]
  const flowPages = [
    {
      id: 'page:p',
      route: '/p',
      title: 'P',
      sourceFile: 'p.xml',
      elementIds: flowElements.map((e) => e.id),
    },
  ]
  return validate({ flowPages, flowElements, facts, edges })
}

// Fake evaluators: condition table + a trivial factState.
function fakeEvaluators(table) {
  return {
    evalCond: (path, op) => !!table[`${path}|${op}`],
    factState: (path) => ({ hasValue: true, value: path, complete: true }),
  }
}

describe('computeVisibility', () => {
  const ev = fakeEvaluators({
    '/condB|isTrue': false,
    '/condCont|isTrue': false,
    '/condKo1|isTrue': true,
    '/condKo2|isTrue': false,
  })

  it('marks flow elements visible/hidden from their condition', () => {
    const { status } = computeVisibility(fixture(), ev)
    expect(status.get('p:fg-set:a')).toBe(FLOW_STATUS.visible) // no condition
    expect(status.get('p:fg-set:b')).toBe(FLOW_STATUS.hidden) // condition false
  })

  it('hides a child nested under a hidden container (parent→child)', () => {
    const { status } = computeVisibility(fixture(), ev)
    expect(status.get('p:fg-detail:cont')).toBe(FLOW_STATUS.hidden)
    expect(status.get('p:fg-set:c')).toBe(FLOW_STATUS.hidden) // hidden via parent, no own condition
  })

  it('distinguishes active vs inactive knockouts', () => {
    const { status } = computeVisibility(fixture(), ev)
    expect(status.get('p:fg-alert:ko1')).toBe(FLOW_STATUS.knockoutActive)
    expect(status.get('p:fg-alert:ko2')).toBe(FLOW_STATUS.knockoutInactive)
  })

  it('seeds seen facts from visible elements and propagates over depends', () => {
    const { status, values } = computeVisibility(fixture(), ev)
    expect(status.get('fact:/a')).toBe(FACT_STATUS.seen) // bound by visible fg-set
    expect(status.get('fact:/koFact')).toBe(FACT_STATUS.seen) // knocked-out by active ko1
    expect(status.get('fact:/dep')).toBe(FACT_STATUS.seen) // depends propagation from /koFact
    // values present only for seen facts
    expect(values.has('/a')).toBe(true)
    expect(values.has('/koFact')).toBe(true)
    expect(values.get('/dep')).toEqual({ hasValue: true, value: '/dep', complete: true })
  })

  it('leaves facts behind hidden elements unseen', () => {
    const { status, values } = computeVisibility(fixture(), ev)
    expect(status.get('fact:/b')).toBe(FACT_STATUS.unseen) // bound by hidden fg-set
    expect(status.get('fact:/c')).toBe(FACT_STATUS.unseen) // bound by parent-hidden fg-set
    expect(status.get('fact:/orphan')).toBe(FACT_STATUS.unseen) // no incoming edge
    expect(values.has('/b')).toBe(false)
  })

  it('runs over the mock fixture and returns a status for every node', () => {
    const mock = loadMock()
    const allTrue = {
      evalCond: () => true,
      factState: () => ({ hasValue: false, complete: false }),
    }
    const { status } = computeVisibility(mock, allTrue)
    const nodeIds = [...mock.flowElements, ...mock.facts].map((n) => n.id)
    for (const id of nodeIds) expect(status.has(id)).toBe(true)
  })

  const real = loadRealOrNull()
  it.skipIf(!real)('runs over the real generated graph without throwing', () => {
    const allFalse = {
      evalCond: () => false,
      factState: () => ({ hasValue: false, complete: false }),
    }
    const { status } = computeVisibility(real, allFalse)
    expect(status.size).toBe(real.flowElements.length + real.facts.length)
  })
})
