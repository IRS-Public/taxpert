// flow-dom.js — the host-markup descriptor. The defaults must reproduce the literals that were
// hardcoded across inspect-cues, path-cursor and display-options.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

let defaultFlowDom
let normalizeFlowDom
let isUncued
let dom

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  ;({ defaultFlowDom, normalizeFlowDom, isUncued } = await import('../src/shared/js/flow-dom.js'))
})

test('defaults reproduce credit-assistant’s markup exactly', () => {
  const flow = defaultFlowDom()
  assert.equal(flow.unitSelector, 'fg-set, fg-show')
  assert.equal(flow.questionTag, 'fg-set')
  assert.equal(flow.displayTag, 'fg-show')
  assert.equal(flow.alertTag, 'fg-alert')
  assert.equal(flow.collectionAddSelector, '.fg-collection__add-item')
  assert.equal(flow.pathAttr, 'path')
  assert.equal(flow.conditionAttr, 'condition')
  assert.equal(flow.operatorAttr, 'operator')
  assert.equal(flow.modalTag, 'dialog')
  assert.equal(flow.modalLinkSelector, 'modal-link')
  assert.equal(flow.modalLinkAttr, 'for')
  assert.equal(flow.titleSelector, '.twe-question, legend, label')
  assert.equal(flow.notTitleSelector, '.usa-hint')
})

// The one default that deliberately changed: /taxYear is an application fact, so it moved to the host.
test('uncuedPaths defaults to empty — /taxYear is the host’s to supply', () => {
  assert.deepEqual(defaultFlowDom().uncuedPaths, [])
})

test('each call returns a fresh object, so a host cannot corrupt the defaults', () => {
  const first = defaultFlowDom()
  first.uncuedPaths.push('/taxYear')
  assert.deepEqual(defaultFlowDom().uncuedPaths, [])
})

test('checkCondition defaults to true — nothing is conditioned out without a host evaluator', () => {
  assert.equal(defaultFlowDom().checkCondition('/x', 'isTrue'), true)
})

test('isHidden follows the .hidden convention and the hidden attribute', () => {
  const flow = defaultFlowDom()
  const el = document.createElement('div')
  document.body.append(el)
  // jsdom has no layout, so offsetParent is always null; the class and attribute are what this
  // asserts, and the layout fallback is exercised in the browser.
  el.classList.add('hidden')
  assert.equal(flow.isHidden(el), true)
  el.classList.remove('hidden')
  el.setAttribute('hidden', '')
  assert.equal(flow.isHidden(el), true)
  assert.equal(flow.isHidden(null), true)
})

test('isAnswered prefers the host element’s own answer', () => {
  const flow = defaultFlowDom()
  assert.equal(flow.isAnswered({ isAnswered: () => true }), true)
  assert.equal(flow.isAnswered({ isAnswered: () => false }), false)
  assert.equal(flow.isAnswered({ value: 'yes' }), true)
  assert.equal(flow.isAnswered({ value: '' }), false)
})

test('isAnswered falls back to reading form controls', () => {
  const flow = defaultFlowDom()
  const unit = document.createElement('fg-set')
  unit.innerHTML = '<input type="text" value="">'
  assert.equal(flow.isAnswered(unit), false)
  unit.querySelector('input').value = 'something'
  assert.equal(flow.isAnswered(unit), true)

  const radios = document.createElement('fg-set')
  radios.innerHTML = '<input type="radio"><input type="radio">'
  assert.equal(flow.isAnswered(radios), false)
  radios.querySelectorAll('input')[1].checked = true
  assert.equal(flow.isAnswered(radios), true)
})

test('normalizeFlowDom overrides only the keys a host names', () => {
  const flow = normalizeFlowDom({ questionTag: 'x-question', displayTag: 'x-display' })
  assert.equal(flow.questionTag, 'x-question')
  assert.equal(flow.displayTag, 'x-display')
  assert.equal(flow.pathAttr, 'path')
  assert.equal(typeof flow.isHidden, 'function')
})

test('normalizeFlowDom(undefined) is the defaults', () => {
  assert.equal(normalizeFlowDom().questionTag, 'fg-set')
})

test('isUncued applies to display units only, never to a question writing the same fact', () => {
  const flow = normalizeFlowDom({ uncuedPaths: ['/taxYear'] })

  const display = document.createElement('fg-show')
  display.setAttribute('path', '/taxYear')
  assert.equal(isUncued(flow, display), true)

  const question = document.createElement('fg-set')
  question.setAttribute('path', '/taxYear')
  assert.equal(isUncued(flow, question), false)

  const other = document.createElement('fg-show')
  other.setAttribute('path', '/income')
  assert.equal(isUncued(flow, other), false)
})

test('isUncued honours a host’s own display tag', () => {
  const flow = normalizeFlowDom({ displayTag: 'x-display', uncuedPaths: ['/year'] })
  const display = document.createElement('x-display')
  display.setAttribute('path', '/year')
  assert.equal(isUncued(flow, display), true)
})
