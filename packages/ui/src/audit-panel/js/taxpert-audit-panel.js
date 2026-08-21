// <taxpert-audit-panel> — the shared Taxpert audit / debug panel.
//
// A framework-agnostic vanilla custom element (light DOM, no shadow root), matching the
// <taxpert-global-nav> precedent. It *clones* the entire panel (resizer + content sections + tab
// rail) out of templates/audit-panel.html — the same markup credit-assistant used to server-render
// as ~8 Thymeleaf fragments — so a host only drops in a thin `<taxpert-audit-panel …>` mount. The
// panel DOM keeps the original ids and class names, so the ported section modules' document-scoped
// queries and the ported CSS keep working unchanged.
//
// Because the templates are fetched, connecting is asynchronous: `panel.ready` resolves once the
// DOM exists, and `enable()` awaits it. Nothing is visible before `enable()` anyway (ADR-004: the
// panel is `hidden` and its stylesheet is `disabled` until then), so the load costs no flash.
//
// Public API
//   Attributes: api-base (default http://localhost:8000), scenarios-base, fact-dictionary-url,
//               ai-scenario-generation-default, ai-fact-explanation-default,
//               templates-base (override where templates/*.html are fetched from)
//   Property:   ready — Promise resolved once the panel's DOM has been cloned in
//   Instance methods:
//     enable() / disable()                     — reveal / hide audit mode (the workspace toggle)
//     openTab(dataTab) / closePanel()          — open a section / collapse to the rail
//     trackFact(path, collectionId, setFocus)  — add a fact to the Fact Inspector
//     registerSection(descriptor)              — add a host-owned section (e.g. Eligibility)
//     registerScenarioFilters(fields, parse)   — inject host filter dropdowns into the modal
//     openScenarioModal()                      — open "Manage scenario"
//     openDisplayModal()                       — open "Display options"
//     openWorkspaceSettingsModal()              — open "Workspace settings"
//   Module-level enable(panelEl?) / disable(panelEl?) default to the single
//     document.querySelector('taxpert-audit-panel') and back window.enableAuditMode/disableAuditMode.
//
// Three of the workspace's surfaces are not rail tabs, because none of them is inspection.
// Scenario setup (reset / copy / paste / AI generation / library) lives in
// <taxpert-scenario-modal>, the view preferences (condition cues, layout, language) in
// <taxpert-display-modal>, and alpha feature-flag overrides in
// <taxpert-workspace-settings-modal> — all three created here and appended to the body, opened
// from the global nav's Scenario, Display, and settings-gear buttons. The panel still owns them
// so hosts keep one mount and one registration API.
//
// The Fact Inspector lives in the imported side-effect modules below (they register <fact-link>,
// <audited-fact> and expose window.* console helpers).

import { BUILT_IN_SECTIONS } from './sections.js'
import { getTemplate } from '../../shared/js/templates.js'
import { el } from '../../shared/js/dom.js'
import { loadPanelTemplates } from './templates.js'
import {
  getAuditPanelStorage,
  setAuditPanelStorage,
  auditPanelStorageKey,
} from './storage.js'
import { getLastActiveTabButton, setLastActiveTabButton } from './tab-state.js'
import { loadFactDictionaryXml, factDictionaryXml } from './fact-dictionary.js'
import {
  trackFact as trackFactImpl,
  setFactOptions,
  wireFactInspector,
} from './audited-fact.js'
import { applyFlags } from './feature-flags.js'
import { applyDisplayOptions } from './display-options.js'
import { initChat } from './chat.js'
import { renderGeneratedScenarioResult } from './fact-graph-io.js'
import './scenario-modal.js'
import './display-modal.js'
import './workspace-settings-modal.js'

const AUDIT_PANEL_DEFAULT_WIDTH = 38
const AUDIT_PANEL_MIN_WIDTH = 320
const AUDIT_PANEL_MAX_WIDTH_RATIO = 0.7
const AUDIT_PANEL_KEYBOARD_STEP = 24
const AUDIT_PANEL_WIDTH_PROPERTY = '--audit-panel-width'

