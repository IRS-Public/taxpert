// What the Inspect tool reads out of the fact *dictionary*, as opposed to fact-values.js, which
// reads out of the fact *graph*.
//
// The dictionary XML is the audit panel's: it fetches it once and exports the parsed Document as a
// live binding, so this module reads that rather than fetching a second copy. Every read is
// defensive, since the document is null until that fetch resolves. describeCondition() answers as
// data ({text, strong} parts) rather than markup, which keeps callers inside the no-innerHTML rule.
// See ../../../../../docs/internals/tool-panels.md.

import { factDictionaryXml, serializeXml } from '../../audit-panel/js/fact-dictionary.js'
import { formatLiteral, graphPort } from './fact-values.js'

/** '/familyAndHousehold/#abc/firstName' → '/familyAndHousehold/*\/firstName'. */
export function abstractPathOf (path) {
  return String(path ?? '').replace(/#[^/]+/g, '*')
}

/** The collection item id a concrete path carries, or '' for a plain fact. */
export function collectionIdOf (path) {
  const found = /#([^/]+)/.exec(String(path ?? ''))
  return found ? found[1] : ''
}

/** The <Fact> element for an abstract path, or null, including before the dictionary lands. */
export function getFactDefinition (abstractPath) {
  if (!factDictionaryXml || !abstractPath) return null
  // A fact path is a dictionary-authored string of segments and never contains a quote.
  return factDictionaryXml.querySelector(`Fact[path="${abstractPath}"]`)
}

/**
 * How the dictionary produces the fact: 'Writable' (a person answers it), 'Derived' (computed from
 * other facts), 'Constant', or '' when unknown. The "Fact type:" line under Advanced.
 */
export function factTypeLabel (definition) {
  if (!definition) return ''
  for (const kind of ['Writable', 'Derived', 'Constant']) {
    if (definition.querySelector(`:scope > ${kind}`)) return kind
  }
  return ''
}

/** The fact's <Description>, which is what the Purpose section shows. '' when it has none. */
export function factPurpose (definition) {
  return definition?.querySelector(':scope > Description')?.textContent?.trim() ?? ''
}

/**
 * A fact's human name: its <Name> when the dictionary gives one, otherwise its last path segment
 * un-camel-cased. The same fallback condition-detail.js uses, so the two surfaces agree.
 */
export function factLabel (abstractPath) {
  const name = getFactDefinition(abstractPath)?.querySelector(':scope > Name')?.textContent?.trim()
  if (name) return name
  const segment = String(abstractPath ?? '').split('/').filter(Boolean).pop() ?? abstractPath
  return String(segment).replace(/([A-Z])/g, ' $1').toLowerCase().trim()
}

/**
 * Resolve a <Dependency path> written relative to its own collection ('../foo') against the fact it
 * appears in. Absolute paths come back untouched.
 */
export function resolveDependencyPath (rawPath, abstractPath) {
  if (!rawPath?.startsWith('..')) return rawPath ?? ''
  return rawPath.replace('..', String(abstractPath ?? '').replace(/\*\/.*/, '*'))
}

/**
 * Every fact the definition depends on, as abstract paths in document order and deduped. The
 * collection id that resolves a wildcard travels alongside these, and is not spliced in here.
 * @returns {string[]}
 */
export function dependenciesOf (abstractPath) {
  const definition = getFactDefinition(abstractPath)
  if (!definition) return []

  const seen = new Set()
  for (const node of definition.querySelectorAll('Dependency')) {
    const resolved = resolveDependencyPath(node.getAttribute('path'), abstractPath)
    if (resolved) seen.add(resolved)
  }
  return [...seen]
}

const CONNECTIVE = new Map([
  ['All', 'all of the following are true'],
  ['Any', 'any of the following are true'],
  ['', 'the following is true'],
])

// The subject each kind of condition is spoken about as.
const SUBJECT = new Map([
  ['flow', 'This question'],
  ['text', 'This text'],
])

const DEPENDS_ON = new Map([
  ['flow', 'This flow condition depends on:'],
  ['text', 'This text conditional depends on:'],
])

/** The wording introducing the Dependencies table for a condition of this kind. */
export function dependsOnLead (kind) {
  return DEPENDS_ON.get(kind) ?? 'This condition depends on:'
}

/**
 * A flow or text condition, said in plain language. The lead names what the condition gates and
 * under what circumstance; the clauses unfold the fact's <Derived> tree one bullet at a time. A
 * condition on a <Writable> fact has no tree, so it gets a lead and no clauses.
 *
 * @param {{path: string, operator: string, kind: string}} condition as read off the flow element
 * @returns {{lead: string, clauses: {text: string, strong: boolean}[][]}}
 */
export function describeCondition ({ path, operator, kind }) {
  const abstractPath = abstractPathOf(path)
  const subject = SUBJECT.get(kind) ?? 'This item'
  const label = factLabel(abstractPath)
  const definition = getFactDefinition(abstractPath)
  const { connective, clauses } = unfold(definition?.querySelector(':scope > Derived'), abstractPath)

  // `isFalse` inverts the gate: the fact's own tree describes when the fact is true, which is when
  // the item is hidden. Say both.
  if (operator === 'isFalse') {
    const lead = `${subject} is shown when ${label} is not true.`
    if (!clauses.length) return { lead, clauses }
    return { lead: `${lead} That fact is true when ${CONNECTIVE.get(connective)}:`, clauses }
  }

  if (!clauses.length) return { lead: `${subject} is shown when ${label} is true.`, clauses }
  return { lead: `${subject} is shown when ${CONNECTIVE.get(connective)}:`, clauses }
}

/**
 * Flatten a <Derived> tree one level: an All/Any becomes its connective plus a clause per child,
 * anything else becomes a single clause. Deliberately shallow.
 */
function unfold (derived, abstractPath) {
  const root = derived?.firstElementChild
  if (!root) return { connective: '', clauses: [] }

  if (root.tagName === 'All' || root.tagName === 'Any') {
    return {
      connective: root.tagName,
      clauses: [...root.children].map((child) => clauseFor(child, abstractPath)),
    }
  }
  return { connective: '', clauses: [clauseFor(root, abstractPath)] }
}

/** One bullet, as the parts that make it: plain text, and the words set in bold. */
function clauseFor (node, abstractPath) {
  if (!node) return [{ text: 'an unnamed condition', strong: false }]

  switch (node.tagName) {
    case 'Dependency':
      return [...named(node, abstractPath), { text: ' is true', strong: false }]

    case 'IsComplete':
      return [
        ...named(node.firstElementChild, abstractPath),
        { text: ' has been determined', strong: false },
      ]

    case 'Not': {
      const child = node.firstElementChild
      if (child?.tagName === 'Dependency') {
        return [
          ...named(child, abstractPath),
          { text: ' is ', strong: false },
          { text: 'not', strong: true },
          { text: ' true', strong: false },
        ]
      }
      if (child?.tagName === 'IsComplete') {
        return [
          ...named(child.firstElementChild, abstractPath),
          { text: ' has ', strong: false },
          { text: 'not', strong: true },
          { text: ' been determined', strong: false },
        ]
      }
      return [
        { text: 'the opposite of ', strong: false },
        ...clauseFor(child, abstractPath),
      ]
    }

    case 'True':
      return [{ text: 'always true', strong: false }]

    default:
      // A Switch, an Equal, a comparison: shapes a bullet cannot carry. Name it and leave the reader
      // to the XML under Advanced.
      return [
        { text: `a ${node.tagName} expression — see the XML below`, strong: false },
      ]
  }
}

/** The clause's opening: the depended-on fact's human name. */
function named (node, abstractPath) {
  const resolved = resolveDependencyPath(node?.getAttribute?.('path'), abstractPath)
  if (!resolved) return [{ text: 'an unnamed fact', strong: false }]
  return [{ text: factLabel(resolved), strong: false }]
}

/**
 * The fact's dictionary XML with every resolvable <Dependency> annotated with its current value.
 * Returned as plain text, so <taxpert-inspect> can write it into a <pre> with textContent and there
 * is no way for a dictionary <Description> to become HTML.
 */
export function factXml (abstractPath, collectionId = '') {
  const definition = getFactDefinition(abstractPath)
  if (!definition) {
    return factDictionaryXml
      ? '(fact not found in the dictionary)'
      : '(the fact dictionary has not loaded yet)'
  }

  // The serializer indents relative to the document, so every line after the first carries four
  // spaces of <FactDictionaryModule> nesting.
  let xml = serializeXml(definition)
    .split('\n')
    .map((line, index) => (index === 0 ? line : line.replace(/^ {4}/, '')))
    .join('\n')

  const graph = graphPort()

  for (const node of definition.querySelectorAll('Dependency')) {
    const rawPath = node.getAttribute('path')
    if (!rawPath) continue
    const resolved = resolveDependencyPath(rawPath, abstractPath)
    const concrete = collectionId ? resolved.replace('*', `#${collectionId}`) : resolved
    if (concrete.includes('*')) continue // a wildcard with no id to resolve it has no one value

    const annotation = annotate(graph, concrete)
    if (!annotation) continue
    // String.replace with a string pattern replaces the first occurrence, which is the attribute
    // this dependency was read from.
    xml = xml.replace(`path="${rawPath}"`, `path="${rawPath}"${annotation}`)
  }
  return xml
}

// A path the port has no opinion about comes back null and is left unannotated. Only `fact.get`,
// the host's own accessor, can still throw here.
function annotate (graph, concretePath) {
  const fact = graph.get(concretePath)
  if (!fact) return ''
  try {
    if (!fact.hasValue) return ' ⮕ (no value)'
    return ` ⮕ ${formatLiteral(fact.get)} (${fact.complete ? 'complete' : 'incomplete'})`
  } catch {
    return ''
  }
}
