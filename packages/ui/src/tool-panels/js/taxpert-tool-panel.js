// <taxpert-tool-panel tool="inspect"> — the chrome one workspace tool wears.
//
// Deliberately thin. It clones its markup, names itself from the tool registry, and turns its two
// buttons into intent: [x] switches the tool off in tool-layout.js, and the grip is left for
// <taxpert-tool-dock> to pick up (the dock owns dragging, because a drag is a question about where
// a panel sits relative to the others — which only the dock knows).
//
// It stores no layout state of its own. Whether it is docked or floating, and how big it is, are
// read off tool-layout.js by the dock and pushed here as an attribute (`data-float`) and custom
// properties (`--ttp-flex`, `--ttp-x/y/w/h`). tool-panel.css turns those into a layout; there is no
// second copy of the geometry in this file.
//
// Public API
//   ready    — Promise resolved once the chrome exists
//   tool     — the tool id (reflects the `tool` attribute)
//   grip     — the drag handle, for the dock to bind
//   growHandles — the floating-only resize handles (four edges + four corners), likewise

// Every tool body is a custom element rather than static markup. Registering them here rather than
// in the dock keeps them beside the thing that clones them: the panel is what appends
// `tool.templateId`'s fragment, so the panel is what has to have defined their tags first.
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
    // Created once here and never replaced. <taxpert-tool-dock> takes this promise the moment it
    // calls createElement — before the panel is in the document, so before connectedCallback could
    // hand out a second one. Swapping in a fresh promise on connect would leave the dock holding the
    // original, which resolved immediately, and it would go looking for a grip on chrome that had
    // not been built yet: the drag handle then silently bound to nothing.
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

    // Both buttons are icon-only, so each carries its name in a visually hidden span rather than an
    // aria-label — the label names the tool, which is what tells two open panels apart in a screen
    // reader's list of controls.
    this.querySelector('.ttp-panel__title').textContent = tool.label
    this.querySelector('.ttp-panel__grip-label').textContent = `Move ${tool.label}`
    this.querySelector('.ttp-panel__close-label').textContent = `Close ${tool.label}`

    // A tool with no body template registered still gets its chrome — an empty panel is a clearer
    // failure than no panel, and a host may register the template later.
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
