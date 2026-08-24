// <taxpert-audit-panel>: the workspace's page-level mount. It clones the panel shell (rail,
// resizer, Fact Inspector and Explain sections) from templates/audit-panel.html, and creates the
// three page-level dialogs the global nav opens: Scenario, Display, and Workspace settings.
//
// Templates are fetched, so `ready` resolves once the DOM exists and enable() awaits it. The rail
// itself is hidden unless a host declares the legacyAuditPanel flag; the dialogs are not.
// Attributes: api-base, scenarios-base, fact-dictionary-url, <flag-kebab>-default, templates-base.
// Surfaces, flags and the enable/disable contract: ../../../../../docs/internals/audit-panel.md

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
    /** Resolves once the panel's DOM has been cloned in. */
    this.ready = Promise.resolve()
  }

  connectedCallback () {
    if (this._connected) return
    this._connected = true
    // Read before _connect() replaces the light DOM, and synchronously, so nothing can mutate
    // the host's <option>s while the templates are in flight.
    this._scenarioOptions = this._readScenarioOptions()
    this.ready = this._connect()
  }

  // Host <option>s, either wrapped in a <template> (valid page HTML) or as direct children.
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

  // Dialogs are siblings of the panel, never children: they must not inherit its `hidden` or its
  // width chrome. Reuses an element the host already placed on the page.
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

  _mountDisplayModal () {
    this._displayModal = this._mountModal('taxpert-display-modal')
  }

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

  get _sectionContext () {
    // Rebuilt on each access so factDictionaryXml reflects the live (post-load) binding.
    return {
      factGraph: () => window.factGraph,
      factDictionaryXml,
      trackFact: (path, collectionId, setFocus) =>
        this.trackFact(path, collectionId, setFocus),
    }
  }

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
   * Inject host filter dropdowns into the Manage scenario modal's library section.
   * @param {Array<{id: string, groupId?: string, key: string, label: string, options: Array<{value: string, label: string}>, showFor?: {filter: string, values: string[]}}>} fields
   * @param {(filename: string) => Record<string, string>} parseFilename
   */
  registerScenarioFilters (fields, parseFilename) {
    this._scenarioFilters = { fields: fields ?? [], parseFilename }
    this.scenarioModal?.registerScenarioFilters(this._scenarioFilters.fields, parseFilename)
  }

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

  // The rail's toggle button ships with the shell, so only the per-section <li>s are rebuilt here.
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
    // Built-in sections name a <template>; a host-registered one may build its own body.
    if (section.templateId) body.appendChild(getTemplate(section.templateId))
    else if (typeof section.render === 'function') section.render(body, this._sectionContext)
    else if (typeof section.buildBody === 'function') section.buildBody(body)
    return body
  }

  _renderRailTab (section) {
    const fragment = getTemplate('tap-rail-tab')
    const li = fragment.querySelector('li')
    // A flagged tab is always rendered and gated by CSS on the matching body.ff-<flag> class.
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

  // Exactly one section shows at a time. No CSS selector can compare the panel's data-active-tab
  // against a section's data-tab, so `hidden` is the contract panel-shell.css keys off.
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

  /**
   * Enable audit mode: reveal the panel, restore persisted state, fetch the fact dictionary, and
   * wire the controls.
   *
   * The document keydown, window resize and fg-load listeners added here are NOT removed by
   * disable(); the data-*Initialized flags keep re-enabling idempotent instead.
   */
  async enable () {
    // The panel's DOM is cloned from fetched templates, so it may not exist yet.
    await this.ready

    // Parks focus on <html> so a restored tracked fact does not steal it during keyboard nav.
    document.documentElement.tabIndex = -1
    document.documentElement.focus()
    document.documentElement.addEventListener(
      'focusout',
      () => document.documentElement.removeAttribute('tabindex'),
      { once: true }
    )

    // The toggled stylesheet and the `hidden` class both gate visibility.
    const styles = document.querySelector('#audit-panel-styles')
    if (styles) styles.disabled = false
    this.classList.remove('hidden')

    // Memoized, and only once audit mode is on: a plain page load never fetches the dictionary.
    await loadFactDictionaryXml(this.getAttribute('fact-dictionary-url'))

    const resizer = this.querySelector('#audit-panel-resizer')
    this._tabButtons = this.querySelectorAll('.audit-panel__tab[role="tab"]')

    this._syncWidth = this._setupWidthControls(resizer)
    this._syncWidth()

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

    // Must run after the visibility controls are wired and before the saved tab is restored.
    applyFlags()
    initChat()

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

    const storage = getAuditPanelStorage()
    if (storage.trackedFacts) {
      for (const fact of storage.trackedFacts) {
        this.trackFact(fact.path, fact.collectionId, false)
      }
    }

    // Reaches outside the panel into the host's flow DOM. Unwound in disable().
    const fgShows = document.querySelectorAll('fg-show')
    for (const fgShow of fgShows) {
      const factLink = document.createElement('fact-link')
      factLink.setAttribute('path', fgShow.path)
      factLink.append(fgShow.cloneNode())
      fgShow.parentElement.replaceChild(factLink, fgShow)
    }

    if (!window.factGraph) {
      document.addEventListener('fg-load', setFactOptions)
    } else {
      setFactOptions()
    }

    // Re-apply the stored display options to the flow DOM this page just rendered.
    applyDisplayOptions()

    // Re-surface a generated scenario's description and Download button after the graph reload.
    renderGeneratedScenarioResult()
  }

  /**
   * Disable audit mode: hide the panel, clear its session storage, close the dialogs, and unwrap
   * the <fact-link>s added in enable().
   */
  disable () {
    // The nav's tool strip goes with the workspace, so an open dialog would have no way back.
    this.scenarioModal?.close()
    this.displayModal?.close()
    this.workspaceSettingsModal?.close()

    const styles = document.querySelector('#audit-panel-styles')
    if (styles) styles.disabled = true
    this.classList.add('hidden')
    document.body.classList.remove('audit-panel-open')
    // Only the property the panel set: the host may have its own inline styles here.
    document.documentElement.style.removeProperty(AUDIT_PANEL_WIDTH_PROPERTY)
    delete this.dataset.activeTab
    this.querySelectorAll('.audit-panel__tab[role="tab"]').forEach((btn) =>
      btn.setAttribute('aria-selected', 'false')
    )
    this.querySelector('#toggle-audit-panel')?.setAttribute('aria-expanded', 'false')
    this._syncSectionVisibility()
    sessionStorage.removeItem(auditPanelStorageKey())

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

  // Pointer-drag and arrow-key width controls, persisted to session storage. Returns a syncWidth()
  // that restores the stored (or default) width.
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

// Default to the single panel on the page, and back window.enableAuditMode/disableAuditMode.
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
