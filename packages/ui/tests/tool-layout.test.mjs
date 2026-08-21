// Unit tests for tool-layout.js — the state behind the Tools modal and the dock.
//
// No custom elements here: this module is deliberately reachable without any DOM beyond
// localStorage and the event it dispatches, so the two surfaces over it can be tested separately
// from the arithmetic they share.
import { test, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

let layout
let config

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.localStorage = dom.window.localStorage
  layout = await import('../src/tool-panels/js/tool-layout.js')
  config = await import('../src/shared/js/config.js')
})

beforeEach(() => {
  localStorage.clear()
  layout._resetToolLayout()
})

// Config is module-scope state, so a test that configure()s a storage prefix would otherwise leave
// every later test writing under it.
afterEach(() => {
  config._resetConfig()
})

const dockedIds = () => layout.getLayout().columns.map((column) => column.ids)

test('starts with every tool off and nothing docked', () => {
  assert.deepEqual(layout.activeTools(), [])
  assert.deepEqual(dockedIds(), [])
  assert.equal(layout.isToolOn('inspect'), false)
})

// The whole point of the canonical order: the checkbox you tick first does not decide the slot.
test('panels take their canonical 1-2-3 order whatever order the tools were switched on in', () => {
  layout.setToolOn('watchlist', true)
  layout.setToolOn('inspect', true)
  layout.setToolOn('outcome-tracker', true)

  assert.deepEqual(dockedIds(), [['inspect', 'outcome-tracker', 'watchlist']])
})

test('switching a tool off removes its panel and leaves the others in order', () => {
  for (const id of ['inspect', 'outcome-tracker', 'watchlist']) layout.setToolOn(id, true)

  layout.setToolOn('outcome-tracker', false)
  assert.deepEqual(dockedIds(), [['inspect', 'watchlist']])
  assert.deepEqual(layout.activeTools(), ['inspect', 'watchlist'])

  // Back on, and it returns to the middle rather than the end.
  layout.setToolOn('outcome-tracker', true)
  assert.deepEqual(dockedIds(), [['inspect', 'outcome-tracker', 'watchlist']])
})

test('the last panel out of a column takes the column with it', () => {
  layout.setToolOn('inspect', true)
  assert.equal(layout.getLayout().columns.length, 1)
  layout.setToolOn('inspect', false)
  assert.deepEqual(dockedIds(), [])
})

test('docking into a new column gives a side-by-side layout', () => {
  layout.setToolOn('inspect', true)
  layout.setToolOn('outcome-tracker', true)

  layout.dockTool('outcome-tracker', { columnIndex: 0, newColumn: true })
  assert.deepEqual(dockedIds(), [['outcome-tracker'], ['inspect']])
})

test('floating a panel takes it out of its column and clamps to the minimum box', () => {
  layout.setToolOn('inspect', true)
  layout.setToolOn('watchlist', true)

  layout.floatTool('watchlist', { x: 120, y: 80, w: 10, h: 10 })
  assert.deepEqual(dockedIds(), [['inspect']])
  assert.equal(layout.isFloating('watchlist'), true)

  const [floated] = layout.getLayout().floating
  assert.deepEqual(floated, {
    id: 'watchlist',
    x: 120,
    y: 80,
    w: layout.PANEL_MIN_WIDTH,
    h: layout.PANEL_MIN_HEIGHT,
  })
})

// "Reset tool layout" is about placement. It must not turn anything off.
test('resetToolLayout redocks everything in order but leaves the tools on', () => {
  for (const id of ['inspect', 'outcome-tracker', 'watchlist']) layout.setToolOn(id, true)
  layout.dockTool('watchlist', { columnIndex: 0, newColumn: true })
  layout.floatTool('outcome-tracker', { x: 40, y: 40, w: 400, h: 400 })
  layout.setDockWidth(700)

  layout.resetToolLayout()

  assert.deepEqual(dockedIds(), [['inspect', 'outcome-tracker', 'watchlist']])
  assert.deepEqual(layout.activeTools(), ['inspect', 'outcome-tracker', 'watchlist'])
  assert.equal(layout.getLayout().floating.length, 0)
  // Cleared, not remembered — so equal flex gives the thirds the design asks for.
  assert.deepEqual(
    layout.getLayout().columns.at(0).panels.map((panel) => panel.flex),
    [1, 1, 1]
  )
})

