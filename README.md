# Taxpert

Taxpert is the workspace laid over a running [Form Builder](https://github.com/IRS-Public/form-builder)
application to make it understandable: a global nav, an audit panel, dockable tool panels that show
which facts produced the screen you are on, a graph view of the whole flow, and an LLM backend that
answers questions about the fact dictionary. This repository holds that tooling and nothing else.
No application is built here. Every part of it is optional, and an application runs the same whether
or not you attach any of it.

### Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

This codebase is dedicated to the public domain under the [Creative Commons Zero v1.0 Universal](LICENSE.md) license (CC0 1.0).

## Legal Disclaimer: Public Repository Access

> This repository contains draft and under-development source code. It is made available to the public solely for
> transparency, collaboration, and research purposes. The source code is meant to be run locally as team-facing
> internal tools for developing Fact Graph and Form-Builder applications, including but not limited to the AI/LLM
> components.
>
> **No Endorsement or Warranty**
>
> IRS does not endorse, maintain, or guarantee the accuracy, completeness, or functionality of the code in this repository. The IRS assumes no responsibility or liability for any use of the code by external parties, including individuals, developers, or organizations. This includes, but is not limited to, any tax consequences, computation errors, data loss, or other outcomes resulting from the use or modification of this code.
>
> Use of the code in this repository is at your own risk. This repository is not intended for production use or public consumption as a finalized product.

## Where this sits

Five repositories make up the platform. This one is the fourth row.

| Repository | What it is | How you consume it |
|---|---|---|
| [fact-graph](https://github.com/IRS-Public/fact-graph) | The rules engine. Declarative facts, derived and writable, with `Incomplete` propagation. Scala 3, cross-compiled so the same rules evaluate on the JVM during generation and in the browser at runtime. | `gov.irs::factgraph` |
| [form-builder](https://github.com/IRS-Public/form-builder) | The scaffold. Flow XML plus a Fact Dictionary become a multi-language static site. Ships the browser theme, the flow runtime and the Author Mode backend inside its jar. | `gov.irs::form-builder` |
| [form-builder-template](https://github.com/IRS-Public/form-builder-template) | Cookiecutter that emits a new Form Builder application. | `cookiecutter gh:IRS-Public/form-builder-template` |
| **taxpert** (this one) | The optional workspace UI and its companion services. | `taxpert`, as a `file:` dependency on a checkout, plus container images |
| [form-builder-examples](https://github.com/IRS-Public/form-builder-examples) | The reference applications: Credit Assistant (EITC), the Tax Withholding Estimator, and Benefits Enrollment. Demonstration code, kept out of this repository so nothing here depends on an application. | Clone it beside this one |

The dependency runs one way. Form Builder is required for an application to exist. Taxpert is
tooling laid over one, and neither package imports the other. The workspace reads the running flow
through runtime contracts, taking the fact graph off a known global and reading flow markup by CSS
selector. Form Builder's templates name no `vendor/taxpert/` path. Every workspace mount goes
through an app-owned HTML fragment (`workspace-head`, `workspace-enable`, `workspace-all-screens`,
`taxpert-config`) for which the scaffold ships an empty default, so an application generated with
`include_taxpert_workspace=no` has no reference to this package anywhere.

```
form-builder  ──►  application  ◄──  packages/ui        (optional, mounted by the app)
                        ▲
                        ├───────────  packages/fact-explorer   (reads the app's descriptor)
                        └───────────  services/assistant       (reads the app's fact dictionary)
```

## Layout

| Path | What it is |
|---|---|
| [`packages/ui/`](packages/ui/) | The `taxpert` npm package: the workspace UI. |
| [`packages/fact-explorer/`](packages/fact-explorer/) | React and Vite SPA that draws an application's flow and facts as a graph. |
| [`services/assistant/`](services/assistant/) | FastAPI backend behind the audit-panel chat. |
| [`apps/`](apps/) | Mount point. Clone or symlink the applications the tools should read into here, or point `TAXPERT_APPS_DIR` elsewhere. Empty except for its README. |
| [`docs/`](docs/) | Architecture, onboarding, deployment, release status, style guides. |
| `docker-compose.yml`, `docker-compose.override.yml` | The service stack and its development overlay. |
| `Makefile` | Thin wrapper over `docker compose`, plus `make tidy`. |

The repository root is a private npm workspace named `taxpert-workspace` covering `packages/*`.
`services/assistant` is Python and sits outside it, with its own `Makefile` and `pyproject.toml`.

## The three sub-projects

**[`packages/ui/`](packages/ui/README.md)** publishes the `taxpert` npm package. It holds the global
nav, the audit panel, the dockable tool panels (Inspect, Outcome tracker, Watchlist, Overrides), the
all-screens toolbar, and the Scenario, Display and Workspace settings modals. It ships as raw ES
modules and CSS with no build step, so a consumer with a bundler imports it by package name and a
consumer without one copies `src/` into a vendor directory and loads it with `<script type="module">`
and `@import`. Everything it knows about the host application arrives through one `configure()` call.

**[`packages/fact-explorer/`](packages/fact-explorer/README.md)** is a private React and Vite
single-page application, served on port 5180, that draws any Form Builder application's flow and
fact dictionary as an interactive graph with the live application embedded beside it. An
application announces itself by owning a `fact-explorer.app.json` at its repository root.
`npm run build-registry` globs every descriptor under the apps directory into a single registry, so
nothing has to be added to a list inside this repository. One instance serves every application you
point it at.

**[`services/assistant/`](services/assistant/README.md)** is a FastAPI service (Python 3.12, managed
with `uv`) that backs the audit panel's chat. It runs an LLM tool-calling loop through LiteLLM,
giving the model keyword search over the application's fact dictionary and cosine-similarity
retrieval over IRS publications indexed in ChromaDB. A second loop drafts Fact Graph scenarios from
a plain-language description. It reaches the model through Ollama on the host by default and can be
pointed at a hosted provider by changing `LLM_MODEL`.

## Capabilities are opt-in

Nothing in this repository starts by default. Each capability pairs a Form Builder build flag, which
makes the application emit what the tool reads, with a compose profile that runs the service.

| Capability | Build the app with | Run | Supplied by |
|---|---|---|---|
| Workspace UI | `--auditMode` | nothing to run | `packages/ui`, vendored by the app |
| Fact Explorer | `--formBuilderGraph` | `--profile explorer` | `packages/fact-explorer` |
| Chat and scenario generation | `--aiFactExplanation`, `--aiScenarioGeneration` | `--profile ai` | `services/assistant` and ChromaDB |
| Author Mode | `--authorMode` | nothing to run | form-builder's own `AuthoringServer`, in-process on `:3004` |

Author Mode's backend lives inside the application's own JVM, so this repository contributes only
the nav item. There is no service here for it.

## Requirements

| For | You need |
|---|---|
| The Docker stack | [Docker Desktop](https://www.docker.com/products/docker-desktop/) |
| The AI profile | [Ollama](https://ollama.com/) running natively on the host, or a hosted model plus its API key |
| Working on `packages/*` natively | Node 20 or newer |
| Working on `services/assistant` natively | Python 3.12 or newer and [uv](https://docs.astral.sh/uv/) |
| Building an application | JDK 17 or newer, sbt, and Node for its lint tooling (in the application's own repository) |

Ollama stays on the host rather than in a container because a Linux container Ollama on macOS runs
CPU only and is slow.

```bash
ollama serve                       # if not already running
ollama pull llama3.1:8b            # chat model
ollama pull nomic-embed-text       # embeddings for the document index
```

To use a hosted model instead, set `LLM_MODEL` in `.env` to a LiteLLM model string such as
`anthropic/claude-sonnet-4-6` and set the matching API key. You still need `nomic-embed-text` in a
local Ollama, because the document index is embedded locally either way.

## Quickstart

The services read a Form Builder application over the network and from disk, so you need one to
point them at. The example repository holds three, and each of its subdirectories carries a
`fact-explorer.app.json`, which makes the repository itself usable as the apps directory.

```bash
git clone https://github.com/IRS-Public/form-builder-examples ../form-builder-examples

cp .env.example .env
echo 'TAXPERT_APPS_DIR=../form-builder-examples' >> .env

make up            # Fact Explorer + assistant + ChromaDB
```

`.env` is optional. Every variable in `.env.example` has a working default in `docker-compose.yml`
or in the service code, and the defaults assume Credit Assistant running natively on
`localhost:3003/app/eitc`. Copy it when you want to change the model, supply a provider API key, or
move the apps directory.

`make up` runs both profiles. To narrow it:

```bash
docker compose --profile explorer up                # Fact Explorer
docker compose --profile ai up                      # assistant + ChromaDB
docker compose --profile explorer --profile ai up   # everything
```

The application itself runs from its own repository, natively. Every library it needs comes from a
local checkout: `gov.irs::factgraph` and `gov.irs::form-builder` are published into `~/.ivy2/local`,
which is first in sbt's default resolver chain, and `taxpert` is a `file:` npm dependency. The
example applications expect all three cloned into the root of that repository, beside
`credit-assistant/` and `tax-withholding-estimator/`, and `make bootstrap` is the target that
publishes them and installs the npm dependencies in one go.

```bash
cd ../form-builder-examples/credit-assistant
make bootstrap                     # publish the Scala libraries, install npm dependencies
make dev                           # http://localhost:3003/app/eitc/
```

`make bootstrap` runs the same `npm install` that `make ci-setup` does, which installs the
`taxpert` dependency that the application's `make copy-shared-ui` mirrors into its vendor
directory. The build fails without it.

That dependency is declared as `file:../taxpert/packages/ui`, so `npm install` needs a taxpert
checkout at that path. To point it at this one instead of a second clone, name it. An edit here
then reaches the application on its next `copy-shared-ui`:

```bash
make ci-setup TAXPERT_UI=../../taxpert/packages/ui
```

### What is running

| Service | Host port | Container port | Profile | Notes |
|---|---|---|---|---|
| fact-explorer | 5180 | 80 | `explorer` | Rebuilds its app registry from the descriptors mounted at `/apps` on every start, so one image serves whichever applications you point it at. |
| assistant | 8000 | 8000 | `ai` | Reads your application's fact dictionary over HTTP. Set `TAXPERT_APP_HOST` if it is not on `localhost:3003/app/eitc`. |
| chromadb | 8001 | 8000 | `ai` | Vector store for document retrieval. Pinned to `chromadb/chroma:1.5.9` to match the Python client in `uv.lock`. |
| Ollama | 11434 | n/a | n/a | Runs natively on the host, never in this stack. |
| Your application | its own, e.g. 3003 | n/a | n/a | Not in this stack. It runs from its own repository. |

Open [http://localhost:5180](http://localhost:5180) for Fact Explorer and
[http://localhost:8000/health](http://localhost:8000/health) for the assistant health check.

### Environment variables

Every one of these is optional. The table gives what the stack falls back to.

| Variable | Default | What it does |
|---|---|---|
| `TAXPERT_APPS_DIR` | `./apps` | Host directory holding the application checkouts, mounted read-only at `/apps`. See [`apps/README.md`](apps/README.md). |
| `TAXPERT_APP_HOST` | `http://host.docker.internal:3003/app/eitc` | How a container reaches your running application, base path included. |
| `TAXPERT_FRONTEND_ORIGIN` | `http://localhost:3003,http://localhost:5180` | Comma-separated CORS allow-list for the assistant. |
| `LLM_MODEL` | `ollama/llama3.1:8b` | LiteLLM model string. The prefix selects the provider. |
| `SCENARIO_LLM_MODEL` | falls back to `LLM_MODEL` | Optional stronger model for `POST /scenario/generate`. |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model for the document index. |
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | Where the assistant finds Ollama. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | unset | Required only when `LLM_MODEL` names a hosted provider. |
| `TAXPERT_SCENARIOS_DIR`, `TAXPERT_FLOW_DIR` | Credit Assistant's paths under `/apps` | Development overlay only. Which application's scenarios and flow XML the scenario generator reads. |

### Stack commands

Run these from the repository root. Every target passes `PROFILES`, which defaults to
`--profile explorer --profile ai`. Narrow it with `make up PROFILES=--profile explorer`.

| Command | What it does |
|---|---|
| `make up` | Build on first run, then start the stack. |
| `make down` | Stop and remove the stack. |
| `make logs` | Tail logs from all services. |
| `make ps` | Show service status. |
| `make build` | Build images without starting. |
| `make rebuild` | Tear down including volumes, rebuild with no cache, then start. |
| `make tidy` | Format and lint only the sub-projects with uncommitted changes. |

`make rebuild` drops the `chroma-data` volume, which a plain `down` and `up` preserves. The
document index therefore has to be repopulated afterwards.

## Working on one component

The Docker stack is the fastest way to see everything at once. For development, run the component
you are changing natively.

| Component | Where | Commands |
|---|---|---|
| taxpert workspace UI | `packages/ui` | `npm test` (`node --test`), `npm run lint`, `npm run format` |
| fact-explorer | `packages/fact-explorer` | `npm run dev`, `npm test` (`vitest run`), `npm run lint`, `npm run build`, `make help` for the rest |
| assistant | `services/assistant` | `make install`, `make dev`, `make test`, `make lint`, `make format`, `make index` |
| form-builder | [its own repo](https://github.com/IRS-Public/form-builder) | `sbt test`, `sbt publishLocal` |
| fact-graph | [its own repo](https://github.com/IRS-Public/fact-graph) | `sbt test`, `make publish`, `sbt fastOptJS` |
| an application | its own repo | `make dev`, `make test`, `make ci`, `make help` for the full list |

From the repository root, `npm test`, `npm run lint` and `npm run format` fan out across
`packages/*` with `--if-present`. They do not reach `services/assistant`, which is Python.

Run a single workspace with `--workspace`:

```bash
npm test --workspace packages/ui
npm run build-registry --workspace packages/fact-explorer
```

Every Form Builder application also exposes `make site`, the application-agnostic production build,
and `make diff-out`, which builds `main` in a throwaway worktree and diffs the two output trees.
Credit Assistant adds development variants of its own, including `make dev-ai` for the AI features,
`make dev-author` for in-place flow editing, and `make dev-one-question` for the
one-question-per-screen layout.

## Hot reload in Docker

`docker-compose.override.yml` is applied automatically and adds live-reload variants.

```bash
docker compose --profile explorer --profile ai up --build            # development, override applied
docker compose -f docker-compose.yml --profile explorer up --build   # production-like, no reload
```

| Service | Behavior when you edit source on the host |
|---|---|
| fact-explorer | Vite dev server with hot module replacement. `packages/ui` is bind-mounted too, so workspace UI edits are live. |
| assistant | uvicorn `--reload`, restarts on save. |
| An application | Nothing here watches it. Run its own `make dev` in its own repository. |

macOS bind mounts do not emit filesystem events, so each watcher runs in polling mode
(`WATCHFILES_FORCE_POLLING`, `VITE_USE_POLLING`).

## Documentation

[`docs/README.md`](docs/README.md) is the full index.

| Document | Read it when you want to know |
|---|---|
| [Why Taxpert](docs/why-taxpert.md) | Why this exists, what problems it solves, and why it is open source |
| [Architecture](docs/architecture.md) | How the pieces fit together, with diagrams of the build pipeline and the browser runtime |
| [Onboarding](docs/onboarding.md) | Step-by-step setup, every build flag, and troubleshooting |
| [Release status](docs/release-status.md) | Component inventory and what is generally available, beta, or experimental |
| [AI integration](docs/ai-integration.md) | Where the LLM surfaces sit, their limits, and proposed expansion |
| [Deployment](docs/deployment.md) | Static hosting with no backend, the full server stack, and the tradeoffs |
| [Style guides](docs/style-guides/README.md) | Thymeleaf, CSS, and JavaScript conventions |

## Gotchas

**Discovery looks exactly one level down.** Fact Explorer and the assistant read an application
from `${TAXPERT_APPS_DIR:-./apps}`, mounted read-only at `/apps`, and each application repository
has to sit directly inside that directory with its `fact-explorer.app.json` one level down. Cloning
the example repository and pointing `TAXPERT_APPS_DIR` at it satisfies that, because its two
applications are its two subdirectories. The Node scripts also follow symlinks placed inside
`apps/`, which is handy for the native path. A symlink whose target lies outside the mounted
directory will dangle inside a container, so prefer `TAXPERT_APPS_DIR` when running the Docker
stack.

**Vendored copies of `packages/ui` are generated and gitignored.** An application without a bundler
takes `taxpert` as a dependency and copies `node_modules/taxpert/src` into its own
`website-static/vendor/taxpert/` during the build. Never hand-edit a `vendor/` directory and never
commit one. Change `packages/ui/src/`, run `npm test --workspace packages/ui`, then run
`make copy-shared-ui` in each application. `make check-shared-ui` fails an application's build if
its mirror has drifted.

**Parser, generator, node template and chrome locale changes belong in form-builder** rather than
in an application. Republish with `sbt test publishLocal` there, then run `make ci` in more than one
application. A second application is what catches an accidental assumption about the first.

**The document index is not built by `make up`.** ChromaDB starts empty. The assistant's `make index`
populates it from `services/assistant/data/`. Retrieval returns nothing until it has run, and
`make rebuild` clears it again.

**Nothing here starts without a profile.** A bare `docker compose up` is a no-op by design, because
no service in this repository is an application.

## Contributing

Read the [style guides](docs/style-guides/README.md) before your first change. The repository is HTML
and CSS first, and both the scaffold's templates and the workspace UI follow conventions that a lint
rule or a review will otherwise catch. The decisions behind those conventions are recorded as
architecture decision records that live with the Tax Withholding Estimator, in
[`docs/adr/`](https://github.com/IRS-Public/form-builder-examples/tree/main/tax-withholding-estimator/docs/adr).
They predate the repository split and describe the platform as a whole.

Run `make tidy` from the repository root before committing. It formats and lints only the
sub-projects you actually touched.
