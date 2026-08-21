// DOM-level tests for Path Mode's point-of-progress cursor, driven with jsdom.
import { test, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

let applyPathCursor, clearPathCursor, OFF_PATH_CLASS
let configure, _resetConfig

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  // configure() announces itself on `document`, so the walk's specs need the constructor.
  globalThis.CustomEvent = dom.window.CustomEvent
  ;({ applyPathCursor, clearPathCursor, OFF_PATH_CLASS } = await import('../src/audit-panel/js/path-cursor.js'))
  ;({ configure, _resetConfig } = await import('../src/shared/js/config.js'))
})

// A two-section page: About You holds three questions with a knockout alert after the second,
// Filing Status holds one. Answers live in `answers`; conditions in `facts`.
const PAGE = `
  <main>
    <section class="all-screens__section" data-section="about">
      <header class="all-screens__section-header"><h2 id="about">About you</h2></header>
      <article class="screen" data-route="/">
        <header class="screen__header"><h3>About you</h3></header>
        <div class="screen__content">
          <section class="flow">
            <p id="intro">Tell us about yourself.</p>
            <fg-set id="q1" path="/chosenTaxYear"></fg-set>
            <fg-set id="q2" path="/isUSCitizen" condition="/hasSelectedChosenTaxYear" operator="isTrue"></fg-set>
            <fg-alert id="ko" knockout="true" condition="/isUSCitizen" operator="isFalse"></fg-alert>
            <fg-set id="q3" path="/hasValidSSN" condition="/isUSCitizen" operator="isTrue"></fg-set>
          </section>
          <dialog id="modal-tax-year"></dialog>
          <dialog id="modal-confirm-tax-year-change"></dialog>
        </div>
      </article>
    </section>
    <section class="all-screens__section" data-section="filing-status">
      <header class="all-screens__section-header"><h2 id="filing-status">Filing status</h2></header>
      <article class="screen" id="screen2" data-route="/filing-status">
        <div class="screen__content">
          <section class="flow"><fg-set id="q4" path="/filingStatus"></fg-set></section>
        </div>
      </article>
    </section>
  </main>`

let facts
let answers

beforeEach(() => {
  document.body.innerHTML = PAGE
  facts = new Map()
  answers = new Set()
})

// The descriptor is global state, so a spec that configures a host's markup must not leave it
// behind for the next one.
afterEach(() => {
  _resetConfig()
})

const checkCondition = (path, operator) => {
  const value = facts.get(path)
  if (operator === 'isTrue') return value === true
  if (operator === 'isFalse') return value === false
  throw new Error(`unexpected operator ${operator}`)
}
const isAnswered = (el) => answers.has(el.id)

const run = () => applyPathCursor(document, { checkCondition, isAnswered })
const offPath = () => [...document.querySelectorAll(`.${OFF_PATH_CLASS}`)].map((el) => el.id)

test('with nothing answered, stops at the first question', () => {
  const { cursor, terminal } = run()
  assert.equal(cursor.id, 'q1')
  assert.equal(terminal, 'question')
  // q2/ko/q3 are conditioned out anyway, but they sit after the cursor so they are marked too.
  assert.deepEqual(offPath(), ['q2', 'ko', 'q3', 'screen2'])
  assert.equal(document.querySelector('#intro').classList.contains(OFF_PATH_CLASS), false)
})

test('modals after the cursor stay reachable — a <dialog> is never marked off-path', () => {
  // Cursor sits on q1; every following sibling of the flow <section> — including the two dialogs —
  // would otherwise be swept off-path, hiding the modal a link on q1 opens (e.g. the tax-year
  // change confirmation) so showModal() reveals nothing.
  run()
  assert.equal(document.querySelector('#modal-tax-year').classList.contains(OFF_PATH_CLASS), false)
  assert.equal(document.querySelector('#modal-confirm-tax-year-change').classList.contains(OFF_PATH_CLASS), false)
})

test('answering the first question reveals the next one', () => {
  answers.add('q1')
  facts.set('/hasSelectedChosenTaxYear', true)
  const { cursor } = run()
  assert.equal(cursor.id, 'q2')
  assert.deepEqual(offPath(), ['ko', 'q3', 'screen2'])
})

test('a question conditioned off the path is skipped, not treated as the cursor', () => {
  answers.add('q1')
  facts.set('/hasSelectedChosenTaxYear', false) // q2 is not on this path
  facts.set('/isUSCitizen', true) // q3 is
  const { cursor } = run()
  assert.equal(cursor.id, 'q3')
  assert.deepEqual(offPath(), ['screen2'])
})

test('a revealed knockout alert ends the path', () => {
  answers.add('q1')
  answers.add('q2')
  facts.set('/hasSelectedChosenTaxYear', true)
  facts.set('/isUSCitizen', false)
  const { cursor, terminal } = run()
  assert.equal(cursor.id, 'ko')
  assert.equal(terminal, 'knockout')
  assert.deepEqual(offPath(), ['q3', 'screen2'])
})

test('truncation crosses screens, and never marks the sections or their headings', () => {
  answers.add('q1')
  answers.add('q2')
  answers.add('q3')
  facts.set('/hasSelectedChosenTaxYear', true)
  facts.set('/isUSCitizen', true)
  const { cursor } = run()
  assert.equal(cursor.id, 'q4')
  assert.deepEqual(offPath(), [])
  assert.equal(document.querySelector('[data-section="filing-status"]').classList.contains(OFF_PATH_CLASS), false)
  assert.equal(document.querySelector('#filing-status').classList.contains(OFF_PATH_CLASS), false)
})

