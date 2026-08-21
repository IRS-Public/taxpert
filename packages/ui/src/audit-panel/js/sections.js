// Descriptors for the built-in audit-panel sections. The markup each one names lives in
// templates/audit-panel.html (originally fragments/audit-panel/*.html); the handful of
// i18n-translated labels are English-only literals there (this is a dev-only tool and taxpert
// has no i18n system — but a host that server-renders a <template> with the same id wins over the
// bundle's, so credit-assistant can put the translated copies back without touching this package).
//
// Shape: { sectionId, dataTab, label, title, order, templateId?, wrapperClass?, ff?, eager?,
//          render?(el, ctx), buildBody?(el) }.
//   sectionId  — the section <div> id (CSS + JS depend on the exact original values)
//   dataTab    — the data-tab value the rail button + section share
//   label      — the short rail-tab label
//   title      — accessible tab title / sr-only name
//   order      — rail position
//   ff         — feature-flag name (kebab) gating the rail tab's visibility
//   templateId — the <template> the panel clones into the section container
//   render / buildBody — escape hatches for host-registered sections whose body genuinely is
//                        data-derived (credit-assistant's eligibility-dashboard-plugin.js)
//
// The CA-owned Eligibility section is registered separately at runtime via registerSection().
//
// Four former tabs are no longer here, and their orders are left as gaps so the remaining
// sections keep their positions:
//   • Graph Inspector (30) and Scenarios (60) — putting a Fact Graph on the page is a setup task,
//     not inspection, so both moved into the "Manage scenario" modal behind the global nav's
//     Scenario button (see scenario-modal.js).
//   • Flow Inspector (10) — its one control, "Show conditions", is a view preference rather than
//     inspection, so it moved into the "Display options" modal behind the nav's Display button as
//     "Mark conditional items" (see display-modal.js).
//   • Feature Flags (70) — choosing alpha features isn't inspection either, so it moved into the
//     "Workspace settings" modal behind the nav's settings gear (see workspace-settings-modal.js).

export const BUILT_IN_SECTIONS = [
  {
    sectionId: 'audit-panel-fact-graph-section',
    dataTab: 'fact-graph',
    label: 'Fact',
    title: 'Fact Inspector',
    order: 20,
    templateId: 'tap-fact-inspector',
  },
  {
    sectionId: 'audit-panel-explain-section',
    dataTab: 'chat-explain',
    label: 'Explain',
    title: 'Explain',
    order: 50,
    wrapperClass: 'audit-panel__section--chat',
    ff: 'ai-fact-explanation',
    templateId: 'tap-explain',
  },
]
