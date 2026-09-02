// The control panel's Search section: highlights matching nodes on the canvas. The counter reports
// on-canvas vs. whole-graph hits, and ‹ › step through the on-canvas matches.
//
// "Find:" with the input beside it became a titled section with a hint above a full-width USWDS
// input. The panel's three sections are one shape, and this is the
// first of them.
//
// The input is a typeahead, and it is the chat dock's fact picker (canvas/ChatPanel.jsx) in
// another place: the same `list=` datalist of the same fact paths, filtered by the browser as you
// type. Two inputs that both mean "name a fact" should offer the same list and take the same
// keystrokes, and a datalist is also how the keyboard, the touch keyboard's suggestion strip and
// the screen reader get the browser's implementation of that rather than ours.
//
// Paths only — no question text, no headings. What goes in the box is an address, and a screen's
// wording is not one: it is a sentence, it is not unique, and it cannot be re-typed from memory.
// Searching still finds flow elements; they highlight on the canvas and the ‹ › buttons walk them,
// which is what search over question content is for.
//
// Choosing a row does more than fill the box: it JUMPS to that fact — see onPick in
// FactExplorer.jsx, which switches slice if the fact is not on the current one. Highlighting a
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
  // A pick is an ordinary change event that happens to carry a suggestion's exact path, so this is
  // where the two are told apart. Typing a whole path by hand counts as a pick, which is the same
  // rule <datalist> itself works by and is what a reader who does that means anyway.
  const change = (value) => {
    onQuery(value)
    const hit = suggestions.find((s) => s.path === value)
    if (hit) onPick(hit.id)
  }

  return (
    <section className="fe-section">
      <h3 className="fe-section__title">Search</h3>
      <p className="fe-section__hint" id="fe-search-hint">
        Find nodes by question content, fact path, or key. Choose a fact path to jump to it.
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
            onQuery(suggestions[0].path)
            onPick(suggestions[0].id)
          }
        }}
      />
      {/* Bare <option value>, as the chat dock's picker has: the path is the whole of what a row
          says, and it is what change() maps back to a fact. */}
      <datalist id={LIST_ID}>
        {suggestions.map((s) => (
          <option key={s.id} value={s.path} />
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
  /** Fact paths, each with the node id it addresses. */
  suggestions: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      path: PropTypes.string.isRequired,
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
