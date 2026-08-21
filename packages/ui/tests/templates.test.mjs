// The bundle <template> loader: all three branches of getTemplate()'s resolution order, plus the
// templates-base override and the load-failure path.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

const FIXTURE = new URL('./fixtures/templates-fixture.html', import.meta.url)

let loadTemplates, getTemplate, hasTemplate, templateUrl, _resetTemplates

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  stubTemplateFetch(async (url) => ({ ok: false, status: 404, text: async () => '' }))
  ;({ loadTemplates, getTemplate, hasTemplate, templateUrl, _resetTemplates } = await import(
    '../src/shared/js/templates.js'
  ))
})

beforeEach(() => {
  document.body.replaceChildren()
  document.head.replaceChildren()
  _resetTemplates()
})

test('a fetched bundle file registers every <template id>', async () => {
  await loadTemplates(FIXTURE)

  assert.equal(hasTemplate('fixture-greeting'), true)
  const fragment = getTemplate('fixture-greeting')
  assert.equal(fragment.querySelector('p').textContent.trim(), 'hello from the bundle')
})

test('each getTemplate call yields an independent clone', async () => {
  await loadTemplates(FIXTURE)

  const first = getTemplate('fixture-greeting')
  first.querySelector('p').textContent = 'mutated'
  const second = getTemplate('fixture-greeting')

  assert.equal(second.querySelector('p').textContent.trim(), 'hello from the bundle')
})

test('a host <template> on the page wins over the bundle registry', async () => {
  await loadTemplates(FIXTURE)

  const hosted = document.createElement('template')
  hosted.id = 'fixture-greeting'
  hosted.innerHTML = '<p>hello from the host</p>'
  document.body.appendChild(hosted)

  assert.equal(getTemplate('fixture-greeting').querySelector('p').textContent, 'hello from the host')
})

test('a host <template> resolves even with no bundle loaded at all', () => {
  const hosted = document.createElement('template')
  hosted.id = 'host-only'
  hosted.innerHTML = '<span>server-rendered</span>'
  document.body.appendChild(hosted)

  assert.equal(getTemplate('host-only').querySelector('span').textContent, 'server-rendered')
})

test('an element on the page that is not a <template> is not mistaken for one', async () => {
  await loadTemplates(FIXTURE)
  const decoy = document.createElement('div')
  decoy.id = 'fixture-greeting'
  document.body.appendChild(decoy)

  assert.equal(getTemplate('fixture-greeting').querySelector('p').textContent.trim(), 'hello from the bundle')
})

test('an unknown id throws, naming the id and the bundles that were loaded', async () => {
  await loadTemplates(FIXTURE)

  assert.throws(() => getTemplate('nope'), (error) => {
    assert.match(error.message, /nope/)
    assert.match(error.message, /templates-fixture\.html/)
    return true
  })
  assert.equal(hasTemplate('nope'), false)
})

test('loadTemplates is memoized per URL — one fetch however many callers', async () => {
  let calls = 0
  const realFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    calls += 1
    return realFetch(input, init)
  }

  await Promise.all([loadTemplates(FIXTURE), loadTemplates(FIXTURE), loadTemplates(String(FIXTURE))])
  await loadTemplates(FIXTURE)

  globalThis.fetch = realFetch
  assert.equal(calls, 1)
})

test('a failed load rejects with the URL named, and does not poison later attempts', async () => {
  const missing = new URL('./fixtures/does-not-exist.html', import.meta.url)

  await assert.rejects(loadTemplates(missing), (error) => {
    assert.match(error.message, /could not load templates/)
    assert.match(error.message, /does-not-exist\.html/)
    return true
  })

  // The memo was dropped, so a retry runs a fresh fetch rather than replaying the failure.
  await assert.rejects(loadTemplates(missing), /could not load templates/)
})

test('templateUrl honours a templates-base attribute, and ignores its absence', () => {
  const bundleDefault = 'http://localhost/vendor/taxpert/audit-panel/templates/audit-panel.html'
  const element = document.createElement('div')

  assert.equal(templateUrl(element, bundleDefault, 'audit-panel.html'), bundleDefault)
  assert.equal(templateUrl(null, bundleDefault, 'audit-panel.html'), bundleDefault)

  element.setAttribute('templates-base', '/assets/tpl')
  assert.equal(
    templateUrl(element, bundleDefault, 'audit-panel.html'),
    'http://localhost/assets/tpl/audit-panel.html'
  )
})
