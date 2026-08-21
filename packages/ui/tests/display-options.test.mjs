// display-options.js — the state behind the Display button and the host-page effects it produces.
//
// These specs cover the one effect that rewrites the host's DOM rather than toggling a class:
// "show modals inline" renders a copy of each <dialog> under the question whose link opens it, and
// has to take every copy back down when the option goes off.
//
// The invariant nearly every one of these leans on: **the authored <dialog> never moves and never
// gains the marker.** It moved once, and that broke the overlay — `showModal()` lifts an element
// into the top layer, so a moved dialog left a hole in the page while it was open, and it carried
// the inline stylesheet's `position: static` / hidden-[X] treatment up there with it.
import { test, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

let updateDisplayOption, applyDisplayOptions, getDisplayOptions
let configure, _resetConfig

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.sessionStorage = dom.window.sessionStorage
  globalThis.CSS = dom.window.CSS
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.customElements = dom.window.customElements
  globalThis.DOMParser = dom.window.DOMParser
  globalThis.XMLSerializer = dom.window.XMLSerializer
  ;({ updateDisplayOption, applyDisplayOptions, getDisplayOptions } =
    await import('../src/audit-panel/js/display-options.js'))
  ;({ configure, _resetConfig } = await import('../src/shared/js/config.js'))
})

// One screen, authored the way the scaffold's schema requires: every <dialog> after the <section>,
// several questions below the link that opens it. q3's link points at a modal that does not exist,
// and #modal-orphan is linked from nowhere.
//
// `data-name` is how a copy is identified: an inline copy is stripped of every id, so the id is
// exactly the thing that cannot be asserted on.
const SCREEN = `
  <main>
    <article class="screen" data-route="/">
      <div class="screen__content">
        <section class="flow">
          <p id="intro">Tell us <modal-link for="modal-intro">about this step</modal-link>.</p>
          <fg-set id="q1" path="/chosenTaxYear">
            <div class="usa-form-group"><modal-link for="modal-tax-year">Which year?</modal-link></div>
          </fg-set>
          <fg-set id="q2" path="/isUSCitizen" class="hidden">
            <div class="usa-form-group"><modal-link for="modal-citizen">Am I a citizen?</modal-link></div>
          </fg-set>
          <fg-set id="q3" path="/hasValidSSN">
            <div class="usa-form-group"><modal-link for="modal-missing">What counts?</modal-link></div>
          </fg-set>
        </section>
        <dialog id="modal-intro" data-name="intro"></dialog>
        <dialog id="modal-tax-year" data-name="tax-year"></dialog>
        <dialog id="modal-citizen" data-name="citizen"></dialog>
        <dialog id="modal-orphan" data-name="orphan"></dialog>
      </div>
    </article>
  </main>`

beforeEach(() => {
  sessionStorage.clear()
  document.body.className = ''
  document.body.innerHTML = SCREEN
})

afterEach(() => {
  _resetConfig()
})

const idsIn = (selector) => [...document.querySelectorAll(selector)].map((el) => el.id)
const namesIn = (selector) => [...document.querySelectorAll(selector)].map((el) => el.dataset.name)
const parentOf = (id) => document.getElementById(id).parentElement
const nextOf = (id) => document.getElementById(id).nextElementSibling

test('off by default: every modal stays where the flow authored it', () => {
  applyDisplayOptions()
  assert.equal(document.body.classList.contains('display-modals-inline'), false)
  assert.equal(parentOf('modal-tax-year').className, 'screen__content')
})

test('on: a copy of each modal appears under the question whose link opens it', () => {
  updateDisplayOption('modalsInline', true)

  assert.equal(document.body.classList.contains('display-modals-inline'), true)
  assert.equal(nextOf('q1').dataset.name, 'tax-year')
  assert.equal(nextOf('q2').dataset.name, 'citizen')
  // A link outside any question anchors to the block it sits in, so the copy lands under that
  // sentence rather than at the foot of the screen.
  assert.equal(nextOf('intro').dataset.name, 'intro')
})

