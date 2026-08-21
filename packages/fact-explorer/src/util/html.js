/** Escape the five HTML-significant characters for safe interpolation into an
 *  HTML string (`&`, `<`, `>`, `"`). Used by the explain renderer and chat
 *  markdown, both of which build raw HTML strings rendered via dangerouslySetInnerHTML. */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
