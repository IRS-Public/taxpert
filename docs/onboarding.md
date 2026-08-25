# Onboarding

This document is the hands-on guide to getting the Taxpert platform running on a clean machine. It
covers prerequisites, the Docker path, the native path component by component, the flags that change
what an application shows, the generated files you have to rebuild by hand, and the failure modes you
are most likely to hit. For how the pieces fit together, read [architecture.md](architecture.md)
instead.

**The Form Builder applications are not in this repository.** This repository holds the workspace UI, Fact
Explorer and the assistant. A Form Builder application lives in its own repository, and these tools
are pointed at a running one. The two used throughout this document, credit-assistant and
tax-withholding-estimator, come from the
[example applications repository](https://github.com/IRS-Public/form-builder-examples).

---

## 1. Prerequisites

The Docker path needs Docker Desktop, plus Ollama on the host if you want the AI features. The
native path needs the full toolchain.

| Tool | Version | Where the version comes from | Needed for |
|---|---|---|---|
| Docker Desktop | Any current release | Compose v2 syntax in `docker-compose.yml` | Docker path |
| JDK | 21 | `eclipse-temurin:21-jdk-jammy` in the application Dockerfiles, `java-version: '21'` in the template's CI workflow | Native path, Scala builds |
| sbt | 1.11.4 | `project/build.properties` in every Scala project, `ARG SBT_VERSION=1.11.4` in the Dockerfiles | Native path, Scala builds |
| Node.js | 20 or newer | `node:20-alpine` in `packages/fact-explorer/Dockerfile`, `node-version: '22'` in the template's CI workflow | Native path, JS tooling |
| npm | Whatever ships with your Node | No pinned version in the repository | Native path |
| Python | 3.12 or newer | `requires-python = ">=3.12"` in `services/assistant/pyproject.toml` | Native path, the assistant |
| uv | Any current release | `services/assistant/Makefile` uses `uv sync` and `uv run` throughout | Native path, the assistant |
| Ollama | Any current release | Reached on port 11434 by both paths | The AI features, both paths |
| cookiecutter | Any current release | `form-builder-template` is a standard cookiecutter | Generating a new application |
| xmllint | From libxml2 | An application's `make validate-xml` and `make format` call it | Native path, an application's checks |


### Ollama [optional]


Two models cover the defaults in `.env.example`:

```bash
ollama serve                   # keep this running
ollama pull llama3.1:8b        # the LLM_MODEL default, about 4.7 GB
ollama pull nomic-embed-text   # the EMBEDDING_MODEL default, about 274 MB
```

Ollama runs natively on the host in both paths, never in a container. A Linux container Ollama on
macOS runs CPU only and is slow, so the containers reach the host process instead. The assistant
service sets `OLLAMA_HOST: http://host.docker.internal:11434` and declares
`extra_hosts: ["host.docker.internal:host-gateway"]`, which makes that address resolve on Linux as
well as on macOS.

`nomic-embed-text` is required even if you point `LLM_MODEL` at a hosted provider such as
`anthropic/claude-sonnet-4-6`. The indexer and the retriever call the `ollama` Python client
directly rather than going through LiteLLM, so embeddings always come from a local Ollama. To use a
hosted model, set `LLM_MODEL` to a LiteLLM model string and set the matching API key.


---

## 2. Quickstart

The easiest way to run everything is through Docker. This assumes you already have a Form Builder app running.
The application runs natively from its own repository, and the tools reach it over the network.

[`form-builder-template`](https://github.com/IRS-Public/form-builder-template) is a cookiecutter in
its own repository that generates a minimal Form Builder Application, which can include Taxpert OOTB.

```bash
cookiecutter gh:IRS-Public/form-builder-template     # or a path to a local checkout
cd <repo_name>
make bootstrap        # publish both libraries, install npm deps, vendor the assets
make dev or make up              # http://localhost:<dev_port>/app/<url_segment>/
```


Within this repository:

```bash
make up            # Fact Explorer + assistant + ChromaDB
```

Every service is behind a profile, so a bare `docker compose up` starts nothing. `make up` runs both
profiles. To narrow it:

```bash
docker compose --profile explorer up                # Fact Explorer
docker compose --profile ai up                      # assistant + ChromaDB
docker compose --profile explorer --profile ai up   # everything
```

### Pointing Taxpert at a Form Builder application

Every service that reads an application reads it from one directory holding one application
checkout per subdirectory, each with a `fact-explorer.app.json` at its root. That is `./apps` by
default, or `TAXPERT_APPS_DIR` if it is different. The example applications repository is
already shaped that way, so cloning it and naming it works with no symlinks.

```bash
git clone https://github.com/IRS-Public/form-builder-examples ../form-builder-examples

cp .env.example .env
echo 'TAXPERT_APPS_DIR=../form-builder-examples' >> .env
```

`.env` is optional. Every variable in `.env.example` has a working default in `docker-compose.yml`
or in the service code. Copy it when you want to change the model, supply a provider API key, or
move the apps directory. See [`../apps/README.md`](../apps/README.md) for the symlink alternative
and the discovery rules.


### Start the application

Every library the application needs comes from a local checkout. `gov.irs::factgraph` and
`gov.irs::form-builder` are published into `~/.ivy2/local`. If you don't want to run everything in Docker:

```bash
cd ../form-builder-examples/credit-assistant
make bootstrap                     # publish the Scala libraries, install npm dependencies
make dev                           # http://localhost:3003/app/eitc/
```

`make bootstrap` is the one-time setup. Details, and what to do when you are not using the example
repository's sibling layout, are in [section 3](#3-running-natively-component-by-component).

### What is running

| URL | Service | Host port | Profile | Notes |
|---|---|---|---|---|
| http://localhost:5180 | fact-explorer | 5180 (container 80) | `explorer` | Rebuilds its app registry from the descriptors mounted at `/apps` on every start, so one image serves whichever applications you point it at. Each application is at `/fact-explorer/<app id>`. |
| http://localhost:8000/health | assistant | 8000 | `ai` | Returns `{"status":"ok"}` while the process is up. Reads your application's fact dictionary over HTTP, so set `TAXPERT_APP_HOST` if it is not on `localhost:3003/app/eitc`. |
| http://localhost:8001 | chromadb | 8001 (container 8000) | `ai` | Vector store for document retrieval. Pinned to `chromadb/chroma:1.5.9` to match the Python client in `uv.lock`. |
| http://localhost:11434 | Ollama | 11434 | n/a | Native on the host, never in this stack. |
| http://localhost:3003/app/eitc/ | credit-assistant | 3003 | n/a | Not in this stack. `make dev` in the application's own repository. |
| http://localhost:3000/app/tax-withholding-estimator/ | tax-withholding-estimator | 3000 | n/a | The same, for the second example application. |

### Environment variables

All are optional, and all belong in the `.env` at this repository's root.

| Variable | Default | What it does |
|---|---|---|
| `TAXPERT_APPS_DIR` | `./apps` | Host directory holding the application checkouts, mounted read-only at `/apps`. |
| `TAXPERT_APP_HOST` | `http://host.docker.internal:3003/app/eitc` | How a container reaches your running application, base path included. |
| `TAXPERT_FRONTEND_ORIGIN` | `http://localhost:3003,http://localhost:5180` | Comma-separated CORS allow-list for the assistant. |
| `LLM_MODEL` | `ollama/llama3.1:8b` | LiteLLM model string. The prefix selects the provider. |
| `SCENARIO_LLM_MODEL` | falls back to `LLM_MODEL` | Optional stronger model for `POST /scenario/generate`. |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model for the document index. |
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | Where the assistant finds Ollama. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | unset | Required only when `LLM_MODEL` names a hosted provider. |
| `TAXPERT_SCENARIOS_DIR`, `TAXPERT_FLOW_DIR` | Credit Assistant's paths under `/apps` | Development overlay only. Which application's scenarios and flow XML the scenario generator reads. |

### Root Makefile targets

Every target passes `$(PROFILES)`, which defaults to `--profile explorer --profile ai`. Narrow it
with `make up PROFILES=--profile explorer`.

| Target | What it runs | When to use it |
|---|---|---|
| `make up` | `docker compose $(PROFILES) up --build` | Normal start, rebuilds changed images |
| `make down` | `docker compose $(PROFILES) down` | Stop and remove the containers |
| `make logs` | `docker compose $(PROFILES) logs -f` | Tail every service at once |
| `make ps` | `docker compose $(PROFILES) ps` | Check which services are up |
| `make build` | `docker compose $(PROFILES) build` | Build images without starting them |
| `make rebuild` | `down -v`, then `build --no-cache`, then `up` | Drop the named volume and start from scratch |
| `make tidy` | Per sub-project format and lint, skipping any sub-project with a clean working tree | Before committing |

`make rebuild` drops the `chroma-data` volume, which a plain `down` and `up` preserves. The document
index therefore has to be repopulated afterwards, which the assistant's entrypoint does on the next
start when it finds the collection empty.

### Hot reloading

`docker-compose.override.yml` is merged automatically by Compose and adds live-reload variants. To
ignore it, name the base file explicitly.

```bash
docker compose --profile explorer --profile ai up --build            # development, hot reload
docker compose -f docker-compose.yml --profile explorer up --build   # production-like, no reload
```

| Service | Behavior when you edit source on the host |
|---|---|
| assistant | uvicorn `--reload`, restarts on save. `src/` is bind-mounted and the project is installed editable by uv. |
| fact-explorer | The image's `build` stage runs `vite` instead of nginx, so edits hot module reload. `packages/ui` is bind-mounted too, so workspace UI edits are live, and `npm run make-fgm` runs on every start. |
| An application | Nothing here watches one. The apps directory is mounted read-only. Run the application's own `make dev` in its own repository. |

macOS bind mounts do not emit filesystem events, so each watcher runs in polling mode
(`WATCHFILES_FORCE_POLLING` for uvicorn, `VITE_USE_POLLING` for Vite).

Fact Explorer's dev proxy reaches an application at `host.docker.internal:<its devPort>`, which is
how a container talks to an application running natively on the host. `VITE_APP_ORIGIN_<ID>`
retargets one application, at a compose service name for instance, if you do run it on this network.

---

## 3. Running natively, component by component

The Docker stack is the fastest way to see everything at once. For development, run the component
you are changing natively.

From the repository root, `npm test`, `npm run lint` and `npm run format` fan out across
`packages/*` with `--if-present`. They do not reach `services/assistant`, which is Python. Run a
single workspace with `--workspace`:

```bash
npm test --workspace packages/ui
npm run build-registry --workspace packages/fact-explorer
```

### An application

Run these from the application's directory in
[its own repository](https://github.com/IRS-Public/form-builder-examples).

```bash
cd ../form-builder-examples/credit-assistant
make bootstrap && make dev
```

`make bootstrap` publishes both Scala libraries, runs both `npm install` steps, and vendors the
assets. Use it once on a fresh clone.

| Command | What it does |
|---|---|
| `make ci-setup` | Install npm tooling and the `taxpert` dependency |
| `make dev` | Vendor assets, then `sbt ~run --serve --auditMode --allScreens --scenarioMode` |
| `make dev-ai` | The same, plus `--aiScenarioGeneration --aiFactExplanation` |
| `make dev-one-question` | The same as `dev`, plus `--singleQuestionPerScreen` |
| `make dev-author` | The same as `dev`, plus `--authorMode` on port 3004 |
| `make debug` | The same as `dev`, with a JVM debug port on 5005 |
| `make credit-assistant` | Production build to `./out`, no flags, no server |
| `make site` | Alias for the production build, under the name every application uses |
| `make test` | ScalaTest plus `scalafmtCheckAll` |
| `make ci` | Build, shared UI drift check, XML, HTML, template, JS, and Scala validation |
| `make diff-out` | Build `main` in a throwaway worktree and diff the two output trees |

`make ci-setup` is what you run when you are not running `bootstrap`, and it is not optional. It
runs `npm install` at the application root, which installs the `taxpert` package as a `file:`
dependency on `../taxpert/packages/ui`, and `make copy-shared-ui` mirrors `node_modules/taxpert/src`
into the application's vendor directory. Without a taxpert checkout at that path `npm install`
fails, and without `ci-setup`, `copy-shared-ui` has nothing to copy.

To install the workspace UI from a checkout kept somewhere else, this repository for instance while
you are working on it, name that one and leave `package.json` alone. An edit here then reaches the
application on its next `copy-shared-ui`.

```bash
make ci-setup TAXPERT_UI=/path/to/taxpert/packages/ui   # delegates to make link-taxpert
```

### taxpert, the workspace UI

```bash
cd packages/ui && npm install
npm test && npm run lint     # node --test, then eslint. npm run format is eslint --fix
```

After changing anything here, mirror it into every application you maintain with
`make copy-shared-ui` in each.

### fact-explorer

React and Vite single-page application on port 5180.

```bash
cd packages/fact-explorer
npm install               # postinstall vendors the USWDS assets
npm run build-registry    # scan the apps directory into public/data/apps.json
npm run dev               # http://localhost:5180
```

`npm run build-registry` has to run at least once on a fresh checkout. `public/data/apps.json` is
generated and gitignored, and loading the registry is the first thing the application does.

Both the registry build and the dev proxy read the apps directory: `<repo root>/apps`, or
`FORM_BUILDER_APPS_DIR` if your checkouts live elsewhere. With no application there,
`build-registry` fails naming the directory it scanned, and the dev server warns and falls back to
the mock fixture.


### assistant

FastAPI backend on port 8000. All commands run from `services/assistant/`.

```bash
cd services/assistant
make install                   # uv sync --extra dev
cp .env.example .env
make chroma                    # terminal 1, ChromaDB on :8001
make index                     # terminal 2, build the RAG index
make dev                       # terminal 2, uvicorn on :8000 with reload
```

Its `.env.example` defaults assume everything is native: Ollama on `localhost:11434`, ChromaDB on
`localhost:8001`, and the fact dictionary at `http://localhost:3003/app/eitc/resources/fact-dictionary.xml`.

`make chroma` persists to `./data/chroma`. `make index` embeds `data/html/*.html`. The PDF branch of
the indexer is complete but commented out, so `data/irs_publications/*.pdf` is not indexed until
someone uncomments it (see [AI integration](internals/ai-integration.md#23-retrieval-rag)). The
remaining targets are `make test` (pytest), `make lint` (`black --check`), `make format` (black),
`make check-format` (`pre-commit run --all-files`), `make install-hooks`, and `make clean`.

Start an application before `make dev`. The service fetches the fact dictionary over HTTP at
startup from `FACT_DICTIONARY_URL`. Scenario generation additionally reads that application's
`scenarios/` and `flow/` from disk through `SCENARIOS_DIR` and `FLOW_DIR`, which default to a
checkout under `apps/`.

---

## 4. Enabling and disabling features

Build flags are passed to `sbt run` and are included into the generated
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
| `--authorMode` | Generates the `/author/` page and starts the Author Mode API on `-Dsmol.author.port` (default 3004), which patches source XML on disk and re-runs generation in process | `dev-author` | Not offered |
| `--aiScenarioGeneration` | Sets `ai-scenario-generation-default="true"` on the audit panel, revealing the "Generate a scenario" section of the Scenario modal | `dev-ai` | Not offered |
| `--aiFactExplanation` | Sets `ai-fact-explanation-default="true"` on the audit panel, revealing the Explain and Analyze chat section | `dev-ai` | Not offered |
| `--formBuilderGraph` | Emits `resources/form-builder-graph.json`, the Form Graph Model that Fact Explorer reads | `make fact-explorer` | `make fact-explorer` |

### Runtime feature flags

`packages/ui/src/audit-panel/js/feature-flags.js` holds the machinery, and
[internals/workspace-configuration.md](internals/workspace-configuration.md) documents it.

- Which flags exist is the host's decision, declared as `config.featureFlags` in the `configure()`
  call. credit-assistant declares `aiScenarioGeneration` and `aiFactExplanation`, and Fact Explorer
  declares the same two.
- The effective value is the `localStorage` override if one exists, otherwise the build-time default
  carried on the `<taxpert-audit-panel>` element as a `<kebab-name>-default` attribute. Overrides are
  stored under `<storagePrefix>:featureFlags`.
- Toggle them in the **Workspace settings** modal, behind the settings gear in the global nav. That
  modal renders one row per declared flag, and also exposes the API base URL behind a disclosure so
  you can point the chat at a different backend.

---

## 5. Regenerating derived artifacts

Several directories and files are generated, gitignored, and stale until something regenerates them.

| Command | Where | Regenerates | Run it when |
|---|---|---|---|
| `make copy-fg` | An application | `website-static/vendor/fact-graph/factgraph-3.1.0.js` from `../fact-graph/js/target/scala-3.3.6/factgraph-fastopt/main.mjs` | After `sbt fastOptJS` in `fact-graph`. Runs automatically before every dev and production target, and is skipped with a message when the sibling has no build |
| `make copy-shared-ui` | An application | `website-static/vendor/taxpert/` from `node_modules/taxpert/src` | After any change under `packages/ui/src/`. Also runs automatically before every dev and production target |
| `make check-shared-ui` | An application | Nothing, it diffs the mirror against the source and fails on drift | Part of `make ci`. Catches a hand-edited mirror or a build that skipped the copy |
| `npm run build-registry` | `packages/fact-explorer` | `public/data/apps.json` from every `fact-explorer.app.json` one level down in the apps directory | On a fresh checkout, and after adding or editing an application descriptor |
| `npm run make-fgm` | `packages/fact-explorer` | `public/data/<app>/form-builder-graph.json` and each scenario index, from the application source trees | On a fresh checkout when using `VITE_FGM_SOURCE=real`, and after editing flow or fact XML. Add `-- --app <id>` for one application |
| `make index` | `services/assistant` | The `irs_publications` ChromaDB collection | Once, and after adding documents to `services/assistant/data/`. The Docker entrypoint runs it automatically when the collection is empty |

Never hand-edit anything under a `website-static/vendor/` directory. Those are generated mirrors,
overwritten on the next build, invisible to git, and caught by `make check-shared-ui`.

---
## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| sbt reports an unresolved dependency for `gov.irs#form-builder_3` | Form Builder is on no remote, your local Ivy cache is empty | Clone it and run `sbt publishLocal` |
| sbt reports an unresolved dependency for `gov.irs#factgraph_3` | Fact Graph is on no remote, your local Ivy cache is empty | Clone it and run `make publish` |
| `make dev` fails inside `copy-shared-ui` with a missing `node_modules/taxpert/src` | `make ci-setup` never ran, so the `file:` dependency was never installed | `make ci-setup` in that application |
| `make ci` fails with "vendored shared UI is out of date" | The mirror drifted, usually from a hand-edit or a build that skipped the copy | `make copy-shared-ui`, and make the real change in `packages/ui/src/` |
| The workspace shows stale UI after editing `packages/ui/` | The vendored mirror was not regenerated | `make copy-shared-ui` in each application |
| A scaffold change has no effect in any application | `form-builder` was not republished | `cd form-builder && sbt test publishLocal`, then restart the application |
| The chat or scenario generator returns an error | The assistant is unreachable, or Ollama is not running | `curl http://localhost:8000/health`, then confirm `ollama serve` is up on 11434 |
| The assistant container logs "indexing failed" and answers without citations | The embedding model is not pulled in the host Ollama | `ollama pull nomic-embed-text`, then restart the assistant service |
| Chat answers ignore the IRS publications entirely | The ChromaDB collection is empty because `make index` never ran | Run `make index` in `services/assistant/`, with Chroma and Ollama both up |
| Edits do not trigger a rebuild in Docker on macOS | Bind mounts emit no filesystem events | Already handled by `WATCHFILES_FORCE_POLLING` and `VITE_USE_POLLING` in the overlay. If you added a service, set the equivalent |
| An edit to `form-builder/` or `fact-graph/` does nothing in the Docker stack | sbt resolves both from `/root/.ivy2` inside the image, which is outside the bind mount | `make build`, or `make rebuild` for a clean start |
| `docker compose up` fails to bind a port | Something else holds 3000, 3003, 5180, 8000, or 8001 | Stop the conflicting process, or run the affected component natively on another port |
| A native dev server prints "Server already running" | A previous `sbt ~run` cycle still holds the port | The message is informational, the existing server keeps serving. Stop the old sbt session to reclaim the port |
| A "from scratch" Docker rebuild still shows old output | Named volumes survive `down` and `up` | `make rebuild`, which runs `docker compose down -v` first |
| Fact Explorer shows "Cannot load the app registry" | `public/data/apps.json` is generated and gitignored | `npm run build-registry` |
| Fact Explorer renders the mock fixture instead of a real application | `VITE_FGM_SOURCE` defaults to `mock` | Set `VITE_FGM_SOURCE=real` in `.env.local` and run `npm run make-fgm` |
| Fact Explorer's application list is empty in Docker | A symlink in `./apps` points outside the mounted directory, so it dangles in the container | Use `TAXPERT_APPS_DIR` to name the real parent directory instead of symlinking |