// The regression this whole design exists for: showModal() lifts an element into the top layer, so
// an authored dialog that had been *moved* under its question left a hole in the page while it was
// open — and arrived in the top layer still marked, so the inline stylesheet de-centred it and hid
// its [X]. The overlay the link opens has to be the untouched authored element.
test('the authored modal stays where it was, unmarked, and keeps its id', () => {
  updateDisplayOption('modalsInline', true)

  const authored = document.getElementById('modal-tax-year')
  assert.equal(authored.parentElement.className, 'screen__content')
  assert.equal(authored.dataset.taxpertModalInline, undefined)
  // The link still opens exactly one element, and it is that one.
  assert.equal(document.querySelectorAll('#modal-tax-year').length, 1)
})

test('an inline copy carries no id, so getElementById is never a coin toss', () => {
  updateDisplayOption('modalsInline', true)

  const copies = [...document.querySelectorAll('dialog[data-taxpert-modal-inline]')]
  assert.equal(copies.length, 3)
  for (const copy of copies) {
    assert.equal(copy.id, '')
    assert.equal(copy.hasAttribute('open'), false)
  }
})

test('a placed copy is marked, so the stylesheet can hide it with its question', () => {
  updateDisplayOption('modalsInline', true)
  assert.deepEqual(namesIn('dialog[data-taxpert-modal-inline]').sort(), [
    'citizen', 'intro', 'tax-year',
  ])
})

// An unlinked modal is not an explanation of any question, so there is no question to put it under
// — and it keeps working as a real overlay (credit-assistant opens one from its own JS).
test('a modal nothing links to, and a link pointing at nothing, are both left alone', () => {
  updateDisplayOption('modalsInline', true)
  assert.equal(parentOf('modal-orphan').className, 'screen__content')
  assert.equal(document.getElementById('modal-orphan').dataset.taxpertModalInline, undefined)
  assert.equal(nextOf('q3'), null)
})

test('off again: every copy comes down and the page is as authored', () => {
  const authored = idsIn('.screen__content > dialog')
  updateDisplayOption('modalsInline', true)
  updateDisplayOption('modalsInline', false)

  assert.equal(document.body.classList.contains('display-modals-inline'), false)
  assert.deepEqual(idsIn('.screen__content > dialog'), authored)
  assert.equal(document.querySelectorAll('dialog[data-taxpert-modal-inline]').length, 0)
  assert.equal(nextOf('q1'), document.getElementById('q2'))
})

// applyDisplayOptions() runs on every page load and mode switch, so the placement has to be a
// set-to-current-state rather than a toggle.
test('applying twice does not place a second copy', () => {
  updateDisplayOption('modalsInline', true)
  applyDisplayOptions()
  applyDisplayOptions()

  assert.equal(document.querySelectorAll('dialog[data-taxpert-modal-inline]').length, 3)
  assert.equal(nextOf('q1').dataset.name, 'tax-year')
  updateDisplayOption('modalsInline', false)
  assert.deepEqual(idsIn('.screen__content > dialog'), [
    'modal-intro', 'modal-tax-year', 'modal-citizen', 'modal-orphan',
  ])
})

// Four of credit-assistant's modals are linked from two questions on the same page — the reviewer
// reading the second one should not have to scroll back to the first.
test('a modal linked from two questions is shown under both', () => {
  document.body.innerHTML = `
    <main>
      <fg-set id="p1"><modal-link for="modal-ssn">What counts?</modal-link></fg-set>
      <fg-set id="p2"><modal-link for="modal-ssn">What counts?</modal-link></fg-set>
      <dialog id="modal-ssn"><p>An SSN issued on or before the due date.</p></dialog>
    </main>`
  updateDisplayOption('modalsInline', true)

  for (const copy of [nextOf('p1'), nextOf('p2')]) {
    assert.equal(copy.tagName, 'DIALOG')
    assert.equal(copy.dataset.taxpertModalInline, 'true')
    assert.equal(copy.textContent.trim(), 'An SSN issued on or before the due date.')
    assert.equal(copy.id, '')
  }
  // Exactly one element per id: both are copies, and the link still opens the real one.
  assert.equal(document.querySelectorAll('#modal-ssn').length, 1)
})

