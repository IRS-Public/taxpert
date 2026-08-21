// How a host writes its flow markup, described rather than assumed.
//
// The workspace reads the host's *rendered page*, not just its fact graph: Inspect makes every
// question hoverable, the path cursor truncates at the first unanswered one, "Mark conditional
// items" injects a chip beside each `condition`/`operator` pair. All of that was written against
// credit-assistant's `fg-*` custom elements and USWDS classes, hardcoded across five modules.
//
// Every default below reproduces exactly what those modules did, so credit-assistant — and
// tax-withholding-estimator, which shares the same `fg-*` lineage — need supply nothing. A host
// with different markup overrides only the keys that differ:
//
//   configure({ flowDom: { questionTag: 'x-question', displayTag: 'x-display' } })
//
// ── uncuedPaths is the one default that changed ───────────────────────────────────────────────
//
// inspect-cues.js carried `UNCUED_DISPLAY_FACTS = new Set(['/taxYear'])`. `/taxYear` is a fact in
// *someone's* dictionary, not a platform concept, so it defaults to empty here and credit-assistant
// supplies it. If Inspect cues start appearing on every tax-year mention, that config line is
// missing — see credit-assistant's taxpert-config.html fragment.

/**
 * @typedef {object} FlowDom
 * @property {string} unitSelector     everything Inspect may attach a cue to
 * @property {string} questionTag      the element that asks a question and writes a fact
 * @property {string} displayTag       the element that prints a fact
 * @property {string} alertTag         the element that raises an alert / knockout
 * @property {string} collectionAddSelector  the "add another item" control in a collection
 * @property {string} pathAttr         attribute naming the fact a unit reads or writes
 * @property {string} conditionAttr    attribute naming a visibility condition's fact
 * @property {string} operatorAttr     attribute naming that condition's operator
 * @property {string} optionalAttr     attribute marking a question that cannot block the flow
 * @property {string} knockoutAttr     attribute marking an alert that ends the flow
 * @property {string} modalTag         an on-demand overlay: never a step on the path
 * @property {string} modalLinkSelector  the control that opens one of those overlays
 * @property {string} modalLinkAttr    attribute on that control naming the overlay's id
 * @property {string} screenSelector   one rendered screen, in the all-screens view
 * @property {string} titleSelector    where a question's own copy lives
 * @property {string} notTitleSelector chrome stripped out of that copy before it is read
 * @property {string[]} uncuedPaths    paths a display unit may print without earning a cue
 * @property {(el: Element) => boolean} isHidden
 * @property {(el: Element) => boolean} isAnswered
 * @property {(path: string, operator: string) => boolean} checkCondition
 */

/**
 * credit-assistant's conventions, which are also tax-withholding-estimator's. Returned fresh each
 * call so a host mutating its copy cannot corrupt the defaults.
 * @returns {FlowDom}
 */
export function defaultFlowDom () {
  return {
    unitSelector: 'fg-set, fg-show',
    questionTag: 'fg-set',
    displayTag: 'fg-show',
    alertTag: 'fg-alert',
    collectionAddSelector: '.fg-collection__add-item',

    pathAttr: 'path',
    conditionAttr: 'condition',
    operatorAttr: 'operator',
    optionalAttr: 'optional',
    knockoutAttr: 'knockout',

    modalTag: 'dialog',
    // The link and the overlay are described separately because "show modals inline" has to pair
    // them up: an overlay is authored at the foot of its page, and the only thing that says which
    // question it belongs to is the link pointing at its id.
    modalLinkSelector: 'modal-link',
    modalLinkAttr: 'for',
    screenSelector: 'article.screen',

    titleSelector: '.twe-question, legend, label',
    notTitleSelector: '.usa-hint',

    // Was ['/taxYear'] — an application fact, so it is the host's to supply. See the module comment.
    uncuedPaths: [],

    // A unit the host is not currently showing. `.hidden` is credit-assistant's own convention;
    // offsetParent catches display:none from any other source, and the getClientRects() fallback
    // covers position:fixed (whose offsetParent is null even when visible).
    isHidden (el) {
      if (!el) return true
      if (el.classList?.contains('hidden')) return true
      if (el.hasAttribute?.('hidden')) return true
      return el.offsetParent === null && el.getClientRects?.().length === 0
    },

    // Whether a question already has a value. The host's element is the authority — credit-assistant's
    // <fg-set> exposes a `value` getter — so this only falls back to reading form controls when it
    // doesn't. Overridable because "answered" is a host judgement: an empty string may or may not
    // count.
    isAnswered (el) {
      if (!el) return false
      if (typeof el.isAnswered === 'function') return Boolean(el.isAnswered())
      if ('value' in el && el.value !== undefined) return el.value !== null && el.value !== ''

      const controls = el.querySelectorAll?.('input, select, textarea') ?? []
      for (const control of controls) {
        if (control.type === 'checkbox' || control.type === 'radio') {
          if (control.checked) return true
        } else if (control.value !== '') {
          return true
        }
      }
      return false
    },

    // Evaluate a flow condition. There is no host-agnostic way to do this — it needs the fact graph
    // and the host's operator vocabulary — so the default answers `true` (nothing is conditioned
    // out) rather than guessing. credit-assistant injects its own via config; today it passes the
    // same function in as `checkConditionFn`.
    checkCondition () {
      return true
    },
  }
}

/** Fill in anything a partial descriptor left out. */
export function normalizeFlowDom (partial) {
  return { ...defaultFlowDom(), ...(partial ?? {}) }
}

/** True when `el` is a unit whose display fact is not worth a cue. */
export function isUncued (flowDom, el) {
  if (!el) return false
  if (el.tagName?.toLowerCase() !== flowDom.displayTag) return false
  return flowDom.uncuedPaths.includes(el.getAttribute(flowDom.pathAttr))
}
