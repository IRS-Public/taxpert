// <taxpert-global-nav> — the shared Taxpert app-switcher header.
//
// A framework-agnostic vanilla custom element (light DOM, no shadow root) so it renders natively
// in credit-assistant (no build tools) and inside React/Vite in Fact Explorer. Renders a waffle
// button + breadcrumb, and a dropdown with the TAXPERT WORKSPACE toggle and the navigation
// taxonomy. A group in that taxonomy is an accordion — see _isGroupOpen() for when its children
// show.
//
// The markup lives in templates/global-nav.html and is cloned in once, on connect. Every state
// change after that moves an attribute — aria-expanded, aria-checked, aria-current, `hidden` — and
// global-nav.css decides what it looks like. Nothing is torn down and rebuilt, so a collapsed
// group's children still exist, which is what lets the stylesheet mark the group you're in with
// `:has(.tgn-item[aria-current])` rather than a class the JS has to remember to set.
//
// Attributes are configuration, read when the element connects (the codebase pattern — see
// docs/style-guides/javascript.md; there is no observedAttributes/attributeChangedCallback here).
// What can change afterwards changes through a property, and each setter does the one targeted
// update it implies.
//
// Public API
//   Attributes (read once): app, active, workspace-label, workspace-on ("true"/"false"),
//               workspace-locked ("true"/"false"), context-label (breadcrumb context override),
//               menu-json (JSON string override), templates-base
//   Properties: ready       — Promise resolved once the bar has been cloned in
//               menu        — array override; wins over menu-json and config.nav.menu (rebuilds)
//               active      — the current destination id
//               app         — the host application's id: the `app` attribute, else config.app.id.
//                             Mirrored to `data-app` on the host so a page can style or find the
//                             nav of a particular application.
//               workspaceOn — whether the workspace is on
//   Events (bubbles + composed):
//     nav-select     detail:{ id, href, action } — cancelable; a host may
//                    preventDefault() to intercept and handle in-app. Items with
//                    an href otherwise navigate natively.
//     workspace-toggle detail:{ on } — not dispatched while workspace-locked.
//     nav-tool-select  detail:{ id } — a Scenario/Display/Tools button in the bar, or the
//                    workspace row's settings gear, was pressed. The nav owns no tool UI of
//                    its own; whoever provides the surface (<taxpert-scenario-modal> for
//                    'scenario', <taxpert-display-modal> for 'display',
//                    <taxpert-workspace-settings-modal> for 'workspace-settings') listens.
//
// workspace-locked pins the workspace on and makes the toggle inert (disabled button,
// ignores clicks). For hosts where "workspace off" isn't a meaningful state — e.g.
// fact-explorer, whose whole app *is* a Taxpert Workspace destination — rather than a
// per-host on/off preference to track and hand across a cross-origin nav.
//
// See nav-menu-data.js for the taxonomy and helpers.
//
// ── The tool strip ────────────────────────────────────────────────────────────────────────────
//
// Which tool buttons the bar offers, and where each applies, is `config.nav.toolsByDestination`:
//
//   [{ id: 'scenario', label: 'Scenario', icon: 'tune', destinations: ['product-experience', …] }]
//
// `id` is what `nav-tool-select` carries — 'scenario' opens <taxpert-scenario-modal>, 'display'
// <taxpert-display-modal>, 'tools' <taxpert-tools-modal>; the nav owns no tool UI itself. `icon` is
// the stem of a `#tgn-icon-…` sprite id. `destinations` are menu-item ids, and a button hides itself
// anywhere else (CSS hides the whole strip once every button is hidden).
//
// This was three module-scope arrays here, which is how the shared nav came to know that
// fact-explorer has a destination called 'fact-explorer'. It is the host that knows where its
// tools apply, so the host says.

import { navMenu, contextLabel } from './nav-menu-data.js'
import { getConfig, CONFIG_CHANGE_EVENT } from '../../shared/js/config.js'
import { getTemplate } from '../../shared/js/templates.js'
import { loadNavTemplates } from './templates.js'
import { applyEmbedded } from '../../shared/js/embedded.js'

// Marked at module evaluation, not on connect: this module is loaded from <head> and the class it
// sets governs the whole workspace chrome (see shared/styles/embedded.css), so it has to be on the
// document before anything paints — including the bar this file defines.
applyEmbedded()

