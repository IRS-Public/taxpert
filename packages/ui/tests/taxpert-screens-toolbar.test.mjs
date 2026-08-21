// DOM-level tests for <taxpert-screens-toolbar>, driven with jsdom.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

let currentMode

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
  globalThis.sessionStorage = dom.window.sessionStorage
  globalThis.DOMParser = dom.window.DOMParser
  globalThis.XMLSerializer = dom.window.XMLSerializer
  // The toolbar's markup is fetched from templates/*.html; answer that off disk.
  stubTemplateFetch()
  ;({ currentMode } = await import('../src/audit-panel/js/all-screens-toolbar.js'))
  // The toolbar corrects the nav's `active` (see the destination-identity test), which only means
  // anything once <taxpert-global-nav> is upgraded and its real setter is in play.
  await import('../src/global-nav/js/taxpert-global-nav.js')
})

// The toolbar applies layout + mode to the host page one tick late, so fg-components have time to
// materialize collection instances first; wait that out before asserting on the body.
const settled = () => new Promise((resolve) => setTimeout(resolve, 150))

beforeEach(async () => {
  // Let any deferred apply from the previous test land before we reset the page out from under it.
  await settled()
  sessionStorage.clear()
  document.body.className = ''
  document.body.innerHTML = `
    <main>
      <section class="all-screens__section" data-section="about"></section>
      <section class="all-screens__section" data-section="agi"></section>
    </main>
    <article class="screen" data-gate-condition="/g" data-gate-operator="isTrue"></article>`
})

// Templates are fetched, so the toolbar's DOM arrives asynchronously — `ready` resolves once it
// exists. Sections are set after that so the tab strip is built from them.
async function mount (sections = [{ slug: 'about', title: 'About' }, { slug: 'agi', title: 'AGI' }]) {
  const toolbar = document.createElement('taxpert-screens-toolbar')
  document.body.appendChild(toolbar)
  await toolbar.ready
  toolbar.sections = sections
  return toolbar
}

test('renders the destination title and a tab per section plus "All sections"', async () => {
  const toolbar = await mount()
  assert.equal(toolbar.querySelector('.all-screens__mode:not([hidden]) .all-screens__mode-title').textContent, 'Browse All')
  // The mode is a nav destination, not a control on this page, and the layout choice moved to the
  // Display options modal.
  assert.equal(toolbar.querySelector('#all-screens-toggle-scenario-view'), null)
  assert.equal(toolbar.querySelector('#all-screens-toggle-layout'), null)
  const tabs = [...toolbar.querySelectorAll('.all-screens__section-tab')].map((t) => t.textContent)
  assert.deepEqual(tabs, ['All sections', 'About', 'AGI'])
  toolbar.remove()
})

test('mode names the destination in the title', async () => {
  const toolbar = await mount()
  toolbar.mode = 'path'
  assert.equal(toolbar.querySelector('.all-screens__mode:not([hidden]) .all-screens__mode-title').textContent, 'Path Mode')
  toolbar.remove()
})

// Browse All and Path Mode are one generated page told apart by `?mode=path`, so the host can only
// server-render one `active` for both. The toolbar is the only thing that knows the runtime mode,
// so it corrects the nav — otherwise Path Mode wears Browse All's identity and tool strip.
test('the toolbar tells the global nav which of the two destinations you are on', async () => {
  const bar = document.createElement('taxpert-global-nav')
  bar.setAttribute('active', 'browse-all') // what the server rendered, for both modes
  document.body.appendChild(bar)

  const browse = await mount()
  assert.equal(bar.getAttribute('active'), 'browse-all')
  browse.remove()

  const path = document.createElement('taxpert-screens-toolbar')
  path.mode = 'path'
  document.body.appendChild(path)
  await path.ready
  assert.equal(bar.getAttribute('active'), 'path-mode')
  path.remove()
  bar.remove()
})

// Same reason the nav's `active` is corrected here: one generated page, two destinations, so the
// server-rendered <title> can only ever name one of them. Taken from the visible mode block rather
// than a second copy of the words, so a host that server-renders a translated #tst-toolbar gets a
// translated tab title too.
test('the destination names the browser tab as well as the page', async () => {
  const browse = await mount()
  assert.equal(document.title, 'Browse All')
  browse.remove()

  const path = document.createElement('taxpert-screens-toolbar')
  path.mode = 'path'
  document.body.appendChild(path)
  await path.ready
  assert.equal(document.title, 'Path Mode')
  path.remove()
})

