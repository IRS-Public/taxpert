// The Fact Inspector's own behavior: the fact-path datalists, the controls the section template
// declares via data-attributes (they carried inline onkeydown=/onclick= before, which need their
// handlers on `window` and are blocked by any Content-Security-Policy worth having), and the
// tracked-fact list. Driven with jsdom against a stubbed window.factGraph.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

const FACT_DICTIONARY_XML =
  '<FactDictionaryModule><Facts><Fact path="/a"><Writable><Boolean/></Writable></Fact></Facts></FactDictionaryModule>'

let panel

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
  globalThis.sessionStorage = dom.window.sessionStorage
  globalThis.localStorage = dom.window.localStorage
  globalThis.DOMParser = dom.window.DOMParser
  globalThis.XMLSerializer = dom.window.XMLSerializer
  // jsdom doesn't implement scrollIntoView, and trackFact() scrolls a newly added card into view.
  dom.window.Element.prototype.scrollIntoView = () => {}
  stubTemplateFetch(async () => ({ ok: true, text: async () => FACT_DICTIONARY_XML }))
  await import('../src/audit-panel/js/taxpert-audit-panel.js')
})

beforeEach(async () => {
  sessionStorage.clear()
  localStorage.clear()
  document.body.className = ''
  document.body.replaceChildren()

  window.factGraph = {
    // Deliberately unsorted, and one path carrying a character that would be markup if the
    // datalist were still built by string interpolation.
    paths: () => ['/b', '/a', '/c<x>'],
    get: () => ({ hasValue: false, complete: false, get: '' }),
    dictionary: { getDefinition: () => ({ typeNode: 'Boolean' }) },
  }

  panel = document.createElement('taxpert-audit-panel')
  panel.id = 'audit-panel'
  document.body.appendChild(panel)
  await panel.enable()
})

const optionValues = (selector) =>
  [...document.querySelectorAll(`${selector} option`)].map((o) => o.value)

test('both fact-path datalists offer every path the graph knows, sorted', () => {
  // One <option> per path — the list used to be assigned to innerHTML as an *array*, which
  // stringified through Array.prototype.toString() into one comma-separated entry.
  assert.deepEqual(optionValues('#fact-options'), ['/a', '/b', '/c<x>'])
  assert.deepEqual(optionValues('#chat-fact-options'), ['/a', '/b', '/c<x>'])
})

test('a datalist option carries the path as its value, which is what a datalist matches on', () => {
  // The attribute used to be `path=`, which is not a thing on <option>: the inputs matched nothing.
  const [first] = document.querySelectorAll('#fact-options option')
  assert.equal(first.value, '/a')
  assert.equal(first.textContent, '/a')
  assert.equal(first.hasAttribute('path'), false)
})

test('Add fact tracks the path in the input and clears it', () => {
  document.querySelector('#fact-select').value = '/a'
  document.querySelector('#add-fact-button').click()

  assert.ok(document.querySelector('audited-fact[path="/a"]'), 'a card was added')
  assert.equal(document.querySelector('#fact-select').value, '', 'the input is cleared')
  assert.deepEqual(JSON.parse(sessionStorage.getItem('taxpert:auditPanel')).trackedFacts, [
    { path: '/a', collectionId: '' },
  ])
})

test('Enter in a fact-path input tracks that input’s own value', () => {
  const chatInput = document.querySelector('#chat-fact-select')
  chatInput.value = '/b'
  // The inspector's input holds something else — the handler must read the event's target.
  document.querySelector('#fact-select').value = '/a'
  chatInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

  assert.ok(document.querySelector('audited-fact[path="/b"]'), 'the chat input’s path was tracked')
  assert.equal(document.querySelector('audited-fact[path="/a"]'), null)
  assert.equal(chatInput.value, '')
})

test('a key other than Enter tracks nothing', () => {
  const input = document.querySelector('#fact-select')
  input.value = '/a'
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true }))
  assert.equal(document.querySelector('audited-fact'), null)
  assert.equal(input.value, '/a')
})

// The button's inline onclick named clearTrackedFacts(), which existed nowhere in the package —
// it had been inert since the panel moved here.
test('Clear facts empties the tracked list and the stored copy of it', () => {
  for (const path of ['/a', '/b']) {
    document.querySelector('#fact-select').value = path
    document.querySelector('#add-fact-button').click()
  }
  assert.equal(document.querySelectorAll('audited-fact').length, 2)

  document.querySelector('[data-clear-tracked-facts]').click()

  assert.equal(document.querySelectorAll('audited-fact').length, 0)
  assert.deepEqual(JSON.parse(sessionStorage.getItem('taxpert:auditPanel')).trackedFacts, [])
})

test('tracking a path twice does not double the card', () => {
  for (let i = 0; i < 2; i++) {
    document.querySelector('#fact-select').value = '/a'
    document.querySelector('#add-fact-button').click()
  }
  assert.equal(document.querySelectorAll('audited-fact[path="/a"]').length, 1)
})

test('an <audited-fact> clones the tap-fact template into its shadow root', () => {
  document.querySelector('#fact-select').value = '/a'
  document.querySelector('#add-fact-button').click()

  const card = document.querySelector('audited-fact')
  assert.equal(card.shadowRoot.querySelector('.audit-panel__fact__path').innerText, '/a')
  assert.equal(card.shadowRoot.querySelector('.audit-panel__fact__type').innerText, 'Boolean')
  // The `part=` names are the styling contract a host reaches the shadow root through.
  assert.ok(card.shadowRoot.querySelector('[part="remove-button"]'))
  assert.ok(card.shadowRoot.querySelector('slot[name="definition"]'))
})

test('Remove fact drops the card and forgets it', () => {
  document.querySelector('#fact-select').value = '/a'
  document.querySelector('#add-fact-button').click()

  const card = document.querySelector('audited-fact')
  card.shadowRoot.querySelector('.audit-panel__fact__remove').click()

  assert.equal(document.querySelector('audited-fact'), null)
  assert.deepEqual(JSON.parse(sessionStorage.getItem('taxpert:auditPanel')).trackedFacts, [])
})
