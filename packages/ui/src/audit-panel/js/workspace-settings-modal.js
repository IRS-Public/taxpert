// <taxpert-workspace-settings-modal>, "Workspace settings", opened from the global nav's settings
// gear. It began as the audit panel's Flags rail tab and has since grown sections for tools,
// outcomes, applications and endpoints.
//
// The element self-wires on the nav's `nav-tool-select` event, opening on
// detail.id === 'workspace-settings'. <taxpert-audit-panel> creates it, so a host only mounts the
// panel.
//
// "Applications" is not a setting in the same sense: it switches which application the workspace is
// laid over. It lives here because the gear is the one control on every page of every host. See
// shared/js/apps.js for the switch itself.
//
// THE ROWS COME FROM THE HOST. One clone per entry in config.featureFlags, each supplying its own
// label, so a new flag is an entry in the host's config and nothing else. The list is read late and
// re-read on CONFIG_CHANGE_EVENT.
//
// Public API: ready, open(), close(). See ../../../../../docs/internals/audit-panel.md

import { flags, getFlag, setFlag, applyFlags } from './feature-flags.js'
import {
  CONFIG_CHANGE_EVENT,
  getBuildConfig,
  getConfig,
  getConfigOverrides,
  isOverridden,
  resetAllConfigOverrides,
  resetConfigOverride,
  setConfigOverride,
  setConfigOverrides,
} from '../../shared/js/config.js'
import {
  APP_SELECT_EVENT,
  activeDestination,
  appItems,
  destinationsOf,
  hasAppChoice,
  switchTarget,
} from '../../shared/js/apps.js'
import { createOutcomesEditor } from './outcomes-editor.js'
import { getTemplate } from '../../shared/js/templates.js'
import { buildModalShell, openDialog, closeDialog } from '../../shared/js/modal-shell.js'
import { loadModalTemplates } from './templates.js'

class TaxpertWorkspaceSettingsModal extends HTMLElement {
  constructor () {
    super()
    this._connected = false
    this._rendered = false
    this.ready = Promise.resolve()
    this._onNavTool = (event) => {
      if (event.detail?.id === 'workspace-settings') this.open()
    }
    // A host may configure after this dialog has been built. Rebuilding the rows is safe, a
    // checkbox's state living in localStorage rather than in the DOM.
    this._onConfigChange = () => {
      if (this._rendered) this._renderFromConfig()
    }
  }

  connectedCallback () {
    document.addEventListener('nav-tool-select', this._onNavTool)
    document.addEventListener(CONFIG_CHANGE_EVENT, this._onConfigChange)
    if (this._connected) return
    this._connected = true
    this.ready = loadModalTemplates('workspace-settings-modal.html', this).then(() => {
      if (this.isConnected && !this._rendered) this.render()
      if (this._openWhenReady) {
        this._openWhenReady = false
        this.open()
      }
    })
  }

