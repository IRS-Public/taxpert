// graph-adapter.js — the fact-graph port, and the window adapter that reproduces today's behavior.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

let windowFactGraphAdapter
let normalizeAdapter
let DEFAULT_CHANGE_EVENTS

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  ;({ windowFactGraphAdapter, normalizeAdapter, DEFAULT_CHANGE_EVENTS } = await import(
    '../src/shared/js/graph-adapter.js'
  ))
})

beforeEach(() => {
  delete globalThis.window.factGraph
  delete globalThis.window.loadFactGraph
})

test('with no graph, every reader answers empty rather than throwing', () => {
  const adapter = windowFactGraphAdapter()
  assert.deepEqual(adapter.paths(), [])
  assert.deepEqual(adapter.getCollectionIds('/x'), [])
  assert.equal(adapter.get('/x'), null)
  assert.equal(adapter.getDefinition('/x'), null)
  assert.equal(adapter.toJson(), '')
})

test('paths() sorts, matching what the Inspect combo box expects', () => {
  globalThis.window.factGraph = { paths: () => ['/b', '/a', '/c'] }
  assert.deepEqual(windowFactGraphAdapter().paths(), ['/a', '/b', '/c'])
})

test('a throwing graph is an empty answer, not an exception in the render loop', () => {
  globalThis.window.factGraph = {
    paths () { throw new Error('boom') },
    get () { throw new Error('unknown path') },
    getCollectionIds () { throw new Error('not a collection') },
    dictionary: { getDefinition () { throw new Error('gone') } },
  }
  const adapter = windowFactGraphAdapter()
  assert.deepEqual(adapter.paths(), [])
  assert.equal(adapter.get('/x'), null)
  assert.deepEqual(adapter.getCollectionIds('/x'), [])
  assert.equal(adapter.getDefinition('/x'), null)
})

test('the graph is resolved per call, so it may arrive after the workspace renders', () => {
  const adapter = windowFactGraphAdapter()
  assert.deepEqual(adapter.paths(), [])
  globalThis.window.factGraph = { paths: () => ['/late'] }
  assert.deepEqual(adapter.paths(), ['/late'])
})

test('getDefinition reaches through the graph dictionary', () => {
  globalThis.window.factGraph = {
    dictionary: { getDefinition: (p) => (p === '/amount' ? { typeNode: 'DollarNode' } : null) },
  }
  assert.equal(windowFactGraphAdapter().getDefinition('/amount').typeNode, 'DollarNode')
})

// The latent bug the adapter closes: taxpert called toJson(), credit-assistant called toJSON().
test('toJson() accepts either spelling the host happens to expose', () => {
  globalThis.window.factGraph = { toJson: () => '{"lower":1}' }
  assert.equal(windowFactGraphAdapter().toJson(), '{"lower":1}')

  globalThis.window.factGraph = { toJSON: () => '{"upper":1}' }
  assert.equal(windowFactGraphAdapter().toJson(), '{"upper":1}')
})

test('toJson() answers empty when the graph exposes neither spelling', () => {
  globalThis.window.factGraph = {}
  assert.equal(windowFactGraphAdapter().toJson(), '')
})

// load() is the one method that must NOT swallow: the Load Fact Graph textarea turns the throw
// into a validation message before the form submits.
test('load() propagates the host loader throw', () => {
  globalThis.window.loadFactGraph = () => { throw new Error('invalid JSON') }
  assert.throws(() => windowFactGraphAdapter().load('{'), /invalid JSON/)
})

test('load() throws a named error when no loader is configured', () => {
  assert.throws(() => windowFactGraphAdapter().load('{}'), /no fact-graph loader/)
})

test('a host may inject its own resolve and load', () => {
  const graph = { paths: () => ['/injected'] }
  let loaded = null
  const adapter = windowFactGraphAdapter({ resolve: () => graph, load: (j) => { loaded = j } })
  assert.deepEqual(adapter.paths(), ['/injected'])
  adapter.load('{"a":1}')
  assert.equal(loaded, '{"a":1}')
})

test('changeEvents defaults to the fg-* pair and is overridable', () => {
  assert.deepEqual(windowFactGraphAdapter().changeEvents, DEFAULT_CHANGE_EVENTS)
  assert.deepEqual(
    windowFactGraphAdapter({ changeEvents: ['x-change'] }).changeEvents,
    ['x-change']
  )
})

test('normalizeAdapter fills in what a partial adapter left out', () => {
  const adapter = normalizeAdapter({ paths: () => ['/only'] })
  assert.deepEqual(adapter.paths(), ['/only'])
  assert.deepEqual(adapter.getCollectionIds('/x'), [])
  assert.equal(adapter.get('/x'), null)
  assert.deepEqual(adapter.changeEvents, DEFAULT_CHANGE_EVENTS)
  assert.throws(() => adapter.load('{}'), /no fact-graph loader/)
})
