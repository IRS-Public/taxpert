// <taxpert-screens-toolbar>, the sub-nav under the global nav on all three Experience Explorer
// destinations: the Product Experience, Path Mode and Browse All.
//
// A light-DOM custom element, matching taxpert-global-nav. It names the current destination,
// renders the per-section tab strip, persists its state to sessionStorage, and drives the host
// page. In Path Mode it also hides the screens the person would not reach, plus everything past the
// point of progress (path-cursor.js).
//
// In the Product Experience it is the identity block and nothing else. A walkthrough has no listing
// to filter and no path to truncate, so everything below that block is skipped rather than rendered
// inert.
//
// Which elements are questions and which are screens comes from getConfig().flowDom, read at apply
// time rather than captured, so a host that configure()s after this module loads is still described
// correctly.
//
// Properties, how `mode` resolves, and why the layout controls left: ../../../../../docs/internals/audit-panel.md

import { applyPathCursor, clearPathCursor } from './path-cursor.js'
import { applyDisplayOptions } from './display-options.js'
import { HOST_LANGUAGE_SELECT } from '../../shared/js/dom.js'
import { getTemplate } from '../../shared/js/templates.js'
import { loadToolbarTemplates } from './templates.js'
import { getConfig } from '../../shared/js/config.js'
import { storageKey } from '../../shared/js/storage-keys.js'

// storageKey('allScreens') is called at each read and write, never captured: this module is
// imported before the host calls configure(), so a captured key would pin the default prefix.

const DEFAULTS = {
  section: '',
  scenarioFilename: '',
}

// Titles and descriptions are copy and live in the template. What is left here is the nav id each
// destination maps to, and whether it is a screen listing, meaning there is something under the bar
// to filter, gate or truncate. The Product Experience is the one that is not.
const MODES = new Map([
  ['product', { navId: 'product-experience', listing: false }],
  ['path', { navId: 'path-mode', listing: true }],
  ['browse', { navId: 'browse-all', listing: true }],
])

// The element is the authority where it can be, its isComplete() reading completeness straight off
// the graph. A host whose questions offer no such method falls through to flowDom.isAnswered.
const defaultIsAnswered = (el) => {
  try {
    if (typeof el?.isComplete === 'function') return el.isComplete() === true
  } catch (e) {
    // An unreadable path counts as answered: better to show more of the path than to truncate it
    // on a question the person is not actually sitting on.
    return true
  }
  return getConfig().flowDom.isAnswered(el)
}

/** The destination the current URL asks for. Exported so hosts can align other chrome with it. */
export function currentMode (search = globalThis.location?.search ?? '') {
  return new URLSearchParams(search).get('mode') === 'path' ? 'path' : 'browse'
}

