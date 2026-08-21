// DOM-level tests for <taxpert-audit-panel>, driven with jsdom. fetch + window.factGraph are
// stubbed so enable() runs without a live backend.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

const FACT_DICTIONARY_XML =
  '<FactDictionaryModule><Facts><Fact path="/a"><Writable><Boolean/></Writable></Fact></Facts></FactDictionaryModule>'

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
  // Bundle templates come off disk; everything else (the fact dictionary) keeps its stub.
  stubTemplateFetch(async () => ({ ok: true, text: async () => FACT_DICTIONARY_XML }))
  await import('../src/audit-panel/js/taxpert-audit-panel.js')
})

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  document.body.className = ''
  document.body.innerHTML = ''
})

// The panel's markup is cloned from fetched templates, so connecting is asynchronous — `ready`
// resolves once the DOM exists. (enable() awaits it too, so hosts needn't.)
async function mount (attrs = {}, innerHTML = '') {
  const panel = document.createElement('taxpert-audit-panel')
  panel.id = 'audit-panel'
  for (const [k, v] of Object.entries(attrs)) panel.setAttribute(k, v)
  if (innerHTML) panel.innerHTML = innerHTML
  document.body.appendChild(panel)
  await panel.ready
  // The three modals it mounts build themselves from templates too.
  await Promise.all([
    panel.scenarioModal?.ready,
    panel.displayModal?.ready,
    panel.workspaceSettingsModal?.ready,
  ])
  return panel
}

test('renders the built-in sections and rail tabs in order', async () => {
  const panel = await mount()
  const labels = [...panel.querySelectorAll('.audit-panel__tab[role="tab"] .audit-panel__tab-label')]
    .map((s) => s.textContent)
  // Graph + Scenarios moved into the Manage scenario modal, Flow into the Display options modal,
  // Flags into the Workspace settings modal.
  assert.deepEqual(labels, ['Fact', 'Explain'])
  // The section bodies exist with their original ids (CSS depends on these).
  for (const id of [
    'audit-panel-fact-graph-section',
    'audit-panel-explain-section',
  ]) {
    assert.ok(panel.querySelector(`#${id}`), `${id} present`)
  }
  assert.ok(panel.classList.contains('audit-panel'))
  assert.ok(panel.classList.contains('hidden'))
})

test('the panel mounts a <taxpert-scenario-modal> beside itself', async () => {
  const panel = await mount()
  const modal = document.querySelector('taxpert-scenario-modal')
  assert.ok(modal, 'modal created')
  assert.equal(modal.parentElement, document.body, 'mounted as a body-level dialog, not inside the panel')
  assert.equal(panel.scenarioModal, modal)
})

test('the panel mounts a <taxpert-display-modal> beside itself', async () => {
  const panel = await mount()
  const modal = document.querySelector('taxpert-display-modal')
  assert.ok(modal, 'modal created')
  assert.equal(modal.parentElement, document.body, 'mounted as a body-level dialog, not inside the panel')
  assert.equal(panel.displayModal, modal)
})

test('the panel mounts a <taxpert-workspace-settings-modal> beside itself', async () => {
  const panel = await mount()
  const modal = document.querySelector('taxpert-workspace-settings-modal')
  assert.ok(modal, 'modal created')
  assert.equal(modal.parentElement, document.body, 'mounted as a body-level dialog, not inside the panel')
  assert.equal(panel.workspaceSettingsModal, modal)
})

test('host scenario <option>s are forwarded to the modal’s #scenario-select', async () => {
  await mount({}, '<option value="a.json">A</option><option value="b.json">B</option>')
  const modal = document.querySelector('taxpert-scenario-modal')
  const values = [...modal.querySelector('#scenario-select').options].map((o) => o.value)
  assert.deepEqual(values, ['', 'a.json', 'b.json'])
  assert.equal(modal.querySelector('#scenario-library-block').hidden, false)
})

test('scenario options wrapped in a <template> are forwarded to the modal', async () => {
  await mount({}, '<template><option value="a.json">A</option></template>')
  const modal = document.querySelector('taxpert-scenario-modal')
  const values = [...modal.querySelector('#scenario-select').options].map((o) => o.value)
  assert.deepEqual(values, ['', 'a.json'])
})

