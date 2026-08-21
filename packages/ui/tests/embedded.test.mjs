// Embedded mode: the class shared/styles/embedded.css keys the whole workspace chrome off, and the
// frame test behind it. jsdom gives each document a `window.top` that is its own window, so a
// top-level page is the default and a frame is simulated by handing applyEmbedded() a view whose
// self and top differ — which is exactly the shape the real check reads.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

let isEmbedded, applyEmbedded, EMBEDDED_CLASS

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/app/eitc/',
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  ;({ isEmbedded, applyEmbedded, EMBEDDED_CLASS } = await import('../src/shared/js/embedded.js'))
})

beforeEach(() => {
  document.documentElement.className = ''
})

/** A stand-in for the window a page sees: `self !== top` is what being in a frame looks like. */
const view = ({ framed = false, search = '' } = {}) => {
  const self = { location: { search } }
  return { ...self, self, top: framed ? {} : self }
}

test('a top-level page is not embedded', () => {
  assert.equal(isEmbedded(view()), false)
  assert.equal(applyEmbedded(document, view()), false)
  assert.equal(document.documentElement.classList.contains(EMBEDDED_CLASS), false)
})

test('a page inside another page’s frame is embedded', () => {
  assert.equal(isEmbedded(view({ framed: true })), true)
  assert.equal(applyEmbedded(document, view({ framed: true })), true)
  assert.equal(document.documentElement.classList.contains(EMBEDDED_CLASS), true)
})

test('?taxpert-embed forces either side, for a host that wants to say', () => {
  assert.equal(isEmbedded(view({ search: '?taxpert-embed=1' })), true)
  assert.equal(isEmbedded(view({ framed: true, search: '?taxpert-embed=0' })), false)
})

// The flow navigates: answering a question loads the next screen at a URL nobody added a parameter
// to. Frame-ness survives that, which is why it and not the parameter is the detection.
test('the class is re-applied per page, so it survives navigation inside the frame', () => {
  applyEmbedded(document, view({ framed: true }))
  assert.equal(document.documentElement.classList.contains(EMBEDDED_CLASS), true)
  // The next screen: a fresh document, no parameter anywhere, still in the frame.
  applyEmbedded(document, view({ framed: true, search: '' }))
  assert.equal(document.documentElement.classList.contains(EMBEDDED_CLASS), true)
})
