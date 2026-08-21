// DOM-level tests for the <taxpert-global-nav> custom element, driven with jsdom.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'
import { FIXTURE_NAV } from './helpers/nav-fixture.mjs'

let configure
let _resetConfig

// Stand up a DOM, then import the element module (which calls customElements.define).
//
// The nav ships with no taxonomy and no tool strip — both are the host's — so this spec plays the
// host, configuring the shape in helpers/nav-fixture.mjs before anything mounts.
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
  // The nav's markup is fetched from templates/global-nav.html; answer that off disk.
  stubTemplateFetch()
  ;({ configure, _resetConfig } = await import('../src/shared/js/config.js'))
  configure({ nav: FIXTURE_NAV })
  await import('../src/global-nav/js/taxpert-global-nav.js')
})

after(() => _resetConfig())

// The bar is cloned from a fetched template, so connecting is asynchronous — `ready` resolves once
// the DOM exists.
async function mount (attrs = {}) {
  const nav = document.createElement('taxpert-global-nav')
  for (const [k, v] of Object.entries(attrs)) nav.setAttribute(k, v)
  document.body.appendChild(nav)
  await nav.ready
  return nav
}

// Everything the nav can show is built once and stays; state changes move attributes. So a test
// that used to ask whether an element *exists* now asks whether it is *shown* — these say that.
const menuOpen = (nav) => nav.querySelector('.tgn-waffle').getAttribute('aria-expanded') === 'true'
const workspaceOn = (nav) => nav.hasAttribute('data-workspace-on')
const contextLabelOf = (nav) => {
  const ctx = nav.querySelector('.tgn-breadcrumb__ctx')
  return ctx.hidden ? null : ctx.textContent
}
const subLabels = (nav) =>
  [...nav.querySelectorAll('.tgn-group__items > .tgn-item .tgn-item__label')].map((s) => s.textContent)
// A group's children show when its header says it is expanded (CSS does the hiding).
const groupExpanded = (nav) =>
  nav.querySelector('.tgn-group__header').getAttribute('aria-expanded') === 'true'
const visibleSubLabels = (nav) => (groupExpanded(nav) ? subLabels(nav) : [])
const activeItems = (nav) => [...nav.querySelectorAll('.tgn-item[aria-current]')]
// Every leaf now carries a ✓ span (shown only on the active one), so match on the label rather
// than on the link's whole textContent.
const leafNamed = (nav, label) =>
  [...nav.querySelectorAll('.tgn-item')].find(
    (a) => a.querySelector('.tgn-item__label').textContent === label
  )
// Mirrors what a viewer sees: each tool hides itself where it doesn't apply, and global-nav.css
// takes the whole strip away when the workspace is off or when no tool is left showing.
const toolLabels = (nav) =>
  workspaceOn(nav)
    ? [...nav.querySelectorAll('.tgn-tool:not([hidden]) .tgn-tool__label')].map((s) => s.textContent)
    : []

test('renders a waffle button and breadcrumb; dropdown is closed initially', async () => {
  const nav = await mount({
    app: 'credit-assistant',
    active: 'product-experience',
    'workspace-on': 'true',
  })
  assert.ok(nav.querySelector('.tgn-waffle'), 'waffle button present')
  assert.equal(
    contextLabelOf(nav),
    'Experience Explorer',
    'breadcrumb reflects the active leaf’s group'
  )
  assert.equal(menuOpen(nav), false, 'dropdown closed by default')
  nav.remove()
})

test('context-label overrides the derived breadcrumb context (e.g. "Taxpert Home")', async () => {
  // A landing page that isn't a menu destination sets context-label directly.
  const nav = await mount({ app: 'fact-explorer', 'context-label': 'Taxpert Home', 'workspace-on': 'true' })
  assert.equal(
    contextLabelOf(nav),
    'Taxpert Home',
    'breadcrumb uses the context-label override, not a menu label'
  )
  // The breadcrumb's accessible name is its own text; the "|" between the two parts is
  // aria-hidden, so it reads as "Taxpert Taxpert Home" and not as punctuation.
  assert.equal(nav.querySelector('.tgn-breadcrumb__sep').getAttribute('aria-hidden'), 'true')
  nav.remove()
})

