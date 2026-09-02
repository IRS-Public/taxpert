// The control panel's Search section: highlights matching nodes on the canvas. The counter reports
// on-canvas vs. whole-graph hits, and ‹ › step through the on-canvas matches.
//
// "Find:" with the input beside it became a titled section with a hint above a full-width USWDS
// input. The panel's three sections are one shape, and this is the
// first of them.
//
// The input is a typeahead, the same shape as the chat dock's fact picker (canvas/ChatPanel.jsx):
// a `list=` datalist the browser renders and filters as you type. Two reasons it is a datalist
// here rather than a listbox of our own. It is what the picker in this same app already is, so
// the two search-ish inputs behave alike; and picking a row is a plain change event, which means
// the keyboard, the touch keyboard's suggestion strip and the screen reader all get the browser's
// implementation rather than ours.
//
// Choosing a row does more than fill the box: it JUMPS to that node — see onPick in
// FactExplorer.jsx, which switches slice if the node is not on the current one. Highlighting a
// match the reader cannot navigate to is what the search box used to do, and on a graph cut into
// slices that is most matches.
import PropTypes from 'prop-types'

const LIST_ID = 'fe-search-options'

export default function SearchBox({
  query,
  onQuery,
  onPick,
  // Default here rather than in defaultProps: React 19 ignores defaultProps on a function
  // component.
  suggestions = [],
  inView,
  total,
  active,
  cursor,
  onStep,
  miss,
}) {
  // A pick is an ordinary change event that happens to carry a suggestion's exact label, so this
  // is where the two are told apart. Typing the whole of a label by hand counts as a pick, which
  // is the same rule <datalist> itself works by and is what a reader who does that means anyway.
  const change = (value) => {
    onQuery(value)
    const hit = suggestions.find((s) => s.label === value)
    if (hit) onPick(hit.id)
  }

  return (
    <section className="fe-section">
      <h3 className="fe-section__title">Search</h3>
      <p className="fe-section__hint" id="fe-search-hint">
        Find nodes by question content, fact path, or key. Choose one to jump to it.
      </p>
      <input
        className="usa-input fe-search__input"
        type="search"
        list={LIST_ID}
        aria-label="Search nodes"
        aria-describedby="fe-search-hint"
        autoComplete="off"
        value={query}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          // Enter takes the first suggestion, so the whole interaction can be done from the
          // keyboard without opening the list.
          if (e.key === 'Enter' && suggestions.length) {
            e.preventDefault()
            onQuery(suggestions[0].label)
            onPick(suggestions[0].id)
          }
        }}
      />
      {/* `label` is the browser's secondary line where it renders one, and ignored where it does
          not; `value` is what the input receives, and is what change() maps back to a node. */}
      <datalist id={LIST_ID}>
        {suggestions.map((s) => (
          <option key={s.id} value={s.label} label={s.hint} />
        ))}
      </datalist>
      {miss && (
        <p className="fe-search__miss" role="status">
          {miss}
        </p>
      )}
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
  /** Jump to a node id: select it, bring it into view, centre it. */
  onPick: PropTypes.func.isRequired,
  suggestions: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      hint: PropTypes.string,
    })
  ),
  inView: PropTypes.number,
  total: PropTypes.number,
  active: PropTypes.bool,
  cursor: PropTypes.number,
  onStep: PropTypes.func.isRequired,
  /** Why the last jump could not be shown on the canvas, if it could not. */
  miss: PropTypes.string,
}
