// Unit tests for the canonical makeCollectionIdPath helper. Pure function, no DOM needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { makeCollectionIdPath } from '../src/shared/js/collection-utils.js'

test('splices a concrete id in place of the * wildcard', () => {
  assert.equal(
    makeCollectionIdPath('/familyAndHousehold/*/firstName', 'abc'),
    '/familyAndHousehold/#abc/firstName'
  )
})

test('replaces only the first * (matching String.replace semantics)', () => {
  assert.equal(makeCollectionIdPath('/a/*/b/*/c', 'x'), '/a/#x/b/*/c')
})

test('is a no-op when there is no wildcard', () => {
  assert.equal(makeCollectionIdPath('/chosenTaxYear', 'x'), '/chosenTaxYear')
})
