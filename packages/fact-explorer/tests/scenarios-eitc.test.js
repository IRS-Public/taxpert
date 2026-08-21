import { describe, it, expect } from 'vitest'
import { parseScenarioFilename } from '../src/model/scenarios/eitc-filename.js'

describe('parseScenarioFilename', () => {
  it('decodes a disqualifying HOH unmarried high-income scenario', () => {
    expect(parseScenarioFilename('dq_hoh_unmarried_2024_1tp_3qcs_59899.json')).toEqual({
      eligibility: 'disqualifying',
      filingStatus: 'hoh',
      marital: 'unmarried',
      incomeBand: 'high',
      qcCount: '3',
    })
  })

  it('extracts the qualifying-children count from the qc/qcs token', () => {
    const qc = (f) => parseScenarioFilename(f).qcCount
    expect(qc('single_2023_1tp_0qc_17639.json')).toBe('0')
    expect(qc('single_2024_1tp_1qc_49083.json')).toBe('1')
    expect(qc('qss_2024_1tp_2qcs_55767.json')).toBe('2')
    expect(qc('dq_hoh_married_2023_1tp_3qcs_56838.json')).toBe('3')
    // Works even when there is no trailing income token.
    expect(qc('dq_hoh_married_2023_1tp_0qc.json')).toBe('0')
    // No qc/qcs token → empty string.
    expect(qc('single_none.json')).toBe('')
  })

  it('treats a missing dq prefix as qualifying', () => {
    expect(parseScenarioFilename('single_2025_1tp_0qc_19104.json')).toMatchObject({
      eligibility: 'qualifying',
      filingStatus: 'single',
      marital: null,
    })
  })

  it('only reads a marital qualifier for HOH', () => {
    expect(parseScenarioFilename('mfs_2024_1tp_1qc_49084.json').marital).toBeNull()
    expect(parseScenarioFilename('dq_hoh_married_2023_1tp_0qc.json').marital).toBe('married')
  })

  it('bands income: low / mid-low / mid-high / high / none', () => {
    const band = (f) => parseScenarioFilename(f).incomeBand
    expect(band('single_2024_1tp_0qc_18591.json')).toBe('low') // 18591 < 20000
    expect(band('mfs_2024_1tp_1qc_49084.json')).toBe('mid-low') // 49084 < 52000
    expect(band('dq_hoh_unmarried_2024_1tp_2qcs_55768.json')).toBe('mid-high') // 55768 < 59000
    expect(band('dq_hoh_unmarried_2024_1tp_3qcs_59899.json')).toBe('high') // 59899 >= 59000
    // A trailing "0qc" still parseInt()s to 0 (the audit-panel behavior), banding low.
    expect(band('dq_hoh_married_2023_1tp_0qc.json')).toBe('low')
    // "none" only when the last token has no leading digits.
    expect(band('single_none.json')).toBe('none')
  })
})
