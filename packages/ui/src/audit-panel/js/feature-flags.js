// Runtime feature-flag management, read and written by <taxpert-workspace-settings-modal>, the one
// UI that toggles these anywhere.
//
// The effective value is the localStorage override, falling back to a build-time default carried
// as an attribute on the panel element. Which flags exist at all is the host's, via
// config.featureFlags.
//
// Anything gated by a flag carries data-ff="<kebab>". It is always rendered, and CSS hides it
// unless <body> carries the matching `ff-<kebab>` class, which applyFlags() sets. One class in one
// place, rather than a JS fan-out reaching into each surface separately.
//
// setFlag() dispatches FLAG_CHANGE_EVENT on `document`, so a consumer keeping its own read-side
// state can resync without polling. Fact Explorer matches the event name and the storage key by
// convention rather than by importing this module.
//
// See ../../../../../docs/internals/audit-panel.md

import { getConfig } from '../../shared/js/config.js'
import { storageKey } from '../../shared/js/storage-keys.js'

export const FLAG_CHANGE_EVENT = 'taxpert:feature-flags-changed'

/**
 * Where the runtime overrides live. Invoked at each read and write, never captured.
 *
 * THIS KEY MUST NOT MOVE for the hosts that exist today. credit-assistant and Fact Explorer both
 * configure `storagePrefix: 'taxpert'`, so both still resolve to the literal 'taxpert:featureFlags'.
 * Fact Explorer reads it by convention rather than by import, so a prefix change here would quietly
 * decouple the two.
 */
const featureFlagsKey = () => storageKey('featureFlags')

/**
 * Every flag this host understands. A flag is a statement about a host's roadmap, so the list is
 * the host's and defaults to empty. Read late, never captured.
 *
 * Each entry carries `name` (camelCase, the storage key and what getFlag/setFlag take), `kebab`
 * (the data-ff value, the body class, and the stem of the build-default attribute), and `label`.
 */
export function flags () {
  return getConfig().featureFlags
}

// The panel attribute carrying a flag's build-time default, e.g. `ai-fact-explanation-default`.
const defaultAttr = (flag) => `${flag.kebab}-default`

// Maps rather than plain objects, so a flag lookup is never a computed member access.
function _readOverrides () {
  try {
    const parsed = JSON.parse(localStorage.getItem(featureFlagsKey()) ?? '{}')
    return new Map(Object.entries(parsed))
  } catch {
    return new Map()
  }
}

function _writeOverrides (overrides) {
  try {
    localStorage.setItem(featureFlagsKey(), JSON.stringify(Object.fromEntries(overrides)))
  } catch { /* storage unavailable */ }
}

// Build-time defaults: read from the panel element's attributes.
function _buildDefaults () {
  const panel = document.querySelector('taxpert-audit-panel')
  return new Map(flags().map((flag) => [flag.name, panel?.getAttribute(defaultAttr(flag)) === 'true']))
}

export function getFlag (name) {
  const overrides = _readOverrides()
  const defaults = _buildDefaults()
  return overrides.has(name) ? overrides.get(name) : (defaults.get(name) ?? false)
}

export function setFlag (name, value) {
  const overrides = _readOverrides()
  const next = Boolean(value)
  overrides.set(name, next)
  _writeOverrides(overrides)
  document.dispatchEvent(new CustomEvent(FLAG_CHANGE_EVENT, { detail: { name, value: next } }))
}

/**
 * Set the body class one flag's `[data-ff]` surfaces key off. Takes the flag's *kebab* spelling.
 * Exported so <taxpert-scenario-modal>'s setAiScenarioGeneration(), the React adapter's entry
 * point that drives the flag from fact-explorer's own state rather than from localStorage,
 * writes the same one place.
 */
export function setFlagClass (kebab, on) {
  document.body.classList.toggle(`ff-${kebab}`, Boolean(on))
}

// Apply the current flag state to the DOM. Every gated surface carries data-ff and follows the
// body class, so all this has left to do is set one class per flag and collapse the rail.
//
// The rail collapses whenever it is not the thing being asked for, which is every host that does
// not declare LEGACY_RAIL_FLAG plus one that declares it and has it off. Closing rather than merely
// hiding matters because `body.audit-panel-open` shrinks the host's content area, so leaving it set
// would put a dead gutter down the side of a page with nothing in it.
//
// Conditional rather than unconditional: panel-shell.css still reveals the rail under the flag, and
// force-closing here made ticking that flag do nothing visible.
export const LEGACY_RAIL_FLAG = 'legacyAuditPanel'

export function applyFlags () {
  for (const flag of flags()) setFlagClass(flag.kebab, getFlag(flag.name))
  if (!getFlag(LEGACY_RAIL_FLAG)) document.querySelector('taxpert-audit-panel')?.closePanel()
}
