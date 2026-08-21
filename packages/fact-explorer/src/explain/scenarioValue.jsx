// Shared scenario live-value rendering (N5). The engine-computed value for a
// fact under the active scenario, plus whether the fact graph considers it
// complete. Used both by the slide-out <DetailPanel> and, in `compact` form,
// directly on the canvas nodes (<FgmNode>) so a loaded scenario's values are
// visible without opening the panel.
import PropTypes from 'prop-types'

// Format a raw fact-graph value for display. The in-browser engine returns
// Scala.js value objects (e.g. scala.math.BigDecimal for Dollar facts), so a
// naive JSON.stringify would leak the raw engine internals
// (s_math_BigDecimal__f_bigDecimal, …). Mirrors fg-display.js in the
// credit-assistant.
export function formatValue(v) {
  if (v === true) return 'true'
  if (v === false) return 'false'
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') {
    // Scala.js BigDecimal (Dollar/numeric facts). Its own toString() yields the
    // numeric string; BigDecimals render as USD currency, matching the
    // questionnaire.
    if (v.s_math_BigDecimal__f_bigDecimal) {
      const value = v.toString()
      const minimumFractionDigits = value % 1 === 0 ? 0 : 2
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits,
      }).format(value)
    }
    // Enum/collection wrappers surface as objects; show the most useful field.
    if ('value' in v) return String(v.value)
    // Other Scala.js value objects override toString() with something readable;
    // prefer it over JSON.stringify, which would leak the raw representation.
    const str = String(v)
    if (str && str !== '[object Object]') return str
    try {
      return JSON.stringify(v)
    } catch {
      return str
    }
  }
  return String(v)
}

// Live-value chip: the engine-computed value for this fact under the active
// scenario, plus a complete/incomplete badge. The full (panel) variant also
// renders a "no value" state; the `compact` (canvas) variant drops the label
// and is only meant to be rendered when the fact actually has a value.
export function ScenarioValueChip({ state, compact = false }) {
  const cls = (extra) => `hr-value-chip${compact ? ' hr-value-chip--compact' : ''}${extra}`

  if (!state || !state.hasValue) {
    if (compact) return null
    return (
      <div className={cls(' hr-value-chip--incomplete')}>
        <span className="hr-value-chip__label">Scenario value</span>
        <span className="hr-value-chip__value">—</span>
        <span className="hr-value-chip__badge">no value</span>
      </div>
    )
  }
  const incomplete = !state.complete
  return (
    <div className={cls(incomplete ? ' hr-value-chip--incomplete' : '')}>
      {!compact && <span className="hr-value-chip__label">Scenario value</span>}
      <span className="hr-value-chip__value">{formatValue(state.value)}</span>
      <span className="hr-value-chip__badge">{incomplete ? 'incomplete' : 'complete'}</span>
    </div>
  )
}

ScenarioValueChip.propTypes = {
  state: PropTypes.shape({
    hasValue: PropTypes.bool,
    complete: PropTypes.bool,
    value: PropTypes.any,
  }),
  compact: PropTypes.bool,
}
