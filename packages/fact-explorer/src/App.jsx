import { useCallback, useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { ReactFlowProvider } from '@xyflow/react'
import WorkspaceSettingsModal from 'taxpert/react/workspace-settings-modal'
import FactExplorer from './canvas/FactExplorer.jsx'
import Homepage from './home/Homepage.jsx'
import { APP_SELECT_EVENT } from 'taxpert/apps'
import { registerFactExplorerHost, FACT_EXPLORER_DESTINATION } from './config/taxpertHost.js'
import { loadRegistry } from './model/load.js'
import { findApp, defaultApp } from './model/apps.js'
import { evictEnginesExcept } from './model/engine.js'

const FACT_EXPLORER_PATH = '/fact-explorer'

/**
 * Read the route: '/' → home, '/fact-explorer' → the default app, '/fact-explorer/<id>' → that app.
 *
 * The app id is a path segment rather than a query parameter so there is one router, not two, and
 * so the URL reads as what it is — a place, not a filter on a place.
 */
function routeFor(pathname) {
  if (pathname !== FACT_EXPLORER_PATH && !pathname.startsWith(`${FACT_EXPLORER_PATH}/`))
    return { view: 'home' }
  const rest = pathname.slice(FACT_EXPLORER_PATH.length).replace(/^\//, '').replace(/\/$/, '')
  return { view: 'fact-explorer', appId: rest || null }
}

const factExplorerPath = (appId) => `${FACT_EXPLORER_PATH}/${appId}`

// Main App component manages the view state, backed by the URL (via the History API) so the Fact
// Explorer has a real entrypoint — /fact-explorer/<app> — that's bookmarkable and reachable from other
// Form Builder apps' nav links, not just reachable in-app after landing on the homepage.
//
// The registry is loaded here, above the router, because both surfaces need it: the Homepage lists
// the apps and Fact Explorer represents one of them.
export default function App() {
  const [registry, setRegistry] = useState(null)
  const [registryError, setRegistryError] = useState(null)
  const [route, setRoute] = useState(() => routeFor(window.location.pathname))

  useEffect(() => {
    loadRegistry().then(setRegistry, (e) => setRegistryError(e.message))
  }, [])

  useEffect(() => {
    const onPopState = () => setRoute(routeFor(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    document.title = route.view === 'home' ? 'Taxpert' : 'Fact Explorer'
  }, [route.view])

  // Which app the URL names. `null` when the segment is absent (fall back to the default) but
  // `undefined`-as-missing when it names something unknown — those are different situations and
  // only the first should silently choose for the user. See the unknown-app branch below.
  const app = useMemo(() => {
    if (!registry || route.view !== 'fact-explorer') return null
    return route.appId ? findApp(registry, route.appId) : defaultApp(registry)
  }, [registry, route])

  // Which app the workspace is configured for. On /fact-explorer/<id> that is the represented app; on the
  // Homepage — and on an unknown-app URL — there is no represented app, so the default one stands in.
  //
  // It has to stand in rather than be skipped: taxpert ships no menu of its own, so a host that does
  // not call configure() gets a nav with no destinations at all. The Homepage renders that same nav,
  // and this is what put it there empty — no Product Experience, no Browse All, no Author Mode, and
  // no feature-flag rows in Workspace settings.
  const hostApp = app ?? (registry ? defaultApp(registry) : null)

  // Re-register the workspace whenever that app changes. configure() replaces arrays and announces,
  // and the global nav re-renders from that event, so this is all an app switch needs — and it lives
  // above the router because the nav is on the Homepage too.
  useEffect(() => {
    if (!hostApp) return
    registerFactExplorerHost(hostApp, registry)
    evictEnginesExcept(hostApp.id) // two Scala.js engines is ~15 MB; keep only the live one
  }, [hostApp, registry])

  const goToFactExplorer = useCallback((appId) => {
    window.history.pushState(null, '', factExplorerPath(appId))
    setRoute({ view: 'fact-explorer', appId })
  }, [])

  // Switching application from the workspace's "Applications" setting.
  //
  // taxpert announces the switch and navigates to the chosen destination unless someone cancels.
  // Fact Explorer cancels when the destination is Fact Explorer's own: it is one SPA over every
  // app, so that is a route change, not a page load — the same interception the nav's Fact
  // Explorer entry gets. Any other destination (Product Experience, Browse All, an app's
  // Authoring Suite) is a real navigation out of Fact Explorer and is left to proceed.
  useEffect(() => {
    const onAppSelect = (event) => {
      if (event.detail?.destination?.id !== FACT_EXPLORER_DESTINATION) return
      event.preventDefault()
      goToFactExplorer(event.detail.id)
    }
    document.addEventListener(APP_SELECT_EVENT, onAppSelect)
    return () => document.removeEventListener(APP_SELECT_EVENT, onAppSelect)
  }, [goToFactExplorer])

  const goHome = useCallback(() => {
    window.history.pushState(null, '', '/')
    setRoute({ view: 'home' })
  }, [])

  // A bare /fact-explorer is a real entrypoint (other apps' nav links use it), so normalise it to
  // the default app's URL rather than leaving an address that means "whichever app is first today".
  useEffect(() => {
    if (registry && route.view === 'fact-explorer' && !route.appId) {
      const id = defaultApp(registry).id
      window.history.replaceState(null, '', factExplorerPath(id))
      setRoute({ view: 'fact-explorer', appId: id })
    }
  }, [registry, route])

  return (
    <>
      {/* Mounted once at the app root (not inside FactExplorer/Homepage) since the global nav's
          settings gear — and the workspace row it lives in — renders on both. */}
      <WorkspaceSettingsModal />
      {renderView()}
    </>
  )

  function renderView() {
    if (registryError) return <Boot title="Cannot load the app registry" detail={registryError} />
    if (!registry) return <Boot title="Loading…" />

    if (route.view !== 'fact-explorer') {
      return <Homepage registry={registry} onEnterFactExplorer={goToFactExplorer} />
    }
    if (!app) {
      // A named-but-unknown app. Deliberately not a silent fall back to the default: a stale or
      // typo'd bookmark that quietly shows a *different* app is the worst outcome available here.
      return (
        <Boot
          title={`Unknown app "${route.appId}"`}
          detail={`This Fact Explorer knows: ${registry.apps.map((a) => a.id).join(', ')}.`}
          onHome={goHome}
        />
      )
    }
    return (
      <ReactFlowProvider>
        {/* Remount on app switch: the graph, layout cache, engine, scenario overlay and search
            index are all per-app, and a remount is safer than auditing every dependency array. */}
        <FactExplorer key={app.id} app={app} />
      </ReactFlowProvider>
    )
  }
}

function Boot({ title, detail, onHome }) {
  return (
    <div className="fact-explorer-error">
      <h2>{title}</h2>
      {detail && <p>{detail}</p>}
      {onHome && (
        <p>
          <button onClick={onHome}>Back to the app list</button>
        </p>
      )}
    </div>
  )
}

Boot.propTypes = {
  title: PropTypes.string.isRequired,
  detail: PropTypes.string,
  onHome: PropTypes.func,
}