class TaxpertAuditPanel extends HTMLElement {
  constructor () {
    super()
    this._sections = BUILT_IN_SECTIONS.map((s) => ({ ...s }))
    this._scenarioFilters = null
    this._scenarioOptions = null
    this._connected = false
    this._rendered = false
    this._syncWidth = () => {}
    /** Resolves once the panel's DOM has been cloned in. `enable()` awaits it; so should tests. */
    this.ready = Promise.resolve()
  }

  connectedCallback () {
    if (this._connected) return
    this._connected = true
    // Capture host-supplied scenario <option>s before we wipe the light DOM — synchronously, so
    // nothing can mutate them while the templates are in flight. The host wraps them in a
    // <template> (keeps the page HTML valid — bare <option>s aren't valid page content); we also
    // accept direct <option> children as a convenience.
    this._scenarioOptions = this._readScenarioOptions()
    this.ready = this._connect()
  }

  // Host-supplied <option>s as a DocumentFragment, handed to the modal as nodes — no
  // DOM → outerHTML → insertAdjacentHTML round-trip in between.
  _readScenarioOptions () {
    const tpl = this.querySelector('template')
    const options = (tpl ? tpl.content : this).querySelectorAll('option')
    if (!options.length) return null
    const fragment = document.createDocumentFragment()
    for (const option of options) fragment.appendChild(option.cloneNode(true))
    return fragment
  }

  async _connect () {
    await loadPanelTemplates(this)
    if (!this.isConnected) return
    this.render()
    this._mountScenarioModal()
    this._mountDisplayModal()
    this._mountWorkspaceSettingsModal()
  }

  // Both modals are siblings of the panel, not children: they are page-level dialogs and must not
  // inherit the panel's `hidden`/width chrome. Created once each, reusing whatever the host may
  // already have placed on the page.
  _mountModal (tagName) {
    let modal = document.querySelector(tagName)
    if (!modal) {
      modal = document.createElement(tagName)
      document.body.appendChild(modal)
    }
    return modal
  }

  _mountScenarioModal () {
    const modal = this._mountModal('taxpert-scenario-modal')
    modal.scenarioOptions = this._scenarioOptions
    if (this._scenarioFilters) {
      modal.registerScenarioFilters(this._scenarioFilters.fields, this._scenarioFilters.parseFilename)
    }
    this._scenarioModal = modal
  }

  // The display modal needs nothing from the panel — it reads its own state and picks its mode up
  // off the page — so mounting it is the whole wiring.
  _mountDisplayModal () {
    this._displayModal = this._mountModal('taxpert-display-modal')
  }

  // Same story for the workspace settings modal — it reads/writes feature flags directly.
  _mountWorkspaceSettingsModal () {
    this._workspaceSettingsModal = this._mountModal('taxpert-workspace-settings-modal')
  }

  get scenarioModal () {
    return this._scenarioModal ?? document.querySelector('taxpert-scenario-modal')
  }

  get displayModal () {
    return this._displayModal ?? document.querySelector('taxpert-display-modal')
  }

  get workspaceSettingsModal () {
    return this._workspaceSettingsModal ?? document.querySelector('taxpert-workspace-settings-modal')
  }

  openScenarioModal () {
    this.scenarioModal?.open()
  }

  openDisplayModal () {
    this.displayModal?.open()
  }

  openWorkspaceSettingsModal () {
    this.workspaceSettingsModal?.open()
  }

  // ── ctx passed to section render() callbacks ────────────────────────────────
  get _sectionContext () {
    // Rebuilt on each access so factDictionaryXml reflects the live (post-load) binding.
    return {
      factGraph: () => window.factGraph,
      factDictionaryXml,
      trackFact: (path, collectionId, setFocus) =>
        this.trackFact(path, collectionId, setFocus),
    }
  }

  // ── Public registration API ─────────────────────────────────────────────────

