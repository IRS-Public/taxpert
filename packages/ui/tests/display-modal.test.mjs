// DOM-level tests for <taxpert-display-modal> and the display-options state behind it, driven
// with jsdom. jsdom has no <dialog> showModal(), so the element's open()/close() fall back to the
// `open` attribute — the tests assert on that.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

let getDisplayOptions

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/app/eitc/all-screens/',
    pretendToBeVisual: true,
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.customElements = dom.window.customElements
  globalThis.sessionStorage = dom.window.sessionStorage
  globalThis.localStorage = dom.window.localStorage
  globalThis.DOMParser = dom.window.DOMParser
  globalThis.XMLSerializer = dom.window.XMLSerializer
  // The element's markup is fetched from templates/*.html; answer that off disk.
  stubTemplateFetch()
  await import('../src/audit-panel/js/display-modal.js')
  ;({ getDisplayOptions } = await import('../src/audit-panel/js/display-options.js'))
})

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  document.body.className = ''
  document.body.innerHTML = ''
})

// Templates are fetched, so building the dialog is asynchronous — `ready` resolves once it exists.
async function mount (attrs = {}) {
  const modal = document.createElement('taxpert-display-modal')
  for (const [k, v] of Object.entries(attrs)) modal.setAttribute(k, v)
  document.body.appendChild(modal)
  await modal.ready
  return modal
}

// Every section is built once and stays; what changes is which are visible. These read the ones a
// user would see, so the assertions say the same thing they said when sections came and went.
const titles = (modal) =>
  [...modal.querySelectorAll('.tdm-section:not([hidden]) .tdm-section__title')].map((h) => h.textContent)

const visibilityLabels = (modal) =>
  [...modal.querySelectorAll('.usa-checkbox__label')].map((l) => l.textContent)

// A row reads as chosen when its own control is checked — USWDS draws that, and nothing in
// display-modal.css or the JS mirrors it. Matched through the row so the assertion also holds the
// row structure the stylesheet and USWDS both rely on.
const isSelected = (input) => input.closest('.tdm-option').matches(':has(:checked)')

test('renders Visibility and Layout, and names itself Display options', async () => {
  const modal = await mount({ mode: 'browse' })
  assert.equal(modal.querySelector('.tdm-heading').textContent, 'Display options')
  assert.deepEqual(titles(modal), ['Visibility', 'Layout'])
})

test('Layout is hidden in the Product Experience, where there is nothing to arrange', async () => {
  const modal = await mount({ mode: 'product' })
  assert.deepEqual(titles(modal), ['Visibility'])
  // Present, not absent: open() no longer tears the dialog down and rebuilds it to change this.
  assert.equal(modal.querySelector('[data-section="layout"]').hidden, true)
})

test('mode defaults to the screens toolbar’s when there is one, else product', async () => {
  const bare = await mount()
  assert.equal(bare.mode, 'product')
  bare.remove()

  const toolbar = document.createElement('taxpert-screens-toolbar')
  toolbar.mode = 'path'
  document.body.appendChild(toolbar)
  const modal = await mount()
  assert.equal(modal.mode, 'path')
})

// Path Mode reads one taxpayer's route through the flow, so it keeps the annotation that says why a
// question was reached and drops the three controls that rearrange a listing — Browse All's job.
// The layout radios go with them, Stack being the default the page then always renders at.
// Path Mode is a reading of one route — "what did this person see, and why" — so it offers the
// annotations that answer *why* and none of the controls that rearrange a listing. Modals inline is
// one of the annotations: the explanation behind a link on the route, without having to open each
// overlay in turn and lose your place. Expanding accordions and tiling the card are Browse All's.
test('Path Mode offers the annotations, and no Layout', async () => {
  const modal = await mount({ mode: 'path' })
  assert.deepEqual(titles(modal), ['Visibility'])
  assert.deepEqual(visibilityLabels(modal), ['Show validation text', 'Show modals inline'])
})

test('every visibility option is offered in Browse All', async () => {
  const modal = await mount({ mode: 'browse' })
  assert.deepEqual(visibilityLabels(modal), [
    'Show validation text',
    'Show modals inline',
    'Expand all accordions',
  ])
})

test('choosing Wrap stores the layout and tiles the page', async () => {
  const modal = await mount({ mode: 'browse' })
  const wrap = modal.querySelector('#display-layout-wrap')
  assert.equal(modal.querySelector('#display-layout-stack').checked, true, 'stack is the default')

  wrap.checked = true
  wrap.dispatchEvent(new window.Event('change'))

  assert.equal(getDisplayOptions().layout, 'wrap')
  assert.equal(document.body.classList.contains('layout--horizontal'), true)
  assert.equal(isSelected(wrap), true)
  assert.equal(
    isSelected(modal.querySelector('#display-layout-stack')),
    false,
    'the other row is no longer chosen — the radio itself says so, with no loop to run'
  )
})

