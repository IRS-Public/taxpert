// The Watchlist tool: the store behind it, the rows it draws off a stubbed window.factGraph, the
// Add fact dialog's two combo boxes, and the three row actions. Driven with jsdom, like every other
// element spec here.
import { test, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

let store
let config
let dom

// A graph with one plain fact, one settled `false`, one still incomplete, and one inside a
// collection — the four states a row has to draw.
const FACTS = new Map([
  ['/investmentIncomeTotal', { complete: true, hasValue: true, get: '500.00', type: 'DollarNode' }],
  ['/entitledToPreviousJointReturn', { complete: true, hasValue: true, get: false, type: 'BooleanNode' }],
  ['/otherFactExample', { complete: false, hasValue: false, get: null, type: 'BooleanNode' }],
  ['/familyAndHousehold/#abc/firstName', { complete: true, hasValue: true, get: 'Sam', type: 'StringNode' }],
])

function stubFactGraph () {
  window.factGraph = {
    paths: () => [
      '/investmentIncomeTotal',
      '/entitledToPreviousJointReturn',
      '/otherFactExample',
      '/familyAndHousehold/*/firstName',
    ],
    getCollectionIds: (root) => (root === '/familyAndHousehold' ? ['abc', 'def'] : []),
    get: (path) => {
      const fact = FACTS.get(path)
      if (!fact) throw new Error(`no such path ${path}`)
      return fact
    },
    dictionary: {
      getDefinition: (path) => {
        const key = path.replace('*', '#abc')
        const fact = FACTS.get(key)
        if (!fact) throw new Error(`no such definition ${path}`)
        return { typeNode: fact.type }
      },
    },
  }
}

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.customElements = dom.window.customElements
  globalThis.sessionStorage = dom.window.sessionStorage
  globalThis.localStorage = dom.window.localStorage
  stubTemplateFetch()
  await import('../src/tool-panels/js/taxpert-watchlist.js')
  store = await import('../src/tool-panels/js/watchlist-store.js')
  config = await import('../src/shared/js/config.js')
})

beforeEach(() => {
  sessionStorage.clear()
  store._resetWatchlist()
  document.body.className = ''
  document.body.replaceChildren()
  stubFactGraph()
})

// Config is module-scope state, so a test that configure()s a storage prefix would otherwise leave
// every later test writing under it.
afterEach(() => {
  config._resetConfig()
})

async function mount () {
  const watchlist = document.createElement('taxpert-watchlist')
  document.body.appendChild(watchlist)
  await watchlist.ready
  return watchlist
}

async function mountModal () {
  await mount() // the panel mounts the dialog; awaiting the panel isn't awaiting the dialog
  const modal = document.querySelector('taxpert-add-fact-modal')
  await modal.ready
  return modal
}

const rowsOf = (watchlist) =>
  [...watchlist.querySelectorAll('.ttp-watch__row')].map((row) => ({
    path: row.querySelector('[data-field="path"]').textContent,
    value: row.querySelector('[data-field="value"]').textContent,
    status: row.dataset.status,
    icon: row.querySelector('.ttp-watch__status use').getAttribute('href'),
  }))

// ── The store ─────────────────────────────────────────────────────────────────

test('the store keeps entries in the order they were pinned and rejects duplicates', () => {
  assert.equal(store.addToWatchlist('/a'), true)
  assert.equal(store.addToWatchlist('/b'), true)
  assert.equal(store.addToWatchlist('/a'), false, 'already pinned')

  assert.deepEqual(store.getWatchlist(), [
    { path: '/a', collectionId: '' },
    { path: '/b', collectionId: '' },
  ])
})

// Path and collection id together are the identity: the same fact for two household members is two
// rows, and removing one must not take the other with it.
test('the same path under two collection ids is two entries', () => {
  store.addToWatchlist('/familyAndHousehold/*/firstName', 'abc')
  store.addToWatchlist('/familyAndHousehold/*/firstName', 'def')
  assert.equal(store.getWatchlist().length, 2)

  store.removeFromWatchlist('/familyAndHousehold/*/firstName', 'abc')
  assert.deepEqual(store.getWatchlist(), [
    { path: '/familyAndHousehold/*/firstName', collectionId: 'def' },
  ])
})

