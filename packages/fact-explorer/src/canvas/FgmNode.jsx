import { useState } from 'react'
import PropTypes from 'prop-types'
import { Handle, Position } from '@xyflow/react'
import {
  CATEGORY_STYLE,
  NODE_FALLBACK,
  SELECTION,
  ANNOTATION_TAG_STYLE,
  NODE_SHAPE,
  OCTAGON_CLIP,
  INPUT_TYPE_BADGE,
  SEARCH_HIGHLIGHT,
  FOCAL_HIGHLIGHT,
  HUB_BADGE,
  SCENARIO_STATUS,
  EXPLAIN_BADGE,
} from './style.js'
import { useAnnotation } from '../annotate/hooks.js'
import { ScenarioValueChip } from '../explain/scenarioValue.jsx'

// Per-category node renderer (M6 / 6c). One component dispatches on the shape
// declared in style.js (NODE_SHAPE): rect (facts, fg-set, blocks), octagon
// (knockout alerts), pill (alerts / section gates). Container shapes ('frame')
// render through FrameNode instead. fg-set nodes get an input-type badge.
//
// Carried-over behaviour: M2 +1-hop context dimming, M5 annotation badge, and
// (new) M6 search highlight ring / dim — all driven off node.data flags, never
// off hard-coded colours.
export default function FgmNode({ id, data, selected }) {
  const sty = CATEGORY_STYLE[data.category] ?? NODE_FALLBACK
  const shape = NODE_SHAPE[data.category] ?? 'rect'
  const note = useAnnotation(id)
  const [explainHover, setExplainHover] = useState(false)

  const octagon = shape === 'octagon'
  const dimmed = data.context || data.searchDim || data.scenarioDim
  const opacity = dimmed
    ? data.scenarioDim
      ? SCENARIO_STATUS.dimOpacity
      : data.searchDim
        ? SEARCH_HIGHLIGHT.dimOpacity
        : 0.7
    : data.hub
      ? HUB_BADGE.dim
      : 1

  const badge = data.raw?.tag === 'fg-set' ? INPUT_TYPE_BADGE[data.raw?.inputType] : null

  // Scenario overlay (N4): an active knockout gets a red ring, an incomplete seen
  // fact an amber ring — both from SCENARIO_STATUS, layered with the search ring.
  const scenarioTok = data.scenarioIncomplete
    ? SCENARIO_STATUS.incomplete
    : SCENARIO_STATUS[data.scenarioStatus]
  const scenarioRing = scenarioTok ? `0 0 0 ${scenarioTok.ringWidth}px ${scenarioTok.ring}` : null

  const ring = data.match ? `0 0 0 ${SEARCH_HIGHLIGHT.ringWidth}px ${SEARCH_HIGHLIGHT.ring}` : null
  const focalRing = data.focal
    ? `0 0 0 ${FOCAL_HIGHLIGHT.ringWidth}px ${FOCAL_HIGHLIGHT.ring}`
    : null
  const selectedRing = selected ? `0 0 0 ${SELECTION.width}px ${SELECTION.color}` : null

  // octagon uses a clip-path; an outline would be clipped too, so emphasis
  // (selection / search ring) rides on box-shadow which respects clipping.
  const boxShadow = octagon
    ? [selectedRing, focalRing, ring, scenarioRing].filter(Boolean).join(', ') || undefined
    : [focalRing, ring, scenarioRing].filter(Boolean).join(', ') || undefined
  const outline = octagon
    ? 'none'
    : selected
      ? `${SELECTION.width}px solid ${SELECTION.color}`
      : 'none'

  return (
    <div
      className={`fgm-node${octagon ? ' fgm-node--octagon' : ''}`}
      style={{
        '--node-bg': sty.bg,
        '--node-border': sty.border,
        '--node-border-style': data.context ? 'dashed' : 'solid',
        '--node-radius': shape === 'pill' ? '18px' : '8px',
        '--node-opacity': opacity,
        '--node-outline': outline,
        '--node-shadow': boxShadow ?? 'none',
        '--node-clip': octagon ? OCTAGON_CLIP : undefined,
      }}
    >
      {note && (
        <span
          className="fgm-node__annotation"
          title={`${ANNOTATION_TAG_STYLE[note.tag]?.label ?? note.tag}: ${note.text}`}
          style={{ '--badge-bg': ANNOTATION_TAG_STYLE[note.tag]?.color ?? '#6b7785' }}
        />
      )}
      {data.hub && (
        <span
          className="fgm-node__hub"
          title={HUB_BADGE.label}
          style={{ '--badge-border': sty.border }}
        >
          {HUB_BADGE.glyph}
        </span>
      )}
      {badge && (
        <span
          className="fgm-node__input-badge"
          title={`Input: ${badge.label}`}
          style={{ '--badge-border': sty.border, '--badge-color': sty.border }}
        >
          {badge.glyph}
        </span>
      )}
      {data.onExplain && (
        <button
          className={`nodrag fgm-node__explain${explainHover ? ' fgm-node__explain--active' : ''}`}
          title={EXPLAIN_BADGE.label}
          aria-label={EXPLAIN_BADGE.label}
          onClick={(e) => {
            e.stopPropagation()
            data.onExplain(data.raw)
          }}
          onMouseEnter={() => setExplainHover(true)}
          onMouseLeave={() => setExplainHover(false)}
          onFocus={() => setExplainHover(true)}
          onBlur={() => setExplainHover(false)}
          style={{
            '--badge-bg': explainHover ? EXPLAIN_BADGE.activeBg : EXPLAIN_BADGE.bg,
            '--badge-color': explainHover ? EXPLAIN_BADGE.activeColor : EXPLAIN_BADGE.color,
            '--badge-border': explainHover ? EXPLAIN_BADGE.activeBorder : EXPLAIN_BADGE.border,
          }}
        >
          {EXPLAIN_BADGE.glyph}
        </button>
      )}
      <Handle type="target" position={Position.Left} style={{ background: sty.border }} />
      <div>
        <div className="fgm-node__title">{data.title}</div>
        {data.subtitle && <div className="fgm-node__subtitle">{data.subtitle}</div>}
        {data.scenarioValueState?.hasValue && (
          <ScenarioValueChip state={data.scenarioValueState} compact />
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: sty.border }} />
    </div>
  )
}

FgmNode.propTypes = {
  id: PropTypes.string.isRequired,
  selected: PropTypes.bool,
  data: PropTypes.shape({
    category: PropTypes.string,
    context: PropTypes.bool,
    searchDim: PropTypes.bool,
    scenarioDim: PropTypes.bool,
    hub: PropTypes.bool,
    raw: PropTypes.shape({
      tag: PropTypes.string,
      inputType: PropTypes.string,
    }),
    scenarioIncomplete: PropTypes.bool,
    scenarioStatus: PropTypes.string,
    match: PropTypes.bool,
    focal: PropTypes.bool,
    onExplain: PropTypes.func,
    title: PropTypes.node,
    subtitle: PropTypes.node,
    scenarioValueState: PropTypes.shape({
      hasValue: PropTypes.bool,
      complete: PropTypes.bool,
      value: PropTypes.any,
    }),
  }).isRequired,
}