test('the scenario library is hidden when the host supplies no scenarios', async () => {
  await mount()
  const modal = document.querySelector('taxpert-scenario-modal')
  assert.equal(modal.querySelector('#scenario-library-block').hidden, true)
})

test('registerSection inserts a host section at its order position', async () => {
  const panel = await mount()
  panel.registerSection({
    sectionId: 'audit-panel-eligibility-section',
    dataTab: 'eligibility-dashboard',
    label: 'Eligibility',
    title: 'Eligibility Dashboard',
    order: 40,
    eager: true,
    render (container) {
      container.innerHTML = '<h2>Eligibility Inspector</h2>'
    },
  })
  const labels = [...panel.querySelectorAll('.audit-panel__tab[role="tab"] .audit-panel__tab-label')]
    .map((s) => s.textContent)
  // order 40 lands between Fact (20) and Explain (50)
  assert.deepEqual(labels, ['Fact', 'Eligibility', 'Explain'])
  assert.ok(panel.querySelector('#audit-panel-eligibility-section h2'))
})

test('registerScenarioFilters is forwarded to the modal, which filters the options', async () => {
  const panel = await mount({}, '<option value="dq_single.json">DQ</option><option value="single.json">Q</option>')
  const modal = document.querySelector('taxpert-scenario-modal')
  panel.registerScenarioFilters(
    [{
      id: 'scenario-filter-dq',
      key: 'eligibility',
      label: 'Eligibility',
      options: [
        { value: '', label: 'All' },
        { value: 'qualifying', label: 'Qualifying' },
        { value: 'disqualifying', label: 'Disqualifying' },
      ]
    }],
    (filename) => ({ eligibility: filename.startsWith('dq') ? 'disqualifying' : 'qualifying' })
  )
  const filter = modal.querySelector('#scenario-filter-dq')
  assert.ok(filter, 'filter dropdown built')
  filter.value = 'qualifying'
  filter.dispatchEvent(new window.Event('change'))
  const select = modal.querySelector('#scenario-select')
  const byValue = Object.fromEntries([...select.options].map((o) => [o.value, o.hidden]))
  assert.equal(byValue['dq_single.json'], true, 'DQ scenario hidden')
  assert.equal(byValue['single.json'], false, 'qualifying scenario visible')
})

test('openTab / closePanel toggle body state, storage and aria-selected', async () => {
  const panel = await mount()
  await panel.enable() // wires _tabButtons
  panel.openTab('fact-graph')
  assert.equal(document.body.classList.contains('audit-panel-open'), true)
  assert.equal(panel.dataset.activeTab, 'fact-graph')
  const factTab = panel.querySelector('.audit-panel__tab[data-tab="fact-graph"]')
  assert.equal(factTab.getAttribute('aria-selected'), 'true')
  assert.equal(JSON.parse(sessionStorage.getItem('taxpert:auditPanel')).activeTab, 'fact-graph')

  panel.closePanel()
  assert.equal(document.body.classList.contains('audit-panel-open'), false)
  assert.equal(panel.dataset.activeTab, undefined)
})

test('enable() reveals the panel and wraps every <fg-show> in a <fact-link>', async () => {
  window.factGraph = {
    paths: () => ['/a', '/b'],
    get: () => ({ hasValue: false, complete: false, get: '' }),
    dictionary: { getDefinition: () => ({ typeNode: 'Boolean' }) },
  }
  const panel = await mount()
  const show = document.createElement('fg-show')
  show.setAttribute('path', '/a')
  document.body.appendChild(show)

  await panel.enable()
  assert.equal(panel.classList.contains('hidden'), false, 'panel revealed')
  const link = document.querySelector('fact-link a')
  assert.ok(link, 'fg-show wrapped in a clickable fact-link <a>')
  assert.ok(document.querySelector('fact-link a fg-show'), 'the <a> owns the fg-show')

  panel.disable()
  assert.equal(panel.classList.contains('hidden'), true, 'panel hidden again')
  // disable() removes the clickable <a> wrapper (faithful to the original panel-shell.js);
  // the fg-show returns to the page (no longer inside an <a>).
  assert.equal(document.querySelector('fact-link a'), null, 'clickable link removed on disable')
  assert.ok(document.querySelector('fg-show'), 'fg-show still present after disable')
  delete window.factGraph
})
