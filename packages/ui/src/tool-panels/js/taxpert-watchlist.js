// <taxpert-watchlist> — the Watchlist tool's body: the facts you have pinned and what each one is
// currently worth.
//
// This is the Fact Inspector's job, done as a panel. The inspector printed a fact's whole serialized
// XML definition into a <pre>; a watchlist row answers the two questions you actually stand there
// asking — has this settled, and to what — and keeps the rest behind a <details>.
//
// The element owns no state. watchlist-store.js holds the pinned facts, fact-values.js reads their
// current values out of the host's graph, and this renders the two together:
//
//   WATCHLIST_CHANGE_EVENT  the set of rows changed  → reconcile rows
//   fg-load / fg-update     a value changed          → refresh every row in place
//
// Refreshing in place is the point of the split: an `fg-update` fires on every keystroke in the
// flow, and rebuilding the list would slam shut any row the user had expanded to read.
//
// It renders inside <taxpert-tool-panel>, which is created once and *moved* between columns rather
// than rebuilt, so a watchlist survives docking, floating and dragging with its rows intact.

// Imported for its side effect too: customElements.define('taxpert-add-fact-modal').
import { OPEN_ADD_FACT_EVENT } from './taxpert-add-fact-modal.js'
import {
  WATCHLIST_CHANGE_EVENT,
  getWatchlist,
  removeFromWatchlist,
  watchKey,
} from './watchlist-store.js'
import { onFactChange, readFact } from './fact-values.js'
import { getTemplate } from '../../shared/js/templates.js'
import { loadWatchlistTemplates } from './templates.js'

/**
 * Asked for by "Reveal in canvas". Stubbed on purpose: the canvas is fact-explorer's, and this
 * bundle has no handle on it — so the row says what it wants and leaves the host to answer.
 * detail: { path, collectionId, concretePath }
 */
export const REVEAL_FACT_EVENT = 'taxpert:reveal-fact'

// The icon and the spoken word for each status fact-values.js reports. The <use href> swap is why a
// row can change status without being rebuilt.
const STATUS = new Map([
  ['complete', { icon: '#ttp-icon-check_circle', label: 'Complete' }],
  ['false', { icon: '#ttp-icon-error_circle', label: 'Complete' }],
  ['incomplete', { icon: '#ttp-icon-pending', label: 'Incomplete' }],
  ['unknown', { icon: '#ttp-icon-pending', label: 'Unavailable' }],
])

class TaxpertWatchlist extends HTMLElement {
  constructor () {
    super()
    this._connected = false
    this._rendered = false
    this._rows = new Map() // watchKey → <details>
    this.ready = new Promise((resolve, reject) => {
      this._bodyReady = resolve
      this._bodyFailed = reject
    })

    this._onWatchlistChange = () => this._syncRows()
    this._onFactChange = () => this._refreshRows()
    // One menu open at a time, and a click anywhere else closes it — including a click on another
    // row's kebab, which is why this is a document listener rather than each menu's own blur.
    this._onDocumentPointerDown = (event) => {
      if (!this._openMenu || this._openMenu.contains(event.target)) return
      this._closeMenu()
    }
    this._onDocumentKeydown = (event) => {
      if (event.key === 'Escape') this._closeMenu({ restoreFocus: true })
    }
  }

  connectedCallback () {
    document.addEventListener(WATCHLIST_CHANGE_EVENT, this._onWatchlistChange)
    this._offFactChange = onFactChange(this._onFactChange)
    document.addEventListener('pointerdown', this._onDocumentPointerDown)
    document.addEventListener('keydown', this._onDocumentKeydown)

    if (this._connected) return
    this._connected = true
    loadWatchlistTemplates(this).then(() => {
      if (this.isConnected && !this._rendered) this.render()
      this._bodyReady()
    }, this._bodyFailed)
  }

