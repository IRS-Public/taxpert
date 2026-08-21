// DOM-level tests for <taxpert-tools-modal>, driven with jsdom. jsdom has no showModal(), so the
// element falls back to toggling the `open` attribute — assertions use dialog.open, which tracks
// either path.
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
  // The element's markup is fetched from templates/*.html; answer that off disk.
  stubTemplateFetch()
  await import('../src/tool-panels/js/taxpert-tools-modal.js')
  layout = await import('../src/tool-panels/js/tool-layout.js')
  config = await import('../src/shared/js/config.js')
})

after(() => config._resetConfig())

beforeEach(() => {
  localStorage.clear()
  layout._resetToolLayout()
  // The tool list lives in the config now, and one test registers a fourth tool onto it.
  config._resetConfig()
  document.body.className = ''
  document.body.innerHTML = ''
})

// Templates are fetched, so building the dialog is asynchronous — `ready` resolves once it exists.
async function mount () {
  const modal = document.createElement('taxpert-tools-modal')
  document.body.appendChild(modal)
  await modal.ready
  return modal
}

test('renders the Tools heading', async () => {
  const modal = await mount()
  assert.equal(modal.querySelector('.ttm-heading').textContent, 'Tools')
})

test('renders one row per tool, in canonical order, each with its description', async () => {
  const modal = await mount()
  // The name is read off its own span, not off the label: the label is a tile and now holds the
  // description as a child too, so its textContent is both strings run together.
  const rows = [...modal.querySelectorAll('input[data-tool]')].map((input) => [
    input.dataset.tool,
    modal.querySelector(`label[for="${input.id}"] .ttm-option__name`).textContent,
    input.closest('.ttm-option').querySelector('.ttm-option__hint').textContent,
  ])

  assert.deepEqual(rows, [
    ['inspect', 'Inspect', 'Inspect facts, flows and text.'],
    [
      'outcome-tracker',
      'Outcome tracker',
      'Track the outcomes this application determines.',
    ],
    [
      'watchlist',
      'Watchlist',
      'Track the value of one or more facts as you work or load scenarios.',
    ],
  ])
})

test('a checkbox switches only its own tool on', async () => {
  const modal = await mount()
  const inspect = modal.querySelector('#ttm-tool-inspect')
  assert.equal(inspect.checked, false, 'off by default')

  inspect.checked = true
  inspect.dispatchEvent(new window.Event('change'))
  assert.deepEqual(layout.activeTools(), ['inspect'])
  // A row reads as chosen when its own control is checked — there is no class mirroring it. Matched
  // on both classes: `.usa-checkbox` is the whole row treatment now that tools-modal.css draws none
  // of it, so a row that lost that class would silently render without its control art.
  assert.equal(
    modal.querySelectorAll('.ttm-option.usa-checkbox:has(:checked)').length,
    1,
    'one row reads as chosen'
  )

  inspect.checked = false
  inspect.dispatchEvent(new window.Event('change'))
  assert.deepEqual(layout.activeTools(), [])
})

// The dock's [x] and the modal's checkbox are two views of one value; neither talks to the other.
test('a tool switched off elsewhere unticks its checkbox while the modal is open', async () => {
  const modal = await mount()
  modal.querySelector('#ttm-tool-watchlist').checked = true
  modal.querySelector('#ttm-tool-watchlist').dispatchEvent(new window.Event('change'))
  modal.open()
  assert.equal(modal.querySelector('#ttm-tool-watchlist').checked, true)

  layout.setToolOn('watchlist', false)
  assert.equal(modal.querySelector('#ttm-tool-watchlist').checked, false, 'followed the layout change')
  modal.close()
})

test('opening the modal re-syncs every checkbox with the current layout', async () => {
  const modal = await mount()
  layout.setToolOn('outcome-tracker', true)
  modal.open()
  assert.equal(modal.querySelector('#ttm-tool-outcome-tracker').checked, true)
  assert.equal(modal.querySelector('#ttm-tool-inspect').checked, false)
  modal.close()
})

