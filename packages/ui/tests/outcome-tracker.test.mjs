// The Outcome tracker tool: the determination accordions it draws off a stubbed window.factGraph,
// what each summary says while its rollup is unsettled and once it settles, and the fact tables
// inside. Driven with jsdom, like every other element spec here.
//
// The determinations are the *host's* (config.determinations, empty by default), so this spec plays
// the host. The fixture below is the shape credit-assistant configures, cut down to the cases that
// matter to the element: an enum rollup with its own wording, two boolean rollups whose outcome is
// a negation, and more than one section under one determination.
import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

let configure
let _resetConfig
let determinationFacts
let dom

const FILING_STATUS_LABELS = new Map([
  ['single', 'Single'],
  ['marriedFilingJointly', 'Married filing jointly'],
  ['headOfHousehold', 'Head of household'],
])

const DETERMINATIONS = [
  {
    id: 'filing-status',
    label: 'Derived Filing Status',
    rollupPath: '/derivedFilingStatus',
    // A descriptor, the canonical form: a determination is JSON end to end so it can be edited from
    // Workspace settings. Anything unrecognised falls through to the formatted value rather than
    // being swallowed — see outcome-kinds.test.mjs for the kinds themselves.
    outcome: { kind: 'map', values: Object.fromEntries(FILING_STATUS_LABELS) },
    sections: [
      { heading: 'Marital status', facts: ['/isSingle', '/isDivorcedOrLegallySeparated'] },
      {
        heading: 'Household & filing intent',
        facts: ['/intendsToFileJointly', '/derivedFilingStatus'],
      },
    ],
  },
  {
    id: 'without-qualifying-child',
    label: 'Qualifies without a qualifying child',
    // A disqualifier, so the outcome is its negation: disqualified means you do not qualify.
    rollupPath: '/isDisqualifiedByAgeWithoutChildren',
    outcome: { kind: 'boolean', true: 'No', false: 'Yes' },
    sections: [
      {
        heading: 'Age without a qualifying child',
        facts: ['/failsAgeBandWithoutChildren', '/isDisqualifiedByAgeWithoutChildren'],
      },
    ],
  },
  {
    id: 'qualifying-child',
    label: 'Qualifying child eligibility',
    rollupPath: '/isDisqualifiedByAgeWithChildren',
    // Left as a function on purpose: a host with a genuinely bespoke rollup keeps that escape
    // hatch, and the tracker must not care which form it was handed.
    outcome: (raw) => (raw === true ? 'Not qualified' : 'Qualified'),
    sections: [
      {
        heading: 'Age with a qualifying child',
        facts: [
          '/hasChildAndShouldSeeAgeComparisonTest',
          '/qualifyingChildren',
          '/isDisqualifiedByAgeWithChildren',
        ],
      },
    ],
  },
]

// Facts the graph answers for. Anything a determination lists that isn't here throws on get(),
// which is the same thing the real graph does for a path the dictionary has dropped — so the
// default state of every row in this spec is "still unanswered", and each test settles only what
// it is about.
let FACTS

function stubFactGraph () {
  FACTS = new Map()
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

/** Settle `path` on the stub graph at `value`. */
function settle (path, value, type = 'BooleanNode') {
  FACTS.set(path, { complete: true, hasValue: true, get: value, type })
}

/** Put `path` in the graph but leave it unanswered. */
function unsettle (path) {
  FACTS.set(path, { complete: false, hasValue: false, get: null, type: 'BooleanNode' })
}

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
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
  stubTemplateFetch()
  ;({ configure, _resetConfig } = await import('../src/shared/js/config.js'))
  ;({ determinationFacts } = await import('../src/tool-panels/js/taxpert-outcome-tracker.js'))
})

after(() => _resetConfig())

beforeEach(() => {
  document.body.replaceChildren()
  stubFactGraph()
  _resetConfig()
  configure({ determinations: DETERMINATIONS })
})

async function mount () {
  const tracker = document.createElement('taxpert-outcome-tracker')
  document.body.appendChild(tracker)
  await tracker.ready
  return tracker
}

const rowsOf = (tracker) =>
  [...tracker.querySelectorAll('.ttp-outcome__row')].map((row) => ({
    label: row.querySelector('[data-field="label"]').textContent,
    value: row.querySelector('[data-field="value"]').textContent,
    status: row.dataset.status,
    icon: row.querySelector('.ttp-outcome__status use').getAttribute('href'),
  }))

const rowFor = (tracker, id) => tracker.querySelector(`[data-determination="${id}"]`)

