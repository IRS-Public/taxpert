// Collection-path helper for the workspace.
//
// A collection fact's abstract path carries a `*` wildcard (e.g.
// `/familyAndHousehold/*/firstName`). Splicing a concrete collection-item id in
// its place yields the fact graph's concrete path. This is the single source for
// the two tooling modules that need it — `audit-panel/js/fact-dictionary.js` and
// `tool-panels/js/watchlist-store.js`.
//
// The flow runtime needs the same line, and now keeps its own copy in
// form-builder's `flow-runtime/js/fg-collection-utils.js`, which used to import this
// one. That import was the last thing making the runtime — required by every
// Form Builder app — depend on the workspace, which no app requires. The two packages
// cannot share a module in either direction: form-builder ships as a Scala jar rather
// than an npm package, and a relative path into `vendor/form-builder/` exists only in
// a built app, not in this package's test run or in fact-explorer's bundle.
//
// Keep the two byte-identical. It is one pure line with no state and no config; if
// it ever grows past that, revisit the split rather than extending both copies.

/**
 * Substitute a collection item's concrete id into an abstract collection path, e.g.
 * `("/familyAndHousehold/*\/firstName", "abc")` → `/familyAndHousehold/#abc/firstName`.
 * @param {string} abstractPath the abstract path containing a `*` collection wildcard
 * @param {string} id the collection item id to splice in
 * @returns {string} the concrete path
 */
export function makeCollectionIdPath (abstractPath, id) {
  return abstractPath.replace('*', `#${id}`)
}
