// Collection-path helper for the workspace.
//
// Form Builder's flow runtime keeps a byte-identical copy at
// `flow-runtime/js/fg-collection-utils.js`. Neither package can import the other: form-builder
// ships as a Scala jar rather than an npm package, and a relative path into `vendor/form-builder/`
// exists only in a built app, not in this package's test run or fact-explorer's bundle.
//
// KEEP THE TWO IDENTICAL. If this ever grows past one pure line, revisit the split rather than
// extending both copies.

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
