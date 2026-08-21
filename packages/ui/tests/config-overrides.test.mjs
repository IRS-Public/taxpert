// The user override layer: defaults → host configure() → localStorage. What makes the workspace
// editable without a code change.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

let getConfig
let configure
let _resetConfig
let getConfigOverrides
let setConfigOverride
let setConfigOverrides
let resetConfigOverride
let resetAllConfigOverrides
let isOverridden
let CONFIG_CHANGE_EVENT

const OVERRIDE_TOOLS = [{ id: 'inspect', label: 'Inspect', templateId: 'ttp-body-inspect' }]

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.localStorage = dom.window.localStorage
  ;({
    getConfig, configure, _resetConfig, getConfigOverrides, setConfigOverride, setConfigOverrides,
    resetConfigOverride, resetAllConfigOverrides, isOverridden, CONFIG_CHANGE_EVENT,
  } = await import('../src/shared/js/config.js'))
})

beforeEach(() => {
  localStorage.clear()
  _resetConfig()
})

// ── the layering itself ──────────────────────────────────────────────────────

test('an override wins over the host', () => {
  configure({ app: { brand: 'Tax Withholding Estimator' } })
  setConfigOverride('app.brand', 'My Workspace')
  assert.equal(getConfig().app.brand, 'My Workspace')
})

test('an override keeps winning when the host configures again afterwards', () => {
  // The ordering is the whole point: a per-page fragment re-configuring must not silently undo
  // what someone set in Workspace settings.
  setConfigOverride('app.brand', 'My Workspace')
  configure({ app: { brand: 'Tax Withholding Estimator' } })
  assert.equal(getConfig().app.brand, 'My Workspace')
})

test('an override touches only its own key', () => {
  configure({ app: { id: 'twe', brand: 'Tax Withholding Estimator', storagePrefix: 'twe' } })
  setConfigOverride('app.brand', 'My Workspace')
  assert.equal(getConfig().app.id, 'twe', 'sibling survives')
  assert.equal(getConfig().app.storagePrefix, 'twe')
})

test('a whole namespace can be replaced', () => {
  assert.equal(getConfig().tools.length, 3, 'three platform tools by default')
  setConfigOverride('tools', OVERRIDE_TOOLS)
  assert.equal(getConfig().tools.length, 1)
})

test('resetting restores the build’s value', () => {
  configure({ app: { brand: 'Tax Withholding Estimator' } })
  setConfigOverride('app.brand', 'My Workspace')
  resetConfigOverride('app.brand')
  assert.equal(getConfig().app.brand, 'Tax Withholding Estimator')
})

test('resetting the last key in a namespace drops the namespace too', () => {
  setConfigOverride('app.brand', 'x')
  assert.equal(isOverridden('app'), true)
  resetConfigOverride('app.brand')
  assert.deepEqual(getConfigOverrides(), {})
  assert.equal(isOverridden('app'), false)
})

test('resetAll is the way back out of a corner', () => {
  setConfigOverride('tools', OVERRIDE_TOOLS)
  setConfigOverride('app.brand', 'x')
  resetAllConfigOverrides()
  assert.deepEqual(getConfigOverrides(), {})
  assert.equal(getConfig().tools.length, 3)
})

test('isOverridden answers for a namespace and for one key inside it', () => {
  assert.equal(isOverridden('app'), false)
  setConfigOverride('app.brand', 'x')
  assert.equal(isOverridden('app'), true)
  assert.equal(isOverridden('app.brand'), true)
  assert.equal(isOverridden('app.id'), false)
  assert.equal(isOverridden('tools'), false)
})

// ── persistence ──────────────────────────────────────────────────────────────

test('overrides survive a reload, namespaced by the host’s storage prefix', () => {
  configure({ app: { storagePrefix: 'twe' } })
  setConfigOverride('tools', OVERRIDE_TOOLS)
  assert.ok(localStorage.getItem('twe:configOverrides'), 'stored under the host’s prefix')

  _resetConfig() // the reload
  configure({ app: { storagePrefix: 'twe' } })
  assert.equal(getConfig().tools.length, 1)
})

test('two apps on one origin do not share overrides', () => {
  configure({ app: { storagePrefix: 'twe' } })
  setConfigOverride('app.brand', 'TWE workspace')

  _resetConfig()
  configure({ app: { storagePrefix: 'eitc' } })
  assert.notEqual(getConfig().app.brand, 'TWE workspace')
})

