// DOM-level tests for <taxpert-tool-dock>, driven with jsdom.
//
// jsdom does no layout, so anything measured is zero — the geometry half of dragging is covered by
// drop-target.test.mjs against handed-in rectangles instead. What is asserted here is the structure
// the dock builds from the stored layout, and that panels are *moved* rather than rebuilt.
//
// Sizes are read off the custom properties the dock writes, because that is where they live: a
// column is `flex: var(--ttd-column-flex) 1 0` and a panel `flex: var(--ttp-flex) 1 0`, so equal
// ratios are the 100% / 50% / 33% split, and no JS ever computes a percentage to assert on.
import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

let layout
let config

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.customElements = dom.window.customElements
  globalThis.localStorage = dom.window.localStorage
  stubTemplateFetch()
  await import('../src/tool-panels/js/taxpert-tool-dock.js')
  layout = await import('../src/tool-panels/js/tool-layout.js')
  config = await import('../src/shared/js/config.js')
  // The Outcome tracker draws its empty state until a host says what it tracks, and one test below
  // needs a real row in it to prove the panel was moved rather than rebuilt.
  config.configure({
    determinations: [{
      id: 'settled-or-not',
      label: 'Settled or not',
      rollupPath: '/answer',
      sections: [{ heading: 'The answer', facts: ['/answer'] }],
    }],
  })
})

after(() => config._resetConfig())

beforeEach(() => {
  localStorage.clear()
  layout._resetToolLayout()
  document.body.className = ''
  document.body.innerHTML = ''
})

async function mount () {
  const dock = document.createElement('taxpert-tool-dock')
  document.body.appendChild(dock)
  await dock.ready
  await settle(dock)
  return dock
}

// The dock reconciles synchronously, but a panel it just created fetches its own chrome. Tests that
// only look at structure don't have to wait; ones that reach inside a panel do.
async function settle (dock) {
  await Promise.all([...dock.querySelectorAll('taxpert-tool-panel')].map((panel) => panel.ready))
}

const panelOrder = (dock) =>
  [...dock.querySelectorAll('.ttd-column')].map((column) =>
    [...column.querySelectorAll('taxpert-tool-panel')].map((panel) => panel.tool)
  )

test('with no tool on, the dock renders nothing and claims no width', async () => {
  const dock = await mount()
  assert.equal(dock.hasAttribute('data-open'), false)
  assert.equal(dock.hasAttribute('data-docked'), false)
  assert.equal(dock.querySelector('.ttd-dock').hidden, true)
  assert.equal(panelOrder(dock).length, 0)
})

// Mocks 4, 5 and 6: one, two or three panels in one right-side column.
test('one, two and three tools give one column of one, two and three panels in order', async () => {
  const dock = await mount()

  layout.setToolOn('watchlist', true)
  assert.deepEqual(panelOrder(dock), [['watchlist']])
  assert.equal(dock.hasAttribute('data-docked'), true)

  layout.setToolOn('inspect', true)
  assert.deepEqual(panelOrder(dock), [['inspect', 'watchlist']])

  layout.setToolOn('outcome-tracker', true)
  assert.deepEqual(panelOrder(dock), [['inspect', 'outcome-tracker', 'watchlist']])
})

// Equal flex is the split; there is no 33% anywhere.
test('panels with no stored size share the column equally', async () => {
  const dock = await mount()
  for (const id of ['inspect', 'outcome-tracker', 'watchlist']) layout.setToolOn(id, true)

  const flexes = [...dock.querySelectorAll('taxpert-tool-panel')]
    .map((panel) => panel.style.getPropertyValue('--ttp-flex'))
  assert.deepEqual(flexes, ['1', '1', '1'])
})

test('a stored size pair lands on the two panels that share the splitter', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  layout.setToolOn('watchlist', true)

  layout.setPanelFlexPair('inspect', 'watchlist', 1.5, 0.5)
  const flexes = [...dock.querySelectorAll('taxpert-tool-panel')]
    .map((panel) => panel.style.getPropertyValue('--ttp-flex'))
  assert.deepEqual(flexes, ['1.5', '0.5'])
})

