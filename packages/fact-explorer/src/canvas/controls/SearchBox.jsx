// The control panel's Search section: highlights matching nodes on the canvas. The counter reports
// on-canvas vs. whole-graph hits, and ‹ › step through the on-canvas matches.
//
// "Find:" with the input beside it became a titled section with a hint above a full-width USWDS
// input. The panel's three sections are one shape, and this is the
// first of them.
import PropTypes from 'prop-types'

export default function SearchBox({ query, onQuery, inView, total, active, cursor, onStep }) {
  return (
    <section className="fe-section">
      <h3 className="fe-section__title">Search</h3>
      <p className="fe-section__hint" id="fe-search-hint">
        Find nodes by question content, fact path, or key
      </p>
      <input
        className="usa-input fe-search__input"
        type="search"
        aria-label="Search nodes"
        aria-describedby="fe-search-hint"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {active && (
        <div className="fe-search__matches">
          <span className="fe-search__count">
            {inView ? `${cursor + 1}/${inView}` : '0'} in view · {total} total
          </span>
          <button
            className="fe-search__step"
            type="button"
            onClick={() => onStep(-1)}
            disabled={!inView}
            title="Previous match"
          >
            ‹
          </button>
          <button
            className="fe-search__step"
            type="button"
            onClick={() => onStep(1)}
            disabled={!inView}
            title="Next match"
          >
            ›
          </button>
          <button
            className="fe-search__step"
            type="button"
            onClick={() => onQuery('')}
            title="Clear search"
          >
            ✕
          </button>
        </div>
      )}
    </section>
  )
}

SearchBox.propTypes = {
  query: PropTypes.string.isRequired,
  onQuery: PropTypes.func.isRequired,
  inView: PropTypes.number,
  total: PropTypes.number,
  active: PropTypes.bool,
  cursor: PropTypes.number,
  onStep: PropTypes.func.isRequired,
}
