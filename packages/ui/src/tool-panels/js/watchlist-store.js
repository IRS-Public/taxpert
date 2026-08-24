// The Watchlist's state: which facts the user has pinned, in the order they pinned them.
//
// Same split as tool-layout.js: this module owns the value and its persistence, and
// <taxpert-watchlist> is a view over it. Every mutator dispatches WATCHLIST_CHANGE_EVENT on
// `document`, so a second watchlist panel (or a host that adds a fact from its own UI) stays in
// step without either surface knowing about the other.
//
// Persistence is sessionStorage, not localStorage like the tool *layout*: a pinned fact belongs to
// the scenario you are working through, the way audit-panel/js/storage.js scopes its trackedFacts,
// whereas a panel arrangement is something you set up once and keep.
//
// An entry is { path, collectionId }: the abstract path, which may carry a `*` wildcard, and the
// collection item id that resolves it, '' for a plain fact. The pair is the identity: the same
// abstract path pinned for two household members is two entries.

import { makeCollectionIdPath } from '../../shared/js/collection-utils.js'
import { storageKey } from '../../shared/js/storage-keys.js'

export const WATCHLIST_CHANGE_EVENT = 'taxpert:watchlist-changed'

// storageKey('watchlist') is called at each read and write, never captured in a module-scope const:
// this module is imported before the host calls configure(), so a captured key would pin the
// default 'taxpert:' prefix forever and the host's namespace would silently never take effect.
//
// A host that adopts a storagePrefix therefore loses its pinned facts once, on the next load. That
// is accepted. Re-pinning a fact takes a second, and migration code for it would outlive its
// usefulness by years.

let entries = null

/** The identity of an entry, and the key rows are reconciled by. */
export function watchKey (path, collectionId) {
  return `${path}#${collectionId ?? ''}`
}

/** The concrete fact-graph path an entry points at. */
export function watchPath (entry) {
  return entry.collectionId
    ? makeCollectionIdPath(entry.path, entry.collectionId)
    : entry.path
}

// Anything unrecognised is dropped rather than trusted, the stored value outliving the fact
// dictionary, so a renamed path must not come back as a row that can never resolve.
function revive (raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const revived = []
  for (const item of raw) {
    if (!item || typeof item.path !== 'string' || !item.path) continue
    const collectionId = typeof item.collectionId === 'string' ? item.collectionId : ''
    const key = watchKey(item.path, collectionId)
    if (seen.has(key)) continue
    seen.add(key)
    revived.push({ path: item.path, collectionId })
  }
  return revived
}

function load () {
  if (entries) return entries
  try {
    entries = revive(JSON.parse(sessionStorage.getItem(storageKey('watchlist')) ?? 'null'))
  } catch {
    entries = []
  }
  return entries
}

function commit () {
  try {
    sessionStorage.setItem(storageKey('watchlist'), JSON.stringify(entries))
  } catch { /* storage unavailable */ }
  document.dispatchEvent(new CustomEvent(WATCHLIST_CHANGE_EVENT, { detail: getWatchlist() }))
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Every pinned fact, oldest first. A copy: callers can't mutate the stored list through it. */
export function getWatchlist () {
  return load().map((entry) => ({ ...entry }))
}

export function isWatched (path, collectionId = '') {
  const key = watchKey(path, collectionId)
  return load().some((entry) => watchKey(entry.path, entry.collectionId) === key)
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Pin a fact. Returns false if it was already pinned, which tells the caller to point at
 * the existing row rather than report an addition.
 * @param {string} path abstract fact path, `*` wildcard and all
 * @param {string} [collectionId] collection item id resolving that wildcard, '' for a plain fact
 * @returns {boolean} whether it was added
 */
export function addToWatchlist (path, collectionId = '') {
  if (!path || isWatched(path, collectionId)) return false
  load().push({ path, collectionId })
  commit()
  return true
}

export function removeFromWatchlist (path, collectionId = '') {
  const key = watchKey(path, collectionId)
  const value = load()
  const at = value.findIndex((entry) => watchKey(entry.path, entry.collectionId) === key)
  if (at === -1) return false
  value.splice(at, 1)
  commit()
  return true
}

export function clearWatchlist () {
  if (!load().length) return
  entries = []
  commit()
}

/** Drop the in-memory cache so the next read re-parses storage. For tests. */
export function _resetWatchlist () {
  entries = null
}
