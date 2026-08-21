import { describe, it, expect } from 'vitest'
import {
  buildTrackedFacts,
  buildFlowContext,
  flowTrackedPaths,
  buildScenarioSummary,
} from '../src/model/explainContext.js'
import { FLOW_STATUS } from '../src/model/visibility.js'
import { validate } from '../src/model/fgm.js'
import { loadMock } from './_fixtures.js'

// A small synthetic FGM: a question (fg-set) binds /income; a knockout fg-alert
// gates on the derived /disqualified, which depends on /income. A sequential edge
// links the question to the knockout so they're 1-hop neighbours.
function fixture() {
  const flowElements = [
    {
      id: 'p:fg-set:income',
      pageId: 'page:p',
      tag: 'fg-set',
      parentId: null,
      order: 0,
      factPath: '/income',
      inputType: 'dollar',
      questionText: 'What was your income?',
    },
    {
      id: 'p:fg-alert:inc-too-high',
      pageId: 'page:p',
      tag: 'fg-alert',
      parentId: null,
      order: 1,
      alert: { alertType: 'error', alertKey: 'inc-too-high', knockout: true },
      condition: { factPath: '/disqualified', operator: 'isTrue' },
    },
  ]
  const facts = [
    { id: 'fact:/income', path: '/income', kind: 'writable', dependencyPaths: [] },
    {
      id: 'fact:/disqualified',
      path: '/disqualified',
      kind: 'derived',
      dependencyPaths: [{ raw: '/income', resolvedAbstract: '/income', wildcard: false }],
    },
  ]
  const edges = [
    { id: 'e1', source: 'p:fg-set:income', target: 'fact:/income', kind: 'binds' },
    {
      id: 'e2',
      source: 'p:fg-alert:inc-too-high',
      target: 'fact:/disqualified',
      kind: 'knocks-out',
    },
    { id: 'e3', source: 'p:fg-set:income', target: 'p:fg-alert:inc-too-high', kind: 'sequential' },
    { id: 'e4', source: 'fact:/disqualified', target: 'fact:/income', kind: 'depends' },
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

const scenarioValues = new Map([
  ['/income', { hasValue: true, value: 99000, complete: true }],
  ['/disqualified', { hasValue: true, value: true, complete: true }],
])

describe('buildTrackedFacts', () => {
  it('resolves a fact + its dependency tree to live values', () => {
    const factByPath = new Map(fixture().facts.map((f) => [f.path, f]))
    const [tf] = buildTrackedFacts(['/disqualified'], factByPath, scenarioValues)
    expect(tf.path).toBe('/disqualified')
    expect(tf.value).toBe('true')
    expect(tf.complete).toBe(true)
    expect(tf.dependencies).toHaveLength(1)
    expect(tf.dependencies[0]).toMatchObject({ path: '/income', value: '99000' })
  })
})

describe('buildFlowContext', () => {
  const graph = fixture()
  const scenarioStatus = new Map([
    ['p:fg-set:income', FLOW_STATUS.visible],
    ['p:fg-alert:inc-too-high', FLOW_STATUS.knockoutActive],
  ])
  const el = graph.flowElements[0] // the income question
  const ctx = buildFlowContext(el, graph, { scenarioValues, scenarioStatus })

  it('returns the element metadata and bound-fact tree', () => {
    expect(ctx.kind).toBe('flow')
    expect(ctx.element).toMatchObject({ id: el.id, tag: 'fg-set', factPath: '/income' })
    expect(ctx.boundFact).toMatchObject({ path: '/income', value: '99000' })
  })

  it('resolves 1-hop fact neighbours with values', () => {
    const income = ctx.oneHopFacts.find((f) => f.path === '/income')
    expect(income).toMatchObject({ path: '/income', value: '99000', via: 'binds' })
  })

  it('resolves 1-hop flow neighbours with knockout + status', () => {
    const ko = ctx.oneHopFlow.find((n) => n.id === 'p:fg-alert:inc-too-high')
    expect(ko).toMatchObject({
      tag: 'fg-alert',
      alertKey: 'inc-too-high',
      knockout: true,
      scenarioStatus: FLOW_STATUS.knockoutActive,
    })
  })

  it('flowTrackedPaths covers the bound fact + 1-hop facts', () => {
    expect(flowTrackedPaths(ctx)).toContain('/income')
  })
})

describe('buildScenarioSummary', () => {
  const graph = fixture()

  it('flags an active knockout as a disqualifier', () => {
    const status = new Map([
      ['p:fg-set:income', FLOW_STATUS.visible],
      ['p:fg-alert:inc-too-high', FLOW_STATUS.knockoutActive],
    ])
    const summary = buildScenarioSummary(graph, status, scenarioValues, 'dq_demo.json')
    expect(summary.kind).toBe('scenario')
    expect(summary.reachedEnd).toBe(false)
    expect(summary.activeKnockouts).toHaveLength(1)
    expect(summary.activeKnockouts[0]).toMatchObject({
      alertKey: 'inc-too-high',
      boundFactPath: '/disqualified',
      value: 'true',
    })
  })

  it('reports reachedEnd when no knockout is active', () => {
    const status = new Map([
      ['p:fg-set:income', FLOW_STATUS.visible],
      ['p:fg-alert:inc-too-high', FLOW_STATUS.knockoutInactive],
    ])
    const summary = buildScenarioSummary(graph, status, scenarioValues, 'qual_demo.json')
    expect(summary.reachedEnd).toBe(true)
    expect(summary.activeKnockouts).toHaveLength(0)
  })
})

describe('mock fixture', () => {
  it('builds a flow context for a real mock flow element without throwing', () => {
    const mock = loadMock()
    const el = mock.flowElements[0]
    const ctx = buildFlowContext(el, mock, {})
    expect(ctx.kind).toBe('flow')
    expect(ctx.element.id).toBe(el.id)
    expect(Array.isArray(ctx.oneHopFacts)).toBe(true)
    expect(Array.isArray(ctx.oneHopFlow)).toBe(true)
  })
})
