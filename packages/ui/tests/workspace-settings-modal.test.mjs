// DOM-level tests for <taxpert-workspace-settings-modal>, driven with jsdom. jsdom has no
// showModal(), so the element falls back to toggling the `open` attribute — assertions use
// dialog.open, which tracks either path.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

let getFlag
let setFlag
let configure
let _resetConfig

// The two flags credit-assistant declares. The modal ships none of its own — the rows are the
// host's config — so every spec here registers them first.
const AI_FLAGS = [
  { name: 'aiScenarioGeneration', kebab: 'ai-scenario-generation', label: 'AI scenario generation' },
  { name: 'aiFactExplanation', kebab: 'ai-fact-explanation', label: 'AI fact explanations' },
]

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
  await import('../src/audit-panel/js/workspace-settings-modal.js')
  ;({ getFlag, setFlag } = await import('../src/audit-panel/js/feature-flags.js'))
  ;({ configure, _resetConfig } = await import('../src/shared/js/config.js'))
})

beforeEach(() => {
  localStorage.clear()
  document.body.className = ''
  document.body.innerHTML = ''
  _resetConfig()
  configure({ featureFlags: AI_FLAGS })
})

// Templates are fetched, so building the dialog is asynchronous — `ready` resolves once it exists.
async function mount () {
  const modal = document.createElement('taxpert-workspace-settings-modal')
  document.body.appendChild(modal)
  await modal.ready
  return modal
}

const sectionTitles = (modal) =>
  [...modal.querySelectorAll('.twsm-section:not([hidden]) .twsm-section__title')].map(
    (title) => title.textContent
  )

test('renders the Workspace settings heading and the Feature Flags section', async () => {
  const modal = await mount()
  assert.equal(modal.querySelector('.twsm-heading').textContent, 'Workspace settings')
  assert.equal(sectionTitles(modal)[0], 'Feature Flags')
})

// ── Applications ─────────────────────────────────────────────────────────────
//
// A fictional non-tax host, per this package's no-host-identity rule.
const TWO_APPS = {
  current: 'pet-planner',
  items: [
    {
      id: 'pet-planner',
      label: 'Pet Planner',
      destinations: [
        { id: 'product-experience', label: 'Product Experience', href: '/app/pets/' },
        { id: 'browse-all', label: 'Browse All', href: '/app/pets/all-screens/' },
      ],
    },
    {
      id: 'plant-planner',
      label: 'Plant Planner',
      destinations: [
        { id: 'product-experience', label: 'Product Experience', href: '/app/plants/' },
        { id: 'browse-all', label: 'Browse All', href: '/app/plants/all-screens/' },
      ],
    },
  ],
}

test('hides the Applications section when there is only one application', async () => {
  configure({ apps: { current: 'pet-planner', items: [TWO_APPS.items[0]] } })
  const modal = await mount()
  assert.equal(modal.querySelector('[data-section="apps"]').hidden, true)
  assert.ok(!sectionTitles(modal).includes('Applications'))
})

test('lists each application with its modes, the current one selected', async () => {
  configure({ apps: TWO_APPS })
  const modal = await mount()

  // Penultimate: above Advanced, below everything that configures this workspace rather than
  // choosing which application it is over. Pinned because the position is a deliberate call.
  assert.deepEqual(sectionTitles(modal).slice(-2), ['Applications', 'Advanced'])
  assert.deepEqual(
    [...modal.querySelectorAll('.twsm-app__name')].map((n) => n.textContent),
    ['Pet Planner', 'Plant Planner']
  )
  assert.deepEqual(
    [...modal.querySelectorAll('.twsm-app__modes')].map((n) => n.textContent),
    ['Product Experience · Browse All', 'Product Experience · Browse All']
  )
  const checked = modal.querySelector('.twsm-app input:checked')
  assert.equal(checked.value, 'pet-planner')
})

// The point of the whole section: the mode survives the switch. A host that cancels the event
// handles it itself — that is how fact-explorer swaps its canvas without a page load.
test('announces the switch at the same destination, cancelably', async () => {
  configure({ apps: TWO_APPS })
  const nav = document.createElement('taxpert-global-nav')
  nav.setAttribute('active', 'browse-all')
  document.body.appendChild(nav)

  const modal = await mount()
  const seen = []
  document.addEventListener('taxpert:app-select', (event) => {
    seen.push(event.detail)
    event.preventDefault() // stand in for a host that switches in-app
  })

  const target = modal.querySelector('#twsm-app-plant-planner')
  target.checked = true
  target.dispatchEvent(new window.Event('change'))

  assert.equal(seen.length, 1)
  assert.equal(seen[0].id, 'plant-planner')
  assert.equal(seen[0].href, '/app/plants/all-screens/')
})

