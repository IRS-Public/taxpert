// The Inspect tool: the empty state it opens on, the three rows a selected rendered unit expands
// into, the plain-language reading of a condition's <Derived> tree, and the hover/click treatment
// the "Inspect rendered units" display option puts on the host page's flow. Driven with jsdom, like
// every other element spec here.
import { test, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

let dom
let selection
let cues
let definitions
let layout
let configure
let _resetConfig

// A dictionary with the four shapes the panel has to read: a Writable boolean with a description, a
// Derived All/Not flow gate, a Derived single-dependency text gate, and a fact inside a collection.
const DICTIONARY = `<?xml version="1.0"?>
<FactDictionaryModule>
  <Facts>
    <Fact path="/hasLivedInUSMore6Months">
      <Name>Main home in the U.S.</Name>
      <Description>Whether the taxpayer's main home was in the United States for more than half of the tax year.</Description>
      <Writable><Boolean/></Writable>
    </Fact>
    <Fact path="/flowShouldSeeResidencyKnockOut">
      <Description>Whether the taxpayer should be asked about their main home.</Description>
      <Derived>
        <All>
          <Not><Dependency path="/primaryFilerIsClaimingQualifyingChildren"/></Not>
          <Dependency path="/isFilingStatusComplete"/>
        </All>
      </Derived>
    </Fact>
    <Fact path="/primaryFilerIsClaimingQualifyingChildren">
      <Name>Taxpayer is claiming qualifying children</Name>
      <Writable><Boolean/></Writable>
    </Fact>
    <Fact path="/isFilingStatusComplete">
      <Name>Filing status has been determined</Name>
      <Writable><Boolean/></Writable>
    </Fact>
    <Fact path="/isFilingStatusMFJ">
      <Name>Married filing jointly</Name>
      <Derived><Dependency path="/isFilingStatusComplete"/></Derived>
    </Fact>
    <Fact path="/chosenTaxYear">
      <Name>Chosen tax year</Name>
      <Writable><Int/></Writable>
    </Fact>
    <Fact path="/familyAndHousehold/*/isQualifyingChild">
      <Name>Is a qualifying child</Name>
      <Description>Whether this household member is a qualifying child.</Description>
      <Derived><Dependency path="../ageAtEndOfTaxYear"/></Derived>
    </Fact>
  </Facts>
</FactDictionaryModule>`

const FACTS = new Map([
  ['/hasLivedInUSMore6Months', { complete: true, hasValue: true, get: true, type: 'BooleanNode' }],
  ['/flowShouldSeeResidencyKnockOut', { complete: true, hasValue: true, get: true, type: 'BooleanNode' }],
  ['/primaryFilerIsClaimingQualifyingChildren', { complete: true, hasValue: true, get: false, type: 'BooleanNode' }],
  ['/isFilingStatusComplete', { complete: true, hasValue: true, get: true, type: 'BooleanNode' }],
  ['/isFilingStatusMFJ', { complete: true, hasValue: true, get: true, type: 'BooleanNode' }],
  ['/chosenTaxYear', { complete: true, hasValue: true, get: 2024, type: 'IntNode' }],
  ['/notAnswered', { complete: false, hasValue: false, get: null, type: 'BooleanNode' }],
  // A collection fact, keyed both ways: the graph answers get() on the concrete path and
  // getDefinition() on the abstract one, which is the split the panel has to get right.
  ['/familyAndHousehold/#abc/isQualifyingChild', { complete: true, hasValue: true, get: true, type: 'BooleanNode' }],
  ['/familyAndHousehold/*/isQualifyingChild', { complete: true, hasValue: true, get: true, type: 'BooleanNode' }],
  ['/familyAndHousehold/#abc/ageAtEndOfTaxYear', { complete: true, hasValue: true, get: 12, type: 'IntNode' }],
  ['/familyAndHousehold/*/ageAtEndOfTaxYear', { complete: true, hasValue: true, get: 12, type: 'IntNode' }],
])

function stubFactGraph () {
  window.factGraph = {
    paths: () => [...FACTS.keys()],
    getCollectionIds: () => [],
    get: (path) => {
      const fact = FACTS.get(path)
      if (!fact) throw new Error(`no such path ${path}`)
      return fact
    },
    dictionary: {
      getDefinition: (path) => {
        const fact = FACTS.get(path)
        if (!fact) throw new Error(`no such definition ${path}`)
        return { typeNode: fact.type }
      },
    },
  }
}

/** A rendered question, the way credit-assistant emits one. */
function mountQuestion ({ condition = '/flowShouldSeeResidencyKnockOut', operator = 'isTrue' } = {}) {
  const fgSet = document.createElement('fg-set')
  fgSet.setAttribute('path', '/hasLivedInUSMore6Months')
  if (condition) fgSet.setAttribute('condition', condition)
  if (operator) fgSet.setAttribute('operator', operator)

  const label = document.createElement('label')
  label.className = 'usa-label twe-question'
  label.append(document.createTextNode('Was your main home in the U.S. for more than half of '))

  const conditional = document.createElement('span')
  conditional.setAttribute('condition', '/isFilingStatusMFJ')
  conditional.setAttribute('operator', 'isTrue')
  conditional.textContent = '2024'
  label.appendChild(conditional)
  label.append(document.createTextNode('?'))

  const hint = document.createElement('span')
  hint.className = 'usa-hint'
  hint.textContent = '(required)'
  label.appendChild(hint)

  fgSet.appendChild(label)
  document.body.appendChild(fgSet)
  return fgSet
}

/** An <taxpert-inspect> in the document, rendered. */
async function mount () {
  const element = document.createElement('taxpert-inspect')
  document.body.appendChild(element)
  await element.ready
  return element
}

const rowKinds = (element) =>
  [...element.querySelectorAll('.ttp-inspect__row')].map((row) => row.dataset.kind)

const rowFor = (element, kind) => element.querySelector(`.ttp-inspect__row[data-kind="${kind}"]`)

const textOf = (node) => node.textContent.replace(/\s+/g, ' ').trim()

/** Let the cues' MutationObserver run: its callback is queued, not synchronous. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

before(async () => {
  // The flow's own rule for a question whose condition is false, as credit-assistant writes it —
  // the cues have to read the host's hiding, so the specs need it in the cascade.
  const page = '<!doctype html><html><head><style>.hidden { display: none; opacity: 0 }</style>' +
    '</head><body></body></html>'
  dom = new JSDOM(page, {
    url: 'http://localhost/',
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
  stubTemplateFetch(async (url) => {
    if (url.endsWith('fact-dictionary.xml')) {
      return { ok: true, status: 200, text: async () => DICTIONARY }
    }
    throw new Error(`unexpected fetch of ${url}`)
  })

  await import('../src/tool-panels/js/taxpert-inspect.js')
  selection = await import('../src/tool-panels/js/inspect-selection.js')
  cues = await import('../src/tool-panels/js/inspect-cues.js')
  definitions = await import('../src/tool-panels/js/fact-definitions.js')
  layout = await import('../src/tool-panels/js/tool-layout.js')
  ;({ configure, _resetConfig } = await import('../src/shared/js/config.js'))

  // The dictionary is the audit panel's, fetched once; the tool panels read the parsed document.
  const dictionary = await import('../src/audit-panel/js/fact-dictionary.js')
  await dictionary.loadFactDictionaryXml('/fact-dictionary.xml')
})

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  layout._resetToolLayout()
  // The cues outlive a test: they watch the host for as long as the option is on.
  cues.hideInspectCues()
  document.body.className = ''
  document.body.replaceChildren()
  selection.clearInspectSelection()
  stubFactGraph()
})

// The descriptor is global state, so a spec describing another host's markup must not leave it
// behind for the next one. Torn down *after* each test rather than before, because the cues stay
// watching the host between tests and would re-sync against the wrong vocabulary.
afterEach(() => {
  cues.hideInspectCues()
  _resetConfig()
})

// ── The empty state ───────────────────────────────────────────────────────────

test('with nothing selected the panel is the instruction and its illustration', async () => {
  const element = await mount()

  assert.equal(element.querySelector('[data-region="empty"]').hidden, false)
  assert.equal(element.querySelector('[data-region="selected"]').hidden, true)
  assert.equal(
    textOf(element.querySelector('.ttp-inspect__empty-title')),
    'Select an item to get started'
  )
  assert.match(textOf(element.querySelector('.ttp-inspect__empty-hint')), /^Click\/hover on\/over/)
  // Decorative, but the only thing in the panel a reader could mistake for content.
  assert.equal(element.querySelector('.ttp-inspect__empty-art').getAttribute('role'), 'img')
  assert.equal(rowKinds(element).length, 0)
})

// ── A selected unit ───────────────────────────────────────────────────────────

test('selecting a question draws its three objects, in the designs’ order', async () => {
  const element = await mount()
  selection.selectRenderedUnit(cues.describeRenderedUnit(mountQuestion()))

  assert.equal(element.querySelector('[data-region="empty"]').hidden, true)
  assert.deepEqual(rowKinds(element), ['fact', 'flow', 'text'])

  // The title is the question as the page renders it — its conditional phrase included, its
  // "(required)" hint not.
  assert.equal(
    textOf(element.querySelector('[data-field="title"]')),
    'Was your main home in the U.S. for more than half of 2024?'
  )

  const labels = [...element.querySelectorAll('.ttp-row__label')].map(textOf)
  assert.deepEqual(labels, ['Fact', 'Conditional flow', 'Conditional text'])
  const paths = [...element.querySelectorAll('.ttp-row__path')].map(textOf)
  assert.deepEqual(paths, [
    '/hasLivedInUSMore6Months',
    '/flowShouldSeeResidencyKnockOut',
    '/isFilingStatusMFJ',
  ])
})

test('a question with no gate and no conditional copy draws only its fact row', async () => {
  const element = await mount()
  const fgSet = mountQuestion({ condition: null, operator: null })
  fgSet.querySelector('span[condition]').remove()

  selection.selectRenderedUnit(cues.describeRenderedUnit(fgSet))

  assert.deepEqual(rowKinds(element), ['fact'])
})

// ── The Fact row ──────────────────────────────────────────────────────────────

test('the fact row shows the graph’s own value, the data type and the dictionary’s purpose', async () => {
  const element = await mount()
  selection.selectRenderedUnit(cues.describeRenderedUnit(mountQuestion()))

  const fact = rowFor(element, 'fact')
  // A boolean reads true/false here rather than the Watchlist's Yes/No: Inspect is where you go to
  // read the fact rather than the answer.
  assert.equal(textOf(fact.querySelector('[data-field="value"]')), 'true')
  assert.equal(textOf(fact.querySelector('[data-field="type"]')), 'Boolean')
  assert.match(textOf(fact.querySelector('[data-field="purpose"]')), /^Whether the taxpayer's main/)
  assert.equal(fact.querySelector('[data-region="purpose"]').hidden, false)
  assert.equal(fact.querySelector('[data-field="fact-type"]').textContent, 'Writable')
})

test('an IntNode is named Integer, and a fact with no description hides Purpose', async () => {
  const element = await mount()
  selection.selectRenderedUnit({
    title: 'Tax year', fact: { path: '/chosenTaxYear' }, flow: null, text: null,
  })

  const fact = rowFor(element, 'fact')
  assert.equal(textOf(fact.querySelector('[data-field="value"]')), '2024')
  assert.equal(textOf(fact.querySelector('[data-field="type"]')), 'Integer')
  assert.equal(fact.querySelector('[data-region="purpose"]').hidden, true)
})

test('a long enum value is cut with an ellipsis, and kept whole in the title', async () => {
  const long = 'Divorced or legally separated under a decree of separate maintenance'
  FACTS.set('/filingStatus', { complete: true, hasValue: true, get: long, type: 'EnumNode' })
  const element = await mount()
  selection.selectRenderedUnit({
    title: 'Filing status', fact: { path: '/filingStatus' }, flow: null, text: null,
  })

  const value = rowFor(element, 'fact').querySelector('[data-field="value"]')
  assert.ok(value.textContent.length < long.length, 'it was cut')
  assert.ok(value.textContent.endsWith('…'))
  assert.equal(value.title, long, 'and the whole of it is still reachable')
  FACTS.delete('/filingStatus')
})

test('the Advanced readout is the fact’s XML, annotated with each dependency’s value', async () => {
  const element = await mount()
  selection.selectRenderedUnit(cues.describeRenderedUnit(mountQuestion()))

  // Closed until asked for: it is the working behind the answer, not the answer, and a screenful
  // of XML unfolded under every row would bury the sections above it.
  const advanced = rowFor(element, 'flow').querySelector('.ttp-inspect__advanced')
  assert.equal(advanced.open, false, 'shut by default')

  const xml = rowFor(element, 'flow').querySelector('[data-field="xml"]').textContent
  assert.match(xml, /<Fact path="\/flowShouldSeeResidencyKnockOut">/)
  assert.match(xml, /path="\/isFilingStatusComplete" ⮕ true \(complete\)/)
  assert.match(xml, /path="\/primaryFilerIsClaimingQualifyingChildren" ⮕ false \(complete\)/)
})

// ── The condition rows ────────────────────────────────────────────────────────

test('a flow condition is read out as a bulleted list, with negation in bold', async () => {
  const element = await mount()
  selection.selectRenderedUnit(cues.describeRenderedUnit(mountQuestion()))

  const flow = rowFor(element, 'flow')
  assert.equal(
    textOf(flow.querySelector('[data-field="lead"]')),
    'This question is shown when all of the following are true:'
  )

  const clauses = [...flow.querySelectorAll('.ttp-inspect__clause')].map(textOf)
  assert.deepEqual(clauses, [
    'Taxpayer is claiming qualifying children is not true',
    'Filing status has been determined is true',
  ])
  // A real <strong>, not a class mirroring one — the emphasis is in the markup.
  assert.equal(flow.querySelector('.ttp-inspect__clause strong').textContent, 'not')
})

test('the Dependencies table names every depended-on fact and what it is worth', async () => {
  const element = await mount()
  selection.selectRenderedUnit(cues.describeRenderedUnit(mountQuestion()))

  const flow = rowFor(element, 'flow')
  assert.equal(
    textOf(flow.querySelector('[data-field="depends"]')),
    'This flow condition depends on:'
  )
  const rows = [...flow.querySelectorAll('.ttp-inspect__dep')].map((row) => [
    textOf(row.querySelector('[data-field="path"]')),
    textOf(row.querySelector('[data-field="value"]')),
  ])
  assert.deepEqual(rows, [
    ['/primaryFilerIsClaimingQualifyingChildren', 'false'],
    ['/isFilingStatusComplete', 'true'],
  ])
})

test('a conditional-text row speaks about the text, not the question', async () => {
  const element = await mount()
  selection.selectRenderedUnit(cues.describeRenderedUnit(mountQuestion()))

  const text = rowFor(element, 'text')
  assert.equal(
    textOf(text.querySelector('[data-field="lead"]')),
    'This text is shown when the following is true:'
  )
  assert.equal(
    textOf(text.querySelector('[data-field="depends"]')),
    'This text conditional depends on:'
  )
})

test('an isFalse gate says so, rather than reading the tree back as if it were the gate', () => {
  const described = definitions.describeCondition({
    path: '/flowShouldSeeResidencyKnockOut', operator: 'isFalse', kind: 'flow',
  })
  assert.match(described.lead, /^This question is shown when .* is not true\./)
  assert.match(described.lead, /That fact is true when all of the following are true:$/)
  assert.equal(described.clauses.length, 2)
})

test('a condition on a Writable fact has a lead, no clauses and no dependency table', async () => {
  const element = await mount()
  selection.selectRenderedUnit({
    title: 'A gated question',
    fact: null,
    flow: { path: '/isFilingStatusComplete', operator: 'isTrue' },
    text: null,
  })

  const flow = rowFor(element, 'flow')
  assert.equal(
    textOf(flow.querySelector('[data-field="lead"]')),
    'This question is shown when Filing status has been determined is true.'
  )
  assert.equal(flow.querySelector('[data-region="clauses"]').hidden, true)
  assert.equal(flow.querySelector('[data-region="dependencies"]').hidden, true)
})

// A collection fact arrives with its id already spliced in ('/familyAndHousehold/#abc/…'), but the
// dictionary is keyed on the wildcard form — so reading it needs both halves, not the concrete path
// handed to everything.
test('a collection fact resolves its value and its type through its collection id', async () => {
  const element = await mount()
  const fgSet = document.createElement('fg-set')
  fgSet.setAttribute('path', '/familyAndHousehold/#abc/isQualifyingChild')
  fgSet.setAttribute('condition', '/familyAndHousehold/#abc/isQualifyingChild')
  fgSet.setAttribute('operator', 'isTrue')
  document.body.appendChild(fgSet)

  selection.selectRenderedUnit(cues.describeRenderedUnit(fgSet))

  const fact = rowFor(element, 'fact')
  assert.equal(textOf(fact.querySelector('[data-field="value"]')), 'true')
  assert.equal(textOf(fact.querySelector('[data-field="type"]')), 'Boolean', 'the type survived')
  assert.match(textOf(fact.querySelector('[data-field="purpose"]')), /^Whether this household/)

  // The '..' in the dependency resolves against the fact's own collection, and its value is read
  // for this item rather than left blank.
  const dependency = rowFor(element, 'flow').querySelector('.ttp-inspect__dep')
  assert.equal(
    textOf(dependency.querySelector('[data-field="path"]')),
    '/familyAndHousehold/*/ageAtEndOfTaxYear'
  )
  assert.equal(textOf(dependency.querySelector('[data-field="value"]')), '12')
})

