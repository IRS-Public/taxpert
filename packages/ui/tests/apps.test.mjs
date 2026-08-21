// apps.js — switching the workspace from one application to another.
//
// The invariant worth a test of its own is that a switch *keeps the destination*: Browse All in one
// application goes to Browse All in the next. Getting that wrong is not a crash, it is a quiet drop
// back to a home page, which is exactly the behaviour this replaced.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

let apps

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  apps = await import('../src/shared/js/apps.js')
})

// A fictional non-tax host, like tests/fixtures/host/ — no application in this repo may be named
// in this package, and a test is not an exemption.
const config = {
  current: 'pet-planner',
  items: [
    {
      id: 'pet-planner',
      label: 'Pet Planner',
      destinations: [
        { id: 'product-experience', label: 'Product Experience', href: '/app/pets/' },
        { id: 'browse-all', label: 'Browse All', href: '/app/pets/all-screens/' },
        { id: 'authoring-suite', label: 'Authoring Suite', href: '/app/pets/author/' },
      ],
    },
    {
      id: 'plant-planner',
      label: 'Plant Planner',
      destinations: [
        { id: 'product-experience', label: 'Product Experience', href: '/app/plants/' },
        { id: 'browse-all', label: 'Browse All', href: '/app/plants/all-screens/' },
      ],
    },
  ],
}

test('keeps the destination when the target has it', () => {
  const target = apps.switchTarget(config, 'plant-planner', 'browse-all')
  assert.equal(target.destination.href, '/app/plants/all-screens/')
})

test('falls back to the first destination when the target has no counterpart', () => {
  // The second application has no Authoring Suite. Landing on its product experience is right;
  // linking to an authoring URL it does not serve is a 404 with a workspace on top of it.
  const target = apps.switchTarget(config, 'plant-planner', 'authoring-suite')
  assert.equal(target.destination.href, '/app/plants/')
})

test('falls back to the first destination when nothing is active', () => {
  assert.equal(apps.switchTarget(config, 'plant-planner', null).destination.href, '/app/plants/')
})

test('is null for an unknown application, and for one with no destinations', () => {
  assert.equal(apps.switchTarget(config, 'nope', 'browse-all'), null)
  const bare = { current: 'a', items: [{ id: 'a' }, { id: 'b' }] }
  assert.equal(apps.switchTarget(bare, 'b', 'browse-all'), null)
})

test('currentApp resolves apps.current, and is null when it names nothing', () => {
  assert.equal(apps.currentApp(config).label, 'Pet Planner')
  assert.equal(apps.currentApp({ current: 'gone', items: config.items }), null)
})

test('one application is not a choice', () => {
  assert.equal(apps.hasAppChoice(config), true)
  assert.equal(apps.hasAppChoice({ current: 'a', items: [config.items[0]] }), false)
  assert.equal(apps.hasAppChoice(undefined), false)
})

test('items without an id are dropped rather than rendered as blank rows', () => {
  assert.equal(apps.appItems({ items: [{ id: 'a' }, {}, { id: '' }, null] }).length, 1)
})

test('activeDestination reads the mounted nav, and copes with there not being one', () => {
  assert.equal(apps.activeDestination(document), null)
  const nav = document.createElement('taxpert-global-nav')
  nav.setAttribute('active', 'path-mode')
  document.body.appendChild(nav)
  assert.equal(apps.activeDestination(document), 'path-mode')
  nav.remove()
})
