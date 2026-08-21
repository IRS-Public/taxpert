// Scenario vocabularies — the one genuinely app-specific thing fact-explorer holds.
//
// A scenario filter set is not a path that can be parameterized into generality: credit-assistant's
// dropdowns say "Qualifying / Disqualifying", "Head of Household", "3 qualifying children", and its
// scenario *filenames* encode those same dimensions (`dq_hoh_married_2023_1tp_0qc.json`). None of
// that means anything to another app. So rather than pretend one vocabulary fits all, an app names
// the one it uses in its fact-explorer.app.json (`scenarios.vocabulary`) and gets it from here.
//
// The floor is `none`, and it is the common case: an app with no scenarios at all — as
// tax-withholding-estimator has — gets no filter dropdowns and a plain list of filenames. That is a
// working scenario picker, not a degraded one.
//
// Deliberately NOT a data-driven filter DSL in the descriptor. Exactly one vocabulary exists; a
// schema for expressing arbitrary ones would be inventing a language for a population of one. This
// lookup can grow a data branch later without a single caller changing, so the seam is already in
// the right place.

import { SCENARIO_FILTER_FIELDS as eitcFields } from './eitc-filters.js'
import { parseScenarioFilename as parseEitc } from './eitc-filename.js'

/**
 * @typedef {Object} ScenarioVocabulary
 * @property {Array<object>} fields  filter-dropdown descriptors for <taxpert-scenario-modal>
 * @property {(filename: string) => object} parseFilename decodes a filename into filter dimensions
 */

/** @type {ScenarioVocabulary} */
const NONE = { fields: [], parseFilename: () => ({}) }

/** @type {Record<string, ScenarioVocabulary>} */
const VOCABULARIES = {
  eitc: { fields: eitcFields, parseFilename: parseEitc },
  none: NONE,
}

/**
 * The vocabulary an app declared. Unknown or absent names resolve to `none` rather than throwing —
 * a scenario picker with no dropdowns is a much better failure than a fact-explorer that will not load.
 *
 * @param {string|null|undefined} id
 * @returns {ScenarioVocabulary}
 */
export function scenarioVocabulary(id) {
  return VOCABULARIES[id] ?? NONE
}

/** The vocabulary for a registry entry (`null` scenarios → `none`). */
export function vocabularyFor(app) {
  return scenarioVocabulary(app?.scenarios?.vocabulary)
}
