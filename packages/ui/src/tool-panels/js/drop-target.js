// Where a dragged panel would land: a pure function over the pointer and the rectangles on screen.
//
// <taxpert-tool-dock> measures, calls this, draws the drop indicator from the answer, and on
// pointerup hands the same answer to tool-layout.js. See ../../../../../docs/internals/tool-panels.md.

/** How close to a column edge counts as "make a new column here", in px. */
export const EDGE_ZONE = 48

function within (rect, point) {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  )
}

// The column the pointer is over, or the nearest one when it is in a gap or past the ends.
function nearestColumn (columns, x) {
  let best = 0
  let bestDistance = Infinity
  for (const [index, column] of columns.entries()) {
    const { left, right } = column.rect
    const distance = x < left ? left - x : x > right ? x - right : 0
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}

/**
 * @typedef {{left:number, right:number, top:number, bottom:number, height:number}} Rect
 * @typedef {{ rect: Rect, panels: { id: string, rect: Rect }[] }} ColumnGeometry
 *
 * @param {{x:number, y:number}} point the pointer, in viewport coordinates
 * @param {{ dock: Rect|null, columns: ColumnGeometry[], canAddColumn: boolean }} geometry
 *   `columns` must already exclude the panel being dragged. It is out of flow, so its rectangle
 *   says where the cursor is rather than where a drop would put it.
 * @returns {{kind:'float'} | {kind:'column', columnIndex:number, index:number}
 *           | {kind:'new-column', columnIndex:number}}
 */
export function resolveDropTarget (point, { dock, columns = [], canAddColumn = false } = {}) {
  // Outside the dock entirely: the panel floats where it was let go. This is the only way to undock.
  if (!dock || !within(dock, point)) return { kind: 'float' }

  // An empty dock (every panel floating) has one place to go.
  if (!columns.length) return { kind: 'new-column', columnIndex: 0 }

  // Near a vertical edge, side-by-side wins over stacking, but only when the viewport can afford
  // another column.
  if (canAddColumn) {
    for (const [index, column] of columns.entries()) {
      if (Math.abs(point.x - column.rect.left) <= EDGE_ZONE) {
        return { kind: 'new-column', columnIndex: index }
      }
    }
    if (Math.abs(point.x - columns.at(-1).rect.right) <= EDGE_ZONE) {
      return { kind: 'new-column', columnIndex: columns.length }
    }
  }

  // Otherwise stack: the insertion point is how many panels the pointer has passed the middle of.
  const columnIndex = nearestColumn(columns, point.x)
  const panels = columns.at(columnIndex).panels
  const index = panels.filter((panel) => point.y > panel.rect.top + panel.rect.height / 2).length
  return { kind: 'column', columnIndex, index }
}
