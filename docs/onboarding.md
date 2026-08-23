# Onboarding

This document is the hands-on guide to getting the Taxpert platform running on a clean machine. It
covers prerequisites, the one-command Docker path, the native path component by component, the build
flags and runtime toggles that change what the applications show, the derived artifacts you have to
regenerate by hand, generating a new application from the cookiecutter, and the failure modes you
are most likely to hit. It is for an engineer about to make a change.

Two names sound the same. **Taxpert** (capitalized) is this repository and the platform around it.
The **`taxpert` package** is the optional npm workspace UI in `packages/ui/`, which draws the global
nav, the audit panel, and the tool panels over a running application.

**The applications are not here.** This repository holds the workspace UI, Fact Explorer and the
assistant; a Form Builder application lives in its own repository and these tools are pointed at it.
The two used throughout this document — credit-assistant and tax-withholding-estimator — are the
[example applications](https://github.com/IRS-Public/form-builder-example). Clone them (or your own app) into
`apps/`, or set `TAXPERT_APPS_DIR`; see [`apps/README.md`](../apps/README.md).

## Related documents

- [Architecture](./architecture.md), how the pieces fit together and where the extension seams are
- [Release status](./release-status.md), the component inventory and maturity of each piece
- [Why Taxpert](./why-taxpert.md), the rationale behind the project
- [AI integration](./ai-integration.md), what the LLM surfaces do today
- [Deployment](./deployment.md), shipping a build to a real environment
- [Root README](../README.md), the short orientation

---

## 1. Prerequisites

The Docker path needs only Docker Desktop, plus Ollama if you want the AI features. The native path
needs the full toolchain.

| Tool | Version | Where the version comes from | Needed for |
|---|---|---|---|
| Docker Desktop | Any current release | Compose v2 syntax in `docker-compose.yml` | Path 1 |
| JDK | 21 | `eclipse-temurin:21-jdk-jammy` in both application Dockerfiles, `java-version: '21'` in the cookiecutter CI workflow | Path 2, Scala builds |
| sbt | 1.11.4 | `project/build.properties` in all four Scala projects, `ARG SBT_VERSION=1.11.4` in the Dockerfiles | Path 2, Scala builds |
| Node.js | 20 or newer | `node:20-alpine` in `packages/fact-explorer/Dockerfile`, `node-version: '22'` in the cookiecutter CI workflow | Path 2, JS tooling |
| npm | Whatever ships with your Node | No pinned version in the repository | Path 2 |
| Python | 3.12 or newer | `requires-python = ">=3.12"` in `services/assistant/pyproject.toml` | Path 2, the `api` service |
| uv | Any current release | `services/assistant/Makefile` uses `uv sync` and `uv run` throughout | Path 2, the `api` service |
| Ollama | Any current release | Reached on port 11434 by both paths | The AI features, both paths |
| cookiecutter | Any current release | `form-builder-template/` is a standard cookiecutter | Generating a new application |
| xmllint | From libxml2 | `make validate-xml` and `make format` call it | Path 2, running an application's checks |

There is no `.tool-versions`, `.nvmrc`, or `engines` field anywhere in the repository, so nothing
enforces these versions locally. The numbers above are the ones the images and CI actually use.
Scala versions are pinned in `build.sbt` and you do not install them yourself: `fact-graph` builds
on Scala 3.3.6 and everything above it on Scala 3.7.2.

### Ollama models

Both paths reach the same native Ollama on the host. Two models cover the defaults in
`.env.example`:

```bash
ollama serve                   # keep this running
ollama pull llama3.1:8b        # the LLM_MODEL default, about 4.7 GB
ollama pull nomic-embed-text   # the EMBEDDING_MODEL default, about 274 MB
```

`nomic-embed-text` is required even if you point `LLM_MODEL` at a hosted provider such as
`anthropic/claude-sonnet-4-6`. The indexer and the retriever call the `ollama` Python client
directly rather than going through LiteLLM, so embeddings always come from a local Ollama.

---

## 2. Path 1: the whole stack with Docker

This is the fastest way to see the tooling at once. It builds Fact Explorer and the assistant, the
two services this repository owns. The applications are not built here: run one from its own
repository (or point the stack at an already-running one).

```bash
cp .env.example .env                                    # optional; every value has a default

# ./apps is scanned one level down, so link each app in rather than the repository holding them.
git clone https://github.com/IRS-Public/form-builder-example ../form-builder-example
ln -s ../../form-builder-example/credit-assistant apps/credit-assistant   # or your own app, or TAXPERT_APPS_DIR
make up
```

Every service is behind a profile, because none of them is an application: `make up` runs
`--profile explorer --profile ai`, and a bare `docker compose up` deliberately starts nothing.

### Root Makefile targets

Every target passes `$(PROFILES)`, which defaults to `--profile explorer --profile ai`. Narrow it
with `make up PROFILES=--profile explorer`.

| Target | What it runs | When to use it |
|---|---|---|
| `make up` | `docker compose $(PROFILES) up --build` | Normal start, rebuilds changed images |
| `make down` | `docker compose $(PROFILES) down` | Stop and remove the containers |
| `make logs` | `docker compose $(PROFILES) logs -f` | Tail every service at once |
| `make build` | `docker compose $(PROFILES) build` | Build images without starting them |
| `make rebuild` | `down -v`, then `build --no-cache`, then `up` | Drop the named volume and start from scratch |
| `make ps` | `docker compose $(PROFILES) ps` | Check which services are up |
| `make tidy` | Per sub-project format and lint, skipping any sub-project with a clean working tree | Before committing |

`make rebuild` drops the named volume (`chroma-data`) as well as the images, because it survives a
plain `down` and `up`, and a stale document index would otherwise outlive a rebuild meant to be
clean.

### What becomes available

| URL | Service | Notes |
|---|---|---|
| http://localhost:5180 | fact-explorer | `--profile explorer`. Serves whichever apps are under the mounted apps directory, at `/fact-explorer/<app id>` |
| http://localhost:8000/health | api | `--profile ai`. Returns `{"status":"ok"}` while the process is up |
| http://localhost:8001 | chromadb | `--profile ai`. Container port 8000, published on host 8001 |
| http://localhost:11434 | Ollama | Native on the host, never containerized |
| http://localhost:3003/app/eitc/ | credit-assistant | Not in this stack. `make dev` in the application's own repository |
| http://localhost:3000/app/tax-withholding-estimator/ | tax-withholding-estimator | The same, for the second application |

Ollama stays on the host on purpose. A Linux container Ollama on macOS runs CPU only and is slow, so
the containers reach the host process instead. The `api` service sets
`OLLAMA_HOST: http://host.docker.internal:11434` and declares
`extra_hosts: ["host.docker.internal:host-gateway"]`, which makes the same address resolve on Linux
as well as on macOS.

### Development overlay versus production-like

`docker-compose.override.yml` is merged automatically by Compose. To ignore it, name the base file
explicitly.

```bash
docker compose up --build                          # development, hot reload
docker compose -f docker-compose.yml up --build    # production-like, no reload
```

| Service | Behavior with the overlay applied |
|---|---|
| assistant | `uvicorn --reload`, restarts on save. `src/` is bind-mounted and the project is installed editable by uv |
| fact-explorer | The image's `build` stage runs `vite` instead of nginx, so edits hot module reload with no refresh. `packages/ui` is bind-mounted too, and `npm run make-fgm` runs on every start |
| An application | Nothing here watches one. The apps directory is mounted read-only, and the app is regenerated by its own `sbt ~run` in its own repository |

macOS bind mounts do not emit filesystem events, so every watcher is put into polling mode by the
overlay: `WATCHFILES_FORCE_POLLING: "true"` for uvicorn and `VITE_USE_POLLING: "true"` for Vite.

Fact Explorer's dev proxy reaches an application at `host.docker.internal:<its devPort>`, which is
how a container talks to an app running natively on the host. `VITE_APP_ORIGIN_<ID>` retargets one
app — at a compose service name, for instance, if you do run it on this network.

---

## 3. Path 2: running natively, component by component

### Getting the two Scala libraries

Neither lives in this repository any more, and both arrive the same way: clone the repository, then
publish it into your local Ivy cache. Neither is on Maven Central or any other remote, and neither
needs to be — `~/.ivy2/local` is ahead of any remote in sbt's resolver chain, so a local publish is
what an application resolves against, and no `resolvers` or `credentials` line appears in any
`build.sbt`.

```bash
git clone https://github.com/IRS-Public/fact-graph.git
cd fact-graph && make publish        # sbt compile fastOptJS publishLocal

git clone https://github.com/IRS-Public/form-builder.git
cd form-builder && sbt publishLocal
```

In Fact Graph, `make publish` is preferred over a bare `sbt publishLocal` on a first run, because it
also runs `fastOptJS`, which produces the browser bundle `make copy-fg` looks for. Form Builder has
no Makefile and no browser bundle, so sbt drives it directly; use `sbt test publishLocal` once you
are changing the scaffold rather than just consuming it.

Where the checkouts go is the application's business, because the application is what reaches for
them. The example applications expect all three — `fact-graph`, `form-builder` and `taxpert` — in
the root of their repository, beside `credit-assistant/` and `tax-withholding-estimator/`, and their
`make bootstrap` does both publishes and both `npm install`s from there:

```bash
cd ../form-builder-examples/credit-assistant && make bootstrap && make dev
```

`make ci-setup` is what you run when you are not running `bootstrap`, and it is not optional. It
runs `npm install` at the application root, which installs the `taxpert` package as a `file:` dependency on
`../taxpert/packages/ui`, and `make copy-shared-ui` mirrors `node_modules/taxpert/src` into the
application's vendor directory. Without a taxpert checkout at that path `npm install` fails, and
without `ci-setup`, `copy-shared-ui` has nothing to copy. To install the workspace UI from a
checkout kept somewhere else — this repository, while you are working on it — name that one
instead, and leave `package.json` alone:

```bash
make ci-setup TAXPERT_UI=/path/to/taxpert/packages/ui
```

### credit-assistant

The EITC application — in [the example applications' repository](https://github.com/IRS-Public/form-builder-example),
not this one; run these from its `credit-assistant/` directory. Serves `/app/eitc` on port 3003.

| Command | What it does |
|---|---|
| `make ci-setup` | Install npm tooling and the `taxpert` dependency |
| `make dev` | Vendor assets, then `sbt ~run --serve --auditMode --allScreens --scenarioMode` |
| `make dev-ai` | The same, plus `--aiScenarioGeneration --aiFactExplanation` |
| `make dev-one-question` | The same as `dev`, plus `--singleQuestionPerScreen` |
| `make dev-author` | The same as `dev`, plus `--authorMode` on port 3004 |
| `make debug` | The same as `dev`, with a JVM debug port on 5005 |
| `make credit-assistant` | Production build to `./out`, no flags, no server |
| `make test` | ScalaTest plus `scalafmtCheckAll` |
| `make ci` | Build, shared UI drift check, XML, HTML, template, JS, and Scala validation |

`make site` is an alias for the production build and `make help` prints the full list. Open
http://localhost:3003/app/eitc/, and override the port with `PORT=3010 make dev`.

### tax-withholding-estimator

The second application, which exercises every scaffold extension point. Same repository as
credit-assistant. Serves `/app/tax-withholding-estimator` on port 3000.

The target list is credit-assistant's minus the four extra dev variants. `make ci-setup` then
`make dev` runs `sbt ~run --serve --auditMode --allScreens`. `make debug` adds the JVM debug port,
`make twe` (aliased as `make site`) is the production build, `make test` runs ScalaTest plus
`scalafmtCheckAll`, and `make ci` runs the same checks as credit-assistant plus `validate-uswds`.

Open http://localhost:3000/app/tax-withholding-estimator/.

### taxpert, the workspace UI

Raw ES modules and CSS with no build step and no dev server of its own. You see changes by running
one of the applications or Fact Explorer against it.

```bash
cd packages/ui && npm install
npm test && npm run lint     # node --test, then eslint. npm run format is eslint --fix
```

After changing anything here, mirror it into every application you maintain with `make copy-shared-ui`
in each. More than one, because a single application cannot catch an assumption about itself.

### fact-explorer

React and Vite single-page application on port 5180.

```bash
cd packages/fact-explorer
npm install               # postinstall vendors the USWDS assets
npm run build-registry    # glob every fact-explorer.app.json under ../../apps into public/data/apps.json
npm run dev               # http://localhost:5180
```

Both the registry build and the dev proxy read the apps directory: `<repo root>/apps`, or
`FORM_BUILDER_APPS_DIR` if your checkouts live elsewhere. With no app there, `build-registry` fails
naming the directory it scanned, and the dev server warns and falls back to the mock fixture.

Every npm script has a Makefile equivalent of the same name: `make dev`, `make build`,
`make preview`, `make test` (vitest), `make lint` (eslint), `make format` (prettier),
`make build-registry`, and `make make-fgm` (add `APP=<id>` for a single application). `make check`
runs lint, format, format check, and tests together.

`npm run build-registry` has to run at least once on a fresh checkout. `public/data/apps.json` is
generated and gitignored, and loading the registry is the first thing the application does.

### api

FastAPI backend on port 8000. All commands run from `services/assistant/`.

```bash
cd services/assistant
make install                   # uv sync --extra dev
cp .env.example .env
make chroma                    # terminal 1, ChromaDB on :8001
make index                     # terminal 2, build the RAG index
make dev                       # terminal 2, uvicorn on :8000 with reload
```

`make chroma` persists to `./data/chroma`. `make index` embeds `data/irs_publications/*.pdf` and
`data/html/*.html`. The remaining targets are `make test` (pytest), `make lint` (`black --check`),
`make format` (black), `make check-format` (`pre-commit run --all-files`), `make install-hooks`, and
`make clean`.

Start an application before `make dev`. The service fetches the fact dictionary over HTTP at startup
from the URL in `FACT_DICTIONARY_URL`, which defaults to credit-assistant's dev server. Scenario
generation additionally reads that app's `scenarios/` and `flow/` from disk — `SCENARIOS_DIR` and
`FLOW_DIR`, which default to a checkout under `apps/`.

### fact-graph and form-builder

Both live in their own repositories now — see
[fact-graph](https://github.com/IRS-Public/fact-graph) and
[form-builder](https://github.com/IRS-Public/form-builder). Clone either one beside this repo if you want
to work on it.

In fact-graph, `make publish` runs `sbt compile fastOptJS publishLocal`, and `make dev` republishes
on every edit. After a rebuild, run `make copy-fg` in each application to pick up the new browser
bundle.

Form Builder has no Makefile, so drive sbt directly — `sbt test publishLocal`. Republishing is what
makes a scaffold change visible: editing a stylesheet under
`form-builder/src/main/resources/form-builder/website-static/` during an `sbt ~run` session in an
application will not show up until you republish and restart, because the generator extracts those
assets from the jar.

---

## 4. Enabling and disabling features

Two layers decide what you see. Build flags are passed to `sbt run` and are baked into the generated
site. Runtime feature flags live in `localStorage` and are toggled from the Workspace settings modal
without a rebuild.

### Build flags

Every flag is declared in `form-builder/src/main/scala/gov/irs/formbuilder/build/Flags.scala`.

| Flag | What it does | credit-assistant | tax-withholding-estimator |
|---|---|---|---|
| `--serve` | Starts the embedded `smol` static server on `-Dsmol.port` (default from `FormBuilderApp`) | `dev`, `dev-ai`, `dev-one-question`, `debug`, `dev-author` | `dev`, `debug` |
| `--auditMode` | Renders the workspace: `body.audit-mode`, the global nav, the screens toolbar, the audit panel element, and the tool dock | Every dev target, and the Docker image | `dev`, `debug`, and the Docker image |
| `--allScreens` | Generates the `/all-screens/` page in every locale, which is Browse All and Path Mode | Every dev target, and the Docker image | `dev`, `debug`, and the Docker image |
| `--scenarioMode` | Reads `resources/scenarios/*.json` and lists them in the Scenario modal | `dev`, `dev-ai`, `dev-one-question`, `debug`, `dev-author`, and the Docker image | Not used, the application has no scenarios |
| `--singleQuestionPerScreen` | Splits multi-question pages into one question each and emits a flow manifest the navigation uses to skip pages whose gate is false | `dev-one-question` | Not offered |
| `--authorMode` | Generates the `/author/` page and starts the Author Mode API on `-Dsmol.author.port` (default 3004), which patches source XML on disk and re-runs generation in process | `dev-author`, and the Docker dev overlay watcher | Not offered |
| `--aiScenarioGeneration` | Sets `ai-scenario-generation-default="true"` on the audit panel, revealing the "Generate a scenario" section of the Scenario modal | `dev-ai` | Not offered |
| `--aiFactExplanation` | Sets `ai-fact-explanation-default="true"` on the audit panel, revealing the Explain and Analyze chat section | `dev-ai` | Not offered |
| `--formBuilderGraph` | Emits `resources/form-builder-graph.json`, the Form Graph Model that Fact Explorer reads | `make fact-explorer` | `make fact-explorer` |

A production build passes no flags at all. `make credit-assistant` and `make twe` run a bare
`sbt run`, which produces the questionnaire and nothing else. The Docker images bake in their flags
at build time, so changing them means rebuilding the image.

Two notes on the AI flags:

- The Explain and Analyze chat that `--aiFactExplanation` reveals is a tab in the audit panel's
  legacy rail. That rail is hidden unless a host declares the `legacyAuditPanel` runtime flag, and
  neither application in this repository declares it, so the chat is currently not reachable from
  either application. Fact Explorer has its own chat panel gated by `VITE_AI_FACT_EXPLANATION` in
  `fact-explorer/.env`, and that one works.
- Both AI flags need the `api` service reachable at the configured `apiBase`, which defaults to
  `http://localhost:8000`. Without it the chat and the scenario generator return an error rather
  than degrading quietly. Nothing else in either application depends on the backend.

### Runtime feature flags

`packages/ui/src/audit-panel/js/feature-flags.js` holds the machinery. The effective value of a flag is
the `localStorage` override if one exists, otherwise the build-time default carried on the
`<taxpert-audit-panel>` element as a `<kebab-name>-default` attribute.

- Which flags exist is the host's decision, declared as `config.featureFlags` in the `configure()`
  call. credit-assistant declares `aiScenarioGeneration` and `aiFactExplanation` in
  `templates/fragments/taxpert-config.html`. Fact Explorer declares the same two in
  `src/config/taxpertHost.js`.
- Overrides are stored under `<storagePrefix>:featureFlags`, which resolves to `taxpert:featureFlags`
  for both hosts today.
- Toggle them in the **Workspace settings** modal, behind the settings gear in the global nav. That
  modal renders one row per declared flag, and also exposes the API base URL behind a disclosure so
  you can point the chat at a different backend.
- Anything gated by a flag carries `data-ff="<kebab name>"` in the markup and is revealed by a
  matching `ff-<kebab name>` class on `<body>`.
- Setting a flag dispatches `taxpert:feature-flags-changed` on `document`, so a consumer holding its
  own state (Fact Explorer's React hook) resyncs without polling.

### Toggling audit mode at runtime

`packages/ui/src/audit-panel/js/taxpert-audit-panel.js` assigns `window.enableAuditMode` and
`window.disableAuditMode` at module load. In an `--auditMode` build, the application's
`fragments/workspace-enable.html` calls `enable()` at the end of `<body>`, so the workspace is on
from the first paint and `disableAuditMode()` in the browser console turns it off.

TWE ADR-004 (`tax-withholding-estimator/docs/adr/004-internal-debugging-surfaces.md`, in the
applications repository) describes
these two console functions as the way audit mode is switched on in production. Read the current
code before relying on that. `fragments/head.html` and `page.html` gate the whole workspace slot on
`${flags.auditMode}`, so a build without the flag loads no `taxpert` module at all and neither
function is defined. Today the console toggle only works inside a build that already carries
`--auditMode`.

---

## 5. Regenerating derived artifacts

Several directories and files are generated, gitignored, and stale until something regenerates them.

| Command | Where | Regenerates | Run it when |
|---|---|---|---|
| `make copy-fg` | Either application | `website-static/vendor/fact-graph/factgraph-3.1.0.js` from `../fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs` | After `sbt fastOptJS` in `fact-graph`. Runs automatically before every dev and production target, and is skipped with a message when the sibling has no build |
| `make copy-shared-ui` | Either application | `website-static/vendor/taxpert/` from `node_modules/taxpert/src` | After any change under `packages/ui/src/`. Also runs automatically before every dev and production target |
| `make check-shared-ui` | Either application | Nothing, it diffs the mirror against the source and fails on drift | Part of `make ci`. Catches a hand-edited mirror or a build that skipped the copy |
| `npm run build-registry` | `fact-explorer` | `public/data/apps.json` from every `../*/fact-explorer.app.json` | On a fresh checkout, and after adding or editing an application descriptor |
| `npm run make-fgm` | `fact-explorer` | `public/data/<app>/form-builder-graph.json` and each scenario index, from the sibling source trees | On a fresh checkout when using `VITE_FGM_SOURCE=real`, and after editing flow or fact XML. Add `-- --app <id>` for one application |
| `make index` | `api` | The `irs_publications` ChromaDB collection | Once, and after adding documents to `services/assistant/data/`. The Docker entrypoint runs it automatically when the collection is empty |

Never hand-edit anything under a `website-static/vendor/` directory. Those are generated mirrors,
overwritten on the next build, invisible to git, and caught by `make check-shared-ui`.

---

## 6. Creating a new Form Builder app

`form-builder-template/` is a cookiecutter that emits the thin remainder of an application: flow,
facts, locales, brand CSS, `Main.scala`, and optionally Docker files and a Fact Explorer descriptor.

```bash
cookiecutter form-builder-template
```

Run it from the repository root or anywhere outside the template directory. Running it from inside
`form-builder-template/` would nest the new project inside the template, and the post-generation hook
detects that case and moves the project up one level instead.

### Prompts

`cookiecutter.json` asks for `project_name` (default `My Tax Tool`), then `repo_name`, `app_id`,
`url_segment`, `scala_package`, `brand`, and `storage_prefix`, each of which derives a sensible
default from the answers above it. `dev_port` defaults to `3010`. `form_builder_version` and
`factgraph_version` default to the two local snapshots. `fact_graph_path`, `form_builder_path`, and
`taxpert_path` default to `../fact-graph`, `../form-builder`, and `../taxpert`.

The three library paths are prompts, so a project generated outside this monorepo can point at
libraries anywhere on disk.

### The five toggles

`hooks/post_gen_project.py` deletes rather than conditionally renders, so the generated files read as
the files they will become.

| Toggle | Answering `no` removes |
|---|---|
| `include_all_screens` | `--allScreens` from every `sbt run` line, the `browse-all` and `path-mode` nav entries and destinations, `all-screens-bootstrap.js`, and `all-screens.css` |
| `include_scenario_mode` | `--scenarioMode` from every `sbt run` line, and the `scenarios/` resource directory |
| `include_taxpert_workspace` | `--auditMode`, the root `package.json` that declares the dependency, the `copy-shared-ui` and `check-shared-ui` targets, the workspace mount fragments, `taxpert-config.html`, `taxpert.config.json`, the vendored stylesheet imports, the Docker vendoring steps, and the CI checkout of the package. The generated application has no reference to `taxpert` anywhere |
| `include_fact_explorer` | `--formBuilderGraph`, `fact-explorer.app.json`, and the `fact-explorer` make target. This is independent of the workspace toggle, and `fact-explorer: yes` with `workspace: no` is a supported combination |
| `include_docker` | `Dockerfile`, `nginx.conf`, `.dockerignore`, both compose files, and the make targets that wrap them |

A flag name that is a prefix of another flag name would corrupt the Makefile, because the hook strips
a flag with a bare string replacement. `Flags.scala` carries a comment saying so, and none of the
current names collide.

### First run in the generated repository

```bash
cd <repo_name>
make bootstrap        # publish both libraries, install npm deps, vendor the assets
make dev              # http://localhost:<dev_port>/app/<url_segment>/
```

`make bootstrap` runs `make -C <fact_graph_path> publish`, `sbt publishLocal` in the form-builder
checkout, both `npm install` steps, and `copy-fg`, `copy-shared-ui`, and `copy-uswds`. The hook also
runs `git init` and stages every file, so the new project is a repository from the first moment.

If Docker files were generated, `make up` in the new repository builds the libraries, generates the
site, serves it, and leaves an `sbt ~run` watcher regenerating on every edit.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| sbt reports an unresolved dependency for `gov.irs#form-builder_3` | Form Builder is on no remote; your local Ivy cache is empty | Clone it and run `sbt publishLocal` |
| sbt reports an unresolved dependency for `gov.irs#factgraph_3` | Fact Graph is on no remote; your local Ivy cache is empty | Clone it and run `make publish` |
| `make dev` fails inside `copy-shared-ui` with a missing `node_modules/taxpert/src` | `make ci-setup` never ran, so the `file:` dependency was never installed | `make ci-setup` in that application |
| `make ci` fails with "vendored shared UI is out of date" | The mirror drifted, usually from a hand-edit or a build that skipped the copy | `make copy-shared-ui`, and make the real change in `packages/ui/src/` |
| The workspace shows stale UI after editing `packages/ui/` | The vendored mirror was not regenerated | `make copy-shared-ui` in each application |
| A scaffold change has no effect in either application | `form-builder` was not republished | `cd form-builder && sbt test publishLocal`, then restart the application |
| `docker compose` exits immediately complaining about `.env` | The `api` service declares `env_file: .env` | `cp .env.example .env` |
| The chat or scenario generator returns an error | `api` is unreachable, or Ollama is not running | `curl http://localhost:8000/health`, then confirm `ollama serve` is up on 11434 |
| The api container logs "indexing failed" and answers without citations | The embedding model is not pulled in the host Ollama | `ollama pull nomic-embed-text`, then restart the api service |
| Chat answers ignore the IRS publications entirely | The ChromaDB collection is empty because `make index` never ran | Run `make index` in `api/`, with Chroma and Ollama both up |
| Edits do not trigger a rebuild in Docker on macOS | Bind mounts emit no filesystem events | Already handled by `WATCHFILES_FORCE_POLLING` and `VITE_USE_POLLING` in the overlay. If you added a service, set the equivalent |
| An edit to `form-builder/` or `fact-graph/` does nothing in the Docker stack | sbt resolves both from `/root/.ivy2` inside the image, which is outside the bind mount | `make build`, or `make rebuild` for a clean start |
| `docker compose up` fails to bind a port | Something else holds 3000, 3003, 5180, 8000, or 8001 | Stop the conflicting process, or run the affected component natively on another port |
| A native dev server prints "Server already running" | A previous `sbt ~run` cycle still holds the port | The message is informational, the existing server keeps serving. Stop the old sbt session to reclaim the port |
| A "from scratch" Docker rebuild still shows old output | Named volumes survive `down` and `up` | `make rebuild`, which runs `docker compose down -v` first |
| Fact Explorer shows "Cannot load the app registry" | `public/data/apps.json` is generated and gitignored | `npm run build-registry` |
| Fact Explorer renders the mock fixture instead of a real application | `VITE_FGM_SOURCE` defaults to `mock` | Set `VITE_FGM_SOURCE=real` in `.env.local` and run `npm run make-fgm` |
