// useResizable: shared pointer-drag and arrow-key edge-resize logic for the
// fact-explorer's three resizable surfaces (ChatPanel, DetailPanel, EmbeddedAppPanel).
//
// It owns NO geometry state of its own: callers keep their own state (a width
// number, or a {bottom,width,height} box) and pass an `onResize` reducer that
// receives a delta and returns the next state. The hook only handles the
// pointer/keyboard event plumbing, the global cursor/userSelect side effects,
// and per-edge clamping math driven by the config.
//
// ── API ───────────────────────────────────────────────────────────────────────
// useResizable(config) → { beginResize, resizeKeyDown }
//
// config: {
//   edges:      string[]                  // edges this surface exposes, e.g. ['right'] or ['top','bottom','right']
//   getState:   () => State               // current geometry (number width OR a box object)
//   setState:   (next: State) => void     // commit next geometry
//   resize:     (edge, delta, state, bounds) => State
//                                          // pure reducer: given the active edge, the pointer/keyboard
//                                          // delta {dx,dy}, the geometry at gesture start, and the
//                                          // measured `bounds`, return the next geometry.
//   getBounds?: (edge) => object          // measured each gesture start (container size, ceilings, maxes);
//                                          // passed straight through to `resize`. Optional.
//   keyStep?:   number                    // arrow-key nudge in px (default 24)
//   keyDelta?:  (edge, key, step) => {dx,dy} | null
//                                          // map an arrow key to a {dx,dy} delta for `resize`, or null
//                                          // to ignore the key. Required when supporting keyboard.
//   cursorFor?: (edge) => string          // body cursor during a drag (default: 'right' → ew, else ns)
// }
//
// beginResize(edge)  → pointerdown handler (returns an event handler)
// resizeKeyDown(edge) → keydown handler (returns an event handler)
//
// ── Usage: left-edge-docked panel (width-only, DetailPanel / EmbeddedAppPanel) ──
//   const clampW = (w) => Math.min(MAX, Math.max(MIN, w))
//   const { beginResize, resizeKeyDown } = useResizable({
//     edges: ['left'],
//     getState: () => widthRef.current,
//     setState: setWidth,
//     // left edge of a right-docked panel: dragging left (negative dx) widens it
//     resize: (_edge, { dx }, startW) => clampW(startW - dx),
//     keyDelta: (_e, key) => (key === 'ArrowLeft' ? { dx: -1 } : key === 'ArrowRight' ? { dx: 1 } : null),
//     keyStep: 24, // ArrowLeft grows, ArrowRight shrinks
//     cursorFor: () => 'col-resize',
//   })
//   <div role="separator" onPointerDown={beginResize('left')} onKeyDown={resizeKeyDown('left')} />
//
// ── Usage: bottom-anchored multi-edge panel (ChatPanel) ─────────────────────────
//   const { beginResize, resizeKeyDown } = useResizable({
//     edges: ['top', 'bottom', 'right'],
//     getState: () => box,
//     setState: setBox,
//     getBounds: () => {
//       const c = sectionRef.current?.parentElement
//       const containerH = c?.clientHeight ?? window.innerHeight
//       const containerW = c?.clientWidth ?? window.innerWidth
//       return { containerH, maxW: Math.max(MIN_W, containerW * MAX_W_RATIO),
//                topCeiling: headerBottom + TOP_MARGIN }
//     },
//     resize: (edge, { dx, dy }, start, b) => { /* bottom-anchored box math */ },
//     keyDelta: (edge, key, step) => { /* arrows → {dx,dy} per edge */ },
//   })
//   <div onPointerDown={beginResize('top')} onKeyDown={resizeKeyDown('top')} />

import { useCallback } from 'react'

const defaultCursorFor = (edge) => (edge === 'right' || edge === 'left' ? 'ew-resize' : 'ns-resize')

/**
 * Shared edge-resize plumbing. Returns pointerdown / keydown handler factories.
 * @param {object} config see file header for the full contract.
 * @returns {{ beginResize: (edge: string) => (e: PointerEvent) => void,
 *             resizeKeyDown: (edge: string) => (e: KeyboardEvent) => void }}
 */
export function useResizable(config) {
  const {
    getState,
    setState,
    resize,
    getBounds,
    keyStep = 24,
    keyDelta,
    cursorFor = defaultCursorFor,
  } = config

  const beginResize = useCallback(
    (edge) => (e) => {
      e.preventDefault()
      const startX = e.clientX
      const startY = e.clientY
      const start = getState()
      const bounds = getBounds ? getBounds(edge) : undefined

      const onMove = (ev) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        setState(resize(edge, { dx, dy }, start, bounds))
      }
      const prevCursor = document.body.style.cursor
      const prevSelect = document.body.style.userSelect
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.style.cursor = prevCursor
        document.body.style.userSelect = prevSelect
      }
      document.body.style.cursor = cursorFor(edge)
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [getState, setState, resize, getBounds, cursorFor]
  )

  const resizeKeyDown = useCallback(
    (edge) => (e) => {
      if (!keyDelta) return
      const delta = keyDelta(edge, e.key, keyStep)
      if (!delta) return
      e.preventDefault()
      const bounds = getBounds ? getBounds(edge) : undefined
      setState(resize(edge, delta, getState(), bounds))
    },
    [keyDelta, keyStep, getBounds, setState, resize, getState]
  )

  return { beginResize, resizeKeyDown }
}
