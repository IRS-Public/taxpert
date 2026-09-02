// Where <taxpert-global-nav> gets its markup, and what happens when it cannot get it.
//
// Two paths:
//
//   hosted    the host server-renders the five <template> elements, so the bar renders on connect
//             with no fetch and no window in which the header is empty
//   degraded  nothing supplies them and the fetch fails, so the bar degrades loudly rather than the
//             page quietly losing its header
//
// Separate from taxpert-global-nav.test.mjs, which is about what a rendered bar does. This one is
// about getting to one at all, so it owns the document state the element reads at import time.
// See ../../../docs/internals/bundled-build.md.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { FIXTURE_NAV } from './helpers/nav-fixture.mjs'

const NAV_HTML_URL = new URL('../src/global-nav/templates/global-nav.html', import.meta.url)

let NAV_TEMPLATE_IDS, _resetTemplates, _resetConfig
let navHtml
let fetches = []
let errors = []

// Put the bundle's own template file on the page, the way a host's <head> fragment does. Read off
// disk rather than retyped, so this exercises the markup that actually ships.
function hostTemplates () {
  const holder = document.createElement('template')
  holder.innerHTML = navHtml
  for (const template of [...holder.content.querySelectorAll('template[id]')]) {
    document.head.appendChild(template)
  }
}

before(async () => {
  // The bundle's own shipped file, named by a URL literal above.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  navHtml = await readFile(NAV_HTML_URL, 'utf8')
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.customElements = dom.window.customElements

  // Every fetch is recorded and every fetch fails. The point of both tests below is that one of
  // them never reaches this and the other survives it.
  globalThis.fetch = async (input) => {
    fetches.push(String(input?.url ?? input))
    throw new Error('network is down')
  }
  console.error = (...args) => errors.push(args.map(String).join(' '))

  // Hosted *before* the module is imported: the bundle decides at module evaluation whether to
  // prefetch, and a test that hosts them afterwards would not exercise that.
  hostTemplates()
  ;({ NAV_TEMPLATE_IDS } = await import('../src/global-nav/js/templates.js'))
  ;({ _resetTemplates } = await import('../src/shared/js/templates.js'))
  const config = await import('../src/shared/js/config.js')
  _resetConfig = config._resetConfig
  config.configure({ nav: FIXTURE_NAV })
  await import('../src/global-nav/js/taxpert-global-nav.js')
})

beforeEach(() => {
  fetches = []
  errors = []
})

async function mount () {
  const nav = document.createElement('taxpert-global-nav')
  document.body.appendChild(nav)
  await nav.ready
  return nav
}

test('the id list is exactly the ids the bundle ships', () => {
  const shipped = [...navHtml.matchAll(/<template id="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual([...NAV_TEMPLATE_IDS].sort(), shipped.sort())
})

test('hosted: with the templates on the page the bar renders and nothing is fetched', async () => {
  const nav = await mount()

  assert.deepEqual(fetches, [])
  assert.ok(nav.querySelector('.tgn-waffle'), 'the waffle is there')
  assert.ok(nav.querySelector('.tgn-tools .tgn-tool'), 'the tool strip is built')
  assert.ok(nav.querySelector('.tgn-group'), 'the taxonomy is built')
  assert.ok(document.querySelector('.tgn-sprite'), 'the icon sprite reached the document')
  assert.deepEqual(errors, [])
})

test('degraded: with no templates and a failing fetch the bar degrades and says so', async () => {
  // Unhost them and drop the registry: this is a page that supplies nothing and a network that
  // gives nothing back.
  for (const id of NAV_TEMPLATE_IDS) document.getElementById(id)?.remove()
  document.body.replaceChildren()
  _resetTemplates()

  const nav = await mount()

  assert.equal(fetches.length, 1, 'it tried the bundle file')
  assert.ok(nav.querySelector('.tgn-waffle'), 'the waffle survives')
  assert.ok(nav.querySelector('.tgn-toggle'), 'so does the workspace switch')
  assert.equal(nav.querySelector('.tgn-tool'), null, 'and nothing that needs a template does')

  const reported = errors.join('\n')
  assert.match(reported, /global-nav\.html/, 'the failing URL is named')
  assert.match(reported, /could not build the bar/, 'and so is what it cost')
})

test('the degraded bar still toggles the workspace', async () => {
  const nav = document.querySelector('taxpert-global-nav')
  let toggled = null
  nav.addEventListener('workspace-toggle', (event) => { toggled = event.detail.on })

  nav.querySelector('.tgn-toggle').click()

  assert.equal(toggled, true)
  assert.equal(nav.hasAttribute('data-workspace-on'), true)
})

test.after(() => _resetConfig())