// ── Staying in step ───────────────────────────────────────────────────────────

test('an fg-update refreshes values without rebuilding — an open row stays open', async () => {
  const element = await mount()
  selection.selectRenderedUnit(cues.describeRenderedUnit(mountQuestion()))

  const fact = rowFor(element, 'fact')
  fact.open = true

  FACTS.set('/hasLivedInUSMore6Months', {
    complete: true, hasValue: true, get: false, type: 'BooleanNode',
  })
  document.dispatchEvent(new window.CustomEvent('fg-update'))

  assert.equal(rowFor(element, 'fact'), fact, 'the same element')
  assert.equal(fact.open, true, 'and it kept its state')
  assert.equal(textOf(fact.querySelector('[data-field="value"]')), 'false')

  FACTS.set('/hasLivedInUSMore6Months', {
    complete: true, hasValue: true, get: true, type: 'BooleanNode',
  })
})

test('an unanswered fact reads as Incomplete rather than throwing', async () => {
  const element = await mount()
  selection.selectRenderedUnit({
    title: 'Unanswered', fact: { path: '/notAnswered' }, flow: null, text: null,
  })

  assert.equal(
    textOf(rowFor(element, 'fact').querySelector('[data-field="value"]')),
    'Incomplete'
  )
})

test('with no fact graph at all the panel still draws the selection', async () => {
  const element = await mount()
  window.factGraph = null
  selection.selectRenderedUnit(cues.describeRenderedUnit(mountQuestion()))

  assert.deepEqual(rowKinds(element), ['fact', 'flow', 'text'])
  assert.equal(
    textOf(rowFor(element, 'fact').querySelector('[data-field="value"]')),
    'Unavailable'
  )
})