test('context-label is still hidden while the workspace is off', async () => {
  const nav = await mount({ app: 'fact-explorer', 'context-label': 'Taxpert Home', 'workspace-on': 'false' })
  assert.equal(contextLabelOf(nav), null, 'no context label when workspace off')
  nav.remove()
})

test('workspace off hides the context label and the nav taxonomy', async () => {
  const nav = await mount({
    app: 'credit-assistant',
    active: 'product-experience',
    'workspace-on': 'false',
  })
  // Header reverts to just "Taxpert" — no "| Experience Explorer".
  assert.equal(contextLabelOf(nav), null, 'no context label when off')
  assert.equal(nav.querySelector('.tgn-breadcrumb__root').textContent, 'Taxpert')

  nav.querySelector('.tgn-waffle').click()
  // Menu shows only the workspace toggle row, no mode/nav items.
  assert.ok(nav.querySelector('.tgn-workspace'), 'workspace toggle row present')
  // The taxonomy is built and hidden, not left unbuilt: `data-workspace-on` is its one switch
  // (global-nav.css), so turning the workspace on and off moves an attribute, not a render.
  assert.equal(workspaceOn(nav), false, 'the attribute the CSS hides the taxonomy by')
  assert.ok(nav.querySelector('.tgn-group'), 'the taxonomy is present, just not shown')
  nav.remove()
})

test('toggling the workspace on reveals the context label and taxonomy', async () => {
  const nav = await mount({ app: 'credit-assistant', active: 'product-experience' })
  assert.equal(contextLabelOf(nav), null, 'off by default: no context')

  nav.querySelector('.tgn-waffle').click()
  nav.querySelector('.tgn-toggle').click() // flips workspace-on → true, re-renders
  assert.equal(
    contextLabelOf(nav),
    'Experience Explorer',
    'context label appears once the workspace is on'
  )
  assert.equal(workspaceOn(nav), true, 'nav taxonomy shown once the workspace is on')
  nav.remove()
})

test('a group opens itself when it holds the active destination', async () => {
  for (const active of ['product-experience', 'browse-all', 'path-mode']) {
    const nav = await mount({ app: 'credit-assistant', active, 'workspace-on': 'true' })
    nav.querySelector('.tgn-waffle').click()
    assert.deepEqual(
      visibleSubLabels(nav),
      ['Product Experience', 'Browse All', 'Path Mode'],
      `modes shown on ${active}`
    )
    assert.equal(nav.querySelector('.tgn-group__header').getAttribute('aria-expanded'), 'true')
    assert.ok(
      nav.querySelector('.tgn-group:has(.tgn-item[aria-current])'),
      'the group is marked as the active place'
    )
    nav.remove()
  }
})

test('from another destination the group arrives shut — its modes are detail about a place you are not', async () => {
  for (const active of ['fact-explorer', 'authoring-suite']) {
    const nav = await mount({ app: 'credit-assistant', active, 'workspace-on': 'true' })
    nav.querySelector('.tgn-waffle').click()
    assert.deepEqual(visibleSubLabels(nav), [], `modes hidden on ${active}`)
    // The group header itself is still there — it is what opens them.
    assert.equal(nav.querySelector('.tgn-group__header .tgn-group__label').textContent, 'Experience Explorer')
    assert.equal(nav.querySelector('.tgn-group__header').getAttribute('aria-expanded'), 'false')
    assert.equal(nav.querySelector('.tgn-group:has(.tgn-item[aria-current])'), null)
    nav.remove()
  }
})

test('clicking the group header drops the modes down, and clicking again puts them away', async () => {
  const nav = await mount({ app: 'credit-assistant', active: 'authoring-suite', 'workspace-on': 'true' })
  nav.querySelector('.tgn-waffle').click()

  nav.querySelector('.tgn-group__header').click()
  assert.deepEqual(visibleSubLabels(nav), ['Product Experience', 'Browse All', 'Path Mode'])
  assert.equal(nav.querySelector('.tgn-group__header').getAttribute('aria-expanded'), 'true')

  nav.querySelector('.tgn-group__header').click()
  assert.deepEqual(visibleSubLabels(nav), [])
  nav.remove()
})

