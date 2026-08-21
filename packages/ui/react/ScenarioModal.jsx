// Thin React adapter for <taxpert-scenario-modal>.
//
// Like WorkspaceSettingsModal, the element self-wires to the global nav's nav-tool-select event
// and manages its own open/close state, so mounting it (anywhere in the tree; it renders a
// body-level <dialog>) is most of the integration. The one piece a host must still hand in is its
// own scenario vocabulary — scenarioOptions (the <option>s for the library) and scenarioFilters
// (the filter-dropdown descriptors + parseFilename) — which aren't attributes (non-string /
// functions), so they're assigned as DOM properties via a ref, same as GlobalNav's `menu`.
//
// `scenarioOptions` takes real <option> nodes. `scenarioOptionsHtml` still works and takes the
// same list as an HTML string, but a host that has the nodes (they are built as nodes, to keep a
// scenario filename from being read as markup) should hand them over rather than serialize them
// for the element to parse straight back.

import { useEffect, useRef } from 'react'
import '../src/audit-panel/js/scenario-modal.js' // side effect: customElements.define(...)
import '../src/audit-panel/styles/scenario-modal.css'

export default function ScenarioModal ({
  scenarioOptions,
  scenarioOptionsHtml = '',
  scenarioFilters,
  aiScenarioGeneration = false,
}) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    if (scenarioOptions !== undefined) ref.current.scenarioOptions = scenarioOptions
    else ref.current.scenarioOptionsHtml = scenarioOptionsHtml
  }, [scenarioOptions, scenarioOptionsHtml])

  useEffect(() => {
    if (ref.current && scenarioFilters) {
      ref.current.registerScenarioFilters(scenarioFilters.fields, scenarioFilters.parseFilename)
    }
  }, [scenarioFilters])

  useEffect(() => {
    ref.current?.setAiScenarioGeneration(aiScenarioGeneration)
  }, [aiScenarioGeneration])

  return <taxpert-scenario-modal ref={ref} />
}
