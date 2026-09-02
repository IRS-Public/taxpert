// The bundled build, for hosts that have no bundler.
//
// `src/` stays the source of truth and is still shipped as raw ESM. This adds an artifact beside it
// for the four Form Builder applications, which have no bundler at all and so pay for the package's
// structure one request at a time.
//
//   npm run build   ->  dist/js/taxpert.js               (every template inlined into it)
//                       dist/styles/taxpert.css          (always on)
//                       dist/styles/audit-panel.css      (behind the workspace's toggled <link>)
//                       dist/styles/all-screens-toolbar.css
//                       dist/img/favicon.png
//                       dist/seam.json                   (see SHARED_SEAM)
//
// The directory shape, the three-way stylesheet split and the inlined templates are each
// load-bearing. See ../../../docs/internals/bundled-build.md before changing any of them.

import { rolldown } from 'rolldown'
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const SRC = join(PKG, 'src')
const DIST = join(PKG, 'dist')

/**
 * The modules an application imports directly, by path, from the vendored mirror, and which
 * therefore must not also exist inside the bundle. Bundling one gives the page two module
 * instances of it, so the application configures one while the elements read the other, with
 * nothing thrown and nothing logged.
 *
 * If an application starts importing some other subpath directly, it belongs on this list. The
 * symptom of forgetting is a feature that silently does nothing. Written to dist/seam.json so the
 * applications can check it from their side. See ../../../docs/internals/bundled-build.md.
 */
const SHARED_SEAM = [
  'shared/js/config.js', // fragments/taxpert-config.html, in all four applications
  'shared/js/graph-adapter.js', // each app's own website-static/js/taxpert/<app>-graph.js
  'shared/js/outcome-kinds.js', // credit-assistant's js/audit-panel/eligibility-dashboard.js
]

/** The custom elements and side-effect modules the applications load as <script type="module">. */
const ENTRY_MODULES = [
  'shared/js/favicon.js',
  'global-nav/js/taxpert-global-nav.js',
  'audit-panel/js/taxpert-audit-panel.js',
  'audit-panel/js/all-screens-toolbar.js',
  'tool-panels/js/taxpert-tool-dock.js',
]

/** Re-exported by name, so one import specifier can replace the five script tags. */
const REEXPORTS = [
  ['audit-panel/js/taxpert-audit-panel.js', ['enable', 'disable']],
  ['global-nav/js/templates.js', ['NAV_TEMPLATE_IDS', 'navTemplatesHosted']],
  ['shared/js/config.js', ['configure', 'configureFromUrl']],
  ['shared/js/graph-adapter.js', ['windowFactGraphAdapter']],
]

/**
 * One output per `<link>` (or per `@import` root) an application actually loads, flattened. The
 * three-way split follows how the applications load them, so it changes nothing about which sheet
 * applies when. Flattening each chain collapses 20 requests to 3. See
 * ../../../docs/internals/bundled-build.md for why audit-panel.css cannot join taxpert.css.
 */
const CSS_BUNDLES = {
  'taxpert.css': [
    'global-nav/styles/global-nav.css',
    'tool-panels/styles/tool-panels.css',
    // The gear's dialog. Always on because the gear is: it sits in the nav's workspace row, which
    // a host gets without mounting an audit panel, and audit-panel.css would have handed it over
    // disabled. Self-scoped to its own element and .twsm- classes, so it restructures nothing.
    'audit-panel/styles/workspace-settings-modal.css',
  ],
  'audit-panel.css': ['audit-panel/styles/audit-panel.css'],
  'all-screens-toolbar.css': ['audit-panel/styles/all-screens-toolbar.css'],
}

const VIRTUAL_ENTRY = '\0taxpert-bundle-entry'
const VIRTUAL_TEMPLATES = '\0taxpert-bundle-templates'

/** Every `<bundle>/templates/*.html` in the package, as `[basename, contents]`. */
async function templateFiles () {
  const out = []
  for (const bundle of await readdir(SRC, { withFileTypes: true })) {
    if (!bundle.isDirectory()) continue
    const dir = join(SRC, bundle.name, 'templates')
    let names = []
    try {
      names = await readdir(dir)
    } catch {
      continue // a bundle with no templates of its own
    }
    for (const name of names.filter((n) => n.endsWith('.html'))) {
      out.push([name, await readFile(join(dir, name), 'utf8')])
    }
  }
  const names = out.map(([n]) => n)
  const dupes = names.filter((n, i) => names.indexOf(n) !== i)
  if (dupes.length) {
    // The bundle registers templates under one flattened `../templates/<name>` URL, so two bundles
    // owning the same basename would silently shadow each other.
    throw new Error(`taxpert: two bundles ship a templates/${dupes[0]} — basenames must be unique`)
  }
  return out
}

