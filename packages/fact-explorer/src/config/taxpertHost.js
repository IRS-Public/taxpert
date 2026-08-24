// Fact Explorer registering itself as a Taxpert host.
//
// taxpert ships no menu, no endpoints and no application content. A host supplies all of it through
// configure(), and this file is the whole of what Fact Explorer has to say. It consumes three
// pieces of the workspace: GlobalNav, ScenarioModal and WorkspaceSettingsModal.
//
// See ../../../../docs/internals/fact-explorer-internals.md

import { configure } from 'taxpert/config'
import { viewsFor } from '../model/apps.js'

/**
 * The feature flags Fact Explorer understands, in the shape taxpert reads them. WorkspaceSettingsModal
 * builds one row per entry, so this list is also what that modal shows.
 *
 * THIS IS THE SINGLE DECLARATION. featureFlags.js derives its build-time defaults from it rather
 * than restating the names, which is what stops the two drifting apart.
 *
 * The two AI features are flagged separately because they ship on separate timelines: generation
 * writes a whole Fact Graph from a prompt, explanation only reads facts back.
 */
export const FACT_EXPLORER_FLAGS = [
  {
    name: 'aiScenarioGeneration',
    kebab: 'ai-scenario-generation',
    label: 'AI scenario generation',
  },
  { name: 'aiFactExplanation', kebab: 'ai-fact-explanation', label: 'AI fact explanations' },
]

/** The id of Fact Explorer's own destination, the one the nav must not navigate away to. */
export const FACT_EXPLORER_DESTINATION = 'fact-explorer'

/**
 * The Taxpert menu as Fact Explorer shows it, for one app.
 *
 * A function of the app rather than a constant: the destinations are that app's own routes, and
 * which of them exist depends on how it was built. An app generated without `--allScreens` has no
 * Browse All page, and offering the link anyway means a 404. `viewsFor()` does that pruning; this
 * only arranges the result into the nav's shape.
 *
 * Fact Explorer's own entry has no `href`: it is reached by an in-app view switch, not a
 * navigation, and a leaf with `action: 'in-app'` tells the nav to emit its select event and let
 * the host handle it. That is what removed the duplicated interception. See
 * interceptFactExplorerNav() below.
 *
 * @param {import('../model/apps.js').FactExplorerApp} app
 */
export function buildFactExplorerMenu(app) {
  const views = viewsFor(app)
  const byId = (id) => views.filter((v) => v.id === id)
  return [
    {
      id: 'experience-explorer',
      label: 'Experience Explorer',
      children: views.filter((v) => v.id !== 'authoring-suite'),
    },
    { id: FACT_EXPLORER_DESTINATION, label: 'Fact Explorer', action: 'in-app' },
    ...byId('authoring-suite'),
  ]
}

/**
 * Which nav destinations show which workspace buttons.
 *
 * Also a function of the app: the Scenario button is dropped for an app built without
 * `--scenarioMode`, since it would open a modal with nothing to load. A tool whose destinations all
 * pruned away is dropped entirely rather than left pointing at nothing.
 *
 * @param {import('../model/apps.js').FactExplorerApp} app
 */
export function buildFactExplorerTools(app) {
  const present = new Set([...viewsFor(app).map((v) => v.id), FACT_EXPLORER_DESTINATION])
  const tools = [
    {
      id: 'scenario',
      label: 'Scenario',
      icon: 'tune',
      destinations: ['product-experience', 'path-mode', FACT_EXPLORER_DESTINATION],
      requires: 'scenarioMode',
    },
    {
      id: 'display',
      label: 'Display',
      icon: 'visibility',
      // Fact Explorer is a Display destination like the other three: what the canvas reveals, how
      // it is arranged, and whether the product experience sits beside it are the same kind of
      // choice a screen listing makes about its own items. The dialog behind the button is the
      // shared <taxpert-display-modal>, carrying this host's options. See canvas/controls/
      // DisplayOptions.jsx.
      destinations: ['product-experience', 'path-mode', 'browse-all', FACT_EXPLORER_DESTINATION],
    },
    {
      id: 'tools',
      label: 'Tools',
      icon: 'build',
      destinations: ['product-experience', 'path-mode'],
    },
  ]
  return tools
    .filter((t) => !t.requires || app.capabilities?.[t.requires])
    .map(({ requires, ...t }) => ({
      ...t,
      destinations: t.destinations.filter((d) => present.has(d)),
    }))
    .filter((t) => t.destinations.length > 0)
}

