// sessionStorage-backed persistence for the audit panel's open/closed state, tracked
// facts, width, and active tab. Ported from credit-assistant (no DOM access — host-agnostic
// as-is). The former 'showConditions' field moved to display-options.js along with the control
// itself, so it clears with the display options rather than with the panel.
//
// The key is a *function*, not the exported const it used to be, and callers must invoke it at each
// read and write: this module is imported before the host calls configure(), so a captured key
// would pin the default 'taxpert:' prefix forever and a host's own namespace would silently never
// take effect.
//
// Note this is the one key whose spelling changes for every host, including credit-assistant, which
// sets no prefix: it was the unprefixed 'auditPanel' and is now 'taxpert:auditPanel'. Everyone
// therefore reopens the panel and re-tracks their facts once, on the next load. That is accepted —
// it is dev-tool state that costs seconds to recreate, and migration code for it would outlive its
// usefulness by years.

import { storageKey } from '../../shared/js/storage-keys.js'

/** The namespaced sessionStorage key this module reads and writes. Call it; never cache it. */
export function auditPanelStorageKey () {
  return storageKey('auditPanel')
}

const AUDIT_PANEL_STORAGE_FIELDS = new Set([
  'isOpen',
  'trackedFacts',
  'width',
  'activeTab',
])

// Save the open/closed state of the audit panel in session storage so it persists across page reloads and forward navigation.
export function getAuditPanelStorage () {
  const storage = sessionStorage.getItem(auditPanelStorageKey())
  if (storage) {
    return JSON.parse(storage)
  } else {
    return {}
  }
}

// Set a key/value pair in session storage for the audit panel, with special handling to ensure tracked facts are unique by path and collectionId
export function setAuditPanelStorage (key, value) {
  if (!AUDIT_PANEL_STORAGE_FIELDS.has(key)) {
    throw new Error(`Unsupported audit panel storage key: ${key}`)
  }

  const storage = getAuditPanelStorage()
  if (key === 'trackedFacts') {
    const uniqueFacts = []
    const seen = new Set()
    for (const fact of value) {
      const factId = `${fact.path}#${fact.collectionId}`
      if (!seen.has(factId)) {
        uniqueFacts.push(fact)
        seen.add(factId)
      }
    }
    storage.trackedFacts = uniqueFacts
  } else if (key === 'isOpen') {
    storage.isOpen = value
  } else if (key === 'width') {
    storage.width = value
  } else if (key === 'activeTab') {
    storage.activeTab = value
  }
  sessionStorage.setItem(auditPanelStorageKey(), JSON.stringify(storage))
}
