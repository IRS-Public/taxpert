// scripts/build-registry.mjs — discover the Form Builder apps this checkout can see.
//
// Globs `<apps dir>/＊/fact-explorer.app.json`, resolves each descriptor into the browser-shaped
// form the SPA reads, and writes public/data/apps.json (generated, gitignored).
//
// Applications live in their own repositories — none is vendored here — so the apps directory is
// the one thing that has to be told: FORM_BUILDER_APPS_DIR, or the default `<repo root>/apps`,
// where you clone or symlink them (see apps/README.md).
//
// Discovery rather than registration is what keeps a generated app from having to edit a file it
// does not own: `cookiecutter form-builder-template` emits a fact-explorer.app.json, and dropping
// the new repo into the apps directory is the whole of the wiring. It is also why the
// cookiecutter's post-gen hook writes nothing outside the project it generates.
//
//   node scripts/build-registry.mjs                   (or: npm run build-registry)
//   FORM_BUILDER_APPS_DIR=~/code node scripts/build-registry.mjs
//   node scripts/build-registry.mjs --root /apps      scan somewhere else
//
// An optional form-builder-apps.json in the apps directory may override ordering and the default app:
//   { "defaultAppId": "credit-assistant", "order": ["credit-assistant", "twe"] }
// It is never required — with no such file the apps come out in directory order.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FACT_EXPLORER = resolve(__dirname, '..')

const DESCRIPTOR = 'fact-explorer.app.json'
const DEFAULT_APPS_DIR = resolve(FACT_EXPLORER, '..', '..', 'apps')
const OVERRIDES = 'form-builder-apps.json'

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/**
 * The directory holding the app repos: FORM_BUILDER_APPS_DIR, else `<repo root>/apps`.
 * One definition, imported by make-static-fgm.mjs and vite.config.js, so the dev server, the
 * generator and the registry can never disagree about where the apps are.
 */
export function appsDir() {
  return process.env.FORM_BUILDER_APPS_DIR
    ? resolve(process.env.FORM_BUILDER_APPS_DIR)
    : DEFAULT_APPS_DIR
}

/**
 * Every directory under the apps directory that carries a descriptor, in directory order.
 * Symlinks count: apps/README.md offers `ln -s` as the alternative to cloning, and a Dirent for a
 * symlink-to-a-directory reports isSymbolicLink() rather than isDirectory().
 */
export function discoverDescriptors(scanRoot) {
  if (!existsSync(scanRoot)) return []
  return readdirSync(scanRoot, { withFileTypes: true })
    .filter(
      (d) =>
        (d.isDirectory() || d.isSymbolicLink()) && existsSync(join(scanRoot, d.name, DESCRIPTOR))
    )
    .map((d) => ({
      repoDir: join(scanRoot, d.name),
      ...readJson(join(scanRoot, d.name, DESCRIPTOR)),
    }))
}

const trimSlash = (s) => s.replace(/\/$/, '')
const under = (basePath, suffix) => `${trimSlash(basePath)}/${suffix.replace(/^\//, '')}`

/**
 * Descriptor → the runtime entry the SPA consumes: every path absolutised, every derived field
 * computed once here rather than in a component.
 *
 * `fgm` carries both sources deliberately. `remote` is the Scala generator's output, served by the
 * app itself and reached through the dev proxy — authoritative, because it comes from the same
 * parser that generated the site. `local` is the Node generator's, served from fact-explorer's own
 * public/ — the offline fallback for when the app is not running. load.js tries them in that order,
 * so an app adopting `--formBuilderGraph` needs no registry change.
 */
export function toRegistryEntry(d) {
  const base = trimSlash(d.basePath)
  return {
    id: d.id,
    label: d.label ?? d.id,
    appId: d.appId ?? d.id,
    basePath: base,
    storagePrefix: d.storagePrefix ?? d.appId ?? d.id,
    devOrigin: d.devOrigin ?? `http://localhost:${d.devPort ?? 3000}`,
    taxYear: d.taxYear,
    engine: {
      bundle: under(base, d.engine?.bundle ?? 'resources/vendor/fact-graph/factgraph-3.1.0.js'),
      dictionary: under(base, d.engine?.dictionary ?? 'resources/fact-dictionary.xml'),
    },
    capabilities: {
      allScreens: Boolean(d.capabilities?.allScreens),
      scenarioMode: Boolean(d.capabilities?.scenarioMode),
      authorMode: Boolean(d.capabilities?.authorMode),
    },
    scenarios: d.scenarios
      ? {
          base: under(base, `resources/${d.scenarios.dir ?? 'scenarios'}`),
          index: `/data/${d.id}/scenarios-index.json`,
          vocabulary: d.scenarios.vocabulary ?? 'none',
        }
      : null,
    fgm: {
      remote: under(base, 'resources/form-builder-graph.json'),
      local: `/data/${d.id}/form-builder-graph.json`,
    },
    customFlowTags: d.customFlowTags ?? [],
  }
}

