// Unit tests for drop-target.js — where a dragged panel would land.
//
// This is the whole decision behind a drag, pulled out as a pure function precisely so it can be
// tested. jsdom does no layout, so the geometry it would report is all zeroes; here the rectangles
// are handed in, which is the only way to assert on snapping at all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDropTarget, EDGE_ZONE } from '../src/tool-panels/js/drop-target.js'

const rect = (left, top, width, height) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
})

// A 480px dock on the right of a 1400px viewport, holding one column of two 400px-tall panels.
const oneColumn = {
  dock: rect(920, 0, 480, 800),
  columns: [
    {
      rect: rect(920, 0, 480, 800),
      panels: [
        { id: 'inspect', rect: rect(920, 0, 480, 400) },
        { id: 'watchlist', rect: rect(920, 400, 480, 400) },
      ],
    },
  ],
  canAddColumn: true,
}

test('a pointer outside the dock floats the panel — the only way to undock', () => {
  assert.deepEqual(resolveDropTarget({ x: 400, y: 300 }, oneColumn), { kind: 'float' })
  assert.deepEqual(resolveDropTarget({ x: 1000, y: 900 }, oneColumn), { kind: 'float' })
})

test('with no dock measured at all, everything floats', () => {
  assert.deepEqual(resolveDropTarget({ x: 10, y: 10 }, { dock: null }), { kind: 'float' })
})

test('an empty dock has one place to go', () => {
  assert.deepEqual(
    resolveDropTarget({ x: 1000, y: 300 }, { dock: rect(920, 0, 480, 800), columns: [] }),
    { kind: 'new-column', columnIndex: 0 }
  )
})

test('stacking: the insertion point is how many panel middles the pointer has passed', () => {
  // Above the first panel's middle → before it.
  assert.deepEqual(resolveDropTarget({ x: 1160, y: 100 }, oneColumn), {
    kind: 'column', columnIndex: 0, index: 0,
  })
  // Between the two middles → between them.
  assert.deepEqual(resolveDropTarget({ x: 1160, y: 300 }, oneColumn), {
    kind: 'column', columnIndex: 0, index: 1,
  })
  // Past the second middle → at the end.
  assert.deepEqual(resolveDropTarget({ x: 1160, y: 700 }, oneColumn), {
    kind: 'column', columnIndex: 0, index: 2,
  })
})

test('near a column’s left edge, a new side-by-side column opens before it', () => {
  assert.deepEqual(resolveDropTarget({ x: 920 + EDGE_ZONE - 1, y: 300 }, oneColumn), {
    kind: 'new-column', columnIndex: 0,
  })
})

test('near the last column’s right edge, the new column opens after it', () => {
  assert.deepEqual(resolveDropTarget({ x: 1400 - EDGE_ZONE + 1, y: 300 }, oneColumn), {
    kind: 'new-column', columnIndex: 1,
  })
})

// This is what keeps the host content area at 640px: below the budget, a drag can only ever stack.
test('when the viewport cannot afford another column, the edges stack instead', () => {
  const cramped = { ...oneColumn, canAddColumn: false }
  assert.deepEqual(resolveDropTarget({ x: 921, y: 100 }, cramped), {
    kind: 'column', columnIndex: 0, index: 0,
  })
  assert.deepEqual(resolveDropTarget({ x: 1399, y: 700 }, cramped), {
    kind: 'column', columnIndex: 0, index: 2,
  })
})

test('with two columns, the seam between them is one new column, not two', () => {
  const twoColumns = {
    dock: rect(800, 0, 600, 800),
    columns: [
      { rect: rect(800, 0, 300, 800), panels: [{ id: 'inspect', rect: rect(800, 0, 300, 800) }] },
      { rect: rect(1100, 0, 300, 800), panels: [{ id: 'watchlist', rect: rect(1100, 0, 300, 800) }] },
    ],
    canAddColumn: true,
  }
  assert.deepEqual(resolveDropTarget({ x: 1100, y: 400 }, twoColumns), {
    kind: 'new-column', columnIndex: 1,
  })
  // Well inside the second column, it stacks there instead.
  assert.deepEqual(resolveDropTarget({ x: 1250, y: 200 }, twoColumns), {
    kind: 'column', columnIndex: 1, index: 0,
  })
})

// The dragged panel is out of flow, so the dock excludes it — a column left with no panels is a gap
// the pointer can still be over, and the nearest real column should win.
test('a pointer in a gap falls to the nearest column', () => {
  const gapped = {
    dock: rect(800, 0, 600, 800),
    columns: [
      { rect: rect(800, 0, 200, 800), panels: [{ id: 'inspect', rect: rect(800, 0, 200, 800) }] },
    ],
    canAddColumn: false,
  }
  assert.deepEqual(resolveDropTarget({ x: 1350, y: 700 }, gapped), {
    kind: 'column', columnIndex: 0, index: 1,
  })
})
