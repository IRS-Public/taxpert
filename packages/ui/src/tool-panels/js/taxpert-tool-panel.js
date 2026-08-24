// <taxpert-tool-panel tool="inspect">: the chrome one workspace tool wears.
//
// It clones its markup, names itself from the tool registry, switches the tool off from its [x], and
// leaves the grip for <taxpert-tool-dock> to bind. It stores no layout state; `data-float` and the
// `--ttp-*` custom properties are pushed onto it by the dock. See ../../../../../docs/internals/tool-panels.md.
//
// Public API
//   ready        Promise resolved once the chrome exists
//   tool         the tool id, reflecting the `tool` attribute
//   grip         the drag handle, for the dock to bind
//   growHandles  the floating-only resize handles, four edges plus four corners

// The panel is what appends `tool.templateId`'s fragment, so it is what must have defined the tool
// body tags first.
import './taxpert-inspect.js' //         side effect: defines <taxpert-inspect>
import './taxpert-outcome-tracker.js' // side effect: defines <taxpert-outcome-tracker>
import './taxpert-watchlist.js' //       side effect: defines <taxpert-watchlist>
import './taxpert-overrides.js' //       side effect: defines <taxpert-overrides>
import { getTool } from './tool-registry.js'
import { setToolOn } from './tool-layout.js'
import { getTemplate } from '../../shared/js/templates.js'
import { loadToolPanelTemplates } from './templates.js'

class TaxpertToolPanel extends HTMLElement {
  constructor () {
    super()
    this._connected = false
    this._rendered = false
    // Created once here and never replaced: the dock takes this promise the moment it calls
    // createElement, before the panel is in the document. A fresh promise on connect would leave the
    // dock holding one that resolves before the chrome exists, and the grip would bind to nothing.
    this.ready = new Promise((resolve, reject) => {
      this._chromeReady = resolve
      this._chromeFailed = reject
    })
  }

  connectedCallback () {
    if (this._connected) return
    this._connected = true
    loadToolPanelTemplates(this).then(() => {
      if (this.isConnected && !this._rendered) this.render()
      this._chromeReady()
    }, this._chromeFailed)
  }

  get tool () {
    return this.getAttribute('tool')
  }

  get grip () {
    return this.querySelector('.ttp-panel__grip')
  }

  get growHandles () {
    return [...this.querySelectorAll('.ttp-panel__grow[data-edge]')]
  }

  render () {
    const tool = getTool(this.tool)
    if (!tool) return

    this.replaceChildren(getTemplate('ttp-panel'))

    // Both buttons are icon-only and carry their name in a visually hidden span, which is what tells
    // two open panels apart in a screen reader's list of controls.
    this.querySelector('.ttp-panel__title').textContent = tool.label
    this.querySelector('.ttp-panel__grip-label').textContent = `Move ${tool.label}`
    this.querySelector('.ttp-panel__close-label').textContent = `Close ${tool.label}`

    // A tool with no body template registered still gets its chrome: a host may register the
    // template later.
    const body = this.querySelector('.ttp-panel__body')
    try {
      body.appendChild(getTemplate(tool.templateId))
    } catch { /* no body for this tool yet */ }

    this.querySelector('.ttp-panel__close').addEventListener('click', () => {
      setToolOn(tool.id, false)
    })

    this._rendered = true
  }
}

customElements.define('taxpert-tool-panel', TaxpertToolPanel)

export { TaxpertToolPanel }
