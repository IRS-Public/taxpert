// The few DOM helpers that survive the move to templates.
//
// Markup that never varies belongs in a bundle's `templates/` file, cloned by the element that
// owns it. What is left over is genuinely data-derived construction — one node per menu item, per
// filter field, per tracked fact — and that is what `el()` is for. It was duplicated verbatim in
// six modules before this file existed.

export const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The host page's own language selector — a `<select>` whose every `<option>` carries the route for
 * one locale, written by the server that knows which locales exist.
 *
 * Two bundles read it and neither owns it, which is why the selector is named here rather than in
 * either: <taxpert-display-modal> mirrors its options into the Display dialog, and
 * <taxpert-screens-toolbar> rewrites those routes to carry `?mode=`, since one generated page serves
 * both listing destinations and the server cannot see which one you are on. Declaring it in the
 * modal and importing it into the toolbar would drag the whole dialog — and its customElements
 * registration — into a page that only wants the bar.
 */
export const HOST_LANGUAGE_SELECT = '#language-selector'

/**
 * `document.createElement` with an optional class, the shape every bundle had its own copy of.
 * @param {string} tag
 * @param {string} [className]
 * @returns {HTMLElement}
 */
export function el (tag, className) {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

/**
 * An inline 24×24 SVG icon from a path `d` string. Inlined rather than `<use href>` against the
 * host's sprite so a bundle stays self-contained: hosts without credit-assistant's vendored USWDS
 * icons still get icons. Templates that need a *fixed* icon carry the `<svg>` in their markup —
 * this is for icons chosen at runtime (the nav's per-tool icon).
 * @param {string} d
 * @param {string} [className]
 * @returns {SVGElement}
 */
export function svgIcon (d, className) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  if (className) svg.setAttribute('class', className)
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d ?? '')
  path.setAttribute('fill', 'currentColor')
  svg.appendChild(path)
  return svg
}
