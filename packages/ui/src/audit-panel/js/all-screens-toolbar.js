// <taxpert-screens-toolbar> — the sub-nav under the global nav, on all three of the Experience
// Explorer's destinations: the Product Experience, Path Mode and Browse All.
//
// It began as the two screen listings' toolbar, and the name still says so. The Product Experience
// gained the same bar because a workspace destination should say which destination it is — the nav
// tells you where you can go, the bar tells you where you are. There it is *only* that: one title
// block and nothing else, since a walkthrough has no listing to filter and no path to truncate.
// Everything below the identity block — the section tabs, the gate evaluation, the point-of-progress
// cursor — is skipped in that mode rather than rendered inert.
//
// A framework-agnostic light-DOM custom element (matching taxpert-global-nav). It names the current
// destination, renders the per-section tab strip, persists its state to sessionStorage under the
// namespaced 'allScreens' key, and drives the host page: it shows/hides sections and (in Path Mode,
// given a host-supplied checkConditionFn) hides the single-question screens the user wouldn't reach plus
// everything past the point of progress (see path-cursor.js). The "force collections to render"
// bootstrap that manipulates core flow elements stays in the host (all-screens-bootstrap.js).
//
// The layout choice and "expand all accordions" used to be checkboxes here. They are view
// preferences shared with the Product Experience, so they moved into the Display options modal
// behind the global nav's Display button; the toolbar only re-applies the stored options once the
// page's flow elements exist (see display-options.js).
//
// Path Mode is one continuous path, so it renders without the per-section tab strip — filtering a
// path by section is off-message.
//
// Browse All and Path Mode are separate destinations in the global nav, not a checkbox on one
// page — the mode comes from the URL (`?mode=path`), never from a control in this toolbar, so
// switching modes is a navigation. Hosts that serve the two from genuinely different routes can
// set the `mode` property instead.
//
// The Product Experience is a different generated template altogether, and no `?mode=` says so, so
// there the host states it in the markup: `<taxpert-screens-toolbar mode="product">`. Attribute
// rather than property because that mount is a server-rendered tag with no script beside it.
//
// Public API
//   Properties:
//     sections        — [{ slug, title }] rendered as section tabs (like taxpert-global-nav's menu)
//     mode            — 'product' | 'browse' | 'path'. Property first, then the `mode` attribute,
//                       then currentMode() (read from the URL).
//     checkConditionFn — (conditionPath, operator) => boolean; the host passes CA's core
//                        checkCondition. Unset → falls back to getConfig().flowDom.checkCondition,
//                        with a one-time warning saying so.
//     isAnsweredFn    — (questionElement) => boolean; whether a question already has an answer.
//                       Defaults to the element's own isComplete(), which CA's <fg-set> provides,
//                       and to getConfig().flowDom.isAnswered for a host whose questions don't.
//   Events (bubble + composed): section-select {slug}
//
// Which elements are questions and which are screens comes from getConfig().flowDom (flow-dom.js),
// read at apply time rather than captured, so a host that configure()s after this module loads is
// still described correctly.

import { applyPathCursor, clearPathCursor } from './path-cursor.js'
import { applyDisplayOptions } from './display-options.js'
import { HOST_LANGUAGE_SELECT } from '../../shared/js/dom.js'
import { getTemplate } from '../../shared/js/templates.js'
import { loadToolbarTemplates } from './templates.js'
import { getConfig } from '../../shared/js/config.js'
import { storageKey } from '../../shared/js/storage-keys.js'

// storageKey('allScreens') is called at each read and write, never captured in a module-scope const:
// this module is imported before the host calls configure(), so a captured key would pin the
// default 'taxpert:' prefix forever and a host's own namespace would silently never take effect.
//
// A host that adopts a storagePrefix therefore forgets its selected section once, on the next load.
// That is accepted — one click to restore, and migration code for it would outlive its usefulness
// by years.

const DEFAULTS = {
  section: '',
  scenarioFilename: '',
}