test('a panel opened by the selection reads the standing value, not the event it missed', async () => {
  // The order a click on a unit produces: select first, and the panel that opens renders afterwards.
  selection.selectRenderedUnit(cues.describeRenderedUnit(mountQuestion()))
  const element = await mount()

  assert.equal(element.querySelector('[data-region="empty"]').hidden, true)
  assert.deepEqual(rowKinds(element), ['fact', 'flow', 'text'])
})

// ── The host-page units ───────────────────────────────────────────────────────
//
// The option marks each rendered unit and inspect.css does the rest: hover draws the dotted box,
// [data-inspect-selected] the solid one. Only the marks are testable here — jsdom applies no
// stylesheet — so what these specs pin down is which elements are in play, which one is selected,
// and that a click both selects and leaves the taxpayer's own click alone.

/** A click the way a pointer makes one: on the deepest element, bubbling up to the document. */
function clickOn (element) {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
}

test('every rendered unit is marked, once, and clicking one opens Inspect on it', async () => {
  const element = await mount()
  const fgSet = mountQuestion()
  const fgShow = document.createElement('fg-show')
  fgShow.setAttribute('path', '/chosenTaxYear')
  document.body.appendChild(fgShow)

  cues.showInspectCues()
  cues.showInspectCues() // idempotent: a second pass must not change what the first left

  assert.equal(document.body.classList.contains('inspect-rendered-units'), true)
  assert.equal(document.querySelectorAll('[data-inspect-unit]').length, 2)
  assert.equal(fgSet.getAttribute('data-inspect-unit'), '')

  clickOn(fgShow)

  assert.equal(layout.getLayout().on.includes('inspect'), true, 'and it opened the tool')
  assert.equal(textOf(element.querySelector('[data-field="title"]')), 'Chosen tax year')
  assert.deepEqual(rowKinds(element), ['fact'])
})

