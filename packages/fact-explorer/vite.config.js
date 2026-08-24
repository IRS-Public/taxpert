import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { appsDir } from './scripts/build-registry.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))

// Applications live in their own repositories, and this one vendors none. `appsDir()` is the single
// definition of where they are: FORM_BUILDER_APPS_DIR, else <repo root>/apps (see apps/README.md),
// shared with build-registry.mjs and make-static-fgm.mjs so the dev proxy and the registry can
// never disagree about the app list.
const APPS_DIR = appsDir()

// npm workspaces hoist dependencies to the workspace root, so a package is not necessarily under
// this directory's own node_modules. Walk up until we find the one that holds it.
// Resolved through realpath, because in a workspace `node_modules/<pkg>` is a symlink into
// packages/ and Vite checks fs.allow against the *real* path: listing the link leaves the target
// outside the allow-list, which is a 403 on every template the bundles fetch.
function nodeModulesDir(pkg) {
  for (let dir = HERE; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', pkg)
    if (existsSync(candidate)) return realpathSync(candidate)
    if (dir === parse(dir).root) return join(HERE, 'node_modules', pkg)
  }
}

// Every Form Builder app in the apps directory, read from the *committed* descriptors rather than the
// generated public/data/apps.json. vite.config.js is evaluated before any build step has run, and
// apps.json is gitignored, so a fresh clone would have nothing to read.
function discoveredApps() {
  const root = APPS_DIR
  if (!existsSync(root)) {
    console.warn(
      `[fact-explorer] no apps directory at ${root} — the dev proxy will be empty and the canvas ` +
        'falls back to the mock fixture. Clone an app into it or set FORM_BUILDER_APPS_DIR ' +
        '(see apps/README.md).'
    )
    return []
  }
  // Symlinks as well as directories. See discoverDescriptors in scripts/build-registry.mjs.
  const apps = readdirSync(root, { withFileTypes: true })
    .filter(
      (d) =>
        (d.isDirectory() || d.isSymbolicLink()) &&
        existsSync(join(root, d.name, 'fact-explorer.app.json'))
    )
    .map((d) => JSON.parse(readFileSync(join(root, d.name, 'fact-explorer.app.json'), 'utf8')))
  if (!apps.length) {
    console.warn(
      `[fact-explorer] no fact-explorer.app.json under ${root} — nothing to proxy. See apps/README.md.`
    )
  }
  return apps
}

// Per-app origin override, e.g. VITE_APP_ORIGIN_CREDIT_ASSISTANT=http://credit-assistant, for an
// app that does run as a container on the same network.
const envOrigin = (id) => process.env[`VITE_APP_ORIGIN_${id.toUpperCase().replace(/-/g, '_')}`]

// Host every descriptor's dev origin is read against. `localhost` is right natively and wrong
// inside a container, where it is the container itself. docker-compose.override.yml sets this to
// host.docker.internal so the proxy reaches apps running on the host. It rewrites the host only:
// the port still comes from the descriptor.
const ORIGIN_HOST = process.env.VITE_APP_ORIGIN_HOST
const withOriginHost = (origin) => {
  if (!ORIGIN_HOST) return origin
  const url = new URL(origin)
  url.hostname = ORIGIN_HOST
  return url.origin
}

// Standalone SPA. Runs fully decoupled from the credit-assistant dev server.
// host: true binds all interfaces (needed when run inside Docker). Polling is enabled
// only when VITE_USE_POLLING is set (Docker bind mounts on macOS don't emit FS events);
// native `npm run dev` is unaffected.
export default defineConfig({
  plugins: [react()],
  css: {
    preprocessorOptions: {
      scss: {
        // USWDS's Sass packages (see src/styles/uswds.scss) @use each other by bare package
        // name (e.g. `@use "usa-checkbox"`), which only resolves with this directory on the
        // load path. It is the "packages" dir @uswds/uswds ships specifically for this a-la-carte
        // (per-component) style of consumption, as opposed to `@use "uswds"` for the whole thing.
        loadPaths: [join(nodeModulesDir('@uswds/uswds'), 'packages')],
        // USWDS's Sass still uses the legacy if()/lighten()/darken() syntax Dart Sass is
        // deprecating; quiet those (they're not actionable from a consumer of the package).
        quietDeps: true,
        silenceDeprecations: ['import', 'global-builtin', 'color-functions'],
      },
    },
  },
  server: {
    port: 5180,
    open: true,
    host: true,
    watch: { usePolling: !!process.env.VITE_USE_POLLING },
    // taxpert is a `file:../taxpert` dep, so node_modules/taxpert is a symlink and
    // its real path sits outside this project root, and so outside Vite's default fs allow-list.
    // The shared bundles fetch their own `templates/*.html` at runtime, and the one written as
    // a static `new URL('../templates/shared.html', import.meta.url)` (shared/js/modal-shell.js)
    // is rewritten by Vite into an absolute `/@fs/…` URL, which the allow-list then rejected
    // with a 403. That file is the <dialog> shell every workspace modal clones, so the Scenario
    // button and the workspace-settings gear silently opened nothing. Allow the package dir.
    fs: {
      allow: [fileURLToPath(new URL('.', import.meta.url)), nodeModulesDir('taxpert')],
    },
    // Scenario overlay (N1–N6): proxy each Form Builder app's dev server so its assets are
    // same-origin with fact-explorer. This lets the overlay fetch the Scala.js engine bundle, the
    // fact dictionary and the scenario JSONs with no CORS, and share sessionStorage with an
    // embedded iframe. One entry per discovered app, keyed on its basePath. The table used to be the
    // single literal '/app/eitc', which is why fact-explorer could only ever show one app.
    //
    // Each app must be running for its own overlay to work (`make dev` in that repo). Override a
    // target with VITE_APP_ORIGIN_<ID>; the default is the descriptor's devPort.
    proxy: Object.fromEntries(
      discoveredApps().map((a) => [
        a.basePath,
        {
          target:
            envOrigin(a.id) ||
            withOriginHost(a.devOrigin || `http://localhost:${a.devPort ?? 3000}`),
          changeOrigin: true,
        },
      ])
    ),
  },
})
