# Deployment

This document describes the two ways the Taxpert platform can be shipped and what each one costs.
Path 1 uploads static files to object storage and runs no servers at all. Path 2 runs the full
container stack, including a Python API, a vector database, and a model host. It is written for a
team deciding which artifact to put in front of users, and for whoever has to operate the result.
Local development setup is out of scope. See [QUICKSTART.md](QUICKSTART.md).

"Taxpert" or "the Taxpert platform" means this repository as a
whole, the workspace UI plus its companion services, together with the Form Builder scaffold and
the applications it is laid over. The "taxpert package" means the optional npm workspace UI in
`packages/ui/` (global nav, audit panel, tool panels). 


## Path 1: static hosting with no backend

This is the primary path. A Form Builder app is a static site generator, and both apps generate real
directories with `index.html` files. Nothing about the questionnaire needs a server:

- **The full questionnaire.** Pages, navigation, validation, alerts, knockouts, and collections all
  come from `form-builder/…/flow-runtime/js/`, which is plain ES modules in the browser.
- **The fact graph.** `factgraph-3.1.0.js` is the Scala.js build of `/fact-graph/`, evaluated in the
  browser. No rules run on a server.
- **Persistence.** `fg-fact-graph.js` reads and writes one `sessionStorage` key, namespaced by
  `storagePrefix`. Answers never leave the tab.
- **The Taxpert workspace**, when the site is built with `--auditMode`: global nav, audit panel,
  tool dock (Inspect, Outcome tracker, Watchlist), Scenario modal, Display options, and Workspace
  settings. All of it is client-side.
- **Browse All and Path Mode**, when the site is built with `--allScreens`. Without that flag the
  pages are never generated and the nav links to them return 404.
- **Loading a saved scenario JSON.** Scenario files are copied into
  `resources/scenarios/` when the site is built with `--scenarioMode`, and the browser deserializes
  them through the same engine. Importing a graph from a local file works with no build flag beyond
  the workspace itself.

Both targets run `copy-fg`, `copy-shared-ui`, then `sbt run` with no flags. `FormBuilder.run` parses
the flow and fact XML, renders every page for every locale, and writes the result under `./out`.

**Content-Type.** Everything the flow runtime loads is an ES module, and browsers refuse a module
served with a non-JavaScript MIME type.

| Extension | Content-Type |
|---|---|
| `.js`, `.mjs` | `text/javascript` |
| `.css` | `text/css` |
| `.xml` | `application/xml` |
| `.json` | `application/json` |
| `.svg` | `image/svg+xml` |
| `.woff2` | `font/woff2` |
| `.map` | `application/json` |

In the current tree the only `.mjs` file is the fact-graph source map (`main.mjs.map`), because
`make copy-fg` renames the Scala.js output to `factgraph-3.1.0.js`. Map the extension anyway, since
any tool that copies the bundle under its original name will produce one.

### Fact Explorer

Fact Explorer builds to a static bundle and can be uploaded to a bucket:

```bash
cd fact-explorer
npm run build-registry     # writes public/data/apps.json from every sibling fact-explorer.app.json
npm run make-fgm           # optional: writes public/data/<app>/form-builder-graph.json
npm run build              # writes dist/
```

Three things matter for a static deployment of fact explorer:

1. **It must be served at the origin root.** `vite.config.js` sets no `base`, and `src/App.jsx`
   routes on `window.location.pathname` against a literal `/fact-explorer` prefix. There is no
   basename option to configure.
2. **It needs SPA fallback.** `/fact-explorer/credit-assistant` is a client-side route with no file
   behind it. The shipped nginx config uses `try_files $uri $uri/ /index.html`
   (`packages/fact-explorer/nginx.conf`). 
3. **It needs its data directory.** `public/data/apps.json` is generated and gitignored, and
   `loadRegistry()` is the first thing the SPA does. Without it the page boots straight into
   "Cannot load the app registry". Per-app graphs under `public/data/<app>/form-builder-graph.json` are
   the offline fallback when an app does not serve its own.