// The three destinations this bar serves. Their titles and descriptions are copy, so they live in
// templates/all-screens-toolbar.html; what's left here is the nav id each one maps to, and whether
// the destination is a screen *listing* — i.e. whether there is anything under the bar for it to
// filter, gate or truncate. The Product Experience is the one that isn't.
const MODES = new Map([
  ['product', { navId: 'product-experience', listing: false }],
  ['path', { navId: 'path-mode', listing: true }],
  ['browse', { navId: 'browse-all', listing: true }],
])

// The default "has this question been answered?" test. The element is the authority where it can
// be: CA's <fg-set> exposes isComplete(), which reads the fact's completeness straight off the Fact
// Graph, and nothing outside the host can answer that as well. A host whose questions offer no such
// method falls through to flowDom.isAnswered, which reads the element's value or its form controls.
const defaultIsAnswered = (el) => {
  try {
    if (typeof el?.isComplete === 'function') return el.isComplete() === true
  } catch (e) {
    // A path that can't be read (a collection item that hasn't materialized, say) counts as
    // answered: better to show more of the path than to truncate it on a question the user
    // isn't actually sitting on.
    return true
  }
  return getConfig().flowDom.isAnswered(el)
}

// The Experience Explorer destination the current URL asks for. Exported so hosts can align other
// chrome with it (credit-assistant uses it to set the global nav's active item).
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
    // Stored so re-render (connect → sections-set) can detach the previous listener rather than
    // leaking one bound to a now-removed toggle.
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
  // destination the URL cannot: the Product Experience is its own template, not a `?mode=` on the
  // listing page.
  get mode () {
    const attr = this.getAttribute('mode')
    return this._mode ?? (MODES.has(attr) ? attr : currentMode())
  }

  // Reflected, so the stylesheet can select on it — `[mode="product"]` is what hides the section
  // tabs, the same "visual state is a selector on an attribute the JS already sets" shape the rest
  // of the package uses.
  set mode (value) {
    this._mode = MODES.has(value) ? value : null
    if (this._mode) this.setAttribute('mode', this._mode)
    if (this._rendered) this.render()
  }

  // Reads back the evaluator actually in use, which is the descriptor's when the host set none —
  // configuring flowDom.checkCondition is the other way to supply one, and a caller asking this
  // property what will be used should not have to know which route the host took.
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

  // Show only the section matching `slug`. Empty slug means show every section. The comparison is
  // between two elements' attribute values, which no CSS selector can express, so `hidden` on each
  // section is the contract — the same shape the audit panel's tab sections use.
  _showSection (slug) {
    document.querySelectorAll('main .all-screens__section').forEach((section) => {
      section.hidden = !!slug && section.dataset.section !== slug
    })
  }

  // The one implementation of "this section is the selected one". Both the restore-from-storage
  // path and the click path go through here; they used to each toggle the active class themselves,
  // and could disagree.
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

  // Path Mode: re-evaluate each single-question screen's gating condition against the loaded
  // Fact Graph, hiding screens the user wouldn't reach. Multi-question screens have no gating
  // condition and are always shown; their inner conditioned elements are hidden by the `.hidden`
  // class that toggling body.path-mode activates. Then truncate the whole page at the point of
  // progress (path-cursor.js) so nothing past the next unanswered question shows.
  //
  // Evaluating a condition needs the fact graph and the host's operator vocabulary, so it can only
  // come from the host. Where none was set the descriptor's default answers "true" — nothing is
  // conditioned out, which shows every screen rather than guessing one away — and the warning names
  // the property to set, once.
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

    // Browse All shows every screen, so this also has to *un*-hide whatever Path Mode hid.
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

    // Every destination's title block ships in the template; show the one you're on. `hidden`
    // rather than a rebuild, so the copy stays where copy belongs.
    const mode = this.mode
    for (const block of this.querySelectorAll('.all-screens__mode')) {
      block.hidden = block.dataset.mode !== mode
    }

    // Whatever the mode was resolved *from* — property, attribute or URL — it reads back off the
    // host from here on, which is what lets the stylesheet select on it.
    this.setAttribute('mode', mode)

    this._syncNavActive(mode)
    this._syncLanguageLinks(mode)
    // The Product Experience's own <title> is the product's, server-rendered per page. Only the
    // listings need this: one generated page serves two of them, so the server can title it as only
    // one.
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

  // Browse All and Path Mode are two nav destinations served by one generated page, told apart by
  // `?mode=path` at runtime — so the host can only ever server-render one `active` for both (CA's
  // AllScreens.scala hard-codes "browse-all"). The mode is known here and nowhere else, so this is
  // what tells the nav which destination you are actually on; without it Path Mode wore Browse
  // All's identity and got Browse All's tool strip. The nav's `active` setter tolerates being
  // called before its own templates land — it sets the attribute, and its render() syncs from it.
  _syncNavActive (mode) {
    const navId = MODES.get(mode)?.navId
    if (!navId) return
    const bar = document.querySelector('taxpert-global-nav')
    if (bar) bar.active = navId
  }

  // The page's language selector (shared/js/dom.js) holds one route per locale, written by the
  // server — which sees a path and never a query string, so every one of those routes points at
  // Browse All. Carry the destination across, so switching language from Path Mode lands in Path
  // Mode rather than quietly changing which listing you are reading.
  //
  // Done here rather than in the Display modal that shows the control, because the mode is this
  // element's to know: it is the only thing on the page that reads `?mode=` (see currentMode). A
  // route that already carries a query is left alone — that is a host writing its own destinations,
  // and this has nothing to add to one.
  _syncLanguageLinks (mode) {
    if (mode !== 'path') return
    for (const option of document.querySelectorAll(`${HOST_LANGUAGE_SELECT} option`)) {
      if (option.value && !option.value.includes('?')) option.value = `${option.value}?mode=path`
    }
  }

  // One generated page serves both destinations, so the server can only ever title it one of them.
  // The visible mode block already names the page — reuse that text rather than a second copy of it
  // here, which also means a host that server-renders a translated #tst-toolbar gets a translated
  // tab title for free.
  _syncDocumentTitle (mode) {
    const title = this.querySelector(`.all-screens__mode[data-mode="${mode}"] .all-screens__mode-title`)
    const text = title?.textContent?.trim()
    if (text) document.title = text
  }

  _init () {
    // Detach the fg-update listener from any previous render before wiring the fresh controls.
    if (this._fgUpdateHandler) {
      document.removeEventListener('fg-update', this._fgUpdateHandler)
      this._fgUpdateHandler = null
    }

    const mode = this.mode

    // On the Product Experience the bar is the whole of this element: there is no listing to show,
    // filter, gate or truncate, and the display options are applied by the audit panel's enable()
    // on that page. Everything below drives a page of screens that isn't there.
    if (!MODES.get(mode)?.listing) return

    // Give fg-components a tick to materialize collection instances before we open details and
    // render condition annotations. (The host bootstrap sets disallowempty on the collections.)
    setTimeout(() => {
      applyDisplayOptions()
      this._applyMode(mode)
    }, 100)

    // The point-of-progress walk asks each question whether it's answered, so it needs the element
    // upgraded. On a cold load the host's fact-graph module can still be fetching its dictionary at
    // the 100ms mark above, so re-apply once the definition lands. Skipped when the host's
    // questionTag is a built-in element — there is nothing to upgrade, and whenDefined() throws on a
    // name without a hyphen.
    const questionTag = getConfig().flowDom.questionTag
    if (questionTag.includes('-')) {
      globalThis.customElements?.whenDefined(questionTag).then(() => {
        if (this.isConnected) this._applyMode(this.mode)
      })
    }

    // Path Mode has no tabs (CSS hides the strip on body.path-mode), and must not inherit the
    // section Browse All was last filtered to.
    this._selectSection(mode === 'path' ? '' : readStorage().section)

    // Re-evaluate gated screens as the user edits answers directly on this page.
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
