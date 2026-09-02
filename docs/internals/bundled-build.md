# Internals: the bundled build

`packages/ui` ships twice. `src/` is the source of truth and is still published as raw ESM, which is
what Fact Explorer imports subpaths of through the `exports` map and lets Vite tree-shake.
`npm run build` adds a bundled artifact beside it, in `dist/`, for hosts that have no bundler.

The four Form Builder applications are those hosts. Loading the package as shipped costs them 52 JS
modules across five levels of import waterfall, 20 stylesheets down an `@import` chain, and 9
template files fetched at runtime, around 81 requests on a workspace page. The bundle makes that 5.

`scripts/build.mjs` is the builder, and it runs on `rolldown`.

## The output

| File | Loaded by |
|---|---|
| `dist/js/taxpert.js` | every application, as one `<script type="module">`. Every template is inlined into it |
| `dist/styles/taxpert.css` | each application's `main.css`, always on |
| `dist/styles/audit-panel.css` | the workspace's toggled `<link id="audit-panel-styles" disabled>` |
| `dist/styles/all-screens-toolbar.css` | the all-screens page, independently |
| `dist/img/favicon.png` | the favicon module, by relative URL |
| `dist/seam.json` | the applications' `make validate-taxpert-seam` |

### The directory shape is load-bearing

`dist/` is laid out as `js/`, `styles/` and `img/`, the same shape as `global-nav/`, `audit-panel/`
and every other bundle directory in `src/`, and therefore the same shape in the vendored mirror. The
modules resolve their own assets with `new URL('../img/favicon.png', import.meta.url)`, so putting
the bundle at `dist/js/` is what keeps that resolving to a real file after bundling. A flat
`dist/taxpert.js` would point it at a 404.

### Three stylesheets rather than one

The split follows how the applications actually load them, so flattening changes which sheet is
loaded when. `audit-panel.css` stays separate because its rules restructure the product page and it
sits behind a `<link>` the workspace toggle flips. Merging it into the always-on sheet would apply
those rules with the workspace off. `all-screens-toolbar.css` stays separate because the all-screens
page is chrome all the way down and exists without a workspace.

The other twenty stylesheets are scoped to the bundles' own custom elements and their `.ttd-`,
`.ttp-` and `.ttm-` classes, which is why they can be one always-applied file. Flattening each chain
turns 20 requests into 3.

### Templates are inlined, not copied

The bundle registers all fourteen templates at startup through `registerTemplates()` in
`src/shared/js/templates.js`, under exactly the URL each element computes for itself. Nothing is ever
fetched from `dist/templates/`, and there is no `dist/templates/` to fetch from.

They were copied there at first, and it cost every consuming application a doubled html-validate
report, because the vendored mirror then held two copies of the same fourteen files and the linter
has no way to know they are the same file. Nothing else needs them either. A host that overrides one
with `templates-base` points somewhere else by definition, and a host that imports a subpath out of
`exports` gets `src/`'s own templates directory.

## The shared seam

`SHARED_SEAM` in `build.mjs` names the modules deliberately left **out** of the bundle. They are the
ones an application imports directly, by path, from the vendored mirror.

| Module | Imported by |
|---|---|
| `shared/js/config.js` | `templates/fragments/taxpert-config.html`, in all four applications |
| `shared/js/graph-adapter.js` | each application's own `website-static/js/taxpert/<app>-graph.js` |
| `shared/js/outcome-kinds.js` | credit-assistant's `js/audit-panel/eligibility-dashboard.js` |

Bundling one of these while an application also imports it by path gives the page two module
instances of it. `config.js` holds the whole workspace configuration in module scope, so the
application configures one instance and the elements read the other. Nothing throws and nothing is
logged. The nav simply comes up with no menu.

Leaving them external keeps them single instances, at the cost of four unbundled files out of
fifty-two (these three plus `config.js`'s own `flow-dom.js` and `config-schema.js`). The bundle
re-exports them, so a host that would rather import everything from one place still can.

If an application starts importing some other subpath directly, it belongs on this list. Forgetting
does not crash anything, it produces a feature that silently does nothing. `dist/seam.json` publishes
the list as data so the applications' `make validate-taxpert-seam` can check it from the other side,
rather than leaving it as a comment two repositories away.

## Hosted nav templates

`<taxpert-global-nav>` clones its markup from five `<template>` elements. `getTemplate()` resolves a
hosted `<template id>` in the page before it looks in its own registry, which is the same
host-override seam the audit panel uses.

The Form Builder applications paste those five blocks into
`templates/fragments/workspace-head.html`, so the bar renders synchronously on connect rather than
waiting on a fetch that is itself queued behind the flow runtime's boot. `navTemplatesHosted()` in
`src/global-nav/js/templates.js` is what detects that: when all five ids are present the bundle skips
the fetch outright.

It is all five or none. The render throws on the first id it cannot resolve, and `tgn-tool` is the
one usually left out, because it only renders when the configuration declares tools.

The applications' `make validate-nav-templates` diffs their copy against
`src/global-nav/templates/global-nav.html` byte for byte, extracting every line from
`<template id=` to `</template>` at column 0 from both sides. That is why the copy in the fragment is
not indented. Change the package and re-copy rather than editing the copy.
`tests/taxpert-global-nav-templates.test.mjs` covers the detection and the fallback from this side.

## What the dev server cannot use

Fact Explorer takes the package as a linked (`file:`) dependency, and Vite treats such a package as
source rather than pre-bundling it, which costs around 50 dev-server requests. Handing it to Vite's
dependency optimizer does not work, for two independent reasons, both recorded in
`packages/fact-explorer/vite.config.js` so the change is not re-attempted:

- The elements locate their markup with `new URL('../templates/…', import.meta.url)` and rely on
  Vite's static rewrite of that form, which happens only for a file Vite processes as source.
  esbuild, which the optimizer runs, does not do it. The URL comes out as `.vite/deps/undefined`,
  every template fetch 404s, and the nav falls back to its degraded bar.
- Optimizing only part of the package splits the module graph in two, which reproduces the
  two-instance `config.js` bug described above.

The bundle is the shape that can work, because it inlines its templates and calls
`registerTemplates()`, so nothing depends on `import.meta.url` and there is one copy of everything.
It names its shared-seam modules as `../../shared/js/*.js`, which resolves in the tree
`make copy-shared-ui` lays out rather than in this one, so consuming it here would need that seam
resolved for this tree first.