const rowsOf = (modal) =>
  [...modal.querySelectorAll('input[data-flag]')].map((input) => [
    input.id,
    input.dataset.flag,
    modal.querySelector(`label[for="${input.id}"]`).textContent,
  ])

// One row per entry in config.featureFlags, with that entry's own wording. The two AI features are
// flagged separately, so credit-assistant gets a checkbox each — not one combined "AI mode" row.
test('renders one checkbox per configured flag, each naming its own', async () => {
  const modal = await mount()

  assert.deepEqual(rowsOf(modal), [
    ['twsm-ff-ai-scenario-generation', 'aiScenarioGeneration', 'AI scenario generation'],
    ['twsm-ff-ai-fact-explanation', 'aiFactExplanation', 'AI fact explanations'],
  ])
})

// The whole point of moving the rows into config: a second host's flags are its own, and it gets
// them without editing this package.
test('a different host gets its own flags, not another application’s', async () => {
  _resetConfig()
  configure({
    featureFlags: [
      { name: 'legacyAuditPanel', kebab: 'legacy-audit-panel', label: 'Legacy audit panel' },
    ],
  })
  const modal = await mount()

  assert.deepEqual(rowsOf(modal), [
    ['twsm-ff-legacy-audit-panel', 'legacyAuditPanel', 'Legacy audit panel'],
  ])
})

// The library's own default. Showing another application's AI checkboxes here would let someone
// switch on a feature this build does not have.
test('a host that declares no flags gets the empty state', async () => {
  _resetConfig()
  const modal = await mount()

  assert.deepEqual(rowsOf(modal), [])
  assert.equal(modal.querySelector('.twsm-empty').hidden, false)
})

// The rows are read late, like everything else that renders from configuration: credit-assistant
// loads the element modules and its config fragment as separate module scripts.
test('configuring after the dialog is built rebuilds the rows', async () => {
  _resetConfig()
  const modal = await mount()
  assert.deepEqual(rowsOf(modal), [])

  configure({ featureFlags: AI_FLAGS })

  assert.equal(rowsOf(modal).length, 2)
  assert.equal(modal.querySelector('.twsm-empty').hidden, true)
})

test('each checkbox reflects and writes only its own flag', async () => {
  const modal = await mount()
  const generation = modal.querySelector('#twsm-ff-ai-scenario-generation')
  const explanation = modal.querySelector('#twsm-ff-ai-fact-explanation')
  assert.equal(generation.checked, false, 'off by default')
  assert.equal(explanation.checked, false, 'off by default')

  generation.checked = true
  generation.dispatchEvent(new window.Event('change'))
  assert.equal(getFlag('aiScenarioGeneration'), true, 'setFlag persisted the override')
  assert.equal(getFlag('aiFactExplanation'), false, 'the other feature was not switched on')
  // The selected box follows from the control itself — USWDS's `--tile` checked rule, recolored in
  // workspace-settings-modal.css — so the checkbox's own state is the whole assertion, and the
  // tile class it hangs on is the only markup involved. There is no class mirroring `:checked`.
  assert.equal(
    modal.querySelectorAll('[data-options="flags"] .usa-checkbox__input--tile:checked').length, 1,
    'one box reads as selected'
  )

  explanation.checked = true
  explanation.dispatchEvent(new window.Event('change'))
  assert.equal(getFlag('aiFactExplanation'), true)

  generation.checked = false
  generation.dispatchEvent(new window.Event('change'))
  assert.equal(getFlag('aiScenarioGeneration'), false)
  assert.equal(getFlag('aiFactExplanation'), true, 'explanation stayed on')
})

test('opening the modal re-syncs every checkbox with the current flag state', async () => {
  const modal = await mount()
  setFlag('aiFactExplanation', true)
  modal.open()
  assert.equal(modal.querySelector('#twsm-ff-ai-fact-explanation').checked, true)
  assert.equal(modal.querySelector('#twsm-ff-ai-scenario-generation').checked, false)
  modal.close()
})