// storagePrefix decides *where* the overrides are kept, so an override that moved it would
// relocate its own record and disappear on the next load.
test('app.storagePrefix cannot be overridden', () => {
  configure({ app: { storagePrefix: 'twe' } })
  setConfigOverrides({ app: { storagePrefix: 'somewhere-else', brand: 'Kept' } })
  assert.equal(getConfig().app.storagePrefix, 'twe')
  assert.equal(getConfig().app.brand, 'Kept', 'the rest of the namespace still applies')
})

// ── validation ───────────────────────────────────────────────────────────────

test('an invalid override is refused and nothing is stored', () => {
  const result = setConfigOverride('determinations', [{ id: 'x' }])
  assert.equal(result.ok, false)
  assert.ok(result.errors.length)
  assert.equal(localStorage.getItem('taxpert:configOverrides'), null)
})

test('an unknown namespace is refused', () => {
  assert.equal(setConfigOverride('determinatons', []).ok, false)
})

test('a path deeper than namespace.key is refused', () => {
  assert.equal(setConfigOverride('app.brand.name', 'x').ok, false)
})

// The all-or-nothing rule: a stored set that has gone bad — hand-edited, or written by an older
// build — must not be half-applied, because the result is a workspace nobody can reproduce.
test('a corrupt stored set is dropped whole and the build’s config boots', () => {
  localStorage.setItem(
    'taxpert:configOverrides',
    JSON.stringify({ tools: OVERRIDE_TOOLS, determinations: [{ id: 'broken' }] })
  )
  configure({ app: { brand: 'Build' } })
  assert.equal(getConfig().tools.length, 3, 'the valid half was dropped along with the invalid one')
  assert.equal(getConfig().app.brand, 'Build')
})

test('unparseable JSON in storage is survivable', () => {
  localStorage.setItem('taxpert:configOverrides', 'not json{')
  assert.equal(getConfig().tools.length, 3)
})

// ── the two contracts everything else depends on ─────────────────────────────

test('an override dispatches CONFIG_CHANGE_EVENT, so a rendered element re-reads', () => {
  let seen = null
  document.addEventListener(CONFIG_CHANGE_EVENT, (e) => { seen = e.detail.config }, { once: true })
  setConfigOverride('app.brand', 'My Workspace')
  assert.equal(seen?.app.brand, 'My Workspace')
})

test('the merged object’s identity is stable across an override', () => {
  const early = getConfig()
  setConfigOverride('app.brand', 'My Workspace')
  assert.equal(early, getConfig())
  assert.equal(early.app.brand, 'My Workspace', 'and it is live, not a snapshot')
})

test('getConfigOverrides hands back a copy, not the live record', () => {
  setConfigOverride('app.brand', 'x')
  const copy = getConfigOverrides()
  copy.app.brand = 'mutated'
  assert.equal(getConfig().app.brand, 'x')
})

// ── The per-deployment layer ─────────────────────────────────────────────────

test('a deployment config file is applied, and wins over the build', async () => {
  const { configureFromUrl } = await import('../src/shared/js/config.js')
  configure({ app: { brand: 'Build' }, endpoints: { apiBase: 'http://localhost:8000' } })

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ app: { brand: 'This deployment' } }),
  })
  const result = await configureFromUrl('/resources/taxpert.config.json')

  assert.equal(result.ok, true)
  assert.equal(getConfig().app.brand, 'This deployment')
  assert.equal(getConfig().endpoints.apiBase, 'http://localhost:8000', 'siblings survive')
})

// Most deployments override nothing, so an absent file is the normal case and must be silent.
test('a missing deployment file is not an error', async () => {
  const { configureFromUrl } = await import('../src/shared/js/config.js')
  globalThis.fetch = async () => ({ ok: false, status: 404 })
  assert.deepEqual(await configureFromUrl('/nope.json'), { ok: true, errors: [] })
})

// A file that is present and wrong is a different matter: something was deployed that does not
// describe this workspace, and half-applying it would be the worst outcome.
test('a deployment file the schema refuses is not applied', async () => {
  const { configureFromUrl } = await import('../src/shared/js/config.js')
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ determinations: [{ id: 'x' }] }),
  })
  const result = await configureFromUrl('/bad.json')

  assert.equal(result.ok, false)
  assert.equal(getConfig().determinations.length, 0)
})

test('a user override still wins over the deployment file', async () => {
  const { configureFromUrl } = await import('../src/shared/js/config.js')
  setConfigOverride('app.brand', 'Mine')
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ app: { brand: 'This deployment' } }),
  })
  await configureFromUrl('/resources/taxpert.config.json')
  assert.equal(getConfig().app.brand, 'Mine')
})
