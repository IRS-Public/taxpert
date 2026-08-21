// Thin React adapter for <taxpert-global-nav>.
//
// Handles the Web-Component-in-React sharp edges (React 18):
//   - Non-string props (menu array) can't be set as attributes — assign them as
//     DOM properties via a ref.
//   - Custom events have no JSX onXxx binding — bridge with addEventListener.
//   - The element reads its attributes once, on connect (the codebase pattern —
//     no attributeChangedCallback), so props that can *change* over a mount
//     (active, workspaceOn) are pushed through its property setters instead;
//     each does the one targeted DOM update it implies. Attributes that are
//     fixed for a mount (app, labels, workspace-locked) still pass as JSX props.

import { useEffect, useRef } from 'react'
import '../src/global-nav/js/taxpert-global-nav.js' // side effect: customElements.define(...)
import '../src/global-nav/styles/global-nav.css'

export default function GlobalNav ({
  app,
  active,
  menu,
  workspaceOn = false,
  workspaceLocked = false,
  workspaceLabel = 'TAXPERT WORKSPACE',
  contextLabel,
  onSelect,
  onWorkspaceToggle,
  onToolSelect,
}) {
  const ref = useRef(null)

  // Object/array props → DOM properties, not attributes.
  useEffect(() => {
    if (menu !== undefined && ref.current) ref.current.menu = menu
  }, [menu])

  // Props the element can't pick up from an attribute change → its property setters. The initial
  // values still arrive as attributes on the JSX below, so the first render needs no effect.
  useEffect(() => {
    if (active !== undefined && ref.current) ref.current.active = active
  }, [active])

  useEffect(() => {
    if (ref.current && !workspaceLocked) ref.current.workspaceOn = workspaceOn
  }, [workspaceOn, workspaceLocked])

  // CustomEvents → React callbacks.
  //
  // `nav-tool-select` (the Scenario / Display / Tools buttons and the workspace gear) is optional:
  // every surface those buttons open — <taxpert-scenario-modal>, <taxpert-display-modal>,
  // <taxpert-tools-modal>, <taxpert-workspace-settings-modal> — self-wires to the event on the
  // document, so a host that just mounts them needs no callback. This is for a host that wants to
  // open something of its own, or know which button was pressed.
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const handleSelect = (event) => onSelect?.(event)
    const handleToggle = (event) => onWorkspaceToggle?.(event.detail.on, event)
    const handleTool = (event) => onToolSelect?.(event.detail.id, event)
    node.addEventListener('nav-select', handleSelect)
    node.addEventListener('workspace-toggle', handleToggle)
    node.addEventListener('nav-tool-select', handleTool)
    return () => {
      node.removeEventListener('nav-select', handleSelect)
      node.removeEventListener('workspace-toggle', handleToggle)
      node.removeEventListener('nav-tool-select', handleTool)
    }
  }, [onSelect, onWorkspaceToggle, onToolSelect])

  return (
    <taxpert-global-nav
      ref={ref}
      app={app}
      active={active}
      context-label={contextLabel}
      workspace-label={workspaceLabel}
      workspace-on={String(!!workspaceOn)}
      workspace-locked={String(!!workspaceLocked)}
    />
  )
}
