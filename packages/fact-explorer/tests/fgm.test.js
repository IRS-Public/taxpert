import { describe, it, expect } from 'vitest'
import { validate, allowedFlowTags, FLOW_TAGS } from '../src/model/fgm.js'
import { loadMock } from './_fixtures.js'

// The FGM contract itself. The interesting part is `flowTags`: a FormBuilderApp may register node
// types the scaffold has never heard of (TWE's `fg-withholding-adjustments`), so the tag allow-list
// has to be extensible — but *declared*, never open. A typo'd tag must still fail, because catching
// exactly that is what the allow-list is for.

const withElement = (graph, tag, extra = {}) => ({
  ...graph,
  ...extra,
  flowElements: [
    ...graph.flowElements,
    { id: `custom:${tag}`, pageId: graph.flowPages[0].id, tag, order: 99 },
  ],
})

describe('fgm.allowedFlowTags', () => {
  it('is the built-ins when nothing is declared', () => {
    expect(allowedFlowTags({})).toEqual(FLOW_TAGS)
    expect(allowedFlowTags(undefined)).toEqual(FLOW_TAGS)
  })

  it('unions in declared tags without duplicating a built-in', () => {
    const tags = allowedFlowTags({ flowTags: ['fg-set', 'fg-withholding-adjustments'] })
    expect(tags).toContain('fg-withholding-adjustments')
    expect(tags.filter((t) => t === 'fg-set')).toHaveLength(1)
  })
})

describe('fgm.validate — flow tags', () => {
  const mock = loadMock()

  it('accepts the committed mock fixture', () => {
    expect(() => validate(mock)).not.toThrow()
  })

  it('accepts a custom tag that the graph declares', () => {
    const g = withElement(mock, 'fg-withholding-adjustments', {
      flowTags: ['fg-withholding-adjustments'],
    })
    expect(() => validate(g)).not.toThrow()
  })

  it('still rejects a custom tag the graph did not declare', () => {
    const g = withElement(mock, 'fg-withholding-adjustments')
    expect(() => validate(g)).toThrow(/unknown tag "fg-withholding-adjustments"/)
  })

  it('still rejects a typo of a declared tag — the guardrail survives the loosening', () => {
    const g = withElement(mock, 'fg-withholding-adjustment', {
      flowTags: ['fg-withholding-adjustments'],
    })
    expect(() => validate(g)).toThrow(/unknown tag "fg-withholding-adjustment"/)
  })

  it('rejects a non-array flowTags', () => {
    expect(() => validate({ ...mock, flowTags: 'fg-withholding-adjustments' })).toThrow(
      /"flowTags" must be an array/
    )
  })
})
