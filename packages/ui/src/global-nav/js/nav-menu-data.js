// The navigation taxonomy's shape, and the helpers that read it.
//
// The taxonomy itself is the *host's* — `config.nav.menu` — not this package's. It used to be a
// DEFAULT_MENU const here, which meant the shared nav shipped with one application's deployed route
// prefix and another's dev-server origin baked in: two hosts' deployment details inside the library
// both of them import. A host calls configure({ nav: { menu: [...] } }) and this stays
// application-agnostic.
//
// Each leaf carries:
//   - `href`     real destination. Because the menu renders as real <a> links,
//                navigation works even before/without JS (progressive enhancement).
//   - `action`   (optional) a marker letting a host app intercept the item and
//                handle it in-app (e.g. a client-side view switch) instead of a
//                full navigation. Apps may also intercept by `id`.
//   - `disabled` (optional) a destination that does not exist yet (placeholder).
//   - `ff`       (optional) a feature-flag kebab name gating the item's visibility — the same
//                data-ff/ff-<kebab> convention feature-flags.js documents for rail tabs and the AI
//                scenario-generation section. The leaf is always rendered (still a real <a>, so
//                nothing about the click handling changes); shared/styles/feature-flags.css is what
//                hides it until <body> carries the matching `ff-<kebab>` class.
//
// Groups (items with `children`) render as an accordion: open when the active destination is one
// of the children, shut otherwise, and toggled by clicking the group's own row.
//
// Every helper defaults its `menu` argument by *calling* getConfig() rather than by closing over a
// const, so the default is whatever is configured at the moment of the call. See the read-late note
// in config.js.

import { getConfig } from '../../shared/js/config.js'

/** The configured taxonomy. Empty until a host registers one. */
export function navMenu () {
  return getConfig().nav.menu
}

// Resolve a menu item (group or leaf) by id, or null.
export function resolveItem (id, menu = navMenu()) {
  if (!id) return null
  for (const item of menu) {
    if (item.id === id) return item
    const child = item.children?.find((c) => c.id === id)
    if (child) return child
  }
  return null
}

// The label shown as the current context, i.e. the part after "<brand> |".
// For a leaf inside a group it is the group's label; for a top-level item it is
// its own label; for an unknown/absent id it is null.
export function contextLabel (activeId, menu = navMenu()) {
  if (!activeId) return null
  for (const item of menu) {
    if (item.id === activeId) return item.label
    if (item.children?.some((c) => c.id === activeId)) return item.label
  }
  return null
}

// The full breadcrumb string shown next to the waffle, e.g.
// "Taxpert | Experience Explorer" — or just the brand when there is no context.
export function breadcrumbFor (activeId, menu = navMenu()) {
  const brand = getConfig().app.brand
  const ctx = contextLabel(activeId, menu)
  return ctx ? `${brand} | ${ctx}` : brand
}
