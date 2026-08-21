// React bindings for the annotation store. Kept separate from store.js so the
// store stays framework-free and node-testable.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot } from './store.js'

function useStoreState() {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** The annotation for one node id (or null), re-rendering on change. */
export function useAnnotation(id) {
  return useStoreState().annotations[id] ?? null
}
