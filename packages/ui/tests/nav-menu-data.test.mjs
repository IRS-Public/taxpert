// The taxonomy helpers, against a menu a host supplies.
//
// There is no DEFAULT_MENU any more: the nav ships with an empty taxonomy and a host configures
// one. So these read in two ways — an explicit `menu` argument, and the configured menu the
// argument defaults to — and the point of the pair is that they agree.
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { FIXTURE_MENU } from './helpers/nav-fixture.mjs'

// configure() dispatches on `document`, so there has to be one even for a spec with no elements.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.CustomEvent = dom.window.CustomEvent

const { configure, _resetConfig } = await import('../src/shared/js/config.js')
const { navMenu, resolveItem, contextLabel, breadcrumbFor } =
  await import('../src/global-nav/js/nav-menu-data.js')

beforeEach(() => {
  _resetConfig()
  configure({ nav: { menu: FIXTURE_MENU } })
})

after(() => _resetConfig())

// ── Reading a supplied menu ───────────────────────────────────────────────────

test('resolveItem finds top-level items and nested leaves', () => {
  assert.equal(resolveItem('fact-explorer', FIXTURE_MENU).label, 'Fact Explorer')
  assert.equal(resolveItem('product-experience', FIXTURE_MENU).href, '/product/')
  assert.equal(resolveItem('experience-explorer', FIXTURE_MENU).label, 'Experience Explorer')
})

test('resolveItem returns null for unknown or empty ids', () => {
  assert.equal(resolveItem('nope', FIXTURE_MENU), null)
  assert.equal(resolveItem('', FIXTURE_MENU), null)
  assert.equal(resolveItem(null, FIXTURE_MENU), null)
})

test('contextLabel returns the parent group label for a nested leaf', () => {
  assert.equal(contextLabel('product-experience', FIXTURE_MENU), 'Experience Explorer')
  assert.equal(contextLabel('path-mode', FIXTURE_MENU), 'Experience Explorer')
})

test('contextLabel returns the item label for a top-level item', () => {
  assert.equal(contextLabel('fact-explorer', FIXTURE_MENU), 'Fact Explorer')
})

test('contextLabel returns null for unknown/absent ids', () => {
  assert.equal(contextLabel('nope', FIXTURE_MENU), null)
  assert.equal(contextLabel(undefined, FIXTURE_MENU), null)
})

test('breadcrumbFor composes "<brand> | <context>"', () => {
  assert.equal(breadcrumbFor('product-experience', FIXTURE_MENU), 'Taxpert | Experience Explorer')
  assert.equal(breadcrumbFor('fact-explorer', FIXTURE_MENU), 'Taxpert | Fact Explorer')
})

test('breadcrumbFor falls back to the brand alone', () => {
  assert.equal(breadcrumbFor(null, FIXTURE_MENU), 'Taxpert')
  assert.equal(breadcrumbFor('nope', FIXTURE_MENU), 'Taxpert')
})

// ── Reading the configured menu ───────────────────────────────────────────────

// Every helper defaults its `menu` argument to the configured one, so a caller that has already
// told the package its taxonomy never has to pass it again.
test('the helpers default to the configured menu', () => {
  assert.deepEqual(navMenu(), FIXTURE_MENU)
  assert.equal(resolveItem('browse-all').label, 'Browse All')
  assert.equal(contextLabel('browse-all'), 'Experience Explorer')
  assert.equal(breadcrumbFor('browse-all'), 'Taxpert | Experience Explorer')
})

// A host that configures nothing gets a nav with no destinations rather than another
// application's — which is the whole reason the list moved out of this package.
test('with no host menu configured, every helper answers empty', () => {
  _resetConfig()
  assert.deepEqual(navMenu(), [])
  assert.equal(resolveItem('product-experience'), null)
  assert.equal(contextLabel('product-experience'), null)
  assert.equal(breadcrumbFor('product-experience'), 'Taxpert')
})

// The brand is the host's too, and it is the whole breadcrumb when there is no context.
test('breadcrumbFor speaks the configured brand', () => {
  configure({ app: { brand: 'Acme' } })
  assert.equal(breadcrumbFor(null), 'Acme')
  assert.equal(breadcrumbFor('fact-explorer'), 'Acme | Fact Explorer')
})
