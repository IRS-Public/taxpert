// The Direct File scenario-filter vocabulary: three dropdowns over 161 backend scenarios.
//
// Each `key` names a dimension parseScenarioFilename() (direct-file-filename.js) returns. `topics`
// is many-valued; the other two are scalars.
export const SCENARIO_FILTER_FIELDS = [
  {
    id: 'scenario-filter-fs',
    key: 'filingStatus',
    label: 'Filing status',
    options: [
      { value: '', label: 'All' },
      { value: 'mfj', label: 'Married filing jointly' },
      { value: 'single', label: 'Single' },
      { value: 'hoh', label: 'Head of household' },
      { value: 'mfs', label: 'Married filing separately' },
      { value: 'qss', label: 'Qualifying surviving spouse' },
      { value: 'unnamed', label: 'Not named in the file' },
    ],
  },
  {
    id: 'scenario-filter-topic',
    key: 'topics',
    label: 'Topic',
    options: [
      { value: '', label: 'All' },
      { value: 'retirement', label: 'Retirement (1099-R)' },
      { value: 'ctc', label: 'Child Tax Credit / ODC' },
      { value: 'eitc', label: 'Earned Income Tax Credit' },
      { value: 'cdcc', label: 'Child & Dependent Care Credit' },
      { value: 'hsa', label: 'Health Savings Account' },
      { value: 'savers', label: "Saver's Credit" },
      { value: 'edc', label: 'Elderly & Disabled Credit' },
      { value: 'ptc', label: 'Premium Tax Credit' },
      { value: 'jobs', label: 'Jobs (W-2, withholding)' },
      { value: 'apf', label: 'Alaska Permanent Fund' },
      { value: 'interest', label: 'Interest' },
      { value: 'none', label: 'No topic in the file' },
    ],
  },
  {
    id: 'scenario-filter-suite',
    key: 'suite',
    label: 'Source',
    options: [
      { value: '', label: 'All' },
      { value: 'mef', label: 'MeF ATS' },
      { value: 'ats', label: 'ATS' },
      { value: 'ticket', label: 'Ticket repro' },
      { value: 'cfa', label: 'CFA' },
      { value: 'general', label: 'General' },
    ],
  },
]