test('there is one splitter per seam — between panels and between columns', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  assert.equal(dock.querySelectorAll('.ttd-splitter--h').length, 0, 'a lone panel has no seam')

  layout.setToolOn('watchlist', true)
  assert.equal(dock.querySelectorAll('.ttd-splitter--h').length, 1)
  assert.equal(dock.querySelectorAll('.ttd-splitter--v').length, 0)

  layout.dockTool('watchlist', { columnIndex: 0, newColumn: true })
  assert.deepEqual(panelOrder(dock), [['watchlist'], ['inspect']])
  assert.equal(dock.querySelectorAll('.ttd-splitter--v').length, 1)
  assert.equal(dock.querySelectorAll('.ttd-splitter--h').length, 0)
})

test('every resize handle is an operable separator, not a mouse-only affordance', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  layout.setToolOn('watchlist', true)

  const handles = [
    dock.querySelector('.ttd-dock__resizer'),
    dock.querySelector('.ttd-splitter--h'),
  ]
  for (const handle of handles) {
    assert.equal(handle.getAttribute('role'), 'separator')
    assert.equal(handle.getAttribute('tabindex'), '0')
    assert.ok(handle.getAttribute('aria-label'))
  }
})

test('arrow keys resize the pair a splitter sits between', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  layout.setToolOn('watchlist', true)

  const splitter = dock.querySelector('.ttd-splitter--h')
  splitter.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))

  const [first, second] = layout.getLayout().columns.at(0).panels
  assert.ok(first.flex > 0, 'both sides kept a ratio')
  assert.ok(second.flex > 0)
  // The pair's combined share is preserved, so a third sibling is never disturbed.
  assert.equal(Math.round((first.flex + second.flex) * 1000) / 1000, 2)
})

test('arrow keys on the dock’s own edge resize the dock', async () => {
  const dock = await mount()
  globalThis.window.innerWidth = 1400
  layout.setToolOn('inspect', true)
  const before = layout.dockWidth()

  dock.querySelector('.ttd-dock__resizer')
    .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  assert.ok(layout.dockWidth() > before, 'dragging the left edge left widens the dock')
})

// Closing a panel is the same value the modal's checkbox reads, so the two cannot drift.
test('a panel’s close button switches its tool off', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  layout.setToolOn('watchlist', true)
  await settle(dock)

  const inspect = dock.querySelector('taxpert-tool-panel[tool="inspect"]')
  inspect.querySelector('.ttp-panel__close').click()

  assert.deepEqual(layout.activeTools(), ['watchlist'])
  assert.deepEqual(panelOrder(dock), [['watchlist']])
})

test('the dock mounts a Tools modal so the nav’s button has a surface', async () => {
  await mount()
  assert.ok(document.querySelector('taxpert-tools-modal'), 'mounted one')

  document.dispatchEvent(new window.CustomEvent('nav-tool-select', { detail: { id: 'tools' } }))
  const modal = document.querySelector('taxpert-tools-modal')
  await modal.ready
  assert.equal(modal.querySelector('dialog').open, true)
  modal.close()
})

// Moving rather than rebuilding is what lets a panel keep its scroll position and its open rows.
// The Outcome tracker is the tool with rows on screen from the moment it opens — Inspect starts on
// its empty state — so it is the one whose expanded row can be checked for having survived the move.
test('a panel that changes column is moved, not rebuilt', async () => {
  const dock = await mount()
  layout.setToolOn('outcome-tracker', true)
  layout.setToolOn('watchlist', true)
  await settle(dock)

  const tracker = dock.querySelector('taxpert-tool-panel[tool="outcome-tracker"]')
  await tracker.querySelector('taxpert-outcome-tracker').ready
  const row = tracker.querySelector('.ttp-row')
  row.open = true

  layout.dockTool('outcome-tracker', { columnIndex: 0, newColumn: true })

  assert.equal(
    dock.querySelector('taxpert-tool-panel[tool="outcome-tracker"]'), tracker, 'same element'
  )
  assert.equal(row.open, true, 'and it kept its state')
})

