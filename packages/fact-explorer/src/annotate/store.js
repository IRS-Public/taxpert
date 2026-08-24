// Annotations and layout persistence, framework-agnostic.
//
// One namespaced object in localStorage, mirroring the credit-assistant audit
// panel's getAuditPanelStorage/setAuditPanelStorage idiom (a single keyed JSON
// blob merged field-by-field), but in localStorage (durable) rather than the
// audit panel's sessionStorage (ephemeral), because notes are meant to survive
// reloads and be exported.
//
// Deliberately React-free (no useSyncExternalStore here) so it can be unit-tested
// under Node with a memory backend; the React bindings live in hooks.js.
//
// Shape: { version, annotations: { [nodeId]: {text,tag,updatedAt} }, layout: { [nodeId]: {x,y} } }
// Keys are FGM node ids (fact:/path, fs:fg-set:…), stable across slices.

const KEY = 'fact-explorer:v1'
const VERSION = 1

function memoryBackend() {
  let v = null
  return { getItem: () => v, setItem: (_k, val) => (v = val), removeItem: () => (v = null) }
}

let backend = typeof localStorage !== 'undefined' ? localStorage : memoryBackend()

const EMPTY = () => ({ version: VERSION, annotations: {}, layout: {} })

function migrate(s) {
  return {
    version: VERSION,
    annotations: s?.annotations && typeof s.annotations === 'object' ? s.annotations : {},
    layout: s?.layout && typeof s.layout === 'object' ? s.layout : {},
  }
}

function load() {
  try {
    const raw = backend.getItem(KEY)
    return raw ? migrate(JSON.parse(raw)) : EMPTY()
  } catch {
    return EMPTY()
  }
}

let cache = load()
const subs = new Set()

function commit(next) {
  cache = next
  try {
    backend.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* storage may be full or unavailable; keep the in-memory cache */
  }
  for (const fn of subs) fn()
}

/** Subscribe to any change; returns an unsubscribe fn (for useSyncExternalStore). */
export function subscribe(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}

/** Stable snapshot reference, changing only on commit, so useSyncExternalStore is safe. */
export function getSnapshot() {
  return cache
}

// ── annotations ────────────────────────────────────────────────────────
export function getAnnotation(id) {
  return cache.annotations[id] ?? null
}

export function setAnnotation(id, { text, tag } = {}) {
  const trimmed = (text ?? '').trim()
  const annotations = { ...cache.annotations }
  if (!trimmed && !tag) delete annotations[id]
  else annotations[id] = { text: trimmed, tag: tag ?? 'note', updatedAt: new Date().toISOString() }
  commit({ ...cache, annotations })
}

export function deleteAnnotation(id) {
  if (!cache.annotations[id]) return
  const annotations = { ...cache.annotations }
  delete annotations[id]
  commit({ ...cache, annotations })
}

// ── layout ─────────────────────────────────────────────────────────────
export function getLayout() {
  return cache.layout
}

export function setNodePosition(id, pos) {
  commit({ ...cache, layout: { ...cache.layout, [id]: { x: pos.x, y: pos.y } } })
}

export function clearLayout() {
  commit({ ...cache, layout: {} })
}

// ── export / import ────────────────────────────────────────────────────
export function exportObject() {
  return {
    app: 'fact-explorer',
    version: VERSION,
    exportedAt: new Date().toISOString(),
    annotations: cache.annotations,
    layout: cache.layout,
  }
}

/** Merge a previously-exported object back in (file wins per key). */
export function mergeImport(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Not a Fact Explorer export')
  commit({
    ...cache,
    annotations: { ...cache.annotations, ...(obj.annotations ?? {}) },
    layout: { ...cache.layout, ...(obj.layout ?? {}) },
  })
}

/** Test seam: swap the storage backend (e.g. a Node memory shim) and reload. */
export function __setBackend(b) {
  backend = b
  cache = load()
  for (const fn of subs) fn()
}
