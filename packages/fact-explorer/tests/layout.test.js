import { describe, it, expect } from 'vitest'
import { toReactFlow } from '../src/canvas/transform.js'
import { sliceGraph } from '../src/model/slice.js'
import { loadMock } from './_fixtures.js'

const W = 230 // NODE_W
const H = 64 // NODE_H

// Axis-aligned bounding box for a positioned node (frames carry an explicit size).
function box(n) {
  const w = n.style?.width ?? W
  const h = n.style?.height ?? H
  return { x1: n.position.x, y1: n.position.y, x2: n.position.x + w, y2: n.position.y + h }
}

function overlaps(a, b) {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2
}

// layoutGraph is exercised through toReactFlow (its only caller). These assert
// the deterministic banded-layout guarantees: a document-order flow spine,
// container frames that bound their children, fact/alert nodes grouped into their
// own non-overlapping bands, and a second (horizontal) orientation.
describe('canvas/layout (banded layout)', () => {
  const mock = loadMock()

  it('lays the flow spine out top-to-bottom in document order', () => {
    const { nodes } = toReactFlow(
      sliceGraph(mock, `pagefile::${mock.flowPages[0].sourceFile}`, { neighbors: false })
    )
    const topLevel = nodes
      .filter((n) => n.data.raw.__kind === 'flow' && !n.data.raw.parentId)
      .sort((a, b) => (a.data.raw.order ?? 0) - (b.data.raw.order ?? 0))
    for (let i = 1; i < topLevel.length; i++) {
      expect(topLevel[i].position.y).toBeGreaterThanOrEqual(topLevel[i - 1].position.y)
    }
  })

  it('renders a collection as a sized frame that contains its flow children', () => {
    const coll = mock.flowElements.find((e) => e.tag === 'fg-collection')
    expect(coll).toBeTruthy()
    // Alert children are intentionally lifted into the grouped alert band, so a
    // frame only bounds its spine (flow-band) children.
    const kids = mock.flowElements.filter((e) => e.parentId === coll.id && e.tag !== 'fg-alert')
    expect(kids.length).toBeGreaterThan(0)

    const collPage = mock.flowPages.find((p) => p.id === coll.pageId)
    const { nodes } = toReactFlow(
      sliceGraph(mock, `pagefile::${collPage.sourceFile}`, { neighbors: false })
    )
    const frame = nodes.find((n) => n.id === coll.id)
    expect(frame.type).toBe('fgmFrame')
    expect(frame.style.width).toBeGreaterThan(0)
    expect(frame.style.height).toBeGreaterThan(0)

    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const k of kids) {
      const child = byId.get(k.id)
      expect(child).toBeTruthy()
      // child sits inside the frame's bounding box
      expect(child.position.x).toBeGreaterThanOrEqual(frame.position.x)
      expect(child.position.y).toBeGreaterThanOrEqual(frame.position.y)
      expect(child.position.y).toBeLessThanOrEqual(frame.position.y + frame.style.height)
    }
  })

  it('groups categories into separate non-overlapping bands (vertical)', () => {
    // Full graph so every band is populated.
    const { nodes } = toReactFlow(mock)
    const xs = (cat) => nodes.filter((n) => n.data.category === cat).map((n) => n.position.x)
    const flowX = nodes.filter((n) => n.data.category === 'fg-set').map((n) => n.position.x)
    const writableX = xs('fact-writable')
    const derivedX = xs('fact-derived')

    // Writable facts sit in a band left of the fg-set spine; deriveds to the right.
    expect(Math.max(...writableX)).toBeLessThan(Math.min(...flowX))
    expect(Math.min(...derivedX)).toBeGreaterThan(Math.max(...flowX))

    // No two non-frame nodes overlap.
    const real = nodes.filter((n) => n.type !== 'fgmFrame').map(box)
    for (let i = 0; i < real.length; i++)
      for (let j = i + 1; j < real.length; j++) expect(overlaps(real[i], real[j])).toBe(false)
  })

  it('stacks the bands as rows in horizontal orientation', () => {
    const { nodes } = toReactFlow(mock, {}, {}, 'horizontal')
    const ys = (cat) => nodes.filter((n) => n.data.category === cat).map((n) => n.position.y)
    const flowY = nodes.filter((n) => n.data.category === 'fg-set').map((n) => n.position.y)
    // Writable band is a row above the flow spine; derived a row below it.
    expect(Math.max(...ys('fact-writable'))).toBeLessThan(Math.min(...flowY))
    expect(Math.min(...ys('fact-derived'))).toBeGreaterThan(Math.max(...flowY))
  })

  it('honours saved manual positions over the computed layout', () => {
    const sliced = sliceGraph(mock, `pagefile::${mock.flowPages[0].sourceFile}`, {
      neighbors: false,
    })
    const someId = sliced.flowElements[0].id
    const { nodes } = toReactFlow(sliced, { [someId]: { x: 999, y: 777 } })
    expect(nodes.find((n) => n.id === someId).position).toEqual({ x: 999, y: 777 })
  })
})
