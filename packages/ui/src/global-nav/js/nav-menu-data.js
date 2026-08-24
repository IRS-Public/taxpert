// The navigation taxonomy's shape, and the helpers that read it.
//
// The taxonomy is the host's, at `config.nav.menu`. It was once a DEFAULT_MENU constant here, which
// meant the shared nav shipped with one application's deployed route prefix and another's
// dev-server origin baked in.
//
// Every helper defaults its `menu` argument by calling getConfig() rather than by closing over a
// const, so the default is whatever is configured at the moment of the call.
//
// The leaf shape (href, action, disabled, ff) and the accordion rules:
// ../../../../../docs/internals/global-nav.md

import { getConfig } from '../../shared/js/config.js'

/** The configured taxonomy. Empty until a host registers one. */
export function navMenu () {
  return getConfig().nav.menu
}

/** A menu item, group or leaf, by id. Null when there is no such id. */
export function resolveItem (id, menu = navMenu()) {
  if (!id) return null
  for (const item of menu) {
    if (item.id === id) return item
    const child = item.children?.find((c) => c.id === id)
    if (child) return child
  }
  return null
}

/**
 * The part after "<brand> |". A leaf inside a group reads as the group's label, a top-level item as
 * its own. An unknown or absent id is null.
 */
export function contextLabel (activeId, menu = navMenu()) {
  if (!activeId) return null
  for (const item of menu) {
    if (item.id === activeId) return item.label
    if (item.children?.some((c) => c.id === activeId)) return item.label
  }
  return null
}

/** The breadcrumb next to the waffle, or just the brand when there is no context. */
export function breadcrumbFor (activeId, menu = navMenu()) {
  const brand = getConfig().app.brand
  const ctx = contextLabel(activeId, menu)
  return ctx ? `${brand} | ${ctx}` : brand
}
