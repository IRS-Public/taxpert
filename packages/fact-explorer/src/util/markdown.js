// Minimal markdown → HTML renderer (ported from the credit-assistant
// audit-panel.js). Handles fenced code blocks, ## / ### headings, unordered and
// ordered lists, inline `code` and **bold**, and paragraph breaks. Produces an
// HTML string for dangerouslySetInnerHTML; all text is escaped first.
import { escapeHtml } from './html.js'

function renderInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

/** Render a markdown string to an HTML string. */
export function renderMarkdown(text) {
  const lines = text.split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trimStart().startsWith('```')) {
      const fence = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        fence.push(escapeHtml(lines[i]))
        i++
      }
      out.push('<pre><code>' + fence.join('\n') + '</code></pre>')
      i++
      continue
    }
    const h4 = line.match(/^###\s+(.+)$/)
    const h3 = line.match(/^##\s+(.+)$/)
    if (h4) {
      out.push('<h4>' + renderInline(h4[1]) + '</h4>')
      i++
      continue
    }
    if (h3) {
      out.push('<h3>' + renderInline(h3[1]) + '</h3>')
      i++
      continue
    }
    if (/^[-*]\s/.test(line)) {
      const items = []
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push('<li>' + renderInline(lines[i].replace(/^[-*]\s+/, '')) + '</li>')
        i++
      }
      out.push('<ul>' + items.join('') + '</ul>')
      continue
    }
    if (/^\d+\.\s/.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push('<li>' + renderInline(lines[i].replace(/^\d+\.\s+/, '')) + '</li>')
        i++
      }
      out.push('<ol>' + items.join('') + '</ol>')
      continue
    }
    if (line.trim() === '') {
      out.push('<br>')
      i++
      continue
    }
    out.push(renderInline(line) + '<br>')
    i++
  }
  return out.join('').replace(/(<br>)+$/, '')
}