/**
 * The template-registration module, which MUST be evaluated before any element module.
 *
 * It is a separate module and not the top of the entry for a reason that costs an afternoon to
 * find otherwise: ESM hoists every `import` above the module's own statements, so a registration
 * loop written at the top of the entry still runs after the element modules have been evaluated —
 * and `customElements.define()` upgrades any matching element already in the document, whose
 * connectedCallback calls loadTemplates() and starts the very fetch this is here to avoid. As its
 * own module imported first, it runs first, because imports are evaluated in order.
 *
 * The URL each file is registered under is the one the elements themselves compute at runtime —
 * `new URL('../templates/<file>', import.meta.url)` — which from this bundle at dist/js/ resolves
 * to dist/templates/<file>. The same expression, evaluated in the same place, so it is the same
 * key in loadTemplates' memo.
 */
async function templatesSource () {
  const templates = await templateFiles()
  return [
    '// Generated by scripts/build.mjs. Do not edit; it exists only inside the bundle.',
    "import { registerTemplates } from './src/shared/js/templates.js'",
    '',
    'const TEMPLATES = {',
    ...templates.map(([name, html]) => `  ${JSON.stringify(name)}: ${JSON.stringify(html)},`),
    '}',
    'for (const [file, html] of Object.entries(TEMPLATES)) {',
    // eslint-disable-next-line no-template-curly-in-string -- emitted source, not this file's
    '  registerTemplates(new URL(`../templates/${file}`, import.meta.url), html)',
    '}',
  ].join('\n')
}

/** The entry module, synthesized rather than committed: src/ stays entirely raw, valid ESM. */
function entrySource () {
  return [
    '// Generated by scripts/build.mjs. Do not edit; it exists only inside the bundle.',
    `import ${JSON.stringify(VIRTUAL_TEMPLATES)} // first, and see templatesSource() for why`,
    ...ENTRY_MODULES.map((m) => `import './src/${m}'`),
    ...REEXPORTS.map(([m, names]) => `export { ${names.join(', ')} } from './src/${m}'`),
  ].join('\n')
}

/** Inline a stylesheet's `@import` tree, depth-first, each file once. */
async function flattenCss (entry, seen = new Set()) {
  const abs = resolve(entry)
  if (seen.has(abs)) return `/* (already inlined: ${relative(SRC, abs)}) */\n`
  seen.add(abs)
  const css = await readFile(abs, 'utf8')
  const out = [`/* ── ${relative(SRC, abs)} ─────────────────────────────────────── */\n`]
  let rest = css
  // @import must precede every other rule, so the whole tree is resolvable by scanning the leading
  // run of them — through the comments that sit between them, since every stylesheet in this
  // package opens with one explaining itself. Anything after that run is copied through untouched.
  //
  // Matched in two steps — the whole statement, then the specifier inside it — rather than as one
  // pattern. One pattern that does both needs `\s+` before an optional `url(\s*`, which is the
  // ambiguity eslint-plugin-security flags as a backtracking risk, and this is clearer anyway: it
  // also gives somewhere to reject the one form that cannot be flattened.
  const IMPORT = /^@import[^;]*;/
  const SPEC = /^@import\s+(?:url\()?["']([^"']+)["']\)?\s*$/
  const SKIP = /^(?:\s+|\/\*[\s\S]*?\*\/)/
  for (;;) {
    const skip = rest.match(SKIP)
    if (skip) {
      out.push(skip[0])
      rest = rest.slice(skip[0].length)
      continue
    }
    const m = rest.match(IMPORT)
    if (!m) break
    const spec = m[0].slice(0, -1).trim().match(SPEC)
    if (!spec) {
      // `@import "x.css" screen and (min-width: 40em);` — flattening it would drop the condition
      // and apply the sheet everywhere, which is a silent visual change. Nothing in this package
      // uses one; if something starts to, this says so instead of quietly getting it wrong.
      throw new Error(`${relative(SRC, abs)}: cannot flatten a conditional @import — ${m[0]}`)
    }
    out.push(await flattenCss(join(dirname(abs), spec[1]), seen))
    rest = rest.slice(m[0].length)
  }
  // Anything left is a rule, and an @import after a rule is one CSS would have dropped on the
  // floor at load time — worth failing the build over rather than silently inlining nothing.
  if (/(?:^|\n)\s*@import\s/.test(rest)) {
    throw new Error(`${relative(SRC, abs)}: an @import follows a rule; CSS requires them first`)
  }
  out.push(rest)
  return out.join('\n')
}

