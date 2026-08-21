import { useState } from 'react'
import { CATEGORY_STYLE, EDGE_STYLE } from './style.js'

export default function Legend() {
  const [open, setOpen] = useState(true)
  return (
    <aside className="legend">
      <button className="legend__toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Legend
      </button>
      {open && (
        <div className="legend__body">
          {Object.entries(CATEGORY_STYLE).map(([key, s]) => (
            <div key={key} className="legend__row">
              <span
                className="legend__swatch"
                style={{ '--swatch-bg': s.bg, '--swatch-border': s.border }}
              />
              <span>{s.label}</span>
            </div>
          ))}
          <hr className="legend__divider" />
          {Object.entries(EDGE_STYLE).map(([kind, s]) => (
            <div key={kind} className="legend__row">
              <span
                className="legend__edge"
                style={{
                  '--swatch-border': s.stroke,
                  '--swatch-style': s.dashed ? 'dashed' : 'solid',
                }}
              />
              <span>{kind}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