const factsOf = (row) =>
  [...row.querySelectorAll('.ttp-outcome__fact')].map((fact) => ({
    path: fact.querySelector('[data-field="path"]').textContent,
    value: fact.querySelector('[data-field="value"]').textContent,
    status: fact.dataset.status,
    // The attribute, not the `.hidden` property. `hidden` is HTMLElement's and this is an <svg>,
    // which has no such reflection — so reading the property here asked the same broken question the
    // component was asking when it wrote it, and the two wrong answers agreed. Every fact icon was
    // hidden in the browser while this assertion passed. Read what the stylesheet reads.
    icon: fact.querySelector('.ttp-outcome__fact-icon').hasAttribute('hidden')
      ? null
      : fact.querySelector('.ttp-outcome__fact-icon use').getAttribute('href'),
  }))

// ── The determinations ────────────────────────────────────────────────────────

// The rollup is what the summary speaks, so it has to be one of the facts the expanded view shows —
// otherwise a determination could read "settled" with nothing underneath it saying why. The helper
// is exported for exactly this: a host derives its other fact-path surfaces from the same list.
test('every determination lists its own rollup among its facts', () => {
  for (const determination of DETERMINATIONS) {
    assert.ok(
      determinationFacts(determination).includes(determination.rollupPath),
      `${determination.id} does not list ${determination.rollupPath}`
    )
  }
})

// ── Rows ──────────────────────────────────────────────────────────────────────

test('an empty graph draws every determination as unsettled', async () => {
  const tracker = await mount()
  assert.deepEqual(rowsOf(tracker), [
    {
      label: 'Derived Filing Status',
      value: '4 unanswered facts',
      status: 'pending',
      icon: '#ttp-icon-pending',
    },
    {
      label: 'Qualifies without a qualifying child',
      value: '2 unanswered facts',
      status: 'pending',
      icon: '#ttp-icon-pending',
    },
    {
      label: 'Qualifying child eligibility',
      value: '3 unanswered facts',
      status: 'pending',
      icon: '#ttp-icon-pending',
    },
  ])
})

test('a settled filing status is spoken as its own name, with the green mark', async () => {
  settle('/derivedFilingStatus', 'marriedFilingJointly', 'EnumNode')
  const tracker = await mount()
  const row = rowsOf(tracker)[0]

  assert.equal(row.value, 'Married filing jointly')
  assert.equal(row.status, 'settled')
  assert.equal(row.icon, '#ttp-icon-check_circle')
})

// A filing status the dictionary grows later still shows up as itself rather than disappearing.
test('an unrecognised filing status falls through to the graph value', async () => {
  settle('/derivedFilingStatus', 'somethingNew', 'EnumNode')
  const tracker = await mount()
  assert.equal(rowsOf(tracker)[0].value, 'somethingNew')
})

// Both remaining determinations roll up a *disqualifier*, so the outcome is its negation.
test('the disqualifier determinations speak their negation', async () => {
  settle('/isDisqualifiedByAgeWithoutChildren', true)
  settle('/isDisqualifiedByAgeWithChildren', false)
  const tracker = await mount()

  assert.deepEqual(rowsOf(tracker).slice(1).map((row) => [row.value, row.status, row.icon]), [
    ['No', 'settled', '#ttp-icon-check_circle'],
    ['Qualified', 'settled', '#ttp-icon-check_circle'],
  ])
})

// The mark says "this determination has an answer", not "the answer was yes" — a settled `false`
// rollup is as finished as a settled `true`.
test('a determination that settles false is still marked settled', async () => {
  settle('/isDisqualifiedByAgeWithChildren', false)
  const tracker = await mount()
  assert.equal(rowFor(tracker, 'qualifying-child').dataset.status, 'settled')
})

test('the count is of unanswered facts across every section, and reads singular at one', async () => {
  // Qualifying child eligibility has three facts; settle two, leaving one.
  settle('/hasChildAndShouldSeeAgeComparisonTest', true)
  settle('/qualifyingChildren', 1, 'IntNode')
  const tracker = await mount()

  assert.equal(rowsOf(tracker)[2].value, '1 unanswered fact')
})

// A host may leave outcome() off and mean "say whatever the rollup is worth".
test('a determination with no outcome() speaks the rollup’s own value', async () => {
  configure({
    determinations: [{
      id: 'plain',
      label: 'Plain',
      rollupPath: '/total',
      sections: [{ heading: 'Amounts', facts: ['/total'] }],
    }],
  })
  settle('/total', '500.00', 'DollarNode')
  const tracker = await mount()

  assert.equal(rowsOf(tracker)[0].value, '$500')
})

// ── Facts ─────────────────────────────────────────────────────────────────────

