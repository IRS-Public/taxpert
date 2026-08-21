// DOM-level tests for feature-flags.js, driven with jsdom.
//
// Which flags exist is the host's (config.featureFlags, empty by default), so this spec configures
// credit-assistant's two AI flags and then tests the machinery around them.
import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

let getFlag
let setFlag
let setFlagClass
let applyFlags
let flags
let FLAG_CHANGE_EVENT
let configure
let _resetConfig

const AI_FLAGS = [
  { name: 'aiScenarioGeneration', kebab: 'ai-scenario-generation' },
  { name: 'aiFactExplanation', kebab: 'ai-fact-explanation' },
]

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.CustomEvent = dom.window.CustomEvent
  globalThis.localStorage = dom.window.localStorage
  ;({ configure, _resetConfig } = await import('../src/shared/js/config.js'))
  ;({ getFlag, setFlag, setFlagClass, applyFlags, flags, FLAG_CHANGE_EVENT } = await import(
    '../src/audit-panel/js/feature-flags.js'
  ))
})

after(() => _resetConfig())

beforeEach(() => {
  localStorage.clear()
  document.body.className = ''
  document.body.replaceChildren()
  _resetConfig()
  configure({ featureFlags: AI_FLAGS })
})

test('getFlag defaults to false with no override and no build-time attribute', () => {
  assert.equal(getFlag('aiScenarioGeneration'), false)
  assert.equal(getFlag('aiFactExplanation'), false)
})

test('setFlag persists an override that getFlag then reflects', () => {
  setFlag('aiFactExplanation', true)
  assert.equal(getFlag('aiFactExplanation'), true)
  setFlag('aiFactExplanation', false)
  assert.equal(getFlag('aiFactExplanation'), false)
})

// The two AI features are separately flagged, so one must not carry the other.
test('the AI flags are independent of each other', () => {
  setFlag('aiScenarioGeneration', true)
  assert.equal(getFlag('aiScenarioGeneration'), true)
  assert.equal(getFlag('aiFactExplanation'), false, 'explanation stays off')

  setFlag('aiFactExplanation', true)
  setFlag('aiScenarioGeneration', false)
  assert.equal(getFlag('aiFactExplanation'), true, 'explanation is unaffected by the other')
})

test('setFlag dispatches FLAG_CHANGE_EVENT with the flag name and coerced boolean value', () => {
  const seen = []
  document.addEventListener(FLAG_CHANGE_EVENT, (e) => seen.push(e.detail))
  setFlag('aiScenarioGeneration', 'truthy-string')
  assert.deepEqual(seen, [{ name: 'aiScenarioGeneration', value: true }])
})

// applyFlags() is the one function here that touches the DOM. Every gated surface carries
// data-ff="<flag>" and follows a body class, so what it has to do is set that class — and make
// sure the panel isn't left parked on a section the flag just hid.

test('applyFlags puts each flag’s state on <body>, which is what the [data-ff] rules key off', () => {
  applyFlags()
  assert.equal(document.body.classList.contains('ff-ai-scenario-generation'), false)
  assert.equal(document.body.classList.contains('ff-ai-fact-explanation'), false)

  // One flag on: only its own class lands, so the other feature stays hidden.
  setFlag('aiScenarioGeneration', true)
  applyFlags()
  assert.equal(document.body.classList.contains('ff-ai-scenario-generation'), true)
  assert.equal(document.body.classList.contains('ff-ai-fact-explanation'), false)

  setFlag('aiFactExplanation', true)
  setFlag('aiScenarioGeneration', false)
  applyFlags()
  assert.equal(document.body.classList.contains('ff-ai-scenario-generation'), false)
  assert.equal(document.body.classList.contains('ff-ai-fact-explanation'), true)
})

test('setFlagClass writes the same class, so setAiScenarioGeneration and applyFlags agree', () => {
  setFlagClass('ai-scenario-generation', true)
  assert.equal(document.body.classList.contains('ff-ai-scenario-generation'), true)
  setFlagClass('ai-scenario-generation', false)
  assert.equal(document.body.classList.contains('ff-ai-scenario-generation'), false)
})

// The tool panels replaced the rail, so for a host that has not asked for it back applyFlags closes
// it whatever section it was parked on. Closing rather than hiding is the point:
// `body.audit-panel-open` shrinks the host's content area for a panel that isn't there.
test('applyFlags closes the rail, whichever section the panel was parked on', () => {
  for (const tab of ['chat-explain', 'fact-graph']) {
    const panel = document.createElement('taxpert-audit-panel')
    let closed = false
    panel.closePanel = () => {
      closed = true
    }
    panel.dataset.activeTab = tab
    document.body.appendChild(panel)
    document.body.classList.add('audit-panel-open')

    applyFlags()

    // Delegated to the panel rather than reproduced here, which is what the old three-line
    // open-state teardown in this function amounted to.
    assert.equal(closed, true, `parked on ${tab}, the panel was asked to close itself`)
    panel.remove()
  }
})

// A host that does not declare the legacy-rail flag gets nothing from it, even with a stale
// override sitting in localStorage from a host that did. Undeclared is undeclared.
test('an undeclared legacy-audit-panel flag sets no class, override or not', () => {
  setFlag('legacyAuditPanel', true)
  applyFlags()

  assert.equal(document.body.classList.contains('ff-legacy-audit-panel'), false)
  assert.deepEqual(flags().map((flag) => flag.name), ['aiScenarioGeneration', 'aiFactExplanation'])
})

// …and a host that *does* declare it gets a flag that moves something. Both halves are asserted
// because both were broken at once: the class is what panel-shell.css reveals the rail with, and
// the unconditional closePanel() collapsed it again in the same tick, so ticking the box in
// Workspace settings appeared to do nothing at all.
test('a declared legacy-audit-panel flag reveals the rail and stops force-closing it', () => {
  configure({
    featureFlags: [...AI_FLAGS, { name: 'legacyAuditPanel', kebab: 'legacy-audit-panel' }],
  })
  const panel = document.createElement('taxpert-audit-panel')
  let closed = false
  panel.closePanel = () => {
    closed = true
  }
  document.body.appendChild(panel)

  setFlag('legacyAuditPanel', true)
  applyFlags()
  assert.equal(document.body.classList.contains('ff-legacy-audit-panel'), true)
  assert.equal(closed, false, 'the rail was asked for, so nothing should collapse it')

  setFlag('legacyAuditPanel', false)
  applyFlags()
  assert.equal(document.body.classList.contains('ff-legacy-audit-panel'), false)
  assert.equal(closed, true)

  panel.remove()
})

test('each build-time default comes off its own panel attribute, and an override beats it', () => {
  const panel = document.createElement('taxpert-audit-panel')
  panel.setAttribute('ai-scenario-generation-default', 'true')
  document.body.appendChild(panel)

  assert.equal(getFlag('aiScenarioGeneration'), true, 'the build default is on')
  assert.equal(getFlag('aiFactExplanation'), false, 'the other flag has its own attribute')

  setFlag('aiScenarioGeneration', false)
  assert.equal(
    getFlag('aiScenarioGeneration'), false, 'a runtime override wins over the build default'
  )
})

// A host that names no flags gets none: nothing is offered, nothing is classed, and a leftover
// override in localStorage stays inert rather than gating a surface this host never had.
test('with no flags configured, applyFlags writes nothing', () => {
  _resetConfig()
  setFlag('aiScenarioGeneration', true)
  applyFlags()

  assert.deepEqual(flags(), [])
  assert.equal(document.body.classList.contains('ff-ai-scenario-generation'), false)
})
