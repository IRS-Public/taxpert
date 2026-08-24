// Descriptors for the built-in audit-panel sections. The markup each one names lives in
// templates/audit-panel.html.
//
// Shape: { sectionId, dataTab, label, title, order, templateId?, wrapperClass?, ff?, eager?,
//          render?(el, ctx), buildBody?(el) }. `sectionId` and `dataTab` are depended on by exact
// value from both CSS and JS. `render` and `buildBody` are escape hatches for host-registered
// sections whose body genuinely is data-derived.
//
// The orders below have gaps. Four tabs moved into the nav's modals, and the remaining sections
// keep their positions. See ../../../../../docs/internals/audit-panel.md

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
