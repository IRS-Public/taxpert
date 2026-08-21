// config.js — the host-registration API. Driven with jsdom because configure() dispatches on
// `document`.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

let configure
let getConfig
let _resetConfig
let CONFIG_CHANGE_EVENT

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.CustomEvent = dom.window.CustomEvent
  ;({ configure, getConfig, _resetConfig, CONFIG_CHANGE_EVENT } = await import(
    '../src/shared/js/config.js'
  ))
})

beforeEach(() => _resetConfig())

test('an unconfigured host gets every namespace, fully populated', () => {
  const config = getConfig()
  assert.equal(config.app.brand, 'Taxpert')
  assert.equal(config.app.storagePrefix, 'taxpert')
  assert.deepEqual(config.nav.menu, [])
  assert.deepEqual(config.nav.toolsByDestination, [])
  assert.equal(config.endpoints.apiBase, 'http://localhost:8000')
  assert.equal(config.endpoints.scenariosBase, '')
  assert.deepEqual(config.featureFlags, [])
  assert.deepEqual(config.determinations, [])
  assert.equal(typeof config.graph.get, 'function')
  assert.equal(typeof config.flowDom.isHidden, 'function')
})

test('application content defaults to empty, platform content does not', () => {
  const config = getConfig()
  // The application layer: a host must supply it.
  assert.deepEqual(config.determinations, [])
  assert.deepEqual(config.nav.menu, [])
  // The platform layer: the three workspace tools ship with the workspace.
  assert.deepEqual(config.tools.map((t) => t.id), ['inspect', 'outcome-tracker', 'watchlist'])
})

test('no default carries EITC or credit-assistant identity', () => {
  const serialized = JSON.stringify(getConfig())
  assert.doesNotMatch(serialized, /eitc/i)
  assert.doesNotMatch(serialized, /\/app\//)
  assert.doesNotMatch(serialized, /taxYear/)
})

test('configure merges namespace by namespace, leaving siblings alone', () => {
  configure({ endpoints: { scenariosBase: '/app/x/scenarios' } })
  const config = getConfig()
  assert.equal(config.endpoints.scenariosBase, '/app/x/scenarios')
  // apiBase was not named, so it keeps its default rather than being wiped by the partial object.
  assert.equal(config.endpoints.apiBase, 'http://localhost:8000')
})

test('configure is re-callable and accumulates', () => {
  configure({ app: { id: 'twe' } })
  configure({ app: { brand: 'Tax Withholding Estimator' } })
  const config = getConfig()
  assert.equal(config.app.id, 'twe')
  assert.equal(config.app.brand, 'Tax Withholding Estimator')
  assert.equal(config.app.storagePrefix, 'taxpert')
})

test('arrays replace rather than merge', () => {
  configure({ nav: { menu: [{ id: 'a' }, { id: 'b' }] } })
  configure({ nav: { menu: [{ id: 'c' }] } })
  assert.deepEqual(getConfig().nav.menu.map((i) => i.id), ['c'])
})

test('functions replace rather than merge', () => {
  const outcome = () => 'Yes'
  configure({ determinations: [{ id: 'd', outcome }] })
  assert.equal(getConfig().determinations[0].outcome, outcome)
})

test('unknown top-level keys are ignored, not written', () => {
  configure({ notANamespace: 1, __proto__: { polluted: true } })
  assert.equal(getConfig().notANamespace, undefined)
  assert.equal({}.polluted, undefined)
})

test('configure tolerates junk', () => {
  assert.equal(configure(null), getConfig())
  assert.equal(configure(undefined), getConfig())
  assert.equal(configure('nope'), getConfig())
})

test('configure dispatches CONFIG_CHANGE_EVENT so a rendered element can re-read', () => {
  let seen = null
  document.addEventListener(CONFIG_CHANGE_EVENT, (e) => { seen = e.detail.config }, { once: true })
  configure({ app: { id: 'eitc' } })
  assert.equal(seen.app.id, 'eitc')
})

test('getConfig returns the live object, so a late reader sees a late configure', () => {
  const early = getConfig()
  configure({ app: { id: 'late' } })
  assert.equal(early.app.id, 'late')
})