// The strip is always rendered; `body.path-mode` — which the toolbar already sets — is what hides
// it (all-screens-toolbar.css), so its absence needn't be a branch in the render.
test('Path Mode drops the section tabs — a path is one scroll, not a filterable list', async () => {
  const toolbar = await mount()
  assert.ok(toolbar.querySelector('.all-screens__section-tabs'))
  toolbar.mode = 'path'
  await settled()
  assert.equal(document.body.classList.contains('path-mode'), true, 'the class the CSS hides it by')
  toolbar.remove()
})

test('Path Mode shows every section even when Browse All was left filtered to one', async () => {
  sessionStorage.setItem('taxpert:allScreens', JSON.stringify({ section: 'agi' }))
  const toolbar = await mount()
  toolbar.mode = 'path'
  assert.equal(document.querySelector('[data-section="about"]').hidden, false)
  toolbar.remove()
})

test('currentMode reads the destination off the URL, defaulting to browse', async () => {
  assert.equal(currentMode('?mode=path'), 'path')
  assert.equal(currentMode(''), 'browse')
  assert.equal(currentMode('?mode=browse'), 'browse')
  assert.equal(currentMode('?scenario=1'), 'browse')
})

test('clicking a section tab hides the other sections and emits section-select', async () => {
  const toolbar = await mount()
  let detail = null
  toolbar.addEventListener('section-select', (e) => (detail = e.detail))
  const agiTab = [...toolbar.querySelectorAll('.all-screens__section-tab')].find(
    (t) => t.dataset.section === 'agi'
  )
  agiTab.click()
  assert.equal(detail.slug, 'agi')
  assert.equal(document.querySelector('[data-section="about"]').hidden, true)
  assert.equal(document.querySelector('[data-section="agi"]').hidden, false)
  assert.equal(agiTab.getAttribute('aria-selected'), 'true', 'the tab reads as selected')
  toolbar.remove()
})

test('the toolbar re-applies the stored display options to the page it just rendered', async () => {
  sessionStorage.setItem('taxpert:display', JSON.stringify({ layout: 'wrap' }))
  document.querySelector('main').insertAdjacentHTML('beforeend', '<details id="d"></details>')
  const toolbar = await mount()
  await settled()
  assert.equal(document.body.classList.contains('layout--horizontal'), true, 'wrap layout applied')
  // No stored preference, and this is a screen-listing page → accordions default open.
  assert.equal(document.querySelector('#d').open, true)
  toolbar.remove()
})

test('a stack layout leaves body.layout--horizontal off', async () => {
  const toolbar = await mount()
  await settled()
  assert.equal(document.body.classList.contains('layout--horizontal'), false)
  toolbar.remove()
})

test('Path Mode uses checkConditionFn to hide unreachable gated screens', async () => {
  const toolbar = await mount()
  toolbar.checkConditionFn = () => false // the gated screen is unreachable
  toolbar.mode = 'path'
  await settled()
  assert.equal(document.body.classList.contains('path-mode'), true)
  assert.equal(document.querySelector('.screen[data-gate-condition]').hidden, true)
  toolbar.remove()
})

test('Browse All leaves every screen visible', async () => {
  const toolbar = await mount()
  toolbar.checkConditionFn = () => false
  toolbar.mode = 'browse'
  await settled()
  assert.equal(document.body.classList.contains('path-mode'), false)
  assert.equal(document.querySelector('.screen[data-gate-condition]').hidden, false)
  toolbar.remove()
})

test('Path Mode truncates the page at the first unanswered question, Browse All restores it', async () => {
  document.querySelector('main').insertAdjacentHTML(
    'beforeend',
    `<article class="screen" id="s1">
       <div class="screen__content">
         <fg-set id="q1"></fg-set><p id="after"></p><fg-set id="q2"></fg-set>
       </div>
     </article>`
  )
  const toolbar = await mount()
  toolbar.checkConditionFn = () => true
  toolbar.isAnsweredFn = (el) => el.id === 'q1' // q2 is where the user is now
  toolbar.mode = 'path'
  await settled()
  assert.equal(document.querySelector('#after').classList.contains('off-path'), false)
  assert.equal(document.querySelector('#q2').classList.contains('off-path'), false)

  // Answer it: the cursor advances and nothing is left marked.
  toolbar.isAnsweredFn = () => true
  document.dispatchEvent(new CustomEvent('fg-update'))
  assert.equal(document.querySelectorAll('.off-path').length, 0)

  // Back to Browse All: no marks survive the mode switch.
  toolbar.isAnsweredFn = () => false
  toolbar.mode = 'browse'
  await settled()
  assert.equal(document.querySelectorAll('.off-path').length, 0)
  toolbar.remove()
})

