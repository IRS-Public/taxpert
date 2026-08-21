// The graph port's set() and <taxpert-overrides> — the one tool that writes.
//
// The port was read-only until this tool needed it, so both halves are covered here: the adapter's
// write path (persist, announce, delete-on-empty) and the panel that drives it.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

let configure
let _resetConfig
let windowFactGraphAdapter
let normalizeAdapter

// A graph in the Scala.js shape the adapter expects, with a record of what was written.
function fakeGraph () {
  const values = new Map([['/overrideDate', '2026-01-15']])
  return {
    values,
    deleted: [],
    saved: 0,
    paths: () => [...values.keys()],
    getCollectionIds: () => [],
    get: (path) => (values.has(path)
      ? { complete: true, hasValue: true, get: values.get(path) }
      : { complete: false, hasValue: false }),
    set (path, value) { values.set(path, value) },
    delete (path) { values.delete(path); this.deleted.push(path) },
    dictionary: { getDefinition: () => ({ typeNode: 'DayNode' }) },
    toJson: () => '{}',
  }
}

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
  await import('../src/tool-panels/js/taxpert-overrides.js')
  ;({ configure, _resetConfig } = await import('../src/shared/js/config.js'))
  ;({ windowFactGraphAdapter, normalizeAdapter } =
    await import('../src/shared/js/graph-adapter.js'))
})

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  _resetConfig()
})

// ── the port's write path ────────────────────────────────────────────────────

test('set() writes through to the graph', () => {
  const graph = fakeGraph()
  const adapter = windowFactGraphAdapter({ resolve: () => graph })
  assert.equal(adapter.set('/overrideDate', '2027-04-15'), true)
  assert.equal(graph.values.get('/overrideDate'), '2027-04-15')
})

// A write that is not persisted vanishes on the next navigation, and neither host puts its
// saveFactGraph() on `window` — so the host has to hand it in.
test('set() calls the host’s save', () => {
  const graph = fakeGraph()
  let saved = 0
  const adapter = windowFactGraphAdapter({ resolve: () => graph, save: () => { saved++ } })
  adapter.set('/overrideDate', '2027-04-15')
  assert.equal(saved, 1)
})

test('set() announces the change, so every other tool re-reads', () => {
  const graph = fakeGraph()
  const adapter = windowFactGraphAdapter({ resolve: () => graph })
  let heard = 0
  document.addEventListener('fg-update', () => { heard++ })
  adapter.set('/overrideDate', '2027-04-15')
  assert.equal(heard, 1)
})

// An empty Dollar is not zero, it is unanswered — and the difference decides whether a determination
// has settled. This mirrors what a host's own <fg-set> does when a field is cleared.
test('an empty value deletes rather than writing', () => {
  const graph = fakeGraph()
  const adapter = windowFactGraphAdapter({ resolve: () => graph })
  adapter.set('/overrideDate', '')
  assert.deepEqual(graph.deleted, ['/overrideDate'])
  assert.equal(graph.values.has('/overrideDate'), false)
})

test('set() answers false rather than throwing when the graph rejects a value', () => {
  const graph = fakeGraph()
  graph.set = () => { throw new Error('not a Day') }
  const adapter = windowFactGraphAdapter({ resolve: () => graph })
  assert.equal(adapter.set('/overrideDate', 'tuesday'), false)
})

test('a graph that cannot write answers false rather than pretending', () => {
  const adapter = windowFactGraphAdapter({ resolve: () => ({ paths: () => [] }) })
  assert.equal(adapter.set('/x', '1'), false)
  assert.equal(normalizeAdapter({}).set('/x', '1'), false)
})

// ── the panel ────────────────────────────────────────────────────────────────

const OVERRIDES_TOOL = {
  id: 'overrides',
  label: 'Overrides',
  templateId: 'ttp-body-overrides',
  facts: ['/overrideDate'],
}

async function mount (graph, tool = OVERRIDES_TOOL) {
  configure({
    tools: [tool],
    graph: windowFactGraphAdapter({ resolve: () => graph }),
  })
  const element = document.createElement('taxpert-overrides')
  document.body.appendChild(element)
  await element.ready
  return element
}

test('one row per fact the host made overridable, prefilled from the graph', async () => {
  const element = await mount(fakeGraph())
  const rows = element.querySelectorAll('.ttp-overrides__row')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].querySelector('.ttp-overrides__label').textContent, '/overrideDate')
  assert.equal(rows[0].querySelector('input').value, '2026-01-15')
})

// The whole point of the tool being generic: the input is chosen from the dictionary's own type, so
// a host adds a fact and gets the right control with no mapping to maintain here.
test('the input type comes from the fact’s own type', async () => {
  const element = await mount(fakeGraph())
  assert.equal(element.querySelector('input').type, 'date')

  const dollars = fakeGraph()
  dollars.dictionary = { getDefinition: () => ({ typeNode: 'DollarNode' }) }
  document.body.innerHTML = ''
  const second = await mount(dollars)
  assert.equal(second.querySelector('input').type, 'number')
})

test('editing a field writes the fact', async () => {
  const graph = fakeGraph()
  const element = await mount(graph)
  const input = element.querySelector('input')

  input.value = '2027-04-15'
  input.dispatchEvent(new window.Event('change'))
  assert.equal(graph.values.get('/overrideDate'), '2027-04-15')
})

test('Clear removes the fact', async () => {
  const graph = fakeGraph()
  const element = await mount(graph)
  element.querySelector('.ttp-overrides__clear').click()
  assert.equal(graph.values.has('/overrideDate'), false)
})

test('a value the graph refuses says so on the row', async () => {
  const graph = fakeGraph()
  // A text field, so the value survives the input element and reaches the graph — a date input
  // discards anything it cannot parse before the change listener ever sees it.
  graph.dictionary = { getDefinition: () => ({ typeNode: 'StringNode' }) }
  graph.set = () => { throw new Error('not a Day') }
  const element = await mount(graph)
  const input = element.querySelector('input')

  input.value = 'tuesday'
  input.dispatchEvent(new window.Event('change'))

  const row = element.querySelector('.ttp-overrides__row')
  assert.equal(row.dataset.status, 'error')
  assert.match(row.querySelector('[data-field="status"]').textContent, /Could not write/)
})

test('a fact changed elsewhere shows up here', async () => {
  const graph = fakeGraph()
  const element = await mount(graph)

  graph.values.set('/overrideDate', '2028-06-01')
  document.dispatchEvent(new window.CustomEvent('fg-update'))
  assert.equal(element.querySelector('input').value, '2028-06-01')
})

test('a host that names no facts gets the empty state, not an empty form', async () => {
  const element = await mount(fakeGraph(), { ...OVERRIDES_TOOL, facts: [] })
  assert.equal(element.querySelectorAll('.ttp-overrides__row').length, 0)
  assert.match(element.textContent, /declares no overridable facts/)
})

// The list is read late, like every other config-driven surface.
test('adding a fact to the tool’s config adds its row', async () => {
  const element = await mount(fakeGraph(), { ...OVERRIDES_TOOL, facts: [] })
  configure({ tools: [{ ...OVERRIDES_TOOL, facts: ['/overrideDate'] }] })
  assert.equal(element.querySelectorAll('.ttp-overrides__row').length, 1)
})
