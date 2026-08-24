// sessionStorage-backed persistence for the audit panel's open/closed state, tracked facts, width
// and active tab. No DOM access, so it is host-agnostic as it stands.
//
// The key is a function and callers must invoke it at each read and write. This module is imported
// before the host calls configure(), so a captured key would pin the default prefix.

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