test('a floating panel leaves the columns and is positioned from the stored box', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  layout.setToolOn('watchlist', true)

  layout.floatTool('watchlist', { x: 120, y: 80, w: 420, h: 360 })

  const watchlist = dock.querySelector('taxpert-tool-panel[tool="watchlist"]')
  assert.equal(watchlist.hasAttribute('data-float'), true)
  assert.equal(watchlist.closest('.ttd-float-layer') !== null, true, 'lives in the float layer')
  assert.equal(watchlist.style.getPropertyValue('--ttp-x'), '120px')
  assert.equal(watchlist.style.getPropertyValue('--ttp-h'), '360px')
  assert.deepEqual(panelOrder(dock), [['inspect']])
})

test('with every panel floating the dock area collapses but the layer stays', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  layout.floatTool('inspect', { x: 10, y: 10, w: 400, h: 400 })

  assert.equal(dock.hasAttribute('data-open'), true, 'still rendering — it owns the float layer')
  assert.equal(dock.hasAttribute('data-docked'), false, 'but claims no width in the host row')
  assert.equal(dock.querySelector('.ttd-dock').hidden, true)
})

// With nothing docked the element has collapsed to no width, so measuring it would make every drop
// a float — and a floating panel could never be dragged home again.
test('a collapsed dock still offers the strip it would occupy, so a float can be dragged back', () => {
  const dockElement = document.createElement('taxpert-tool-dock')
  // Reaching for the private here on purpose: the alternative is a real pointer drag, which needs
  // layout jsdom does not do. What is asserted is the rectangle the drop decision is made against.
  dockElement._dock = { hidden: true }
  globalThis.window.innerWidth = 1400

  const rect = dockElement._dockRect()
  assert.equal(rect.right, 1400, 'anchored to the right edge')
  assert.ok(rect.right - rect.left >= layout.PANEL_MIN_WIDTH, 'at least a panel wide')
  assert.ok(rect.bottom > rect.top, 'and full height, not the zero-height collapsed box')
})

test('each panel names its tool in its title and in both icon-only buttons', async () => {
  const dock = await mount()
  layout.setToolOn('outcome-tracker', true)
  const panel = dock.querySelector('taxpert-tool-panel')
  await panel.ready

  assert.equal(panel.querySelector('.ttp-panel__title').textContent, 'Outcome tracker')
  assert.equal(panel.querySelector('.ttp-panel__grip-label').textContent, 'Move Outcome tracker')
  assert.equal(panel.querySelector('.ttp-panel__close-label').textContent, 'Close Outcome tracker')
})

// Every tool body is a custom element with templates of its own, which is why there is a second
// `ready` to await past the panel's. What matters to the dock is only that the body arrived; each
// tool's own behaviour is its own spec's business.
test('opening Inspect mounts the real inspect body, on its empty state', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  const panel = dock.querySelector('taxpert-tool-panel')
  await panel.ready

  const body = panel.querySelector('taxpert-inspect')
  assert.ok(body, 'the tool body is the element, not the old stub rows')
  await body.ready

  assert.equal(body.querySelector('[data-region="empty"]').hidden, false)
  assert.equal(
    body.querySelector('.ttp-inspect__empty-title').textContent,
    'Select an item to get started'
  )
  assert.equal(body.querySelector('[data-region="selected"]').hidden, true)
})

// ── Dragging by the grip ─────────────────────────────────────────────────────
// jsdom measures everything as zero, so the dock's rect is an empty box and every pointer position
// lands outside it — which is exactly the undock case, and deterministic. Where a drop *inside* the
// dock lands is drop-target.test.mjs's business, against handed-in rectangles.

const pointer = (target, type, x, y) =>
  target.dispatchEvent(
    new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    })
  )

