// Thin React adapter for <taxpert-tool-dock>.
//
// Like WorkspaceSettingsModal, there is nothing to bridge: the element reads its layout from
// tool-layout.js, opens itself when a tool is switched on, and mounts a <taxpert-tools-modal> if the
// page hasn't got one. Mounting it is the whole integration — no ref, no props, no events.
//
// Where it goes does matter, though. The dock is a flex child of the host's layout, not an overlay,
// so it belongs as a sibling of the element holding the app's content, inside a flex row.

import '../src/tool-panels/js/taxpert-tool-dock.js' // side effect: customElements.define(...)
import '../src/tool-panels/styles/tool-panels.css'

export default function ToolDock () {
  return <taxpert-tool-dock />
}
