// <taxpert-inspect> — the Inspect tool's body: the objects behind the one rendered unit you have
// selected, and what each of them is currently doing.
//
// This is the audit panel's Fact Inspector and its Flow Inspector, done as one panel and pointed at
// a single question. Those two printed a fact's serialized XML into a <pre> and left the reader to
// work out what it meant; a row here answers the questions you were reading it to answer — what is
// this worth, what is it for, why is this on screen — and keeps the XML behind an Advanced
// disclosure for when the answer isn't enough.
//
// The element owns no state. inspect-selection.js holds the selected unit, fact-definitions.js reads
// the dictionary and fact-values.js the graph, and this renders the three together:
//
//   INSPECT_SELECT_EVENT   the selection changed  → rebuild the rows
//   fg-load / fg-update    a value changed        → refresh every row in place
//
// Refreshing in place is the point of the split: an `fg-update` fires on every keystroke in the
// flow, and rebuilding would slam shut any accordion the user had expanded to read. A selection
// change *does* rebuild, because a different unit has different objects behind it.
//
// It renders inside <taxpert-tool-panel>, which is created once and *moved* between columns rather
// than rebuilt, so an expanded row survives docking, floating and dragging.
//
// Mounting *is* switching the Inspect tool on: <taxpert-tool-dock> creates this element only while
// 'inspect' is in the layout's `on` set (taxpert-tool-dock.js's _syncLayout) and removes it — the
// whole element, not just its content — the moment the tool goes off, whether that is the panel's
// own [x] or the Tools modal's checkbox. So the host page's hover/click cues (inspect-cues.js) turn
// on and off from this element's connected/disconnectedCallback rather than from a display option:
// there is nothing to inspect with the palette closed, and no separate switch to leave mismatched
// with it.

import { showInspectCues, hideInspectCues } from './inspect-cues.js'
import { INSPECT_SELECT_EVENT, getInspectSelection } from './inspect-selection.js'
import { onFactChange, readFact, truncate } from './fact-values.js'
import {
  abstractPathOf,
  collectionIdOf,
  dependenciesOf,
  dependsOnLead,
  describeCondition,
  factPurpose,
  factTypeLabel,
  factXml,
  getFactDefinition,
} from './fact-definitions.js'
import { getTemplate } from '../../shared/js/templates.js'
import { loadInspectTemplates } from './templates.js'

// The three rows, in the order the designs stack them: what the question writes, what decides
// whether it is on screen, and what decides how its copy reads.
const ROW_KINDS = new Map([
  ['fact', { label: 'Fact', icon: '#ttp-icon-info' }],
  ['flow', { label: 'Conditional flow', icon: '#ttp-icon-flow' }],
  ['text', { label: 'Conditional text', icon: '#ttp-icon-text' }],
])

class TaxpertInspect extends HTMLElement {
  constructor () {
    super()
    this._connected = false
    this._rendered = false
    // One closure per row, each re-reading its own fields off the graph. Replaced wholesale when the
    // selection changes; called in a loop on every fg-update.
    this._refreshers = []
    this.ready = new Promise((resolve, reject) => {
      this._bodyReady = resolve
      this._bodyFailed = reject
    })

    this._onSelect = () => this._show(getInspectSelection())
    this._onFactChange = () => this._refresh()
  }

  connectedCallback () {
    document.addEventListener(INSPECT_SELECT_EVENT, this._onSelect)
    this._offFactChange = onFactChange(this._onFactChange)
    showInspectCues()

    if (this._connected) return
    this._connected = true
    loadInspectTemplates(this).then(() => {
      if (this.isConnected && !this._rendered) this.render()
      this._bodyReady()
    }, this._bodyFailed)
  }