// The cue used to be a button, whose click was stopped so it could not reach the question behind it.
// The unit itself is now the affordance, so the opposite is required: the click that selects is also
// the taxpayer choosing a radio or opening the question's help, and must go through untouched.
test('clicking inside a question selects it without swallowing the click', async () => {
  const fgSet = mountQuestion()
  const radio = document.createElement('input')
  radio.type = 'radio'
  fgSet.appendChild(radio)
  let reachedTheQuestion = false
  fgSet.addEventListener('click', () => { reachedTheQuestion = true })

  cues.showInspectCues()
  clickOn(radio)

  assert.equal(reachedTheQuestion, true, 'the question still got its own click')
  assert.equal(fgSet.getAttribute('data-inspect-selected'), '')
})

test('a display unit nested in a question selects itself, not the question around it', async () => {
  const fgSet = mountQuestion()
  const fgShow = document.createElement('fg-show')
  fgShow.setAttribute('path', '/chosenTaxYear')
  fgSet.querySelector('label').appendChild(fgShow)

  cues.showInspectCues()
  clickOn(fgShow)

  assert.equal(fgShow.getAttribute('data-inspect-selected'), '')
  assert.equal(fgSet.hasAttribute('data-inspect-selected'), false)
})

test('selecting another unit moves the selected mark rather than adding a second', async () => {
  const first = mountQuestion()
  const second = document.createElement('fg-show')
  second.setAttribute('path', '/chosenTaxYear')
  document.body.appendChild(second)

  cues.showInspectCues()
  clickOn(first)
  clickOn(second)

  assert.deepEqual(
    [...document.querySelectorAll('[data-inspect-selected]')],
    [second]
  )
})