/**
 * Register Fact Explorer with taxpert, for the app it is currently representing.
 *
 * Safe to call again on every app switch: `configure()` merges one level deep but *replaces*
 * arrays ("a half-merged menu is never what anyone means"), then dispatches CONFIG_CHANGE_EVENT,
 * which an already-mounted `<taxpert-global-nav>` listens for and re-renders from. So swapping apps
 * is a call to this function, not a remount of the nav.
 *
 * `scenariosBase` is the one endpoint Fact Explorer genuinely needs: ScenarioModal's "Load existing
 * scenario" fetches from it. An app with no scenarios passes an empty string rather than a path
 * that would 404.
 *
 * `storagePrefix` stays `'taxpert'` deliberately. It namespaces Fact Explorer's own state
 * (annotations, saved layouts, workspace settings), which belongs to Fact Explorer and not to the
 * app under inspection. Relocating it per app would silently orphan a person's saved node
 * positions on every switch. The app's own prefix is used only where it must be: the fact-graph
 * bridge (see model/bridge.js).
 *
 * `featureFlags` comes from FACT_EXPLORER_FLAGS above. The library ships no flag list of its own,
 * because which features exist is a property of the application, not of the workspace.
 *
 * `apps` is the registry, in the shape taxpert's Applications section reads: one entry per app, each
 * carrying its own destinations so switching can land on the destination you are already on. Fact
 * Explorer is the host with the full list, being the one that holds every app's descriptor,
 * the apps themselves declare the same thing by hand, from their own templates.
 *
 * @param {import('../model/apps.js').FactExplorerApp} app
 * @param {import('../model/apps.js').FactExplorerRegistry} [registry] every app this Fact
 *   Explorer knows. Omitted ⇒ just the one, and the Applications section hides itself.
 */
export function registerFactExplorerHost(app, registry) {
  configure({
    app: { id: 'fact-explorer', brand: app.label ?? 'Taxpert', storagePrefix: 'taxpert' },
    nav: { menu: buildFactExplorerMenu(app), toolsByDestination: buildFactExplorerTools(app) },
    apps: { current: app.id, items: buildAppItems(registry?.apps ?? [app]) },
    endpoints: { scenariosBase: app.scenarios?.base ?? '' },
    featureFlags: FACT_EXPLORER_FLAGS,
  })
}

/**
 * The registry as taxpert's `apps.items`.
 *
 * Each app's destinations are `viewsFor()`, the same pruning the menu gets, so an app built
 * without `--allScreens` offers no Browse All to switch into, plus Fact Explorer's own Fact
 * Explorer view, which every registered app has by definition and which is reached at that app's
 * Fact Explorer URL.
 *
 * @param {import('../model/apps.js').FactExplorerApp[]} apps
 */
export function buildAppItems(apps) {
  return apps.map((entry) => ({
    id: entry.id,
    label: entry.label ?? entry.id,
    destinations: [
      ...viewsFor(entry).filter((view) => view.id !== 'authoring-suite'),
      { id: FACT_EXPLORER_DESTINATION, label: 'Fact Explorer', href: `/fact-explorer/${entry.id}` },
      ...viewsFor(entry).filter((view) => view.id === 'authoring-suite'),
    ],
  }))
}

/**
 * The nav-select handler both Homepage and FactExplorer use: Fact Explorer's own destination is
 * handled in-app, everything else navigates for real. One definition, because it was the same
 * three lines twice.
 *
 * @param {() => void} [onEnter] what to do when the user picks Fact Explorer; omitted when the
 *   caller is already there and only needs to suppress the navigation.
 */
export function interceptFactExplorerNav(onEnter) {
  return (event) => {
    if (event.detail.id !== FACT_EXPLORER_DESTINATION) return
    event.preventDefault()
    onEnter?.()
  }
}
