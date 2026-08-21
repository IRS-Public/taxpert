import PropTypes from 'prop-types'
import GlobalNav from 'taxpert/react'
import { interceptFactExplorerNav } from '../config/taxpertHost.js'

// The landing surface: the shared global nav over a hero, and nothing else.
//
// The emptiness is the design. This IS the Taxpert landing page, not a mode, so when the workspace
// is toggled on the breadcrumb reads "Taxpert Home" (via context-label) rather than a menu
// destination — only /fact-explorer/<app> (FactExplorer.jsx) is "Fact Explorer". "Fact Explorer" is
// this app itself, so we intercept it and switch to the graph view in-app instead of a full
// navigation. Every other item navigates to its real destination.
//
// It briefly grew a grid of application cards, one per registry entry, as the first way to see that
// there was more than one app. They are gone: choosing an application is not a landing-page act, it
// is a property of the workspace, and it now lives in one place that every page can reach — the
// nav's settings gear, "Applications". A card grid here could only ever be used from here.
export default function Homepage({ registry, onEnterFactExplorer }) {
  return (
    <div className="home">
      <GlobalNav
        app="fact-explorer"
        contextLabel="Taxpert Home"
        onSelect={interceptFactExplorerNav(() => onEnterFactExplorer(registry.defaultAppId))}
      />

      <div className="home__hero">
        <h1 className="home__title">Taxpert</h1>
        <p className="home__subtitle">Turning rules into humane interfaces</p>
      </div>
    </div>
  )
}

Homepage.propTypes = {
  registry: PropTypes.shape({
    defaultAppId: PropTypes.string,
  }).isRequired,
  onEnterFactExplorer: PropTypes.func.isRequired,
}
