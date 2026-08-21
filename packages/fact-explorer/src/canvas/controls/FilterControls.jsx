// The control panel's Filter section: what part of the graph is in view, by scope and by type.
//
// Two controls that used to sit apart merged here, because both answer "how much of the graph am I
// looking at": the slice picker (one flow page / one fact-dictionary file / the whole graph, plus
// its +1-hop context box) and the "knockouts only" facet, which was the first row of a collapsible
// Filters block under the layer checkboxes. Narrowing *what is in view* is this section; narrowing
// *which kinds are drawn* is the Layers section below it.
import PropTypes from 'prop-types'

export default function FilterControls({
  options,
  value,
  onChange,
  neighbors,
  onNeighborsChange,
  knockoutsOnly,
  onKnockoutsOnlyChange,
}) {
  // Slice options arrive flat, each carrying its group name ('Flow pages', 'Fact files', …); the
  // <select> shows them as <optgroup>s, and an option with no group stands on its own.
  const groups = []
  for (const option of options) {
    let group = groups.find((g) => g.label === option.group)
    if (!group) {
      group = { label: option.group, items: [] }
      groups.push(group)
    }
    group.items.push(option)
  }

  // The whole graph already *is* every node, so there is no neighbouring context to pull in.
  const isFull = value === 'full'

  return (
    <section className="fe-section">
      <h3 className="fe-section__title">Filter</h3>
      <p className="fe-section__hint">Choose options for narrowing view by scope or type.</p>

      <div className="usa-form-group fe-field">
        <label className="usa-label fe-field__label" htmlFor="fe-scope">
          Scope
        </label>
        <select
          className="usa-select"
          id="fe-scope"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {groups.map((group) =>
            group.label ? (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              group.items.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))
            )
          )}
        </select>
      </div>

      <div className="usa-checkbox fe-option">
        <input
          className="usa-checkbox__input usa-checkbox__input--tile"
          id="fe-neighbors"
          type="checkbox"
          checked={neighbors && !isFull}
          disabled={isFull}
          onChange={(e) => onNeighborsChange(e.target.checked)}
        />
        <label className="usa-checkbox__label" htmlFor="fe-neighbors">
          Reveal direct connections (show node+1)
        </label>
      </div>

      <p className="fe-field__label fe-field__label--standalone">Type</p>
      <div className="usa-checkbox fe-option">
        <input
          className="usa-checkbox__input usa-checkbox__input--tile"
          id="fe-knockouts"
          type="checkbox"
          checked={knockoutsOnly}
          onChange={(e) => onKnockoutsOnlyChange(e.target.checked)}
        />
        <label className="usa-checkbox__label" htmlFor="fe-knockouts">
          Knockouts
        </label>
      </div>
    </section>
  )
}

FilterControls.propTypes = {
  options: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string,
      label: PropTypes.string,
      group: PropTypes.string,
    })
  ).isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  neighbors: PropTypes.bool,
  onNeighborsChange: PropTypes.func.isRequired,
  knockoutsOnly: PropTypes.bool,
  onKnockoutsOnlyChange: PropTypes.func.isRequired,
}
