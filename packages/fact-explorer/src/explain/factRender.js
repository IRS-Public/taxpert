// Framework-agnostic fact-derivation renderer.
//
// This is the audit panel's ConditionDetail._renderNode / _buildHumanReadable /
// _buildAnnotatedXml (credit-assistant website-static/js/audit-panel.js), ported
// to operate on a <Fact> element parsed from the FGM's per-fact `rawXml` instead
// of the runtime fact-dictionary DOM. It produces HTML strings; FactExplain.jsx
// wraps them in React.
//
// Read-only MVP: the audit panel interleaves *live* values from window.factGraph
// (value chips, "incomplete" markers). There is no engine here, so those are
// omitted — the renderer already degrades to a purely structural view (derivation
// logic + dependency names + raw XML), which is exactly requirement #2.
//
// Dependency names are emitted as navigable spans (`data-nav-path`) so the panel
// can select/centre the target fact node — the fact-explorer analogue of `fact-link`.
import { escapeHtml } from '../util/html.js'

/** Prettify a fact path's leaf segment as a fallback label ("isFooBar" → "foo bar"). */
function prettyLeaf(path) {
  const seg =
    String(path || '')
      .split('/')
      .filter(Boolean)
      .pop() ?? path
  return seg
    .replace(/^is/, '')
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim()
}

/**
 * Build a renderer bound to one fact.
 * @param {import('../model/fgm.js').Fact} fact   FGM fact (carries rawXml + dependencyPaths)
 * @param {(absPath:string)=>string} [factLabel]  resolve an abstract path to a display name
 */
function makeRenderer(fact, factLabel) {
  // raw Dependency path -> { resolvedAbstract, wildcard } from the generator.
  const byRaw = new Map((fact.dependencyPaths ?? []).map((d) => [d.raw, d]))

  const labelFor = (abstractPath) =>
    (factLabel && factLabel(abstractPath)) || prettyLeaf(abstractPath)

  const renderDep = (node, { negated = false, isComplete = false } = {}) => {
    const rawPath = node?.getAttribute?.('path')
    if (!rawPath) return ''
    const resolved = byRaw.get(rawPath)
    const abstractPath = resolved?.resolvedAbstract ?? rawPath
    const wildcard = resolved?.wildcard ?? abstractPath.includes('*')
    const label = escapeHtml(labelFor(abstractPath))

    // Wildcard (collection-item) deps aren't a single navigable node.
    const pathSpan = wildcard
      ? `<span class="hr-dep-path" title="${escapeHtml(rawPath)}">${label}</span>`
      : `<span class="hr-dep-path hr-nav" role="link" tabindex="0" data-nav-path="${escapeHtml(abstractPath)}" title="${escapeHtml(abstractPath)}">${label}</span>`

    if (isComplete) {
      const q = negated ? 'has not been answered' : 'has been answered'
      return `<span class="hr-dep">${pathSpan} <span class="hr-qualifier">${q}</span></span>`
    }
    if (negated) {
      return `<span class="hr-dep">${pathSpan} <span class="hr-qualifier">is false</span></span>`
    }
    return `<span class="hr-dep">${pathSpan}</span>`
  }

  const renderNode = (node) => {
    if (!node || node.nodeType !== 1) return ''
    const tag = node.tagName
    const kids = Array.from(node.children)

    switch (tag) {
      case 'Derived':
        return renderNode(kids[0])

      case 'Writable': {
        const type = kids[0]?.tagName ?? 'value'
        return `<span class="hr-writable">User-entered ${escapeHtml(type)}</span>`
      }

      case 'Any':
      case 'All': {
        const label = tag === 'Any' ? 'ANY of:' : 'ALL of:'
        const cls = tag === 'Any' ? 'hr-any' : 'hr-all'
        const rows = kids.map((c) => `<li>${renderNode(c)}</li>`).join('')
        return `<div class="hr-group ${cls}"><span class="hr-op">${label}</span><ul>${rows}</ul></div>`
      }

      case 'Not': {
        const child = kids[0]
        if (!child) return ''
        if (child.tagName === 'Dependency') return renderDep(child, { negated: true })
        if (child.tagName === 'IsComplete')
          return renderDep(child.children[0], { isComplete: true, negated: true })
        return `<div class="hr-not"><span class="hr-op hr-op--not">NOT:</span> ${renderNode(child)}</div>`
      }

      case 'IsComplete':
        return renderDep(kids[0], { isComplete: true })

      case 'Dependency':
        return renderDep(node)

      case 'Switch': {
        const rows = kids.map((c) => renderNode(c)).join('')
        return `<div class="hr-switch">${rows}</div>`
      }

      case 'Case': {
        const when = node.querySelector('When')?.children[0]
        const then = node.querySelector('Then')?.children[0]
        return `<div class="hr-case"><span class="hr-kw">if</span> ${renderNode(when)} <span class="hr-kw">→</span> ${renderNode(then)}</div>`
      }

      case 'Equal': {
        const left = node.querySelector('Left')?.children[0]
        const right = node.querySelector('Right')?.children[0]
        return `${renderNode(left)} <span class="hr-eq">=</span> ${renderNode(right)}`
      }

      case 'True':
        return '<span class="hr-literal">always</span>'

      case 'False':
        return '<span class="hr-literal">never</span>'

      case 'String':
        return `<span class="hr-literal">"${escapeHtml(node.textContent)}"</span>`

      case 'Dollar':
      case 'Int':
      case 'Rational':
      case 'Enum':
        return `<span class="hr-literal">${escapeHtml(node.textContent)}</span>`

      default: {
        // The audit panel only modelled boolean predicates; fact-explorer shows
        // every fact, including dollar arithmetic (Add/Round/LesserOf/…). Rather
        // than dump a bare tag, recurse so child dependencies stay visible and
        // navigable: render as op(child, child, …).
        const elementKids = kids.filter((c) => c.nodeType === 1)
        if (elementKids.length) {
          const inner = elementKids
            .map((c) => renderNode(c))
            .filter(Boolean)
            .join(', ')
          return `<span class="hr-fn"><span class="hr-fn-op">${escapeHtml(tag)}</span>(${inner})</span>`
        }
        return `<span class="hr-unknown" title="unhandled: ${escapeHtml(tag)}">${escapeHtml(tag)}</span>`
      }
    }
  }

  return { renderNode }
}

const domParser = typeof DOMParser !== 'undefined' ? new DOMParser() : null

/**
 * Parse a fact's rawXml and render its derivation as HTML.
 * @param {import('../model/fgm.js').Fact} fact
 * @param {{factLabel?:(p:string)=>string}} [opts]
 * @returns {{ summaryHtml: string, xmlHtml: string }}
 */
export function renderFactExplanation(fact, { factLabel } = {}) {
  if (!fact?.rawXml) {
    return {
      summaryHtml:
        '<p class="hr-error">(no source XML — regenerate with <code>npm run make-mock</code>)</p>',
      xmlHtml: '',
    }
  }
  const doc = domParser?.parseFromString(fact.rawXml, 'application/xml')
  const factEl = doc?.querySelector('Fact')
  if (!factEl) {
    return {
      summaryHtml: '<p class="hr-error">(could not parse fact XML)</p>',
      xmlHtml: escapeHtml(fact.rawXml),
    }
  }

  const root = factEl.querySelector('Derived') || factEl.querySelector('Writable')
  const { renderNode } = makeRenderer(fact, factLabel)
  const summaryHtml = root
    ? renderNode(root)
    : '<p class="hr-error">(fact has no Derived/Writable body)</p>'

  return { summaryHtml, xmlHtml: escapeHtml(fact.rawXml) }
}