// Whether `active` is one of this group's children — i.e. the group is the place you are.
const groupHoldsActive = (group, active) =>
  !!active && group.children?.some((child) => child.id === active) === true

class TaxpertGlobalNav extends HTMLElement {
  constructor () {
    super()
    this._open = false
    this._menu = null // property override
    // group id → whether the user has explicitly opened (true) or shut (false) it. Absent means
    // the group is still following the active destination; see _isGroupOpen().
    this._groupOpen = new Map()
    this._connected = false
    this._rendered = false
    /** Resolves once the bar's DOM has been cloned in. */
    this.ready = Promise.resolve()
    this._onDocClick = (event) => {
      if (this._open && !this.contains(event.target)) this._close()
    }
    this._onKeydown = (event) => {
      if (event.key === 'Escape' && this._open) {
        this._close()
        this._button?.focus()
      }
    }
    // The taxonomy and the tool strip both come from the config, and a host may configure after the
    // bar has rendered — the templates arrive over a fetch, so which of the two wins is a race. Both
    // are rebuilt from scratch, which is safe here because neither carries state a user set: an
    // opened group is remembered in _groupOpen, not in the DOM.
    this._onConfigChange = () => {
      if (this._rendered) this._renderFromConfig()
    }
  }

  connectedCallback () {
    document.addEventListener('click', this._onDocClick)
    document.addEventListener('keydown', this._onKeydown)
    document.addEventListener(CONFIG_CHANGE_EVENT, this._onConfigChange)
    if (this._connected) return
    this._connected = true
    for (const name of ['menu', 'active', 'workspaceOn']) this._upgradeProperty(name)
    this.ready = loadNavTemplates(this).then(() => {
      if (this.isConnected && !this._rendered) this.render()
    })
  }

  // A host may assign one of these properties before this module has run — script order is the
  // host's business, and now that attributes are read once, properties are how changes arrive.
  // Without this the assignment sticks as an own property that shadows the accessor for good.
  _upgradeProperty (name) {
    if (!Object.hasOwn(this, name)) return
    // Reflect rather than `this[name]`, so the key stays an argument and never becomes a dynamic
    // computed member access.
    const value = Reflect.get(this, name)
    Reflect.deleteProperty(this, name)
    Reflect.set(this, name, value)
  }

  disconnectedCallback () {
    document.removeEventListener('click', this._onDocClick)
    document.removeEventListener('keydown', this._onKeydown)
    document.removeEventListener(CONFIG_CHANGE_EVENT, this._onConfigChange)
  }

  // --- public property API ---

  /** The host application's id — markup first, then the configured one. */
  get app () {
    return this.getAttribute('app') || getConfig().app.id
  }

  get menu () {
    if (this._menu) return this._menu
    const json = this.getAttribute('menu-json')
    if (json) {
      try {
        return JSON.parse(json)
      } catch (error) {
        console.warn('taxpert-global-nav: invalid menu-json attribute', error)
      }
    }
    return navMenu()
  }

  // The taxonomy itself changed, so this is the one setter that rebuilds anything.
  set menu (value) {
    this._menu = value
    if (this._rendered) this._renderTaxonomy()
  }

  get active () {
    return this.getAttribute('active')
  }

  set active (value) {
    if (value === null || value === undefined) this.removeAttribute('active')
    else this.setAttribute('active', value)
    if (this._rendered) this._syncActive()
  }

  get workspaceOn () {
    return this.workspaceLocked || this.getAttribute('workspace-on') === 'true'
  }

  set workspaceOn (value) {
    if (this.workspaceLocked) return
    this.setAttribute('workspace-on', String(Boolean(value)))
    if (this._rendered) this._syncWorkspace()
  }

  get workspaceLocked () {
    return this.getAttribute('workspace-locked') === 'true'
  }

  // --- interaction ---

  _toggle () {
    this._open ? this._close() : this._openMenu()
  }

  _openMenu () {
    this._open = true
    this._syncOpen()
  }

  _close () {
    if (!this._open) return
    this._open = false
    this._syncOpen()
  }

