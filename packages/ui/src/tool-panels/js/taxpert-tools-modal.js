// <taxpert-tools-modal> — "Tools", the panel switchboard opened from the global nav's Tools button.
//
// The nav has carried that button all along: its tool strip (config.nav.toolsByDestination, in
// global-nav/js/taxpert-global-nav.js) registers { id: 'tools', label: 'Tools', icon: 'build' } and
// already dispatches `nav-tool-select` for it. This is the surface it was waiting for; the nav
// needed no change.
//
// Like the audit-panel bundle's three modals, the element self-wires: it listens on the document for
// `nav-tool-select` and opens on detail.id === 'tools'. Mounting it anywhere is the whole
// integration — <taxpert-tool-dock> creates one if the host hasn't.
//
// Checkbox ⇄ panel is two-way. Ticking a box shows the panel; closing [x] a panel unticks the box.
// Neither direction is wired here: both surfaces read and write tool-layout.js and re-sync on its
// TOOL_LAYOUT_CHANGE_EVENT, so there is no path between the modal and the dock to keep in step.
//
// Public API
//   ready — Promise resolved once the dialog has been built
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
    // A panel closed from its own [x] — or a layout reset — has to show up here immediately, since
    // the modal may well be open at the time.
    this._onLayoutChange = () => this._syncCheckboxes()
    // WHICH TOOLS EXIST IS THE HOST'S, AND IT ARRIVES LATE. A host page loads the element modules
    // and its configure() call as separate <script type="module"> tags, so this element can render
    // before the host has said anything — and it would then keep showing the library's three
    // default tools forever. That is what hid tax-withholding-estimator's fourth tool (Overrides):
    // Workspace settings listed it, because that modal re-reads on this event, while this one
    // offered three rows and the dock therefore had no way to open the fourth panel.
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

  // ── Public API ───────────────────────────────────────────────────────────────

  open () {
    // The nav's Tools button can be pressed before this modal's markup has landed (the two bundles'
    // templates are separate fetches). Remember the ask and honour it on render.
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

  // ── Rendering ────────────────────────────────────────────────────────────────

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

  // Rebuilt from scratch, not appended to, so this is also the re-configure path — there is no
  // state in these nodes to preserve, since a checkbox's value comes from isToolOn() on every sync.
  _renderOptions () {
    const container = this.querySelector('[data-options="tools"]')
    container.replaceChildren()
    for (const tool of tools()) {
      const fragment = getTemplate('ttm-option')
      const input = fragment.querySelector('input')
      // Prefixed with the modal's own `ttm`, because an id is document-global and this dialog is
      // not the only surface with a row per tool: Workspace settings renders one too, and both are
      // mounted at once. Two elements answering to `tool-inspect` is not a cosmetic clash — a
      // USWDS checkbox is invisible and clicked through its <label for>, so `for` resolving to the
      // *other* modal's hidden input leaves every box here unclickable.
      input.id = `ttm-tool-${tool.id}`
      input.value = tool.id
      input.dataset.tool = tool.id
      input.addEventListener('change', () => setToolOn(tool.id, input.checked))
      const label = fragment.querySelector('label')
      label.htmlFor = input.id
      // Written into the label's own <span>, not onto the label: the description is a child of the
      // label now (a tile's whole box is one target), and `label.textContent = …` would delete it.
      fragment.querySelector('.ttm-option__name').textContent = tool.label
      fragment.querySelector('.ttm-option__hint').textContent = tool.description
      container.appendChild(fragment)
    }
    this._checkboxes = [...this.querySelectorAll('input[data-tool]')]
    this._syncCheckboxes()
  }

  // USWDS draws each row's checked state off the input itself, so the checkboxes' own state is the
  // only thing to keep in step.
  _syncCheckboxes () {
    for (const checkbox of this._checkboxes ?? []) {
      checkbox.checked = isToolOn(checkbox.dataset.tool)
    }
  }
}

customElements.define('taxpert-tools-modal', TaxpertToolsModal)

export { TaxpertToolsModal }
