// <taxpert-scenario-modal>, "Manage scenario": the single surface for everything that puts a fact
// graph on the page. Reset, copy, paste, AI generation, and the scenario library.
//
// The element self-wires, listening on the document for the nav's `nav-tool-select` event and
// opening on detail.id === 'scenario'. <taxpert-audit-panel> creates it and forwards the host's
// scenario <option>s and registerScenarioFilters() call.
//
// It lives in this bundle because its behavior already did (fact-graph-io.js) and because it shares
// the panel's toggled stylesheet.
//
// Public API: ready, open(), close(), scenarioOptions, scenarioOptionsHtml,
// registerScenarioFilters(fields, parseFilename), setAiScenarioGeneration(on).
//
// Every id the ported behavior queries by is preserved in templates/scenario-modal.html, so
// fact-graph-io.js works unchanged. See ../../../../../docs/internals/audit-panel.md

import {
  copyFactGraphToClipboard,
  loadFactGraphFromAuditPanel,
  loadScenarioFromAuditPanel,
  generateScenarioFromPrompt,
  renderGeneratedScenarioResult,
  clearScenario,
} from './fact-graph-io.js'
import { getFlag, setFlagClass } from './feature-flags.js'
import { getTemplate } from '../../shared/js/templates.js'
import { buildModalShell, openDialog, closeDialog } from '../../shared/js/modal-shell.js'
import { loadModalTemplates } from './templates.js'

// Parse a legacy `scenarioOptionsHtml` string into real <option> nodes. DOMParser rather than
// innerHTML: HTML parsed this way is inert, so a host string can't smuggle anything executable in.
function parseOptions (html) {
  const doc = new DOMParser().parseFromString(`<select>${html}</select>`, 'text/html')
  return doc.querySelectorAll('option')
}

class TaxpertScenarioModal extends HTMLElement {
  constructor () {
    super()
    this._scenarioOptions = null // DocumentFragment of the host's <option>s
    this._scenarioFilters = null
    this._connected = false
    this._rendered = false
    this.ready = Promise.resolve()
    this._onNavTool = (event) => {
      if (event.detail?.id === 'scenario') this.open()
    }
  }

  connectedCallback () {
    document.addEventListener('nav-tool-select', this._onNavTool)
    if (this._connected) return
    this._connected = true
    this.ready = loadModalTemplates('scenario-modal.html', this).then(() => {
      if (this.isConnected && !this._rendered) this.render()
      if (this._openWhenReady) {
        this._openWhenReady = false
        this.open()
      }
    })
  }

