// <taxpert-outcome-tracker> — the Outcome tracker tool's body: where each of the host's
// determinations has got to, and what is still standing between it and an answer.
//
// This is credit-assistant's old "Eligibility Inspector" audit-panel section, done as a panel. That
// section printed two flat lists of fact paths with a colour swatch each and a legend explaining
// what the swatches meant; a determination row answers the question you were actually reading those
// lists to answer — has this settled, and to what — and keeps the fact-by-fact working behind a
// <details>.
//
// The element owns no state and knows no application. `config.determinations` holds what is being
// tracked and how each rollup is spoken, fact-values.js reads current values out of the host's
// graph, and this renders the two together:
//
//   fg-load / fg-update     a value changed        → refresh every row in place
//   taxpert:config-changed  the list itself moved  → rebuild
//
// Refreshing in place rather than rebuilding is the point of the first: an `fg-update` fires on
// every keystroke in the flow, and rebuilding would slam shut any determination the user had
// expanded to read. A config change is the one thing that does have to rebuild, and it is rare —
// a host configures once at page level, or once per data-source switch.
//
// With no determinations configured the panel draws an empty state rather than an empty accordion
// list. An empty list would read as "nothing has settled yet"; the truth is that nothing is being
// tracked, and every host but the one that configures a list is in that position.
//
// It renders inside <taxpert-tool-panel>, which is created once and *moved* between columns rather
// than rebuilt, so an expanded determination survives docking, floating and dragging.
//
// A determination is:
//   { id, label, rollupPath, outcome, sections: [{ heading, facts: [path] }] }
//
// `outcome` says how the rollup is spoken. It is a descriptor — `{ kind: 'boolean', … }` and the
// three others in outcome-kinds.js — so that a determination is entirely JSON and can be edited,
// shipped in a config file, or pasted between browsers. A function is still accepted and passes
// straight through. Either way it is resolved once per row, when the tree is built, rather than on
// every `fg-update`.

import { onFactChange, readFact } from './fact-values.js'
import { getConfig, CONFIG_CHANGE_EVENT } from '../../shared/js/config.js'
import { resolveOutcome } from '../../shared/js/outcome-kinds.js'
import { getTemplate } from '../../shared/js/templates.js'
import { loadOutcomeTrackerTemplates } from './templates.js'

// What a fact row draws for each status fact-values.js reports. The outlined icons are deliberate:
// the filled check_circle is the determination's own mark, and repeating it on every row underneath
// would flatten the two levels together.
//
// Every status carries an icon, unanswered ones included. They were `icon: null` — the bare word,
// with the slot held open but blank — and that read as a rendering fault rather than as a state,
// because the column it sits in draws a mark on every other row. The part-drawn ring is the same
// glyph the Watchlist gives an unanswered fact (taxpert-watchlist.js) and the same one a pending
// determination wears in its own summary above, so "still working" is one picture at all three
// levels. The `[hidden]` reserve rule in outcome-tracker.css stays: nothing sets it today, but it is
// what keeps the label column aligned if a status ever goes back to having no mark.
const FACT_STATE = new Map([
  ['complete', { icon: '#ttp-icon-check_circle_outline', label: 'True' }],
  ['false', { icon: '#ttp-icon-error_circle_outline', label: 'False' }],
  ['incomplete', { icon: '#ttp-icon-pending', label: 'Incomplete' }],
  ['unknown', { icon: '#ttp-icon-pending', label: 'Unavailable' }],
])

/** A fact still waiting on an answer — what the summary counts when it has no outcome to show. */
const isUnanswered = (state) => state.status !== 'complete' && state.status !== 'false'

/**
 * Every fact path a determination tracks, in section order.
 *
 * Exported because a host that supplies determinations usually has a second surface reading the
 * same paths, and deriving both from the one list is the whole reason the list moved out of this
 * package — credit-assistant's eligibility dashboard is the case in point.
 */
export function determinationFacts (determination) {
  return determination.sections.flatMap((section) => section.facts)
}

class TaxpertOutcomeTracker extends HTMLElement {
  constructor () {
    super()
    this._connected = false
    this._rendered = false
    this._rows = [] // one { determination, row, facts: [{ path, element }] } per determination
    this.ready = new Promise((resolve, reject) => {
      this._bodyReady = resolve
      this._bodyFailed = reject
    })

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
    loadOutcomeTrackerTemplates(this).then(() => {
      if (this.isConnected && !this._rendered) this.render()
      this._bodyReady()
    }, this._bodyFailed)
  }