// Evaluating a condition needs the fact graph and the host's operator vocabulary, so only the host
// can supply it. With neither the property nor a configured flowDom.checkCondition, the descriptor's
// default answers "true" — nothing is conditioned out, so every gated screen is shown rather than
// one being guessed away — and a single warning names the property to set.
test('Path Mode without checkConditionFn warns once and conditions nothing out', async () => {
  const warnings = []
  const origWarn = console.warn
  console.warn = (msg) => warnings.push(msg)
  const toolbar = await mount()
  try {
    toolbar.mode = 'path'
    await settled()
    assert.equal(document.body.classList.contains('path-mode'), true)
    assert.equal(document.querySelector('.screen[data-gate-condition]').hidden, false)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /no checkConditionFn set/)
  } finally {
    console.warn = origWarn
  }
  toolbar.remove()
})

// The other way to supply one: a host that has told the package about its flow markup has told it
// how to evaluate a condition too, and need not reach for the property at all.
test('a configured flowDom.checkCondition drives Path Mode without the property', async () => {
  const { configure, _resetConfig } = await import('../src/shared/js/config.js')
  configure({ flowDom: { checkCondition: () => false } })
  const toolbar = await mount()
  try {
    toolbar.mode = 'path'
    await settled()
    assert.equal(document.querySelector('.screen[data-gate-condition]').hidden, true)
  } finally {
    _resetConfig()
  }
  toolbar.remove()
})

// ── The Product Experience ──────────────────────────────────────────────────
//
// The same bar, on a destination that has no listing under it. The mode arrives as an attribute
// because that mount is a server-rendered tag with no script beside it: the Product Experience is
// its own generated template, so no `?mode=` can say which destination this is.

async function mountProduct () {
  const toolbar = document.createElement('taxpert-screens-toolbar')
  toolbar.setAttribute('mode', 'product')
  document.body.appendChild(toolbar)
  await toolbar.ready
  return toolbar
}

test('the mode attribute names the destination the URL cannot', async () => {
  const toolbar = await mountProduct()
  assert.equal(toolbar.mode, 'product')
  assert.equal(
    toolbar.querySelector('.all-screens__mode:not([hidden]) .all-screens__mode-title').textContent,
    'Product Experience'
  )
  toolbar.remove()
})

// Every listing effect is skipped rather than run against a page that has none: no path class, no
// section filtering, and no display options re-applied (the audit panel's enable() does that here).
test('the Product Experience bar drives nothing under it', async () => {
  sessionStorage.setItem('taxpert:allScreens', JSON.stringify({ section: 'agi' }))
  sessionStorage.setItem('taxpert:display', JSON.stringify({ layout: 'wrap' }))
  const toolbar = await mountProduct()
  await settled()

  assert.equal(document.body.classList.contains('path-mode'), false)
  assert.equal(document.body.classList.contains('layout--horizontal'), false)
  assert.equal(document.querySelector('[data-section="about"]').hidden, false, 'nothing is filtered')
  toolbar.remove()
})

// The listings share one generated page, so the toolbar has to title it. A product page is titled
// by the server, per screen — overwriting that with the workspace's name for the destination would
// lose the only title the reader actually needs.
test('the Product Experience keeps the page’s own title', async () => {
  document.title = 'Filing status'
  const toolbar = await mountProduct()
  assert.equal(document.title, 'Filing status')
  toolbar.remove()
})

test('the nav is told which destination this is, here too', async () => {
  const bar = document.createElement('taxpert-global-nav')
  bar.setAttribute('active', 'product-experience')
  document.body.appendChild(bar)
  const toolbar = await mountProduct()
  assert.equal(bar.getAttribute('active'), 'product-experience')
  toolbar.remove()
  bar.remove()
})

// The stylesheet hides the section tabs and display-modal.css tells the destinations apart by this
// attribute, so the resolved mode has to read back off the host however it was arrived at.
test('the resolved mode is reflected for the stylesheet to select on', async () => {
  const browse = await mount()
  assert.equal(browse.getAttribute('mode'), 'browse')
  browse.mode = 'path'
  assert.equal(browse.getAttribute('mode'), 'path')
  browse.remove()
})
