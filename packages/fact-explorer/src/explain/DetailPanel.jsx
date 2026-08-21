// The M4 slide-out detail panel. Replaces the old DetailStub.
//
// Clicking a node selects its FGM node (the `raw` object carried in node.data).
// Facts get the ported audit-panel derivation view (renderFactExplanation) with
// a raw-XML toggle and navigable dependency names; flow elements get a structured
// read-out of their binding / gate / condition / alert metadata plus raw XML.
//
// The panel docks along the right edge with a draggable resizer on its left boundary,
// similar to EmbeddedAppPanel, so width can be adjusted with pointer or keyboard.
import { useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { useResizable } from '../hooks/useResizable.js'
import ModeToggle from './ModeToggle.jsx'
import FactDetail from './FactDetail.jsx'
import FlowDetail from './FlowDetail.jsx'

const MIN_WIDTH = 320
const MAX_WIDTH = 960
const DEFAULT_WIDTH = 400

const clampWidth = (w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w))

export default function DetailPanel({
  node,
  factLabel,
  onNavigate,
  onExplain,
  scenarioValue,
  onClose,
  drilled,
  onToggleDrill,
  coned,
  onToggleCone,
  rightOffset = 0,
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const widthRef = useRef(width)
  widthRef.current = width

  const { beginResize, resizeKeyDown } = useResizable({
    edges: ['left'],
    getState: () => widthRef.current,
    setState: setWidth,
    // left edge of a right-docked panel: dragging left (negative dx) widens it
    resize: (_edge, { dx }, startW) => clampWidth(startW - dx),
    keyDelta: (_e, key) =>
      key === 'ArrowLeft' ? { dx: -1 } : key === 'ArrowRight' ? { dx: 1 } : null,
    keyStep: 24, // ArrowLeft grows, ArrowRight shrinks
    cursorFor: () => 'col-resize',
  })

  return (
    <aside className="detail-panel" style={{ width, right: rightOffset }}>
      <div
        className="detail-panel__resizer"
        role="separator"
        aria-label="Resize detail panel"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={beginResize('left')}
        onKeyDown={resizeKeyDown('left')}
      />
      <div className="detail-panel__header">
        <div className="detail-panel__modes">
          <ModeToggle
            active={drilled}
            onToggle={onToggleDrill}
            glyph="⌖"
            offLabel="Drill down"
            onLabel="Exit drill-down"
            offTitle="Show only this node, its immediate edges, and its 1st-hop neighbours"
            onTitle="Exit drill-down and return to the full slice"
          />
          <ModeToggle
            active={coned}
            onToggle={onToggleCone}
            glyph="⋔"
            offLabel="Trace dependencies"
            onLabel="Exit dependency trace"
            offTitle="Show only this output's dependency cone — every fact that feeds it, as a layered tree"
            onTitle="Exit the dependency trace and return to the full slice"
          />
          {onExplain && (
            <button
              className="detail-explain"
              onClick={() => onExplain(node)}
              title={
                node.__kind === 'fact'
                  ? 'Explain how this fact is derived from its dependencies'
                  : 'Explain this flow element, the fact it binds/gates on, and its 1-hop neighbours'
              }
            >
              ✨ Explain
            </button>
          )}
        </div>
        <button className="detail-panel__close" onClick={onClose}>
          ✕
        </button>
      </div>
      {node.__kind === 'fact' ? (
        <FactDetail
          fact={node}
          factLabel={factLabel}
          onNavigate={onNavigate}
          scenarioValue={scenarioValue}
        />
      ) : (
        <FlowDetail el={node} />
      )}
    </aside>
  )
}

DetailPanel.propTypes = {
  node: PropTypes.shape({
    __kind: PropTypes.string,
    id: PropTypes.string,
  }).isRequired,
  factLabel: PropTypes.func,
  onNavigate: PropTypes.func,
  onExplain: PropTypes.func,
  scenarioValue: PropTypes.shape({
    hasValue: PropTypes.bool,
    complete: PropTypes.bool,
    value: PropTypes.any,
  }),
  onClose: PropTypes.func.isRequired,
  drilled: PropTypes.bool,
  onToggleDrill: PropTypes.func.isRequired,
  coned: PropTypes.bool,
  onToggleCone: PropTypes.func.isRequired,
  rightOffset: PropTypes.number,
}
