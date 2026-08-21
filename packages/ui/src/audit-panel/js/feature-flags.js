// Runtime feature-flag management, read/written by <taxpert-workspace-settings-modal> — the one
// UI (behind the global nav's settings gear) that toggles these anywhere.
//
// Build-time flags (credit-assistant's --aiScenarioGeneration etc.) set the initial default,
// carried by an attribute on the panel element (e.g. `ai-scenario-generation-default`). Runtime
// overrides are stored in localStorage under FEATURE_FLAGS_KEY so they persist across page loads
// without a rebuild. Which flags exist at all is the host's, via config.featureFlags — see flags().
//
// Effective value: localStorage override → build-time attribute default.
//
// DOM convention:
//   • Anything gated by a flag carries data-ff="<kebab flag name>" — rail tab <li>s, the AI
//     scenario-generation section, the chat block. It is always rendered; panel-shell.css hides
//     it unless <body> carries the matching `ff-<flag>` class, which applyFlags() sets. One class
//     in one place, rather than a JS fan-out reaching into each surface separately.
//
// Cross-app reactivity: setFlag() dispatches FLAG_CHANGE_EVENT on `document` so a consumer that
// keeps its own read-side state (e.g. fact-explorer's useFeatureFlags hook, which can't reach
// into this module directly — see its CLAUDE.md) can resync without polling. The event name and
// the storage key are shared with fact-explorer by convention/naming, the same way the
// build-time defaults are — not by importing this module, since a Vite app's build defaults come
// from env vars, not a DOM attribute.

import { getConfig } from '../../shared/js/config.js'
import { storageKey } from '../../shared/js/storage-keys.js'

export const FLAG_CHANGE_EVENT = 'taxpert:feature-flags-changed'

/**
 * Where the runtime overrides live.
 *
 * A function, not the const it used to be, and invoked at each read and write: this module is
 * imported before the host calls configure(), so a captured key would pin the default prefix and a
 * host's own namespace would silently never take effect.
 *
 * This is the one key that must NOT move for the apps that exist today. It was the literal
 * 'taxpert:featureFlags', and credit-assistant and fact-explorer both configure
 * `storagePrefix: 'taxpert'`, so both keep resolving to exactly that string — which matters because
 * fact-explorer reads it by naming convention rather than by importing this module, and a
 * prefix change here would quietly decouple the two. A host that sets its own prefix gets its own
 * flag overrides, which is the point.
 */
const featureFlagsKey = () => storageKey('featureFlags')

/**
 * Every flag this host understands: `config.featureFlags`.
 *
 * One entry per flag: its camelCase `name` (the localStorage key, and what getFlag/setFlag take),
 * its `kebab` spelling (the `data-ff` value, the `ff-` body class, and the stem of both the panel's
 * build-default attribute and credit-assistant's `--<flag>` CLI switch), and its `label` — the
 * wording <taxpert-workspace-settings-modal> puts on the flag's row, which it builds from this list.
 *
 * A flag is a statement about a *host's* roadmap — credit-assistant's two AI features ship on their
 * own timelines and fact-explorer's build defaults come from Vite env vars, not a DOM attribute —
 * so the list is the host's and defaults to empty. What stays here is the machinery: the
 * localStorage override, the body class, and the event that tells read-side consumers to resync.
 *
 * A function rather than the const array it used to be, because it must be read late. See the
 * read-late note in config.js.
 */
export function flags () {
  return getConfig().featureFlags
}

// The panel attribute carrying a flag's build-time default, e.g. `ai-fact-explanation-default`.
const defaultAttr = (flag) => `${flag.kebab}-default`

// Overrides and defaults are kept as Maps (not plain objects) so flag lookups
// never go through a dynamic `obj[name]` computed member access.
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
 * Exported so <taxpert-scenario-modal>'s setAiScenarioGeneration() — the React adapter's entry
 * point, which drives the flag from fact-explorer's own state rather than from localStorage —
 * writes the same one place.
 */
export function setFlagClass (kebab, on) {
  document.body.classList.toggle(`ff-${kebab}`, Boolean(on))
}

// Apply the current flag state to the DOM. Every gated surface — the Explain rail tab, the chat
// section, AI scenario generation in the Manage scenario modal — carries data-ff and follows the
// body class, so all this has left to do is set one class per flag and collapse the rail.
//
// The rail collapses whenever it is not the thing being asked for — which is every host that does
// not declare LEGACY_RAIL_FLAG, plus one that declares it and has it switched off. It also covers
// the case of the panel parked on a section a flag has just hidden: closing is right there too.
//
// Closing rather than merely hiding matters because `body.audit-panel-open` shrinks the host's
// content area to make room for the panel — leaving it set would put a dead 38vw gutter down the
// side of a page with nothing in it.
//
// It was briefly unconditional, on the reasoning that the rail is hidden for good. It is not quite:
// panel-shell.css still reveals it under the flag, and force-closing it here made ticking that flag
// do nothing visible — the checkbox turned the rail's `display` back on and this immediately
// collapsed it to a rail with no open pane.
export const LEGACY_RAIL_FLAG = 'legacyAuditPanel'

export function applyFlags () {
  for (const flag of flags()) setFlagClass(flag.kebab, getFlag(flag.name))
  if (!getFlag(LEGACY_RAIL_FLAG)) document.querySelector('taxpert-audit-panel')?.closePanel()
}