test('the watchlist survives a reload through sessionStorage', () => {
  store.addToWatchlist('/investmentIncomeTotal')
  store._resetWatchlist() // as if the page had been navigated
  assert.deepEqual(store.getWatchlist(), [{ path: '/investmentIncomeTotal', collectionId: '' }])
})

test('a malformed stored value is dropped rather than trusted', () => {
  sessionStorage.setItem('taxpert:watchlist', '[{"nope":1},{"path":"/a"},{"path":"/a"}]')
  store._resetWatchlist()
  assert.deepEqual(store.getWatchlist(), [{ path: '/a', collectionId: '' }])
})

// The key is read at each write, not captured at import: two Form Builder apps on one origin would
// otherwise share a single watchlist full of each other's fact paths. The unconfigured default stays
// 'taxpert:watchlist', so credit-assistant is untouched.
test('a configured storage prefix moves the watchlist to its own key', () => {
  config.configure({ app: { storagePrefix: 'twe' } })
  store.addToWatchlist('/investmentIncomeTotal')

  assert.deepEqual(
    JSON.parse(sessionStorage.getItem('twe:watchlist')),
    [{ path: '/investmentIncomeTotal', collectionId: '' }]
  )
  assert.equal(sessionStorage.getItem('taxpert:watchlist'), null)
})

// ── Rows ──────────────────────────────────────────────────────────────────────

test('the empty watchlist is the hint and the Add fact button, and no rows', async () => {
  const watchlist = await mount()
  assert.equal(watchlist.querySelectorAll('.ttp-watch__row').length, 0)
  assert.match(watchlist.querySelector('.ttp-body__hint').textContent, /Track the value/)
  assert.ok(watchlist.querySelector('.ttp-watch__add'), 'the Add fact button is always offered')
})

test('each status draws its own icon and wording', async () => {
  store.addToWatchlist('/investmentIncomeTotal')
  store.addToWatchlist('/entitledToPreviousJointReturn')
  store.addToWatchlist('/otherFactExample')
  const watchlist = await mount()

  assert.deepEqual(rowsOf(watchlist), [
    {
      path: '/investmentIncomeTotal',
      value: '$500',
      status: 'complete',
      icon: '#ttp-icon-check_circle',
    },
    {
      path: '/entitledToPreviousJointReturn',
      value: 'No',
      status: 'false',
      icon: '#ttp-icon-error_circle',
    },
    {
      path: '/otherFactExample',
      value: 'Incomplete',
      status: 'incomplete',
      icon: '#ttp-icon-pending',
    },
  ])
})

test('a fact pinned while the panel is open shows up without a reload', async () => {
  const watchlist = await mount()
  store.addToWatchlist('/investmentIncomeTotal')
  assert.deepEqual(rowsOf(watchlist).map((row) => row.path), ['/investmentIncomeTotal'])
})

test('a collection fact resolves through its collection id', async () => {
  store.addToWatchlist('/familyAndHousehold/*/firstName', 'abc')
  const watchlist = await mount()
  const row = watchlist.querySelector('.ttp-watch__row')

  assert.equal(row.querySelector('[data-field="value"]').textContent, 'Sam')
  assert.equal(
    row.querySelector('[data-field="detail-path"]').textContent,
    '/familyAndHousehold/#abc/firstName'
  )
  assert.equal(row.querySelector('[data-field="detail-collection-row"]').hidden, false)
  assert.equal(row.querySelector('[data-field="detail-collection"]').textContent, '#abc')
})

