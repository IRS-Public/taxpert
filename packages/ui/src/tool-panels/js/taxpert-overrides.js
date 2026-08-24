// <taxpert-overrides>, the Overrides tool's body: set a fact directly, without walking the flow to
// the screen that asks for it.
//
// This is the generic answer to a control every host grows its own version of. The Tax Withholding
// Estimator's legacy audit panel had a hand-built "Override Date" wired to `/overrideDate`;
// credit-assistant would want the same for a tax year or a filing status. None of them is a reason
// for this package to carry a host's fact path, so the paths are the host's, in `config.tools`:
//
//   { id: 'overrides', label: 'Overrides', templateId: 'ttp-body-overrides',
//     facts: ['/overrideDate'] }
//
// so adding one is configuration (an entry in a host's config, a line in its taxpert.config.json,
// or a row typed into Workspace settings) rather than a code change here.
//
// ── Why this tool is different from the other three ──────────────────────────────────────────
//
// Inspect, the Outcome tracker and the Watchlist only *read*. This one writes, which is why the
// fact-graph port grew `set()` (see shared/js/graph-adapter.js). A host that supplies no writer,
// Fact Explorer being one, gets `set()` answering false, and this panel says so
// on the row rather than appearing to accept a value it silently drops.
//
// It renders inside <taxpert-tool-panel>, which is created once and *moved* between columns rather
// than rebuilt, so a half-typed override survives docking, floating and dragging.

import { graphPort, onFactChange, readFact } from './fact-values.js'
import { getTool } from './tool-registry.js'
import { CONFIG_CHANGE_EVENT } from '../../shared/js/config.js'
import { getTemplate } from '../../shared/js/templates.js'
import { loadOverridesTemplates } from './templates.js'

/**
 * The `<input type>` each fact-graph type is edited with.
 *
 * Read from the dictionary's own `typeNode`, so a Day is a date picker and a Dollar a number field
 * with no per-host mapping to keep in step. A type not listed here is edited as text, which is what
 * the graph will parse anyway.
 */
const INPUT_TYPES = new Map([
  ['DayNode', 'date'],
  ['DollarNode', 'number'],
  ['IntNode', 'number'],
  ['RationalNode', 'text'],
  ['BooleanNode', 'checkbox'],
])

const inputTypeFor = (typeNode) => INPUT_TYPES.get(typeNode) ?? 'text'

class TaxpertOverrides extends HTMLElement {
  constructor () {
    super()
    this._connected = false
    this._rendered = false
    this._rows = []
    this.ready = new Promise((resolve, reject) => {
      this._bodyReady = resolve
      this._bodyFailed = reject
    })

    // A value can change from under this panel, through the flow or a scenario load, so the status
    // line follows the graph even while the field is untouched.
    this._onFactChange = () => this._refresh()
    this._onConfigChange = () => {
      if (this._rendered) this.render()
    }
  }

  connectedCallback () {
    this._offFactChange = onFactChange(this._onFactChange)
    document.addEventListener(CONFIG_CHANGE_EVENT, this._onConfigChange)

    if (this._connected) return
    this._connected = true
    loadOverridesTemplates(this).then(() => {
      if (this.isConnected && !this._rendered) this.render()
      this._bodyReady()
    }, this._bodyFailed)
  }

  disconnectedCallback () {
    this._offFactChange?.()
    document.removeEventListener(CONFIG_CHANGE_EVENT, this._onConfigChange)
  }

  /** The fact paths this host made overridable. `getTool` reads the live config, so this is late. */
  get facts () {
    return getTool('overrides')?.facts ?? []
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  render () {
    this._rows = []
    this._rendered = true

    const facts = this.facts
    if (!facts.length) {
      this.replaceChildren(getTemplate('ttp-overrides-empty'))
      return
    }

    this.replaceChildren(getTemplate('ttp-overrides'))
    const list = this.querySelector('.ttp-overrides__list')
    for (const path of facts) list.appendChild(this._buildRow(path))

    this._refresh()
  }

  _buildRow (path) {
    const node = getTemplate('ttp-overrides-row').firstElementChild
    const state = readFact({ path, collectionId: '' })

    const input = node.querySelector('.ttp-overrides__input')
    input.id = `ttp-override-${path.replace(/\W+/g, '-')}`
    input.type = inputTypeFor(graphPort().getDefinition(path)?.typeNode)

    const label = node.querySelector('.ttp-overrides__label')
    label.htmlFor = input.id
    label.textContent = path

    // `change`, not `input`: a half-typed date is not a value, and writing on every keystroke would
    // fire an fg-update per character, which every other tool re-reads on.
    input.addEventListener('change', () => this._write(path, input))
    node.querySelector('.ttp-overrides__clear').addEventListener('click', () => {
      input.value = ''
      this._write(path, input)
    })

    const row = { path, node, input, status: node.querySelector('[data-field="status"]') }
    this._rows.push(row)
    this._fillInput(row, state)
    return node
  }

  // Writing an empty value deletes the fact rather than setting it to zero or the empty string,
  // the port's own rule, and the difference between "answered 0" and "not answered".
  _write (path, input) {
    const value = input.type === 'checkbox' ? String(input.checked) : input.value
    // set() dispatches the host's update event on success, so _refresh() has already run by the
    // time this returns; only the failure needs saying.
    if (!graphPort().set(path, value)) {
      const row = this._rows.find((candidate) => candidate.path === path)
      if (row) this._setStatus(row, 'error', 'Could not write this fact.')
    }
  }

  // ── Live values ──────────────────────────────────────────────────────────────

  _refresh () {
    if (!this._rendered) return
    for (const row of this._rows) {
      const state = readFact({ path: row.path, collectionId: '' })
      // Leave the field alone while it has focus: the user is mid-edit, and an fg-update fired by
      // some other fact would otherwise yank what they typed out from under them.
      if (document.activeElement !== row.input) this._fillInput(row, state)
      this._setStatus(row, state.status, state.value)
    }
  }

  _fillInput (row, state) {
    if (row.input.type === 'checkbox') row.input.checked = state.raw === true
    else row.input.value = state.raw === null || state.raw === undefined ? '' : String(state.raw)
  }

  _setStatus (row, status, text) {
    row.node.dataset.status = status
    row.status.textContent = status === 'incomplete' ? 'Not set' : text
  }
}

customElements.define('taxpert-overrides', TaxpertOverrides)

export { TaxpertOverrides }
