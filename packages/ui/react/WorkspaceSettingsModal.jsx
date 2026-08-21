// Thin React adapter for <taxpert-workspace-settings-modal>.
//
// Unlike GlobalNav, there are no props/attributes or CustomEvents to bridge — the element
// self-wires to the global nav's nav-tool-select event and manages its own open/close state — so
// mounting it once (anywhere in the tree; it renders a body-level <dialog>) is the entire
// integration. A host doesn't hold a ref or handle events.

import '../src/audit-panel/js/workspace-settings-modal.js' // side effect: customElements.define(...)
import '../src/audit-panel/styles/workspace-settings-modal.css'

export default function WorkspaceSettingsModal () {
  return <taxpert-workspace-settings-modal />
}
