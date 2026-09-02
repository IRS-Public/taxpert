// Fact Explorer's "Display options": the shared <taxpert-display-modal>, filled with this host's
// own choices and opened from the same global-nav Display button every other Taxpert destination
// uses (taxpertHost.js adds 'fact-explorer' to that tool's destinations).
//
// What moved in here, and why it is not the canvas control panel:
//   · "Reveal items skipped in scenarios" was the Overlay Off/Dim/Hide segmented buttons. Off and
//     Dim differed only in whether an unloaded scenario decorated nothing, so the real choice was
//     always Dim-vs-Hide: reveal the questions this taxpayer never reaches, greyed, or drop them.
//   · Vertical/Horizontal was the Layout segmented buttons, which is the Layout section of this
//     modal in every other destination too.
//   · "Reset layout" was a button in the annotation toolbar, beside Export/Import.
//   · "Show product experience side-by-side" opens the embedded app panel, which had no control of
//     its own. You docked it from a banner of manual tabs and nothing said it was a display
//     preference. That banner is gone now; this checkbox is the only way to dock it.
//
// The state stays in FactExplorer: these descriptors carry the current value and the callback, and
// are re-assigned to the element on each change, which is how the dialog stays in step with a
// canvas the user may also be driving from the banner.
import { useMemo } from 'react'
import PropTypes from 'prop-types'
import DisplayModal from 'taxpert/react/display-modal'

const LAYOUT_OPTIONS = [
  { value: 'vertical', label: 'Vertical (default)' },
  { value: 'horizontal', label: 'Horizontal' },
]

export default function DisplayOptions({
  revealSkipped,
  onRevealSkipped,
  miniMap,
  onMiniMap,
  sideBySide,
  onSideBySide,
  orientation,
  onOrientation,
  onResetLayout,
}) {
  const visibilityOptions = useMemo(
    () => [
      {
        id: 'fe-display-reveal-skipped',
        label: 'Reveal items skipped in scenarios',
        checked: revealSkipped,
        onChange: onRevealSkipped,
      },
      {
        id: 'fe-display-side-by-side',
        label: 'Show product experience side-by-side',
        checked: sideBySide,
        onChange: onSideBySide,
      },
      // The minimap draws a second copy of every node and redraws it on every pan, so on a large
      // slice it costs more than the canvas does. It defaults off above LARGE_SLICE_NODES, and
      // this is where it is turned back on.
      {
        id: 'fe-display-minimap',
        label: 'Show minimap',
        checked: miniMap,
        onChange: onMiniMap,
      },
    ],
    [revealSkipped, onRevealSkipped, sideBySide, onSideBySide, miniMap, onMiniMap]
  )

  const layoutOptions = useMemo(
    () => ({ options: LAYOUT_OPTIONS, value: orientation, onChange: onOrientation }),
    [orientation, onOrientation]
  )

  const footerAction = useMemo(
    () => ({ label: 'Reset layout', onSelect: onResetLayout }),
    [onResetLayout]
  )

  return (
    <DisplayModal
      visibilityOptions={visibilityOptions}
      layoutOptions={layoutOptions}
      footerAction={footerAction}
    />
  )
}

DisplayOptions.propTypes = {
  revealSkipped: PropTypes.bool,
  onRevealSkipped: PropTypes.func.isRequired,
  miniMap: PropTypes.bool,
  onMiniMap: PropTypes.func.isRequired,
  sideBySide: PropTypes.bool,
  onSideBySide: PropTypes.func.isRequired,
  orientation: PropTypes.string.isRequired,
  onOrientation: PropTypes.func.isRequired,
  onResetLayout: PropTypes.func.isRequired,
}
