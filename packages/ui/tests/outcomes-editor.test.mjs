// The Outcomes section of Workspace settings — editing config.determinations in the browser.
//
// This is what phase 0 bought: a determination is JSON, so the Outcome tracker's content can be
// changed without touching a host's code. Driven through the real modal, because the editor's
// contract is "the config it writes", and the modal is what mounts it.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

let configure
let getConfig
let _resetConfig

const DETERMINATIONS = [
  {
    id: 'withholding-outcome',
    label: 'Withholding outcome',
    rollupPath: '/withholdingGap',
    outcome: { kind: 'signed', positive: 'Balance due of {abs}', negative: 'Refund of {abs}', zero: 'On target' },
    sections: [{ heading: 'Owed vs. withheld', facts: ['/totalOwed', '/withholdingGap'] }],
  },
  {
    id: 'underpayment-risk',
    label: 'Underpayment penalty risk',
    rollupPath: '/mayBeSubjectToUnderpaymentPenalty',
    outcome: { kind: 'boolean', true: 'At risk', false: 'Not at risk' },
    sections: [{ heading: 'Penalty thresholds', facts: ['/totalTax'] }],
  },
]

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
  globalThis.localStorage = dom.window.localStorage
  stubTemplateFetch()
  await import('../src/audit-panel/js/workspace-settings-modal.js')
  ;({ configure, getConfig, _resetConfig } = await import('../src/shared/js/config.js'))
})

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  _resetConfig()
  configure({
    determinations: structuredClone(DETERMINATIONS),
    // The path list the editor's <datalist> offers.
    graph: { paths: () => ['/withholdingGap', '/totalOwed', '/totalTax'] },
  })
})

async function mount () {
  const modal = document.createElement('taxpert-workspace-settings-modal')
  document.body.appendChild(modal)
  await modal.ready
  return modal
}

const rows = (modal) => [...modal.querySelectorAll('.twsm-outcome')]
const change = (element, value) => {
  element.value = value
  element.dispatchEvent(new window.Event('change'))
}

test('one row per determination, named by its label', async () => {
  const modal = await mount()
  assert.deepEqual(
    rows(modal).map((row) => row.querySelector('.twsm-outcome__label').textContent),
    ['Withholding outcome', 'Underpayment penalty risk']
  )
})

test('a host that tracks nothing gets the empty state', async () => {
  _resetConfig()
  const modal = await mount()
  assert.equal(rows(modal).length, 0)
  assert.equal(modal.querySelector('[data-empty="outcomes"]').hidden, false)
})

test('the fact-path datalist offers what the graph knows', async () => {
  const modal = await mount()
  assert.deepEqual(
    [...modal.querySelectorAll('#twsm-fact-paths option')].map((o) => o.value),
    ['/withholdingGap', '/totalOwed', '/totalTax']
  )
})

test('editing a label writes it to the config', async () => {
  const modal = await mount()
  change(rows(modal)[0].querySelector('[data-field="label"]'), 'Refund or balance due')
  assert.equal(getConfig().determinations[0].label, 'Refund or balance due')
})

test('editing the rollup path writes it to the config', async () => {
  const modal = await mount()
  change(rows(modal)[1].querySelector('[data-field="rollupPath"]'), '/totalTax')
  assert.equal(getConfig().determinations[1].rollupPath, '/totalTax')
})

test('the kind menu offers every kind, preselected to this outcome’s', async () => {
  const modal = await mount()
  const kind = rows(modal)[0].querySelector('[data-field="kind"]')
  assert.deepEqual([...kind.options].map((o) => o.value), ['boolean', 'map', 'signed', 'value'])
  assert.equal(kind.value, 'signed')
})

test('the kind’s own fields are shown and are editable', async () => {
  const modal = await mount()
  const fields = rows(modal)[1].querySelectorAll('.twsm-kind-fields input')
  assert.equal(fields.length, 2, 'boolean has a true and a false')

  change(fields[0], 'Penalty likely')
  assert.deepEqual(getConfig().determinations[1].outcome, {
    kind: 'boolean', true: 'Penalty likely', false: 'Not at risk',
  })
})

