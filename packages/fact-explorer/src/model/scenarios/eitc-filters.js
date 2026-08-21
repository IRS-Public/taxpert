// fact-explorer-owned EITC scenario-filter vocabulary for the shared <taxpert-scenario-modal>
// (taxpert/react/scenario-modal, mounted in FactExplorer.jsx). Verbatim port of the field
// descriptors credit-assistant registers for the same modal in Product Experience
// (website-static/js/scenario-filters.js) — the five filter dropdowns, ported from
// scenarios-section.html. Each `key` names the parseScenarioFilename() (scenarioFilename.js)
// dimension the dropdown filters on; `showFor` (marital only) hides the group unless another
// filter's value is in the given set (HOH-only, matching the original).
export const SCENARIO_FILTER_FIELDS = [
  {
    id: 'scenario-filter-dq',
    key: 'eligibility',
    label: 'Eligibility',
    options: [
      { value: '', label: 'All' },
      { value: 'qualifying', label: 'Qualifying' },
      { value: 'disqualifying', label: 'Disqualifying (DQ)' },
    ],
  },
  {
    id: 'scenario-filter-fs',
    key: 'filingStatus',
    label: 'Filing status',
    options: [
      { value: '', label: 'All' },
      { value: 'single', label: 'Single' },
      { value: 'hoh', label: 'Head of Household' },
      { value: 'qss', label: 'Qualifying Surviving Spouse' },
      { value: 'mfs', label: 'Married Filing Separately' },
    ],
  },
  {
    id: 'scenario-filter-marital',
    key: 'marital',
    label: 'Marital status (HOH)',
    groupId: 'scenario-filter-marital-group',
    showFor: { filter: 'scenario-filter-fs', values: ['', 'hoh'] },
    options: [
      { value: '', label: 'All' },
      { value: 'married', label: 'Married' },
      { value: 'unmarried', label: 'Unmarried' },
    ],
  },
  {
    id: 'scenario-filter-income',
    key: 'incomeBand',
    label: 'Income range',
    options: [
      { value: '', label: 'All' },
      { value: 'low', label: 'Low (~$17K–$19K)' },
      { value: 'mid-low', label: 'Mid-Low (~$46K–$51K)' },
      { value: 'mid-high', label: 'Mid-High (~$52K–$58K)' },
      { value: 'high', label: 'High (~$59K–$62K)' },
      { value: 'none', label: 'No income in filename' },
    ],
  },
  {
    id: 'scenario-filter-qc',
    key: 'qcCount',
    label: 'Qualifying children',
    options: [
      { value: '', label: 'All' },
      { value: '0', label: '0' },
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '3', label: '3' },
    ],
  },
]
