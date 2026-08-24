// How a determination's rollup fact is spoken, as a JSON descriptor rather than a function, so a
// determination can be edited in Workspace settings, shipped in a taxpert.config.json, or pasted
// between browsers. A function is still accepted and passes through untouched, but cannot be
// stored or edited.
//
// This lives in shared/ because two surfaces speak a rollup and have to say the same words.
//
// See ../../../../../docs/internals/workspace-configuration.md

/** Every `kind` a descriptor may name. config-schema.js refuses to store any other. */
export const OUTCOME_KINDS = ['boolean', 'map', 'signed', 'value']

/**
 * Set `key` on `target` without a computed member access. Descriptor keys come from typed-in data,
 * so every writer of one goes through this rather than `target[key] = value`.
 */
export function setDescriptorKey (target, key, value) {
  Object.defineProperty(target, key, {
    value, writable: true, enumerable: true, configurable: true,
  })
  return target
}

/** The token `signed`'s three templates may contain: the formatted value with its sign stripped. */
const ABS_TOKEN = '{abs}'

// Throughout: `raw` is whatever the host's graph holds, and `value` is the same fact already run
// through the tracker's formatter, so a Dollar arrives as "$1,240" and an enum as its option name.
// Every kind may fall back to `value`, which is why all of them receive it.

function booleanOutcome (descriptor) {
  // Strictly `=== true`. An incomplete fact never reaches here; the tracker waits for it to settle.
  return (raw, value) => {
    const spoken = raw === true ? descriptor.true : descriptor.false
    return spoken ?? value
  }
}

function mapOutcome (descriptor) {
  // A Map rather than the plain object it came from: the lookup key is host data.
  const values = new Map(Object.entries(descriptor.values ?? {}))
  // An unmapped value falls through to the graph's own formatting rather than rendering blank.
  return (raw, value) => values.get(String(raw)) ?? value
}

function signedOutcome (descriptor) {
  return (raw, value) => {
    const amount = Number(String(raw))
    if (!Number.isFinite(amount)) return value
    if (amount === 0) return descriptor.zero ?? value

    const template = amount > 0 ? descriptor.positive : descriptor.negative
    if (!template) return value
    // The templates already name the direction ("Refund of ..."), and the formatted value carries
    // the sign, so a leading minus would say it twice.
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
  if (!build) {
    console.warn(`taxpert: unknown outcome kind "${outcome.kind}"`)
    return null
  }
  return build(outcome)
}

/** What a determination says once its rollup has settled, with the fallback applied. */
export function outcomeText (outcome, raw, value) {
  return resolveOutcome(outcome)?.(raw, value) ?? value
}