What breaks: **the scenario overlay has no production equivalent.** `scripts/build-registry.mjs`
writes root-relative entries such as `/app/eitc/resources/fact-dictionary.xml` and
`/app/eitc/all-screens/`, deliberately same-origin so the embedded iframe can share `sessionStorage`
and the engine bundle loads with no CORS. In development the Vite proxy maps each app's `basePath`
to that app's origin. A static build has no proxy, so the overlay works only if the same origin also
serves the Form Builder apps at their real base paths. Fact Explorer on its own host keeps the graph
view and loses the overlay, because `load.js` falls back to
`public/data/<app>/form-builder-graph.json` and then to the mock fixture.

Nav links have the same problem. `credit-assistant/…/fragments/taxpert-config.html` hardcodes
`http://localhost:5180/fact-explorer/credit-assistant` and `http://localhost:3000/…` for the sibling
app. The per-deployment override file `resources/taxpert.config.json` is fetched at runtime by
`configureFromUrl()` and merged over the build's values, so a deployment can correct `nav`, `apps`
and `endpoints` without rebuilding. It ships as `{}`.

### What does not work

- **The two AI features.** "Explain and Analyze" chat calls `POST /chat` and AI scenario generation
  calls `POST /scenario/generate` (`packages/ui/src/audit-panel/js/chat.js` and `fact-graph-io.js`).
  Both go to `endpoints.apiBase`, which credit-assistant sets to `http://localhost:8000`. With no
  api service the requests fail and the rest of the panel keeps working.
- **Author Mode.** This is a live backend. `AuthoringServer` binds its own port (default 3004) and
  its `/author/save`, `/author/create-fact`, `/author/create-screen`, and `/author/delete-fact`
  endpoints write source XML to disk with `os.write.over` and then regenerate the site in-process.
  Its only access control is a CORS allow-list. **It must never be deployed.** Build without
  `--authorMode` and the `author/` pages are not generated at all. Note that
  `credit-assistant/…/website-static/js/author-mode.js` is part of `website-static/` and therefore
  lands in `out/resources/js/` on every build. It is inert without the pages that load it, and it is
  still in the upload.
- **Anything requiring the Vite dev server**, including Fact Explorer's scenario overlay proxy. See
  below.

### Build flags for a production static deploy

Flags are parsed in `form-builder/src/main/scala/gov/irs/formbuilder/build/Flags.scala`.

| Flag | Effect | Public static deploy |
|---|---|---|
| `--serve` | Starts the in-process `smol` dev server | No, there is no server |
| `--allScreens` | Generates `/all-screens/`, every field regardless of conditions | No for public, yes for review |
| `--auditMode` | Mounts the whole Taxpert workspace | See below |
| `--singleQuestionPerScreen` | Splits pages one question at a time | Only if that is the product |
| `--scenarioMode` | Copies `scenarios/` into `resources/` and lists them | No for public |
| `--authorMode` | Generates `/author/` and starts the write-capable API | Never |
| `--aiScenarioGeneration` | Reveals AI scenario generation in the panel | Only with an api behind it |
| `--aiFactExplanation` | Reveals the Explain and Analyze chat | Only with an api behind it |
| `--formBuilderGraph` | Emits `resources/form-builder-graph.json` for Fact Explorer | Optional, it is a development aid |



## Path 2: the full stack with servers

`docker-compose.yml` at the repository root defines the prod-like stack of the services this
repository builds. `docker-compose.override.yml` is a development overlay that Compose merges
automatically. Run `docker compose -f docker-compose.yml … up --build` to ignore it.

**No application is in this stack.** Every service here is a companion to an app that runs
elsewhere, so all of them sit behind a profile and a bare `docker compose up` starts nothing:
`--profile explorer` for Fact Explorer, `--profile ai` for the assistant and ChromaDB. Two variables
connect the stack to your app: `TAXPERT_APPS_DIR` (the host directory holding the app repos,
mounted read-only at `/apps`) and `TAXPERT_APP_HOST` (how a container reaches the running app). The
app's own image, if it has one, is that repository's business. The examples each ship a Dockerfile
that generates the site with `sbt run` and serves `out/` from `nginx:1.27-alpine`.

`packages/ui/compose/taxpert.yml` is the same set of services, shipped inside the npm package for
an app repo that does not define them itself. It builds them rather than pulling images: set
`TAXPERT_REPO` to a taxpert checkout. There are no published images, and nothing in this stack ever
asks for a registry credential.

