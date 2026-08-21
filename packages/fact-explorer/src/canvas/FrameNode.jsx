import { Handle, Position } from '@xyflow/react'
import PropTypes from 'prop-types'
import { CATEGORY_STYLE, NODE_FALLBACK, SELECTION, SEARCH_HIGHLIGHT } from './style.js'
import { useAnnotation } from '../annotate/hooks.js'

// Container frame for fg-collection / fg-detail (M6 / 6c). Rendered as a dashed,
// translucent backdrop sized by layout.js to bound its child elements. The
// children are ordinary top-level nodes positioned inside it (we deliberately
// do NOT use React Flow parenting, so M5 drag/persist stays uniform across all
// nodes); layout.js orders frames first so they paint behind their children.
export default function FrameNode({ id, data, selected }) {
  const sty = CATEGORY_STYLE[data.category] ?? NODE_FALLBACK
  const note = useAnnotation(id)
  const dimmed = data.context || data.searchDim
  const opacity = dimmed ? (data.searchDim ? SEARCH_HIGHLIGHT.dimOpacity : 0.5) : 0.55
  const outline = selected
    ? `${SELECTION.width}px solid ${SELECTION.color}`
    : data.match
      ? `${SEARCH_HIGHLIGHT.ringWidth}px solid ${SEARCH_HIGHLIGHT.ring}`
      : 'none'
  return (
    <div
      className="frame-node"
      style={{
        '--node-bg': sty.bg,
        '--node-border': sty.border,
        '--node-opacity': opacity,
        '--node-outline': outline,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: sty.border }} />
      <div className="frame-node__title">
        <span>{data.title}</span>
        {note && <span className="frame-node__annotation" title={note.text} />}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: sty.border }} />
    </div>
  )
}

FrameNode.propTypes = {
  id: PropTypes.string.isRequired,
  selected: PropTypes.bool,
  data: PropTypes.shape({
    category: PropTypes.string,
    context: PropTypes.bool,
    searchDim: PropTypes.bool,
    match: PropTypes.bool,
    title: PropTypes.node,
  }).isRequired,
}
