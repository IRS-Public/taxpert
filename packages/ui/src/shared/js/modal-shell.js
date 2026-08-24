// The <dialog> shell shared by <taxpert-scenario-modal>, <taxpert-display-modal> and
// <taxpert-workspace-settings-modal>.
//
// The markup lives once in src/shared/templates/shared.html as <template id="tms-shell">. This
// module stamps the per-modal identity onto a clone and owns the open/close semantics, including
// the jsdom fallback for engines without showModal().

import { getTemplate, loadTemplates } from './templates.js'

const SHARED_TEMPLATES = new URL('../templates/shared.html', import.meta.url)

// USWDS's "a modal owns the viewport" body class. The host page's scroll lock keys off it.
const BODY_MODAL_CLASS = 'usa-js-modal--active'

/** Fetch (once) the shared template file. Awaited by every modal before it renders. */
export function loadModalShell () {
  return loadTemplates(SHARED_TEMPLATES)
}

/**
 * Clone the shared shell into `host`, replacing whatever it held.
 * @param {HTMLElement} host the custom element
 * @param {{ id: string, prefix: string, heading: string }} options
 *   `prefix` is the modal's BEM-ish namespace ('tsm', 'tdm' or 'twsm'). It names the dialog's
 *   `-dialog`, `-main`, `-close` and `-heading` classes, and the heading id aria-labelledby
 *   points at.
 * @returns {{ dialog: HTMLDialogElement, main: HTMLElement }}
 */
export function buildModalShell (host, { id, prefix, heading }) {
  const fragment = getTemplate('tms-shell')

  const dialog = fragment.querySelector('dialog')
  dialog.id = id
  dialog.classList.add(`${prefix}-dialog`)
  dialog.setAttribute('aria-labelledby', `${prefix}-heading`)
  // Light dismiss and the close button both land here, so the body class is released either way.
  dialog.addEventListener('close', () => document.body.classList.remove(BODY_MODAL_CLASS))

  const main = fragment.querySelector('.usa-modal__main')
  main.classList.add(`${prefix}-main`)

  const closeBtn = fragment.querySelector('.usa-modal__close')
  closeBtn.classList.add(`${prefix}-close`)
  closeBtn.addEventListener('click', () => closeDialog(dialog))

  const title = fragment.querySelector('.usa-modal__heading')
  title.id = `${prefix}-heading`
  title.classList.add(`${prefix}-heading`)
  title.textContent = heading

  host.replaceChildren(fragment)
  return { dialog, main }
}

/** Show `dialog` modally. Answers whether it opened, false when absent or already open. */
export function openDialog (dialog) {
  if (!dialog || dialog.open) return false
  if (typeof dialog.showModal === 'function') dialog.showModal()
  else dialog.setAttribute('open', '')
  document.body.classList.add(BODY_MODAL_CLASS)
  return true
}

export function closeDialog (dialog) {
  if (!dialog) return
  if (typeof dialog.close === 'function') dialog.close()
  else dialog.removeAttribute('open')
  document.body.classList.remove(BODY_MODAL_CLASS)
}