  // Whether a group's children are showing. A group opens itself when it holds the destination you
  // are on — arriving on Path Mode should show you the mode you're in, and its siblings. From
  // anywhere else (Fact Explorer, Authoring Suite) the modes are detail about a place you aren't,
  // so the group stays shut until asked. Either way an explicit toggle wins from then on.
  _isGroupOpen (group, active) {
    const chosen = this._groupOpen.get(group.id)
    return typeof chosen === 'boolean' ? chosen : groupHoldsActive(group, active)
  }

  _toggleGroup (groupId, header) {
    const open = header.getAttribute('aria-expanded') === 'true'
    this._groupOpen.set(groupId, !open)
    header.setAttribute('aria-expanded', String(!open))
  }

  _toggleWorkspace () {
    if (this.workspaceLocked) return
    const next = !this.workspaceOn
    // Self-set so the visual state persists; hosts sync via the event.
    this.workspaceOn = next
    this.dispatchEvent(
      new CustomEvent('workspace-toggle', {
        bubbles: true,
        composed: true,
        detail: { on: next },
      })
    )
  }

  _emitToolSelect (id) {
    this.dispatchEvent(
      new CustomEvent('nav-tool-select', {
        bubbles: true,
        composed: true,
        cancelable: true,
        detail: { id },
      })
    )
  }

  _onItemClick (event, item) {
    if (item.disabled) {
      event.preventDefault()
      return
    }
    const selectEvent = new CustomEvent('nav-select', {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: { id: item.id, href: item.href, action: item.action },
    })
    const proceed = this.dispatchEvent(selectEvent)
    // A host cancelled it, or the item is an explicit in-app action → don't navigate.
    if (!proceed || item.action) event.preventDefault()
    this._close()
  }

  // --- rendering (once) ---

  render () {
    this.classList.add('tgn-host')

    // The <use href="#tgn-icon-…"> references resolve against the document, so the sprite goes in
    // once per page rather than once per nav.
    if (!document.querySelector('.tgn-sprite')) {
      document.body.insertBefore(getTemplate('tgn-sprite'), document.body.firstChild)
    }

    this.replaceChildren(getTemplate('tgn-bar'))

    this._button = this.querySelector('.tgn-waffle')
    this._button.addEventListener('click', (event) => {
      event.stopPropagation()
      this._toggle()
    })

    // Clicks inside the menu shouldn't bubble to the document close handler.
    this._menuPanel = this.querySelector('.tgn-menu')
    this._menuPanel.addEventListener('click', (event) => event.stopPropagation())

    this._renderWorkspaceRow()
    this._renderFromConfig()

    this._rendered = true
    this._syncOpen()
    this._syncWorkspace()
    this._syncActive()
  }

  // Everything the config decides, in one call — so a configure() after the bar has rendered lands
  // through the same path the first render took.
  _renderFromConfig () {
    this.dataset.app = this.app
    this._renderTools()
    this._renderTaxonomy()
  }