// The mark follows the selection rather than the pointer, so the panel emptying empties it too.
test('clearing the selection takes the selected mark off the unit', async () => {
  const fgSet = mountQuestion()
  cues.showInspectCues()
  clickOn(fgSet)

  selection.clearInspectSelection()

  assert.equal(fgSet.hasAttribute('data-inspect-selected'), false)
  assert.equal(fgSet.getAttribute('data-inspect-unit'), '', 'but it is still inspectable')
})

test('closing the Inspect tool takes the selected mark with it', async () => {
  const fgSet = mountQuestion()
  cues.showInspectCues()
  clickOn(fgSet)

  layout.setToolOn('inspect', false)

  assert.equal(fgSet.hasAttribute('data-inspect-selected'), false)
})

test('turning the option off unmarks every unit and stops selecting', async () => {
  const question = mountQuestion()
  cues.showInspectCues()
  cues.hideInspectCues()

  assert.equal(document.body.classList.contains('inspect-rendered-units'), false)
  assert.equal(document.querySelectorAll('[data-inspect-unit]').length, 0)
  assert.equal(question.hasAttribute('data-inspect-selected'), false)

  // A click is no longer an inspection…
  clickOn(question)
  assert.equal(layout.getLayout().on.includes('inspect'), false)

  // …and it stops watching: the host going on with its flow must not bring the marks back.
  document.body.appendChild(document.createElement('fg-show'))
  await tick()
  assert.equal(document.querySelectorAll('[data-inspect-unit]').length, 0)
})