test('a plain fact hides the Collection ID row and names its type', async () => {
  store.addToWatchlist('/investmentIncomeTotal')
  const watchlist = await mount()
  const row = watchlist.querySelector('.ttp-watch__row')

  assert.equal(row.querySelector('[data-field="detail-collection-row"]').hidden, true)
  assert.equal(row.querySelector('[data-field="detail-type"]').textContent, 'Dollar')
  assert.equal(row.querySelector('[data-field="detail-value"]').textContent, '$500')
})

// An fg-update fires on every keystroke in the flow. Rebuilding the list would slam shut whatever
// the user had expanded to read, so rows are refreshed in place.
test('an fg-update refreshes values without rebuilding the rows', async () => {
  store.addToWatchlist('/otherFactExample')
  const watchlist = await mount()
  const row = watchlist.querySelector('.ttp-watch__row')
  row.open = true

  FACTS.set('/otherFactExample', { complete: true, hasValue: true, get: true, type: 'BooleanNode' })
  document.dispatchEvent(new window.CustomEvent('fg-update'))

  assert.equal(watchlist.querySelector('.ttp-watch__row'), row, 'the same element')
  assert.equal(row.open, true, 'still expanded')
  assert.equal(row.dataset.status, 'complete')
  assert.equal(row.querySelector('[data-field="value"]').textContent, 'Yes')
})

test('a fact the graph no longer knows reads as unavailable rather than throwing', async () => {
  store.addToWatchlist('/goneAway')
  const watchlist = await mount()
  assert.deepEqual(rowsOf(watchlist), [
    { path: '/goneAway', value: 'Unavailable', status: 'unknown', icon: '#ttp-icon-pending' },
  ])
})

test('with no fact graph at all the panel still renders its rows', async () => {
  delete window.factGraph
  store.addToWatchlist('/investmentIncomeTotal')
  const watchlist = await mount()
  assert.deepEqual(rowsOf(watchlist).map((row) => row.status), ['unknown'])
})

// ── Row actions ───────────────────────────────────────────────────────────────

test('Remove fact unpins it and drops the row', async () => {
  store.addToWatchlist('/investmentIncomeTotal')
  store.addToWatchlist('/otherFactExample')
  const watchlist = await mount()

  watchlist.querySelector('.ttp-watch__row [data-action="remove"]').click()

  assert.deepEqual(store.getWatchlist(), [{ path: '/otherFactExample', collectionId: '' }])
  assert.deepEqual(rowsOf(watchlist).map((row) => row.path), ['/otherFactExample'])
})

test('Reveal in canvas is a stub that asks the host, and leaves the row alone', async () => {
  store.addToWatchlist('/investmentIncomeTotal')
  const watchlist = await mount()

  const asked = []
  document.addEventListener('taxpert:reveal-fact', (event) => asked.push(event.detail))
  watchlist.querySelector('.ttp-watch__detail [data-action="reveal"]').click()

  assert.deepEqual(asked, [
    { path: '/investmentIncomeTotal', collectionId: '', concretePath: '/investmentIncomeTotal' },
  ])
  assert.equal(store.getWatchlist().length, 1, 'nothing was unpinned')
})

// The kebab lives inside the <summary>, so its click has to be cancelled or opening the menu would
// expand the row underneath it as a side effect.
test('the kebab menu opens without expanding the row, and Escape closes it', async () => {
  store.addToWatchlist('/investmentIncomeTotal')
  const watchlist = await mount()
  const row = watchlist.querySelector('.ttp-watch__row')
  const kebab = row.querySelector('.ttp-watch__kebab')

  kebab.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  assert.equal(row.querySelector('.ttp-watch__menu-list').hidden, false)
  assert.equal(kebab.getAttribute('aria-expanded'), 'true')
  assert.equal(row.open, false, 'the row did not toggle')

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(row.querySelector('.ttp-watch__menu-list').hidden, true)
  assert.equal(kebab.getAttribute('aria-expanded'), 'false')
})

// ── The Add fact dialog ───────────────────────────────────────────────────────

