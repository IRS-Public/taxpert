import { describe, it, expect } from 'vitest'
import { coneGraph, coneLayout, hubIds, HUB_FANIN_THRESHOLD } from '../src/model/cone.js'
import { validate } from '../src/model/fgm.js'
import { loadMock, loadRealOrNull } from './_fixtures.js'

// The mock has a clean chain rooted at the marriage-DQ knockout alert:
//   fs:fg-alert:eitc-marriage-dq --knocks-out--> /isDisqualifiedMarriedNotFilingJointly
//     --depends--> /isFilingStatusMFJ --depends--> /initialFilingStatus
//     --binds(question)--> fs:fg-set:initialFilingStatus
const KO_ROOT = 'fs:fg-alert:eitc-marriage-dq'
const CHAIN = [
  'fact:/isDisqualifiedMarriedNotFilingJointly',
  'fact:/isFilingStatusMFJ',
  'fact:/initialFilingStatus',
  'fs:fg-set:initialFilingStatus',
]

// A tiny synthetic graph for deterministic hub / rail assertions: root A reaches
// the shared hub H (also depended on by B, C, D → fan-in 4) and B; C and D are
// NOT reachable from A.
function synthetic() {
  const fact = (p, kind = 'derived') => ({ id: `fact:${p}`, path: p, kind })
  const dep = (s, t) => ({
    id: `e:${s}->${t}`,
    source: `fact:${s}`,
    target: `fact:${t}`,
    kind: 'depends',
  })
  return {
    flowPages: [],
    flowElements: [],
    facts: [fact('/A'), fact('/B'), fact('/C'), fact('/D'), fact('/H', 'writable')],
    edges: [dep('/A', '/H'), dep('/A', '/B'), dep('/B', '/H'), dep('/C', '/H'), dep('/D', '/H')],
  }
}

describe('cone', () => {
  const mock = loadMock()

  it('yields a valid sub-FGM rooted at the output', () => {
    const g = coneGraph(mock, KO_ROOT)
    expect(() => validate(g)).not.toThrow()
  })

  it('keeps the root plus its full transitive dependency cone, and nothing else', () => {
    const g = coneGraph(mock, KO_ROOT)
    const ids = new Set([...g.flowElements, ...g.facts].map((n) => n.id))
    expect(ids.has(KO_ROOT)).toBe(true)
    for (const id of CHAIN) expect(ids.has(id)).toBe(true)
    // unrelated facts must be excluded
    expect(ids.has('fact:/earnedIncomeCredit')).toBe(false)
    expect(ids.has('fact:/taxYear')).toBe(false)
  })

  it('flags the root __focal and dims nothing', () => {
    const g = coneGraph(mock, KO_ROOT)
    const all = [...g.flowElements, ...g.facts]
    expect(all.filter((n) => n.__focal).map((n) => n.id)).toEqual([KO_ROOT])
    expect(all.every((n) => n.__context === false)).toBe(true)
  })

  it('maxDepth truncates the walk', () => {
    const g = coneGraph(mock, KO_ROOT, { maxDepth: 1 })
    const ids = new Set([...g.flowElements, ...g.facts].map((n) => n.id))
    expect(ids.has('fact:/isDisqualifiedMarriedNotFilingJointly')).toBe(true) // depth 1
    expect(ids.has('fact:/isFilingStatusMFJ')).toBe(false) // depth 2, cut
  })

  it('hubIds finds high-fan-in shared inputs', () => {
    const hubs = hubIds(synthetic(), 3)
    expect(hubs).toEqual(new Set(['fact:/H']))
    // the real default cutoff is conservative
    expect(HUB_FANIN_THRESHOLD).toBeGreaterThan(1)
  })

  it('tags reachable hubs __hub (not the root)', () => {
    const g = coneGraph(synthetic(), 'fact:/A', { hubThreshold: 3 })
    const byId = Object.fromEntries(g.facts.map((f) => [f.id, f]))
    expect(byId['fact:/H'].__hub).toBe(true)
    expect(byId['fact:/A'].__hub).toBe(false) // reachable but it is the root
    expect(byId['fact:/B'].__hub).toBe(false)
    // C and D aren't in A's cone at all
    expect(byId['fact:/C']).toBeUndefined()
  })

  it('coneLayout ranks the root shallowest and rails hubs deepest', () => {
    const g = coneGraph(synthetic(), 'fact:/A', { hubThreshold: 3 })
    const pos = coneLayout(g, 'fact:/A', 'vertical')
    for (const f of g.facts) expect(pos[f.id]).toBeDefined()
    // vertical: main axis is y; root at rank 0, B at rank 1, hub H railed past it
    expect(pos['fact:/A'].y).toBeLessThan(pos['fact:/B'].y)
    expect(pos['fact:/B'].y).toBeLessThan(pos['fact:/H'].y)
  })

  it('coneLayout places every cone dependency deeper than the root', () => {
    const g = coneGraph(mock, KO_ROOT)
    const pos = coneLayout(g, KO_ROOT, 'vertical')
    const rootY = pos[KO_ROOT].y
    for (const id of CHAIN) expect(pos[id].y).toBeGreaterThan(rootY)
  })

  const real = loadRealOrNull()
  it.skipIf(!real)('traces the real AGI-knockout cone and rails the filing-status hub', () => {
    // The AGI knockout fact-output: /flowShouldShowEitcAgiKnockoutOnAdjustmentsPage
    const root = 'fact:/flowShouldShowEitcAgiKnockoutOnAdjustmentsPage'
    const g = coneGraph(real, root)
    const ids = new Set(g.facts.map((f) => f.id))
    expect(ids.has('fact:/agi')).toBe(true)
    expect(ids.has('fact:/highestEitcPhaseoutAmount')).toBe(true)
    // /isFilingStatusMFJ is a high-fan-in hub → railed
    const mfj = g.facts.find((f) => f.id === 'fact:/isFilingStatusMFJ')
    expect(mfj?.__hub).toBe(true)
  })
})
