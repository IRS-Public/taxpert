// Shared test fixtures: load the committed FGM JSON straight from disk so the
// pure model/layout specs run under plain Node (no Vite, no fetch).
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = resolve(here, '..', 'public', 'data')
const dataPath = (...parts) => join(DATA, ...parts)

/** The S0 hand-authored fixture — small, exercises every category + edge kind. */
export function loadMock() {
  return JSON.parse(readFileSync(dataPath('form-builder-graph.mock.json'), 'utf8'))
}

/**
 * One app's generated graph, or null when it hasn't been generated yet.
 *
 * Per-app now: `npm run make-fgm` writes public/data/<appId>/form-builder-graph.json, because there is
 * no longer one "the" real graph — there is one per Form Builder app beside this checkout.
 *
 * @param {string} [appId] defaults to credit-assistant, the app most specs were written against
 */
export function loadRealOrNull(appId = 'credit-assistant') {
  try {
    return JSON.parse(readFileSync(dataPath(appId, 'form-builder-graph.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Every generated graph on disk, as `[appId, graph]` pairs — empty on a mock-only checkout.
 *
 * What the generator spec iterates: an invariant worth asserting is worth asserting for every app,
 * and a spec that names only credit-assistant is how fact-explorer came to assume there was one.
 */
export function loadAllReal() {
  if (!existsSync(DATA)) return []
  return readdirSync(DATA, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(DATA, d.name, 'form-builder-graph.json')))
    .map((d) => [d.name, loadRealOrNull(d.name)])
}