test('an explicit toggle wins over the active destination’s default', async () => {
  const nav = await mount({ app: 'credit-assistant', active: 'path-mode', 'workspace-on': 'true' })
  nav.querySelector('.tgn-waffle').click()
  nav.querySelector('.tgn-group__header').click() // shut the group we are inside
  assert.deepEqual(visibleSubLabels(nav), [])
  // Collapsed or not, it is still where you are — and now CSS can see that for itself, because
  // the collapsed group's children are in the DOM rather than unbuilt.
  assert.ok(nav.querySelector('.tgn-group:has(.tgn-item[aria-current])'))
  nav.remove()
})

test('the group header carries an accordion chevron', async () => {
  const nav = await mount({ app: 'credit-assistant', active: 'fact-explorer', 'workspace-on': 'true' })
  nav.querySelector('.tgn-waffle').click()
  assert.ok(nav.querySelector('.tgn-group__header .tgn-group__chevron'), 'chevron rendered')
  // Top-level leaves are destinations, not accordions — no chevron on them.
  assert.equal(nav.querySelector('.tgn-item .tgn-group__chevron'), null)
  nav.remove()
})

test('clicking the waffle opens the dropdown; Escape closes it', async () => {
  const nav = await mount({ app: 'credit-assistant', active: 'product-experience' })
  nav.querySelector('.tgn-waffle').click()
  assert.equal(menuOpen(nav), true, 'dropdown open after waffle click')
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
  assert.equal(menuOpen(nav), false, 'dropdown closed after Escape')
  nav.remove()
})

test('the active leaf gets a checkmark', async () => {
  const nav = await mount({ app: 'credit-assistant', active: 'browse-all', 'workspace-on': 'true' })
  nav.querySelector('.tgn-waffle').click()
  const [active] = activeItems(nav)
  assert.equal(active.querySelector('.tgn-item__label').textContent, 'Browse All')
  // The ✓ is on every leaf and shown on the one carrying aria-current (global-nav.css), so
  // aria-current is the whole assertion.
  assert.ok(active.querySelector('.tgn-item__check'), 'active item has a ✓')
  nav.remove()
})

// Path Mode is its own destination, so it — not the Browse All it shares a generated page with —
// is what the checkmark marks when you're there.
test('the checkmark follows Path Mode, and only Path Mode', async () => {
  const nav = await mount({ app: 'credit-assistant', active: 'path-mode', 'workspace-on': 'true' })
  nav.querySelector('.tgn-waffle').click()
  const checked = activeItems(nav)
  assert.equal(checked.length, 1)
  assert.equal(checked[0].querySelector('.tgn-item__label').textContent, 'Path Mode')
  nav.remove()
})

test('nav-select fires with the item detail and is cancelable', async () => {
  const nav = await mount({
    app: 'credit-assistant',
    active: 'product-experience',
    'workspace-on': 'true',
  })
  nav.querySelector('.tgn-waffle').click()
  let detail = null
  nav.addEventListener('nav-select', (e) => {
    detail = e.detail
    e.preventDefault() // don't navigate in the test
  })
  // Click the "Browse all" leaf.
  const link = leafNamed(nav, 'Browse All')
  link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  assert.equal(detail.id, 'browse-all')
  assert.equal(detail.href, '/product/all-screens/')
  nav.remove()
})

test('the workspace row carries a settings gear next to the toggle', async () => {
  const nav = await mount({ app: 'credit-assistant', active: 'product-experience' })
  nav.querySelector('.tgn-waffle').click()
  const gear = nav.querySelector('.tgn-workspace .workplace-settings')
  assert.ok(gear, 'gear rendered in the workspace row')
  assert.equal(gear.getAttribute('aria-label'), 'Workspace settings')
  assert.ok(gear.querySelector('svg'), 'renders the settings icon')
  nav.remove()
})

test('the settings gear emits nav-tool-select with id workspace-settings, and closes the menu', async () => {
  const nav = await mount({ app: 'credit-assistant', active: 'product-experience' })
  nav.querySelector('.tgn-waffle').click()
  let detail = null
  nav.addEventListener('nav-tool-select', (e) => (detail = e.detail))
  nav.querySelector('.tgn-workspace .workplace-settings').click()
  assert.deepEqual(detail, { id: 'workspace-settings' })
  // It doesn't touch the workspace toggle...
  assert.equal(nav.getAttribute('workspace-on'), null)
  // ...but it does close the dropdown, since the modal it opens covers the screen.
  assert.equal(menuOpen(nav), false, 'menu closes after opening the modal')
  nav.remove()
})

