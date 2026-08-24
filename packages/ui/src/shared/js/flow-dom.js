// The host's flow markup, described as CSS selectors, attribute names and three predicates.
//
// The workspace reads the rendered page as well as the fact graph. Inspect makes questions
// hoverable, the path cursor truncates at the first unanswered one, and "Mark conditional items"
// chips each condition. The defaults reproduce the `fg-*` markup Form Builder's flow runtime
// renders, so a host on that markup supplies nothing and any other overrides only what differs.
//
// See ../../../../../docs/internals/workspace-configuration.md

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
 * The flow runtime's own conventions. Returned fresh each call, so a host mutating its copy cannot
 * corrupt the defaults.
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
    // Link and overlay are named separately because "show modals inline" has to pair them up. An
    // overlay is authored at the foot of its page, and only the link says which question it is for.
    modalLinkSelector: 'modal-link',
    modalLinkAttr: 'for',
    screenSelector: 'article.screen',

    titleSelector: '.twe-question, legend, label',
    notTitleSelector: '.usa-hint',

    // Application facts, so the host supplies them. Empty means every display unit earns a cue.
    uncuedPaths: [],

    // offsetParent catches display:none from any source. The getClientRects() fallback covers
    // position:fixed, whose offsetParent is null even when the element is visible.
    isHidden (el) {
      if (!el) return true
      if (el.classList?.contains('hidden')) return true
      if (el.hasAttribute?.('hidden')) return true
      return el.offsetParent === null && el.getClientRects?.().length === 0
    },

    // The host's element wins when it exposes isAnswered() or a `value` getter. Reading form
    // controls is the fallback. Overridable because whether an empty string counts is a host call.
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

    // Evaluating a real condition needs the graph and the host's operator vocabulary, so the
    // default concedes rather than guessing. Hosts override it.
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