test('with every question answered, nothing is truncated', () => {
  for (const id of ['q1', 'q2', 'q3', 'q4']) answers.add(id)
  facts.set('/hasSelectedChosenTaxYear', true)
  facts.set('/isUSCitizen', true)
  const { cursor, terminal } = run()
  assert.equal(cursor, null)
  assert.equal(terminal, 'end')
  assert.deepEqual(offPath(), [])
})

test('an optional question does not stop the path', () => {
  document.querySelector('#q1').setAttribute('optional', 'true')
  facts.set('/hasSelectedChosenTaxYear', true)
  const { cursor } = run()
  assert.equal(cursor.id, 'q2')
})

test('a screen whose page-level gate is false is skipped entirely', () => {
  const screen2 = document.querySelector('#screen2')
  screen2.dataset.gateCondition = '/showFilingStatus'
  screen2.dataset.gateOperator = 'isTrue'
  facts.set('/showFilingStatus', false)
  for (const id of ['q1', 'q2', 'q3']) answers.add(id)
  facts.set('/hasSelectedChosenTaxYear', true)
  facts.set('/isUSCitizen', true)
  const { cursor, terminal } = run()
  assert.equal(cursor, null)
  assert.equal(terminal, 'end')
})

test('re-running clears the previous pass, and clearPathCursor removes every mark', () => {
  run()
  assert.ok(offPath().length > 0)
  answers.add('q1')
  facts.set('/hasSelectedChosenTaxYear', true)
  run()
  assert.equal(document.querySelector('#q2').classList.contains(OFF_PATH_CLASS), false)
  clearPathCursor(document)
  assert.deepEqual(offPath(), [])
})

// The two host dependencies are optional: unsupplied, the walk uses the descriptor's own — a
// checkCondition that conditions nothing out, and an isAnswered that reads the element. Neither
// question in the fixture carries a value, so the cursor lands on the first of them.
test('without the injected dependencies it falls back to the descriptor', () => {
  const { cursor, terminal } = applyPathCursor(document, {})
  assert.equal(cursor.id, 'q1')
  assert.equal(terminal, 'question')
})

test('a host may replace either dependency through flowDom rather than the call', () => {
  configure({
    flowDom: {
      checkCondition: (path) => facts.get(path) === true,
      isAnswered: (el) => answers.has(el.id),
    },
  })
  answers.add('q1')
  facts.set('/hasSelectedChosenTaxYear', true)

  const { cursor } = applyPathCursor(document)
  assert.equal(cursor.id, 'q2')
})

test('an explicitly injected dependency still beats the configured one', () => {
  configure({ flowDom: { isAnswered: () => true } })
  const { cursor } = applyPathCursor(document, { checkCondition, isAnswered })
  assert.equal(cursor.id, 'q1', 'the injected isAnswered said no, and won')
})

// ── A host that is not credit-assistant ───────────────────────────────────────
//
// The proof this walk is really descriptor-driven: the same page written with none of the `fg-*`
// vocabulary — different tags, different attribute names, a different screen element — truncates in
// exactly the same place.
const CUSTOM_PAGE = `
  <main>
    <article class="step" id="step1">
      <p id="c-intro">Tell us about yourself.</p>
      <x-question id="c-q1" fact="/chosenTaxYear"></x-question>
      <x-question id="c-q2" fact="/isUSCitizen" when="/hasSelectedChosenTaxYear" test="isTrue"></x-question>
      <x-alert id="c-ko" stop="true" when="/isUSCitizen" test="isFalse"></x-alert>
      <x-question id="c-q3" fact="/hasValidSSN" when="/isUSCitizen" test="isTrue"></x-question>
      <x-overlay id="c-modal"></x-overlay>
    </article>
    <article class="step" id="step2">
      <x-question id="c-q4" fact="/filingStatus"></x-question>
    </article>
  </main>`

const CUSTOM_FLOW_DOM = {
  questionTag: 'x-question',
  displayTag: 'x-display',
  alertTag: 'x-alert',
  unitSelector: 'x-question, x-display',
  modalTag: 'x-overlay',
  screenSelector: 'article.step',
  pathAttr: 'fact',
  conditionAttr: 'when',
  operatorAttr: 'test',
  optionalAttr: 'skippable',
  knockoutAttr: 'stop',
}

test('a host with none of the fg-* vocabulary truncates the same way', () => {
  document.body.innerHTML = CUSTOM_PAGE
  configure({ flowDom: CUSTOM_FLOW_DOM })
  answers.add('c-q1')
  facts.set('/hasSelectedChosenTaxYear', true)

  const { cursor, terminal } = run()
  assert.equal(cursor.id, 'c-q2')
  assert.equal(terminal, 'question')
  assert.deepEqual(offPath(), ['c-ko', 'c-q3', 'step2'])
  assert.equal(document.querySelector('#c-intro').classList.contains(OFF_PATH_CLASS), false)
  // The host's own overlay tag is exempt for the same reason <dialog> is: a link opens it, so it is
  // never a step on the path and must not be swept up as one.
  assert.equal(document.querySelector('#c-modal').classList.contains(OFF_PATH_CLASS), false)
})

test('a host’s knockout and optional attributes are honoured under their own names', () => {
  document.body.innerHTML = CUSTOM_PAGE
  configure({ flowDom: CUSTOM_FLOW_DOM })
  answers.add('c-q1')
  answers.add('c-q2')
  facts.set('/hasSelectedChosenTaxYear', true)
  facts.set('/isUSCitizen', false)
  assert.equal(run().terminal, 'knockout')

  document.querySelector('#c-q2').setAttribute('skippable', 'true')
  answers.delete('c-q2')
  assert.equal(run().cursor.id, 'c-ko', 'the optional question did not stop the path')
})
