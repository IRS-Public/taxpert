// Thin React adapter for <taxpert-tools-modal>.
//
// Same shape as WorkspaceSettingsModal: the element self-wires to the global nav's nav-tool-select
// event and manages its own open/close state, so mounting it once (anywhere in the tree; it renders
// a body-level <dialog>) is the entire integration.
//
// A host that mounts <ToolDock /> does not need this — the dock mounts the modal itself if the page
// hasn't got one. Mount it directly only when the Tools button should work somewhere the dock isn't.

import 'taxpert/tools-modal' // side effect: customElements.define(...); package specifier, see GlobalNav.jsx
import '../src/tool-panels/styles/tool-panels.css'

export default function ToolsModal () {
  return <taxpert-tools-modal />
}
