// Thin React adapter for <taxpert-display-modal>.
//
// Like ScenarioModal, the element self-wires to the global nav's nav-tool-select event and manages
// its own open/close state, so mounting it (anywhere in the tree; it renders a body-level <dialog>)
// is most of the integration. What a React host still has to hand in is what it wants the dialog to
// *say* — its Visibility rows, its Layout choices, its footer command — none of which are strings,
// so they are assigned as DOM properties via a ref, same as GlobalNav's `menu`.
//
// Every prop is optional: omit them and the modal shows the built-in display options, which is what
// a Form Builder app gets. A host that supplies its own owns the state behind them — the descriptors
// carry the current value and the callback, and re-assigning the array on each state change is what
// keeps the controls in step.

import { useEffect, useRef } from 'react'
import 'taxpert/display-modal' // side effect: customElements.define(...); package specifier, see GlobalNav.jsx
import '../src/audit-panel/styles/display-modal.css'

export default function DisplayModal ({ visibilityOptions, layoutOptions, footerAction }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current && visibilityOptions) ref.current.visibilityOptions = visibilityOptions
  }, [visibilityOptions])

  useEffect(() => {
    if (ref.current && layoutOptions) ref.current.layoutOptions = layoutOptions
  }, [layoutOptions])

  useEffect(() => {
    if (ref.current && footerAction) ref.current.footerAction = footerAction
  }, [footerAction])

  return <taxpert-display-modal ref={ref} />
}
