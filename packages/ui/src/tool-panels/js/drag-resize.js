// Pointer-drag and keyboard-step plumbing shared by everything draggable in the dock.
//
// Move and up are bound on `window` so a drag that outruns the cursor still tracks, a body class
// carries the cursor and `user-select: none` for the duration, and every handle takes arrow keys as
// well as the pointer. See ../../../../../docs/internals/tool-panels.md.

const KEYBOARD_STEP = 24

/**
 * Turn `handle` into a pointer-drag source. `onMove` receives deltas from the press point, not the
 * previous frame, so a handler never accumulates rounding drift.
 *
 * @param {Element} handle
 * @param {object} options
 * @param {string} [options.bodyClass] class set on <body> for the duration (cursor + user-select)
 * @param {(event: PointerEvent) => any} [options.onStart] its return value is passed back as `start`
 * @param {(delta: {dx:number, dy:number, x:number, y:number}, start:any, event:PointerEvent) => void} options.onMove
 * @param {(start:any, event:PointerEvent) => void} [options.onEnd]
 * @returns {() => void} unbind
 */
export function onPointerDrag (handle, { bodyClass, onStart, onMove, onEnd }) {
  const onPointerDown = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    const origin = { x: event.clientX, y: event.clientY }
    const start = onStart?.(event)
    if (start === false) return

    try {
      handle.setPointerCapture(event.pointerId)
    } catch { /* a synthetic event in a test has no capture to take */ }
    if (bodyClass) document.body.classList.add(bodyClass)

    const move = (moveEvent) => {
      onMove(
        {
          dx: moveEvent.clientX - origin.x,
          dy: moveEvent.clientY - origin.y,
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        },
        start,
        moveEvent
      )
    }

    const up = (upEvent) => {
      try {
        handle.releasePointerCapture(event.pointerId)
      } catch { /* see above */ }
      if (bodyClass) document.body.classList.remove(bodyClass)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      onEnd?.(start, upEvent)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  handle.addEventListener('pointerdown', onPointerDown)
  return () => handle.removeEventListener('pointerdown', onPointerDown)
}

/**
 * Arrow-key parity for a resize handle: the keyboard equivalent of dragging it one step.
 * Horizontal handles (`aria-orientation="horizontal"`) take Up/Down, vertical ones Left/Right.
 * @param {Element} handle
 * @param {(delta: {dx:number, dy:number}) => void} onStep
 * @param {number} [step]
 */
export function onKeyResize (handle, onStep, step = KEYBOARD_STEP) {
  handle.addEventListener('keydown', (event) => {
    const horizontal = handle.getAttribute('aria-orientation') === 'horizontal'
    const delta = { dx: 0, dy: 0 }
    if (!horizontal && event.key === 'ArrowLeft') delta.dx = -step
    else if (!horizontal && event.key === 'ArrowRight') delta.dx = step
    else if (horizontal && event.key === 'ArrowUp') delta.dy = -step
    else if (horizontal && event.key === 'ArrowDown') delta.dy = step
    else return
    event.preventDefault()
    onStep(delta)
  })
}

/**
 * Split a pair of flex ratios by where their shared edge was dragged to. The pair keeps its combined
 * share of the parent, so dragging one splitter never disturbs a third sibling.
 *
 * @param {{flex:number, size:number}} first  ratio and current px size of the leading box
 * @param {{flex:number, size:number}} second ratio and current px size of the trailing box
 * @param {number} delta px the shared edge moved (positive grows `first`)
 * @param {number} min minimum px for either box
 * @returns {[number, number]} the new ratios
 */
export function resizePair (first, second, delta, min) {
  const total = first.size + second.size
  const sum = first.flex + second.flex
  if (total <= 0 || sum <= 0) return [first.flex, second.flex]

  const firstSize = Math.min(Math.max(first.size + delta, min), total - min)
  // Guard the case where the pair is already too small to honour `min` on both sides.
  if (!Number.isFinite(firstSize) || firstSize <= 0) return [first.flex, second.flex]

  const firstFlex = (firstSize / total) * sum
  return [firstFlex, sum - firstFlex]
}

/** Keep a `role="separator"` handle's aria-value* in step, as a percentage of the pair it splits. */
export function updateSeparator (handle, ratio) {
  const now = Math.round(ratio * 100)
  handle.setAttribute('aria-valuemin', '0')
  handle.setAttribute('aria-valuemax', '100')
  handle.setAttribute('aria-valuenow', String(now))
  handle.setAttribute('aria-valuetext', `${now}%`)
}