test('the nav’s settings gear opens it; Scenario and Display do not', async () => {
  const modal = await mount()
  const dialog = modal.querySelector('dialog')
  assert.equal(dialog.open, false)

  document.dispatchEvent(new window.CustomEvent('nav-tool-select', { detail: { id: 'scenario' } }))
  assert.equal(dialog.open, false, 'Scenario has no surface here')

  document.dispatchEvent(new window.CustomEvent('nav-tool-select', { detail: { id: 'display' } }))
  assert.equal(dialog.open, false, 'Display has no surface here')

  document.dispatchEvent(
    new window.CustomEvent('nav-tool-select', { detail: { id: 'workspace-settings' } })
  )
  assert.equal(dialog.open, true, 'the settings gear opens the modal')

  modal.close()
  assert.equal(dialog.open, false)
})

test('the close button dismisses the modal', async () => {
  const modal = await mount()
  modal.open()
  modal.querySelector('.twsm-close').click()
  assert.equal(modal.querySelector('dialog').open, false)
  assert.equal(document.body.classList.contains('usa-js-modal--active'), false)
})

// ── Tools: which tools this workspace offers ─────────────────────────────────

const toolRows = (modal) =>
  [...modal.querySelectorAll('[data-options="tools"] input')].map((input) => [
    input.id,
    input.checked,
  ])

test('one row per tool the build offers, all on by default', async () => {
  const modal = await mount()
  assert.deepEqual(toolRows(modal), [
    ['twsm-tool-inspect', true],
    ['twsm-tool-outcome-tracker', true],
    ['twsm-tool-watchlist', true],
  ])
})

test('unticking a tool removes it from the effective config', async () => {
  const { getConfig } = await import('../src/shared/js/config.js')
  const modal = await mount()

  const watchlist = modal.querySelector('#twsm-tool-watchlist')
  watchlist.checked = false
  watchlist.dispatchEvent(new window.Event('change'))

  assert.deepEqual(getConfig().tools.map((t) => t.id), ['inspect', 'outcome-tracker'])
})

// The row must come from the *build's* list, not the effective one — reading the effective list
// would take a switched-off tool's own row away and leave no way to switch it back on.
test('a switched-off tool keeps its row, unticked', async () => {
  const modal = await mount()
  const watchlist = modal.querySelector('#twsm-tool-watchlist')
  watchlist.checked = false
  watchlist.dispatchEvent(new window.Event('change'))

  assert.deepEqual(toolRows(modal), [
    ['twsm-tool-inspect', true],
    ['twsm-tool-outcome-tracker', true],
    ['twsm-tool-watchlist', false],
  ])
})

test('canonical dock order survives whatever order the boxes were ticked', async () => {
  const { getConfig } = await import('../src/shared/js/config.js')
  const modal = await mount()

  for (const id of ['#twsm-tool-inspect', '#twsm-tool-outcome-tracker']) {
    const input = modal.querySelector(id)
    input.checked = false
    input.dispatchEvent(new window.Event('change'))
  }
  // Switched back on last, but it is not appended last.
  const inspect = modal.querySelector('#twsm-tool-inspect')
  inspect.checked = true
  inspect.dispatchEvent(new window.Event('change'))

  assert.deepEqual(getConfig().tools.map((t) => t.id), ['inspect', 'watchlist'])
})

// ── Overridden markers and resets ────────────────────────────────────────────

test('nothing is marked as overridden on a fresh build', async () => {
  const modal = await mount()
  assert.equal(modal.querySelector('[data-override="tools"]').hidden, true)
  assert.equal(modal.querySelector('.twsm-footer').hidden, true)
})

test('changing a tool marks the section and reveals the reset-everything button', async () => {
  const modal = await mount()
  const watchlist = modal.querySelector('#twsm-tool-watchlist')
  watchlist.checked = false
  watchlist.dispatchEvent(new window.Event('change'))

  assert.equal(modal.querySelector('[data-override="tools"]').hidden, false)
  assert.equal(modal.querySelector('.twsm-footer').hidden, false)
})

test('the section’s Reset restores the build’s tools', async () => {
  const { getConfig } = await import('../src/shared/js/config.js')
  const modal = await mount()
  const watchlist = modal.querySelector('#twsm-tool-watchlist')
  watchlist.checked = false
  watchlist.dispatchEvent(new window.Event('change'))

  modal.querySelector('[data-reset="tools"]').click()

  assert.equal(getConfig().tools.length, 3)
  assert.deepEqual(toolRows(modal).map(([, checked]) => checked), [true, true, true])
  assert.equal(modal.querySelector('[data-override="tools"]').hidden, true)
  assert.equal(modal.querySelector('.twsm-footer').hidden, true)
})

