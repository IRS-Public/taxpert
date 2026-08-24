import { useEffect, useState } from 'react'
import { getAllFlags, FLAG_CHANGE_EVENT } from '../config/featureFlags.js'

// Read-only view of the effective feature flags, kept in sync with whatever last wrote
// taxpert:featureFlags to localStorage. The shared <taxpert-workspace-settings-modal>
// (taxpert, behind the global nav's settings gear) is the only UI that toggles them now,
// Fact Explorer no longer owns a toggle of its own (the old FeatureFlagPanel was a duplicate of
// it and has been removed). Resyncs on FLAG_CHANGE_EVENT, which taxpert's feature-flags.js dispatches
// on `document` from its setFlag(). The event name is shared by convention, the same way
// the localStorage key is (see featureFlags.js).
export function useFeatureFlags() {
  const [flags, setFlags] = useState(getAllFlags)

  useEffect(() => {
    const onChange = () => setFlags(getAllFlags())
    document.addEventListener(FLAG_CHANGE_EVENT, onChange)
    return () => document.removeEventListener(FLAG_CHANGE_EVENT, onChange)
  }, [])

  return flags
}
