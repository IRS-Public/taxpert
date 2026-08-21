// A combo box: a text input that filters a listbox down to what you typed.
//
// Why not USWDS's? `.usa-combo-box` is enhanced and then driven by uswds.min.js through
// *delegated, document-level* listeners bound to its own class names. fact-explorer loads no
// USWDS JS at all, so the component would render as an inert `<select>` there; and in
// credit-assistant, which does load it, those delegated handlers would run against a combo box
// this package built and USWDS never enhanced. Borrowing the class names means inheriting both
// problems. So: our own markup (templates/watchlist.html), our own behaviour here, and USWDS's
// look in watchlist.css.
//
// The interaction is the ARIA combobox pattern:
//   type            filter the list, open it
//   ↓ / ↑           move the active option (aria-activedescendant; the input keeps focus)
//   Enter           commit the active option
//   Escape          close, leaving the committed value alone
//   Tab / blur      close, and snap the text back to what is actually committed — a half-typed
//                   path is not a selection, and leaving it on screen would read as though it were
//
// The active option is marked `aria-selected="true"`, which is both the accessibility contract and
// the CSS hook, so nothing here mirrors it in a second `--focused` class.
//
// createComboBox() returns a handle, not an element subclass: the two fields in the Add fact dialog
// differ only in their options, and a custom element would need a registered tag name, an upgrade,
// and a `ready` promise to say what the constructor already can.

import { getTemplate } from '../../shared/js/templates.js'

let sequence = 0

/**
 * Build a combo box.
 * @param {object} options
 * @param {string} options.id base id for the input (its list gets `<id>--list`)
 * @param {string} [options.placeholder] replaces the template's "- Select -"
 * @param {(value: string) => void} [options.onChange] called when the committed value changes
 * @returns {{ element: HTMLElement, input: HTMLInputElement, setOptions: Function, value: string,
 *             label: string, clear: Function, focus: Function, destroy: Function }}
 */
export function createComboBox ({ id, placeholder, onChange } = {}) {
  const element = getTemplate('ttp-combo').firstElementChild
  const input = element.querySelector('.ttp-combo__input')
  const list = element.querySelector('.ttp-combo__list')
  const toggle = element.querySelector('.ttp-combo__toggle')
  const status = element.querySelector('.ttp-combo__status')

  const inputId = id || `ttp-combo-${++sequence}`
  input.id = inputId
  list.id = `${inputId}--list`
  input.setAttribute('aria-controls', list.id)
  if (placeholder) input.placeholder = placeholder

  /** @type {{value: string, label: string}[]} */
  let options = []
  /** @type {{value: string, label: string} | null} */
  let selected = null
  let active = -1

  // ── The list ────────────────────────────────────────────────────────────────

  const matches = (query) => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) => option.label.toLowerCase().includes(needle))
  }

  function renderList (visible) {
    list.replaceChildren()
    for (const [index, option] of visible.entries()) {
      const item = getTemplate('ttp-combo-option').firstElementChild
      item.id = `${list.id}-option-${index}`
      item.dataset.value = option.value
      item.textContent = option.label
      list.appendChild(item)
    }
    status.textContent = visible.length
      ? `${visible.length} result${visible.length === 1 ? '' : 's'} available.`
      : 'No results found.'
  }

  function open (query = input.value) {
    const visible = matches(query)
    renderList(visible)
    list.hidden = false
    input.setAttribute('aria-expanded', 'true')
    // Land on whatever is already committed, so re-opening a chosen field starts where you left it.
    const at = selected ? visible.findIndex((option) => option.value === selected.value) : -1
    setActive(at === -1 ? (visible.length ? 0 : -1) : at)
  }

  function close () {
    list.hidden = true
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    active = -1
  }

  const isOpen = () => !list.hidden

  function setActive (index) {
    const items = [...list.children]
    active = index
    for (const [at, item] of items.entries()) {
      item.setAttribute('aria-selected', String(at === index))
    }
    const current = items.at(index)
    if (index >= 0 && current) {
      input.setAttribute('aria-activedescendant', current.id)
      current.scrollIntoView?.({ block: 'nearest' })
    } else {
      input.removeAttribute('aria-activedescendant')
    }
  }

  function move (step) {
    const count = list.children.length
    if (!count) return
    if (!isOpen()) return open()
    setActive((active + step + count) % count)
  }

  // ── Committing ──────────────────────────────────────────────────────────────

  function commit (option) {
    const changed = (selected?.value ?? null) !== (option?.value ?? null)
    selected = option ?? null
    input.value = option?.label ?? ''
    close()
    if (changed) onChange?.(selected?.value ?? '')
  }

  function commitActive () {
    const item = list.children.item(active)
    if (!item) return false
    commit(options.find((option) => option.value === item.dataset.value) ?? null)
    return true
  }

  // Typed text only counts as a selection when it names an option exactly; anything else snaps back
  // to the committed value on the way out.
  function reconcileText () {
    const typed = input.value.trim().toLowerCase()
    const exact = options.find((option) => option.label.toLowerCase() === typed)
    if (exact) commit(exact)
    else input.value = selected?.label ?? ''
  }

  // ── Wiring ──────────────────────────────────────────────────────────────────

  input.addEventListener('input', () => open())

  input.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'Enter':
        // Only swallow Enter when it means "take this option" — otherwise it belongs to the dialog.
        if (isOpen() && commitActive()) event.preventDefault()
        break
      case 'Escape':
        if (isOpen()) {
          event.stopPropagation() // …or the dialog would close along with the list
          close()
        }
        break
      case 'Tab':
        reconcileText()
        break
      default:
    }
  })

  list.addEventListener('mousedown', (event) => {
    // Before focus leaves the input, so the focusout handler doesn't close the list under the click.
    const item = event.target.closest('.ttp-combo__option')
    if (!item) return
    event.preventDefault()
    commit(options.find((option) => option.value === item.dataset.value) ?? null)
    input.focus()
  })

  toggle.addEventListener('click', () => {
    if (isOpen()) close()
    else open('') // the toggle shows everything, not the current filter
    input.focus()
  })

  element.addEventListener('focusout', (event) => {
    if (element.contains(event.relatedTarget)) return
    reconcileText()
    close()
  })

  // ── Handle ──────────────────────────────────────────────────────────────────

  return {
    element,
    input,

    /**
     * Replace the offered options, keeping the current selection if it is still among them.
     * @param {{value: string, label: string}[]} next
     */
    setOptions (next) {
      options = next ?? []
      const kept = selected && options.find((option) => option.value === selected.value)
      selected = kept ?? null
      input.value = selected?.label ?? ''
      if (isOpen()) open()
    },

    get value () {
      return selected?.value ?? ''
    },

    get label () {
      return selected?.label ?? ''
    },

    /** Select `value` if it is on offer; pass '' to select nothing. */
    set value (value) {
      commit(options.find((option) => option.value === value) ?? null)
    },

    clear () {
      commit(null)
    },

    focus () {
      input.focus()
    },
  }
}