test('reset-everything clears every override at once', async () => {
  const { getConfig, setConfigOverride } = await import('../src/shared/js/config.js')
  const modal = await mount()
  setConfigOverride('app.brand', 'My Workspace')
  const watchlist = modal.querySelector('#twsm-tool-watchlist')
  watchlist.checked = false
  watchlist.dispatchEvent(new window.Event('change'))

  modal.querySelector('.twsm-reset-all').click()

  assert.equal(getConfig().tools.length, 3)
  assert.equal(getConfig().app.brand, 'Taxpert')
  assert.equal(modal.querySelector('.twsm-footer').hidden, true)
})

// ── Advanced: endpoints and the whole-record JSON ────────────────────────────

test('endpoints show as “name = value” lines and are editable', async () => {
  const { getConfig } = await import('../src/shared/js/config.js')
  const modal = await mount()
  const field = modal.querySelector('[data-field="endpoints"]')
  assert.match(field.value, /apiBase = http:\/\/localhost:8000/)

  field.value = 'apiBase = http://localhost:9999\nscenariosBase = /s'
  field.dispatchEvent(new window.Event('change'))
  assert.equal(getConfig().endpoints.apiBase, 'http://localhost:9999')
  assert.equal(getConfig().endpoints.scenariosBase, '/s')
})

test('the JSON field holds the whole override record', async () => {
  const { setConfigOverride } = await import('../src/shared/js/config.js')
  const modal = await mount()
  assert.equal(modal.querySelector('[data-field="overrides"]').value, '{}')

  setConfigOverride('app.brand', 'My Workspace')
  assert.deepEqual(
    JSON.parse(modal.querySelector('[data-field="overrides"]').value),
    { app: { brand: 'My Workspace' } }
  )
})

test('pasting JSON applies the whole record', async () => {
  const { getConfig } = await import('../src/shared/js/config.js')
  const modal = await mount()
  const field = modal.querySelector('[data-field="overrides"]')

  field.value = JSON.stringify({ app: { brand: 'Imported' }, tools: [] })
  modal.querySelector('[data-action="import"]').click()

  assert.equal(getConfig().app.brand, 'Imported')
  assert.equal(getConfig().tools.length, 0)
  assert.equal(modal.querySelector('[data-error="import"]').hidden, true)
})

test('unparseable JSON says so and changes nothing', async () => {
  const { getConfig } = await import('../src/shared/js/config.js')
  const modal = await mount()
  const field = modal.querySelector('[data-field="overrides"]')

  field.value = '{ not json'
  modal.querySelector('[data-action="import"]').click()

  assert.equal(modal.querySelector('[data-error="import"]').hidden, false)
  assert.match(modal.querySelector('[data-error="import"]').textContent, /not valid JSON/)
  assert.equal(getConfig().tools.length, 3, 'nothing was applied')
})

// Valid JSON that is not a valid configuration reads differently to whoever typed it, and must be
// refused just as completely.
test('JSON the schema refuses says which part, and changes nothing', async () => {
  const { getConfig } = await import('../src/shared/js/config.js')
  const modal = await mount()
  const field = modal.querySelector('[data-field="overrides"]')

  field.value = JSON.stringify({ determinations: [{ id: 'x' }] })
  modal.querySelector('[data-action="import"]').click()

  assert.match(modal.querySelector('[data-error="import"]').textContent, /rollupPath/)
  assert.equal(getConfig().determinations.length, 0, 'nothing was applied')
})

test('Discard edits puts the fields back to what is stored', async () => {
  const modal = await mount()
  const field = modal.querySelector('[data-field="overrides"]')
  field.value = '{ typed but not applied'

  modal.querySelector('[data-action="revert-import"]').click()
  assert.equal(field.value, '{}')
})

// The modal is built once and reopened, so a <details> keeps whatever it was left in. That made the
// same modal open differently depending on what the last visit had unfolded — and differently again
// on a fresh page, where all of them were shut. The list of titles is the point of the disclosures.
test('every section is shut again on each open', async () => {
  const modal = await mount()
  const sections = () => [...modal.querySelectorAll('.twsm-section')]

  modal.open()
  assert.deepEqual(sections().map((s) => s.open), sections().map(() => false))

  sections()[0].open = true
  modal.close()
  modal.open()

  assert.deepEqual(sections().map((s) => s.open), sections().map(() => false))
})
