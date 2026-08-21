// The control panel's Layers section: which information layers the canvas draws.
//
// One control replacing two that overlapped. The M3 layer checkboxes (Flow / Facts / Cross-layer
// edges) turned whole layers on and off; the M6 facet checkboxes, in a collapsible block below
// them, narrowed *within* a layer by tag, fact kind and edge kind. Read together they said the same
// thing twice — hiding the flow layer and unticking every flow tag are the same picture — so they
// are now one nested control: a parent switch per layer, with that layer's kinds beneath it.
//
// The two halves stay separate in the model, which is what makes the nesting cheap:
//   · the switch is filter.js's `filters.{flow,facts,edges}` — the layer, dropped whole
//   · the boxes are facets.js's `{flowTags,factKinds,edgeKinds}` — kinds within the layer
//
// So flipping a switch off never edits the boxes. They render unticked and disabled because the
// layer they belong to is gone, and flipping it back on restores exactly the selection that was
// there before — no remembered copy, because nothing was overwritten.
import PropTypes from 'prop-types'
import { EDGE_KINDS } from '../../model/fgm.js'

const FACT_KINDS = ['writable', 'derived']

// Edge kinds are spelled as the FGM spells them everywhere else (the Legend, DetailPanel), except
// that a hyphen in a checkbox label reads as a typo rather than as an identifier.
const EDGE_LABELS = new Map([['knocks-out', 'knocks out']])

/**
 * @param {object} props
 * @param {{flow:boolean, facts:boolean, edges:boolean}} props.filters the parent switches
 * @param {(filters: object) => void} props.onFiltersChange
 * @param {object} props.facets the current facet selection
 * @param {{flowTags: string[]}} props.defaults `defaultFacets(graph)` — the flow-tag universe the
 *   boxes are drawn from. A prop rather than an import of `FLOW_TAGS`, because which tags exist is
 *   a property of the loaded graph (an app can register its own node types).
 * @param {(facets: object) => void} props.onFacetsChange
 * @param {boolean} [props.disabled] "Knockouts" (the Filter section) is a view of its own — the
 *   alerts and the facts they knock out — so the layers it composes are not selectable under it.
 */
export default function LayerControls({
  filters,
  onFiltersChange,
  facets,
  defaults,
  onFacetsChange,
  disabled = false,
}) {
  const groups = [
    { id: 'flow', title: 'Flow elements', facetKey: 'flowTags', values: defaults.flowTags },
    { id: 'facts', title: 'Facts', facetKey: 'factKinds', values: FACT_KINDS },
    { id: 'edges', title: 'Connectors', facetKey: 'edgeKinds', values: EDGE_KINDS },
  ]

  const toggleLayer = (id) => () => onFiltersChange({ ...filters, [id]: !filters[id] })

  const toggleKind = (facetKey, value) => (e) => {
    const next = new Set(facets[facetKey])
    if (e.target.checked) next.add(value)
    else next.delete(value)
    onFacetsChange({ ...facets, [facetKey]: [...next] })
  }

  return (
    <section className="fe-section">
      <h3 className="fe-section__title">Layers</h3>
      <p className="fe-section__hint">Customize information layers.</p>

      {groups.map((group) => {
        const on = filters[group.id] && !disabled
        return (
          <fieldset className="fe-layer usa-fieldset" key={group.id} disabled={disabled}>
            <legend className="fe-layer__legend">
              <span className="fe-layer__title">{group.title}</span>
              {/* The switch is the layer's own on/off, so it says so itself rather than through a
                  class the JS also has to set: `aria-checked` is the state and the stylesheet
                  draws from it. */}
              <button
                type="button"
                role="switch"
                className="fe-switch"
                aria-checked={filters[group.id]}
                aria-label={`Show ${group.title}`}
                disabled={disabled}
                onClick={toggleLayer(group.id)}
              >
                <span className="fe-switch__track" aria-hidden="true" />
              </button>
            </legend>

            {/* Gone with the layer, not greyed out under it. The kinds narrow *within* a layer, so
                with the layer off there is nothing for them to narrow — a column of unticked,
                disabled boxes read as a list of things you had switched off one by one, when in fact
                the selection underneath is untouched and comes back exactly as it was. Hiding says
                what is true: this layer is not being drawn, so how it would be drawn is not a
                question yet. The inputs stay mounted-but-hidden rather than unmounted, so `facets`
                is still the only place that selection lives. */}
            <div className="fe-layer__options" hidden={!on}>
              {group.values.map((value) => {
                const id = `fe-layer-${group.id}-${value}`
                return (
                  <div className="usa-checkbox fe-option" key={value}>
                    <input
                      className="usa-checkbox__input usa-checkbox__input--tile"
                      id={id}
                      type="checkbox"
                      checked={on && facets[group.facetKey].includes(value)}
                      disabled={!on}
                      onChange={toggleKind(group.facetKey, value)}
                    />
                    <label className="usa-checkbox__label" htmlFor={id}>
                      {group.facetKey === 'edgeKinds' ? (EDGE_LABELS.get(value) ?? value) : value}
                    </label>
                  </div>
                )
              })}
            </div>
          </fieldset>
        )
      })}
    </section>
  )
}

LayerControls.propTypes = {
  filters: PropTypes.shape({
    flow: PropTypes.bool,
    facts: PropTypes.bool,
    edges: PropTypes.bool,
  }).isRequired,
  onFiltersChange: PropTypes.func.isRequired,
  facets: PropTypes.shape({
    flowTags: PropTypes.arrayOf(PropTypes.string),
    factKinds: PropTypes.arrayOf(PropTypes.string),
    edgeKinds: PropTypes.arrayOf(PropTypes.string),
  }).isRequired,
  defaults: PropTypes.shape({
    flowTags: PropTypes.arrayOf(PropTypes.string),
  }).isRequired,
  onFacetsChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
}
