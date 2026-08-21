// Switching the workspace from one application to another, without losing where you are.
//
// The workspace is a harness laid over *an* application, and there is more than one: a Form Builder
// repo holds several, each served under its own base path, and the same three or four destinations
// exist in each — Product Experience, Path Mode, Browse All, the Fact Explorer, the Authoring
// Suite. Moving between applications used to mean going back to a landing page and picking a card,
// which threw away the destination you were on.
//
// So the rule this module encodes is: **switching application keeps the destination**. Browse All
// in one application goes to Browse All in the next; Path Mode to Path Mode. The destination you
// are on is the nav's `active` id, and each application declares its own href for each id.
//
// ── Why the hosts declare the URLs, rather than this deriving them ────────────────────────────
//
// It is tempting to give each application a `basePath` and have this append '/all-screens/' for
// 'browse-all'. That would make the package know what a destination *means* — but destination ids
// are the host's taxonomy, not this package's (nav-menu-data.js), and one of the two applications
// here reaches its Fact Explorer at another origin entirely. A host already writes its own menu;
// writing its siblings' is the same act.
//
// The shape, as a host supplies it through configure():
//
//   apps: {
//     current: 'pet-planner',
//     items: [
//       { id: 'pet-planner', label: 'Pet Planner', destinations: [
//           { id: 'product-experience', label: 'Product Experience', href: '<its base path>/' },
//           …
//       ]},
//       { id: 'plant-planner', label: 'Plant Planner', destinations: [ … ] },
//     ],
//   }
//
// No application name, path or origin appears in this file, and none may — the items are entirely
// the host's, exactly like `nav.menu`.

/** The event a host may intercept to switch application in-app instead of navigating. */
export const APP_SELECT_EVENT = 'taxpert:app-select'

const items = (apps) => (Array.isArray(apps?.items) ? apps.items : [])

/**
 * The applications a host declared, or an empty list.
 *
 * @param {object} apps the `apps` namespace of a configuration
 * @returns {Array<{id: string, label?: string, destinations?: Array<{id: string, label?: string, href?: string}>}>}
 */
export function appItems (apps) {
  return items(apps).filter((app) => typeof app?.id === 'string' && app.id.length > 0)
}

/** The one that is being shown, by `apps.current`. `null` when the host named none or a stale id. */
export function currentApp (apps) {
  return appItems(apps).find((app) => app.id === apps?.current) ?? null
}

/**
 * Whether there is a choice to offer.
 *
 * One application is not a picker — it is a label — so the Applications section hides itself
 * rather than showing a control with a single option and nothing to switch to.
 */
export function hasAppChoice (apps) {
  return appItems(apps).length > 1
}

/** An application's destinations, as `[{id, label, href}]`. */
export function destinationsOf (app) {
  return Array.isArray(app?.destinations) ? app.destinations.filter((d) => d?.id) : []
}

/**
 * Where selecting `targetId` should go, from the destination you are on now.
 *
 * The same destination in the target application when it has one; otherwise its first, because an
 * application that has no Authoring Suite should still be reachable from an Authoring Suite — just
 * not at a URL that 404s. `null` when the target declares no destinations at all, which is a host
 * that gave a bare id and nothing to do with it.
 *
 * @param {object} apps the `apps` namespace
 * @param {string} targetId the application being switched to
 * @param {string|null} destinationId the nav destination currently active
 * @returns {{app: object, destination: object}|null}
 */
export function switchTarget (apps, targetId, destinationId) {
  const app = appItems(apps).find((candidate) => candidate.id === targetId)
  if (!app) return null
  const destinations = destinationsOf(app)
  if (!destinations.length) return null
  const same = destinations.find((d) => d.id === destinationId)
  return { app, destination: same ?? destinations[0] }
}

/**
 * The destination the page is on, read from the mounted nav.
 *
 * The nav owns `active` — it is a page-level attribute the host stamps on the element, not
 * configuration — so this is a read of the workspace's own DOM rather than a second source of the
 * same fact. Absent nav, or no `active`, means "nowhere in particular", and the switch falls back
 * to the target's first destination.
 *
 * @returns {string|null}
 */
export function activeDestination (root = document) {
  return root.querySelector('taxpert-global-nav')?.getAttribute('active') || null
}
