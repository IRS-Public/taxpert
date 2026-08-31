// Decodes a Direct File scenario filename into the dimensions its filter dropdowns offer.
//
// Direct File does not encode its scenarios positionally the way credit-assistant does
// (`dq_hoh_married_2023_1tp_3qcs_59899`). These are upstream's own identifiers — `ats_2_1099r`,
// `mfj_savers_both_spouses`, `ticket_10430_hsa` — kept verbatim so a scenario here and the backend
// scenario it came from are obviously the same one. So this reads *tokens*, not positions, and
// three things are legible in them: who is filing, what the scenario is about, and where it came
// from.
//
// Every dimension has an explicit "not named" value rather than an empty one. 73 of the 161 names
// say nothing about filing status and 78 name no topic — that is a fact about upstream's naming,
// and a person filtering the list should be able to see that set rather than have it silently
// counted as matching everything.
//
// The honest limit: this reads the name, not the return. A scenario whose graph files jointly but
// whose name does not say `mfj` lands in "Not named". Deriving these from the facts themselves
// would be exact, and would mean shipping a generated dimension map beside the corpus — worth doing
// if the filters get used enough to make the gap annoying, and deliberately not done first.

/** Filing statuses, as Direct File writes them in a scenario name. */
const FILING_STATUSES = ['mfj', 'mfs', 'single', 'hoh', 'qss']

/**
 * Topic → the name fragments that mean it. Ordered, so the label list and this stay in step.
 * Matched against the whole name rather than token-by-token, because upstream writes both
 * `1099r` and `1099_r`, and `dep_care` spans a separator.
 */
const TOPICS = [
  ['retirement', ['1099r', '1099_r']],
  ['ctc', ['ctc', 'odc']],
  ['eitc', ['eitc', '8862']],
  ['cdcc', ['cdcc', 'dep_care', 'depcare']],
  ['hsa', ['hsa']],
  ['savers', ['savers']],
  ['edc', ['edc']],
  ['ptc', ['ptc', '1095a', '1095_a']],
  ['jobs', ['w2', 'withholding']],
  ['apf', ['apf', 'alaska']],
  ['interest', ['1099int', '1099_int', 'interest']],
]

/**
 * Where the scenario came from, in precedence order. `general` is the rest, and it is most of them.
 *
 * `mef` comes before `ats` because every one of the nine names carrying it reads `mef_ats_*`, so the
 * two would otherwise collapse into ATS and the MeF set would be unreachable. They are kept apart on
 * purpose: the MeF ATS scenarios are the ones subject-matter experts ask for by name, and "the ATS
 * scenarios that go through MeF" is a different question from "the ATS scenarios".
 */
const SUITES = ['mef', 'ats', 'ticket', 'cfa']

/**
 * @param {string} filename e.g. "mfj_savers_both_spouses.json"
 * @returns {{filingStatus: string, topics: string[], suite: string}}
 */
export function parseScenarioFilename(filename) {
  const name = filename.replace(/\.json$/, '')
  const tokens = name.split('_')

  const filingStatus = FILING_STATUSES.find((status) => tokens.includes(status)) ?? 'unnamed'

  const topics = TOPICS.filter(([, fragments]) => fragments.some((f) => name.includes(f))).map(
    ([id]) => id
  )

  const suite = SUITES.find((s) => tokens.includes(s)) ?? 'general'

  // `topics` is the many-valued dimension the scenario modal supports: 12 of the 161 scenarios are
  // about two things, and filtering to either should find them.
  return { filingStatus, topics: topics.length > 0 ? topics : ['none'], suite }
}
