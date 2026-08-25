# apps/

A mount point for the Form Builder applications this repository's tools read. Nothing here is an
application. Fact Explorer and the assistant both need to be told where to
find one, and this directory is the default answer. Clone or symlink each application repository
into it so that every application's `fact-explorer.app.json` sits exactly one level down.

```
apps/
  credit-assistant/fact-explorer.app.json
  tax-withholding-estimator/fact-explorer.app.json
  benefits-enrollment/fact-explorer.app.json
  ...
  ...
  ...
```

```bash
ln -s ~/code/my-app apps/my-app       
```

Everything in here except this README is gitignored (`/apps/*` with a `!/apps/README.md` exception),
because these are other people's repositories.

## Pointing somewhere else

If you already keep your application checkouts in one directory, name it instead of copying anything
in. Two variables do this, one per consumer.

| Consumer | Variable | Notes |
|---|---|---|
| `docker compose`, `make up` | `TAXPERT_APPS_DIR` | Host path, bind-mounted read-only at `/apps`. Defaults to `./apps`. |
| `npm run build-registry`, `npm run make-fgm`, `npm run dev` in `packages/fact-explorer` | `FORM_BUILDER_APPS_DIR` | Absolute or relative path. Defaults to `<repo root>/apps`. |

```bash
TAXPERT_APPS_DIR=~/code docker compose --profile explorer up
FORM_BUILDER_APPS_DIR=~/code npm run build-registry --workspace packages/fact-explorer
```

The [example applications repository](https://github.com/IRS-Public/form-builder-examples) is already
shaped like this directory: its applications are its immediate subdirectories, each with a
descriptor at its root. Cloning it anywhere and setting `TAXPERT_APPS_DIR` to point at it works with
no symlinks at all.

`build-registry.mjs`, `make-static-fgm.mjs` and `vite.config.js` all resolve the directory through
one exported `appsDir()` function, so the dev server, the graph generator and the registry cannot
disagree about where the applications are.

## Discovery

Discovery reads one level down and looks for `fact-explorer.app.json`. Both real directories and
symlinks to directories are accepted, so `ln -s` is a valid alternative to cloning for the native
path. A symlink whose target lies outside the mounted directory will dangle inside a container, so
prefer `TAXPERT_APPS_DIR` when you are running the Docker stack.

With no applications found, the failure is explicit. `build-registry` throws and names the directory
it scanned, and Fact Explorer's dev server logs that its proxy table is empty and falls back to the
hand-authored mock fixture.

An optional `form-builder-apps.json` in the apps directory overrides ordering and which application
is the default. It is never required.

```json
{ "defaultAppId": "credit-assistant", "order": ["credit-assistant", "twe", "benefits-enrollment"] }
```

## What an application has to declare

A `fact-explorer.app.json` at its repository root, which `cookiecutter form-builder-template` generates.
The fields it carries are the application's identity (`id`, `label`, `appId`, `basePath`,
`storagePrefix`, `devPort`, `resourceRoot`, `taxYear`), the `engine` block naming its Fact Graph
bundle and fact dictionary, a `capabilities` block, and optional `scenarios`, `customFlowTags` and
`pagePrefixes` entries. They are documented in
[`../packages/fact-explorer/README.md`](../packages/fact-explorer/README.md).