### Container inventory

| Service | Profile | Image or build | Host port | Volumes | Depends on |
|---|---|---|---|---|---|
| `chromadb` | `ai` | `chromadb/chroma:1.5.9` | 8001 to container 8000 | `chroma-data:/data` | none |
| `assistant` | `ai` | `services/assistant/Dockerfile`, context is `./services/assistant` | 8000 | none in base | `chromadb` |
| `fact-explorer` | `explorer` | `packages/fact-explorer/Dockerfile`, context is repo root | 5180 to 80 | `${TAXPERT_APPS_DIR:-./apps}` at `/apps`, read-only | none |

The dev overlay swaps Fact Explorer's runtime stage for a live Vite server (regenerating every
discovered app's graph on `up`), bind-mounts `services/assistant/src` and `packages/ui`, and points
the Vite proxy at `host.docker.internal` so it reaches an app running natively on the host. None of
that belongs in a deployed environment.

### The api service

Started by `services/assistant/docker-entrypoint.sh`, which waits for ChromaDB, indexes the IRS publications if the
collection is empty, then executes:

```
uv run uvicorn src.api.app:app --host 0.0.0.0 --port 8000 --log-level info --timeout-keep-alive 60
```

Environment variables, from `docker-compose.yml` and `.env.example`:

| Variable | Set in | Purpose |
|---|---|---|
| `LLM_MODEL` | `.env` | LiteLLM model string, default `ollama/llama3.1:8b` |
| `SCENARIO_LLM_MODEL` | `.env`, optional | Model override for `/scenario/generate` |
| `OLLAMA_API_BASE` | `.env` | LiteLLM's Ollama address |
| `OLLAMA_HOST` | compose | The `ollama` Python client reads this name |
| `EMBEDDING_MODEL` | `.env` | Default `nomic-embed-text`, must be pulled |
| `CHROMA_HOST` / `CHROMA_PORT` | compose | `chromadb` and `8000` inside the network |
| `CHROMA_COLLECTION` | compose | `irs_publications` |
| `FACT_DICTIONARY_URL` | compose, from `TAXPERT_APP_HOST` | Where the running application serves its fact dictionary |
| `FRONTEND_ORIGIN` | compose | Comma-separated CORS allow-list |
| `OPENAI_API_KEY` | `.env`, optional | Only for a hosted `LLM_MODEL` |

**CORS is the only access control.** `src/api/app.py` adds `CORSMiddleware` with an allow-list built
from `FRONTEND_ORIGIN` and nothing else. There is no authentication, no authorization, and no rate
limiting. CORS is a browser policy and does nothing against a direct HTTP client. Any shared
environment must put this service behind an authenticated ingress. The endpoints accept free-text
prompts that are forwarded to an LLM, so an open instance is both a cost problem and a prompt-injection
surface.

### ChromaDB

Pinned to `chromadb/chroma:1.5.9`, and the compose file states why: it must match the `chromadb`
Python client in `services/assistant/uv.lock` (1.5.x). The 1.x server persists to `/data` and is wire-incompatible
with 0.5.x clients. Do not float this tag.

State lives in the named volume `chroma-data`. A deployment needs a real backing store, a backup
plan, and a migration plan for the pinned version.

The collection starts empty and retrieval returns nothing until it is populated. Locally that is
`make index` from `services/assistant/` (`uv run python -m src.rag.indexer`). In the Compose stack the entrypoint
does it on first boot when the collection count is zero, and logs a warning and continues if it
fails, so the chat runs without retrieval rather than crashing. Indexing requires a reachable
embedding model.

### Ollama

Ollama is not containerized in this repository. It runs natively on the host, where it can reach a
GPU, and the api container reaches it at `http://host.docker.internal:11434`. The compose file adds
`extra_hosts: host.docker.internal:host-gateway` so this also works on Linux.

That arrangement is a local-development convenience and does not survive a move to a server. A real
deployment has to choose one of:

- **A GPU node** running Ollama, with the api pointed at it over the network. This means capacity
  planning, model pulls as a deployment step, and GPU cost whether or not anyone is asking questions.
