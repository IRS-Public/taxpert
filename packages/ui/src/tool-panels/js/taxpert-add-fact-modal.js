// <taxpert-add-fact-modal> — "Add fact", the dialog the Watchlist's + button opens.
//
// The Fact Inspector asked for the same two values through a `<datalist>` and a free-text box: you
// had to know a collection item's uuid by heart to watch a fact inside a collection. Both fields
// are combo boxes here, and the collection ids are the ones actually in the graph.
//
// Self-mounting and self-wiring like every other Taxpert modal: <taxpert-watchlist> creates one if
// the host hasn't, and the element listens for `taxpert:open-add-fact` on the document so a second
// watchlist panel opens the same dialog rather than a second copy of it.
//
// It writes to watchlist-store.js and nothing else. The panel's rows come back from that store's
// change event, so the dialog never touches a row and there is no path between the two to keep in
// step — the same arrangement the Tools modal has with the dock.
//
// Public API
//   ready — Promise resolved once the dialog has been built
//   open() / close()

import { addToWatchlist, isWatched } from './watchlist-store.js'
import { collectionIds, factPaths } from './fact-values.js'
import { createComboBox } from './combo-box.js'
import { getTemplate } from '../../shared/js/templates.js'
import { buildModalShell, openDialog, closeDialog } from '../../shared/js/modal-shell.js'
import { loadAddFactModalTemplates } from './templates.js'

/** Ask the (single) Add fact dialog to open. Dispatched by every watchlist panel's + button. */
export const OPEN_ADD_FACT_EVENT = 'taxpert:open-add-fact'

/** The label the Collection ID field offers for "this fact isn't in a collection". */
const NO_COLLECTION = 'None'

class TaxpertAddFactModal extends HTMLElement {
  constructor () {
    super()
    this._connected = false
    this._rendered = false
    this._openWhenReady = false
    this.ready = Promise.resolve()
    this._onOpenRequest = () => this.open()
  }

  connectedCallback () {
    document.addEventListener(OPEN_ADD_FACT_EVENT, this._onOpenRequest)
    if (this._connected) return
    this._connected = true
    this.ready = loadAddFactModalTemplates(this).then(() => {
      if (this.isConnected && !this._rendered) this.render()
      if (this._openWhenReady) {
        this._openWhenReady = false
        this.open()
      }
    })
  }

  disconnectedCallback () {
    document.removeEventListener(OPEN_ADD_FACT_EVENT, this._onOpenRequest)
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  open () {
    // The + button can be pressed before this dialog's markup has landed. Remember the ask.
    if (!this._rendered) {
      this._openWhenReady = true
      return
    }
    this._refreshOptions()
    this._clearError()
    if (openDialog(this._dialog)) this._path.focus()
  }

  close () {
    closeDialog(this._dialog)
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  render () {
    const { dialog, main } = buildModalShell(this, {
      id: 'add-fact-modal',
      prefix: 'taf',
      heading: 'Add fact',
    })
    main.appendChild(getTemplate('ttp-add-fact'))

    this._dialog = dialog
    this._error = this.querySelector('[data-field="error"]')

    // A fact path chosen, then the collection ids re-offered: a `*` path is the only one that needs
    // one, so choosing it is what makes the second field matter.
    this._path = this._mountField('path', 'add-fact-path', () => this._clearError())
    this._collection = this._mountField('collection', 'add-fact-collection', () => this._clearError())

    this.querySelector('[data-action="add"]').addEventListener('click', () => this._submit())

    this._rendered = true
    this._refreshOptions()
  }

  _mountField (name, id, onChange) {
    const combo = createComboBox({ id, onChange })
    this.querySelector(`[data-mount="${name}"]`).appendChild(combo.element)
    this.querySelector(`[data-label="${name}"]`).htmlFor = combo.input.id
    return combo
  }

  // Re-read on every open rather than once: a collection item added since last time has to show up,
  // and the fact graph may not have existed at all when this element first rendered.
  _refreshOptions () {
    this._path.setOptions(factPaths().map((path) => ({ value: path, label: path })))
    this._collection.setOptions([
      { value: '', label: NO_COLLECTION },
      ...collectionIds().map((id) => ({ value: id, label: `#${id}` })),
    ])
  }

  _submit () {
    const path = this._path.value
    const collectionId = this._collection.value

    if (!path) return this._showError('Choose a fact path to add.')
    // A `*` is a placeholder for a collection item, so the graph can't resolve the path without one.
    if (path.includes('*') && !collectionId) {
      return this._showError('This fact is inside a collection — choose a collection ID for it.')
    }
    if (isWatched(path, collectionId)) {
      return this._showError('That fact is already on the watchlist.')
    }

    addToWatchlist(path, collectionId)
    this._path.clear()
    this._collection.clear()
    this.close()
  }

  _showError (message) {
    this._error.textContent = message
    this._error.hidden = false
  }

  _clearError () {
    this._error.hidden = true
    this._error.textContent = ''
  }
}

customElements.define('taxpert-add-fact-modal', TaxpertAddFactModal)

export { TaxpertAddFactModal }
