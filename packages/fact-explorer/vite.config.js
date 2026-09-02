import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join, parse, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { appsDirs } from './scripts/build-registry.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))

// Applications live in their own repositories, and this one vendors none. `appsDirs()` is the
// single definition of where they are: the apps directory (FORM_BUILDER_APPS_DIR, else
// <repo root>/apps — see apps/README.md) plus any FORM_BUILDER_EXTRA_APPS_DIRS, shared with
// build-registry.mjs and make-static-fgm.mjs so the dev proxy and the registry can never disagree
// about the app list.
const APPS_DIRS = appsDirs()

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
  const roots = APPS_DIRS.filter((root) => existsSync(root))
  if (!roots.length) {
    console.warn(
      `[fact-explorer] no apps directory at ${APPS_DIRS.join(', ')} — the dev proxy will be empty ` +
        'and the canvas falls back to the mock fixture. Clone an app into it or set ' +
        'FORM_BUILDER_APPS_DIR (see apps/README.md).'
    )
    return []
  }
  // Symlinks as well as directories, and first root wins on a duplicate id. Both match
  // discoverDescriptors in scripts/build-registry.mjs, which this deliberately mirrors rather than
  // calls: it must read the *committed* descriptors, and it runs before any build step has.
  const seen = new Set()
  const apps = roots
    .flatMap((root) =>
      readdirSync(root, { withFileTypes: true })
        .filter(
          (d) =>
            (d.isDirectory() || d.isSymbolicLink()) &&
            existsSync(join(root, d.name, 'fact-explorer.app.json'))
        )
        .map((d) => JSON.parse(readFileSync(join(root, d.name, 'fact-explorer.app.json'), 'utf8')))
    )
    .filter((app) => !seen.has(app.id) && seen.add(app.id))
  if (!apps.length) {
    console.warn(
      `[fact-explorer] no fact-explorer.app.json under ${roots.join(', ')} — nothing to proxy. ` +
        'See apps/README.md.'
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

// FX-6 was `optimizeDeps: { include: <every JS entry in taxpert's exports map> }`, to collapse the
// ~50 dev-server requests a linked (`file:`) dependency costs — Vite treats such a package as source
// and does not pre-bundle it. It is gone, and this note is here so it is not re-added as written:
// taxpert cannot be handed to the dep optimizer at all, for two independent reasons.
//
// 1. Its elements locate their markup with `new URL('../templates/…', import.meta.url)`, relying on
//    Vite's static rewrite of that form — which happens only for a file Vite processes as *source*.
//    esbuild, which is what the dep optimizer runs, does not do it: the URL came out as
//    `.vite/deps/undefined`, every template fetch 404'd, and <taxpert-global-nav> fell back to its
//    degraded bar (waffle and workspace switch, no taxonomy, no tools). See the note in
//    packages/ui/src/audit-panel/js/templates.js, which spells this dependency out.
//
// 2. Optimizing only part of the package splits the module graph in two. The optimizer will not take
//    JSX from a linked package, so the six React wrappers stay source; anything they reach through
//    relative paths stays source with them, while the app's own bare `taxpert/…` imports resolve to
//    pre-bundled chunks. shared/js/config.js then exists twice, and since it holds the whole
//    workspace configuration in module scope, registerFactExplorerHost() configured one copy while
//    the mounted elements read the other. Nothing throws and nothing is logged — the nav simply comes
//    up with no menu and no tool buttons. The wrappers now import through the package's own
//    specifiers (packages/ui/react/GlobalNav.jsx), which closes that door, but it stays closed only
//    while the two halves resolve the same way.
//
// The waterfall is still worth removing. The shape that can work is TX-3's: a pre-built bundle that
// inlines its templates and calls registerTemplates(), so nothing depends on import.meta.url and
// there is one copy of everything. `taxpert/bundle` is that file, built for the four Form Builder
// applications; it names its shared-seam modules as `../../shared/js/*.js`, which resolves in the
// tree `make copy-shared-ui` lays out and not here, so consuming it needs that seam resolved for
// this tree first.

// FX-7. Serve public/data/ ourselves, compressed.
//
// The Fact Explorer anyone actually opens is this dev server, not the nginx in its image (the
// compose override builds `target: build` and runs `npm run dev`), so Stage 1's nginx work never
// reached it and the generated graphs arrived uncompressed. Vite's dev server does not compress,
// and has no configuration that makes it: this is the middleware the finding asks for.
//
// Caching is deliberately left as revalidation rather than a max-age. These files are regenerated
// by `npm run make-fgm` in the middle of a working session — that is the whole point of the dev
// stack — and a real max-age would serve yesterday's graph until someone thought to hard-refresh,
// which is a worse bug than the one being fixed. A strong-enough ETag makes a repeat load a 304
// with no body, which is what "free" was actually asking for.
//
// Compression is memoized on the file's identity, so an 8.4 MB graph is gzipped once per
// generation rather than once per request.
function compressedData() {
  const publicDir = join(HERE, 'public')
  const dataDir = join(publicDir, 'data')
  const cache = new Map()

  return {
    name: 'fact-explorer:compressed-data',
    configureServer(server) {
      // Installed in configureServer's body, so it runs BEFORE Vite's own static handler for
      // public/ — which would otherwise answer first, uncompressed.
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        const path = decodeURIComponent((req.url ?? '').split('?')[0])
        if (!path.startsWith('/data/') || !path.endsWith('.json')) return next()

        const file = join(publicDir, path)
        if (!file.startsWith(dataDir + sep)) return next() // no traversal out of public/data
        let stat
        try {
          stat = statSync(file)
        } catch {
          return next() // not there: let Vite produce the 404, so there is one 404 path
        }
        if (!stat.isFile()) return next()

        const etag = `W/"${stat.size}-${Math.round(stat.mtimeMs)}"`
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Vary', 'Accept-Encoding')
        res.setHeader('ETag', etag)
        if (req.headers['if-none-match'] === etag) {
          res.statusCode = 304
          return res.end()
        }

        const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
        let body = cache.get(etag + (gzip ? ':gz' : ''))
        if (!body) {
          const raw = readFileSync(file)
          body = gzip ? gzipSync(raw, { level: 6 }) : raw
          cache.set(etag + (gzip ? ':gz' : ''), body)
        }
        if (gzip) res.setHeader('Content-Encoding', 'gzip')
        res.setHeader('Content-Length', String(body.length))
        res.end(req.method === 'HEAD' ? undefined : body)
      })
    },
  }
}

// Standalone SPA. Runs fully decoupled from the credit-assistant dev server.
// host: true binds all interfaces (needed when run inside Docker). Polling is enabled
// only when VITE_USE_POLLING is set (Docker bind mounts on macOS don't emit FS events);
// native `npm run dev` is unaffected.
export default defineConfig({
  plugins: [react(), compressedData()],
  resolve: {
    // One React, whatever npm's tree says. @xyflow/react declares react as a peer of `>=17`, and in
    // this workspace npm satisfied that by installing its own react@18 at the root while this
    // package keeps the react@19 it depends on. Two copies means two hook dispatchers: the canvas
    // threw "Cannot read properties of null (reading 'useState')" from ReactFlowProvider and every
    // route rendered blank. Deduping resolves both specifiers to this package's copy — 19 satisfies
    // xyflow's peer range, so nothing is being forced here that the dependency did not allow.
    //
    // Kept as a resolver rule rather than an `overrides` block in the root package.json because it
    // fixes the bundle rather than the install: a fresh `npm install`, a different npm version, or
    // a lockfile refresh can reintroduce the split, and this holds either way.
    dedupe: ['react', 'react-dom'],
  },
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
