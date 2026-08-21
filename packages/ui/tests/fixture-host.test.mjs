// The proof: the whole workspace mounted on a host taxpert has never heard of.
//
// Every other spec drives one module. This one plays a *host* — it registers a config, a graph
// adapter and a flowDom whose markup has nothing in common with credit-assistant's, then mounts the
// tool dock and the three panels and asserts they render real content.
//
// The failure this exists to catch is a literal creeping back into src/: a hardcoded 'fg-set', a
// `window.factGraph` reach-around, a determination list the library ships. Any of those and the
// fixture host renders empty or throws, here, in milliseconds — rather than in a browser, in front
// of whoever is adopting the library next.
import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'
import { registerFixtureHost, FIXTURE_HOST_MENU } from './fixtures/host/config.mjs'

let config
let navData
let factValues
let inspectCues
let graph

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
  globalThis.sessionStorage = dom.window.sessionStorage
  stubTemplateFetch()

  await import('../src/tool-panels/js/taxpert-tool-dock.js')
  await import('../src/tool-panels/js/taxpert-outcome-tracker.js')
  config = await import('../src/shared/js/config.js')
  navData = await import('../src/global-nav/js/nav-menu-data.js')
  factValues = await import('../src/tool-panels/js/fact-values.js')
  inspectCues = await import('../src/tool-panels/js/inspect-cues.js')
})

beforeEach(() => {
  config._resetConfig()
  document.body.replaceChildren()
  graph = registerFixtureHost(config.configure, {
    values: {
      '/hasPet': true,
      '/wantsPet': false,
      '/monthlyBudget': '40.00',
      '/hasBudget': true,
      '/isReadyForPet': true,
      '/petDecision': 'approved',
      '/pets/#pet-1/name': 'Biscuit',
    },
  })
})

after(() => config._resetConfig())

// ── The graph port ────────────────────────────────────────────────────────────────────────────

test('the tools read the fixture graph through the port, with no window.factGraph anywhere', () => {
  assert.equal(globalThis.window.factGraph, undefined)

  const decision = factValues.readFact({ path: '/petDecision', collectionId: '' })
  assert.equal(decision.status, 'complete')
  assert.equal(decision.raw, 'approved')

  // A Dollar is formatted from the fixture's own type node — proof the definition lookup went
  // through the adapter rather than through a graph.dictionary reach-around.
  const budget = factValues.readFact({ path: '/monthlyBudget', collectionId: '' })
  assert.equal(budget.value, '$40')
  assert.equal(budget.typeLabel, 'Dollar')
})

test('an unanswered fact reports incomplete, and an unknown one reports unknown', () => {
  assert.equal(factValues.readFact({ path: '/petCount', collectionId: '' }).status, 'incomplete')
  assert.equal(factValues.readFact({ path: '/nonsense', collectionId: '' }).status, 'unknown')
})

test('collection ids are derived from the fixture dictionary’s own wildcard paths', () => {
  assert.deepEqual(factValues.collectionIds(), ['pet-1', 'pet-2'])
  const named = factValues.readFact({ path: '/pets/*/name', collectionId: 'pet-1' })
  assert.equal(named.value, 'Biscuit')
})

test('the workspace listens on the host’s change events, not fg-load/fg-update', () => {
  assert.deepEqual(factValues.factChangeEvents(), [
    'fixture-graph-loaded',
    'fixture-graph-changed',
  ])
})

// ── The Outcome tracker ───────────────────────────────────────────────────────────────────────

test('the Outcome tracker renders the fixture host’s determination, not a shipped one', async () => {
  const tracker = document.createElement('taxpert-outcome-tracker')
  document.body.append(tracker)
  await tracker.ready

  const rows = tracker.querySelectorAll('[data-determination]')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].dataset.determination, 'pet-readiness')
  assert.match(tracker.textContent, /Pet readiness/)

  // The enum rollup goes through the host's own outcome() — the non-boolean branch.
  assert.equal(rows[0].dataset.status, 'settled')
  assert.match(rows[0].querySelector('[data-field="value"]').textContent, /Ready for a pet/)
})

test('a host that declares no determinations gets an empty state, not an empty accordion', async () => {
  config.configure({ determinations: [] })
  const tracker = document.createElement('taxpert-outcome-tracker')
  document.body.append(tracker)
  await tracker.ready

  assert.equal(tracker.querySelectorAll('[data-determination]').length, 0)
  assert.ok(tracker.textContent.trim().length > 0, 'the empty state says something')
})

// ── The flow markup ───────────────────────────────────────────────────────────────────────────

test('Inspect cues attach to the host’s own tags and read its own attributes', async () => {
  document.body.innerHTML = `
    <article class="step">
      <x-question fact="/hasPet"><label class="x-prompt">Do you have a pet?</label></x-question>
      <x-display fact="/monthlyBudget"></x-display>
      <x-display fact="/petKind"></x-display>
    </article>`

  inspectCues.showInspectCues()

  const cued = [...document.querySelectorAll('[data-inspect-unit]')]
    .map((el) => el.getAttribute('fact'))
  // /petKind is in the host's uncuedPaths, so it is the one display unit left alone.
  assert.deepEqual(cued.sort(), ['/hasPet', '/monthlyBudget'])

  inspectCues.hideInspectCues()
})

test('no fg-* element is required for any of this to work', () => {
  assert.equal(document.querySelector('fg-set, fg-show, fg-alert'), null)
})

// ── The nav ───────────────────────────────────────────────────────────────────────────────────

test('the nav taxonomy is the fixture host’s, and the brand follows config', () => {
  assert.deepEqual(navData.navMenu(), FIXTURE_HOST_MENU)
  assert.equal(navData.contextLabel('planner'), 'Pet Planner')
  assert.equal(navData.breadcrumbFor('planner'), 'Fixture | Pet Planner')
  assert.equal(navData.resolveItem('planner').href, '/fixture/')
})

// ── Storage ───────────────────────────────────────────────────────────────────────────────────

test('the fixture host’s state is namespaced away from any other app’s', async () => {
  const { storageKey } = await import('../src/shared/js/storage-keys.js')
  assert.equal(storageKey('watchlist'), 'fixture:watchlist')
  assert.equal(storageKey('toolLayout'), 'fixture:toolLayout')
})

// ── Live updates ──────────────────────────────────────────────────────────────────────────────

test('a value change on the host’s own event refreshes the tracker in place', async () => {
  const tracker = document.createElement('taxpert-outcome-tracker')
  document.body.append(tracker)
  await tracker.ready

  const row = tracker.querySelector('[data-determination="pet-readiness"]')
  const before = row.querySelector('[data-field="value"]').textContent

  graph.set('/petDecision', 'declined')
  const after = row.querySelector('[data-field="value"]').textContent

  assert.notEqual(after, before)
  // The same row element, not a rebuilt one — an expanded determination must survive an update.
  assert.equal(tracker.querySelector('[data-determination="pet-readiness"]'), row)
})
