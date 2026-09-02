# Asset delivery

How a generated page and its subresources reach the browser. Everything here is the same in all
four applications, differing only in the application's own base path and resource directory name.
A change to one belongs in all four.

Three pieces make it up: the nginx configuration that serves the built site, the vendored Taxpert
bundle the workspace loads, and the two `make` validators that keep the vendored copies honest.

## nginx

`<app>/nginx.conf` serves the generator's `./out` directory as the web root. Each flow route is its
own directory with an `index.html`, so there is no single-page fallback to configure.

| Directive | Setting | Why |
|---|---|---|
| `gzip` | `on` | One navigation pulls roughly 10 MB of engine, fact dictionary and flow manifest. It is all text and compresses about 9x. The stock nginx image sets no gzip directive at all, so the default of off stands and every byte goes out raw. |
| `gzip_types` | JS, JSON, XML, CSS, SVG | `text/html` is compressed whenever gzip is on and must not be listed here. Naming it is a duplicate, and nginx warns about it at startup. |
| `gzip_min_length` | `1024` | Below that the compressed form is not reliably smaller. |
| `gzip_comp_level` | `6` | The usual size and CPU balance. |

Two `location` blocks set    `Cache-Control`. Without them the browser has only `ETag` and
`Last-Modified` to go on and revalidates every subresource on every navigation, roughly 131
conditional requests per page that all answer 304.

| Location | Header | Contents |
|---|---|---|
| `^~ .../resources/vendor/` | `public, max-age=31536000, immutable` | The engine bundle, the USWDS mirror and the vendored Taxpert tree. Generated content that changes only when the image is rebuilt. |
| `~* \.html$` | `no-cache` | The generated pages, which are the thing being iterated on. |

The vendor block uses `^~` rather than a plain prefix so it wins outright over the `.html` regex.
The workspace clones its markup from vendored `*.html` templates, and those are vendor assets rather
than pages under edit.

A directory request reaches the `.html` block as well. `index` internally redirects a directory URL
to its `index.html`, and an internal redirect re-runs location matching.

## The Taxpert bundle

These applications have no bundler, and the Taxpert package ships raw ESM. Loading it as shipped
means 52 modules down five levels of import waterfall plus 9 template fetches, around 81 requests on
one page, each level serial behind the one above it. CSS `@import` has the same shape: a nested
sheet is discovered only after the sheet importing it has parsed, so each level is another serial
round trip of render-blocking work.

Taxpert therefore also publishes a built artifact, one JS file and three flattened stylesheets, with
all fourteen of its template files inlined so none of them is fetched either. The applications load
that. `vendor/taxpert/` beside it is still the same raw-ESM mirror it always was, and Fact Explorer
still imports subpaths out of it, so the source remains the source of truth.

| Path | What it is |
|---|---|
| `vendor/taxpert/` | The mirror of the package's `src/`, vendored by `make copy-shared-ui` |
| `vendor/taxpert/dist/js/taxpert.js` | The bundle: global nav, audit panel, tool dock, screens toolbar, favicon override |
| `vendor/taxpert/dist/styles/taxpert.css` | The flattened stylesheet, imported by the application's `main.css` |
| `vendor/taxpert/dist/styles/audit-panel.css` | Kept separate, see below |
| `vendor/taxpert/dist/seam.json` | The modules the bundle deliberately leaves external |

The audit panel's stylesheet stays its own file because it sits behind a toggled
`<link id="audit-panel-styles" disabled>`. Its rules restructure the product page and must not apply
with the workspace off. The tool panels' stylesheet has no such problem, since every selector in it
is scoped to Taxpert's own custom elements and its `.ttd-`, `.ttp-` and `.ttm-` classes, so it loads
unconditionally through `main.css`.

### Modules that stay external

Two modules are not in the bundle and are still loaded by their own path:

| Module | Loaded by |
|---|---|
| `shared/js/config.js` | `templates/fragments/taxpert-config.html` |
| `shared/js/graph-adapter.js` | the application's own `website-static/js/taxpert/` module |

Both keep state in module scope. A second copy inside the bundle would mean the page configures one
instance while the elements read the other, with nothing thrown and no console line. The nav simply
comes up with no menu. `SHARED_SEAM` in `taxpert/packages/ui/scripts/build.mjs` is the list, and
`dist/seam.json` is that list as data, which is what `make validate-taxpert-seam` reads.

### The inlined nav templates

