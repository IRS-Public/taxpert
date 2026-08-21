// The workspace's favicon: what it replaces, what it leaves alone, and what makes a second install
// a no-op. The module installs on import, so the document has to exist before it is imported — the
// same order a page gives it, since it is mounted from a <script type="module"> in <head>.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

let installFavicon
/** What the document looked like straight after the import, before any test touched it. */
let onImport

/** The icon links the scaffold's fragments/head.html puts on every generated page. */
const APP_ICONS = `
  <link rel="icon" type="image/ico" href="/app/eitc/resources/img/favicon.ico" />
  <link rel="icon" type="image/png" href="/app/eitc/resources/img/apple-icon.png" />
  <link rel="icon" type="image/png" sizes="192x192" href="/app/eitc/resources/img/android-icon-192x192.png" />
  <link rel="apple-touch-icon-precomposed" sizes="72x72" href="/app/eitc/resources/img/apple-icon-72x72.png" />
`

before(async () => {
  const dom = new JSDOM(`<!doctype html><html><head>${APP_ICONS}</head><body></body></html>`, {
    url: 'http://localhost/app/eitc/',
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  ;({ installFavicon } = await import('../src/shared/js/favicon.js'))
  onImport = {
    taxpert: document.querySelectorAll('link[data-taxpert-favicon]').length,
    app: document.querySelectorAll('link[href*="resources/img"][rel~="icon"]').length,
  }
})

beforeEach(() => {
  document.head.innerHTML = APP_ICONS
})

const icons = () => [...document.querySelectorAll('link[rel~="icon"]')]

test('importing the module installs the icon, with no call from the page', () => {
  // A page mounts this as a bare <script type="module">, so the import has to be the whole of the
  // arrangement. These two counts were taken in the `before` hook, straight after it.
  assert.equal(onImport.taxpert, 1)
  assert.equal(onImport.app, 0)
})

test('the workspace icon is the page’s only rel="icon"', () => {
  assert.equal(icons().length, 3)
  installFavicon()
  const remaining = icons()
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].getAttribute('data-taxpert-favicon'), '')
  assert.match(remaining[0].href, /favicon\.png$/)
})

test('the home-screen icon is left alone: the workspace has no claim on a saved product page', () => {
  installFavicon()
  assert.equal(document.querySelectorAll('link[rel="apple-touch-icon-precomposed"]').length, 1)
})

test('a second install is the same link rather than a second one', () => {
  const first = installFavicon()
  const second = installFavicon()
  assert.equal(first, second)
  assert.equal(icons().length, 1)
})

test('a host can hand in its own icon', () => {
  const link = installFavicon('/app/eitc/resources/img/custom.png')
  assert.equal(link.getAttribute('href'), '/app/eitc/resources/img/custom.png')
  assert.equal(icons().length, 1)
})