function readStorage () {
  try {
    const raw = sessionStorage.getItem(storageKey('allScreens'))
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch (e) {
    return { ...DEFAULTS }
  }
}

function writeStorage (patch) {
  sessionStorage.setItem(storageKey('allScreens'), JSON.stringify({ ...readStorage(), ...patch }))
}

class TaxpertScreensToolbar extends HTMLElement {
  constructor () {
    super()
    this._sections = []
    this._mode = null // property override; falls back to the URL
    this._checkConditionFn = null
    this._isAnsweredFn = defaultIsAnswered
    this._warnedNoCheckCondition = false
    this._connected = false
    this._rendered = false
    /** Resolves once the toolbar's DOM has been cloned in. */
    this.ready = Promise.resolve()
    // Stored so a re-render detaches the previous listener rather than leaking one.
    this._fgUpdateHandler = null
  }

  connectedCallback () {
    if (this._connected) return
    this._connected = true
    this.ready = loadToolbarTemplates(this).then(() => {
      if (this.isConnected) this.render()
    })
  }

  get sections () {
    return this._sections
  }

  set sections (value) {
    this._sections = Array.isArray(value) ? value : []
    if (this._rendered) this.render()
  }

  // Property, then attribute, then the URL. The attribute is how a server-rendered mount states a
  // destination the URL cannot.
  get mode () {
    const attr = this.getAttribute('mode')
    return this._mode ?? (MODES.has(attr) ? attr : currentMode())
  }

  // Reflected, so the stylesheet can select on it. `[mode="product"]` hides the section tabs.
  set mode (value) {
    this._mode = MODES.has(value) ? value : null
    if (this._mode) this.setAttribute('mode', this._mode)
    if (this._rendered) this.render()
  }

  // Reads back whichever evaluator is actually in use, the host having two ways to supply one.
  get checkConditionFn () {
    return this._checkConditionFn ?? getConfig().flowDom.checkCondition
  }

  set checkConditionFn (fn) {
    this._checkConditionFn = typeof fn === 'function' ? fn : null
  }

  get isAnsweredFn () {
    return this._isAnsweredFn
  }

  set isAnsweredFn (fn) {
    this._isAnsweredFn = typeof fn === 'function' ? fn : defaultIsAnswered
  }

  _emit (name, detail) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }))
  }

  // ── Host-page effects ────────────────────────────────────────────────────────

  // Empty slug shows every section. The comparison is between two elements' attribute values,
  // which no CSS selector expresses, so `hidden` on each section is the contract.
  _showSection (slug) {
    document.querySelectorAll('main .all-screens__section').forEach((section) => {
      section.hidden = !!slug && section.dataset.section !== slug
    })
  }

  // The one implementation of "this section is selected". Restore-from-storage and click both go
  // through here, having once each toggled the class themselves and been able to disagree.
  _selectSection (slug, { scroll = false, persist = false, emit = false } = {}) {
    for (const tab of this.querySelectorAll('.all-screens__section-tab')) {
      tab.setAttribute('aria-selected', String(tab.dataset.section === slug))
    }
    this._showSection(slug)
    if (persist) writeStorage({ section: slug })
    if (scroll && slug) {
      document.getElementById(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    if (emit) this._emit('section-select', { slug })
  }

  // Re-evaluate each single-question screen's gate against the loaded graph, hiding screens the
  // person would not reach, then truncate at the point of progress. Multi-question screens have no
  // gate and are always shown.
  //
  // Evaluating a condition needs the graph and the host's operator vocabulary, so it can only come
  // from the host. With none set, the default answers true, showing every screen rather than
  // guessing one away, and warns once naming the property to set.
  _applyMode (mode) {
    const enabled = mode === 'path'
    document.body.classList.toggle('path-mode', enabled)

    if (!enabled) clearPathCursor(document)

    if (enabled && !this._checkConditionFn && !this._warnedNoCheckCondition) {
      console.warn('taxpert-screens-toolbar: no checkConditionFn set — Path Mode is evaluating gates with getConfig().flowDom.checkCondition.')
      this._warnedNoCheckCondition = true
    }

    const checkCondition = this.checkConditionFn
    const screenSelector = getConfig().flowDom.screenSelector

    // Browse All shows every screen, so this also has to un-hide whatever Path Mode hid.
    document.querySelectorAll(`${screenSelector}[data-gate-condition]`).forEach((screen) => {
      const condition = screen.dataset.gateCondition
      const operator = screen.dataset.gateOperator
      screen.hidden = enabled && !checkCondition(condition, operator)
    })

    if (enabled) applyPathCursor(document, { checkCondition, isAnswered: this._isAnsweredFn })
  }

  // ── Render + wire ────────────────────────────────────────────────────────────

  render () {
    this.replaceChildren(getTemplate('tst-toolbar'))

    // Every destination's title block ships in the template. `hidden` rather than a rebuild, so
    // the copy stays where copy belongs.
    const mode = this.mode
    for (const block of this.querySelectorAll('.all-screens__mode')) {
      block.hidden = block.dataset.mode !== mode
    }

    // However the mode was resolved, it reads back off the host from here on.
    this.setAttribute('mode', mode)

    this._syncNavActive(mode)
    this._syncLanguageLinks(mode)
    // Only the listings need this. One generated page serves two of them, so the server can title
    // it as only one. The Product Experience's own <title> is the product's.
    if (MODES.get(mode)?.listing) this._syncDocumentTitle(mode)

    const nav = this.querySelector('.all-screens__section-tabs')
    for (const section of this._sections) {
      const tab = getTemplate('tst-section-tab').querySelector('button')
      tab.dataset.section = section.slug
      tab.textContent = section.title
      nav.appendChild(tab)
    }

    this._rendered = true
    this._init()
  }

  // One generated page serves two nav destinations, so the host can only server-render one
  // `active` for both. The mode is known here and nowhere else. The nav's setter tolerates being
  // called before its own templates land.
  _syncNavActive (mode) {
    const navId = MODES.get(mode)?.navId
    if (!navId) return
    const bar = document.querySelector('taxpert-global-nav')
    if (bar) bar.active = navId
  }

  // The server writes one route per locale and never sees a query string, so every route points at
  // Browse All. Carry the destination across so a language switch does not change which listing you
  // are reading. A route that already carries a query is a host writing its own destinations, and
  // is left alone.
  _syncLanguageLinks (mode) {
    if (mode !== 'path') return
    for (const option of document.querySelectorAll(`${HOST_LANGUAGE_SELECT} option`)) {
      if (option.value && !option.value.includes('?')) option.value = `${option.value}?mode=path`
    }
  }

  // Reused from the visible mode block rather than kept as a second copy, so a host that
  // server-renders a translated toolbar gets a translated tab title for free.
  _syncDocumentTitle (mode) {
    const title = this.querySelector(`.all-screens__mode[data-mode="${mode}"] .all-screens__mode-title`)
    const text = title?.textContent?.trim()
    if (text) document.title = text
  }

  _init () {
    // Detach the previous render's listener before wiring the fresh controls.
    if (this._fgUpdateHandler) {
      document.removeEventListener('fg-update', this._fgUpdateHandler)
      this._fgUpdateHandler = null
    }

    const mode = this.mode

    // On the Product Experience the bar is the whole of this element. Everything below drives a
    // page of screens that is not there, and the audit panel's enable() applies the display
    // options on that page.
    if (!MODES.get(mode)?.listing) return

    // A tick for collection instances to materialize before opening details and annotating.
    setTimeout(() => {
      applyDisplayOptions()
      this._applyMode(mode)
    }, 100)

    // The walk needs each question element upgraded, and on a cold load the host may still be
    // fetching its dictionary, so re-apply once the definition lands. Skipped for a built-in
    // questionTag: nothing to upgrade, and whenDefined() throws on a name without a hyphen.
    const questionTag = getConfig().flowDom.questionTag
    if (questionTag.includes('-')) {
      globalThis.customElements?.whenDefined(questionTag).then(() => {
        if (this.isConnected) this._applyMode(this.mode)
      })
    }

    // Path Mode has no tabs, and must not inherit the section Browse All was last filtered to.
    this._selectSection(mode === 'path' ? '' : readStorage().section)

    // Re-evaluate gated screens as answers are edited directly on this page.
    this._fgUpdateHandler = () => this._applyMode(mode)
    document.addEventListener('fg-update', this._fgUpdateHandler)

    for (const tab of this.querySelectorAll('.all-screens__section-tab')) {
      tab.addEventListener('click', () =>
        this._selectSection(tab.dataset.section, { scroll: true, persist: true, emit: true })
      )
    }
  }
}

customElements.define('taxpert-screens-toolbar', TaxpertScreensToolbar)

export { TaxpertScreensToolbar }
