// <taxpert-tool-dock> — the right-side panel area, the floating layer, and the drag/resize gestures
// that move panels between them.
//
// It is the only surface that knows where panels sit relative to each other, so it owns dragging;
// <taxpert-tool-panel> just exposes its grip. Everything it decides is written to tool-layout.js and
// read back from there, so the Tools modal's checkboxes stay in step without the two ever talking.
//
// Layout is CSS. Columns and stacks are `flex: <ratio> 1 0`, minimums are `min-width` / `min-height`,
// and a floating panel is four custom properties on the element. This module measures, clamps, and
// writes ratios — it never computes a percentage or a pixel height, because equal flex already gives
// the 100% / 50% / 33% split the designs call for.
//
// Resizes preview by writing custom properties straight onto the DOM and commit once on pointerup.
// Committing per frame would re-render the dock mid-gesture, replacing the very splitter under the
// pointer.
//
// Public API
//   ready — Promise resolved once the dock's DOM exists
//   toolsModal — the <taxpert-tools-modal> it mounted, if it mounted one

import './taxpert-tool-panel.js' // side effect: customElements.define('taxpert-tool-panel')
import './taxpert-tools-modal.js' // side effect: customElements.define('taxpert-tools-modal')
import {
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  TOOL_LAYOUT_CHANGE_EVENT,
  dockTool,
  dockWidth,
  fitsColumns,
  floatTool,
  getLayout,
  maxDockWidth,
  setColumnFlexPair,
  setDockWidth,
  setPanelFlexPair,
} from './tool-layout.js'
import { resolveDropTarget } from './drop-target.js'
import { onKeyResize, onPointerDrag, resizePair, updateSeparator } from './drag-resize.js'
import { getTemplate } from '../../shared/js/templates.js'
import { loadToolDockTemplates } from './templates.js'

/** Thickness of the drop indicator bar, in px. */
const DROP_BAR = 4

// Which of a floating panel's four sides each handle moves. A corner is simply the two edges it
// joins, which is why there is no separate corner arithmetic below.
const RESIZE_EDGES = new Map([
  ['n', { top: true }],
  ['s', { bottom: true }],
  ['e', { right: true }],
  ['w', { left: true }],
  ['ne', { top: true, right: true }],
  ['nw', { top: true, left: true }],
  ['se', { bottom: true, right: true }],
  ['sw', { bottom: true, left: true }],
])

// The <body> class each handle sets for the duration of a drag, which is where the cursor lives.
const RESIZE_CURSOR = new Map([
  ['n', 'ttd-resizing--y'],
  ['s', 'ttd-resizing--y'],
  ['e', 'ttd-resizing--x'],
  ['w', 'ttd-resizing--x'],
  ['nw', 'ttd-resizing--nwse'],
  ['se', 'ttd-resizing--nwse'],
  ['ne', 'ttd-resizing--nesw'],
  ['sw', 'ttd-resizing--nesw'],
])

/**
 * Where a floating panel's box lands when `edge` is dragged by `delta` from `start`.
 *
 * The north and west sides are the reason this is arithmetic rather than two additions: growing a
 * panel upwards means its height goes up *and* its origin comes back, because the side that was not
 * grabbed has to stay where it is. Clamping is what makes that safe — once the box is at its
 * minimum the origin stops moving too, so a panel dragged past its own floor pins rather than
 * inverting and walking away under the cursor.
 *
 * @param {{x:number, y:number, w:number, h:number}} start the box when the drag began
 * @param {{dx:number, dy:number}} delta pointer movement since the press
 * @param {string} edge one of RESIZE_EDGES' keys
 */
function resizeBox (start, { dx, dy }, edge) {
  const sides = RESIZE_EDGES.get(edge) ?? {}
  const next = { ...start }

  if (sides.right) next.w = Math.max(start.w + dx, PANEL_MIN_WIDTH)
  if (sides.left) {
    next.w = Math.max(start.w - dx, PANEL_MIN_WIDTH)
    next.x = start.x + (start.w - next.w) // the right edge stays put
  }
  if (sides.bottom) next.h = Math.max(start.h + dy, PANEL_MIN_HEIGHT)
  if (sides.top) {
    next.h = Math.max(start.h - dy, PANEL_MIN_HEIGHT)
    next.y = start.y + (start.h - next.h) // the bottom edge stays put
  }
  return next
}

class TaxpertToolDock extends HTMLElement {
  constructor () {
    super()
    this._connected = false
    this._rendered = false
    this._panels = new Map()
    this.ready = Promise.resolve()
    this._onLayoutChange = () => this._syncLayout()
    // A narrower window can invalidate a stored dock width, and drops the column budget with it.
    this._onWindowResize = () => this._applyDockWidth(dockWidth())
  }