test('changing the kind replaces the descriptor and re-renders its fields', async () => {
  const modal = await mount()
  change(rows(modal)[1].querySelector('[data-field="kind"]'), 'value')
  assert.deepEqual(getConfig().determinations[1].outcome, { kind: 'value' })
  assert.equal(rows(modal)[1].querySelectorAll('.twsm-kind-fields input').length, 0)
})

test('a map’s options are edited as “name = wording” lines', async () => {
  const modal = await mount()
  change(rows(modal)[0].querySelector('[data-field="kind"]'), 'map')
  const area = rows(modal)[0].querySelector('.twsm-kind-fields textarea')

  change(area, 'single = Single\nheadOfHousehold = Head of household\n')
  assert.deepEqual(getConfig().determinations[0].outcome, {
    kind: 'map',
    values: { single: 'Single', headOfHousehold: 'Head of household' },
  })
})

test('facts are edited as one path per line, blank lines dropped', async () => {
  const modal = await mount()
  change(rows(modal)[0].querySelector('[data-field="facts"]'), '/a\n\n  /b  \n')
  assert.deepEqual(getConfig().determinations[0].sections[0].facts, ['/a', '/b'])
})

test('a group can be added and removed', async () => {
  const modal = await mount()
  rows(modal)[1].querySelector('[data-action="add-section"]').click()
  assert.equal(getConfig().determinations[1].sections.length, 2)

  rows(modal)[1].querySelectorAll('[data-action="remove-section"]')[1].click()
  assert.equal(getConfig().determinations[1].sections.length, 1)
})

test('an outcome can be added, and starts valid', async () => {
  const modal = await mount()
  modal.querySelector('[data-add="outcome"]').click()

  const determinations = getConfig().determinations
  assert.equal(determinations.length, 3)
  // It has to survive the validator, or the write would have been refused and nothing added.
  assert.equal(determinations[2].label, 'New outcome')
})

test('an outcome can be removed', async () => {
  const modal = await mount()
  rows(modal)[0].querySelector('[data-action="remove"]').click()
  assert.deepEqual(getConfig().determinations.map((d) => d.id), ['underpayment-risk'])
})

test('outcomes can be reordered, and the ends cannot go further', async () => {
  const modal = await mount()
  assert.equal(rows(modal)[0].querySelector('[data-action="move-up"]').disabled, true)
  assert.equal(rows(modal)[1].querySelector('[data-action="move-down"]').disabled, true)

  rows(modal)[1].querySelector('[data-action="move-up"]').click()
  assert.deepEqual(
    getConfig().determinations.map((d) => d.id),
    ['underpayment-risk', 'withholding-outcome']
  )
})

// The safety rail: the form cannot write a config the validator would reject, and if it tries the
// stored config is left alone rather than half-updated.
test('an edit the validator refuses is rolled back on screen', async () => {
  const modal = await mount()
  const heading = rows(modal)[0].querySelector('[data-field="heading"]')
  change(heading, '')

  assert.equal(
    getConfig().determinations[0].sections[0].heading,
    'Owed vs. withheld',
    'the stored config still has the build’s heading'
  )
  assert.equal(
    rows(modal)[0].querySelector('[data-field="heading"]').value,
    'Owed vs. withheld',
    'and the form was put back to it'
  )
})

test('editing marks the section as overridden and offers a reset', async () => {
  const modal = await mount()
  assert.equal(modal.querySelector('[data-override="determinations"]').hidden, true)

  change(rows(modal)[0].querySelector('[data-field="label"]'), 'Changed')
  assert.equal(modal.querySelector('[data-override="determinations"]').hidden, false)

  modal.querySelector('[data-reset="determinations"]').click()
  assert.equal(getConfig().determinations[0].label, 'Withholding outcome')
  assert.equal(modal.querySelector('[data-override="determinations"]').hidden, true)
})

// A host may keep a function for a genuinely bespoke rollup. It cannot be edited, and the editor
// has to say so rather than quietly presenting an empty form that would overwrite it on blur.
test('an outcome spoken by host code says it cannot be edited here', async () => {
  _resetConfig()
  configure({
    determinations: [{
      id: 'bespoke',
      label: 'Bespoke',
      rollupPath: '/x',
      outcome: (raw, value) => value,
      sections: [{ heading: 'Facts', facts: ['/x'] }],
    }],
  })
  const modal = await mount()
  assert.match(rows(modal)[0].querySelector('.twsm-note').textContent, /cannot be edited here/)
})
