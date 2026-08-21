// config-schema.js — the gate a *stored* config goes through, so a bad override is refused whole
// rather than half-applied.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig } from '../src/shared/js/config-schema.js'

const DETERMINATION = {
  id: 'underpayment-risk',
  label: 'Underpayment penalty risk',
  rollupPath: '/mayBeSubjectToUnderpaymentPenalty',
  outcome: { kind: 'boolean', true: 'At risk', false: 'Not at risk' },
  sections: [{ heading: 'Penalty thresholds', facts: ['/totalTax'] }],
}

const ok = (partial, options) => validateConfig(partial, options).ok
const errors = (partial, options) => validateConfig(partial, options).errors

test('a real host config passes', () => {
  assert.equal(
    ok({
      app: { id: 'twe', brand: 'Tax Withholding Estimator', storagePrefix: 'twe' },
      nav: {
        menu: [{
          id: 'experience-explorer',
          label: 'Experience Explorer',
          children: [
            { id: 'product-experience', label: 'Product Experience', href: '/app/twe/' }]
        }],
        toolsByDestination: [{ id: 'display', label: 'Display', destinations: ['product-experience'] }],
      },
      endpoints: { factDictionaryUrl: '/app/twe/resources/fact-dictionary.xml' },
      featureFlags: [{ name: 'legacyAuditPanel', kebab: 'legacy-audit-panel', label: 'Legacy panel' }],
      determinations: [DETERMINATION],
      strings: {},
    }),
    true
  )
})

test('a non-object is refused', () => {
  assert.equal(ok(null), false)
  assert.equal(ok([DETERMINATION]), false)
})

test('an unknown namespace is refused rather than silently ignored', () => {
  // configure() ignores unknown keys, which is right for trusted code. A *stored* config with a
  // stale key is a typo someone should see.
  assert.deepEqual(errors({ determinatons: [] }), ['unknown namespace "determinatons"'])
})

test('graph cannot be stored — it is code', () => {
  assert.match(errors({ graph: {} })[0], /cannot be stored/)
  // …but a host validating what it passed to configure() directly may carry it.
  assert.equal(ok({ graph: {} }, { allowCodeOnly: true }), true)
})

// ── determinations ───────────────────────────────────────────────────────────

test('a determination must name itself, its rollup and its sections', () => {
  const found = errors({ determinations: [{ sections: [{ facts: [] }] }] })
  assert.ok(found.some((e) => e.includes('[0].id')))
  assert.ok(found.some((e) => e.includes('[0].label')))
  assert.ok(found.some((e) => e.includes('[0].rollupPath')))
  assert.ok(found.some((e) => e.includes('sections[0].heading')))
})

test('fact paths must be strings', () => {
  const found = errors({
    determinations: [{ ...DETERMINATION, sections: [{ heading: 'H', facts: ['/a', 7] }] }],
  })
  assert.ok(found.some((e) => e.includes('facts must all be fact paths')))
})

test('an outcome kind outside the registry is refused, and the error names the registry', () => {
  const found = errors({ determinations: [{ ...DETERMINATION, outcome: { kind: 'colour' } }] })
  assert.match(found[0], /kind must be one of: boolean, map, signed, value/)
})

test('an absent outcome is fine — the rollup speaks for itself', () => {
  const { outcome, ...withoutOutcome } = DETERMINATION
  assert.equal(ok({ determinations: [withoutOutcome] }), true)
})

// The one that motivates the whole check: exporting a config whose outcome is a function would
// otherwise write `"outcome": undefined` and silently change what the determination says.
test('a function outcome cannot be stored, and says so', () => {
  const found = errors({ determinations: [{ ...DETERMINATION, outcome: () => 'x' }] })
  assert.match(found[0], /is a function, which cannot be stored — use a descriptor/)
})

// ── tools / flags / nav ──────────────────────────────────────────────────────

test('a tool without a templateId is refused — its panel would open empty', () => {
  const found = errors({ tools: [{ id: 'inspect', label: 'Inspect' }] })
  assert.match(found[0], /templateId/)
})

test('a feature flag needs both spellings of its name', () => {
  const found = errors({ featureFlags: [{ name: 'aiFactExplanation' }] })
  assert.match(found[0], /kebab/)
})

test('menu groups are checked to the same depth as leaves', () => {
  const found = errors({
    nav: { menu: [{ id: 'group', label: 'Group', children: [{ label: 'no id' }] }] },
  })
  assert.ok(found.some((e) => e.includes('nav.menu[0].children[0].id')))
})

test('every problem is reported, not just the first', () => {
  const found = errors({ tools: 'nope', featureFlags: 'nope', determinations: 'nope' })
  assert.equal(found.length, 3)
})