test('the grip is a live drag handle the moment a panel’s chrome exists', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  const panel = dock.querySelector('taxpert-tool-panel')
  await panel.ready

  pointer(panel.grip, 'pointerdown', 500, 300)

  // All three say the dock picked the gesture up. Before <taxpert-tool-panel> held a single `ready`
  // promise for its whole life, the dock read the one from the constructor, went looking for a grip
  // on chrome that did not exist yet, and bound nothing — a press on the grip did exactly nothing.
  assert.equal(panel.hasAttribute('data-dragging'), true, 'the panel is lifted')
  assert.equal(document.body.classList.contains('ttd-dragging'), true, 'the body carries the drag')
  assert.equal(panel.hasAttribute('data-float'), true, 'and it is out of its column')

  pointer(window, 'pointerup', 200, 300)
  assert.equal(document.body.classList.contains('ttd-dragging'), false, 'released')
})

test('dropping a panel away from the dock undocks it', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  const panel = dock.querySelector('taxpert-tool-panel')
  await panel.ready
  assert.deepEqual(panelOrder(dock), [['inspect']], 'docked to begin with')

  pointer(panel.grip, 'pointerdown', 500, 300)
  pointer(window, 'pointermove', 200, 300)
  pointer(window, 'pointerup', 200, 300)

  assert.deepEqual(panelOrder(dock), [], 'no longer in a column')
  assert.deepEqual(
    layout.getLayout().floating.map((item) => item.id),
    ['inspect'],
    'and stored as floating, so it survives a reload'
  )
  assert.equal(panel.hasAttribute('data-dragging'), false, 'the drag is over')
})

// The float-only resize handles come off the same `ready` promise as the grip, so they went unbound
// for the same reason.
test('a floating panel’s grow handles are wired too', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  const panel = dock.querySelector('taxpert-tool-panel')
  await panel.ready
  layout.floatTool('inspect', { x: 100, y: 100, w: 400, h: 300 })

  const handle = panel.growHandles.find((element) => element.dataset.edge === 'se')
  pointer(handle, 'pointerdown', 500, 400)
  pointer(window, 'pointermove', 560, 460)
  pointer(window, 'pointerup', 560, 460)

  const floated = layout.getLayout().floating.at(0)
  assert.ok(floated.w > 0 && floated.h > 0, 'the drag committed a size')
})

// Only the right and bottom edges used to be grabbable, so making a panel taller meant first
// dragging it to the top of the page to get at a handle.
test('a floating panel offers all eight edges and corners', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  const panel = dock.querySelector('taxpert-tool-panel')
  await panel.ready

  assert.deepEqual(
    panel.growHandles.map((handle) => handle.dataset.edge).sort(),
    ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']
  )
})

// An edge is reachable from the keyboard so neither axis is mouse-only; a corner is just the two
// edges it joins, and eight tab stops per panel would bury the panel's own controls.
test('the four edges are operable separators and the four corners are not tab stops', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  const panel = dock.querySelector('taxpert-tool-panel')
  await panel.ready

  // A Map rather than an object literal, like every other lookup in this bundle: no read here is a
  // dynamic `obj[name]` computed member access.
  const orientation = new Map([
    ['n', 'horizontal'], ['s', 'horizontal'], ['e', 'vertical'], ['w', 'vertical'],
  ])
  for (const handle of panel.growHandles) {
    const edge = handle.dataset.edge
    if (edge.length === 1) {
      assert.equal(handle.getAttribute('role'), 'separator', edge)
      assert.equal(handle.getAttribute('tabindex'), '0', edge)
      assert.equal(handle.getAttribute('aria-orientation'), orientation.get(edge), edge)
      assert.ok(handle.getAttribute('aria-label'), edge)
    } else {
      assert.equal(handle.getAttribute('aria-hidden'), 'true', edge)
      assert.equal(handle.getAttribute('tabindex'), null, edge)
    }
  }
})