- **A hosted provider through LiteLLM.** `LLM_MODEL` accepts `anthropic/…` and `openai/…` prefixes,
  and `.env.example` documents this. Note that `EMBEDDING_MODEL` still points at Ollama, so RAG
  indexing and retrieval need an embedding endpoint even when the chat model is hosted.
- **A shared inference service** already operated elsewhere, reached the same way.

Sending taxpayer-adjacent text to a third-party API is a policy decision as much as an engineering
one. Path 1 does not raise the question at all.

### Fact Explorer: dev server versus static build

The base compose file builds Fact Explorer's nginx runtime stage and serves the static bundle. The
dev overlay switches `target: build` and runs `npm run make-fgm && npm run dev`, which is a live
Vite server providing hot module replacement and the scenario overlay proxy. A deployed instance
should serve the static build.

| Variable | Read by | Dev only |
|---|---|---|
| `VITE_FGM_SOURCE` | `src/model/load.js`, values `mock`, `real`, `overlay`, default `mock` | No, it is a build-time value baked into the bundle |
| `VITE_USE_POLLING` | `vite.config.js`, forces filesystem polling for the watcher | Yes |
| `VITE_APP_ORIGIN_<ID>` | `vite.config.js`, retargets one app's dev proxy | Yes |
| `VITE_AI_FACT_EXPLANATION` | `src/config/featureFlags.js` | No, build-time default |
| `VITE_AI_SCENARIO_GENERATION` | `src/config/featureFlags.js` | No, build-time default |

`VITE_FGM_SOURCE` is passed as a Docker build argument in `packages/fact-explorer/Dockerfile` and defaults to
`mock`, so the image renders with no Scala build at all.

### Full topology

```
                        +---------------------------+
   browser  ----------> |  authenticated ingress    |
                        |  (TLS, authn, rate limit) |
                        +------------+--------------+
                                     |
      +---------------+--------------+--------------+---------------+
      |               |                             |               |
      v               v                             v               v
+-----------+  +--------------+            +----------------+  +---------+
| your app  |  | a second app |            | fact-explorer  |  |  api    |
| (its own  |  | (its own     |            | (static bundle)|  | uvicorn |
|  repo)    |  |  repo)       |            | nginx :80      |  | :8000   |
| nginx :80 |  | nginx :80    |            +----------------+  +----+----+
+-----------+  +--------------+                  static            |
      static         static                                        |
                                                        +----------+----------+
                                                        |                     |
                                                        v                     v
                                                 +-------------+     +-----------------+
                                                 |  chromadb   |     |  LLM endpoint   |
                                                 |  :8000      |     |  Ollama on a GPU|
                                                 |  vol /data  |     |  node, or a     |
                                                 +-------------+     |  hosted provider|
                                                                     +-----------------+
```

The applications and Fact Explorer are static and need no state. Only the two on the left are built
outside this repository. Everything stateful sits behind the api.

---

## Tradeoff comparison

| Dimension | Path 1: static only | Path 2: full stack |
|---|---|---|
| Operational cost | Object storage plus a CDN. No processes to patch or restart. | Five containers, one GPU node or a per-token bill, plus a database to back up. |
| Attack surface | The bucket and the CDN distribution. No request handler executes your code. | Every container, plus an unauthenticated HTTP API by default, plus a vector store, plus outbound LLM traffic. |
| Availability | Whatever the object store and CDN provide, typically very high, with no failure mode you own. | Bounded by the least reliable service. A GPU node or a provider outage takes the AI features down. |
| Data handling | Answers stay in the tab's `sessionStorage`. Nothing is transmitted. | Chat prompts and generated scenarios leave the browser and reach a model host. |
| Feature completeness | Everything except the two AI features and Author Mode. | Everything. |
| Compliance and review | Small. There is no server-side data to classify and no credentials to rotate. | Substantial. Data flow review, model hosting review, third-party terms, log retention. |
| Scaling | The CDN's problem. Traffic growth is a bandwidth line item. | The api is synchronous and each request runs up to 10 tool-calling iterations for chat, 12 for scenario generation, so concurrency is bounded by inference capacity. |
| Cost of change | Rebuild, upload, invalidate. Rollback is re-uploading the previous tree. | Image builds, migrations, a possible re-index, and a coordinated rollout. |