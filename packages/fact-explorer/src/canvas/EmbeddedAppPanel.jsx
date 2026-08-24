import { useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { useResizable } from '../hooks/useResizable.js'
import { embeddableViews } from '../model/apps.js'

// Embedded app panel (N6): a dockable, same-origin iframe (served through the Vite
// proxy at the app's own base path), so an analyst never leaves Fact Explorer. The
// iframe shares the flow runtime's serialized-graph sessionStorage key and the
// BroadcastChannel with Fact Explorer (bridge.js), so a scenario loaded in Fact
// Explorer reflects here, and answering a question here flows back to Fact Explorer.
//
// Which view opens, out of whichever destinations this app actually has (embeddableViews prunes
// by capability), is resolved automatically
// when the panel docks; an app built without --allScreens simply has fewer to choose
// from. The panel docks along the right edge with a draggable resizer on its left
// boundary (mirroring the audit-panel resizer in a Form Builder app), so it never
// collides with the canvas.
//
// What the frame shows is the *product*, not a second workspace over it: taxpert stands its own
// chrome down inside another page's frame (`html.taxpert-embedded`), so the
// app's global nav, tool dock and screens toolbar are absent here. Nothing on this side has to ask
// for that, and nothing is appended to the URL to get it, which matters because the flow navigates:
// answering a question loads the next screen at an address Fact Explorer never wrote.
//
// Which view is docked is the host's state (FactExplorer): the Display modal's "Show product
// experience side-by-side" is the only thing that opens it. There used to be a banner of manual
// tabs alongside that checkbox, which meant two surfaces disagreed about whose preference this was.

const MIN_WIDTH = 320
const MAX_WIDTH = 960
const DEFAULT_WIDTH = 560
const KEY_STEP = 24

const clampWidth = (w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w))

/** The destination the Display modal's checkbox opens, when the app has it. */
const PRODUCT_VIEW = 'product-experience'

export default function EmbeddedAppPanel({ app, onInsetChange, docked = false, onDockedChange }) {
  // { [destinationId]: { label, src } } for whichever destinations this app actually has.
  const VIEWS = useMemo(
    () =>
      Object.fromEntries(embeddableViews(app).map((v) => [v.id, { label: v.label, src: v.href }])),
    [app]
  )
  const [view, setView] = useState(null) // null | a key of VIEWS
  // Bump to force the iframe to reload (re-reads sessionStorage['factGraph']).
  const [reloadKey, setReloadKey] = useState(0)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [resizing, setResizing] = useState(false)
  const widthRef = useRef(width)
  widthRef.current = width

  // Report how much of the right edge this panel occupies (0 when closed) so the
  // host can dock the DetailPanel immediately to its left instead of behind it.
  useEffect(() => {
    onInsetChange?.(view ? width : 0)
  }, [view, width, onInsetChange])
  useEffect(() => () => onInsetChange?.(0), [onInsetChange])

  const close = () => {
    setView(null)
    onDockedChange?.(false)
  }

  // The Display modal's "Show product experience side-by-side": ticked, dock the product experience
  // (an app without one, none today, but `embeddableViews` prunes by capability, docks
  // whatever it does have); unticked, close whatever is docked. Only acts on a *change* of the prop,
  // so the panel's own close button is not immediately overruled by a prop that hasn't caught up yet.
  useEffect(() => {
    if (docked && !view) {
      setView(PRODUCT_VIEW in VIEWS ? PRODUCT_VIEW : (Object.keys(VIEWS)[0] ?? null))
      setReloadKey((k) => k + 1)
    } else if (!docked && view) {
      setView(null)
    }
    // `view` is deliberately absent: this reacts to the checkbox, not to the panel's own opening
    // and closing, which already report back through onDockedChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docked, VIEWS])

  // Left-edge resize. The resizer sits on the panel's left boundary, so dragging
  // left (negative dx) widens it; the shared hook owns the pointer/keyboard
  // plumbing and the global cursor / userSelect side effects. The `resizing`
  // flag (set on pointerdown, cleared on pointerup) drives the active-state
  // background + the iframe pointer-events suppression.
  const { beginResize, resizeKeyDown } = useResizable({
    edges: ['left'],
    getState: () => widthRef.current,
    setState: setWidth,
    resize: (_edge, { dx }, startW) => clampWidth(startW - dx),
    keyDelta: (_e, key) =>
      key === 'ArrowLeft' ? { dx: -1 } : key === 'ArrowRight' ? { dx: 1 } : null,
    keyStep: KEY_STEP, // ArrowLeft grows, ArrowRight shrinks
    cursorFor: () => 'col-resize',
  })

  const onResizerPointerDown = (e) => {
    setResizing(true)
    beginResize('left')(e)
    const onUp = () => {
      setResizing(false)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointerup', onUp)
  }

  // Resolved rather than indexed at each use: a selected view whose destination the current app
  // does not have (Browse All, on an app built without --allScreens) closes the panel instead of
  // rendering an iframe pointed at undefined.
  const activeView = view ? (VIEWS[view] ?? null) : null

  if (!activeView) return null

  return (
    <div className="embedded-panel" style={{ '--panel-width': `${width}px` }}>
      <div
        className={`embedded-panel__resizer${resizing ? ' embedded-panel__resizer--active' : ''}`}
        role="separator"
        aria-label="Resize embedded panel"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={onResizerPointerDown}
        onKeyDown={resizeKeyDown('left')}
      />
      <div className="embedded-panel__header">
        <strong className="embedded-panel__title">{activeView.label}</strong>
        <span className="embedded-panel__url">{activeView.src}</span>
        <button
          className="embedded-panel__reload embedded-tab"
          onClick={() => setReloadKey((k) => k + 1)}
          title="Reload (re-reads the shared fact graph)"
        >
          ⟳ Reload
        </button>
        <button className="embedded-tab" onClick={close} title="Close embedded panel">
          ✕ Close
        </button>
      </div>
      <iframe
        key={reloadKey}
        className={`embedded-panel__frame${resizing ? ' embedded-panel__frame--resizing' : ''}`}
        title={activeView.label}
        src={activeView.src}
      />
    </div>
  )
}

EmbeddedAppPanel.propTypes = {
  app: PropTypes.object.isRequired,
  onInsetChange: PropTypes.func,
  docked: PropTypes.bool,
  onDockedChange: PropTypes.func,
}
