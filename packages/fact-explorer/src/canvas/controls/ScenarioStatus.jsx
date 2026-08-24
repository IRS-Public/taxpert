// What the control panel still says about the loaded scenario: that one is loading, that loading it
// failed, and with AI explanations on, the Explain button that summarizes its outcome.
//
// This is the remainder of a bigger control. Picking *which* scenario to load goes through the real
// shared <taxpert-scenario-modal> (opened from the global nav's Scenario button), which also names
// the loaded one, so the "Scenario: none" caption here was a second, staler copy of that. And
// *how* it renders on the canvas is one checkbox now, "Reveal items skipped in scenarios", in the
// Display options modal; the Off/Dim/Hide segmented buttons it replaced offered a third state that
// only ever meant "no scenario loaded".
//
// The row renders nothing at all when there is nothing to report, so a canvas with no scenario has
// no dead control on it.
import PropTypes from 'prop-types'

export default function ScenarioStatus({ scenario, busy, error, onSummarize }) {
  const canExplain = !!onSummarize && !!scenario
  if (!busy && !error && !canExplain) return null

  return (
    <div className="fe-scenario-status">
      {busy && <span className="fe-scenario-status__busy">loading scenario…</span>}
      {canExplain && (
        <button
          className="usa-button usa-button--outline fe-scenario-status__explain"
          type="button"
          onClick={onSummarize}
          title="Explain whether the taxpayer reaches the end of the flow or where they are disqualified"
        >
          ✨ Explain scenario
        </button>
      )}
      {error && <p className="usa-error-message fe-scenario-status__error">{error}</p>}
    </div>
  )
}

ScenarioStatus.propTypes = {
  scenario: PropTypes.shape({ filename: PropTypes.string }),
  busy: PropTypes.bool,
  error: PropTypes.string,
  onSummarize: PropTypes.func,
}