test('sizes are stored as flex ratios, in pairs', () => {
  layout.setToolOn('inspect', true)
  layout.setToolOn('watchlist', true)

  layout.setPanelFlexPair('inspect', 'watchlist', 1.5, 0.5)
  assert.deepEqual(
    layout.getLayout().columns.at(0).panels,
    [{ id: 'inspect', flex: 1.5 }, { id: 'watchlist', flex: 0.5 }]
  )
})

test('the layout survives a reload, and unknown tools in storage are dropped', () => {
  layout.setToolOn('inspect', true)
  layout.setToolOn('watchlist', true)
  layout.dockTool('watchlist', { columnIndex: 0, newColumn: true })

  layout._resetToolLayout() // forget the in-memory copy; the next read re-parses storage
  assert.deepEqual(dockedIds(), [['watchlist'], ['inspect']])

  const stored = JSON.parse(localStorage.getItem('taxpert:toolLayout'))
  stored.on.push('a-tool-that-was-removed')
  stored.columns.at(0).ids.push('a-tool-that-was-removed')
  localStorage.setItem('taxpert:toolLayout', JSON.stringify(stored))

  layout._resetToolLayout()
  assert.deepEqual(dockedIds(), [['watchlist'], ['inspect']])
  assert.deepEqual(layout.activeTools(), ['inspect', 'watchlist'])
})

// A tool switched on but placed nowhere would read as on in the modal with no panel to show for it.
test('a tool left unplaced in storage is docked on load', () => {
  localStorage.setItem(
    'taxpert:toolLayout',
    JSON.stringify({ on: ['inspect', 'watchlist'], columns: [{ flex: 1, ids: ['watchlist'] }] })
  )
  layout._resetToolLayout()
  assert.deepEqual(dockedIds(), [['inspect', 'watchlist']])
})

// The key is read at each write, not captured at import: a host serving a second app on the same
// origin configures its own prefix and gets its own layout, rather than sharing this one. The
// unconfigured default stays 'taxpert:toolLayout', so credit-assistant is untouched.
test('a configured storage prefix moves the layout to its own key', () => {
  config.configure({ app: { storagePrefix: 'twe' } })
  layout.setToolOn('inspect', true)

  assert.ok(localStorage.getItem('twe:toolLayout'))
  assert.equal(localStorage.getItem('taxpert:toolLayout'), null)
})

test('every mutation announces itself so the modal and the dock can re-sync', () => {
  const seen = []
  document.addEventListener(layout.TOOL_LAYOUT_CHANGE_EVENT, () => seen.push(layout.activeTools()))

  layout.setToolOn('inspect', true)
  layout.setToolOn('watchlist', true)
  layout.setToolOn('inspect', false)

  assert.deepEqual(seen, [['inspect'], ['inspect', 'watchlist'], ['watchlist']])
})

test('a redundant setToolOn is not a change and says nothing', () => {
  layout.setToolOn('inspect', true)
  let announced = 0
  document.addEventListener(layout.TOOL_LAYOUT_CHANGE_EVENT, () => { announced += 1 })
  layout.setToolOn('inspect', true)
  assert.equal(announced, 0)
})

// The column budget is what makes 2-up viable around 1240px and 3-up around 1540px.
test('the column budget follows from the panel and host minimums', () => {
  assert.equal(layout.maxDockWidth(1000), 1000 - layout.HOST_MIN_WIDTH)
  assert.equal(layout.fitsColumns(1, 1000), true)
  assert.equal(layout.fitsColumns(2, 1000), false)
  assert.equal(layout.fitsColumns(2, 1240), true)
  assert.equal(layout.fitsColumns(3, 1240), false)
  assert.equal(layout.fitsColumns(3, 1540), true)
})

test('dock width is clamped to the budget on the way in', () => {
  globalThis.window.innerWidth = 1240
  layout.setToolOn('inspect', true)

  layout.setDockWidth(10_000)
  assert.equal(layout.dockWidth(), layout.maxDockWidth(1240))

  layout.setDockWidth(10)
  assert.equal(layout.dockWidth(), layout.PANEL_MIN_WIDTH)
})
