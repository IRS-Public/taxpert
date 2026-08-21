// The fact-graph port: the only surface taxpert is allowed to touch on a host's graph.
//
// Until now the tools reached straight for `window.factGraph` and whatever methods the Scala.js
// bundle happened to expose. That is why the package could only ever run on credit-assistant. An
// adapter is nine functions; a host that can answer them gets the whole workspace, whether its
// graph is the real Scala.js one, a Vite module, or a fixture object in a test.
//
// Every method here is *defensive by contract*. The tools re-read on every `fg-update`, which fires
// on every keystroke, so an adapter must answer rather than throw: a missing graph, a path the
// dictionary has since dropped, or a value whose toString blows up all have to come back as an
// empty/undefined answer. windowFactGraphAdapter() below holds up that end for the window graph;
// a custom adapter is expected to do the same.
//
// ── The toJson/toJSON split ───────────────────────────────────────────────────────────────────
//
// taxpert called `factGraph.toJson()` (fact-graph-io.js) while credit-assistant's own
// fg-fact-graph.js called `factGraph.toJSON()`. Both spellings exist on the Scala.js object today,
// which is the only reason nobody noticed. The adapter tries both and pins one spelling — `toJson()`
// — for everything inside this package, so the next host only has to implement one.

/**
 * @typedef {object} GraphAdapter
 * @property {() => string[]} paths            every abstract path the dictionary knows
 * @property {(root: string) => string[]} getCollectionIds  item ids currently in a collection
 * @property {(concretePath: string) => ({complete: boolean, hasValue: boolean, get: *}|null)} get
 * @property {(concretePath: string, value: *) => boolean} set  write one fact; see the note below
 * @property {(abstractPath: string) => ({typeNode: string}|null)} getDefinition
 * @property {() => string} toJson             the graph serialized, for Copy Fact Graph
 * @property {(json: string) => void} load     replace the graph; may reload the page
 * @property {string[]} changeEvents           document events meaning "a fact may have changed"
 */

/** The document events that mean "a fact may have changed", as credit-assistant fires them. */
export const DEFAULT_CHANGE_EVENTS = ['fg-load', 'fg-update']

/** The one a *write* fires, so everything watching a fact re-reads it. */
export const DEFAULT_UPDATE_EVENT = 'fg-update'

/** Run `read`, answering undefined rather than throwing. The graph throws on unknown paths. */
function safely (read) {
  try {
    return read()
  } catch {
    return undefined
  }
}

/**
 * The adapter over `window.factGraph` / `window.loadFactGraph` — i.e. exactly today's behavior,
 * expressed as the port. This is the default `config.graph`, so credit-assistant needs no change
 * to keep working.
 *
 * The graph is resolved on every call rather than captured, because it arrives asynchronously from
 * the Scala.js bundle and the workspace may render first.
 *
 * ── Writing ───────────────────────────────────────────────────────────────────────────────────
 *
 * The port was read-only until the Overrides tool needed to put a value *into* the graph. Writing
 * takes three steps in both hosts — set the fact, persist the graph, tell the page — and only the
 * first is the graph's own. So `save` is a host option: neither host puts its saveFactGraph() on
 * `window`, and a write that is not persisted vanishes on the next navigation.
 *
 * @param {object} [options]
 * @param {() => object|null} [options.resolve] how to find the graph; defaults to window.factGraph
 * @param {(json: string) => void} [options.load] how to replace it; defaults to window.loadFactGraph
 * @param {() => void} [options.save] persist after a write; the host's own saveFactGraph()
 * @param {string} [options.updateEvent] dispatched after a write; defaults to 'fg-update'
 * @param {string[]} [options.changeEvents]
 * @returns {GraphAdapter}
 */
export function windowFactGraphAdapter (options = {}) {
  const resolve = options.resolve ?? (() => globalThis.window?.factGraph ?? null)
  const changeEvents = options.changeEvents ?? [...DEFAULT_CHANGE_EVENTS]

  return {
    changeEvents,

    paths () {
      const graph = resolve()
      if (!graph) return []
      const all = safely(() => [...graph.paths()])
      if (!all) {
        console.warn('taxpert: could not read fact paths')
        return []
      }
      return all.sort()
    },

    getCollectionIds (root) {
      const graph = resolve()
      if (!graph || typeof graph.getCollectionIds !== 'function') return []
      // Not a collection the persister knows about is an ordinary answer, not an error.
      return safely(() => [...graph.getCollectionIds(root)]) ?? []
    },

    get (concretePath) {
      const graph = resolve()
      if (!graph) return null
      return safely(() => graph.get(concretePath)) ?? null
    },

    /**
     * Write one fact, persist, and tell the page.
     *
     * An empty value deletes rather than writes, mirroring what a host's own `<fg-set>` does when a
     * field is cleared — an empty Dollar is not zero, it is unanswered, and the difference decides
     * whether a determination has settled.
     *
     * Answers false rather than throwing, like every other reader here: the caller is a form the
     * user is typing into, and a rejected value is an ordinary outcome (a Dollar field given a
     * word) rather than an exception to unwind.
     */
    set (concretePath, value) {
      const graph = resolve()
      if (!graph || typeof graph.set !== 'function') return false

      const wrote = safely(() => {
        if (value === '' || value === null || value === undefined) graph.delete?.(concretePath)
        else graph.set(concretePath, value)
        return true
      })
      if (!wrote) return false

      options.save?.()
      document.dispatchEvent(new CustomEvent(options.updateEvent ?? DEFAULT_UPDATE_EVENT))
      return true
    },

    getDefinition (abstractPath) {
      const graph = resolve()
      if (!graph) return null
      return safely(() => graph.dictionary?.getDefinition(abstractPath)) ?? null
    },

    // Both spellings are tried because the Scala.js object carries both and the two call sites
    // disagreed about which one is real. See the module comment.
    toJson () {
      const graph = resolve()
      if (!graph) return ''
      const serialize = typeof graph.toJson === 'function'
        ? () => graph.toJson()
        : typeof graph.toJSON === 'function'
          ? () => graph.toJSON()
          : null
      if (!serialize) {
        console.warn('taxpert: graph exposes neither toJson() nor toJSON()')
        return ''
      }
      return safely(serialize) ?? ''
    },

    // load() deliberately does NOT swallow: the caller (the Load Fact Graph textarea) needs the
    // throw to turn invalid JSON into a validation message before the form submits.
    load (json) {
      const loader = options.load ?? globalThis.window?.loadFactGraph
      if (typeof loader !== 'function') {
        throw new Error('taxpert: no fact-graph loader configured')
      }
      return loader(json)
    },
  }
}

/**
 * Fill in anything a partial adapter left out, so a host can supply three methods and still be
 * safe to call. Missing readers answer empty; a missing load() throws when actually used.
 *
 * @param {Partial<GraphAdapter>} partial
 * @returns {GraphAdapter}
 */
export function normalizeAdapter (partial) {
  const empty = {
    changeEvents: [...DEFAULT_CHANGE_EVENTS],
    paths: () => [],
    getCollectionIds: () => [],
    get: () => null,
    // A host that supplies no writer gets a workspace whose write-capable tools say so, rather than
    // one that appears to accept a value and silently drops it.
    set: () => false,
    getDefinition: () => null,
    toJson: () => '',
    load: () => { throw new Error('taxpert: no fact-graph loader configured') },
  }
  return { ...empty, ...(partial ?? {}) }
}
