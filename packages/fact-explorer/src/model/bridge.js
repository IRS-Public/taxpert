// The live shared-state bridge between Fact Explorer and a running Form Builder app.
//
// The contract is the flow runtime's serialized-graph sessionStorage key plus a BroadcastChannel.
// The Vite proxy collapses both surfaces onto one origin, so an embedded app iframe shares Fact
// Explorer's sessionStorage and channel. publish() writes the key and posts, and subscribe() hands
// back what the app's own saveFactGraph() posted.
//
// THE STORAGE KEY MUST BE NAMESPACED, which is why the prefix argument is required and has no
// default. A bare key would be shared between two apps in one Fact Explorer, so one app's
// serialized graph would rehydrate another's dictionary.
//
// THE CHANNEL NAME AND MESSAGE SHAPE ARE FIXED BYTE FOR BYTE. fg-graph-bridge.js declares that a
// hard compatibility constraint and names this file as the other side.
//
// React-free and feature-detected, so it no-ops where BroadcastChannel is absent and stays
// node-testable. See ../../../../docs/internals/fact-explorer-internals.md

const CHANNEL_NAME = 'taxpert:factGraph'

/**
 * The flow runtime's serialized-graph key for one app. Mirrors `storageKey()` in
 * form-builder/website-static/flow-runtime/js/runtime-config.js. One line, duplicated rather than
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
 * @param {string} storagePrefix the target app's storage prefix. Required, so that two apps open
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