// The north and west sides are the whole reason resizing is arithmetic rather than two additions:
// the side that was *not* grabbed has to stay where it is, so the origin moves with the size.
test('dragging the top-left corner grows the panel up and left, holding its far corner', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  const panel = dock.querySelector('taxpert-tool-panel')
  await panel.ready
  layout.floatTool('inspect', { x: 300, y: 200, w: 400, h: 300 })
  // jsdom measures every box as zero, so the drag starts from a rect the test supplies itself.
  panel.getBoundingClientRect = () => ({ left: 300, top: 200, width: 400, height: 300 })

  const handle = panel.growHandles.find((element) => element.dataset.edge === 'nw')
  pointer(handle, 'pointerdown', 300, 200)
  pointer(window, 'pointermove', 240, 150)
  pointer(window, 'pointerup', 240, 150)

  const floated = layout.getLayout().floating.at(0)
  assert.deepEqual(
    { x: floated.x, y: floated.y, w: floated.w, h: floated.h },
    { x: 240, y: 150, w: 460, h: 350 }
  )
  assert.equal(floated.x + floated.w, 700, 'the right edge did not move')
  assert.equal(floated.y + floated.h, 500, 'nor did the bottom')
})

// Past the floor the box has to pin, not invert and walk away under the cursor.
test('a top edge dragged past the panel’s minimum pins rather than inverting', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  const panel = dock.querySelector('taxpert-tool-panel')
  await panel.ready
  layout.floatTool('inspect', { x: 100, y: 100, w: 400, h: layout.PANEL_MIN_HEIGHT })
  panel.getBoundingClientRect = () =>
    ({ left: 100, top: 100, width: 400, height: layout.PANEL_MIN_HEIGHT })

  const handle = panel.growHandles.find((element) => element.dataset.edge === 'n')
  pointer(handle, 'pointerdown', 300, 100)
  pointer(window, 'pointermove', 300, 400) // dragged well below the panel's own bottom
  pointer(window, 'pointerup', 300, 400)

  const floated = layout.getLayout().floating.at(0)
  assert.equal(floated.h, layout.PANEL_MIN_HEIGHT, 'held at the floor')
  const bottom = 100 + layout.PANEL_MIN_HEIGHT
  assert.equal(floated.y, bottom - layout.PANEL_MIN_HEIGHT, 'and the origin stopped with it')
})

// Arrow keys on the west edge are the keyboard equivalent of dragging it, origin shift and all.
test('arrow keys on the left edge resize from that side', async () => {
  const dock = await mount()
  layout.setToolOn('inspect', true)
  const panel = dock.querySelector('taxpert-tool-panel')
  await panel.ready
  layout.floatTool('inspect', { x: 300, y: 200, w: 400, h: 300 })
  panel.getBoundingClientRect = () => ({ left: 300, top: 200, width: 400, height: 300 })

  const handle = panel.growHandles.find((element) => element.dataset.edge === 'w')
  handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))

  const floated = layout.getLayout().floating.at(0)
  assert.ok(floated.w > 400, 'ArrowLeft grew it leftwards')
  assert.equal(floated.x + floated.w, 700, 'and the right edge held')
})

// Watchlist is the one tool whose body is a custom element rather than stub markup, so opening it
// has to carry <taxpert-watchlist> in with it — and that element fetches templates of its own,
// which is why there is a second `ready` to await here. Its own behaviour is covered in
// watchlist.test.mjs; what matters to the dock is that the body arrived at all.
test('the Watchlist panel mounts the real watchlist body', async () => {
  const dock = await mount()
  layout.setToolOn('watchlist', true)
  const panel = dock.querySelector('taxpert-tool-panel')
  await panel.ready

  const body = panel.querySelector('taxpert-watchlist')
  assert.ok(body, 'the tool body is the element, not the old stub rows')
  await body.ready

  const action = body.querySelector('.ttp-watch__add')
  assert.equal(action.textContent.trim(), 'Add fact')
  assert.equal(action.disabled, false)
  assert.equal(action.hasAttribute('aria-disabled'), false)
})
