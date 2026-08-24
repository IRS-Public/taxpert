// The fact-graph port: the only surface the workspace touches on a host's graph. A host that can
// answer these nine members gets the whole workspace, whatever engine is underneath.
//
// Every reader is defensive by contract. The tools re-read on every change event, which fires on
// every keystroke, so a missing graph or an unknown path answers empty rather than throwing.
// load() is the deliberate exception, because the Load Fact Graph textarea needs the throw in order
// to turn it into a validation message.
//
// See ../../../../../docs/internals/workspace-configuration.md

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

/** The document events that mean "a fact may have changed", as the flow runtime fires them. */
export const DEFAULT_CHANGE_EVENTS = ['fg-load', 'fg-update']

/** The one a write fires, so everything watching a fact re-reads it. */
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
 * The default `config.graph`: an adapter over `window.factGraph` and `window.loadFactGraph`.
 *
 * The graph is resolved on every call rather than captured, because it arrives asynchronously from
 * the Scala.js bundle and the workspace may render first.
 *
 * Writing takes three steps and only the first belongs to the graph: set the fact, persist, tell the
 * page. Persistence is the host's `save` option, because an unpersisted write vanishes on the next
 * navigation.
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
      return safely(() => [...graph.getCollectionIds(root)]) ?? []
    },

    get (concretePath) {
      const graph = resolve()
      if (!graph) return null
      return safely(() => graph.get(concretePath)) ?? null
    },

    /**
     * Write one fact, persist, and tell the page. Answers false rather than throwing.
     *
     * An empty value deletes rather than writes, mirroring a cleared flow field. An empty Dollar is
     * unanswered rather than zero, and that difference decides whether a determination has settled.
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

    // The Scala.js object carries both spellings. Everything in this package uses toJson().
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
 * Fill in anything a partial adapter left out, so a host can supply three methods and still be safe
 * to call. Missing readers answer empty. A missing load() throws when used.
 *
 * A host with no writer gets `set: () => false`, so the tools report the failure rather than
 * silently dropping a value.
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
    set: () => false,
    getDefinition: () => null,
    toJson: () => '',
    load: () => { throw new Error('taxpert: no fact-graph loader configured') },
  }
  return { ...empty, ...(partial ?? {}) }
}