test('the full tool strip appears on the two scenario destinations once the workspace is on', async () => {
  for (const active of ['product-experience', 'path-mode']) {
    const nav = await mount({ app: 'credit-assistant', active, 'workspace-on': 'true' })
    assert.deepEqual(toolLabels(nav), ['Scenario', 'Display', 'Tools'], `tools shown on ${active}`)
    nav.remove()
  }
})

test('Browse All gets Display only — there is no scenario there to manage', async () => {
  const nav = await mount({ app: 'credit-assistant', active: 'browse-all', 'workspace-on': 'true' })
  assert.deepEqual(toolLabels(nav), ['Display'])
  nav.remove()
})

test('the tool strip stays away with the workspace off, and where no tool applies', async () => {
  const off = await mount({ app: 'credit-assistant', active: 'product-experience', 'workspace-on': 'false' })
  assert.equal(workspaceOn(off), false, 'the attribute the CSS hides the strip by')
  assert.deepEqual(toolLabels(off), [], 'no tools while the workspace is off')
  off.remove()

  // The Authoring Suite walks no scenario and renders no flow, so neither tool has anything to
  // act on. (The Fact Explorer does load a scenario onto its graph — see the next test.)
  const nav = await mount({ app: 'credit-assistant', active: 'authoring-suite', 'workspace-on': 'true' })
  assert.deepEqual(toolLabels(nav), [], 'no tools on authoring-suite')
  nav.remove()
})

// The Fact Explorer is a Taxpert Workspace destination that loads a scenario onto its graph
// (fact-explorer mounts the shared <taxpert-scenario-modal> for exactly this), so Scenario
// applies there. Display and Tools do not: both act on a rendered flow, and the Fact Explorer
// draws the graph rather than the questionnaire.
test('the Fact Explorer gets Scenario only', async () => {
  const nav = await mount({ app: 'fact-explorer', active: 'fact-explorer', 'workspace-on': 'true' })
  assert.deepEqual(toolLabels(nav), ['Scenario'])
  nav.remove()
})

test('a tool button emits nav-tool-select with its id', async () => {
  const nav = await mount({ app: 'credit-assistant', active: 'path-mode', 'workspace-on': 'true' })
  const seen = []
  nav.addEventListener('nav-tool-select', (e) => seen.push(e.detail.id))
  nav.querySelectorAll('.tgn-tool').forEach((b) => b.click())
  assert.deepEqual(seen, ['scenario', 'display', 'tools'])
  nav.remove()
})

test('workspace-locked forces workspaceOn true regardless of workspace-on', async () => {
  const nav = await mount({ app: 'fact-explorer', active: 'fact-explorer', 'workspace-locked': 'true' })
  nav.querySelector('.tgn-waffle').click()
  assert.equal(contextLabelOf(nav), 'Fact Explorer', 'taxonomy is shown')
  const toggle = nav.querySelector('.tgn-toggle')
  // aria-checked is the state; the on-treatment and the knob's travel follow it in CSS.
  assert.equal(toggle.getAttribute('aria-checked'), 'true')
  assert.equal(toggle.disabled, true, 'toggle is disabled')
  nav.remove()
})

test('workspace-locked ignores toggle clicks and never emits workspace-toggle', async () => {
  const nav = await mount({ app: 'fact-explorer', active: 'fact-explorer', 'workspace-locked': 'true' })
  nav.querySelector('.tgn-waffle').click()
  let fired = false
  nav.addEventListener('workspace-toggle', () => (fired = true))
  nav.querySelector('.tgn-toggle').click()
  assert.equal(fired, false)
  assert.equal(nav.getAttribute('workspace-on'), null, 'attribute is left alone, not flipped')
  nav.remove()
})

