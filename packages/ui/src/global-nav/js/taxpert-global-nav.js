// <taxpert-global-nav>, the bar across the top of every workspace host: a waffle button, a
// breadcrumb, a strip of tool buttons, and a dropdown holding the workspace toggle and the
// navigation taxonomy.
//
// Vanilla custom element in light DOM, so it renders natively in credit-assistant, which has no
// build tools, and inside React and Vite in Fact Explorer.
//
// The markup is cloned in once on connect. Every state change after that moves an attribute, and
// global-nav.css decides what that looks like. Nothing is torn down and rebuilt, so a collapsed
// group's children still exist, which is what lets the stylesheet mark the group you are in with
// `:has(.tgn-item[aria-current])` rather than a class the JS has to remember to set.
//
// Attributes are configuration, read once on connect (docs/style-guides/javascript.md). Anything
// that changes afterwards changes through a property, and each setter does the one targeted update
// it implies.
//
// The nav owns no tool UI of its own. It emits nav-tool-select and whoever provides the surface
// listens.
//
// Attributes, properties, events, the taxonomy shape and the tool strip:
// ../../../../../docs/internals/global-nav.md

import { navMenu, contextLabel } from './nav-menu-data.js'
import { getConfig, CONFIG_CHANGE_EVENT } from '../../shared/js/config.js'
import { getTemplate } from '../../shared/js/templates.js'
import { loadNavTemplates } from './templates.js'
import { applyEmbedded } from '../../shared/js/embedded.js'

// At module evaluation rather than on connect. This module is loaded from <head>, and the class it
// sets governs the whole workspace chrome, so it has to land before anything paints.
applyEmbedded()

// Whether the group is the place you are.
const groupHoldsActive = (group, active) =>
  !!active && group.children?.some((child) => child.id === active) === true

class TaxpertGlobalNav extends HTMLElement {
  constructor () {
    super()
    this._open = false
    this._menu = null // property override
    // Group id to the choice a person made. Absent means the group still follows the active
    // destination. Held here rather than in the DOM, so a rebuild does not lose it.
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
    // A host may configure after the bar has rendered, the templates arriving over a fetch, so
    // which of the two wins is a race. Rebuilding both from scratch is safe because neither
    // carries state a person set.
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

  // A host may assign a property before this module has run, script order being the host's
  // business. Without this the assignment sticks as an own property and shadows the accessor.
  // Reflect rather than `this[name]`, so the key never becomes a computed member access.
  _upgradeProperty (name) {
    if (!Object.hasOwn(this, name)) return
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

  /** The host application's id: markup first, then the configured one. */
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

  // A group opens itself when it holds the destination you are on. From anywhere else its children
  // are detail about a place you are not, so it stays shut. An explicit toggle wins from then on.
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
    // Self-set so the visual state persists. Hosts sync through the event.
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
    // Cancelled by a host, or an explicit in-app action. Either way, do not navigate.
    if (!proceed || item.action) event.preventDefault()
    this._close()
  }

  // --- rendering (once) ---

  render () {
    this.classList.add('tgn-host')

    // The <use href> references resolve against the document, so once per page, not once per nav.
    if (!document.querySelector('.tgn-sprite')) {
      document.body.insertBefore(getTemplate('tgn-sprite'), document.body.firstChild)
    }

    this.replaceChildren(getTemplate('tgn-bar'))

    this._button = this.querySelector('.tgn-waffle')
    this._button.addEventListener('click', (event) => {
      event.stopPropagation()
      this._toggle()
    })

    // Clicks inside the menu must not bubble to the document close handler.
    this._menuPanel = this.querySelector('.tgn-menu')
    this._menuPanel.addEventListener('click', (event) => event.stopPropagation())

    this._renderWorkspaceRow()
    this._renderFromConfig()

    this._rendered = true
    this._syncOpen()
    this._syncWorkspace()
    this._syncActive()
  }

  // Everything the config decides, so a late configure() lands through the first render's path.
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
      button.dataset.destinations = (tool.destinations ?? []).join(' ') // read by _syncActive
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

  // A collapsed group's children are built and hidden, never left unbuilt.
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
    // One attribute for the whole question. global-nav.css hides the tool strip, the taxonomy and
    // the breadcrumb context off it.
    this.toggleAttribute('data-workspace-on', on)
    this.querySelector('.tgn-toggle')?.setAttribute('aria-checked', String(on))
    this._syncBreadcrumb()
  }

  _syncActive () {
    const active = this.active

    // "You are here" has one representation, and the check mark follows it in CSS.
    for (const link of this.querySelectorAll('.tgn-item')) {
      if (link.dataset.id === active) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    }

    for (const item of this.menu) {
      if (!item.children?.length) continue
      const header = this.querySelector(`.tgn-group[data-id="${item.id}"] .tgn-group__header`)
      if (header) header.setAttribute('aria-expanded', String(this._isGroupOpen(item, active)))
    }

    // Each tool picks its own destinations. CSS hides the strip once every button is hidden.
    for (const button of this.querySelectorAll('.tgn-tool')) {
      button.hidden = !button.dataset.destinations.split(' ').includes(active ?? '')
    }

    this._syncBreadcrumb()
  }

  // The context half exists only while the workspace is on. `context-label` overrides it for a
  // location that is not a menu destination.
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
