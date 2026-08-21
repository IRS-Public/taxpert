// storage-keys.js — namespacing so two Form Builder apps on one origin do not share dev-tool state.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

let storageKey
let configure
let _resetConfig

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.CustomEvent = dom.window.CustomEvent
  ;({ storageKey } = await import('../src/shared/js/storage-keys.js'))
  ;({ configure, _resetConfig } = await import('../src/shared/js/config.js'))
})

beforeEach(() => _resetConfig())

// The behaviour-preserving guarantee: an unconfigured host writes exactly the keys it writes today.
test('an unconfigured host keeps today’s key spellings', () => {
  assert.equal(storageKey('watchlist'), 'taxpert:watchlist')
  assert.equal(storageKey('toolLayout'), 'taxpert:toolLayout')
  assert.equal(storageKey('display'), 'taxpert:display')
  assert.equal(storageKey('featureFlags'), 'taxpert:featureFlags')
})

test('a configured prefix moves every key at once', () => {
  configure({ app: { storagePrefix: 'twe' } })
  assert.equal(storageKey('watchlist'), 'twe:watchlist')
  assert.equal(storageKey('toolLayout'), 'twe:toolLayout')
})

test('two apps on one origin do not collide', () => {
  configure({ app: { storagePrefix: 'eitc' } })
  const eitc = storageKey('watchlist')
  _resetConfig()
  configure({ app: { storagePrefix: 'twe' } })
  assert.notEqual(storageKey('watchlist'), eitc)
})

test('an empty prefix falls back rather than writing a bare “:key”', () => {
  configure({ app: { storagePrefix: '' } })
  assert.equal(storageKey('watchlist'), 'taxpert:watchlist')
})

test('the prefix is read late, so a key survives a later configure', () => {
  assert.equal(storageKey('watchlist'), 'taxpert:watchlist')
  configure({ app: { storagePrefix: 'twe' } })
  assert.equal(storageKey('watchlist'), 'twe:watchlist')
})

// The three keys that were still bare literals after the first namespacing pass. Two of them move
// for every host (the accepted one-time reset); the third must NOT move for the hosts that exist,
// because fact-explorer reads it by naming convention rather than by importing feature-flags.js.
test('the last three keys are namespaced', () => {
  assert.equal(storageKey('generatedScenario'), 'taxpert:generatedScenario')
  assert.equal(storageKey('auditPanelChat'), 'taxpert:auditPanelChat')
})

test('the feature-flags key is byte-identical for a host that keeps the default prefix', () => {
  // credit-assistant and fact-explorer both configure storagePrefix: 'taxpert', so both keep
  // resolving to the literal this key used to be. Change this and the two apps silently stop
  // sharing flag overrides.
  configure({ app: { storagePrefix: 'taxpert' } })
  assert.equal(storageKey('featureFlags'), 'taxpert:featureFlags')
})