test('the copies are deleted when the option goes off, leaving one modal', () => {
  document.body.innerHTML = `
    <main>
      <fg-set id="p1"><modal-link for="modal-ssn">What counts?</modal-link></fg-set>
      <fg-set id="p2"><modal-link for="modal-ssn">What counts?</modal-link></fg-set>
      <dialog id="modal-ssn"></dialog>
    </main>`
  updateDisplayOption('modalsInline', true)
  updateDisplayOption('modalsInline', false)

  assert.equal(document.querySelectorAll('dialog').length, 1)
  assert.equal(nextOf('p2').id, 'modal-ssn')
})

test('re-applying does not stack a second copy under the same question', () => {
  document.body.innerHTML = `
    <main>
      <fg-set id="p1"><modal-link for="modal-ssn">What counts?</modal-link></fg-set>
      <fg-set id="p2"><modal-link for="modal-ssn">What counts?</modal-link></fg-set>
      <dialog id="modal-ssn"></dialog>
    </main>`
  updateDisplayOption('modalsInline', true)
  applyDisplayOptions()
  applyDisplayOptions()

  // The authored modal plus one copy per link — not one copy per link per apply.
  assert.equal(document.querySelectorAll('dialog').length, 3)
  assert.equal(document.querySelectorAll('dialog[data-taxpert-modal-inline]').length, 2)
})

// A collection row materializes after the first apply; its link has to be picked up by the next one.
test('a link that arrives later is placed on the next apply', () => {
  updateDisplayOption('modalsInline', true)
  document.querySelector('.flow').insertAdjacentHTML('beforeend',
    '<fg-set id="q4"><modal-link for="modal-tax-year">Which year?</modal-link></fg-set>')
  applyDisplayOptions()

  assert.equal(nextOf('q4').tagName, 'DIALOG')
  assert.equal(nextOf('q4').dataset.taxpertModalInline, 'true')
})

// A collection row's links sit in an <fg-collection>'s <template> until the row is added, so adding
// one is the moment they first exist.
test('adding a collection row places the links it brings with it', async () => {
  document.body.innerHTML = `
    <main>
      <fg-set id="p1"><modal-link for="modal-child">Who counts?</modal-link></fg-set>
      <div id="rows"></div>
      <button class="fg-collection__add-item">Add another</button>
      <dialog id="modal-child"></dialog>
    </main>`
  document.querySelector('.fg-collection__add-item').addEventListener('click', () => {
    document.getElementById('rows').insertAdjacentHTML('beforeend',
      '<fg-set id="row1"><modal-link for="modal-child">Who counts?</modal-link></fg-set>')
  })

  updateDisplayOption('modalsInline', true)
  assert.equal(nextOf('p1').dataset.taxpertModalInline, 'true')

  document.querySelector('.fg-collection__add-item').click()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(nextOf('row1').tagName, 'DIALOG')
  assert.equal(nextOf('row1').dataset.taxpertModalInline, 'true')
  // Still exactly one #modal-child: the row got a copy of its own, not the authored overlay.
  assert.equal(document.querySelectorAll('#modal-child').length, 1)
})

test('the option survives a reload the way the other display options do', () => {
  updateDisplayOption('modalsInline', true)
  assert.equal(getDisplayOptions().modalsInline, true)
})

// Browse All puts every page in one document, so an id that is unique per page need not be unique
// on the page. The link's own screen is what decides which of two same-id modals moves.
test('the modal is looked up within the link’s own screen', () => {
  document.body.innerHTML = `
    <main>
      <article class="screen" id="s1">
        <fg-set id="a1"><modal-link for="dup"></modal-link></fg-set>
        <dialog id="dup" data-screen="1"></dialog>
      </article>
      <article class="screen" id="s2">
        <fg-set id="a2"><modal-link for="dup"></modal-link></fg-set>
        <dialog id="dup" data-screen="2"></dialog>
      </article>
    </main>`
  updateDisplayOption('modalsInline', true)

  assert.equal(nextOf('a1').dataset.screen, '1')
  assert.equal(document.getElementById('a2').nextElementSibling.dataset.screen, '2')
})

