// The contract between the section descriptors (sections.js), the templates they name, and the
// panel that clones them: what a rail tab and a section body carry, and which of them is visible.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

const FACT_DICTIONARY_XML =
  '<FactDictionaryModule><Facts><Fact path="/a"><Writable><Boolean/></Writable></Fact></Facts></FactDictionaryModule>'

let BUILT_IN_SECTIONS

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
  stubTemplateFetch(async () => ({ ok: true, text: async () => FACT_DICTIONARY_XML }))
  await import('../src/audit-panel/js/taxpert-audit-panel.js')
  ;({ BUILT_IN_SECTIONS } = await import('../src/audit-panel/js/sections.js'))
})

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  document.body.className = ''
  document.body.replaceChildren()
})

async function mount () {
  const panel = document.createElement('taxpert-audit-panel')
  panel.id = 'audit-panel'
  document.body.appendChild(panel)
  await panel.ready
  return panel
}

test('every built-in descriptor names a template rather than carrying markup', () => {
  for (const section of BUILT_IN_SECTIONS) {
    assert.ok(section.templateId, `${section.dataTab} names a template`)
    assert.equal(typeof section.buildBody, 'undefined', `${section.dataTab} builds no markup itself`)
  }
})

test('a section body carries the id and data-tab the CSS and JS depend on', async () => {
  const panel = await mount()
  for (const section of BUILT_IN_SECTIONS) {
    const body = panel.querySelector(`#${section.sectionId}`)
    assert.ok(body, `${section.sectionId} present`)
    assert.equal(body.dataset.tab, section.dataTab)
    assert.ok(body.classList.contains('audit-panel__section'))
  }
})

test('the Fact Inspector body is the template’s markup, ids and all', async () => {
  const panel = await mount()
  const body = panel.querySelector('#audit-panel-fact-graph-section')
  for (const id of ['audit-panel__fact-list', 'fact-select', 'fact-options', 'fact-collection-id', 'add-fact-button']) {
    assert.ok(body.querySelector(`#${id}`), `#${id} present`)
  }
  // The wiring contract that replaced the inline onkeydown=/onclick= attributes.
  assert.ok(body.querySelector('[data-fact-path-input]'))
  assert.ok(body.querySelector('[data-track-selected-fact]'))
})

test('no section carries an inline event-handler attribute', async () => {
  const panel = await mount()
  for (const el of panel.querySelectorAll('*')) {
    const inline = [...el.attributes].filter((a) => a.name.startsWith('on'))
    assert.deepEqual(inline, [], `${el.tagName} has no inline handlers`)
  }
})

// One section shows at a time and none while the panel is collapsed. The panel sets `hidden`
// because CSS can't compare its data-active-tab against a section's data-tab; the stylesheet then
// carries one generic pair of rules that a host-registered section gets too.
test('exactly the active section is unhidden, and none while collapsed', async () => {
  const panel = await mount()
  const hiddenState = () =>
    Object.fromEntries(
      [...panel.querySelectorAll('.audit-panel__section')].map((s) => [s.dataset.tab, s.hidden])
    )

  assert.deepEqual(hiddenState(), { 'fact-graph': true, 'chat-explain': true }, 'collapsed: none shown')

  panel.openTab('fact-graph')
  assert.deepEqual(hiddenState(), { 'fact-graph': false, 'chat-explain': true })

  panel.openTab('chat-explain')
  assert.deepEqual(hiddenState(), { 'fact-graph': true, 'chat-explain': false })

  panel.closePanel()
  assert.deepEqual(hiddenState(), { 'fact-graph': true, 'chat-explain': true })
})

test('a host-registered section gets the same visibility treatment as a built-in one', async () => {
  const panel = await mount()
  panel.registerSection({
    sectionId: 'audit-panel-eligibility-section',
    dataTab: 'eligibility-dashboard',
    label: 'Eligibility',
    title: 'Eligibility Dashboard',
    order: 40,
    render (container) {
      container.append(document.createElement('h2'))
    },
  })

  const body = panel.querySelector('#audit-panel-eligibility-section')
  assert.equal(body.hidden, true, 'hidden while the panel is collapsed')
  panel.openTab('eligibility-dashboard')
  assert.equal(body.hidden, false, 'shown when it is the active tab')
  assert.equal(panel.querySelector('#audit-panel-fact-graph-section').hidden, true)
})

test('a flagged section’s rail tab carries data-ff, and an unflagged one does not', async () => {
  const panel = await mount()
  const railItem = (tab) => panel.querySelector(`.audit-panel__tab[data-tab="${tab}"]`).closest('li')

  assert.equal(railItem('chat-explain').dataset.ff, 'ai-fact-explanation')
  assert.equal(railItem('fact-graph').dataset.ff, undefined)
})

test('a rail tab names its section and labels itself twice — visibly and for a screen reader', async () => {
  const panel = await mount()
  const tab = panel.querySelector('.audit-panel__tab[data-tab="fact-graph"]')
  assert.equal(tab.getAttribute('role'), 'tab')
  assert.equal(tab.getAttribute('aria-controls'), 'audit-panel-fact-graph-section')
  assert.equal(tab.getAttribute('aria-selected'), 'false')
  assert.equal(tab.title, 'Fact Inspector')
  assert.equal(tab.querySelector('.audit-panel__tab-label').textContent, 'Fact')
  assert.equal(tab.querySelector('.usa-sr-only').textContent, 'Fact Inspector')
})

// The icon used to be an <img src> at a hard-coded credit-assistant path, swapped by JS; it is now
// one inlined glyph that CSS mirrors on body.audit-panel-open.
test('the toggle button ships an inline icon and reports its expanded state', async () => {
  const panel = await mount()
  const toggle = panel.querySelector('#toggle-audit-panel')
  assert.ok(toggle.querySelector('svg.audit-panel__tab-icon'), 'the glyph is inline SVG')
  assert.equal(toggle.querySelector('img'), null, 'no host-specific image path to 404 on')

  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  panel.openTab('fact-graph')
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  panel.closePanel()
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
})

test('a host <template> with a section’s id wins over the bundle’s copy', async () => {
  // The door left open for credit-assistant to server-render translated copies later.
  const hosted = document.createElement('template')
  hosted.id = 'tap-fact-inspector'
  hosted.innerHTML = '<p id="from-the-host">Inspecteur de faits</p>'
  document.body.appendChild(hosted)

  const panel = await mount()
  assert.ok(panel.querySelector('#audit-panel-fact-graph-section #from-the-host'))
})
