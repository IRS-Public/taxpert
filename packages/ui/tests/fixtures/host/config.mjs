// The fixture host's registration — everything a new Form Builder app has to say for itself.
//
// This file is the worked example the plan promised: a host supplies a config object and a graph
// adapter, and gets the whole workspace with zero edits inside taxpert. If adopting the library
// ever needs more than this, that is the regression.
//
// It is deliberately *hostile* to any leftover assumption:
//
//   · the flow markup is <x-question>/<x-display>, not fg-set/fg-show
//   · the attributes are `fact`/`when`/`test`, not path/condition/operator
//   · the change events are the host's own, not fg-load/fg-update
//   · the storage prefix is its own, so it cannot collide with another app's watchlist
//   · nothing here is a tax concept
//
// The real second host (tax-withholding-estimator) shares credit-assistant's fg-* lineage, so it
// would override almost none of the flowDom block. That is exactly why the fixture overrides all of
// it: TWE proves the config surface is *sufficient*, and this proves it is *complete*.

import { createFixtureGraph } from './graph.mjs'

/** The fixture host's navigation. Two top-level leaves and a group, on its own routes. */
export const FIXTURE_HOST_MENU = [
  {
    id: 'pet-planner',
    label: 'Pet Planner',
    children: [
      { id: 'planner', label: 'Planner', href: '/fixture/' },
      { id: 'all-steps', label: 'All Steps', href: '/fixture/all-steps/' },
    ],
  },
  { id: 'fixture-docs', label: 'Docs', href: '/fixture/docs/' },
]

/** Which nav destinations show which workspace buttons. */
export const FIXTURE_HOST_TOOLS = [
  { id: 'scenario', label: 'Scenario', icon: 'tune', destinations: ['planner'] },
  { id: 'display', label: 'Display', icon: 'visibility', destinations: ['planner', 'all-steps'] },
  { id: 'tools', label: 'Tools', icon: 'build', destinations: ['planner'] },
]

/**
 * The host's markup conventions — nothing in common with credit-assistant's.
 *
 * `checkCondition` and `isAnswered` are the two the host must really own: the first needs the graph
 * and the host's operator words, the second is a judgement about what "answered" means here.
 */
export function fixtureFlowDom (graph) {
  return {
    unitSelector: 'x-question, x-display',
    questionTag: 'x-question',
    displayTag: 'x-display',
    alertTag: 'x-notice',
    collectionAddSelector: '.x-collection-add',

    pathAttr: 'fact',
    conditionAttr: 'when',
    operatorAttr: 'test',
    optionalAttr: 'skippable',
    knockoutAttr: 'stop',

    modalTag: 'x-overlay',
    modalLinkSelector: 'x-overlay-link',
    modalLinkAttr: 'opens',
    screenSelector: 'article.step',

    titleSelector: '.x-prompt, legend, label',
    notTitleSelector: '.x-hint',

    // The fixture's own equivalent of credit-assistant's /taxYear: a constant spliced through the
    // copy that would otherwise earn a cue on every mention.
    uncuedPaths: ['/petKind'],

    isHidden: (el) => Boolean(el?.hasAttribute?.('data-off')),

    isAnswered (el) {
      const fact = el?.getAttribute?.('fact')
      if (!fact) return false
      const state = safely(() => graph.get(fact))
      return Boolean(state?.complete)
    },

    checkCondition (fact, test) {
      const state = safely(() => graph.get(fact))
      if (!state?.complete) return false
      return test === 'isTrue' ? state.get === true : state.get === false
    },
  }
}

function safely (read) {
  try {
    return read()
  } catch {
    return undefined
  }
}

/**
 * The fixture host's single determination.
 *
 * One is enough to prove the tracker renders from config rather than from a list it ships. Its
 * rollup is an **enum**, not a boolean, so the `map` outcome kind is exercised — the branch that
 * only `/derivedFilingStatus` reached before this refactor. Declared as a descriptor rather than a
 * function because that is what a new host should copy: it is the form that survives a round trip
 * through JSON and can be edited from Workspace settings.
 */
export const FIXTURE_HOST_DETERMINATIONS = [
  {
    id: 'pet-readiness',
    label: 'Pet readiness',
    rollupPath: '/petDecision',
    outcome: { kind: 'map', values: { approved: 'Ready for a pet' } },
    sections: [
      { heading: 'Household', facts: ['/hasPet', '/wantsPet', '/petCount'] },
      { heading: 'Means', facts: ['/monthlyBudget', '/hasBudget', '/isReadyForPet', '/petDecision'] },
    ],
  },
]

/**
 * Register the fixture host. Returns the graph handle so a caller can drive values and fire the
 * host's change events.
 *
 * @param {(partial: object) => object} configure the library's configure(), passed in so this
 *   fixture never imports across into src/ — the spec and demo page each supply their own.
 */
export function registerFixtureHost (configure, graphOptions) {
  const { adapter, set, values } = createFixtureGraph(graphOptions)

  configure({
    app: { id: 'fixture-host', brand: 'Fixture', storagePrefix: 'fixture' },
    nav: { menu: FIXTURE_HOST_MENU, toolsByDestination: FIXTURE_HOST_TOOLS },
    endpoints: { apiBase: 'http://localhost:9999', scenariosBase: '/fixture/scenarios' },
    featureFlags: [{ name: 'petMode', kebab: 'pet-mode' }],
    determinations: FIXTURE_HOST_DETERMINATIONS,
    graph: adapter,
    flowDom: fixtureFlowDom(adapter),
  })

  return { adapter, set, values }
}
