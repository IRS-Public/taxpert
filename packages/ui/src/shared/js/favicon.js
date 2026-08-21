// The workspace's favicon.
//
// A tab running a Form Builder app under Taxpert shows the Taxpert mark, so it reads as the
// workspace rather than as the product. The scaffold's fragments/head.html links the
// *application's* icons (resources/img/favicon.ico and its siblings) on every page it generates,
// with or without a workspace over it; those are what this replaces, and only on the pages that
// mount the workspace.
//
// Importing the module installs the icon. It is mounted from two application-owned fragments,
// fragments/workspace-head.html and fragments/workspace-all-screens.html, which is what makes
// "unless the application overrides it" a one-line deletion in a file the application already
// owns. Nothing here reaches back into the app, so an override needs no flag and no configure()
// key.
//
// The application's links are removed rather than out-ranked. With more than one <link rel="icon">
// on a page the choice is the browser's, and Chrome, Firefox and Safari do not make it the same
// way; removing them leaves one candidate. rel="apple-touch-icon-precomposed" is left alone,
// because it names the home-screen icon for a saved product page and the workspace has no claim
// on that.

/** Resolved against this module's own URL, so it works from the vendored mirror and from a bundler. */
const FAVICON_URL = new URL('../img/favicon.png', import.meta.url).href

/** Marks the link this module owns, so a second import is a no-op rather than a second link. */
const MARKER = 'data-taxpert-favicon'

/**
 * Make the workspace's icon the page's only `rel="icon"`.
 *
 * @param {string} [href] The icon to install. Defaults to the one this package ships.
 * @returns {HTMLLinkElement|null} The installed link, or null with no document to install into.
 */
export function installFavicon (href = FAVICON_URL) {
  if (typeof document === 'undefined' || !document.head) return null

  const already = document.head.querySelector(`link[${MARKER}]`)
  if (already) return already

  for (const link of document.querySelectorAll('link[rel~="icon"]')) link.remove()

  const link = document.createElement('link')
  link.rel = 'icon'
  link.type = 'image/png'
  link.href = href
  link.setAttribute(MARKER, '')
  document.head.appendChild(link)
  return link
}

installFavicon()
