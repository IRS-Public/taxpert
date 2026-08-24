// <taxpert-tools-modal>: "Tools", the panel switchboard opened from the global nav's Tools button.
//
// The element self-wires. It listens on the document for the nav's `nav-tool-select` and opens on
// detail.id === 'tools', so mounting it anywhere is the whole integration; <taxpert-tool-dock>
// creates one if the host has not. Checkbox and panel stay in step through tool-layout.js rather
// than through any path between this element and the dock. See ../../../../../docs/internals/tool-panels.md.
//
// Public API
//   ready  Promise resolved once the dialog has been built
//   open() / close()

import { tools } from './tool-registry.js'
import { isToolOn, setToolOn, resetToolLayout, TOOL_LAYOUT_CHANGE_EVENT } from './tool-layout.js'
import { CONFIG_CHANGE_EVENT } from '../../shared/js/config.js'
import { getTemplate } from '../../shared/js/templates.js'
import { buildModalShell, openDialog, closeDialog } from '../../shared/js/modal-shell.js'
import { loadToolsModalTemplates } from './templates.js'

class TaxpertToolsModal extends HTMLElement {
  constructor () {
    super()
    this._connected = false
    this._rendered = false
    this.ready = Promise.resolve()
    this._onNavTool = (event) => {
      if (event.detail?.id === 'tools') this.open()
    }
    // A panel closed from its own [x], or a layout reset, has to show here immediately: the modal
    // may well be open at the time.
    this._onLayoutChange = () => this._syncCheckboxes()
    // Which tools exist is the host's, and it arrives late: a host page loads the element modules
    // and its configure() call as separate module scripts, so this can render before the host has
    // said anything. Without this listener it would keep offering the library defaults forever.
    this._onConfigChange = () => {
      if (this._rendered) this._renderOptions()
    }
  }

  connectedCallback () {
    document.addEventListener('nav-tool-select', this._onNavTool)
    document.addEventListener(TOOL_LAYOUT_CHANGE_EVENT, this._onLayoutChange)
    document.addEventListener(CONFIG_CHANGE_EVENT, this._onConfigChange)
    if (this._connected) return
    this._connected = true
    this.ready = loadToolsModalTemplates(this).then(() => {
      if (this.isConnected && !this._rendered) this.render()
      if (this._openWhenReady) {
        this._openWhenReady = false
        this.open()
      }
    })
  }

  disconnectedCallback () {
    document.removeEventListener('nav-tool-select', this._onNavTool)
    document.removeEventListener(TOOL_LAYOUT_CHANGE_EVENT, this._onLayoutChange)
    document.removeEventListener(CONFIG_CHANGE_EVENT, this._onConfigChange)
  }

  open () {
    // The nav's Tools button can be pressed before this modal's markup has landed, since the two
    // bundles' templates are separate fetches. Remember the ask and honour it on render.
    if (!this._rendered) {
      this._openWhenReady = true
      return
    }
    this._syncCheckboxes()
    openDialog(this._dialog)
  }

  close () {
    closeDialog(this._dialog)
  }

  render () {
    const { dialog, main } = buildModalShell(this, {
      id: 'tools-modal',
      prefix: 'ttm',
      heading: 'Tools',
    })
    main.appendChild(getTemplate('ttm-sections'))

    this._dialog = dialog
    this._rendered = true

    this._renderOptions()
    this.querySelector('[data-action="reset"]').addEventListener('click', () => resetToolLayout())
    this._syncCheckboxes()
  }

  // Rebuilt from scratch, so this is also the re-configure path. A checkbox's value comes from
  // isToolOn() on every sync, so there is no state in these nodes to preserve.
  _renderOptions () {
    const container = this.querySelector('[data-options="tools"]')
    container.replaceChildren()
    for (const tool of tools()) {
      const fragment = getTemplate('ttm-option')
      const input = fragment.querySelector('input')
      // Prefixed with this modal's own `ttm`: Workspace settings renders a row per tool too, and
      // both are mounted at once. A USWDS checkbox is invisible and clicked through its <label for>,
      // so a `for` resolving to the other modal's input would leave every box here unclickable.
      input.id = `ttm-tool-${tool.id}`
      input.value = tool.id
      input.dataset.tool = tool.id
      input.addEventListener('change', () => setToolOn(tool.id, input.checked))
      const label = fragment.querySelector('label')
      label.htmlFor = input.id
      // Written into the label's own <span>: the description is a child of the label, and
      // `label.textContent = …` would delete it.
      fragment.querySelector('.ttm-option__name').textContent = tool.label
      fragment.querySelector('.ttm-option__hint').textContent = tool.description
      container.appendChild(fragment)
    }
    this._checkboxes = [...this.querySelectorAll('input[data-tool]')]
    this._syncCheckboxes()
  }

  // USWDS draws each row's checked state off the input itself, so that is the only thing to sync.
  _syncCheckboxes () {
    for (const checkbox of this._checkboxes ?? []) {
      checkbox.checked = isToolOn(checkbox.dataset.tool)
    }
  }
}

customElements.define('taxpert-tools-modal', TaxpertToolsModal)

export { TaxpertToolsModal }
