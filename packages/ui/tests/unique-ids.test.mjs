// Every id this package mints has to be unique *across the whole page*, not just within the element
// that minted it.
//
// This exists because of a real regression. Workspace settings grew a row per tool, and the Tools
// modal already had one — both keyed `tool-<id>`, both mounted at once. Nothing looked wrong: the
// rows rendered, the labels read correctly, the specs for each modal passed in its own jsdom
// document. But a USWDS checkbox is visually hidden and clicked through its `<label for>`, and `for`
// resolves to the *first* matching element in the document. So every click in the Tools modal went
// to the settings modal's hidden input, and the Tools dialog — the only way to open a tool panel —
// became a dead switchboard in both applications.
//
// A per-element spec cannot catch that by construction, because the collision only exists when two
// elements share a document. Hence this file: mount everything that renders, in one document, the
// way a host does.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { stubTemplateFetch } from './helpers/template-fetch.mjs'

let configure
let _resetConfig

// A host with something in every namespace that produces rows, so the mount below renders the
// maximum number of ids rather than a set of empty states.
const HOST = {
  featureFlags: [
    { name: 'aiScenarioGeneration', kebab: 'ai-scenario-generation', label: 'AI scenarios' },
    { name: 'legacyAuditPanel', kebab: 'legacy-audit-panel', label: 'Legacy audit panel' },
  ],
  tools: [
    { id: 'inspect', label: 'Inspect', templateId: 'ttp-body-inspect' },
    { id: 'outcome-tracker', label: 'Outcome tracker', templateId: 'ttp-body-outcome-tracker' },
    { id: 'watchlist', label: 'Watchlist', templateId: 'ttp-body-watchlist' },
    {
      id: 'overrides',
      label: 'Overrides',
      templateId: 'ttp-body-overrides',
      facts: ['/overrideDate', '/taxYear'],
    },
  ],
  determinations: [
    {
      id: 'eligibility',
      label: 'Eligibility',
      rollupPath: '/isEligible',
      outcome: { kind: 'boolean', true: 'Eligible', false: 'Not eligible' },
      sections: [{ heading: 'Income', facts: ['/agi', '/earnedIncome'] }],
    },
    {
      id: 'credit',
      label: 'Credit',
      rollupPath: '/creditAmount',
      outcome: { kind: 'signed', positive: 'Refund of {abs}', negative: 'Balance due of {abs}' },
      sections: [{ heading: 'Amounts', facts: ['/creditAmount'] }],
    },
  ],
}

// Every element in the package that renders controls into the light DOM. The two modals that
// collided are the point, but the others are here so the next one to grow a row per tool is caught
// on the day it is written rather than in a screenshot.
const ELEMENTS = [
  'taxpert-workspace-settings-modal',
  'taxpert-tools-modal',
  'taxpert-display-modal',
  'taxpert-scenario-modal',
  'taxpert-overrides',
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
  await import('../src/audit-panel/js/display-modal.js')
  await import('../src/audit-panel/js/scenario-modal.js')
  await import('../src/tool-panels/js/taxpert-tools-modal.js')
  await import('../src/tool-panels/js/taxpert-overrides.js')
  ;({ configure, _resetConfig } = await import('../src/shared/js/config.js'))
})

beforeEach(() => {
  localStorage.clear()
  document.body.className = ''
  document.body.innerHTML = ''
  _resetConfig()
  configure(HOST)
})

// One document, every element — a host page, not five isolated ones.
async function mountAll () {
  const mounted = []
  for (const name of ELEMENTS) {
    const element = document.createElement(name)
    document.body.appendChild(element)
    mounted.push(element)
  }
  await Promise.all(mounted.map((element) => element.ready))
  return mounted
}

test('no two elements on the page claim the same id', async () => {
  await mountAll()

  const seen = new Map()
  const duplicates = []
  for (const node of document.querySelectorAll('[id]')) {
    const owner = node.closest(ELEMENTS.join(','))?.localName ?? 'document'
    if (seen.has(node.id)) duplicates.push(`#${node.id} — ${seen.get(node.id)} and ${owner}`)
    else seen.set(node.id, owner)
  }

  assert.deepEqual(duplicates, [], `duplicate ids:\n  ${duplicates.join('\n  ')}`)
})

// The consequence, stated directly. A label whose `for` leaves its own element is the failure the
// user saw, and it is worth asserting in its own right: the id check above could be satisfied by
// two elements that are unique but still cross-wired.
test('every label drives a control inside its own element', async () => {
  const mounted = await mountAll()

  const strays = []
  for (const element of mounted) {
    for (const label of element.querySelectorAll('label[for]')) {
      const target = document.getElementById(label.htmlFor)
      if (!target) strays.push(`${element.localName}: for="${label.htmlFor}" matches nothing`)
      else if (!element.contains(target)) {
        strays.push(`${element.localName}: for="${label.htmlFor}" reaches into ${
          target.closest(ELEMENTS.join(','))?.localName ?? 'the document'
        }`)
      }
    }
  }

  assert.deepEqual(strays, [], `cross-wired labels:\n  ${strays.join('\n  ')}`)
})

// The specific pairing that broke, pinned by name so a rename that drops a prefix fails here with
// an error that says what it means rather than as a count of duplicates.
test('the tool rows in the two modals are separately addressable', async () => {
  await mountAll()

  assert.ok(document.getElementById('ttm-tool-inspect'), 'Tools modal row')
  assert.ok(document.getElementById('twsm-tool-inspect'), 'Workspace settings row')

  // And ticking one leaves the other alone — the behaviour the shared id destroyed.
  const inModal = document.getElementById('ttm-tool-inspect')
  inModal.checked = true
  inModal.dispatchEvent(new window.Event('change'))
  assert.equal(document.getElementById('twsm-tool-inspect').checked, true, 'still enabled')
})
