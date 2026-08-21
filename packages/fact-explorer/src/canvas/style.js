// Visual vocabulary for node categories and edge kinds. Kept in one place so
// the legend and the canvas never drift. Rich per-tag node components (octagons,
// dashed group frames, input-type badges) are later milestones (M2–M4); for the
// M0 prototype we color-code default nodes.

/** Derive a coarse visual category from an FGM node. */
export function categoryOf(node) {
  if (node.__kind === 'fact') return node.kind === 'writable' ? 'fact-writable' : 'fact-derived'
  // flow element
  switch (node.tag) {
    case 'fg-set':
      return 'fg-set'
    case 'fg-alert':
      return node.alert?.knockout ? 'fg-alert-knockout' : 'fg-alert'
    case 'fg-collection':
      return 'fg-collection'
    case 'fg-detail':
      return 'fg-detail'
    case 'fg-section-gate':
      return 'fg-section-gate'
    default:
      return 'conditional-block'
  }
}

export const CATEGORY_STYLE = {
  'fact-writable': { bg: '#e3f2e1', border: '#3e8635', label: 'Fact · writable' },
  'fact-derived': { bg: '#ede3f7', border: '#7b3fb5', label: 'Fact · derived' },
  'fg-set': { bg: '#e1ecf7', border: '#2b6cb0', label: 'Question (fg-set)' },
  'fg-alert-knockout': { bg: '#fbe3e3', border: '#c0392b', label: 'Knockout' },
  'fg-alert': { bg: '#fdf3d8', border: '#caa53a', label: 'Alert' },
  'fg-collection': { bg: '#def3f2', border: '#1c8a82', label: 'Collection' },
  'fg-detail': { bg: '#eceff2', border: '#6b7785', label: 'Detail' },
  'fg-section-gate': { bg: '#eceff2', border: '#6b7785', label: 'Section gate' },
  'conditional-block': { bg: '#f2f2f2', border: '#9aa3ab', label: 'Conditional block' },
}

// Annotation tag vocabulary (M5). Lives here so node badges and the editor never
// hard-code colours, same rule as CATEGORY_STYLE / EDGE_STYLE.
export const ANNOTATION_TAG_STYLE = {
  note: { color: '#6b7785', label: 'Note' },
  question: { color: '#2b6cb0', label: 'Question' },
  bug: { color: '#c0392b', label: 'Bug' },
  'sme-note': { color: '#3e8635', label: 'SME note' },
  'ux-note': { color: '#7b3fb5', label: 'UX note' },
}

// Per-category node shape (M6 / 6c). Drives FgmNode's shape dispatch; container
// shapes ('frame') render through the separate FrameNode group component. Kept
// here so shapes, like colours, never get hard-coded in a component.
export const NODE_SHAPE = {
  'fact-writable': 'rect',
  'fact-derived': 'rect',
  'fg-set': 'rect', // + input-type badge
  'fg-alert-knockout': 'octagon',
  'fg-alert': 'pill',
  'fg-collection': 'frame',
  'fg-detail': 'frame',
  'fg-section-gate': 'pill',
  'conditional-block': 'rect',
}

// CSS clip-path for the knockout octagon (a stop-sign), declared once.
export const OCTAGON_CLIP =
  'polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)'

// Input-type badge glyphs for fg-set question nodes (M6 / 6c). Real data only
// uses boolean/dollar/enum; the rest cover the mock fixture + future inputs.
export const INPUT_TYPE_BADGE = {
  boolean: { glyph: '✓', label: 'Boolean' },
  enum: { glyph: '▾', label: 'Enum' },
  dollar: { glyph: '$', label: 'Dollar' },
  day: { glyph: '▦', label: 'Day' },
  string: { glyph: 'Aa', label: 'Text' },
  int: { glyph: '#', label: 'Integer' },
  rational: { glyph: '½', label: 'Rational' },
  tin: { glyph: '⌗', label: 'TIN' },
}

// Fallback node style when a node's category isn't in CATEGORY_STYLE (defensive —
// only fires on malformed data). Mirrors the neutral conditional-block look.
export const NODE_FALLBACK = { bg: '#fff', border: '#9aa3ab' }

// Selection emphasis used by FgmNode / FrameNode. Colour matches the global text
// token (--color-text); kept here so the canvas selection ring/outline isn't a
// hard-coded literal in the node components (this app's rule: colours live in style.js).
export const SELECTION = { color: '#1b1f23', width: 2 }

// Search match emphasis (M6 / 6a). The ring is applied when node.data.match;
// non-matches under an active query dim like +1-hop context nodes.
export const SEARCH_HIGHLIGHT = { ring: '#f2a900', ringWidth: 3, dimOpacity: 0.25 }

// Drill-down focal emphasis. The halo marks the centre of a drill mini-graph
// (node.data.focal) so it stays identifiable even when a neighbour is selected.
export const FOCAL_HIGHLIGHT = { ring: '#2b6cb0', ringWidth: 4 }

// Dependency-cone hub marker (node.data.hub). A high-fan-in shared input
// (tax-year constants, /isFilingStatusMFJ, …) that coneLayout pins to the inputs
// rail. The pin badge + muted look signal "shared leaf — referenced widely".
export const HUB_BADGE = { glyph: '📌', label: 'Shared input (hub)', dim: 0.85 }

// "Explain this node" badge (N7). A per-node launcher that hands the node to the
// chat dock for an AI explanation. Colours live here, never in FgmNode. Mirrors
// the DetailPanel/ScenarioModal buttons: white default, blue when active (hover).
export const EXPLAIN_BADGE = {
  glyph: '✨',
  label: 'Explain this node',
  // default (untoggled): white background, blue glyph, gray outline
  bg: '#fff',
  color: '#2b6cb0',
  border: '#d6dbe0',
  // active (toggled / hovered): blue background, white glyph
  activeBg: '#2b6cb0',
  activeColor: '#fff',
  activeBorder: '#2b6cb0',
}

// Scenario-overlay emphasis (N4). When a scenario is loaded, computeVisibility's
// status rides node.data (scenarioStatus / scenarioDim / scenarioIncomplete) and
// FgmNode renders it through these tokens — never hard-coded colours. Seeds match
// the audit panel's swatch semantics: knockout red, incomplete amber, hidden dim.
export const SCENARIO_STATUS = {
  'knockout-active': { ring: '#c0392b', ringWidth: 3, label: 'Knockout active' },
  incomplete: { ring: '#caa53a', ringWidth: 3, label: 'Incomplete value' },
  dimOpacity: 0.2,
}

export const EDGE_STYLE = {
  sequential: { stroke: '#b0b8bf', dashed: false, animated: false, strokeOpacity: 1 },
  exits: { stroke: '#c0392b', dashed: true, animated: false, strokeOpacity: 1 },
  gates: { stroke: '#caa53a', dashed: true, animated: false, strokeOpacity: 1 },
  binds: { stroke: '#2b6cb0', dashed: false, animated: false, strokeOpacity: 1 },
  shows: { stroke: '#caa53a', dashed: true, animated: false, strokeOpacity: 1 },
  'knocks-out': { stroke: '#c0392b', dashed: true, animated: true, strokeOpacity: 1 },
  displays: { stroke: '#9aa3ab', dashed: true, animated: false, strokeOpacity: 1 },
  depends: { stroke: '#7b3fb5', dashed: false, animated: false, strokeOpacity: 1 },
}
