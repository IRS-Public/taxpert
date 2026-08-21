// A fact graph for a host that does not exist.
//
// This is the whole point of graph-adapter.js stated as an object: seven functions and a list of
// event names, backed by a plain Map. No Scala.js, no `window.factGraph`, no fact dictionary
// parsing — and the workspace cannot tell the difference.
//
// If a change to taxpert makes the tools reach past the port (for `window.factGraph`, for
// `graph.dictionary`, for a method the port doesn't declare), the fixture spec fails here rather
// than in a browser against a real application.

/** The dictionary's abstract paths and their node types, mirroring fixtures/host/dictionary.xml. */
const DEFINITIONS = new Map([
  ['/hasPet', 'BooleanNode'],
  ['/petCount', 'IntNode'],
  ['/monthlyBudget', 'DollarNode'],
  ['/petKind', 'EnumNode'],
  ['/pets', 'CollectionNode'],
  ['/pets/*/name', 'StringNode'],
  ['/pets/*/isFed', 'BooleanNode'],
  ['/isReadyForPet', 'BooleanNode'],
  ['/needsSupplies', 'BooleanNode'],
  ['/hasBudget', 'BooleanNode'],
  ['/wantsPet', 'BooleanNode'],
  ['/petDecision', 'EnumNode'],
  ['/unreferencedNote', 'StringNode'],
])

/**
 * Build a fixture graph.
 *
 * `values` maps a **concrete** path to its value — `/pets/#pet-1/name`, not `/pets/*\/name`. A path
 * in the dictionary but absent from `values` reports incomplete, which is what the workspace shows
 * before a question is answered; a path in neither is unknown.
 *
 * @param {object} [options]
 * @param {Record<string, *>} [options.values]
 * @param {string[]} [options.collectionIds]
 * @returns {{adapter: object, set: Function, values: Map}}
 */
export function createFixtureGraph (options = {}) {
  const values = new Map(Object.entries(options.values ?? {}))
  const collectionIds = [...(options.collectionIds ?? ['pet-1', 'pet-2'])]
  let serialized = JSON.stringify(Object.fromEntries(values))

  const adapter = {
    // Deliberately NOT the fg-* pair: a host names its own events, and the workspace must listen to
    // whatever it is told rather than to credit-assistant's vocabulary.
    changeEvents: ['fixture-graph-loaded', 'fixture-graph-changed'],

    paths () {
      return [...DEFINITIONS.keys()].sort()
    },

    getCollectionIds (root) {
      return root === '/pets' ? [...collectionIds] : []
    },

    // The fact-shaped answer the workspace reads: { complete, hasValue, get }.
    get (concretePath) {
      if (!values.has(concretePath)) {
        // A path the dictionary knows but nobody has answered yet.
        if (isKnown(concretePath)) return { complete: false, hasValue: false, get: undefined }
        // A path the dictionary has never heard of — the real graph throws, so this one does too.
        throw new Error(`fixture graph: unknown path ${concretePath}`)
      }
      const value = values.get(concretePath)
      return { complete: true, hasValue: value !== null, get: value }
    },

    getDefinition (abstractPath) {
      const typeNode = DEFINITIONS.get(abstractPath)
      return typeNode ? { typeNode } : null
    },

    toJson () {
      return serialized
    },

    load (json) {
      const parsed = JSON.parse(json) // throws on bad JSON, exactly as the real loader does
      values.clear()
      for (const [path, value] of Object.entries(parsed)) values.set(path, value)
      serialized = json
    },
  }

  /** Set a value and fire the host's own change event, the way a real flow would. */
  function set (concretePath, value) {
    values.set(concretePath, value)
    serialized = JSON.stringify(Object.fromEntries(values))
    document.dispatchEvent(new globalThis.window.CustomEvent('fixture-graph-changed'))
  }

  return { adapter, set, values }
}

/** Whether `concretePath` matches a dictionary path, resolving `#id` collection items back to `*`. */
function isKnown (concretePath) {
  if (DEFINITIONS.has(concretePath)) return true
  const abstract = concretePath.replace(/\/#[^/]+\//g, '/*/')
  return DEFINITIONS.has(abstract)
}