  disconnectedCallback () {
    document.removeEventListener('nav-tool-select', this._onNavTool)
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** The host's scenario library as nodes: an array, NodeList, or DocumentFragment. */
  set scenarioOptions (options) {
    this._scenarioOptions = null
    if (options) {
      const fragment = document.createDocumentFragment()
      for (const option of options.childNodes ?? options) fragment.appendChild(option.cloneNode(true))
      if (fragment.childNodes.length) this._scenarioOptions = fragment
    }
    if (this._rendered) this._applyScenarioOptions()
  }

  get scenarioOptions () {
    return this._scenarioOptions
  }

  get scenarioOptionsHtml () {
    if (!this._scenarioOptions) return ''
    return [...this._scenarioOptions.children].map((option) => option.outerHTML).join('')
  }

  set scenarioOptionsHtml (html) {
    this.scenarioOptions = html ? parseOptions(html) : null
  }

  /**
   * Inject host filter dropdowns above the scenario <select>. `fields` is an array of
   * { id, groupId?, key, label, options:[{value,label}], showFor?:{ filter, values } };
   * `parseFilename` maps a scenario filename to an object keyed by each field's `key`.
   */
  registerScenarioFilters (fields, parseFilename) {
    this._scenarioFilters = { fields: fields ?? [], parseFilename }
    if (this._rendered) this._renderScenarioFilters()
  }

  // AI scenario generation is an alpha feature, flagged separately from AI fact explanation. The
  // section is always rendered and carries data-ff="ai-scenario-generation"; revealing it is one
  // body class (shared/styles/feature-flags.css), which is also what applyFlags() writes, so the
  // flag has exactly one representation in the DOM.
  setAiScenarioGeneration (on) {
    setFlagClass('ai-scenario-generation', on)
  }

  open () {
    // The nav's Scenario button can be clicked before this modal's markup has landed (the two
    // bundles' templates are separate fetches). Remember the ask and honour it on render.
    if (!this._rendered) {
      this._openWhenReady = true
      return
    }
    if (!openDialog(this._dialog)) return
    // Re-surface a scenario generated before the last reload, and the current flag state.
    this.setAiScenarioGeneration(getFlag('aiScenarioGeneration'))
    renderGeneratedScenarioResult()
  }

  close () {
    closeDialog(this._dialog)
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  render () {
    const { dialog, main } = buildModalShell(this, {
      id: 'manage-scenario-modal',
      prefix: 'tsm',
      heading: 'Manage scenario',
    })
    main.appendChild(getTemplate('tsm-sections'))

    this._dialog = dialog
    this._rendered = true

    this._applyScenarioOptions()
    this._renderScenarioFilters()
    this._wire()
    this.setAiScenarioGeneration(getFlag('aiScenarioGeneration'))
  }

  // The library section is only meaningful when the host supplied scenarios to pick from.
  _applyScenarioOptions () {
    const select = this.querySelector('#scenario-select')
    const block = this.querySelector('#scenario-library-block')
    if (!select || !block) return
    // Drop anything from a previous assignment, keeping the placeholder.
    while (select.options.length > 1) select.remove(1)
    if (this._scenarioOptions) select.appendChild(this._scenarioOptions.cloneNode(true))
    block.hidden = !this._scenarioOptions
  }

  // Build the host's scenario filter dropdowns above the <select>. Ported from the audit panel,
  // which owned them while Scenarios was a rail tab.
  _renderScenarioFilters () {
    if (!this._scenarioFilters) return
    const container = this.querySelector('.scenario-filters')
    if (!container) return
    container.textContent = ''

    for (const field of this._scenarioFilters.fields) {
      const fragment = getTemplate('tsm-filter-field')
      const group = fragment.querySelector('.usa-form-group')
      if (field.groupId) group.id = field.groupId

      const label = fragment.querySelector('label')
      label.htmlFor = field.id
      label.textContent = field.label

      const select = fragment.querySelector('select')
      select.id = field.id
      // Built as nodes, not interpolated into an HTML string: a host's option label is data, and
      // the old `<option value="${o.value}">${o.label}</option>` would have parsed it as markup.
      for (const option of field.options) {
        const node = document.createElement('option')
        node.value = option.value
        node.textContent = option.label
        select.appendChild(node)
      }
      select.addEventListener('change', () => this._filterScenarios())
      container.appendChild(fragment)
    }
  }

  // Generic scenario filtering: the modal owns the loop; the host owns the vocabulary
  // (field descriptors + parseFilename).
  _filterScenarios () {
    if (!this._scenarioFilters) return
    const { fields, parseFilename } = this._scenarioFilters
    const values = {}
    for (const field of fields) {
      values[field.id] = this.querySelector(`#${field.id}`)?.value ?? ''
    }

    // Show/hide any field group whose visibility depends on another field's value.
    for (const field of fields) {
      if (!field.showFor || !field.groupId) continue
      const group = this.querySelector(`#${field.groupId}`)
      if (group) group.hidden = !field.showFor.values.includes(values[field.showFor.filter])
    }

    const select = this.querySelector('#scenario-select')
    if (!select) return
    for (const option of select.options) {
      if (!option.value) continue
      const parsed = parseFilename(option.value)
      option.hidden = fields.some((field) => {
        const v = values[field.id]
        return v && parsed[field.key] !== v
      })
    }
    const selectedOption = select.options[select.selectedIndex]
    if (selectedOption && selectedOption.hidden) select.value = ''
  }

  _wire () {
    this.querySelector('#copy-fact-graph-btn')?.addEventListener('click', copyFactGraphToClipboard)
    this.querySelector('#load-fact-graph-btn')?.addEventListener('click', loadFactGraphFromAuditPanel)
    // Clear the "enter a valid JSON" error state as soon as the user edits the textarea.
    this.querySelector('#load-fact-graph')?.addEventListener('change', (event) =>
      event.target.setCustomValidity('')
    )
    this.querySelector('#load-scenario-btn')?.addEventListener('click', loadScenarioFromAuditPanel)
    this.querySelector('#generate-scenario-btn')?.addEventListener('click', generateScenarioFromPrompt)
    // Clears the loaded scenario, not just the AI section's result. See clearScenario().
    this.querySelector('#all-screens-clear-scenario')?.addEventListener('click', clearScenario)
  }
}

customElements.define('taxpert-scenario-modal', TaxpertScenarioModal)

export { TaxpertScenarioModal }
