// fact-explorer registering itself as a Taxpert host.
//
// taxpert ships no menu, no endpoints and no application content — a host supplies all of it
// through configure(). Fact Explorer consumes only three pieces of the workspace (GlobalNav,
// ScenarioModal, WorkspaceSettingsModal), but it is still a host, and this is the whole of what it
// has to say.
//
// ── What this replaced ────────────────────────────────────────────────────────────────────────
//
// Before the library was configuration-driven, Fact Explorer got here by impersonation:
//
//   · it rendered a decoy `<taxpert-audit-panel scenarios-base="…" hidden>` — an element it never
//     imports and never defines, existing purely so fact-graph-io.js's
//     document.querySelector('taxpert-audit-panel') found *something* with the attribute it wanted;
//   · the menu it showed was the library's own DEFAULT_MENU, which was another application's routes,
//     with Fact Explorer's entry hardcoded to a localhost:5180 URL inside the library;
//   · Homepage.jsx and FactExplorer.jsx each repeated the same "if the id is fact-explorer, don't
//     navigate" interception.
//
// All three were symptoms of the same thing: no way for a host to say what it was. Now there is.

import { configure } from 'taxpert/config'
import { viewsFor } from '../model/apps.js'

/**
 * The feature flags Fact Explorer understands, in the shape taxpert reads them: a camelCase `name`
 * (the localStorage key and what getFlag/setFlag take), a `kebab` spelling (the `data-ff` value
 * and the `ff-` body class), and the `label` WorkspaceSettingsModal puts on the flag's row — it
 * builds one row per entry here, so this list is also what that modal shows.
 *
 * This is the single declaration. src/config/featureFlags.js derives its build-time defaults from
 * it rather than restating the names — before the refactor both files listed them independently and
 * nothing would have caught them drifting apart.
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

/** The id of Fact Explorer's own destination — the one the nav must not navigate away to. */
export const FACT_EXPLORER_DESTINATION = 'fact-explorer'

/**
 * The Taxpert menu as Fact Explorer shows it, for one app.
 *
 * A function of the app rather than a constant: the destinations are that app's own routes, and
 * which of them exist depends on how it was built — an app generated without `--allScreens` has no
 * Browse All page, and offering the link anyway means a 404. `viewsFor()` does that pruning; this
 * only arranges the result into the nav's shape.
 *
 * Fact Explorer's own entry has no `href`: it is reached by an in-app view switch, not a
 * navigation, and a leaf with `action: 'in-app'` tells the nav to emit its select event and let
 * the host handle it. That is what removed the duplicated interception — see
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
      // shared <taxpert-display-modal>, carrying this host's options — see canvas/controls/
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
 * `storagePrefix` stays `'taxpert'` deliberately — it namespaces *Fact Explorer's* own state
 * (annotations, saved layouts, workspace settings), which belongs to Fact Explorer and not to the
 * app under inspection. Relocating it per app would silently orphan a person's saved node
 * positions on every switch. The app's own prefix is used only where it must be: the fact-graph
 * bridge (see model/bridge.js).
 *
 * `featureFlags` comes from FACT_EXPLORER_FLAGS above — the library ships no flag list of its own,
 * because which features exist is a property of the application, not of the workspace.
 *
 * `apps` is the registry, in the shape taxpert's Applications section reads: one entry per app, each
 * carrying its own destinations so switching can land on the destination you are already on. Fact
 * Explorer is the host with the full list because it is the one that holds every app's descriptor —
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
 * Each app's destinations are `viewsFor()` — the same pruning the menu gets, so an app built
 * without `--allScreens` offers no Browse All to switch into — plus Fact Explorer's own Fact
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
