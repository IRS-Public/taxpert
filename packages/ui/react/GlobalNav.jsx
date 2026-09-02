// Thin React adapter for <taxpert-global-nav>.
//
// Handles the Web-Component-in-React sharp edges:
//   - Non-string props (menu array) can't be set as attributes — assign them as
//     DOM properties via a ref.
//   - Custom events have no JSX onXxx binding — bridge with addEventListener.
//   - The element reads its attributes once, on connect (the codebase pattern —
//     no attributeChangedCallback), so props that can *change* over a mount
//     (active, workspaceOn) are pushed through its property setters instead;
//     each does the one targeted DOM update it implies. Attributes that are
//     fixed for a mount (app, labels, workspace-locked) still pass as JSX props.
//   - React 19 assigns a JSX prop as a DOM *property* whenever the custom element has one by that
//     name, where React 18 set an attribute. So each simple-identifier prop passed below — `app`
//     and `active` — needs a setter on the element or the assignment throws mid-render and blanks
//     the whole host. Hyphenated props (context-label, workspace-*) are never valid identifiers and
//     stay attributes, which is why they were never affected.

import { useEffect, useRef } from 'react'
// Through the package's own entry point rather than `../src/…`, and every wrapper beside this one
// does the same. A relative path here is a second copy of everything under it as soon as a bundler
// pre-bundles the package's public specifiers but not this file — which is exactly what Vite's
// optimizeDeps does, since it will not take JSX from a linked dependency. shared/js/config.js holds
// the whole workspace configuration in module scope, so the host configures one copy while the
// element reads the other: nothing throws, and the nav comes up with no menu and no tools.
import 'taxpert' // side effect: customElements.define(...)
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
