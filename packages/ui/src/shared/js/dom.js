// The DOM helpers shared across bundles. Markup that never varies lives in a bundle's templates/
// file; what is left here is genuinely data-derived construction, one node per menu item or field.

export const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The host page's own language selector, a `<select>` whose every `<option>` carries the route for
 * one locale. Named here because two bundles read it and neither owns it. <taxpert-display-modal>
 * mirrors its options into the Display dialog, and <taxpert-screens-toolbar> rewrites those routes
 * to carry `?mode=`.
 */
export const HOST_LANGUAGE_SELECT = '#language-selector'

/**
 * `document.createElement` with an optional class.
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
 * An inline 24x24 SVG icon from a path `d` string, for icons chosen at runtime such as the nav's
 * per-tool icon. Inlined rather than `<use href>` against a host sprite, so a bundle stays
 * self-contained. A template needing a fixed icon carries the `<svg>` in its own markup.
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