// Reset is about placement: it redocks, it does not switch anything off.
test('Reset tool layout redocks every panel and leaves the checkboxes ticked', async () => {
  const modal = await mount()
  layout.setToolOn('inspect', true)
  layout.setToolOn('watchlist', true)
  layout.floatTool('watchlist', { x: 40, y: 40, w: 400, h: 400 })

  modal.querySelector('.ttm-reset').click()

  assert.deepEqual(
    layout.getLayout().columns.map((column) => column.ids), [['inspect', 'watchlist']]
  )
  assert.equal(layout.getLayout().floating.length, 0)
  assert.equal(modal.querySelector('#ttm-tool-inspect').checked, true)
  assert.equal(modal.querySelector('#ttm-tool-watchlist').checked, true)
})

test('the nav’s Tools button opens it; the other nav tools do not', async () => {
  const modal = await mount()
  const dialog = modal.querySelector('dialog')
  assert.equal(dialog.open, false)

  for (const id of ['scenario', 'display', 'workspace-settings']) {
    document.dispatchEvent(new window.CustomEvent('nav-tool-select', { detail: { id } }))
    assert.equal(dialog.open, false, `${id} has no surface here`)
  }

  document.dispatchEvent(new window.CustomEvent('nav-tool-select', { detail: { id: 'tools' } }))
  assert.equal(dialog.open, true, 'the Tools button opens the modal')

  modal.close()
  assert.equal(dialog.open, false)
})

test('the close button dismisses the modal', async () => {
  const modal = await mount()
  modal.open()
  modal.querySelector('.ttm-close').click()
  assert.equal(modal.querySelector('dialog').open, false)
  assert.equal(document.body.classList.contains('usa-js-modal--active'), false)
})

// The three tools the workspace ships with are the platform's; a host may add its own, and the
// modal is one of the two surfaces that has to notice.
test('a tool registered by the host gets a row of its own', async () => {
  const { registerTool } = await import('../src/tool-panels/js/tool-registry.js')
  registerTool({
    id: 'ledger',
    label: 'Ledger',
    description: 'Whatever this host tracks.',
    templateId: 'ttp-body-ledger',
  })

  const modal = await mount()
  const rows = [...modal.querySelectorAll('input[data-tool]')].map((input) => input.dataset.tool)
  assert.deepEqual(rows, ['inspect', 'outcome-tracker', 'watchlist', 'ledger'])
})

// …and it has to notice when the host says so *after* this element has rendered. A host page loads
// the element modules and its configure() call as separate <script type="module"> tags, so which
// wins the race is not something either side controls — the "read late, never capture" rule in
// config.js. This element captured, and the symptom was a fourth tool listed in Workspace settings
// (which re-reads) and absent from here, so there was no checkbox to open its panel with.
test('a tool configured after render still gets a row', async () => {
  const modal = await mount()
  assert.equal(modal.querySelectorAll('input[data-tool]').length, 3)

  config.configure({
    tools: [
      ...config.getConfig().tools,
      {
        id: 'ledger',
        label: 'Ledger',
        description: 'Whatever this host tracks.',
        templateId: 'ttp-body-ledger',
      },
    ],
  })

  const rows = [...modal.querySelectorAll('input[data-tool]')].map((input) => input.dataset.tool)
  assert.deepEqual(rows, ['inspect', 'outcome-tracker', 'watchlist', 'ledger'])
})

// The same race, one layer down: tool-layout.js memoizes the revived state, and reviveState() drops
// any stored id the registry does not know yet. A person who had the host's fourth tool switched on
// would have lost it on every load where configure() landed second.
test('a tool switched on in storage survives arriving after the first layout read', async () => {
  localStorage.setItem('taxpert:toolLayout', JSON.stringify({ on: ['ledger'], columns: [] }))
  assert.equal(layout.isToolOn('ledger'), false, 'unknown while the host has not declared it')

  config.configure({
    tools: [
      ...config.getConfig().tools,
      { id: 'ledger', label: 'Ledger', description: '', templateId: 'ttp-body-ledger' },
    ],
  })

  assert.equal(layout.isToolOn('ledger'), true)
})
