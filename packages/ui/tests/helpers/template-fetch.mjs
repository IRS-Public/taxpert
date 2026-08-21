// Test seam for src/shared/js/templates.js.
//
// The bundles fetch their markup from `new URL('../templates/<bundle>.html', import.meta.url)`,
// which under `node --test` is a file: URL — and node's fetch refuses file:. This stub answers
// file: URLs off disk with node:fs and delegates everything else, so a spec that already stubs
// fetch for its own reasons (the fact-dictionary XML in taxpert-audit-panel.test.mjs, say) keeps
// its stub by passing it as `fallback`.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Install the stub on globalThis.fetch.
 * @param {(url: string, init?: object) => Promise<object>} [fallback] handler for non-file: URLs
 */
export function stubTemplateFetch (fallback) {
  const previous = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input)
    if (url.startsWith('file:')) {
      // Test-only, and the path comes from a bundle's own `new URL(…, import.meta.url)`.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const text = await readFile(fileURLToPath(url), 'utf8')
      return { ok: true, status: 200, text: async () => text }
    }
    if (fallback) return fallback(url, init)
    if (previous) return previous(input, init)
    throw new Error(`template-fetch stub: unexpected fetch of ${url}`)
  }
}
