// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderFactExplanation } from '../src/explain/factRender.js'
import { loadRealOrNull } from './_fixtures.js'

// The M4 renderer parses a <Fact> out of rawXml via DOMParser, so it needs a DOM
// — hence the jsdom environment. Skips when the real (rawXml-bearing) graph is
// absent; the mock fixture has no rawXml.
describe('explain/factRender', () => {
  const real = loadRealOrNull()
  const find = (path) => real?.facts.find((f) => f.path === path)

  it.skipIf(!find('/knowsFilingStatus'))(
    'renders /knowsFilingStatus as a user-entered input',
    () => {
      const fact = find('/knowsFilingStatus')
      const { summaryHtml, xmlHtml } = renderFactExplanation(fact, {})
      expect(summaryHtml).toContain('User-entered')
      // the raw-XML toggle gets escaped source
      expect(xmlHtml).toContain('&lt;Fact')
    }
  )

  it.skipIf(!real)('renders a derived fact with navigable dependency spans', () => {
    const derived = real.facts.find(
      (f) =>
        f.kind === 'derived' &&
        f.rawXml?.includes('<Dependency') &&
        (f.dependencyPaths?.length ?? 0) > 0
    )
    if (!derived) return
    const { summaryHtml } = renderFactExplanation(derived, {})
    expect(summaryHtml).not.toContain('hr-error')
    expect(summaryHtml).toContain('data-nav-path')
  })

  it('degrades gracefully when a fact has no rawXml', () => {
    const { summaryHtml } = renderFactExplanation({ path: '/x', kind: 'derived' }, {})
    expect(summaryHtml).toContain('hr-error')
  })
})