// The package knows no host: a host with its own markup names it through flowDom and gets the same
// behavior. (This is the fixture host's vocabulary — see tests/fixtures/host/config.mjs.)
test('a host’s own link and overlay tags are honoured', () => {
  configure({
    flowDom: {
      questionTag: 'x-question',
      modalTag: 'x-overlay',
      modalLinkSelector: 'x-overlay-link',
      modalLinkAttr: 'opens',
      screenSelector: 'article.step',
    },
  })
  // The link is wrapped so that anchoring to `#p1` is only possible if questionTag is honoured too:
  // fall back to the link's parent and the copy would land inside the question.
  document.body.innerHTML = `
    <article class="step">
      <x-question id="p1">
        <div class="field"><x-overlay-link opens="why">Why?</x-overlay-link></div>
      </x-question>
      <x-overlay id="why"><p>Because.</p></x-overlay>
    </article>`
  updateDisplayOption('modalsInline', true)

  const copy = nextOf('p1')
  assert.equal(copy.tagName, 'X-OVERLAY')
  assert.equal(copy.dataset.taxpertModalInline, 'true')
  assert.equal(copy.id, '')
  assert.equal(copy.textContent.trim(), 'Because.')
  // …and the authored overlay is untouched, in a host's vocabulary exactly as in the default one:
  // still the single element with that id, still unmarked, so the link opens a normal overlay.
  assert.equal(document.querySelectorAll('#why').length, 1)
  assert.equal(document.getElementById('why').dataset.taxpertModalInline, undefined)
})

// ── What a destination offers ───────────────────────────────────────────────
//
// Path Mode offers only the condition cues and the validation copy. The other three still have
// stored values — you set them in Browse All — but a control that is not on screen must not still
// be moving the page, so the page renders them at their defaults instead. Stack being the layout
// default is what makes "Layout can go" true rather than merely tidy.

/** A toolbar to read the mode off, the way the real page has one. */
function screensToolbar (mode) {
  const toolbar = document.createElement('taxpert-screens-toolbar')
  toolbar.mode = mode
  document.body.appendChild(toolbar)
  return toolbar
}

test('Path Mode ignores the options it offers no control for', () => {
  screensToolbar('path')
  updateDisplayOption('layout', 'wrap')
  applyDisplayOptions()

  assert.equal(document.body.classList.contains('layout--horizontal'), false, 'Path Mode stacks')
  // The stored value is untouched — go back to Browse All and your choice is still there.
  assert.equal(getDisplayOptions().layout, 'wrap')
})

// The other half of the same rule: an option a destination *does* offer is applied there. Modals
// inline is offered in Path Mode — it explains a link on the route rather than rearranging a listing
// — so it has to actually place its copies, not merely draw a checkbox.
test('Path Mode applies the annotations it does offer', () => {
  screensToolbar('path')
  updateDisplayOption('modalsInline', true)
  applyDisplayOptions()

  assert.equal(document.body.classList.contains('display-modals-inline'), true)
  assert.ok(document.querySelectorAll('dialog[data-taxpert-modal-inline]').length > 0)
})

test('Browse All applies all of them', () => {
  screensToolbar('browse')
  updateDisplayOption('layout', 'wrap')
  updateDisplayOption('modalsInline', true)
  applyDisplayOptions()

  assert.equal(document.body.classList.contains('layout--horizontal'), true)
  assert.equal(document.body.classList.contains('display-modals-inline'), true)
})

// The "expand all accordions" default is per-destination: a listing exists to show every question
// at once, a walkthrough is where a collapsed accordion is the intended design. It used to be read
// off the *presence* of a <taxpert-screens-toolbar>, which stopped meaning "listing" once the
// Product Experience grew the same sub-nav bar.
test('the accordion default follows the destination, not the bar’s presence', () => {
  screensToolbar('product')
  document.body.insertAdjacentHTML('beforeend', '<details id="d"></details>')
  applyDisplayOptions()
  assert.equal(document.getElementById('d').open, false, 'a walkthrough keeps them shut')
})

test('a listing still opens every accordion by default', () => {
  screensToolbar('browse')
  document.body.insertAdjacentHTML('beforeend', '<details id="d"></details>')
  applyDisplayOptions()
  assert.equal(document.getElementById('d').open, true)
})