  disconnectedCallback () {
    document.removeEventListener(WATCHLIST_CHANGE_EVENT, this._onWatchlistChange)
    this._offFactChange?.()
    document.removeEventListener('pointerdown', this._onDocumentPointerDown)
    document.removeEventListener('keydown', this._onDocumentKeydown)
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  render () {
    this.replaceChildren(getTemplate('ttp-watchlist'))
    this._list = this.querySelector('.ttp-watch__list')
    this._addButton = this.querySelector('.ttp-watch__add')

    // The dialog is a page-level element, so it is mounted beside the panel rather than inside it —
    // a floating panel is `overflow: hidden`, and a dialog in there would be clipped by its own tool.
    if (!document.querySelector('taxpert-add-fact-modal')) {
      document.body.appendChild(document.createElement('taxpert-add-fact-modal'))
    }
    this._addButton.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent(OPEN_ADD_FACT_EVENT))
    })

    this._rendered = true
    this._syncRows()
  }

  /**
   * Reconcile the rows with the stored watchlist: drop what has gone, build what is new, and put
   * what stayed back in the stored order. Existing row elements are *reused*, so an expanded row
   * stays expanded when a fact is added above it.
   */
  _syncRows () {
    if (!this._rendered) return
    const entries = getWatchlist()
    const wanted = new Set(entries.map((entry) => watchKey(entry.path, entry.collectionId)))

    for (const [key, row] of this._rows) {
      if (wanted.has(key)) continue
      row.remove()
      this._rows.delete(key)
    }

    for (const entry of entries) {
      const key = watchKey(entry.path, entry.collectionId)
      let row = this._rows.get(key)
      if (!row) {
        row = this._buildRow(entry)
        this._rows.set(key, row)
      }
      this._list.appendChild(row) // appending an element already here just moves it into order
    }

    this._refreshRows()
  }

  _buildRow (entry) {
    const row = getTemplate('ttp-watchlist-row').firstElementChild
    row.dataset.path = entry.path
    row.dataset.collectionId = entry.collectionId

    const kebab = row.querySelector('.ttp-watch__kebab')
    const menu = row.querySelector('.ttp-watch__menu-list')
    kebab.addEventListener('click', (event) => {
      // Without this the click reaches the <summary> and expands the row as a side effect of
      // opening the menu — preventDefault on a summary's click is what cancels its toggle.
      event.preventDefault()
      event.stopPropagation()
      if (menu.hidden) this._openMenuFor(row)
      else this._closeMenu({ restoreFocus: true })
    })

    for (const button of row.querySelectorAll('[data-action]')) {
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        this._closeMenu()
        if (button.dataset.action === 'remove') this._remove(entry, row)
        else this._reveal(entry)
      })
    }

    return row
  }

  // ── Live values ──────────────────────────────────────────────────────────────

  _refreshRows () {
    for (const row of this._rows.values()) this._refreshRow(row)
  }

  _refreshRow (row) {
    const state = readFact({
      path: row.dataset.path,
      collectionId: row.dataset.collectionId ?? '',
    })
    const status = STATUS.get(state.status) ?? STATUS.get('unknown')

    // The one attribute the whole row's colour hangs off; watchlist.css does the rest.
    row.dataset.status = state.status
    row.querySelector('.ttp-watch__status use').setAttribute('href', status.icon)

    const field = (name) => row.querySelector(`[data-field="${name}"]`)
    field('path').textContent = state.path
    field('value').textContent = state.value
    field('status-label').textContent = `Status: ${status.label}.`
    field('menu-label').textContent = `Actions for ${state.path}`
    field('detail-value').textContent = state.value
    field('detail-type').textContent = state.typeLabel || 'Unknown'
    field('detail-path').textContent = state.concretePath

    const collectionRow = field('detail-collection-row')
    collectionRow.hidden = !state.collectionId
    field('detail-collection').textContent = state.collectionId ? `#${state.collectionId}` : ''
  }

  // ── Row actions ──────────────────────────────────────────────────────────────

  _remove (entry, row) {
    // Focus would otherwise land on <body> and the panel would lose the keyboard entirely.
    if (row.contains(document.activeElement)) this._addButton.focus()
    removeFromWatchlist(entry.path, entry.collectionId)
  }

  _reveal (entry) {
    const detail = { ...entry, concretePath: readFact(entry).concretePath }
    console.debug('Reveal in canvas is not implemented yet', detail)
    document.dispatchEvent(new CustomEvent(REVEAL_FACT_EVENT, { detail, bubbles: true }))
  }

  // ── The kebab menu ───────────────────────────────────────────────────────────

  _openMenuFor (row) {
    this._closeMenu()
    row.querySelector('.ttp-watch__menu-list').hidden = false
    row.querySelector('.ttp-watch__kebab').setAttribute('aria-expanded', 'true')
    this._openMenu = row.querySelector('.ttp-watch__menu')
    row.querySelector('.ttp-watch__menu-item').focus()
  }

  _closeMenu ({ restoreFocus = false } = {}) {
    const menu = this._openMenu
    if (!menu) return
    this._openMenu = null
    menu.querySelector('.ttp-watch__menu-list').hidden = true
    const kebab = menu.querySelector('.ttp-watch__kebab')
    kebab.setAttribute('aria-expanded', 'false')
    if (restoreFocus) kebab.focus()
  }
}

customElements.define('taxpert-watchlist', TaxpertWatchlist)

export { TaxpertWatchlist }
