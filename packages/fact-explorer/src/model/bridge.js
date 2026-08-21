// Live shared-state bridge (N6).
//
// The canonical contract between Fact Explorer and a running Form Builder app is the flow runtime's
// serialized-graph sessionStorage key plus a BroadcastChannel. Because the Vite proxy collapses
// both surfaces onto the 5180 origin, an embedded app iframe shares Fact Explorer's sessionStorage
// and channel:
//   - Fact Explorer → app: publish() writes the storage key and posts on the channel; the embedded
//     iframe rehydrates via the app's own boot path.
//   - app → Fact Explorer: the runtime's saveFactGraph() posts the serialized graph; subscribe()
//     hands it back so Fact Explorer can treat it as the active scenario.
//
// ── The storage key is namespaced, and must be ────────────────────────────────────────────────
//
// This module wrote a bare 'factGraph' while the flow runtime has long read a *prefixed* one —
// `storageKey('factGraph')` in flow-runtime/js/runtime-config.js, i.e. 'credit-assistant:factGraph'.
// So the storage half of Fact Explorer → app was writing a key nothing read: rehydrating the
// iframe on panel open and on the ⟳ Reload button did nothing, and only the BroadcastChannel path
// worked (fg-graph-bridge.js writes the correct key itself on receipt, which is what hid the bug).
//
// With more than one app in Fact Explorer the same bare key would be *shared* between them — app A's
// serialized graph rehydrating app B's dictionary, which is the exact collision storagePrefix
// exists to prevent. Hence the required prefix argument: there is no sensible default for it.
//
// The channel name and the message shape are byte-for-byte fixed — fg-graph-bridge.js declares
// that a hard compatibility constraint and names this file as the other side. Only the storage
// key changed.
//
// React-free and feature-detected so it no-ops where BroadcastChannel is absent
// (and stays node-testable).

const CHANNEL_NAME = 'taxpert:factGraph'

/**
 * The flow runtime's serialized-graph key for one app. Mirrors `storageKey()` in
 * form-builder/website-static/flow-runtime/js/runtime-config.js — one line, duplicated rather than
 * imported for the same reason `makeCollectionIdPath` is: form-builder ships as a Scala jar, not an
 * npm package, and a relative path into vendor/form-builder/ exists only inside a built app, not in
 * fact-explorer's Vite bundle. Keep the two identical.
 *
 * @param {string} storagePrefix the app's FormBuilderApp.storageKeyPrefix
 */
export const graphStorageKey = (storagePrefix) => `${storagePrefix}:factGraph`

function makeChannel() {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(CHANNEL_NAME)
  } catch {
    return null
  }
}

/**
 * Publish a serialized fact graph to every same-origin surface.
 * @param {string} serializedGraphJSON the engine's graph.toJSON() output
 * @param {string} storagePrefix the target app's storage prefix — required, so that two apps open
 *   in one Fact Explorer can never write each other's graph. Without it only the channel is used.
 */
export function publish(serializedGraphJSON, storagePrefix) {
  if (typeof serializedGraphJSON !== 'string') return
  if (typeof storagePrefix === 'string' && storagePrefix) {
    try {
      sessionStorage.setItem(graphStorageKey(storagePrefix), serializedGraphJSON)
    } catch {
      // sessionStorage may be unavailable (private mode); the channel still works.
    }
  }
  const ch = makeChannel()
  if (ch) {
    ch.postMessage({ type: 'factGraph', graph: serializedGraphJSON })
    ch.close()
  }
}

/**
 * Subscribe to inbound serialized graphs (e.g. when a question is answered in the
 * embedded CA iframe). Returns an unsubscribe function.
 * @param {(serializedGraphJSON:string)=>void} onGraph
 * @returns {() => void}
 */
export function subscribe(onGraph) {
  const ch = makeChannel()
  if (!ch) return () => {}
  const handler = (ev) => {
    const data = ev?.data
    if (data && data.type === 'factGraph' && typeof data.graph === 'string') onGraph(data.graph)
  }
  ch.addEventListener('message', handler)
  return () => {
    ch.removeEventListener('message', handler)
    ch.close()
  }
}
