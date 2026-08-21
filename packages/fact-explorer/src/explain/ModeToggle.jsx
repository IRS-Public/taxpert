// Canvas-mode toggle shared by drill-down (ego mini-graph) and dependency-cone
// (rooted dependency tree). Both swap the slice for a focused view of this node;
// a no-op if the host didn't wire onToggle (e.g. future read-only embeds).
import PropTypes from 'prop-types'

export default function ModeToggle({
  active,
  onToggle,
  glyph,
  offLabel,
  onLabel,
  offTitle,
  onTitle,
}) {
  if (!onToggle) return null
  return (
    <button
      className={`detail-toggle${active ? ' detail-toggle--active' : ''}`}
      onClick={() => onToggle(!active)}
      title={active ? onTitle : offTitle}
    >
      {glyph} {active ? onLabel : offLabel}
    </button>
  )
}

ModeToggle.propTypes = {
  active: PropTypes.bool,
  onToggle: PropTypes.func,
  glyph: PropTypes.node.isRequired,
  offLabel: PropTypes.node.isRequired,
  onLabel: PropTypes.node.isRequired,
  offTitle: PropTypes.string,
  onTitle: PropTypes.string,
}
