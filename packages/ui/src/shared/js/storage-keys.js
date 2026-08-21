// Namespacing for every storage key the workspace writes.
//
// The workspace stores dev-tool state — the watchlist, the panel layout, display options, the audit
// panel's open/closed state, feature-flag overrides. Those keys were global ('taxpert:watchlist',
// 'auditPanel'), which is fine while exactly one Form Builder app exists per origin. It stops being fine
// the moment two Form Builder apps are served together under one origin, each on its own route prefix:
// same origin, same localStorage, one shared watchlist full of the other app's fact paths.
//
// storageKey() prefixes with `app.storagePrefix`, which defaults to 'taxpert' — so an unconfigured
// host keeps writing 'taxpert:watchlist' exactly as before, and only a host that sets a prefix
// moves.
//
// ── No migration ──────────────────────────────────────────────────────────────────────────────
//
// A host that adopts a storagePrefix loses its existing watchlist and panel layout once, on the
// next load. That is deliberate: all of it is dev-tool state that costs seconds to recreate, and
// migration code for it would outlive its usefulness by years. Call it out in the host's release
// note rather than writing the migration.

import { getConfig } from './config.js'

/**
 * The namespaced key for `name`.
 *
 * `name` is the bare key a module wants ('watchlist', 'toolLayout', 'display', 'auditPanel',
 * 'allScreens', 'featureFlags'), *without* a prefix — modules that spelled their key
 * 'taxpert:watchlist' pass 'watchlist' here.
 *
 * One key is prefixed without coming through here: '<prefix>:configOverrides'. It cannot, because
 * this function reads the config that key helps build. See _overridesKey() in config.js.
 *
 * @param {string} name
 * @returns {string} e.g. 'taxpert:watchlist', or 'twe:watchlist' under a configured prefix
 */
export function storageKey (name) {
  const prefix = getConfig().app.storagePrefix || 'taxpert'
  return `${prefix}:${name}`
}
