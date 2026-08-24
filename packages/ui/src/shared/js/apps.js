// The Applications section of Workspace settings: which application the workspace is over, and
// where switching to another one lands.
//
// The rule encoded here is that a switch keeps the destination, so Browse All in one application
// goes to Browse All in the next. The hosts declare the destination URLs. No application name, path
// or origin may appear in this file.
//
// See ../../../../../docs/internals/workspace-configuration.md

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

/** The one being shown, by `apps.current`. `null` when the host named none or a stale id. */
export function currentApp (apps) {
  return appItems(apps).find((app) => app.id === apps?.current) ?? null
}

/** Whether there is a choice to offer. Below two, the Applications section hides itself. */
export function hasAppChoice (apps) {
  return appItems(apps).length > 1
}

/** An application's destinations, as `[{id, label, href}]`. */
export function destinationsOf (app) {
  return Array.isArray(app?.destinations) ? app.destinations.filter((d) => d?.id) : []
}

/**
 * Where selecting `targetId` goes from the destination you are on now: the same destination in the
 * target application when it has one, otherwise its first. `null` when the target declares none.
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
 * The destination the page is on, read from the mounted nav's `active` attribute rather than from
 * configuration, because the page knows where it is and the configuration does not.
 *
 * @returns {string|null}
 */
export function activeDestination (root = document) {
  return root.querySelector('taxpert-global-nav')?.getAttribute('active') || null
}
