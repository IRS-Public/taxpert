// DOM-level tests for <taxpert-scenario-modal>, driven with jsdom. jsdom has no showModal(),
// so the element falls back to toggling the `open` attribute — assertions use dialog.open, which
// tracks either path.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'
import { configure, _resetConfig } from '../src/shared/js/config.js'

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
  // The element's markup is fetched from templates/*.html; answer that off disk.
  stubTemplateFetch()
  await import('../src/audit-panel/js/scenario-modal.js')
})

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  _resetConfig()
  document.body.className = ''
  document.body.innerHTML = ''
})

// Templates are fetched, so building the dialog is asynchronous — `ready` resolves once it exists.
async function mount () {
  const modal = document.createElement('taxpert-scenario-modal')
  document.body.appendChild(modal)
  await modal.ready
  return modal
}

test('renders every scenario task as its own section, in the designed order', async () => {
  const modal = await mount()
  assert.equal(modal.querySelector('.tsm-heading').textContent, 'Manage scenario')
  const titles = [...modal.querySelectorAll('.tsm-section__title')].map((h) =>
    h.textContent.replace(/\s+/g, ' ').trim()
  )
  assert.deepEqual(titles, [
    'Reset scenario',
    'Copy fact graph',
    'Paste fact graph',
    'Generate a scenario Alpha',
    'Load existing scenario',
  ])
})

// The behavior ported from the old rail tabs queries these by id, so they are load-bearing.
test('keeps the ids fact-graph-io.js queries by', async () => {
  const modal = await mount()
  for (const id of [
    'copy-fg-status',
    'load-fact-graph',
    'scenario-gen-prompt',
    'scenario-gen-status',
    'scenario-gen-result',
    'scenario-gen-description',
    'download-scenario-btn',
    'scenario-select',
    'load-scenario-btn',
    'generate-scenario-btn',
    'all-screens-clear-scenario',
  ]) {
    assert.ok(modal.querySelector(`#${id}`), `#${id} present`)
  }
})

// The section is always rendered and gated by data-ff="ai-scenario-generation" against
// body.ff-ai-scenario-generation (shared/styles/feature-flags.css) — one representation of the
// flag, instead of the surface being reached into and `hidden` separately. It answers to its own
// flag, not to the Explain tab's aiFactExplanation.
test('AI scenario generation is unavailable until its own flag is on', async () => {
  const modal = await mount()
  const block = modal.querySelector('#scenario-gen-block')
  assert.equal(block.dataset.ff, 'ai-scenario-generation', 'gated by the flag')
  assert.equal(document.body.classList.contains('ff-ai-scenario-generation'), false, 'off by default')
  modal.setAiScenarioGeneration(true)
  assert.equal(
    document.body.classList.contains('ff-ai-scenario-generation'), true, 'revealed when on'
  )
  assert.equal(
    document.body.classList.contains('ff-ai-fact-explanation'), false,
    'the fact-explanation feature is untouched'
  )
  modal.setAiScenarioGeneration(false)
  assert.equal(document.body.classList.contains('ff-ai-scenario-generation'), false)
})

test('the nav’s Scenario button opens it; Display and Tools do not', async () => {
  const modal = await mount()
  const dialog = modal.querySelector('dialog')
  assert.equal(dialog.open, false)

  document.dispatchEvent(new CustomEvent('nav-tool-select', { detail: { id: 'display' } }))
  assert.equal(dialog.open, false, 'Display has no surface here')

  document.dispatchEvent(new CustomEvent('nav-tool-select', { detail: { id: 'scenario' } }))
  assert.equal(dialog.open, true, 'Scenario opens the modal')

  modal.close()
  assert.equal(dialog.open, false)
})

test('the close button dismisses the modal', async () => {
  const modal = await mount()
  modal.open()
  modal.querySelector('.tsm-close').click()
  assert.equal(modal.querySelector('dialog').open, false)
  assert.equal(document.body.classList.contains('usa-js-modal--active'), false)
})