test('the + button opens the dialog, which the panel mounted for the host', async () => {
  const modal = await mountModal()
  const dialog = modal.querySelector('dialog')
  assert.equal(dialog.open, false)

  document.querySelector('.ttp-watch__add').click()
  assert.equal(dialog.open, true)
  assert.equal(modal.querySelector('.taf-heading').textContent, 'Add fact')
  modal.close()
})

test('the fact-path field offers every path, sorted; the collection field offers None plus the ids', async () => {
  const modal = await mountModal()
  modal.open()

  const labels = (id) => {
    modal.querySelector(`#${id}`).parentElement.querySelector('.ttp-combo__toggle').click()
    return [...modal.querySelectorAll(`#${id}--list .ttp-combo__option`)].map((o) => o.textContent)
  }

  assert.deepEqual(labels('add-fact-path'), [
    '/entitledToPreviousJointReturn',
    '/familyAndHousehold/*/firstName',
    '/investmentIncomeTotal',
    '/otherFactExample',
  ])
  assert.deepEqual(labels('add-fact-collection'), ['None', '#abc', '#def'])
  modal.close()
})

test('typing filters the list, and Enter commits the active option', async () => {
  const modal = await mountModal()
  modal.open()
  const input = modal.querySelector('#add-fact-path')

  input.value = 'investment'
  input.dispatchEvent(new window.Event('input'))
  assert.deepEqual(
    [...modal.querySelectorAll('#add-fact-path--list .ttp-combo__option')].map((o) => o.textContent),
    ['/investmentIncomeTotal']
  )

  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  assert.equal(input.value, '/investmentIncomeTotal')
  assert.equal(input.getAttribute('aria-expanded'), 'false', 'the list closed on commit')

  modal.querySelector('[data-action="add"]').click()
  assert.deepEqual(store.getWatchlist(), [{ path: '/investmentIncomeTotal', collectionId: '' }])
  assert.equal(modal.querySelector('dialog').open, false, 'adding closes the dialog')
})

// Half-typed text is not a selection; leaving it on screen would read as though it were.
test('text that names no option is discarded when focus leaves the field', async () => {
  const modal = await mountModal()
  modal.open()
  const input = modal.querySelector('#add-fact-path')

  input.value = '/not-a-real'
  input.dispatchEvent(new window.Event('input'))
  input.closest('.ttp-combo').dispatchEvent(new window.FocusEvent('focusout', { bubbles: false }))

  assert.equal(input.value, '')
  modal.querySelector('[data-action="add"]').click()
  assert.deepEqual(store.getWatchlist(), [])
  assert.equal(
    modal.querySelector('[data-field="error"]').hidden,
    false,
    'and the dialog says why nothing happened'
  )
})

test('a collection fact cannot be added without a collection id', async () => {
  const modal = await mountModal()
  modal.open()

  const path = modal.querySelector('#add-fact-path')
  path.value = '/familyAndHousehold/*/firstName'
  path.dispatchEvent(new window.Event('input'))
  path.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

  modal.querySelector('[data-action="add"]').click()
  assert.deepEqual(store.getWatchlist(), [])
  assert.match(
    modal.querySelector('[data-field="error"]').textContent,
    /collection/,
    'the dialog says what is missing'
  )

  const collection = modal.querySelector('#add-fact-collection')
  collection.value = '#abc'
  collection.dispatchEvent(new window.Event('input'))
  collection.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  modal.querySelector('[data-action="add"]').click()

  assert.deepEqual(store.getWatchlist(), [
    { path: '/familyAndHousehold/*/firstName', collectionId: 'abc' },
  ])
})

test('adding a fact that is already pinned says so rather than duplicating the row', async () => {
  store.addToWatchlist('/investmentIncomeTotal')
  const modal = await mountModal()
  modal.open()

  const input = modal.querySelector('#add-fact-path')
  input.value = '/investmentIncomeTotal'
  input.dispatchEvent(new window.Event('input'))
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  modal.querySelector('[data-action="add"]').click()

  assert.equal(store.getWatchlist().length, 1)
  assert.match(modal.querySelector('[data-field="error"]').textContent, /already/)
  modal.close()
})
