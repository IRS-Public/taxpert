// Shared scenario-filename decoder — a verbatim port of parseScenarioFilename()
// from the credit-assistant audit panel (website-static/js/audit-panel.js), so
// fact-explorer's scenario picker decodes the four dimensions exactly as the audit
// panel does. Reused by scripts/make-static-fgm.mjs (to build the index) and by
// the picker (ScenarioModal in FactExplorer.jsx).
//
// Filenames encode four dimensions, e.g. `dq_hoh_unmarried_2024_1tp_3qcs_59899.json`:
// an optional `dq`/`ko` eligibility prefix, the filing status, an optional
// married/unmarried marital qualifier (HOH only), and a trailing income amount.

/**
 * @param {string} filename e.g. "dq_hoh_unmarried_2024_1tp_3qcs_59899.json"
 * @returns {{eligibility:string, filingStatus:string, marital:string|null, incomeBand:string, qcCount:string}}
 */
export function parseScenarioFilename(filename) {
  // Consume tokens with shift()/parts[0] (a literal index) instead of a variable
  // index parts[i], which trips security/detect-object-injection.
  const parts = filename.replace(/\.json$/, '').split('_')

  let eligibility = 'qualifying'
  if (parts[0] === 'dq') {
    eligibility = 'disqualifying'
    parts.shift()
  }

  const filingStatus = parts.shift()

  let marital = null
  if (filingStatus === 'hoh' && (parts[0] === 'married' || parts[0] === 'unmarried')) {
    marital = parts.shift()
  }

  // Number of qualifying children, encoded as a `Nqc`/`Nqcs` token (e.g. `3qcs`).
  // Iterate (no variable-indexed access) to keep security/detect-object-injection happy.
  let qcCount = ''
  for (const part of parts) {
    const match = /^(\d+)qcs?$/i.exec(part)
    if (match) {
      qcCount = match[1]
      break
    }
  }

  const income = parseInt(parts[parts.length - 1], 10)
  let incomeBand = 'none'
  if (!Number.isNaN(income)) {
    if (income < 20000) incomeBand = 'low'
    else if (income < 52000) incomeBand = 'mid-low'
    else if (income < 59000) incomeBand = 'mid-high'
    else incomeBand = 'high'
  }

  return { eligibility, filingStatus, marital, incomeBand, qcCount }
}