test('scenarioOptions takes the host’s <option> nodes straight', async () => {
  const modal = await mount()
  const option = document.createElement('option')
  option.value = 'a.json'
  option.textContent = 'A'
  modal.scenarioOptions = [option]
  assert.deepEqual(
    [...modal.querySelector('#scenario-select').options].map((o) => o.value),
    ['', 'a.json']
  )
  assert.equal(modal.querySelector('#scenario-library-block').hidden, false)

  modal.scenarioOptions = null
  assert.equal(modal.querySelector('#scenario-library-block').hidden, true, 'no scenarios, no library')
})

test('scenarioOptionsHtml fills the library and reassigning replaces it', async () => {
  const modal = await mount()
  modal.scenarioOptionsHtml = '<option value="a.json">A</option>'
  assert.deepEqual(
    [...modal.querySelector('#scenario-select').options].map((o) => o.value),
    ['', 'a.json']
  )
  modal.scenarioOptionsHtml = '<option value="b.json">B</option>'
  assert.deepEqual(
    [...modal.querySelector('#scenario-select').options].map((o) => o.value),
    ['', 'b.json'],
    'the placeholder survives, the previous library does not'
  )
})

test('a dependent filter group hides when its controlling filter does not match', async () => {
  const modal = await mount()
  modal.scenarioOptionsHtml = '<option value="dq_single.json">DQ</option>'
  modal.registerScenarioFilters(
    [
      {
        id: 'scenario-filter-dq',
        key: 'eligibility',
        label: 'Eligibility',
        options: [
          { value: '', label: 'All' },
          { value: 'qualifying', label: 'Qualifying' },
          { value: 'disqualifying', label: 'Disqualifying' },
        ],
      },
      {
        id: 'scenario-filter-kids',
        groupId: 'scenario-filter-kids-group',
        key: 'children',
        label: 'Qualifying children',
        options: [{ value: '', label: 'All' }],
        showFor: { filter: 'scenario-filter-dq', values: ['qualifying'] },
      },
    ],
    (filename) => ({ eligibility: filename.startsWith('dq') ? 'disqualifying' : 'qualifying' })
  )

  const dq = modal.querySelector('#scenario-filter-dq')
  dq.value = 'disqualifying'
  dq.dispatchEvent(new window.Event('change'))
  assert.equal(modal.querySelector('#scenario-filter-kids-group').hidden, true)

  dq.value = 'qualifying'
  dq.dispatchEvent(new window.Event('change'))
  assert.equal(modal.querySelector('#scenario-filter-kids-group').hidden, false)
})

// "Clear scenario" used to be wired to clearGeneratedScenario(), which only hid the AI section's
// result — the loaded facts stayed. It clears the graph itself now, through the port.
test('Clear scenario unloads the graph, the selection and any generated scenario', async () => {
  const loaded = []
  configure({ graph: { load: (json) => loaded.push(json) } })
  const modal = await mount()
  modal.scenarioOptionsHtml = '<option value="a.json">A</option>'
  modal.querySelector('#scenario-select').value = 'a.json'
  sessionStorage.setItem('taxpert:generatedScenario', '{"description":"x"}')
  modal.querySelector('#scenario-gen-result').hidden = false

  modal.querySelector('#all-screens-clear-scenario').click()

  assert.deepEqual(loaded, ['{}'], 'the graph is replaced with an empty one')
  assert.equal(modal.querySelector('#scenario-select').value, '', 'the library selection resets')
  assert.equal(sessionStorage.getItem('taxpert:generatedScenario'), null)
  assert.equal(modal.querySelector('#scenario-gen-result').hidden, true)
})

// A host with no loader configured: load() throws by contract, and a click handler must not.
test('Clear scenario survives a host with no fact-graph loader', async () => {
  const modal = await mount()
  assert.doesNotThrow(() => modal.querySelector('#all-screens-clear-scenario').click())
})

// The nav's Scenario button can be pressed before this modal's markup has landed — the nav and the
// audit panel fetch their templates separately. The ask is remembered rather than dropped.
test('an open() before the templates land is honoured once they do', async () => {
  const modal = document.createElement('taxpert-scenario-modal')
  document.body.appendChild(modal)
  modal.open() // synchronously, before `ready`

  await modal.ready
  assert.equal(modal.querySelector('dialog').open, true, 'it opened when it could')
  modal.close()
})
