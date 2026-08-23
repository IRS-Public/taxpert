# Deployment

This document describes the two ways the Taxpert platform can be shipped and what each one costs.
Path 1 uploads static files to object storage and runs no servers at all. Path 2 runs the full
container stack, including a Python API, a vector database, and a model host. It is written for a
team deciding which artifact to put in front of users, and for whoever has to operate the result.
Local development setup is out of scope. See [onboarding.md](./onboarding.md).

Two names sit close together here. "Taxpert" or "the Taxpert platform" means this repository as a
whole — the workspace UI plus its companion services — together with the Form Builder scaffold and
the applications it is laid over. "the `taxpert` package" means the optional npm workspace UI in
`packages/ui/` (global nav, audit panel, tool panels). They are deployed very differently, so the
distinction matters here.

The applications are not in this repository: they live in their own, as any Form Builder app does.
The two referred to throughout — `credit-assistant` and `tax-withholding-estimator` — are the
[example applications](https://github.com/IRS-Public/form-builder-example), and every path named for them below is
relative to that repository.

**Related documents**

- [architecture.md](./architecture.md) - how the pieces fit together
- [onboarding.md](./onboarding.md) - running everything locally
- [release-status.md](./release-status.md) - component maturity
- [ai-integration.md](./ai-integration.md) - what the AI surfaces do
- [why-taxpert.md](./why-taxpert.md) - rationale
- [../README.md](../README.md) - repository overview

---

## 1. What is actually deployable

Four terms first, because a reader new to this repository will not know them. **Form Builder**
(`gov.irs::form-builder`) is the Scala scaffold that turns Flow XML plus a Fact Dictionary into a static
multi-language site, and it ships the browser theme and the flow runtime inside its jar. A
**Form Builder app** is a thin application over that scaffold, living in its own repository; the two
worked through here are the examples, `credit-assistant` (the EITC questionnaire) and
`tax-withholding-estimator` (TWE). **Fact Explorer** is a React and Vite
single-page application that visualizes any Form Builder app's flow and facts. **api/** is a FastAPI
backend powering two AI features in the audit panel.

| Artifact | Produced by | Needs at runtime | Optional |
|---|---|---|---|
| credit-assistant static site | `make credit-assistant` (alias `make site`) in `credit-assistant/`, in the applications repo | A static file server. No process, no state. | No, it is the product |
| tax-withholding-estimator static site | `make twe` (alias `make site`) in `tax-withholding-estimator/`, same repo | Same | No, it is the product |
| Fact Explorer bundle | `npm run build` in `packages/fact-explorer/` (writes `dist/`) | A static file server with SPA fallback | Yes, it is a development and review tool |
| api service | `services/assistant/Dockerfile`, run under uvicorn | Python 3.12, ChromaDB, an LLM endpoint | Yes, only the two AI features need it |
| ChromaDB | `chromadb/chroma:1.5.9` image | A persistent volume at `/data` | Yes, only the api needs it |
| Ollama | Not containerized in this repository | A host with a GPU, or a hosted provider instead | Yes, only the api needs it |

Everything in the first three rows is a directory of files. Everything in the last three rows is a
process with state. That split is the whole of the deployment decision.

---

## 2. Path 1: static hosting with no backend

This is the primary path. A Form Builder app is a static site generator, and both apps generate real
directories with `index.html` files. Nothing about the questionnaire needs a server.

### 2.1 What you build

```bash
cd credit-assistant && make credit-assistant     # or: make site
cd tax-withholding-estimator && make twe         # or: make site
```

Both targets run `copy-fg`, `copy-shared-ui`, then `sbt run` with no flags. `FormBuilder.run` parses
the flow and fact XML, renders every page for every locale, and writes the result under `./out`.

The output tree for credit-assistant looks like this. TWE is the same shape under
`out/app/tax-withholding-estimator/`, with two locales instead of eight.

```
out/app/eitc/                 <- outSubdir from Main.scala
  index.html                  <- default locale (en) at the root
  filing-status/index.html    <- one directory per flow route
  es/                         <- one subtree per non-default locale
    index.html
    filing-status/index.html
  resources/                  <- the app's website-static/, copied whole
    styles/  js/  img/
    fact-dictionary.xml       <- written by the generator
    taxpert.config.json       <- per-deployment overrides, ships as {}
    vendor/
      form-builder/           <- theme + flow runtime, extracted from the jar
      fact-graph/             <- factgraph-3.1.0.js, the Scala.js engine
      uswds-3.13.0/
      taxpert/                <- workspace UI mirror (see the note below)
```

Upload the contents of `out/` so that `out/app/eitc/index.html` is reachable at
`https://<host>/app/eitc/`.

### 2.2 The generated site is path-sensitive

Every link and asset href in the generated HTML is written as `${basePath}/…`, absolute from the
origin root. `fragments/head.html` in the scaffold builds the stylesheet, favicon, and script URLs
this way, and so does every page template. `basePath` comes from the app's `FormBuilderApp`:

| App | `basePath` | `outSubdir` | Source |
|---|---|---|---|
| credit-assistant | `/app/eitc` | `app/eitc` | `credit-assistant/src/main/scala/gov/irs/creditassistant/Main.scala` |
| tax-withholding-estimator | `/app/tax-withholding-estimator` | `app/tax-withholding-estimator` | `tax-withholding-estimator/src/main/scala/gov/irs/twe/Main.scala` |

`basePath` and `outSubdir` are separate fields on purpose, so a build can write to one location and
be served from another. The rule that matters is that the URL prefix the site is served under must
equal `basePath`. If a bucket serves the tree under `/eitc/` while `basePath` is `/app/eitc`, every
stylesheet, script, and internal link resolves to a path that does not exist, and the browser gets a
page with no styling and no working questionnaire.

The flow runtime also locates itself from `import.meta.url`
(`form-builder/…/flow-runtime/js/runtime-paths.js`), and when that derivation fails it returns an empty
string rather than throwing, so links silently go root-relative. The scaffold hedges by rendering
`<meta name="form-builder:base-path">` in `head.html`, which the runtime prefers. If a deployment needs
a different prefix, change `basePath` in the app's `Main.scala` and rebuild. Rewriting paths at the
CDN works but leaves two sources of truth disagreeing.

### 2.3 S3 and CloudFront specifics

**Static website hosting versus origin access.** An S3 static website endpoint applies the index
document to every directory request, so `/app/eitc/filing-status/` serves
`filing-status/index.html`. A CloudFront distribution using origin access control against the REST
endpoint does not: `DefaultRootObject` applies only to the distribution root, and a request for a
directory path returns a 403 or 404. If the bucket must stay private, add a CloudFront Function or
Lambda@Edge that appends `index.html` to any request path ending in `/`. Choose one and test the
deep links, because the site root will work either way and only the interior pages will break.

**Why the generator's output shape helps.** Every flow route is its own directory containing an
`index.html`, which is why the nginx config both apps ship is `try_files $uri $uri/ =404` with no
SPA fallback (`credit-assistant/nginx.conf`). There is no client-side router to rewrite around, and
a 404 stays a 404 rather than being masked by an index page.

**Cache headers.** The tree splits cleanly into version-pinned and unversioned files.

| Path | Changes on | Suggested caching |
|---|---|---|
| `**/index.html` | Every content change | `no-cache` or a short TTL, must-revalidate |
| `resources/vendor/fact-graph/factgraph-3.1.0.js` | Only on a fact-graph version bump | Long TTL, the version is in the filename |
| `resources/vendor/uswds-3.13.0/**` | Only on a USWDS upgrade | Long TTL, the version is in the directory name |
| `resources/vendor/form-builder/**` | Every scaffold release | Moderate TTL plus invalidation on deploy |
| `resources/vendor/taxpert/**` | Every workspace UI release | Moderate TTL plus invalidation on deploy |
| `resources/fact-dictionary.xml` | Every fact change | Short TTL, it must match the HTML |
| `resources/taxpert.config.json` | Per deployment | Short TTL |

The theme, the flow runtime, and the workspace UI carry no content hash in their filenames, so a
long TTL on them will serve stale JavaScript against fresh HTML. Either invalidate those prefixes on
every release or accept a moderate TTL.

**Content-Type.** Everything the flow runtime loads is an ES module, and browsers refuse a module
served with a non-JavaScript MIME type. S3 does not infer types, so the upload step must set them.

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

### 2.4 What works with no backend

Each item below was verified against the code.

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

### 2.5 What does not work

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

### 2.6 Fact Explorer as a static bundle

Fact Explorer builds to a static bundle and can be uploaded to a bucket:

```bash
cd fact-explorer
npm run build-registry     # writes public/data/apps.json from every sibling fact-explorer.app.json
npm run make-fgm           # optional: writes public/data/<app>/form-builder-graph.json
npm run build              # writes dist/
```

Three things matter for a static deployment.

1. **It must be served at the origin root.** `vite.config.js` sets no `base`, and `src/App.jsx`
   routes on `window.location.pathname` against a literal `/fact-explorer` prefix. There is no
   basename option to configure.
2. **It needs SPA fallback.** `/fact-explorer/credit-assistant` is a client-side route with no file
   behind it. The shipped nginx config uses `try_files $uri $uri/ /index.html`
   (`packages/fact-explorer/nginx.conf`). On S3 plus CloudFront this is a 403 and 404 error response mapped
   to `/index.html` with a 200 status.
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

### 2.7 Build flags for a production static deploy

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

`make credit-assistant` and `make twe` pass no flags at all, which is the safest default.

**The `--auditMode` risk.** With the flag on, `head.html` renders the workspace mount and the site
ships internal tooling, including the fact graph inspector, to whoever loads the page. TWE ADR-004
(`tax-withholding-estimator/docs/adr/004-internal-debugging-surfaces.md`) considered this and
accepted it for the audit panel specifically, so Treasury and researchers could review conditional
behavior in a realistic environment. It paired that with two constraints: the panel is marked
clearly as internal-only, and the all-screens page stays local only, because combining the two
"would increase the risk of accidentally exposing audit features to taxpayers". The ADR also
describes the panel as off by default in production and enabled by typing `enableAuditMode()` in the
browser console. The example apps' own Docker images build with `--auditMode --allScreens`, which is broader than the
ADR's all-screens position. Those images are a prod-like local stack, and a public deploy should
follow the ADR.

One more caveat. `Website.save` copies the app's entire `website-static/` directory into
`out/resources/` without filtering, so the vendored `taxpert/` mirror is present in the output of a
build with no `--auditMode` even though no page references it. The flag gates the `<script>` tags
rather than the bytes on disk. Strip `resources/vendor/taxpert/` from the upload if shipping those
files is unacceptable.

---

## 3. Path 2: the full stack with servers

`docker-compose.yml` at the repository root defines the prod-like stack of the services this
repository builds. `docker-compose.override.yml` is a development overlay that Compose merges
automatically. Run `docker compose -f docker-compose.yml … up --build` to ignore it.

**No application is in this stack.** Every service here is a companion to an app that runs
elsewhere, so all of them sit behind a profile and a bare `docker compose up` starts nothing:
`--profile explorer` for Fact Explorer, `--profile ai` for the assistant and ChromaDB. Two variables
connect the stack to your app — `TAXPERT_APPS_DIR` (the host directory holding the app repos,
mounted read-only at `/apps`) and `TAXPERT_APP_HOST` (how a container reaches the running app). The
app's own image, if it has one, is that repository's business; the examples each ship a Dockerfile
that generates the site with `sbt run` and serves `out/` from `nginx:1.27-alpine`.

`packages/ui/compose/taxpert.yml` is the same set of services, shipped inside the npm package for
an app repo that does not define them itself. It builds them rather than pulling images: set
`TAXPERT_REPO` to a taxpert checkout. There are no published images, and nothing in this stack ever
asks for a registry credential.

### 3.1 Container inventory

| Service | Profile | Image or build | Host port | Volumes | Depends on |
|---|---|---|---|---|---|
| `chromadb` | `ai` | `chromadb/chroma:1.5.9` | 8001 to container 8000 | `chroma-data:/data` | none |
| `assistant` | `ai` | `services/assistant/Dockerfile`, context is `./services/assistant` | 8000 | none in base | `chromadb` |
| `fact-explorer` | `explorer` | `packages/fact-explorer/Dockerfile`, context is repo root | 5180 to 80 | `${TAXPERT_APPS_DIR:-./apps}` at `/apps`, read-only | none |

The dev overlay swaps Fact Explorer's runtime stage for a live Vite server (regenerating every
discovered app's graph on `up`), bind-mounts `services/assistant/src` and `packages/ui`, and points
the Vite proxy at `host.docker.internal` so it reaches an app running natively on the host. None of
that belongs in a deployed environment.

### 3.2 The api service

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
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | `.env`, optional | Only for a hosted `LLM_MODEL` |

**CORS is the only access control.** `src/api/app.py` adds `CORSMiddleware` with an allow-list built
from `FRONTEND_ORIGIN` and nothing else. There is no authentication, no authorization, and no rate
limiting. CORS is a browser policy and does nothing against a direct HTTP client. Any shared
environment must put this service behind an authenticated ingress. The endpoints accept free-text
prompts that are forwarded to an LLM, so an open instance is both a cost problem and a prompt-injection
surface.

### 3.3 ChromaDB

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

### 3.4 Ollama

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

### 3.5 Fact Explorer: dev server versus static build

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

### 3.6 Full topology

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

The applications and Fact Explorer are static and need no state; only the two on the left are built
outside this repository. Everything stateful sits behind the api.

---

## 4. Tradeoff comparison

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

### When each path is appropriate

**Use Path 1 for anything taxpayer-facing.** The security argument is concrete rather than
rhetorical. There is no server-side state, because the fact graph is evaluated by a Scala.js bundle
in the browser and persisted to one `sessionStorage` key written by `fg-fact-graph.js`. There is no
database in the deployed artifact. There is no authentication surface, because there is nothing to
authenticate to. The only thing an attacker can reach is a bucket of files, and the only thing a
compromised bucket yields is the ability to serve different files, which is a supply-chain problem
handled by access control on the deploy pipeline rather than by runtime hardening. Taxpayer answers
never leave the browser, so there is no data at rest to breach and no data in flight to intercept.

Two qualifications. `sessionStorage` is the only persistence the questionnaire uses, but the
workspace UI, present only in an `--auditMode` build, writes its own preferences: panel layout and
feature-flag overrides to `localStorage`, watchlist and display options to `sessionStorage`
(`packages/ui/src/shared/js/storage-keys.js`). Those carry no answers. And
`form-builder/…/templates/fragments/head.html` loads Google Tag Manager from `googletagmanager.com` on
every generated page, so a static deploy is not free of third-party requests. Remove or gate that
fragment if the deployment cannot allow it.

**Use Path 2 for an internal environment where the AI features are the point.** The chat and the
scenario generator are the reason the api exists, and they are the only reason to accept a database,
a model host, and an authentication surface.

**Do not run Path 2 as the public artifact.** Nothing a taxpayer does requires it, and adding it
would put an unauthenticated LLM endpoint and a vector database into the blast radius of a service
that currently has neither.

---

## 5. A middle path

Ship the static apps publicly and run one internal api instance behind authentication. Reviewers get
the AI features, and the public artifact stays a bucket of files.

What it requires:

1. **Two builds of each app.** The public build passes no flags. The internal build passes
   `--auditMode`, plus `--allScreens`, `--scenarioMode`, `--aiFactExplanation`, and
   `--aiScenarioGeneration` as needed. Different flags mean different bytes, so this is two upload
   targets rather than one artifact with a switch.
2. **A different `apiBase` for the internal build.** Either edit
   `fragments/taxpert-config.html` and `fragments/audit-panel.html`, or leave both alone and place a
   real `resources/taxpert.config.json` next to the internal build. The second option is preferable:
   `configureFromUrl()` merges the file over the build's own values at runtime, so the same generated
   site can be pointed at a different backend by editing one JSON file, and the change is reviewable
   in git.
3. **An authenticated ingress in front of the api**, and a `FRONTEND_ORIGIN` allow-list naming only
   the internal host. CORS alone is not a control.
4. **Access control on the internal site itself.** An `--auditMode` build exposes the fact graph
   inspector and, with `--allScreens`, every screen in the flow. Put it behind the same ingress.
5. **A rule that the public tree is never built from the internal target.** The two `out/` trees look
   nearly identical, and the difference is exactly the tooling you do not want to publish.

---

## 6. CI and release

**This repository contains no continuous integration configuration.** There is no `.github/`
directory, no GitHub Actions workflow, no GitLab CI file, no Jenkinsfile. ADR-002 refers to "the GHA
files" and prescribes pinning actions to SHAs, and both example apps' Makefiles carry a `semgrep`
target with a comment saying setup is "done separately in the GHA files", but no such files are
present in either repository.
Everything below runs locally today, and wiring it into a pipeline is work that has not been done in
this repository.

One `.pre-commit-config.yaml` exists here, in `services/assistant/`; the example applications carry
their own.

**`make ci` per app**, run from the app directory, is: the production build (`make credit-assistant`
or `make twe`), `check-shared-ui`, `validate-xml`, `validate-html`, `validate-templates`,
`validate-js`, `validate-scala`. TWE adds `validate-uswds`, a vendored-font check that
credit-assistant does not have. Semgrep is deliberately skipped in both `ci` recipes.

**`make check-shared-ui` is not optional in a deploy.** The vendored `website-static/vendor/taxpert/`
directory is a generated mirror of this repository's `packages/ui/src`, gitignored, rebuilt by `copy-shared-ui` on every
build target. The check is a whole-tree `diff -r`. Skipping it means a build can ship a stale or
hand-edited copy of the workspace UI with nothing in git to show for it, and the failure appears as
UI that does not match the source rather than as a build error.

**`make validate-xml`** runs `xmllint --relaxng` over `facts/*.xml` against `FactDictionaryModule.rng`
and over `flow/*.xml` against `FlowConfig.rng`. The Makefile comment records that the flow half was
declared and never run for a period, during which the schema drifted. Both halves run now.

**`make diff-out`** (`scripts/diff-out.sh`, byte-identical in both apps) checks out `main` into a
throwaway git worktree, builds that app's `site` target there and in the working copy, and diffs the
two `out/` trees. It is the fastest way to see what a release actually changes in the deployed bytes,
and the right review tool for any change meant to be output-neutral.

**Security scanning posture (ADR-002).** The decision is static-only scanning: Semgrep for Scala
(JVM and Scala.js) with `--severity WARNING --error`, ESLint with the security plugin failing on
`error`, and html-validate failing on `error`, plus Dependabot alerts at the repository level. Custom
html-validate rules live at `tax-withholding-estimator/src/main/resources/twe/security/.htmlvalidate.json`.
Dynamic scanning, secret scanning, and general quality linting are explicitly out of scope. The ADR
justifies skipping secret scanning on the grounds that the application is unauthenticated and handles
no credentials, which is true of Path 1 and is no longer true once the api service and its provider
keys enter the picture. The ADR also states that the project does not rely on third-party scripts,
which the Google Tag Manager tag in `head.html` contradicts. Both are worth revisiting together.

---

## 7. Operational checklist

### Path 1: static deploy

- [ ] Build with `make site` from the app directory, no extra flags for a public build.
- [ ] Confirm `out/` contains no `app/eitc/author/` (or `app/tax-withholding-estimator/author/`).
- [ ] Confirm `out/` contains no `all-screens/` unless Browse All is intended to be public.
- [ ] Confirm the bucket prefix matches `basePath` exactly, and load one interior page to prove it.
- [ ] Set `Content-Type` on every uploaded file, especially `.js` and `.css`.
- [ ] Set short cache lifetimes on `**/index.html` and `fact-dictionary.xml`.
- [ ] Invalidate `resources/vendor/form-builder/*` and `resources/vendor/taxpert/*` on every release.
- [ ] Confirm directory requests resolve to `index.html`, either through the S3 website endpoint or a
      CloudFront function.
- [ ] Decide whether `resources/vendor/taxpert/` should be stripped from the upload.
- [ ] Decide whether the Google Tag Manager tag stays.
- [ ] Run `make ci` in the app directory, including `make check-shared-ui`.
- [ ] Run `make diff-out` and read the diff before releasing.
- [ ] For Fact Explorer: run `npm run build-registry` before `npm run build`, serve at the origin
      root, and configure SPA fallback to `/index.html`.

### Path 2: full stack

- [ ] Use `docker compose -f docker-compose.yml up --build` so the dev overlay is not applied.
- [ ] Confirm no `*-watch` service and no port 3004 mapping exists in the deployed configuration.
- [ ] Put the api behind an authenticated ingress. Do not rely on CORS.
- [ ] Set `FRONTEND_ORIGIN` to the exact deployed origins, with no wildcard.
- [ ] Keep `chromadb/chroma` pinned to `1.5.9` and matched to the client in `services/assistant/uv.lock`.
- [ ] Back the `chroma-data` volume with durable storage and take backups.
- [ ] Populate the collection (`make index` from `services/assistant/`, or let the entrypoint run on first boot)
      and confirm a retrieval returns results.
- [ ] Decide the LLM host: a GPU node, a hosted provider via `LLM_MODEL`, or a shared service. Do not
      ship `host.docker.internal`.
- [ ] Provide an embedding endpoint even when the chat model is hosted.
- [ ] Store provider API keys in a secret manager rather than `.env`.
- [ ] Serve Fact Explorer from its static build rather than from `npm run dev`.
- [ ] Confirm `VITE_USE_POLLING` and `VITE_APP_ORIGIN_*` are absent from the deployed configuration.
- [ ] Check `/health` on the api after every deploy.