// Switching the option on must change nothing about how the flow lays out. The highlight is an
// outline drawn from a stylesheet, so the host's own elements come away with a mark and nothing else
// — no inline style, and in particular no display of their own (see isRendered()).
test('marking the page leaves no inline style on any host element', async () => {
  const heading = document.createElement('h3')
  const fgShow = document.createElement('fg-show')
  fgShow.setAttribute('path', '/chosenTaxYear')
  heading.appendChild(fgShow)
  document.body.appendChild(heading)
  const question = mountQuestion()

  cues.showInspectCues()

  assert.equal(heading.hasAttribute('style'), false)
  assert.equal(heading.hasAttribute('data-inspect-unit'), false, 'and the block is not a unit')
  assert.equal(question.hasAttribute('style'), false)
  assert.equal(fgShow.hasAttribute('style'), false)
})

// The tax year is a constant spliced into copy all over the flow, so highlighting every occurrence
// would litter the page with boxes that all lead to the same un-derived fact.
test('a display unit whose fact the host listed as uncued is not inspectable', async () => {
  configure({ flowDom: { uncuedPaths: ['/taxYear'] } })

  const taxYear = document.createElement('fg-show')
  taxYear.setAttribute('path', '/taxYear')
  taxYear.textContent = '2025'
  document.body.appendChild(taxYear)

  // An fg-set *writing* the same fact is still a question, and still is.
  const question = mountQuestion()
  question.setAttribute('path', '/taxYear')

  cues.showInspectCues()

  assert.equal(taxYear.hasAttribute('data-inspect-unit'), false)
  clickOn(taxYear)
  assert.equal(layout.getLayout().on.includes('inspect'), false, 'and clicking it does nothing')
  assert.equal(question.getAttribute('data-inspect-unit'), '')
})

