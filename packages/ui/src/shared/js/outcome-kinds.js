// How a determination's rollup fact is spoken — as data rather than as a function.
//
// A determination used to carry `outcome: (raw, value) => string`. Everything else about it — its
// label, its rollup path, its sections and their fact paths — was already JSON, so that one
// function was the only thing standing between `config.determinations` and a list a person could
// edit in the Workspace settings UI, ship in a `taxpert.config.json`, or paste between browsers.
//
// So `outcome` is now a *descriptor* over a closed registry of kinds:
//
//   { kind: 'boolean', true: 'At risk', false: 'Not at risk' }
//   { kind: 'map', values: { single: 'Single', headOfHousehold: 'Head of household' } }
//   { kind: 'signed', positive: 'Balance due of {abs}', negative: 'Refund of {abs}',
//                     zero: 'On target' }
//   { kind: 'value' }
//
// WHY THESE FOUR AND NO MORE. They cover every determination that exists today across both hosts:
// credit-assistant's filing-status enum (`map`) and its three inverted booleans, and the
// tax-withholding-estimator's dollar rollup (`signed`) and its two booleans. The registry is sized
// to what ships, not to what might — a fifth kind should be added the day a host needs it and can
// point at the determination that does.
//
// A FUNCTION IS STILL ACCEPTED, and passes through untouched. A host with a genuinely bespoke
// rollup keeps it; it simply cannot be edited from the UI or expressed in JSON, and the editor says
// so rather than silently dropping it.
//
// resolveOutcome() is in shared/ rather than in the Outcome tracker because two surfaces speak a
// rollup: the tracker's summary line and credit-assistant's eligibility dashboard badge. They read
// the same determination and must say the same words.

/** Every `kind` a descriptor may name. Anything else is invalid — see config-schema.js. */
export const OUTCOME_KINDS = ['boolean', 'map', 'signed', 'value']

/**
 * Set `key` on `target` without a computed member access.
 *
 * Every writer of a descriptor — this file's callers, and the Workspace settings editor — is
 * writing a key that came from typed-in data, so none of them may use `target[key] = value`.
 * Exported so there is one such helper rather than one per module.
 */
export function setDescriptorKey (target, key, value) {
  Object.defineProperty(target, key, {
    value, writable: true, enumerable: true, configurable: true,
  })
  return target
}

/** The token `signed`'s three templates may contain: the formatted value with its sign stripped. */
const ABS_TOKEN = '{abs}'

// `raw` is whatever the host's graph holds; `value` is the same fact already run through the
// tracker's formatter (a Dollar arrives as "$1,240" / "-$1,240", an enum as its option name).
// Every kind below may fall back to `value`, which is why it is passed to all of them.

function booleanOutcome (descriptor) {
  // Strictly `=== true`, matching the hosts' own `raw === true ? … : …`. A fact that is incomplete
  // never reaches here — the tracker only speaks a rollup once it has settled.
  return (raw, value) => {
    const spoken = raw === true ? descriptor.true : descriptor.false
    return spoken ?? value
  }
}

function mapOutcome (descriptor) {
  // Built once per resolve, and a Map rather than the plain object it came from: the lookup key is
  // a fact value, and `values[raw]` would be a computed member access on host data.
  const values = new Map(Object.entries(descriptor.values ?? {}))
  // A value the map has no entry for falls through to the graph's own formatting rather than being
  // swallowed — an enum option a dictionary grows later shows up as itself, not as blank.
  return (raw, value) => values.get(String(raw)) ?? value
}

function signedOutcome (descriptor) {
  return (raw, value) => {
    const amount = Number(String(raw))
    if (!Number.isFinite(amount)) return value
    if (amount === 0) return descriptor.zero ?? value

    const template = amount > 0 ? descriptor.positive : descriptor.negative
    if (!template) return value
    // The formatted value carries the sign as well as the magnitude, and the templates already say
    // which direction they mean ("Refund of …"), so a leading minus would say it twice.
    return template.replaceAll(ABS_TOKEN, String(value).replace(/^-/, ''))
  }
}

function valueOutcome () {
  return (raw, value) => value
}

const KINDS = new Map([
  ['boolean', booleanOutcome],
  ['map', mapOutcome],
  ['signed', signedOutcome],
  ['value', valueOutcome],
])

/**
 * The `(raw, value) => string` a determination's `outcome` means.
 *
 * @param {object|function|null|undefined} outcome a descriptor, a function, or nothing
 * @returns {((raw: *, value: string) => string)|null} null when there is nothing to say, which
 *   every caller reads as "show the rollup's own formatted value"
 */
export function resolveOutcome (outcome) {
  if (typeof outcome === 'function') return outcome
  if (!outcome || typeof outcome !== 'object') return null
  const build = KINDS.get(outcome.kind)
  // An unknown kind is a host error, and answering `null` degrades to the raw formatted value
  // rather than blanking the summary. config-schema.js is what refuses to store one.
  if (!build) {
    console.warn(`taxpert: unknown outcome kind "${outcome.kind}"`)
    return null
  }
  return build(outcome)
}

/**
 * What a determination says once its rollup has settled — the one line both the Outcome tracker and
 * credit-assistant's eligibility dashboard render, so neither has to remember the fallback.
 */
export function outcomeText (outcome, raw, value) {
  return resolveOutcome(outcome)?.(raw, value) ?? value
}
