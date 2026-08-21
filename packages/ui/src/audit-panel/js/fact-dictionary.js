// Fact-dictionary XML loader for the audit panel. Ported from credit-assistant; the
// hard-coded fetch path is now supplied by the caller (the panel's `fact-dictionary-url`
// attribute) so the component is host-agnostic. makeCollectionIdPath is imported from the
// shared canonical source and re-exported so existing consumers of this module keep working.
import { makeCollectionIdPath } from '../../shared/js/collection-utils.js'
export { makeCollectionIdPath }

// Both are created on first use rather than at import time. A module that touches DOM globals as a
// side effect of being imported can only be loaded once a document exists — which is not true of
// this one any more, now that the tool panels read the dictionary through it too.
let serializer = null

/** Serialize a fact-dictionary node back to XML text. */
export function serializeXml (node) {
  serializer ??= new XMLSerializer()
  return serializer.serializeToString(node)
}

/**
 * The parsed fact-dictionary.xml Document. `null` until `loadFactDictionaryXml()` resolves
 * (called from the audit panel's enable()). Consumers read it as a live binding.
 * @type {Document | null}
 */
export let factDictionaryXml = null

let factDictionaryXmlPromise = null

/**
 * Lazily fetch + parse the fact dictionary XML exactly once (memoized: concurrent and repeat
 * calls share the same fetch). Invoked from enable() so that — per ADR-004 — production page
 * loads with audit mode OFF never fetch the dictionary.
 * @param {string} url the fact-dictionary.xml URL (from the panel's fact-dictionary-url attribute)
 * @returns {Promise<Document>} the parsed fact-dictionary XML document
 */
export function loadFactDictionaryXml (url) {
  if (!factDictionaryXmlPromise) {
    factDictionaryXmlPromise = fetch(url)
      .then((res) => res.text())
      .then((text) => {
        factDictionaryXml = new DOMParser().parseFromString(text, 'application/xml')
        return factDictionaryXml
      })
  }
  return factDictionaryXmlPromise
}