`templates/fragments/workspace-head.html` carries a verbatim copy of the five `<template>` elements
`<taxpert-global-nav>` clones its markup from.

Taxpert's `getTemplate()` resolves a hosted `<template id>` before it looks in its own fetched
registry, the same host-override seam `fragments/audit-panel.html` uses. With all five present the
bar renders synchronously on connect, so there is no window in which the header is empty. There
always was one before, because the render was queued behind a fetch that was itself queued behind
the flow runtime's 600 ms boot holding the main thread.

All five or none. The render throws on the first id it cannot resolve, and `tgn-tool` is the one
usually left out because it only renders when the configuration declares tools.

The copy replaced a `<link rel="preload" as="fetch">` for `global-nav.html`. The bundle now skips
that fetch outright when it finds all five ids (`navTemplatesHosted()` in
`vendor/taxpert/global-nav/js/templates.js`), so a preload would warm a file nothing reads and the
browser would say so in the console.

The blocks are copied without indentation, which is deliberate. `make validate-nav-templates`
extracts every line from `<template id=` to `</template>` at column 0 from both sides and diffs
them, so reindenting is a diff. Change the package and re-copy rather than editing the fragment.

## The two validators

Both run inside `make ci`.

| Target | Fails when |
|---|---|
| `make validate-nav-templates` | The inlined `<template>` blocks have drifted from Taxpert's `global-nav/templates/global-nav.html`. A template the package renames, or a sixth one it adds, otherwise becomes a bar that throws at render time in a browser on a page nobody was looking at. |
| `make validate-taxpert-seam` | An application file imports a vendored Taxpert module by path that the bundle already contains, which is the duplicate-instance bug described above. It reads the allowed list from `dist/seam.json`. |

`make check-shared-ui` covers the third case, the vendored mirror drifting from the package. It
diffs two trees now rather than one, since the mirror is both Taxpert's `src/` and the bundle built
from it.

The seam validator scans `templates/`, `website-static/js/` and `website-static/styles/` rather than
all of `website-static/`, because `vendor/` under it is the generated mirror whose files
legitimately import one another by path. It applies two filters rather than one: a load site is a
line carrying an `import`, `src=` or `href=` that also has the path immediately behind a quote, a
pipe or a slash. Prose that names a module reads as neither.

## Docker

| Piece | Detail |
|---|---|
| Dockerfile `taxpert-ui` stage | Builds the bundle in the image from the same `src/` tree the next stage vendors beside it, so an image can never ship a bundle and a source tree that disagree. It gets its own small Node stage because the sbt base has no npm, and the site stage installs npm only later, after the vendored copy would need it. |
| `npm install`, not `npm ci` | The package is a workspace member, so its own lockfile is not the one npm maintains and `ci` refuses it. |
| `taxpert-dist` named volume | The dev overlay bind-mounts Taxpert's `src/`, but `dist/` is a build artifact and is gitignored, so a bind mount of it would create an empty directory on a fresh clone and the workspace would 404 on its only script. The volume is seeded from the image instead. |
| The parent bind mount is not `:ro` | The `dist` volume nests inside it, and mounting a volume at a path requires creating that mountpoint directory first. With a read-only parent that create fails with "read-only file system" before the container starts. Nothing in the container writes into `vendor/taxpert` otherwise, since the watcher only runs `sbt ~run`. |

The trade-off of the named volume is real and worth stating: an edit to Taxpert's `src/` shows up
live in the vendored mirror but not in the bundle the page actually loads. Work on the package with
`make dev` natively, where `copy-shared-ui` rebuilds it. On the Docker stack it takes a
`make rebuild`.

`make copy-shared-ui` has to build the bundle before it can vendor it. A `file:` install of Taxpert
is a symlink to a checkout and carries `scripts/`, so the target builds it there. A tarball install
ships a prebuilt `dist/` and has no `scripts/` to run. Neither is a state an application can fix on
its own, so a third case fails loudly rather than vendoring a mirror whose every page would 404 on
one script tag.

## The Scala.js source map

The fact graph's source map is 4.6 MB and is not served from the image. The Dockerfile does not
`COPY` it in, and `.dockerignore` excludes `**/website-static/vendor/fact-graph/*.map` as the other
half of that. The map is gitignored rather than context-ignored, so without that line a developer's
`make copy-fg` copy rides in on `COPY . ./` and lands in the image anyway.

A native `make copy-fg` still places it beside the bundle, so a host build keeps source-mapped stack
traces. The image does not.