  connectedCallback () {
    document.addEventListener(TOOL_LAYOUT_CHANGE_EVENT, this._onLayoutChange)
    window.addEventListener('resize', this._onWindowResize)
    if (this._connected) return
    this._connected = true
    this.ready = loadToolDockTemplates(this).then(() => {
      if (this.isConnected && !this._rendered) this.render()
    })
  }

  disconnectedCallback () {
    document.removeEventListener(TOOL_LAYOUT_CHANGE_EVENT, this._onLayoutChange)
    window.removeEventListener('resize', this._onWindowResize)
  }

  get toolsModal () {
    return this._toolsModal
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  render () {
    // The <use href="#ttp-icon-…"> references resolve against the document, so the sprite goes in
    // once per page rather than once per panel — the global nav's tgn-sprite arrangement.
    if (!document.querySelector('.ttp-sprite')) {
      document.body.insertBefore(getTemplate('ttp-sprite'), document.body.firstChild)
    }

    const dock = getTemplate('ttd-dock')
    const floatLayer = getTemplate('ttd-float-layer')
    this.replaceChildren(dock, floatLayer)

    this._dock = this.querySelector('.ttd-dock')
    this._columnsEl = this.querySelector('.ttd-dock__columns')
    this._floatLayer = this.querySelector('.ttd-float-layer')

    this._dropzone = getTemplate('ttd-dropzone').firstElementChild
    this._floatLayer.appendChild(this._dropzone)

    this._wireDockResizer(this.querySelector('.ttd-dock__resizer'))

    // The modal is the only way to switch a tool back on, so a host that mounts the dock gets it
    // whether or not it asked — the same courtesy taxpert-audit-panel.js does for its three modals.
    if (!document.querySelector('taxpert-tools-modal')) {
      this._toolsModal = document.body.appendChild(document.createElement('taxpert-tools-modal'))
    }

    this._rendered = true
    this._syncLayout()
  }

  /**
   * Reconcile the DOM with the stored layout. Panel elements are *moved*, never rebuilt, so a
   * panel keeps its scroll position and its open <details> when it changes column or floats.
   */
  _syncLayout () {
    if (!this._rendered) return
    const layout = getLayout()

    const wanted = new Set([
      ...layout.columns.flatMap((column) => column.ids),
      ...layout.floating.map((item) => item.id),
    ])
    for (const [id, element] of this._panels) {
      if (wanted.has(id)) continue
      element.remove()
      this._panels.delete(id)
    }
    for (const id of wanted) {
      if (!this._panels.has(id)) this._panels.set(id, this._createPanel(id))
    }

    this._renderColumns(layout)
    this._renderFloating(layout)

    // Two attributes carry the dock's whole visual state; tool-dock.css does the rest.
    this.toggleAttribute('data-open', wanted.size > 0)
    this.toggleAttribute('data-docked', layout.columns.length > 0)
    this._dock.hidden = layout.columns.length === 0
    this._applyDockWidth(dockWidth())
  }

  _createPanel (id) {
    const panel = document.createElement('taxpert-tool-panel')
    panel.setAttribute('tool', id)
    // The grip only becomes a drag handle once the chrome exists, and the chrome is a fetch away.
    panel.ready.then(() => {
      if (panel.grip) this._wirePanelDrag(panel)
      for (const handle of panel.growHandles) this._wireFloatResize(panel, handle)
    })
    return panel
  }

  _renderColumns (layout) {
    this._columnsEl.replaceChildren()
    for (const [index, column] of layout.columns.entries()) {
      if (index) this._columnsEl.appendChild(this._columnSplitter(index))

      const columnEl = getTemplate('ttd-column').firstElementChild
      columnEl.style.setProperty('--ttd-column-flex', column.flex)
      for (const [position, panel] of column.panels.entries()) {
        if (position) columnEl.appendChild(this._panelSplitter(column, position))
        const element = this._panels.get(panel.id)
        element.removeAttribute('data-float')
        element.style.setProperty('--ttp-flex', panel.flex)
        columnEl.appendChild(element)
      }
      this._columnsEl.appendChild(columnEl)
    }
  }

  _renderFloating (layout) {
    for (const item of layout.floating) {
      const element = this._panels.get(item.id)
      element.setAttribute('data-float', '')
      this._setBox(element, item)
      this._floatLayer.appendChild(element)
    }
  }

  // Position and size in one place, so a float and a drag preview are the same four properties.
  _setBox (element, { x, y, w, h }) {
    element.style.setProperty('--ttp-x', `${Math.round(x)}px`)
    element.style.setProperty('--ttp-y', `${Math.round(y)}px`)
    element.style.setProperty('--ttp-w', `${Math.round(w)}px`)
    element.style.setProperty('--ttp-h', `${Math.round(h)}px`)
  }

  // ── Dock width ───────────────────────────────────────────────────────────────

  _applyDockWidth (px) {
    const next = Math.min(Math.max(Math.round(px), PANEL_MIN_WIDTH), maxDockWidth())
    this.style.setProperty('--ttd-width', `${next}px`)
    const resizer = this.querySelector('.ttd-dock__resizer')
    if (resizer) updateSeparator(resizer, next / Math.max(window.innerWidth, 1))
    return next
  }

  _wireDockResizer (resizer) {
    let preview = dockWidth()
    onPointerDrag(resizer, {
      bodyClass: 'ttd-resizing--x',
      onStart: () => dockWidth(),
      // The dock is anchored to the right edge, so its width is simply how far the pointer is from
      // that edge — the audit panel's resizer computes the same thing the same way.
      onMove: ({ x }) => {
        preview = this._applyDockWidth(window.innerWidth - x)
      },
      onEnd: () => setDockWidth(preview),
    })
    onKeyResize(resizer, ({ dx }) => setDockWidth(dockWidth() - dx))
  }

  // ── Splitters ────────────────────────────────────────────────────────────────

  /** Between columns `index - 1` and `index`. */
  _columnSplitter (index) {
    const splitter = getTemplate('ttd-splitter-v').firstElementChild
    const columns = () => [...this._columnsEl.querySelectorAll('.ttd-column')]
    const pair = () => {
      const all = columns()
      return [all.at(index - 1), all.at(index)]
    }
    this._wirePairResize(splitter, {
      axis: 'x',
      min: PANEL_MIN_WIDTH,
      property: '--ttd-column-flex',
      pair,
      measure: (element) => element.getBoundingClientRect().width,
      commit: (before, after) => setColumnFlexPair(index, before, after),
    })
    return splitter
  }

  /** Between the panels at `position - 1` and `position` in `column`. */
  _panelSplitter (column, position) {
    const splitter = getTemplate('ttd-splitter-h').firstElementChild
    const first = column.panels.at(position - 1)
    const second = column.panels.at(position)
    const pair = () => [this._panels.get(first.id), this._panels.get(second.id)]
    this._wirePairResize(splitter, {
      axis: 'y',
      min: PANEL_MIN_HEIGHT,
      property: '--ttp-flex',
      pair,
      measure: (element) => element.getBoundingClientRect().height,
      commit: (before, after) => setPanelFlexPair(first.id, second.id, before, after),
    })
    return splitter
  }

  /**
   * The shared body of both splitters: preview by writing the two flex ratios onto the DOM, commit
   * once at the end. `resizePair` keeps the pair's combined share constant, so a third sibling is
   * never disturbed.
   */
  _wirePairResize (splitter, { axis, min, property, pair, measure, commit }) {
    const ratios = () => {
      const [a, b] = pair()
      if (!a || !b) return null
      return {
        a,
        b,
        first: { flex: Number(a.style.getPropertyValue(property)) || 1, size: measure(a) },
        second: { flex: Number(b.style.getPropertyValue(property)) || 1, size: measure(b) },
      }
    }

    const step = (state, delta) => {
      const [before, after] = resizePair(state.first, state.second, delta, min)
      state.a.style.setProperty(property, before)
      state.b.style.setProperty(property, after)
      updateSeparator(splitter, before / (before + after))
      return [before, after]
    }

    let last = null
    onPointerDrag(splitter, {
      bodyClass: axis === 'x' ? 'ttd-resizing--x' : 'ttd-resizing--y',
      onStart: () => ratios() ?? false,
      onMove: (delta, state) => {
        last = step(state, axis === 'x' ? delta.dx : delta.dy)
      },
      onEnd: () => last && commit(...last),
    })

    onKeyResize(splitter, (delta) => {
      const state = ratios()
      if (!state) return
      commit(...step(state, axis === 'x' ? delta.dx : delta.dy))
    })
  }

  // ── Resizing a floating panel ────────────────────────────────────────────────

  /**
   * One of a floating panel's eight resize handles. Docked panels are sized by the dock's splitters
   * instead, and CSS hides these handles for them, so this never has to ask which it is.
   */
  _wireFloatResize (panel, handle) {
    const edge = handle.dataset.edge
    const box = () => {
      const rect = panel.getBoundingClientRect()
      return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
    }

    const resized = (start, delta) => resizeBox(start, delta, edge)

    let preview = null
    onPointerDrag(handle, {
      bodyClass: RESIZE_CURSOR.get(edge),
      onStart: box,
      onMove: (delta, start) => {
        preview = resized(start, delta)
        this._setBox(panel, preview)
      },
      onEnd: () => preview && floatTool(panel.tool, preview),
    })

    onKeyResize(handle, (delta) => floatTool(panel.tool, resized(box(), delta)))
  }

  // ── Dragging a panel ─────────────────────────────────────────────────────────

  _wirePanelDrag (panel) {
    let target = { kind: 'float' }

    onPointerDrag(panel.grip, {
      bodyClass: 'ttd-dragging',
      onStart: (event) => {
        const rect = panel.getBoundingClientRect()
        // Lift the panel into the float layer so it tracks the cursor unclipped, and so the column
        // it came from reflows immediately — the gap is the clearest preview of what leaving does.
        panel.setAttribute('data-float', '')
        panel.setAttribute('data-dragging', '')
        this._setBox(panel, { x: rect.left, y: rect.top, w: rect.width, h: rect.height })
        this._floatLayer.appendChild(panel)
        return { rect, grab: { x: event.clientX - rect.left, y: event.clientY - rect.top } }
      },
      onMove: ({ x, y }, start) => {
        this._setBox(panel, {
          x: x - start.grab.x,
          y: y - start.grab.y,
          w: start.rect.width,
          h: start.rect.height,
        })
        target = resolveDropTarget({ x, y }, this._geometry(panel))
        this._showDropzone(target)
      },
      onEnd: ({ rect, grab }, event) => {
        this._dropzone.hidden = true
        panel.removeAttribute('data-dragging')
        if (target.kind === 'float') {
          floatTool(panel.tool, {
            x: event.clientX - grab.x,
            y: event.clientY - grab.y,
            w: rect.width,
            h: rect.height,
          })
        } else {
          dockTool(panel.tool, {
            columnIndex: target.columnIndex,
            index: target.index ?? 0,
            newColumn: target.kind === 'new-column',
          })
        }
      },
    })
  }

  /**
   * The rectangles a drop decision is made against, measured fresh each frame so they reflect the
   * reflow the lifted panel already caused. The dragged panel is excluded: it is out of flow, so its
   * rectangle says where the cursor is rather than where a drop would put it.
   */
  _geometry (dragged) {
    const columns = [...this._columnsEl.querySelectorAll('.ttd-column')].map((column) => ({
      rect: column.getBoundingClientRect(),
      panels: [...column.querySelectorAll('taxpert-tool-panel')]
        .filter((panel) => panel !== dragged)
        .map((panel) => ({ id: panel.tool, rect: panel.getBoundingClientRect() })),
    }))
    return {
      dock: this._dockRect(),
      columns: columns.filter((column) => column.panels.length),
      canAddColumn: fitsColumns(columns.length + 1),
    }
  }

  /**
   * The area a drop counts as "docked". With nothing docked the element has collapsed to no width,
   * so measuring it would make every drop a float and a floating panel could never be dragged back —
   * only "Reset tool layout" could rescue it. Offer the strip the dock *would* occupy instead.
   */
  _dockRect () {
    if (!this._dock.hidden) return this._dock.getBoundingClientRect()
    const width = Math.min(dockWidth(), maxDockWidth())
    const left = window.innerWidth - width
    return {
      left,
      right: window.innerWidth,
      top: 0,
      bottom: window.innerHeight,
      width,
      height: window.innerHeight,
    }
  }

  _showDropzone (target) {
    if (target.kind === 'float') {
      this._dropzone.hidden = true
      return
    }
    const columnEls = [...this._columnsEl.querySelectorAll('.ttd-column')]
    // The same rect the decision was made against, so the indicator can't point somewhere the drop
    // won't go — including the offered strip when nothing is docked yet.
    const dock = this._dockRect()

    if (target.kind === 'new-column') {
      // A vertical bar on the seam the new column would open at.
      const at = columnEls.at(target.columnIndex)
      const x = at ? at.getBoundingClientRect().left : dock.right
      this._setBox(this._dropzone, { x: x - DROP_BAR / 2, y: dock.top, w: DROP_BAR, h: dock.height })
    } else {
      // A horizontal bar on the seam between two stacked panels.
      const column = columnEls.at(target.columnIndex)
      if (!column) return
      const rect = column.getBoundingClientRect()
      const panels = [...column.querySelectorAll('taxpert-tool-panel:not([data-dragging])')]
      const at = panels.at(target.index)
      const y = at ? at.getBoundingClientRect().top : rect.bottom
      this._setBox(this._dropzone, { x: rect.left, y: y - DROP_BAR / 2, w: rect.width, h: DROP_BAR })
    }
    this._dropzone.hidden = false
  }
}

customElements.define('taxpert-tool-dock', TaxpertToolDock)

export { TaxpertToolDock }