  disconnectedCallback () {
    document.removeEventListener('nav-tool-select', this._onNavTool)
    document.removeEventListener(CONFIG_CHANGE_EVENT, this._onConfigChange)
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  open () {
    // The gear can be pressed before this modal's markup lands, the two bundles' templates being
    // separate fetches. Remember the ask and honour it on render.
    if (!this._rendered) {
      this._openWhenReady = true
      return
    }
    // Reflect the current effective values in case another surface changed one since render.
    this._syncCheckboxes()
    this._syncOverrideControls()
    this._collapseSections()
    openDialog(this._dialog)
  }

  /**
   * Every section shut, every time the modal opens.
   *
   * The markup ships them shut, but a <details> keeps whatever state it was left in, and this
   * element is built once and reopened. Without this the second open shows whichever sections the
   * last visit unfolded, so the modal has two shapes depending on history nobody can see.
   */
  _collapseSections () {
    for (const section of this.querySelectorAll('.twsm-section, .twsm-outcome')) {
      section.open = false
    }
  }

  close () {
    closeDialog(this._dialog)
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  render () {
    const { dialog, main } = buildModalShell(this, {
      id: 'workspace-settings-modal',
      prefix: 'twsm',
      heading: 'Workspace settings',
    })
    main.appendChild(getTemplate('twsm-sections'))

    this._dialog = dialog
    this._rendered = true

    this.querySelector('.twsm-reset-all').addEventListener('click', () => {
      resetAllConfigOverrides()
      // The config event this fires rebuilds the sections; only the footer's own state is left.
      this._syncOverrideControls()
    })
    for (const button of this.querySelectorAll('[data-reset]')) {
      button.addEventListener('click', () => resetConfigOverride(button.dataset.reset))
    }

    // Its own module, a determination being a nested form and this element's job being to mount
    // sections rather than to know that shape.
    this._outcomes = createOutcomesEditor(this)
    this._wireAdvanced()

    this._renderFromConfig()
  }

  // ── Advanced ─────────────────────────────────────────────────────────────────

  _wireAdvanced () {
    this._endpoints = this.querySelector('[data-field="endpoints"]')
    this._overridesJson = this.querySelector('[data-field="overrides"]')
    this._importError = this.querySelector('[data-error="import"]')

    this._endpoints.addEventListener('change', () => {
      const result = setConfigOverride('endpoints', parseSettings(this._endpoints.value))
      if (!result.ok) this._renderAdvanced() // put it back to what is stored
    })

    this.querySelector('[data-action="import"]').addEventListener('click', () => this._import())
    this.querySelector('[data-action="revert-import"]')
      .addEventListener('click', () => this._renderAdvanced())
  }

  // Both fields are re-filled from the stored config, so anything typed and not applied is
  // discarded. That is what makes "Discard edits" a re-render and nothing else.
  _renderAdvanced () {
    this._endpoints.value = formatSettings(getConfig().endpoints)
    this._overridesJson.value = JSON.stringify(getConfigOverrides(), null, 2)
    this._showImportError(null)
  }

  _showImportError (message) {
    this._importError.hidden = !message
    this._importError.textContent = message ?? ''
  }

  /**
   * Replace the whole override record with what was pasted.
   *
   * Two failure modes read differently to whoever typed them: JSON that will not parse, and JSON
   * that parses into a configuration the schema refuses. Both leave what is stored alone.
   */
  _import () {
    let parsed
    try {
      parsed = JSON.parse(this._overridesJson.value || '{}')
    } catch (error) {
      return this._showImportError(`That is not valid JSON — ${error.message}`)
    }
    const { ok, errors } = setConfigOverrides(parsed)
    if (!ok) return this._showImportError(errors.join('; '))
    this._showImportError(null)
  }

  // Everything the configuration decides, so a late configure() or override lands through the
  // same path the first render took.
  _renderFromConfig () {
    this._renderApps()
    this._renderFlags()
    this._renderTools()
    this._outcomes?.render()
    this._renderAdvanced()
    this._syncOverrideControls()
  }

  // Looked up by name rather than held as two more fields per section.
  _section (name) {
    return {
      options: this.querySelector(`[data-options="${name}"]`),
      empty: this.querySelector(`[data-empty="${name}"]`),
    }
  }

  /**
   * One row per application the host declared, with that application's modes under its name.
   *
   * The section removes itself when there is nothing to choose between, a single-application host
   * otherwise getting a radio group of one.
   *
   * Selecting does not perform the navigation. It announces it, cancelably, and navigates only if
   * nobody objected. Fact Explorer is the host that objects, swapping the graph on its canvas in
   * place. Every other host gets the plain link behaviour by doing nothing.
   */
  _renderApps () {
    const apps = getConfig().apps
    const section = this.querySelector('[data-section="apps"]')
    const container = this.querySelector('[data-options="apps"]')
    if (!section || !container) return

    section.hidden = !hasAppChoice(apps)
    container.replaceChildren()
    if (section.hidden) return

    for (const app of appItems(apps)) {
      const fragment = getTemplate('twsm-app')
      const input = fragment.querySelector('input')
      input.id = `twsm-app-${app.id}`
      input.value = app.id
      input.checked = app.id === apps.current
      input.addEventListener('change', () => {
        if (input.checked) this._selectApp(apps, app.id)
      })

      const label = fragment.querySelector('label')
      label.htmlFor = input.id
      fragment.querySelector('.twsm-app__name').textContent = app.label ?? app.id
      // An application that declared no modes says so rather than showing an empty line. That is
      // a host with a bare id, and worth seeing.
      const modes = destinationsOf(app).map((d) => d.label ?? d.id)
      fragment.querySelector('.twsm-app__modes').textContent =
        modes.length ? modes.join(' · ') : 'No modes declared'

      container.appendChild(fragment)
    }
  }

  _selectApp (apps, id) {
    if (id === apps.current) return
    const target = switchTarget(apps, id, activeDestination())
    if (!target) return

    const event = new CustomEvent(APP_SELECT_EVENT, {
      bubbles: true,
      cancelable: true,
      detail: { id, app: target.app, destination: target.destination, href: target.destination.href },
    })
    if (!document.dispatchEvent(event)) return // a host is handling it in-app
    this.close()
    globalThis.location?.assign?.(target.destination.href)
  }

  // `onToggle` gets the checkbox, so a caller decides what a tick means without this knowing
  // whether it is writing a flag or a config override.
  //
  // EVERY `idFor` MUST CARRY THIS MODAL'S `twsm-` PREFIX. Ids are document-global, both this and
  // the Tools modal are mounted at once, and a USWDS checkbox is invisible: the click lands on the
  // <label> and is routed by `for`. Two elements answering to one id makes one dialog's checkbox
  // silently unclickable. Guarded by unique-ids.test.mjs.
  _renderOptions (name, entries, { idFor, labelFor, checkedFor, onToggle }) {
    const { options, empty } = this._section(name)
    options.replaceChildren()
    const rows = []

    for (const entry of entries) {
      const fragment = getTemplate('twsm-option')
      const input = fragment.querySelector('input')
      input.id = idFor(entry)
      input.value = input.id
      input.name = `workspace-settings-${name}[]`
      input.checked = checkedFor(entry)
      input.addEventListener('change', () => onToggle(entry, input))

      const label = fragment.querySelector('label')
      label.htmlFor = input.id
      label.textContent = labelFor(entry)

      options.appendChild(fragment)
      rows.push({ entry, input })
    }

    if (empty) empty.hidden = entries.length > 0
    return rows
  }

  // Rebuilt from scratch on a re-configure. There is no state in these nodes to preserve, a
  // checkbox's value coming from getFlag() on every sync.
  _renderFlags () {
    const rows = this._renderOptions('flags', flags(), {
      idFor: (flag) => `twsm-ff-${flag.kebab}`,
      // A flag with no label is a host oversight rather than a reason to render a blank box.
      labelFor: (flag) => flag.label ?? flag.name,
      checkedFor: (flag) => getFlag(flag.name),
      onToggle: (flag, input) => {
        setFlag(flag.name, input.checked)
        applyFlags()
      },
    })
    // `data-flag` is what _syncCheckboxes() reads on open, when the entries are long out of scope.
    for (const { entry, input } of rows) input.dataset.flag = entry.name
    this._checkboxes = rows.map(({ input }) => input)
  }

  /**
   * One row per tool *the build offers*, ticked when it is in the effective list.
   *
   * The rows come from getBuildConfig() rather than getConfig(). A tool switched off is absent
   * from the effective `config.tools`, so reading the effective list would take its own row away
   * with it, leaving no way to switch it back on.
   */
  _renderTools () {
    const buildTools = getBuildConfig().tools ?? []
    const enabled = new Set(getConfig().tools.map((tool) => tool.id))

    this._renderOptions('tools', buildTools, {
      idFor: (tool) => `twsm-tool-${tool.id}`,
      labelFor: (tool) => tool.label ?? tool.id,
      checkedFor: (tool) => enabled.has(tool.id),
      onToggle: (tool, input) => {
        const next = new Set(enabled)
        if (input.checked) next.add(tool.id)
        else next.delete(tool.id)
        // Written as the filtered build list, so canonical dock order survives whatever order the
        // boxes were ticked in. Same rule as tool-registry.js's canonicalIndex().
        const kept = buildTools.filter((candidate) => next.has(candidate.id))
        const result = setConfigOverride('tools', kept)
        if (!result.ok) {
          console.warn(`taxpert: could not save tools — ${result.errors.join('; ')}`)
          input.checked = !input.checked
        }
      },
    })
  }

  // Each row's selected treatment follows from the checkbox's own `:checked`, so its state is the
  // only thing to keep in step.
  _syncCheckboxes () {
    for (const checkbox of this._checkboxes ?? []) {
      checkbox.checked = getFlag(checkbox.dataset.flag)
    }
  }

  // Which sections show a value that did not come from the build. The footer appears only when
  // there is something for it to undo.
  _syncOverrideControls () {
    let any = false
    for (const marker of this.querySelectorAll('[data-override]')) {
      const overridden = isOverridden(marker.dataset.override)
      marker.hidden = !overridden
      any ||= overridden
    }
    this.querySelector('.twsm-footer').hidden = !any
  }
}

customElements.define('taxpert-workspace-settings-modal', TaxpertWorkspaceSettingsModal)

export { TaxpertWorkspaceSettingsModal }

// ── "name = value" lines ──────────────────────────────────────────────────────
//
// The shape the Advanced fields use for a flat object, and the same one the Outcomes editor uses
// for a `map`'s options. Every value here is a string, and a person editing an endpoint should not
// have to balance braces to do it.

function formatSettings (object) {
  return Object.entries(object ?? {}).map(([key, value]) => `${key} = ${value}`).join('\n')
}

function parseSettings (text) {
  const parsed = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at === -1) continue
    const key = line.slice(0, at).trim()
    // A key typed by a person, so never a computed member access.
    if (key) {
      Object.defineProperty(parsed, key, {
        value: line.slice(at + 1).trim(), writable: true, enumerable: true, configurable: true,
      })
    }
  }
  return parsed
}