test('each fact state draws its own icon and wording', async () => {
  settle('/hasChildAndShouldSeeAgeComparisonTest', true)
  settle('/isDisqualifiedByAgeWithChildren', false)
  unsettle('/qualifyingChildren')
  const tracker = await mount()

  assert.deepEqual(factsOf(rowFor(tracker, 'qualifying-child')), [
    {
      path: '/hasChildAndShouldSeeAgeComparisonTest',
      value: 'True',
      status: 'complete',
      icon: '#ttp-icon-check_circle_outline',
    },
    {
      path: '/qualifyingChildren',
      value: 'Incomplete',
      status: 'incomplete',
      // The part-drawn ring, the same glyph the Watchlist gives an unanswered fact. This was `null`
      // — the label with a blank slot beside it — and a blank cell in a column that marks every
      // other row read as a rendering fault rather than as a state.
      icon: '#ttp-icon-pending',
    },
    {
      path: '/isDisqualifiedByAgeWithChildren',
      value: 'False',
      status: 'false',
      icon: '#ttp-icon-error_circle_outline',
    },
  ])
})

// /derivedFilingStatus sits in a fact list as well as being a rollup, and "True" would be a lie.
test('a complete non-boolean fact shows its value rather than True', async () => {
  settle('/derivedFilingStatus', 'single', 'EnumNode')
  const tracker = await mount()
  const fact = factsOf(rowFor(tracker, 'filing-status'))
    .find((row) => row.path === '/derivedFilingStatus')

  assert.deepEqual(fact, {
    path: '/derivedFilingStatus',
    value: 'single',
    status: 'complete',
    icon: '#ttp-icon-check_circle_outline',
  })
})

test('each section is headed by its name and its fact count', async () => {
  const tracker = await mount()
  const headings = [...tracker.querySelectorAll('.ttp-outcome__heading')]
    .map((heading) => heading.textContent.replace(/\s+/g, ' ').trim())

  assert.deepEqual(headings, [
    'Marital status (2)',
    'Household & filing intent (2)',
    'Age without a qualifying child (2)',
    'Age with a qualifying child (3)',
  ])
})

// ── With nothing configured ───────────────────────────────────────────────────

// An empty accordion list would read as "nothing has settled yet". The truth is that this host
// tracks no outcomes, and every host but one is in that position.
test('a host that configures no determinations gets an empty state, not an empty list', async () => {
  _resetConfig()
  const tracker = await mount()

  assert.equal(tracker.querySelector('.ttp-outcome__list'), null, 'no accordion list at all')
  assert.equal(tracker.querySelectorAll('.ttp-outcome__row').length, 0)
  assert.match(tracker.textContent, /No outcomes are being tracked/)
})

// The list arrives from a host script that may well run after the panel has rendered — and
// fact-explorer re-configures at runtime when its data source changes.
test('a later configure() builds the rows the first render had nothing to draw', async () => {
  _resetConfig()
  const tracker = await mount()
  assert.equal(tracker.querySelectorAll('.ttp-outcome__row').length, 0)

  configure({ determinations: DETERMINATIONS })

  assert.deepEqual(rowsOf(tracker).map((row) => row.label), [
    'Derived Filing Status',
    'Qualifies without a qualifying child',
    'Qualifying child eligibility',
  ])
})

// ── Staying in step ───────────────────────────────────────────────────────────

// An fg-update fires on every keystroke in the flow. Rebuilding would slam shut whatever the user
// had expanded to read, so rows are refreshed in place.
test('an fg-update refreshes in place without rebuilding the rows', async () => {
  const tracker = await mount()
  const row = rowFor(tracker, 'qualifying-child')
  row.open = true

  settle('/isDisqualifiedByAgeWithChildren', true)
  document.dispatchEvent(new window.CustomEvent('fg-update'))

  assert.equal(rowFor(tracker, 'qualifying-child'), row, 'the same element')
  assert.equal(row.open, true, 'still expanded')
  assert.equal(row.dataset.status, 'settled')
  assert.equal(row.querySelector('[data-field="value"]').textContent, 'Not qualified')
})

test('an fg-load refreshes too, so a loaded scenario lands', async () => {
  const tracker = await mount()
  settle('/derivedFilingStatus', 'headOfHousehold', 'EnumNode')
  document.dispatchEvent(new window.CustomEvent('fg-load'))

  assert.equal(rowsOf(tracker)[0].value, 'Head of household')
})

// fact-explorer has no fact graph at all, and credit-assistant has none until the Scala.js
// bundle has run — neither may take the panel down with it.
test('with no fact graph the panel still draws every row and fact', async () => {
  delete window.factGraph
  const tracker = await mount()

  assert.equal(rowsOf(tracker).length, 3)
  assert.deepEqual(rowsOf(tracker).map((row) => row.status), ['pending', 'pending', 'pending'])
  assert.deepEqual(factsOf(rowFor(tracker, 'qualifying-child')).map((fact) => fact.value), [
    'Unavailable',
    'Unavailable',
    'Unavailable',
  ])
})