test('a stored layout is reflected when the modal opens', async () => {
  sessionStorage.setItem('taxpert:display', JSON.stringify({ layout: 'wrap' }))
  const modal = await mount({ mode: 'browse' })
  modal.open()
  assert.equal(modal.querySelector('#display-layout-wrap').checked, true)
  assert.equal(modal.querySelector('.tdm-dialog').hasAttribute('open'), true)
  modal.close()
  assert.equal(modal.querySelector('.tdm-dialog').hasAttribute('open'), false)
})

test('"Show modals inline" toggles the body class the CSS keys off', async () => {
  const modal = await mount({ mode: 'browse' })
  const checkbox = modal.querySelector('#display-modals-inline')
  checkbox.checked = true
  checkbox.dispatchEvent(new window.Event('change'))
  assert.equal(document.body.classList.contains('display-modals-inline'), true)
  assert.equal(getDisplayOptions().modalsInline, true)

  checkbox.checked = false
  checkbox.dispatchEvent(new window.Event('change'))
  assert.equal(document.body.classList.contains('display-modals-inline'), false)
})

test('"Expand all accordions" opens and closes every <details> on the page', async () => {
  document.body.insertAdjacentHTML('beforeend', '<details id="a"></details><details id="b"></details>')
  const modal = await mount({ mode: 'browse' })
  const checkbox = modal.querySelector('#display-expand-accordions')

  checkbox.checked = true
  checkbox.dispatchEvent(new window.Event('change'))
  assert.equal(document.querySelector('#a').open, true)
  assert.equal(document.querySelector('#b').open, true)

  checkbox.checked = false
  checkbox.dispatchEvent(new window.Event('change'))
  assert.equal(document.querySelector('#a').open, false)
})

test('"Expand all accordions" defaults on where a screens toolbar lists every screen', async () => {
  document.body.appendChild(document.createElement('taxpert-screens-toolbar'))
  const listing = await mount({ mode: 'browse' })
  assert.equal(listing.querySelector('#display-expand-accordions').checked, true)
  listing.remove()
  document.body.innerHTML = ''

  const product = await mount({ mode: 'product' })
  assert.equal(product.querySelector('#display-expand-accordions').checked, false)
})

test('"Show validation text" asks each visible fg-set for its required-field message', async () => {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<fg-set id="q1"></fg-set><fg-set id="q2" class="hidden"></fg-set>'
  )
  const validated = []
  const cleared = []
  for (const id of ['q1', 'q2']) {
    const fgSet = document.querySelector(`#${id}`)
    fgSet.validateRequiredFields = () => validated.push(id)
    fgSet.clearValidationError = () => cleared.push(id)
  }

  const modal = await mount({ mode: 'browse' })
  const checkbox = modal.querySelector('#display-validation-text')
  checkbox.checked = true
  checkbox.dispatchEvent(new window.Event('change'))
  assert.deepEqual(validated, ['q1'], 'the hidden question is left alone')

  checkbox.checked = false
  checkbox.dispatchEvent(new window.Event('change'))
  assert.deepEqual(cleared, ['q1', 'q2'], 'clearing is unconditional — it only undoes')
})

// Which element is a question is the host's to say, so the same effect finds a host that has never
// heard of <fg-set>.
test('"Show validation text" follows the host’s own question tag', async () => {
  const { configure, _resetConfig } = await import('../src/shared/js/config.js')
  configure({ flowDom: { questionTag: 'x-question' } })
  try {
    document.body.insertAdjacentHTML('beforeend', '<x-question id="xq"></x-question>')
    const validated = []
    document.querySelector('#xq').validateRequiredFields = () => validated.push('xq')

    const modal = await mount({ mode: 'browse' })
    const checkbox = modal.querySelector('#display-validation-text')
    checkbox.checked = true
    checkbox.dispatchEvent(new window.Event('change'))

    assert.deepEqual(validated, ['xq'])
  } finally {
    _resetConfig()
  }
})

test('the nav’s Display button opens the modal, and other tools do not', async () => {
  const modal = await mount({ mode: 'browse' })
  document.dispatchEvent(
    new window.CustomEvent('nav-tool-select', { detail: { id: 'scenario' }, bubbles: true })
  )
  assert.equal(modal.querySelector('.tdm-dialog').hasAttribute('open'), false)

  document.dispatchEvent(
    new window.CustomEvent('nav-tool-select', { detail: { id: 'display' }, bubbles: true })
  )
  assert.equal(modal.querySelector('.tdm-dialog').hasAttribute('open'), true)
})