// Nothing is exempt by default: uncuedPaths names application facts, so it is the host's to supply.
test('with no uncuedPaths configured, every display unit is inspectable', async () => {
  const taxYear = document.createElement('fg-show')
  taxYear.setAttribute('path', '/taxYear')
  document.body.appendChild(taxYear)

  cues.showInspectCues()

  assert.equal(taxYear.getAttribute('data-inspect-unit'), '')
})

// ── A host that is not credit-assistant ───────────────────────────────────────
//
// The proof this is really descriptor-driven: a page with none of the `fg-*` vocabulary and none of
// the USWDS classes is marked, titled and described exactly the same way.
test('a host with its own tags, attributes and title markup is marked all the same', async () => {
  configure({
    flowDom: {
      questionTag: 'x-question',
      displayTag: 'x-display',
      unitSelector: 'x-question, x-display',
      pathAttr: 'fact',
      conditionAttr: 'when',
      operatorAttr: 'test',
      titleSelector: '.x-prompt',
      notTitleSelector: '.x-chrome',
    },
  })

  const question = document.createElement('x-question')
  question.setAttribute('fact', '/hasLivedInUSMore6Months')
  question.setAttribute('when', '/flowShouldSeeResidencyKnockOut')
  question.setAttribute('test', 'isTrue')
  const prompt = document.createElement('p')
  prompt.className = 'x-prompt'
  prompt.append(document.createTextNode('Was your main home in the U.S.?'))
  const chrome = document.createElement('span')
  chrome.className = 'x-chrome'
  chrome.textContent = '(required)'
  prompt.appendChild(chrome)
  question.appendChild(prompt)
  document.body.appendChild(question)

  const display = document.createElement('x-display')
  display.setAttribute('fact', '/chosenTaxYear')
  document.body.appendChild(display)

  cues.showInspectCues()

  assert.equal(document.querySelectorAll('[data-inspect-unit]').length, 2)
  assert.equal(question.getAttribute('data-inspect-unit'), '')

  // The objects behind the unit come off the host's attribute names, and the title is read through
  // its own selectors — its prompt, minus its own chrome.
  const described = cues.describeRenderedUnit(question)
  assert.equal(described.title, 'Was your main home in the U.S.?')
  assert.deepEqual(described.fact, { path: '/hasLivedInUSMore6Months' })
  assert.deepEqual(described.flow, { path: '/flowShouldSeeResidencyKnockOut', operator: 'isTrue' })
})

