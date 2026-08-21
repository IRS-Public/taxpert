// A host's navigation taxonomy and tool strip, for the specs that need one.
//
// The nav ships with neither: config.nav.menu and config.nav.toolsByDestination default to empty,
// because a menu is a list of one application's routes. So every nav spec has to play the host, and
// two of them (nav-menu-data, taxpert-global-nav) want the same shape — a group with three leaves,
// two top-level leaves, and the three tool buttons across four destinations. That shape is what the
// helpers and the CSS were designed around, so it stays here rather than being re-typed per file.
//
// The hrefs are deliberately not any real deployment's: what the specs assert is that a leaf's own
// href reaches the nav-select detail, not what any application's routes happen to be.

export const FIXTURE_MENU = [
  {
    id: 'experience-explorer',
    label: 'Experience Explorer',
    children: [
      { id: 'product-experience', label: 'Product Experience', href: '/product/' },
      { id: 'browse-all', label: 'Browse All', href: '/product/all-screens/' },
      { id: 'path-mode', label: 'Path Mode', href: '/product/all-screens/?mode=path' },
    ],
  },
  { id: 'fact-explorer', label: 'Fact Explorer', href: 'https://fact-explorer.example/fact-explorer' },
  { id: 'authoring-suite', label: 'Authoring Suite', href: '/product/author/' },
]

export const FIXTURE_TOOLS = [
  {
    id: 'scenario',
    label: 'Scenario',
    icon: 'tune',
    destinations: ['product-experience', 'path-mode', 'fact-explorer'],
  },
  {
    id: 'display',
    label: 'Display',
    icon: 'visibility',
    destinations: ['product-experience', 'browse-all', 'path-mode'],
  },
  { id: 'tools', label: 'Tools', icon: 'build', destinations: ['product-experience', 'path-mode'] },
]

/** The nav namespace both fixtures make up, ready to hand to configure(). */
export const FIXTURE_NAV = { menu: FIXTURE_MENU, toolsByDestination: FIXTURE_TOOLS }
