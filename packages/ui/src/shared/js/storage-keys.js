// Namespacing for every storage key the workspace writes.
//
// The keys were global before this existed, which is fine while exactly one Form Builder app is
// served per origin. It stops being fine when two are served together under one origin on different
// route prefixes: same localStorage, one shared watchlist full of the other application's facts.
//
// Adopting a storagePrefix loses the existing watchlist and panel layout once, on the next load.
// There is deliberately no migration. See ../../../../../docs/internals/workspace-configuration.md

import { getConfig } from './config.js'

/**
 * The namespaced key for `name`, which is the bare key a module wants ('watchlist', 'toolLayout',
 * 'display', 'auditPanel', 'allScreens', 'featureFlags') without a prefix.
 *
 * One key does not come through here. '<prefix>:configOverrides' cannot, because this function
 * reads the config that key helps build. See _overridesKey() in config.js.
 *
 * @param {string} name
 * @returns {string} e.g. 'taxpert:watchlist', or 'twe:watchlist' under a configured prefix
 */
export function storageKey (name) {
  const prefix = getConfig().app.storagePrefix || 'taxpert'
  return `${prefix}:${name}`
}