test('a host’s own display tag is what uncuedPaths applies to', async () => {
  configure({
    flowDom: {
      questionTag: 'x-question',
      displayTag: 'x-display',
      unitSelector: 'x-question, x-display',
      pathAttr: 'fact',
      uncuedPaths: ['/chosenTaxYear'],
    },
  })

  const display = document.createElement('x-display')
  display.setAttribute('fact', '/chosenTaxYear')
  document.body.appendChild(display)

  const question = document.createElement('x-question')
  question.setAttribute('fact', '/chosenTaxYear')
  document.body.appendChild(question)

  cues.showInspectCues()

  assert.equal(display.hasAttribute('data-inspect-unit'), false)
  assert.equal(question.getAttribute('data-inspect-unit'), '')
})

// ── What the flow is showing ──────────────────────────────────────────────────
//
// A question whose flow condition is false stays in the DOM and is hidden. Marking one of those
// would offer an invisible click target — and, through the `display: block` the old cue's anchor
// asked for, pushed the hidden question back into the layout as a band of empty space.
test('a question the flow is hiding is not inspectable', async () => {
  const hidden = mountQuestion()
  hidden.classList.add('hidden')
  const asked = mountQuestion()

  cues.showInspectCues()

  assert.equal(hidden.hasAttribute('data-inspect-unit'), false, 'so it keeps the host’s display')
  assert.equal(asked.getAttribute('data-inspect-unit'), '')
})

test('a unit inside a hidden ancestor is hidden too', async () => {
  const section = document.createElement('div')
  section.className = 'hidden'
  document.body.appendChild(section)
  const fgShow = document.createElement('fg-show')
  fgShow.setAttribute('path', '/chosenTaxYear')
  section.appendChild(fgShow)

  cues.showInspectCues()

  assert.equal(document.querySelectorAll('[data-inspect-unit]').length, 0)
})

test('a question the flow reveals later picks up its mark on its own', async () => {
  const question = mountQuestion()
  question.classList.add('hidden')
  cues.showInspectCues()
  assert.equal(question.hasAttribute('data-inspect-unit'), false)

  question.classList.remove('hidden')
  await tick()

  assert.equal(question.getAttribute('data-inspect-unit'), '')
})

// The reported bug, in its new form. A question is asked, is inspected, and the taxpayer then
// changes an earlier answer so the flow hides it again: both marks have to go, or a hidden question
// keeps a selected outline and an armed click target.
test('a question hidden after it was selected gives up both its marks', async () => {
  const question = mountQuestion()
  cues.showInspectCues()
  clickOn(question)
  assert.equal(question.getAttribute('data-inspect-selected'), '')

  question.classList.add('hidden')
  await tick()

  assert.equal(question.hasAttribute('data-inspect-unit'), false, 'so it keeps the host’s display')
  assert.equal(question.hasAttribute('data-inspect-selected'), false)
})

test('a collection row added after the option was switched on is marked as well', async () => {
  cues.showInspectCues()
  const question = mountQuestion()
  await tick()

  assert.equal(question.getAttribute('data-inspect-unit'), '')
})
