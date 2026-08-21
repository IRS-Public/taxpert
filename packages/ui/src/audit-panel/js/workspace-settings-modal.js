// <taxpert-workspace-settings-modal> — "Workspace settings", the alpha-feature explorer opened
// from the global nav's settings gear (next to the workspace toggle).
//
// This is the new home for what used to be the audit panel's "Flags" rail tab
// (audit-panel-flags-section in sections.js): runtime feature-flag overrides, stored in
// localStorage, that let someone opt into alpha features ahead of the build-time default.
//
// Like <taxpert-scenario-modal> and <taxpert-display-modal>, the element self-wires: it listens
// on the document for the nav's `nav-tool-select` event and opens on
// detail.id === 'workspace-settings'. It is created and owned by <taxpert-audit-panel> (see
// taxpert-audit-panel.js), so a host only has to mount the panel.
//
// The markup lives in templates/workspace-settings-modal.html and the <dialog> chrome in the
// shared shell (shared/templates/shared.html); building it is cloning both and wiring the
// checkboxes.
//
// It has since grown three more sections, and one of them is not a setting in the same sense:
// "Applications" (last but one, above Advanced) switches which application the workspace is laid
// over. It lives here because the gear is the one control on every page of every host — the
// landing-page cards and fact-explorer's header <select> that it replaced were each reachable
// from exactly one surface. See shared/js/apps.js for the switch itself, and why it keeps the
// destination you are on.
//
// THE ROWS COME FROM THE HOST. One `twsm-option` clone per entry in config.featureFlags, each
// entry supplying its own `label` — so a new flag is an entry in the host's config and nothing
// else, and a host that declares none gets the empty state rather than another application's
// features. The list is read late and re-read on CONFIG_CHANGE_EVENT, like everything else that
// renders from configuration.
//
// Public API
//   ready — Promise resolved once the dialog has been built
//   open() / close()

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
    // A host may configure after this dialog has been built — credit-assistant loads the element
    // modules and the config fragment as separate <script type="module"> tags, and fact-explorer
    // re-configures at runtime. Rebuilding the rows is safe: a checkbox's state lives in
    // localStorage, not in the DOM.
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
    // The nav's settings gear can be pressed before this modal's markup has landed (the two
    // bundles' templates are separate fetches). Remember the ask and honour it on render.
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
   * The markup ships them shut, but a <details> keeps whatever state it was left in — this element
   * is built once and reopened, so the second open showed whichever sections the last visit had
   * unfolded, and a fresh page showed none. Same modal, two shapes, depending on history nobody can
   * see. The whole point of the disclosures is that the modal opens as a readable list of titles.
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

    // Its own module: a determination is a nested form, and this element's job is to mount
    // sections rather than to know that shape. See outcomes-editor.js.
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
  // discarded — which is what makes "Discard edits" a re-render and nothing else.
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
   * Two failure modes, and they read differently to whoever typed them: JSON that will not parse,
   * and JSON that parses into a configuration the schema refuses. Both leave what is stored alone.
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

  // Everything the configuration decides, in one call — so a configure() or an override after the
  // dialog was built lands through the same path the first render took.
  _renderFromConfig () {
    this._renderApps()
    this._renderFlags()
    this._renderTools()
    this._outcomes?.render()
    this._renderAdvanced()
    this._syncOverrideControls()
  }

  // The container and empty-state for one section, looked up by name rather than held as two more
  // fields per section.
  _section (name) {
    return {
      options: this.querySelector(`[data-options="${name}"]`),
      empty: this.querySelector(`[data-empty="${name}"]`),
    }
  }

  /**
   * One row per application the host declared, with that application's modes under its name.
   *
   * The section removes itself when there is nothing to choose between — a single-application host
   * would otherwise get a radio group of one, which says only that it is what it is.
   *
   * Selecting does not *do* the navigation: it announces it, cancelably, and navigates only if
   * nobody objected. fact-explorer is the host that objects — it swaps the graph on its canvas
   * in place rather than reloading itself — and every other host gets the plain link behaviour by
   * doing nothing at all.
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
      // The modes, in the host's own words. An application that declared none says so rather than
      // showing an empty line — that is a host with a bare id, and worth seeing.
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

  // Build one `twsm-option` row. `onToggle` gets the checkbox, so a caller decides what a tick means
  // without this having to know whether it is writing a flag or a config override.
  //
  // Every `idFor` here must carry this modal's `twsm-` prefix. The id is document-global and this is
  // a shared package dropped into a host page: the Tools modal renders its own row per tool, both
  // modals are mounted at once, and a USWDS checkbox is invisible — the click lands on the <label>
  // and is routed by `for`. Two elements answering to `tool-inspect` therefore doesn't look wrong,
  // it makes one of the two dialogs' checkboxes silently unclickable. Guarded by unique-ids.test.mjs.
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

  // One row per flag the host declares. Rebuilt from scratch on a re-configure — there is no state
  // in these nodes to preserve, since a checkbox's value comes from getFlag() on every sync.
  _renderFlags () {
    const rows = this._renderOptions('flags', flags(), {
      idFor: (flag) => `twsm-ff-${flag.kebab}`,
      // A flag with no label is a host oversight rather than a reason to render a blank box; its
      // name is at least something a developer recognizes.
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
   * The rows come from getBuildConfig() rather than getConfig(): a tool switched off is absent from
   * the effective `config.tools`, and reading the effective list would take its own row away with
   * it, leaving no way to switch it back on.
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
        // Written as the filtered build list, so the canonical dock order is preserved however the
        // boxes were ticked — the same rule tool-registry.js's canonicalIndex() enforces.
        const kept = buildTools.filter((candidate) => next.has(candidate.id))
        const result = setConfigOverride('tools', kept)
        if (!result.ok) {
          console.warn(`taxpert: could not save tools — ${result.errors.join('; ')}`)
          input.checked = !input.checked
        }
      },
    })
  }

  // Each row's selected treatment follows from the checkbox's own `:checked` (USWDS's tile
  // variant, recolored in the stylesheet), so its state is the only thing to keep in step.
  _syncCheckboxes () {
    for (const checkbox of this._checkboxes ?? []) {
      checkbox.checked = getFlag(checkbox.dataset.flag)
    }
  }

  // Which sections are showing a value that did not come from the build. One `hidden` per marker,
  // and the footer appears only when there is something for it to undo.
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
// for a `map`'s options. A JSON object would be more precise and much worse to type: every value
// here is a string, and a person editing an endpoint should not have to balance braces to do it.

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