  disconnectedCallback () {
    document.removeEventListener(INSPECT_SELECT_EVENT, this._onSelect)
    this._offFactChange?.()
    hideInspectCues()
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  render () {
    this.replaceChildren(getTemplate('ttp-inspect'))
    this._empty = this.querySelector('[data-region="empty"]')
    this._selectedRegion = this.querySelector('[data-region="selected"]')
    this._list = this.querySelector('.ttp-inspect__rows')
    this._rendered = true

    // A panel opened by a cue click renders *after* the selection was made and its event dispatched,
    // so the standing value is read here rather than waited for.
    this._show(getInspectSelection())
  }

  /** Swap between the empty state and one unit's rows. @param {object|null} unit */
  _show (unit) {
    if (!this._rendered) return

    this._empty.hidden = !!unit
    this._selectedRegion.hidden = !unit
    this._list.replaceChildren()
    this._refreshers = []
    if (!unit) return

    this.querySelector('[data-field="title"]').textContent = unit.title
    if (unit.fact) this._list.appendChild(this._buildFactRow(unit.fact))
    if (unit.flow) this._list.appendChild(this._buildConditionRow(unit.flow, 'flow'))
    if (unit.text) this._list.appendChild(this._buildConditionRow(unit.text, 'text'))
    this._refresh()
  }

  /** The row chrome every kind shares: icon, label, path, and an empty detail to fill. */
  _buildRow (kind, path) {
    const { label, icon } = ROW_KINDS.get(kind)
    const row = getTemplate('ttp-inspect-row').firstElementChild
    row.dataset.kind = kind
    row.querySelector('.ttp-row__icon use').setAttribute('href', icon)
    row.querySelector('[data-field="label"]').textContent = label
    row.querySelector('[data-field="path"]').textContent = path
    return row
  }

  _buildFactRow ({ path }) {
    const row = this._buildRow('fact', path)
    const detail = row.querySelector('[data-region="detail"]')
    detail.appendChild(getTemplate('ttp-inspect-fact-detail'))

    const abstractPath = abstractPathOf(path)
    const collectionId = collectionIdOf(path)
    const definition = getFactDefinition(abstractPath)

    // Purpose is the dictionary's <Description>. A heading over an absent one would read as a
    // missing value rather than a fact that simply has no description.
    const purpose = factPurpose(definition)
    detail.querySelector('[data-region="purpose"]').hidden = !purpose
    detail.querySelector('[data-field="purpose"]').textContent = purpose

    this._mountAdvanced(detail, { abstractPath, collectionId, typeLabel: factTypeLabel(definition) })

    const value = detail.querySelector('[data-field="value"]')
    const type = detail.querySelector('[data-field="type"]')
    this._refreshers.push(() => {
      // Read by abstract path plus id, not by the concrete path the flow element carries: the
      // graph's dictionary is keyed on the wildcard form, so handing it the concrete one costs the
      // data type. readFact splices the id back in to reach the value.
      const state = readFact({ path: abstractPath, collectionId })
      // The whole value stays reachable in the title even when an enum runs past the column.
      value.textContent = truncate(state.literal)
      value.title = state.literal
      // Already the plain-English name — readFact runs the dictionary's node name through
      // humanizeType, which is where 'IntNode' becomes 'Integer'.
      type.textContent = state.typeLabel || 'Unknown'
    })

    return row
  }

  _buildConditionRow (condition, kind) {
    const row = this._buildRow(kind, condition.path)
    const detail = row.querySelector('[data-region="detail"]')
    detail.appendChild(getTemplate('ttp-inspect-condition-detail'))

    const abstractPath = abstractPathOf(condition.path)
    const collectionId = collectionIdOf(condition.path)

    const { lead, clauses } = describeCondition({ ...condition, kind })
    detail.querySelector('[data-field="lead"]').textContent = lead

    const clauseList = detail.querySelector('[data-region="clauses"]')
    clauseList.hidden = !clauses.length
    for (const parts of clauses) clauseList.appendChild(buildClause(parts))

    // A condition on a <Writable> fact depends on nothing but the taxpayer, so there is no table to
    // draw and no sentence to introduce it with.
    const dependencies = dependenciesOf(abstractPath)
    detail.querySelector('[data-region="dependencies"]').hidden = !dependencies.length
    detail.querySelector('[data-field="depends"]').textContent = dependsOnLead(kind)

    const rows = detail.querySelector('[data-region="dep-rows"]')
    const values = []
    for (const dependencyPath of dependencies) {
      const dependencyRow = getTemplate('ttp-inspect-dep').firstElementChild
      dependencyRow.querySelector('[data-field="path"]').textContent = dependencyPath
      values.push({
        cell: dependencyRow.querySelector('[data-field="value"]'),
        entry: { path: dependencyPath, collectionId },
      })
      rows.appendChild(dependencyRow)
    }

    this._mountAdvanced(detail, { abstractPath, collectionId })

    this._refreshers.push(() => {
      for (const { cell, entry } of values) cell.textContent = readFact(entry).literal
    })

    return row
  }

  /** The shared Advanced disclosure, and the refresher that keeps its annotated XML current. */
  _mountAdvanced (detail, { abstractPath, collectionId, typeLabel }) {
    const advanced = getTemplate('ttp-inspect-advanced').firstElementChild
    // Only a fact row names the kind of fact; on a condition row the row's own wording has said it.
    const typeRow = advanced.querySelector('[data-region="fact-type"]')
    typeRow.hidden = !typeLabel
    advanced.querySelector('[data-field="fact-type"]').textContent = typeLabel ?? ''

    const xml = advanced.querySelector('[data-field="xml"]')
    this._refreshers.push(() => {
      xml.textContent = factXml(abstractPath, collectionId)
    })

    detail.querySelector('[data-mount="advanced"]').appendChild(advanced)
  }

  // ── Live values ──────────────────────────────────────────────────────────────

  _refresh () {
    for (const refresher of this._refreshers) refresher()
  }
}

/** One plain-language bullet, built as text and <strong> nodes rather than a markup string. */
function buildClause (parts) {
  const clause = getTemplate('ttp-inspect-clause').firstElementChild
  for (const part of parts) {
    const node = getTemplate(
      part.strong ? 'ttp-inspect-clause-strong' : 'ttp-inspect-clause-text'
    ).firstElementChild
    node.textContent = part.text
    clause.appendChild(node)
  }
  return clause
}

customElements.define('taxpert-inspect', TaxpertInspect)

export { TaxpertInspect }