test('workspace toggle flips state and emits workspace-toggle', async () => {
  const nav = await mount({ app: 'credit-assistant', 'workspace-on': 'false' })
  nav.querySelector('.tgn-waffle').click()
  let event = null
  nav.addEventListener('workspace-toggle', (e) => (event = e.detail))
  nav.querySelector('.tgn-toggle').click()
  assert.equal(event.on, true, 'emits on:true')
  assert.equal(nav.getAttribute('workspace-on'), 'true', 'self-updates the attribute')
  nav.remove()
})

test('disabled items do not fire nav-select', async () => {
  const nav = await mount({ app: 'credit-assistant', 'workspace-on': 'true' })
  nav.menu = [{ id: 'ghost', label: 'Coming Soon', href: '#', disabled: true }]
  nav.querySelector('.tgn-waffle').click()
  let fired = false
  nav.addEventListener('nav-select', () => (fired = true))
  const disabledItem = leafNamed(nav, 'Coming Soon')
  // aria-disabled is the state; the greyed, click-through treatment follows it in CSS.
  assert.equal(disabledItem.getAttribute('aria-disabled'), 'true')
  disabledItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  assert.equal(fired, false, 'no nav-select for disabled item')
  nav.remove()
})

test('an item with `ff` carries data-ff, gating it via feature-flags.css', async () => {
  const nav = await mount({ app: 'credit-assistant', 'workspace-on': 'true' })
  nav.menu = [
    { id: 'authoring-suite', label: 'Authoring Suite', href: '/author/', ff: 'author-mode' },
    { id: 'plain', label: 'Plain Item', href: '/plain/' },
  ]
  nav.querySelector('.tgn-waffle').click()
  const gated = leafNamed(nav, 'Authoring Suite')
  const plain = leafNamed(nav, 'Plain Item')
  assert.equal(gated.dataset.ff, 'author-mode')
  assert.equal(plain.dataset.ff, undefined, 'an item with no `ff` carries no data-ff')
  nav.remove()
})

test('menu property override wins over the default', async () => {
  const nav = await mount({ app: 'fact-explorer', 'workspace-on': 'true' })
  nav.menu = [{ id: 'only', label: 'Only Item', href: '/x' }]
  nav.querySelector('.tgn-waffle').click()
  const items = [...nav.querySelectorAll('.tgn-item__label')].map((s) => s.textContent)
  assert.deepEqual(items, ['Only Item'])
  nav.remove()
})

// ── Configuring after the bar has rendered ────────────────────────────────────

// The nav module and the host's configure() call are separate <script type="module"> tags, and the
// bar's markup arrives over a fetch, so which lands first is a race. Whichever way it falls, the
// bar has to end up showing what the host configured.
test('a configure() after the bar has rendered rebuilds the taxonomy and the tool strip', async () => {
  const nav = await mount({ active: 'only', 'workspace-on': 'true' })

  configure({
    nav: {
      menu: [{ id: 'only', label: 'Only Item', href: '/x' }],
      toolsByDestination: [
        { id: 'display', label: 'Display', icon: 'visibility', destinations: ['only'] },
      ],
    },
  })
  nav.querySelector('.tgn-waffle').click()

  assert.deepEqual(
    [...nav.querySelectorAll('.tgn-item__label')].map((s) => s.textContent),
    ['Only Item']
  )
  assert.deepEqual(toolLabels(nav), ['Display'], 'the strip is rebuilt, not appended to')
  assert.equal(contextLabelOf(nav), 'Only Item', 'the breadcrumb follows the new taxonomy')

  nav.remove()
  configure({ nav: FIXTURE_NAV })
})

// The `app` attribute and config.app.id say the same thing, so they resolve to one answer — markup
// first, since that is the page's own statement — and it lands on the host as `data-app`.
test('app reads the attribute, falls back to the configured id, and is mirrored to data-app', async () => {
  configure({ app: { id: 'configured-app' } })

  const declared = await mount({ app: 'credit-assistant' })
  assert.equal(declared.app, 'credit-assistant')
  assert.equal(declared.dataset.app, 'credit-assistant')
  declared.remove()

  const inherited = await mount()
  assert.equal(inherited.app, 'configured-app')
  assert.equal(inherited.dataset.app, 'configured-app')
  inherited.remove()

  configure({ app: { id: '' } })
})
