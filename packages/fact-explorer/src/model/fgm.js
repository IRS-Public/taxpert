// Form Graph Model (FGM): the contract every data source must satisfy and every
// component reads against. JSDoc typedefs for editor hints, plus a runtime
// validate() that fails loudly on a malformed graph.
//
// React-free and fetch-free, so it runs under plain Node in tests. load.js fetches.
// Model and invariants: ../../../../docs/internals/fact-explorer-internals.md

/**
 * @typedef {Object} FlowPage
 * @property {string} id              e.g. "page:filing-status"
 * @property {string} route           e.g. "/filing-status"
 * @property {string} title
 * @property {string} sourceFile
 * @property {string[]} elementIds
 */

/**
 * @typedef {Object} FlowElement
 * @property {string} id
 * @property {string} pageId
 * @property {"fg-set"|"fg-alert"|"fg-collection"|"fg-detail"|"fg-section-gate"|"conditional-block"} tag
 * @property {string|null} parentId
 * @property {number} order
 * @property {string|null} [factPath]
 * @property {string|null} [inputType]
 * @property {string|null} [optionsPath]
 * @property {{kind:"if-true"|"if-false", factPath:string}|null} [gate]
 * @property {{factPath:string, operator:string}|null} [condition]
 * @property {{alertType:string, alertKey:string, knockout:boolean}|null} [alert]
 * @property {{itemName?:string, determiner?:string, addItemIfTrue?:string}|null} [collection]
 * @property {"pending"|"complete"|null} [state]
 * @property {string|null} [questionText]
 * @property {string|null} [headingText]
 * @property {string[]} [fgShowPaths]
 * @property {string|null} [modalLinkId]
 * @property {{conditionPath:string, operator:string, text:string}[]} [conditionalSpans]
 * @property {string|null} [rawXml]
 */

/**
 * @typedef {Object} Fact
 * @property {string} id              e.g. "fact:/knowsFilingStatus"
 * @property {string} path
 * @property {string|null} [name]
 * @property {string|null} [description]
 * @property {"writable"|"derived"} kind
 * @property {string|null} [typeNode]
 * @property {string|null} [sourceFile]
 * @property {number|null} [taxYear]
 * @property {{raw:string, resolvedAbstract:string, wildcard:boolean}[]} [dependencyPaths]
 * @property {string|null} [rawXml]
 */

/**
 * @typedef {Object} FgmEdge
 * @property {string} id
 * @property {string} source         node id
 * @property {string} target         node id
 * @property {"sequential"|"exits"|"gates"|"binds"|"shows"|"knocks-out"|"displays"|"depends"} kind
 * @property {string} [operator]
 * @property {string} [via]
 */

/**
 * @typedef {Object} FormBuilderGraph
 * @property {string} [version]
 * @property {string} [generatedAt]
 * @property {number} [taxYear]
 * @property {string[]} [flowTags]  flow tags this app registers beyond the built-in FLOW_TAGS
 * @property {FlowPage[]} flowPages
 * @property {FlowElement[]} flowElements
 * @property {Fact[]} facts
 * @property {FgmEdge[]} edges
 */

export const EDGE_KINDS = [
  'sequential',
  'exits',
  'gates',
  'binds',
  'shows',
  'knocks-out',
  'displays',
  'depends',
]

export const FLOW_TAGS = [
  'fg-set',
  'fg-alert',
  'fg-collection',
  'fg-detail',
  'fg-section-gate',
  'conditional-block',
]

const SLICES = ['flowPages', 'flowElements', 'facts', 'edges']

/**
 * Every flow tag this graph may legally use: the built-ins plus whatever the app declared.
 * @param {{flowTags?: string[]}} [graph]
 * @returns {string[]}
 */
export function allowedFlowTags(graph) {
  const declared = Array.isArray(graph?.flowTags) ? graph.flowTags : []
  return [...new Set([...FLOW_TAGS, ...declared])]
}

/**
 * Validate an FGM object. Returns the same object on success; throws an Error
 * with a precise message on the first problem found.
 * @param {any} graph
 * @returns {FormBuilderGraph}
 */
export function validate(graph) {
  if (!graph || typeof graph !== 'object') {
    throw new Error('FGM: graph is not an object')
  }
  for (const slice of SLICES) {
    if (!Array.isArray(graph[slice])) {
      throw new Error(`FGM: missing or non-array slice "${slice}"`)
    }
  }

  const ids = new Set()
  const addId = (id, where) => {
    if (typeof id !== 'string' || !id) {
      throw new Error(`FGM: ${where} has a missing/invalid id`)
    }
    if (ids.has(id)) throw new Error(`FGM: duplicate node id "${id}" (${where})`)
    ids.add(id)
  }

  if (graph.flowTags !== undefined && !Array.isArray(graph.flowTags)) {
    throw new Error('FGM: "flowTags" must be an array of tag names when present')
  }
  const flowTags = allowedFlowTags(graph)

  graph.flowPages.forEach((p) => addId(p.id, 'flowPage'))
  graph.flowElements.forEach((e) => {
    addId(e.id, 'flowElement')
    if (!flowTags.includes(e.tag)) {
      throw new Error(`FGM: flowElement "${e.id}" has unknown tag "${e.tag}"`)
    }
  })
  graph.facts.forEach((f) => {
    addId(f.id, 'fact')
    if (f.kind !== 'writable' && f.kind !== 'derived') {
      throw new Error(`FGM: fact "${f.id}" has invalid kind "${f.kind}"`)
    }
  })

  graph.edges.forEach((edge) => {
    if (!EDGE_KINDS.includes(edge.kind)) {
      throw new Error(`FGM: edge "${edge.id}" has unknown kind "${edge.kind}"`)
    }
    if (!ids.has(edge.source)) {
      throw new Error(`FGM: edge "${edge.id}" source "${edge.source}" does not resolve to a node`)
    }
    if (!ids.has(edge.target)) {
      throw new Error(`FGM: edge "${edge.id}" target "${edge.target}" does not resolve to a node`)
    }
  })

  return graph
}