  /**
   * Register a host-owned section. Descriptor: { sectionId, dataTab, label, title, order,
   * wrapperClass?, ff?, eager?, render(container, ctx) | buildBody(container) }.
   */
  registerSection (descriptor) {
    if (!descriptor || !descriptor.dataTab) return
    // Replace any existing section with the same dataTab, else insert by order.
    const existingIdx = this._sections.findIndex((s) => s.dataTab === descriptor.dataTab)
    if (existingIdx !== -1) this._sections.splice(existingIdx, 1)
    this._sections.push(descriptor)
    this._sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    if (this._rendered) this._renderSections() // rebuild content + rail to place it in order
  }

  /**
   * Inject host filter dropdowns into the Manage scenario modal's library section. `fields` is an
   * array of { id, groupId?, key, label, options:[{value,label}], showFor?:{ filter, values } };
   * `parseFilename` maps a scenario filename to an object keyed by each field's `key`.
   */
  registerScenarioFilters (fields, parseFilename) {
    this._scenarioFilters = { fields: fields ?? [], parseFilename }
    this.scenarioModal?.registerScenarioFilters(this._scenarioFilters.fields, parseFilename)
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  render () {
    this.classList.add('audit-panel', 'hidden')
    this.setAttribute('aria-label', 'Audit Panel')

    this.replaceChildren(getTemplate('tap-shell'))

    this._content = this.querySelector('.audit-panel__content')
    this._rail = this.querySelector('.audit-panel__rail ul')
    // The resizer's aria-controls names the panel, whose id is the host's to choose.
    this.querySelector('#audit-panel-resizer')?.setAttribute('aria-controls', this.id || 'audit-panel')

    this._rendered = true
    this._renderSections()
  }

  // Build every section body + the rail tab list from the ordered section descriptors. The rail's
  // toggle button comes with the shell, so only the per-section <li>s are (re)built here.
  _renderSections () {
    this._content.replaceChildren()
    for (const li of this._rail.querySelectorAll('li:not(:first-child)')) li.remove()

    for (const section of this._sections) {
      this._content.appendChild(this._renderSectionBody(section))
      this._rail.appendChild(this._renderRailTab(section))
    }

    wireFactInspector(this._content)
    this._syncSectionVisibility()
  }

  _renderSectionBody (section) {
    const body = el('div', `audit-panel__section${section.wrapperClass ? ' ' + section.wrapperClass : ''}`)
    if (section.sectionId) body.id = section.sectionId
    body.dataset.tab = section.dataTab
    // Built-in sections name a <template>; host-registered ones may build their body themselves
    // (credit-assistant's eligibility dashboard is genuinely data-derived).
    if (section.templateId) body.appendChild(getTemplate(section.templateId))
    else if (typeof section.render === 'function') section.render(body, this._sectionContext)
    else if (typeof section.buildBody === 'function') section.buildBody(body)
    return body
  }

  _renderRailTab (section) {
    const fragment = getTemplate('tap-rail-tab')
    const li = fragment.querySelector('li')
    // The convention feature-flags.js documents: a flagged tab is present but gated by CSS on the
    // matching body.ff-<flag> class, rather than reached into and `hidden` from JS.
    if (section.ff) li.dataset.ff = section.ff

    const button = fragment.querySelector('button')
    button.dataset.tab = section.dataTab
    button.setAttribute('aria-controls', section.sectionId || '')
    button.title = section.title || section.label

    const [label, srLabel] = fragment.querySelectorAll('span')
    label.textContent = section.label
    srLabel.textContent = section.title || section.label
    return fragment
  }

  // ── Tabs / open-close ────────────────────────────────────────────────────────

  // Exactly one section shows at a time, and none while the panel is collapsed. CSS can't compare
  // the panel's data-active-tab against a section's data-tab, so the panel sets `hidden` and the
  // stylesheet carries one generic pair of rules — a host-registered section gets the same
  // treatment as a built-in one, which the old id-by-id enumeration in panel-shell.css never did.
  _syncSectionVisibility () {
    const active = this.dataset.activeTab
    for (const section of this._content?.children ?? []) {
      section.hidden = section.dataset.tab !== active
    }
  }

  openTab (tabId) {
    this.dataset.activeTab = tabId
    document.body.classList.add('audit-panel-open')
    this._tabButtons?.forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.tab === tabId))
    })
    this.querySelector('#toggle-audit-panel')?.setAttribute('aria-expanded', 'true')
    setAuditPanelStorage('isOpen', true)
    setAuditPanelStorage('activeTab', tabId)
    this._syncSectionVisibility()
    this._syncWidth()
  }

  closePanel () {
    document.body.classList.remove('audit-panel-open')
    delete this.dataset.activeTab
    this._tabButtons?.forEach((btn) => btn.setAttribute('aria-selected', 'false'))
    this.querySelector('#toggle-audit-panel')?.setAttribute('aria-expanded', 'false')
    setAuditPanelStorage('isOpen', false)
    setAuditPanelStorage('activeTab', null)
    this._syncSectionVisibility()
    const focusTarget = getLastActiveTabButton() ?? this._tabButtons?.[0]
    focusTarget?.focus()
  }

  trackFact (path, collectionId, setFocus = true) {
    trackFactImpl(path, collectionId, setFocus)
  }

  // ── enable / disable (the workspace toggle) ─────────────────────────────────

  /**
   * Enable audit mode: reveal the panel rail, restore persisted tab/width/tracked-fact state,
   * fetch the fact-dictionary (memoized), and wire up the panel's controls.
   *
   * Listener-teardown contract (unchanged from panel-shell.js): the persistent document keydown /
   * window resize / fg-load listeners added here are NOT removed on disable(). One-time wiring is
   * guarded by the data-*Initialized flags so re-enabling is idempotent, and disable() hides the
   * panel which makes those handlers inert.
   */
  async enable () {
    // The panel's DOM is cloned from fetched templates, so it may not exist yet.
    await this.ready

    // Focus hack: keep tracked facts from stealing focus during keyboard nav.
    document.documentElement.tabIndex = -1
    document.documentElement.focus()
    document.documentElement.addEventListener(
      'focusout',
      () => document.documentElement.removeAttribute('tabindex'),
      { once: true }
    )

    // Reveal the panel (thin rail). The toggled stylesheet + `hidden` class both gate visibility.
    const styles = document.querySelector('#audit-panel-styles')
    if (styles) styles.disabled = false
    this.classList.remove('hidden')

    // ADR-004: fetch the fact-dictionary only once audit mode is enabled (memoized).
    await loadFactDictionaryXml(this.getAttribute('fact-dictionary-url'))

    const resizer = this.querySelector('#audit-panel-resizer')
    this._tabButtons = this.querySelectorAll('.audit-panel__tab[role="tab"]')

    this._syncWidth = this._setupWidthControls(resizer)
    this._syncWidth()

    // Wire tab rail + close button + keyboard handler (idempotent).
    if (this.dataset.visibilityControlsInitialized !== 'true') {
      const toggleBtn = this.querySelector('#toggle-audit-panel')
      toggleBtn?.addEventListener('click', () => {
        if (document.body.classList.contains('audit-panel-open')) {
          this.closePanel()
        } else {
          const tabId = getLastActiveTabButton()?.dataset.tab ?? this._tabButtons[0]?.dataset.tab
          if (tabId) this.openTab(tabId)
        }
      })

      this._tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const tabId = btn.dataset.tab
          setLastActiveTabButton(btn)
          const isAlreadyActive =
            this.dataset.activeTab === tabId &&
            document.body.classList.contains('audit-panel-open')
          if (isAlreadyActive) this.closePanel()
          else this.openTab(tabId)
        })
      })

      document.addEventListener('keydown', (event) => this._handleKeydown(event))
      this.dataset.visibilityControlsInitialized = 'true'
    }

    // Feature flags: apply runtime state (show/hide Explain tab). The flag checkbox itself lives
    // in the Workspace settings modal, which wires itself.
    // Must run after visibility controls and before restoring the active tab.
    applyFlags()
    initChat()

    // Restore previously open tab state.
    const savedStorage = getAuditPanelStorage()
    if (savedStorage.isOpen) {
      const savedTab = savedStorage.activeTab
      if (savedTab) {
        this.openTab(savedTab)
      } else {
        document.body.classList.add('audit-panel-open')
        this.querySelector('#toggle-audit-panel')?.setAttribute('aria-expanded', 'true')
      }
    }

    // Restore tracked facts from session storage.
    const storage = getAuditPanelStorage()
    if (storage.trackedFacts) {
      for (const fact of storage.trackedFacts) {
        this.trackFact(fact.path, fact.collectionId, false)
      }
    }

    // Cross-cutting exception (documented): wrap every <fg-show> on the page in a <fact-link>.
    // This intentionally reaches OUTSIDE the panel into the host's flow DOM, so it stays a
    // document-scoped pass (unwound in disable()).
    const fgShows = document.querySelectorAll('fg-show')
    for (const fgShow of fgShows) {
      const factLink = document.createElement('fact-link')
      factLink.setAttribute('path', fgShow.path)
      factLink.append(fgShow.cloneNode())
      fgShow.parentElement.replaceChild(factLink, fgShow)
    }

    // Load fact paths once the fact graph is available.
    if (!window.factGraph) {
      document.addEventListener('fg-load', setFactOptions)
    } else {
      setFactOptions()
    }

    // View preferences (condition cues, validation text, inline modals, accordions, layout) live
    // in the Display options modal, which wires itself; re-apply whatever the user last chose to
    // the flow DOM this page just rendered.
    applyDisplayOptions()

    // Scenario controls live in the Manage scenario modal, which wires itself. All that's left
    // here is re-surfacing a generated scenario's description + Download button after
    // loadFactGraph()'s page reload.
    renderGeneratedScenarioResult()
  }

  /**
   * Disable audit mode: hide the panel, drop open/active-tab state, clear audit-panel session
   * storage, hide injected condition chips, and unwrap the fact-link wrappers added in enable().
   */
  disable () {
    // Turning the workspace off takes the nav's tool strip and settings gear with it, so an open
    // modal would be left with no way back to it.
    this.scenarioModal?.close()
    this.displayModal?.close()
    this.workspaceSettingsModal?.close()

    const styles = document.querySelector('#audit-panel-styles')
    if (styles) styles.disabled = true
    this.classList.add('hidden')
    document.body.classList.remove('audit-panel-open')
    // Drop only the property the panel itself set. `removeAttribute('style')` would take any
    // unrelated inline style the host page put on <body> with it.
    document.documentElement.style.removeProperty(AUDIT_PANEL_WIDTH_PROPERTY)
    delete this.dataset.activeTab
    this.querySelectorAll('.audit-panel__tab[role="tab"]').forEach((btn) =>
      btn.setAttribute('aria-selected', 'false')
    )
    this.querySelector('#toggle-audit-panel')?.setAttribute('aria-expanded', 'false')
    this._syncSectionVisibility()
    sessionStorage.removeItem(auditPanelStorageKey())

    // Unwrap the fact-link wrappers added to <fg-show>s in enable().
    const fgShows = document.querySelectorAll('fg-show')
    for (const fgShow of fgShows) {
      const link = fgShow.parentElement
      link.parentElement.replaceChild(fgShow, link)
    }
  }

  // Keyboard handler: Escape closes the panel; arrow keys navigate the rail.
  _handleKeydown (event) {
    if (event.key === 'Escape' && document.body.classList.contains('audit-panel-open')) {
      event.preventDefault()
      this.closePanel()
      return
    }
    if (!event.target.matches?.('.audit-panel__tab')) return
    const tabs = Array.from(this._tabButtons)
    const idx = tabs.indexOf(event.target)
    if (idx === -1) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      tabs[(idx + 1) % tabs.length].focus()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      tabs[(idx - 1 + tabs.length) % tabs.length].focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      tabs[0].focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      tabs[tabs.length - 1].focus()
    }
  }

  // Adjustable-width controls (pointer drag + arrow keys), persisted to session storage.
  // Returns a syncWidth() that restores the stored (or default) width. Ported from panel-shell.js.
  _setupWidthControls (resizer) {
    if (this.dataset.widthControlsInitialized === 'true' && typeof this._syncWidthFn === 'function') {
      return this._syncWidthFn
    }

    const panel = this

    const getMax = () =>
      Math.max(AUDIT_PANEL_MIN_WIDTH, Math.floor(window.innerWidth * AUDIT_PANEL_MAX_WIDTH_RATIO))
    const clamp = (width) => Math.min(Math.max(width, AUDIT_PANEL_MIN_WIDTH), getMax())

    const updateResizerA11y = (width) => {
      if (!resizer) return
      resizer.setAttribute('aria-valuemin', String(AUDIT_PANEL_MIN_WIDTH))
      resizer.setAttribute('aria-valuemax', String(getMax()))
      resizer.setAttribute('aria-valuenow', String(width))
      resizer.setAttribute('aria-valuetext', `${width}px wide`)
    }

    const applyWidth = (width, persist = true) => {
      const next = clamp(width)
      document.documentElement.style.setProperty(AUDIT_PANEL_WIDTH_PROPERTY, `${next}px`)
      updateResizerA11y(next)
      if (persist) setAuditPanelStorage('width', next)
      return next
    }

    const applyDefaultWidth = () => {
      document.documentElement.style.setProperty(AUDIT_PANEL_WIDTH_PROPERTY, `${AUDIT_PANEL_DEFAULT_WIDTH}vw`)
      const fallbackWidth = Math.round((window.innerWidth * AUDIT_PANEL_DEFAULT_WIDTH) / 100)
      const isOpen = document.body.classList.contains('audit-panel-open')
      const renderedWidth = isOpen
        ? Math.round(panel.getBoundingClientRect().width) || fallbackWidth
        : fallbackWidth
      updateResizerA11y(clamp(renderedWidth))
    }

    const resizeBy = (delta) => {
      const current = Math.round(panel.getBoundingClientRect().width)
      return applyWidth(current + delta)
    }

    const onResizeKeydown = (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        resizeBy(-AUDIT_PANEL_KEYBOARD_STEP)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        resizeBy(AUDIT_PANEL_KEYBOARD_STEP)
      }
    }

    const onPointerDown = (event) => {
      if (event.button !== 0 || !resizer) return
      event.preventDefault()
      resizer.setPointerCapture(event.pointerId)
      document.body.classList.add('audit-panel-resizing')
      const onMove = (moveEvent) => applyWidth(window.innerWidth - moveEvent.clientX)
      const onUp = () => {
        resizer.releasePointerCapture(event.pointerId)
        document.body.classList.remove('audit-panel-resizing')
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

    const syncWidth = () => {
      const storage = getAuditPanelStorage()
      if (typeof storage.width === 'number') applyWidth(storage.width)
      else applyDefaultWidth()
    }

    resizer?.addEventListener('pointerdown', onPointerDown)
    resizer?.addEventListener('keydown', onResizeKeydown)
    window.addEventListener('resize', syncWidth)

    this.dataset.widthControlsInitialized = 'true'
    this._syncWidthFn = syncWidth
    return syncWidth
  }
}

customElements.define('taxpert-audit-panel', TaxpertAuditPanel)

// Module-level enable/disable default to the single panel on the page, preserving
// window.enableAuditMode/disableAuditMode and today's `import { enable } from '…'` call sites.
export function enable (panelEl) {
  const panel = panelEl || document.querySelector('taxpert-audit-panel')
  return panel?.enable()
}

export function disable (panelEl) {
  const panel = panelEl || document.querySelector('taxpert-audit-panel')
  return panel?.disable()
}

window.enableAuditMode = enable
window.disableAuditMode = disable

export { TaxpertAuditPanel }