test('the Language section mirrors the host page’s selector, preselecting the current route', async () => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<select class="usa-select" id="language-selector">
       <option value="" disabled selected>Select Language</option>
       <option value="/app/eitc/all-screens/">English</option>
       <option value="/app/eitc/es/all-screens/">Español</option>
     </select>`
  )
  const modal = await mount({ mode: 'browse' })
  assert.deepEqual(titles(modal), ['Visibility', 'Layout', 'Language'])
  const select = modal.querySelector('#display-language-selector')
  assert.deepEqual(
    [...select.options].map((o) => o.textContent),
    ['Select Language', 'English', 'Español']
  )
  // The jsdom URL is the English all-screens route.
  assert.equal(select.value, '/app/eitc/all-screens/')
})

test('the Language section is hidden when the host page has no language selector', async () => {
  const modal = await mount({ mode: 'browse' })
  assert.equal(titles(modal).includes('Language'), false)
  assert.equal(modal.querySelector('[data-section="language"]').hidden, true)
})

// ── Host-owned options ────────────────────────────────────────────────────────────────────────
// The seam for a host whose "display" is not a flow page — Fact Explorer, whose Visibility choices
// reveal graph nodes and whose Layout arranges a canvas. Same dialog, same nav button, its own
// contents; the built-in display options are untouched by any of it.

test('a host’s own visibility options replace the built-in ones and call back', async () => {
  const changed = []
  let revealed = false
  const modal = await mount({ mode: 'browse' })
  modal.visibilityOptions = [
    {
      id: 'fe-reveal-skipped',
      label: 'Reveal items skipped in scenarios',
      checked: () => revealed,
      onChange: (on) => {
        revealed = on
        changed.push(['reveal', on])
      },
    },
    { id: 'fe-side-by-side', label: 'Show product experience side-by-side', checked: false, onChange: () => {} },
  ]

  assert.deepEqual(visibilityLabels(modal), [
    'Reveal items skipped in scenarios',
    'Show product experience side-by-side',
  ])

  const reveal = modal.querySelector('#fe-reveal-skipped')
  reveal.checked = true
  reveal.dispatchEvent(new window.Event('change'))
  assert.deepEqual(changed, [['reveal', true]])
  // Nothing was written to the built-in display options: the host owns this state.
  assert.equal(sessionStorage.getItem('taxpert:display'), null)

  // Re-opening asks each descriptor for its current value rather than the stored one.
  reveal.checked = false
  modal.open()
  assert.equal(reveal.checked, true)
})

test('a host’s own layout options are offered in every mode, and the built-in ones are not', async () => {
  let orientation = 'vertical'
  const modal = await mount({ mode: 'product' })
  modal.layoutOptions = {
    options: [
      { value: 'vertical', label: 'Vertical (default)' },
      { value: 'horizontal', label: 'Horizontal' },
    ],
    value: () => orientation,
    onChange: (value) => { orientation = value },
  }

  // Layout is hidden in the Product Experience only because there is nothing to arrange there —
  // which is a statement about a Form Builder screen, not about a host that arranges something else.
  assert.deepEqual(titles(modal), ['Visibility', 'Layout'])
  assert.equal(modal.querySelector('#display-layout-stack'), null)
  assert.equal(modal.querySelector('#display-layout-vertical').checked, true)

  const horizontal = modal.querySelector('#display-layout-horizontal')
  horizontal.checked = true
  horizontal.dispatchEvent(new window.Event('change'))
  assert.equal(orientation, 'horizontal')
  assert.equal(getDisplayOptions().layout, 'stack', 'the built-in layout option is untouched')
})

test('the footer action is the dialog’s one command, and absent unless a host sets one', async () => {
  const modal = await mount({ mode: 'browse' })
  assert.equal(modal.querySelector('[data-footer]').hidden, true)

  let reset = 0
  modal.footerAction = { label: 'Reset layout', onSelect: () => { reset += 1 } }
  const footer = modal.querySelector('[data-footer]')
  assert.equal(footer.hidden, false)
  const button = footer.querySelector('button')
  assert.equal(button.textContent, 'Reset layout')
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert.equal(reset, 1)
})

test('host options assigned before the templates land still render', async () => {
  const modal = document.createElement('taxpert-display-modal')
  modal.visibilityOptions = [{ id: 'early', label: 'Assigned before connect', checked: true, onChange: () => {} }]
  modal.footerAction = { label: 'Reset layout', onSelect: () => {} }
  document.body.appendChild(modal)
  await modal.ready

  assert.deepEqual(visibilityLabels(modal), ['Assigned before connect'])
  assert.equal(modal.querySelector('#early').checked, true)
  assert.equal(modal.querySelector('[data-footer] button').textContent, 'Reset layout')
})
