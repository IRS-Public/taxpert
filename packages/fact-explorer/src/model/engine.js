// In-browser fact-graph engine wrapper (N2).
//
// A thin, memoized port of the flow runtime's fg-fact-graph.js + the
// checkCondition() switch from fg-conditions.js. It runs the *real* Scala.js
// fact-graph engine in the browser so fact-explorer never re-derives an app's logic — it
// asks the same engine the questionnaire uses.
//
// Everything here is browser-only: the Scala.js ESM bundle and the fact
// dictionary are fetched from the app's own origin through the Vite proxy (see
// vite.config.js, whose proxy table is derived from the same registry), so that
// app's dev server must be running. There is no Node unit test for the loader;
// the pure visibility logic that consumes its evaluators lives in visibility.js
// and is tested with a fake evaluator.
//
// The memo is keyed by app, and an engine must never be crossed with another
// app's graph: a Graph built against one FactDictionary is meaningless to
// another. Everything downstream already takes the opaque {fg, dict} pair as a
// parameter (buildScenarioGraph, emptyGraph, makeEvaluators), so that stays true
// by construction — keep it that way.

/** app.id → Promise<{fg, dict}>. Each entry is ~7.7 MB of Scala.js, so evict on switch. */
const engines = new Map()

/**
 * Lazily load one app's Scala.js engine module + its parsed fact dictionary.
 * @param {import('./apps.js').FactExplorerApp} app
 * @returns {Promise<{ fg: any, dict: any }>}
 */
export function loadEngine(app) {
  if (!engines.has(app.id)) {
    const pending = (async () => {
      const fg = await import(/* @vite-ignore */ app.engine.bundle)
      const res = await fetch(app.engine.dictionary)
      if (!res.ok) {
        throw new Error(
          `fact-dictionary.xml: ${res.status} ${res.statusText} (is ${app.label} running at ${app.devOrigin}?)`
        )
      }
      const text = await res.text()
      const dict = fg.FactDictionaryFactory.importFromXml(text)
      return { fg, dict }
    })().catch((err) => {
      // Let the next attempt retry rather than caching a rejected promise.
      engines.delete(app.id)
      throw err
    })
    engines.set(app.id, pending)
  }
  return engines.get(app.id)
}

/**
 * Drop every cached engine except the given app's.
 *
 * Called on app switch. Two engines is two Scala.js bundles resident at once, and nothing needs
 * the one belonging to an app that is no longer on screen.
 * @param {string} keepAppId
 */
export function evictEnginesExcept(keepAppId) {
  for (const id of engines.keys()) if (id !== keepAppId) engines.delete(id)
}

/**
 * Build a fact graph from a serialized scenario JSON (string or object).
 * @param {{fg:any, dict:any}} engine
 * @param {string|object} scenarioJson
 */
export function buildScenarioGraph(engine, scenarioJson) {
  const json = typeof scenarioJson === 'string' ? scenarioJson : JSON.stringify(scenarioJson)
  return engine.fg.GraphFactory.fromJSON(engine.dict, json)
}

/** An empty graph (all defaults / "no scenario") for the given engine. */
export function emptyGraph(engine) {
  return engine.fg.GraphFactory.apply(engine.dict)
}

/**
 * Build the two evaluators that visibility.js needs, bound to one graph.
 * `evalCond` is a verbatim port of checkCondition() in fg-conditions.js — same
 * operator switch, same default-to-true when graph.get() throws (so fact-explorer's
 * visibility matches the real questionnaire exactly).
 * @param {any} graph a graph from buildScenarioGraph/emptyGraph
 * @returns {{ evalCond:(path:string,operator:string)=>boolean, factState:(path:string)=>{hasValue:boolean,value:any,complete:boolean} }}
 */
export function makeEvaluators(graph) {
  const evalCond = (condition, operator) => {
    let value
    // Defaults to true: having to answer an unnecessary question is preferable to
    // not being presented a necessary one (matches checkCondition()).
    try {
      value = graph.get(condition)
    } catch (e) {
      console.error(`Error attempting to fetch ${condition}, ignoring condition:\n`, e)
      return true
    }
    switch (operator) {
      case 'isTrue':
        return value.hasValue && value.get === true
      case 'isFalse':
        return value.hasValue && value.get === false
      case 'isTrueAndComplete':
        return value.complete === true && value.hasValue && value.get === true
      case 'isZero':
        return value.hasValue && value.get === 0
      case 'isGreaterThanZero':
        return value.hasValue && value.get > 0
      case 'isIncomplete':
        return value.complete === false
      case 'notHasValue':
        return value.hasValue === false
      default:
        console.error(`Unknown condition operator ${operator}`)
        return false
    }
  }

  const factState = (path) => {
    try {
      const v = graph.get(path)
      return {
        hasValue: !!v.hasValue,
        value: v.hasValue ? v.get : undefined,
        complete: v.complete === true,
      }
    } catch {
      return { hasValue: false, value: undefined, complete: false }
    }
  }

  return { evalCond, factState }
}