/** Apply the optional ordering/default overrides. Unknown ids in `order` are ignored. */
function applyOverrides(entries, overrides) {
  if (!overrides?.order) return entries
  const rank = new Map(overrides.order.map((id, i) => [id, i]))
  const at = (e) => (rank.has(e.id) ? rank.get(e.id) : Number.MAX_SAFE_INTEGER)
  return [...entries].sort((a, b) => at(a) - at(b))
}

export function buildRegistry(scanRoot) {
  const descriptors = discoverDescriptors(scanRoot)
  if (!descriptors.length) {
    throw new Error(
      `No ${DESCRIPTOR} found in ${scanRoot}.\n` +
        'A Form Builder app declares itself with one at its repo root, and applications live in ' +
        'their own repositories — this one vendors none.\n' +
        'Clone or symlink an app into that directory, or set FORM_BUILDER_APPS_DIR / pass --root ' +
        'to point somewhere else. See apps/README.md.'
    )
  }
  const overridesPath = join(scanRoot, OVERRIDES)
  const overrides = existsSync(overridesPath) ? readJson(overridesPath) : null

  const apps = applyOverrides(descriptors.map(toRegistryEntry), overrides)
  const defaultAppId =
    overrides?.defaultAppId && apps.some((a) => a.id === overrides.defaultAppId)
      ? overrides.defaultAppId
      : apps[0].id

  return { version: 1, generatedAt: new Date().toISOString(), defaultAppId, apps }
}

/** Build the registry and write it to public/data/apps.json. Also called by make-static-fgm.mjs,
 *  so a generated graph and the registry entry describing it can never be written out of step. */
export function buildRegistryFile(scanRoot, outPath) {
  const registry = buildRegistry(scanRoot)
  const out = outPath ? resolve(outPath) : join(FACT_EXPLORER, 'public', 'data', 'apps.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(registry, null, 2)}\n`)

  const names = registry.apps.map((a) => (a.id === registry.defaultAppId ? `${a.id}*` : a.id))
  console.log(`Wrote ${out}`)
  console.log(`  apps         ${registry.apps.length} — ${names.join(', ')}  (* = default)`)
  return registry
}

function main(argv) {
  // --empty writes a registry with no apps. The Docker image uses it: a prebuilt image cannot know
  // its consumer's apps, so it ships an empty registry and its entrypoint rewrites it from whatever
  // is mounted at /apps. Without a mount the SPA then says so, rather than 404ing on apps.json.
  if (argv.includes('--empty')) {
    const outFlag = argv.indexOf('--out')
    const out =
      outFlag === -1
        ? join(FACT_EXPLORER, 'public', 'data', 'apps.json')
        : resolve(argv[outFlag + 1])
    mkdirSync(dirname(out), { recursive: true })
    const registry = {
      version: 1,
      generatedAt: new Date().toISOString(),
      defaultAppId: null,
      apps: [],
    }
    writeFileSync(out, `${JSON.stringify(registry, null, 2)}\n`)
    console.log(`Wrote ${out}`)
    console.log('  apps         0 — empty registry; mount app descriptors at /apps to populate it')
    return
  }
  const rootFlag = argv.indexOf('--root')
  const scanRoot = rootFlag === -1 ? appsDir() : resolve(argv[rootFlag + 1])
  // --out lets the runtime container rewrite the registry inside the served dist/ rather than
  // into this checkout's public/. Discovery has to survive the image boundary: a prebuilt image
  // cannot know its consumer's apps, so it rescans a mounted /apps at start.
  const outFlag = argv.indexOf('--out')
  buildRegistryFile(scanRoot, outFlag === -1 ? undefined : argv[outFlag + 1])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