  _renderTools () {
    const strip = this.querySelector('.tgn-tools')
    strip.replaceChildren()
    for (const tool of getConfig().nav.toolsByDestination) {
      const fragment = getTemplate('tgn-tool')
      const button = fragment.querySelector('button')
      button.dataset.tool = tool.id
      // Read by _syncActive to decide whether this tool applies where you are.
      button.dataset.destinations = (tool.destinations ?? []).join(' ')
      fragment.querySelector('use').setAttribute('href', `#tgn-icon-${tool.icon}`)
      fragment.querySelector('.tgn-tool__label').textContent = tool.label
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        this._emitToolSelect(tool.id)
      })
      strip.appendChild(fragment)
    }
  }

  _renderWorkspaceRow () {
    const label = this.getAttribute('workspace-label') || 'TAXPERT WORKSPACE'
    this.querySelector('.tgn-workspace__label').textContent = label

    const toggle = this.querySelector('.tgn-toggle')
    toggle.setAttribute('aria-label', label)
    if (this.workspaceLocked) {
      toggle.disabled = true
      toggle.title = 'Always on here'
    }
    toggle.addEventListener('click', (event) => {
      event.stopPropagation()
      this._toggleWorkspace()
    })

    this.querySelector('.workplace-settings').addEventListener('click', (event) => {
      event.stopPropagation()
      this._emitToolSelect('workspace-settings')
      this._close()
    })
  }

  // Every group and every leaf, built once. A collapsed group's children exist and are hidden by
  // `.tgn-group__header[aria-expanded="false"] + .tgn-group__items`.
  _renderTaxonomy () {
    for (const row of this._menuPanel.querySelectorAll(':scope > .tgn-group, :scope > .tgn-item')) {
      row.remove()
    }
    const active = this.active
    for (const item of this.menu) {
      if (item.children?.length) this._menuPanel.appendChild(this._renderGroup(item, active))
      else this._menuPanel.appendChild(this._renderLeaf(item))
    }
    if (this._rendered) this._syncActive()
  }

  _renderGroup (group, active) {
    const fragment = getTemplate('tgn-group')
    fragment.querySelector('.tgn-group').dataset.id = group.id
    fragment.querySelector('.tgn-group__label').textContent = group.label

    const header = fragment.querySelector('.tgn-group__header')
    header.setAttribute('aria-expanded', String(this._isGroupOpen(group, active)))
    header.addEventListener('click', (event) => {
      event.stopPropagation()
      this._toggleGroup(group.id, header)
    })

    const items = fragment.querySelector('.tgn-group__items')
    for (const child of group.children) items.appendChild(this._renderLeaf(child))
    return fragment
  }

  _renderLeaf (item) {
    const fragment = getTemplate('tgn-item')
    const link = fragment.querySelector('a')
    link.dataset.id = item.id
    fragment.querySelector('.tgn-item__label').textContent = item.label
    if (item.ff) link.dataset.ff = item.ff

    if (item.disabled) link.setAttribute('aria-disabled', 'true')
    else link.href = item.href || '#'

    link.addEventListener('click', (event) => this._onItemClick(event, item))
    return fragment
  }

  // --- targeted state sync ---

  _syncOpen () {
    this._button?.setAttribute('aria-expanded', String(this._open))
  }

  _syncWorkspace () {
    const on = this.workspaceOn
    // One attribute on the host for the whole "the workspace is on" question; global-nav.css hides
    // the tool strip, the taxonomy and the breadcrumb context off it.
    this.toggleAttribute('data-workspace-on', on)
    this.querySelector('.tgn-toggle')?.setAttribute('aria-checked', String(on))
    this._syncBreadcrumb()
  }

  _syncActive () {
    const active = this.active

    for (const link of this.querySelectorAll('.tgn-item')) {
      // "You are here" has one representation; the check mark follows it in CSS.
      if (link.dataset.id === active) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    }

    // A group opens itself when it holds the destination you are on, unless the user has said
    // otherwise. `:has(.tgn-item[aria-current])` handles the tint — the group's children are always
    // in the DOM now, so CSS can see them whether or not the group is expanded.
    for (const item of this.menu) {
      if (!item.children?.length) continue
      const header = this.querySelector(`.tgn-group[data-id="${item.id}"] .tgn-group__header`)
      if (header) header.setAttribute('aria-expanded', String(this._isGroupOpen(item, active)))
    }

    // Each tool picks its own destinations; the strip hides itself when none apply (CSS).
    for (const button of this.querySelectorAll('.tgn-tool')) {
      button.hidden = !button.dataset.destinations.split(' ').includes(active ?? '')
    }

    this._syncBreadcrumb()
  }

  // The workspace context (mode) only exists while the workspace is on; with it off the nav reverts
  // to its starting state — just the "Taxpert" root. A host can override the label via
  // `context-label` for a location that isn't a menu destination (e.g. fact-explorer's landing
  // page → "Taxpert Home"); otherwise it's derived from the active menu item (/fact-explorer →
  // "Fact Explorer").
  _syncBreadcrumb () {
    const crumb = this.querySelector('.tgn-breadcrumb')
    if (!crumb) return
    const ctx = this.workspaceOn
      ? this.getAttribute('context-label') || contextLabel(this.active, this.menu)
      : null

    const sep = crumb.querySelector('.tgn-breadcrumb__sep')
    const label = crumb.querySelector('.tgn-breadcrumb__ctx')
    sep.hidden = !ctx
    label.hidden = !ctx
    label.textContent = ctx ?? ''
  }
}

customElements.define('taxpert-global-nav', TaxpertGlobalNav)

export { TaxpertGlobalNav }