async function main () {
  await rm(DIST, { recursive: true, force: true })
  await mkdir(join(DIST, 'js'), { recursive: true })
  await mkdir(join(DIST, 'styles'), { recursive: true })
  await mkdir(join(DIST, 'img'), { recursive: true })

  const sources = { [VIRTUAL_ENTRY]: entrySource(), [VIRTUAL_TEMPLATES]: await templatesSource() }
  const externals = SHARED_SEAM.map((m) => join(SRC, m))

  const build = await rolldown({
    input: VIRTUAL_ENTRY,
    platform: 'browser',
    plugins: [
      {
        name: 'taxpert-entry',
        resolveId (id, importer) {
          if (id in sources) return id
          const virtual = importer in sources
          if (!virtual && !id.startsWith('.')) return null
          const from = virtual || !importer ? join(PKG, 'x') : importer
          const abs = resolve(dirname(from), id)
          // The seam: rewritten to the path the vendored mirror serves it at, relative to the
          // bundle's own dist/js/ — so the browser loads the same file the application does.
          //
          // That path is correct in exactly one tree: the one `make copy-shared-ui` builds, where
          // src/ is flattened into vendor/taxpert/ and dist/ sits beside it. It does not resolve
          // inside this package, where the same modules are under src/, and it is why there is no
          // `./bundle` entry in the exports map: a bundler handed `taxpert/bundle` reports three
          // UNRESOLVED_IMPORTs and stops. (fact-explorer did, once — it derives optimizeDeps from
          // this package's exports map, and its vite.config.js now filters ./dist/ out for the same
          // reason.) This artifact is loaded by URL, by a host that has no bundler. Anything that
          // does have one should import the source subpaths, which are what the map exports.
          if (externals.includes(abs)) {
            return { id: `../../${relative(SRC, abs)}`, external: true }
          }
          return null
        },
        // `sources` has exactly two keys, both constants defined in this file.
        // eslint-disable-next-line security/detect-object-injection
        load: (id) => sources[id] ?? null,
      },
    ],
  })

  await build.write({ file: join(DIST, 'js', 'taxpert.js'), format: 'esm', minify: false })
  await build.close()

  for (const [name, roots] of Object.entries(CSS_BUNDLES)) {
    const seen = new Set()
    const parts = []
    for (const root of roots) parts.push(await flattenCss(join(SRC, root), seen))
    await writeFile(join(DIST, 'styles', name), parts.join('\n'))
  }

  // The seam, written down where a consumer's build can read it. Each application checks its own
  // source against this (`make validate-taxpert-seam`): a direct import of a vendored taxpert path
  // is fine if it is on this list and a duplicated module instance if it is not, and that is not a
  // distinction anyone should have to hold in their head. Adding a module here is a deliberate act;
  // discovering you needed to is otherwise a silent bug.
  await writeFile(
    join(DIST, 'seam.json'),
    JSON.stringify({ bundle: 'dist/js/taxpert.js', external: SHARED_SEAM }, null, 2) + '\n'
  )
  await cp(join(SRC, 'shared', 'img'), join(DIST, 'img'), { recursive: true })

  const size = async (p) => (await readFile(p)).length
  console.log(`taxpert bundle -> ${relative(PKG, DIST)}`)
  console.log(`  js/taxpert.js          ${(await size(join(DIST, 'js', 'taxpert.js'))).toLocaleString()} bytes`)
  for (const name of Object.keys(CSS_BUNDLES)) {
    console.log(`  styles/${(name + ' ').padEnd(16)}${(await size(join(DIST, 'styles', name))).toLocaleString()} bytes`)
  }
  console.log(`  (templates)            ${(await templateFiles()).length} files, inlined into the bundle`)
  console.log(`  external (SHARED_SEAM) ${SHARED_SEAM.join(', ')}`)
}

await main()