  disconnectedCallback () {
    this._offFactChange?.()
    document.removeEventListener(CONFIG_CHANGE_EVENT, this._onConfigChange)
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  // The whole tree — rows, section headings, fact rows — is built here, and rebuilt only when the
  // configured list changes. Everything after this point only writes text and swaps attributes.
  render () {
    const determinations = getConfig().determinations
    this._rows = []
    this._rendered = true

    if (!determinations.length) {
      this.replaceChildren(getTemplate('ttp-outcome-empty'))
      return
    }

    this.replaceChildren(getTemplate('ttp-outcome'))
    const list = this.querySelector('.ttp-outcome__list')

    for (const determination of determinations) {
      const built = this._buildRow(determination)
      this._rows.push(built)
      list.appendChild(built.row)
    }

    this._refresh()
  }

  _buildRow (determination) {
    const row = getTemplate('ttp-outcome-row').firstElementChild
    row.dataset.determination = determination.id
    row.querySelector('[data-field="label"]').textContent = determination.label

    const detail = row.querySelector('.ttp-outcome__detail')
    const facts = []
    for (const section of determination.sections) {
      const element = getTemplate('ttp-outcome-section').firstElementChild
      element.querySelector('[data-field="heading"]').textContent = section.heading
      element.querySelector('[data-field="count"]').textContent = `(${section.facts.length})`

      const factList = element.querySelector('.ttp-outcome__facts')
      for (const path of section.facts) {
        const factRow = getTemplate('ttp-outcome-fact').firstElementChild
        factRow.querySelector('[data-field="path"]').textContent = path
        factList.appendChild(factRow)
        facts.push({ path, element: factRow })
      }
      detail.appendChild(element)
    }

    // Resolved here, not in _refreshRow: `fg-update` fires on every keystroke, and a `map` kind
    // builds a lookup out of its descriptor. The tree is rebuilt whenever the config changes, which
    // is the only thing that can change what a rollup says.
    return { determination, row, facts, outcome: resolveOutcome(determination.outcome) }
  }

  // ── Live values ──────────────────────────────────────────────────────────────

  _refresh () {
    if (!this._rendered) return
    for (const entry of this._rows) this._refreshRow(entry)
  }

  _refreshRow ({ determination, row, facts, outcome }) {
    // Read every fact once: the rollup's own state decides the summary, and the whole set decides
    // how many answers are still outstanding.
    const states = new Map()
    for (const { path, element } of facts) {
      const state = readFact({ path, collectionId: '' })
      states.set(path, state)
      this._refreshFact(element, state)
    }

    const rollup = states.get(determination.rollupPath) ??
      readFact({ path: determination.rollupPath, collectionId: '' })
    const settled = !isUnanswered(rollup)

    row.dataset.status = settled ? 'settled' : 'pending'
    row.querySelector('.ttp-outcome__status use')
      .setAttribute('href', settled ? '#ttp-icon-check_circle' : '#ttp-icon-pending')

    // A settled determination says what it decided; an unsettled one says how much is left, which is
    // the more useful number while you are still answering questions. A host may leave `outcome`
    // off, in which case the rollup's own formatted value is already the answer.
    const value = settled
      ? (outcome?.(rollup.raw, rollup.value) ?? rollup.value)
      : unansweredLabel([...states.values()].filter(isUnanswered).length)

    row.querySelector('[data-field="value"]').textContent = value
    row.querySelector('[data-field="status-label"]').textContent =
      settled ? 'Status: Complete.' : 'Status: Incomplete.'
  }

  _refreshFact (element, state) {
    const display = FACT_STATE.get(state.status) ?? FACT_STATE.get('unknown')
    // A complete non-boolean — a filing-status enum is the one in practice — shows its own value
    // rather than the True/False a boolean gets.
    const isBoolean = state.raw === true || state.raw === false
    const label = display.label === 'True' && !isBoolean ? state.value : display.label

    element.dataset.status = state.status
    element.querySelector('[data-field="value"]').textContent = label

    // toggleAttribute, not `icon.hidden = …`. `hidden` is an HTMLElement property and this is an
    // <svg>, which descends from Element via SVGElement and has no such reflection — so the
    // assignment set a plain JS expando and left the `hidden` attribute the template ships exactly
    // where it was. Every fact row's icon was therefore permanently hidden, True and False included,
    // which is what "the outcome tables have lost their icons" looked like from outside.
    const icon = element.querySelector('.ttp-outcome__fact-icon')
    icon.toggleAttribute('hidden', !display.icon)
    if (display.icon) icon.querySelector('use').setAttribute('href', display.icon)
  }
}

/** "2 unanswered facts" — and "1 unanswered fact", because the panel is read, not scanned. */
function unansweredLabel (count) {
  return `${count} unanswered fact${count === 1 ? '' : 's'}`
}

customElements.define('taxpert-outcome-tracker', TaxpertOutcomeTracker)

export { TaxpertOutcomeTracker }
