// outcome-kinds.js — a determination's rollup spoken from data rather than from a function.
//
// The round-trip block at the bottom is the one that matters: every determination the two hosts
// ship today, expressed as a descriptor, must say exactly what its old function said. That is the
// proof that making `outcome` declarative changed nothing a user can see.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveOutcome, outcomeText, OUTCOME_KINDS } from '../src/shared/js/outcome-kinds.js'

const speak = (outcome) => (raw, value) => outcomeText(outcome, raw, value)

test('a function passes straight through', () => {
  const fn = (raw, value) => `${raw}/${value}`
  assert.equal(resolveOutcome(fn), fn)
})

test('nothing at all resolves to null, which callers read as “show the formatted value”', () => {
  assert.equal(resolveOutcome(undefined), null)
  assert.equal(resolveOutcome(null), null)
  assert.equal(outcomeText(undefined, true, '$5'), '$5')
})

test('every kind in the registry resolves', () => {
  for (const kind of OUTCOME_KINDS) {
    assert.equal(typeof resolveOutcome({ kind }), 'function', kind)
  }
})

test('an unknown kind degrades to the formatted value rather than blanking the row', () => {
  assert.equal(resolveOutcome({ kind: 'nope' }), null)
  assert.equal(outcomeText({ kind: 'nope' }, true, '$5'), '$5')
})

// ── boolean ──────────────────────────────────────────────────────────────────

test('boolean speaks each side, strictly on `=== true`', () => {
  const say = speak({ kind: 'boolean', true: 'At risk', false: 'Not at risk' })
  assert.equal(say(true, 'true'), 'At risk')
  assert.equal(say(false, 'false'), 'Not at risk')
  // Anything that is not exactly `true` takes the false branch — the hosts' own rule.
  assert.equal(say('true', 'true'), 'Not at risk')
})

test('boolean falls back to the formatted value when a side is missing', () => {
  assert.equal(speak({ kind: 'boolean', true: 'Yes' })(false, 'false'), 'false')
})

// ── map ──────────────────────────────────────────────────────────────────────

test('map looks an enum option up, and falls through when it has no entry', () => {
  const say = speak({ kind: 'map', values: { single: 'Single', headOfHousehold: 'Head of household' } })
  assert.equal(say('single', 'single'), 'Single')
  // An option the dictionary grows later shows as itself rather than being swallowed.
  assert.equal(say('qualifiedSurvivingSpouse', 'qualifiedSurvivingSpouse'), 'qualifiedSurvivingSpouse')
})

test('map is not fooled by inherited object keys', () => {
  const say = speak({ kind: 'map', values: {} })
  assert.equal(say('toString', 'toString'), 'toString')
  assert.equal(say('constructor', 'constructor'), 'constructor')
})

// ── signed ───────────────────────────────────────────────────────────────────

const SIGNED = {
  kind: 'signed',
  positive: 'Balance due of {abs}',
  negative: 'Refund of {abs}',
  zero: 'On target',
}

test('signed picks a direction and strips the sign from the amount', () => {
  const say = speak(SIGNED)
  assert.equal(say('1240.00', '$1,240'), 'Balance due of $1,240')
  assert.equal(say('-1240.00', '-$1,240'), 'Refund of $1,240')
  assert.equal(say('0.00', '$0'), 'On target')
})

test('signed accepts a raw number as readily as a stringified decimal', () => {
  assert.equal(speak(SIGNED)(85.5, '$85.50'), 'Balance due of $85.50')
})

test('signed falls back to the formatted value for a non-numeric raw', () => {
  const say = speak(SIGNED)
  assert.equal(say(null, '—'), '—')
  assert.equal(say('n/a', 'n/a'), 'n/a')
})

test('a locale may put {abs} anywhere in its template', () => {
  assert.equal(
    speak({ kind: 'signed', positive: '{abs} adeudados', negative: '', zero: '' })(12, '$12'),
    '$12 adeudados'
  )
})

// ── value ────────────────────────────────────────────────────────────────────

test('value is the formatted fact and nothing else', () => {
  assert.equal(speak({ kind: 'value' })('anything', '$1,240'), '$1,240')
})

// ── round trip: every determination that ships today ─────────────────────────
//
// Left column is the function each host had before the descriptors; right column is the descriptor
// that replaced it. Same inputs, same words, or phase 0 broke something visible.

const ROUND_TRIP = [
  {
    name: 'credit-assistant · filing status (map over the enum)',
    before: (raw, value) =>
      new Map([['single', 'Single'], ['headOfHousehold', 'Head of household']]).get(String(raw)) ??
      value,
    after: { kind: 'map', values: { single: 'Single', headOfHousehold: 'Head of household' } },
    cases: [['single', 'single'], ['headOfHousehold', 'headOfHousehold'], ['somethingNew', 'somethingNew']],
  },
  {
    name: 'credit-assistant · without-qualifying-child (inverted boolean)',
    before: (raw) => (raw === true ? 'No' : 'Yes'),
    after: { kind: 'boolean', true: 'No', false: 'Yes' },
    cases: [[true, 'true'], [false, 'false']],
  },
  {
    name: 'credit-assistant · qualifying-child (inverted boolean)',
    before: (raw) => (raw === true ? 'Not qualified' : 'Qualified'),
    after: { kind: 'boolean', true: 'Not qualified', false: 'Qualified' },
    cases: [[true, 'true'], [false, 'false']],
  },
  {
    name: 'tax-withholding-estimator · withholding outcome (dollar)',
    before: (raw, value) => {
      const gap = raw === null || raw === undefined ? null : Number(String(raw))
      if (gap === null || !Number.isFinite(gap)) return value
      if (gap === 0) return 'On target'
      const amount = String(value).replace(/^-/, '')
      return `${gap > 0 ? 'Balance due of' : 'Refund of'} ${amount}`
    },
    after: SIGNED,
    cases: [['1240.00', '$1240'], ['-1240.00', '-$1240'], ['0.00', '$0'], [null, '—']],
  },
  {
    name: 'tax-withholding-estimator · underpayment risk (boolean)',
    before: (raw) => (raw === true ? 'At risk' : 'Not at risk'),
    after: { kind: 'boolean', true: 'At risk', false: 'Not at risk' },
    cases: [[true, 'true'], [false, 'false']],
  },
  {
    name: 'tax-withholding-estimator · adjustment headroom (boolean)',
    before: (raw) => (raw === true ? 'Yes' : 'No — estimated payments only'),
    after: { kind: 'boolean', true: 'Yes', false: 'No — estimated payments only' },
    cases: [[true, 'true'], [false, 'false']],
  },
]

for (const { name, before, after, cases } of ROUND_TRIP) {
  test(`round trip — ${name}`, () => {
    for (const [raw, value] of cases) {
      assert.equal(
        outcomeText(after, raw, value),
        before(raw, value),
        `raw=${JSON.stringify(raw)} value=${JSON.stringify(value)}`
      )
    }
  })
}
