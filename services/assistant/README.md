# api - LLM backend for the Taxpert workspace

A small FastAPI service that answers questions about a running EITC application. The workspace UI
(**Taxpert**, the npm package in [`../../packages/ui/`](../../packages/ui/) that renders the audit panel over a
running app) posts a question plus the facts currently on screen, and this service runs an LLM
tool-calling loop until the model produces a structured answer. The model is reached through
[LiteLLM](https://docs.litellm.ai), so it can be a local [Ollama](https://ollama.com) model or a
hosted one, selected by a single environment variable.

Two tools are available to the model: a keyword search over the EITC fact dictionary, and a
cosine-similarity lookup over IRS publications indexed into [ChromaDB](https://www.trychroma.com).
A second route generates a draft Fact Graph scenario from a plain-language description.

Nothing here is required for the tax applications themselves to run. It powers the chat and
scenario-generation features of the workspace, and those features degrade to an error message when
the service is down.

## Where it fits

| Piece | Role relative to this service |
|---|---|
| [`../../packages/ui/`](../../packages/ui/) | The main caller. `src/audit-panel/js/chat.js` posts to `/chat`, `src/audit-panel/js/fact-graph-io.js` posts to `/scenario/generate`. Both read the base URL from the panel's `api-base` attribute or `configure({ endpoints: { apiBase } })`, defaulting to `http://localhost:8000`. |
| A Form Builder application, in its own repository — clone it into [`../../apps/`](../../apps/), e.g. [credit-assistant](https://github.com/IRS-Public/form-builder-examples/tree/main/credit-assistant) | The application under inspection. Serves `fact-dictionary.xml`, which this service fetches at startup, and owns the `scenarios/` and `flow/` directories the scenario generator reads. |
| [`../../packages/fact-explorer/`](../../packages/fact-explorer/) | Loads the workspace UI, and also calls `/chat` directly from `src/canvas/ChatPanel.jsx` with a hardcoded `http://localhost:8000/chat`. On the CORS allow-list at `:5180`. |
| Ollama | Runs natively on the host, never containerized. Used for chat inference (optional) and for embeddings (always). |
| ChromaDB | Vector store for the indexed IRS publications. |

## Requirements

| Software | Why | Notes |
|---|---|---|
| Python 3.12+ | Runtime | Installed for you by uv |
| [uv](https://docs.astral.sh/uv/) | Dependency and venv management | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| [Ollama](https://ollama.com) | Embeddings, and chat inference by default | `brew install ollama`, or `curl -fsSL https://ollama.com/install.sh \| sh` |
| ChromaDB | Vector store | Installed as a Python dependency, started with `make chroma` |

Two Ollama models are needed for the default configuration:

```bash
ollama serve                   # keep running
ollama pull llama3.1:8b        # chat model, ~4.7 GB
ollama pull nomic-embed-text   # embedding model, ~274 MB
```

`nomic-embed-text` is required **even if you point `LLM_MODEL` at a hosted provider**. The indexer
and the retriever call the `ollama` Python client directly rather than going through LiteLLM, so
embeddings always come from Ollama.

## Quickstart

All commands run from `api/`.

```bash
make install                   # uv sync --extra dev
cp .env.example .env           # defaults are correct for an all-local setup

make chroma                    # terminal 1: ChromaDB on :8001
make index                     # terminal 2: build the RAG index (needs Ollama + Chroma up)
make dev                       # terminal 2: uvicorn on :8000, with reload
```

Check it came up:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

The credit-assistant dev server should be running at `http://localhost:3003` before you start
`make dev`, because the fact dictionary is fetched over HTTP at startup. See the gotchas below.

The whole stack (this service, both applications, Fact Explorer, ChromaDB) also runs from the repo
root with `docker compose up --build`. In that mode ChromaDB is a container reached at
`chromadb:8000` and published on host port 8001, and the api container reaches your host's Ollama at
`host.docker.internal:11434`.

## HTTP API

Three routes, all synchronous. Request and response bodies are the Pydantic models in
`src/api/models.py`.

### `GET /health`

```json
{ "status": "ok" }
```

Always returns 200 while the process is up. It does not check Ollama or Chroma.

### `POST /chat`

Request:

```json
{
  "prompt": "Why is this taxpayer disqualified?",
  "tracked_facts": [],
  "context": null
}
```

| Field | Type | Notes |
|---|---|---|
| `prompt` | string | Required. The SME's question. |
| `tracked_facts` | array | Defaults to `[]`. Either plain fact paths, or `{path, value, complete, dependencies}` objects resolved from the live fact graph. The orchestrator passes them into the user message and derives a plain path list for `identify_facts`. |
| `context` | object or null | Optional "Explain this node" payload. A `kind` discriminator of `fact`, `flow`, or `scenario` selects how the system prompt tells the model to read it. |

Response:

```json
{ "content": "**One-sentence answer**\n\n## Reasoning Trace\n- Fact `/eitcEligible` ..." }
```

`content` is Markdown, rendered by the backend from the model's `submit_final_answer` arguments.

### `POST /scenario/generate`

Request:

```json
{ "prompt": "head of household, two qualifying children, disqualified on investment income" }
```

Response:

```json
{
  "scenario_json": {
    "/isHOHMarried": { "$type": "BooleanWrapper", "item": true },
    "/jobsIncomeTotal": { "$type": "DollarWrapper", "item": "55768.00" }
  },
  "filename": "dq_hoh_married_2024_1tp_2qcs_55768.json",
  "description": "One short paragraph naming the active knockout and the decisive facts."
}
```

`scenario_json` is a serialized fact graph, the same shape as the files in the application's own
`src/main/resources/<appId>/scenarios/`. The browser stringifies it and
loads it through `GraphFactory.fromJSON`. **The service never writes to disk.** The user downloads
the result and places it in `scenarios/` by hand.

### Error responses

| Status | When |
|---|---|
| 503 | The relevant orchestrator was not constructed at startup, usually because Ollama or Chroma was unreachable or the fact dictionary could not be loaded. The `detail` string explains what to start. |
| 500 | The agent loop raised. `detail` is `Agent error: <exception>`. |

CORS is enforced by `FRONTEND_ORIGIN`. A browser request from an origin not on that list is
rejected by the middleware.

## How the agent loop works

Both loops live in `src/agent/` and follow the same shape: build a message list, call
`litellm.completion` with a tool schema, dispatch any tool calls, append results, repeat until the
model calls the terminal tool or the iteration budget runs out. Tool results longer than 8000
characters are trimmed to 6000 before going back into history.

**Chat** (`orchestrator.py`, `tools.py`, `prompts.py`, 10 iterations max):

| Tool | Does |
|---|---|
| `identify_facts` | Keyword search over the fact dictionary. Three tiers: exact path match, then tracked-fact match, then weighted keyword scoring (path and name hits count 3, description hits 1). Returns at most 5 facts. |
| `query_rag` | Embeds the query with Ollama, queries the Chroma collection by cosine distance, returns the 5 nearest chunks with their section breadcrumb and source. |
| `submit_final_answer` | Terminal. The backend renders its `direct_answer` / `reasoning_trace` / `what_would_change` / `citations` fields into Markdown rather than trusting the model to format prose. |

The chat loop has a fair amount of recovery logic for weaker local models: it accepts
answer-shaped hallucinated tool names (`final_answer`, `respond_to_user`), unwraps nested
`{"arguments": …}` envelopes, and parses a JSON blob returned as plain content instead of showing
it raw.

**Scenario generation** (`scenario_orchestrator.py`, `scenario_tools.py`, `scenario_prompts.py`,
12 iterations max) adds `list_scenarios`, `read_scenario` and `search_flow` (keyword search over the
Flow XML, useful for picking a knockout), and its terminal tool is `submit_scenario`. The model does
not author a whole fact graph. It picks the nearest existing scenario as a base, and the backend
applies only the model's validated overrides on top. An override is dropped if its wrapper
shape does not match its `$type`, or if its path is not a known writable fact. If the model never
submits cleanly, the loop falls back to the closest existing scenario rather than failing.

## Configuration

`load_dotenv()` reads `services/assistant/.env` at import. Copy `.env.example` to `.env` to start. Every variable
the code actually reads:

| Variable | Default | Read by |
|---|---|---|
| `LLM_MODEL` | `ollama/llama3.1:8b` | Both orchestrators. Any LiteLLM model string. |
| `SCENARIO_LLM_MODEL` | falls back to `LLM_MODEL` | Scenario orchestrator only. |
| `OLLAMA_API_BASE` | `http://localhost:11434` | LiteLLM, for `ollama/` models. |
| `OLLAMA_HOST` | unset | The `ollama` Python client (embeddings). `app.py` copies it into `OLLAMA_API_BASE` when the latter is unset. |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Indexer and retriever. Must be pulled in Ollama. |
| `CHROMA_HOST` | `localhost` | Chroma HTTP client. |
| `CHROMA_PORT` | `8001` | Chroma HTTP client. |
| `CHROMA_COLLECTION` | `irs_publications` | Collection name. |
| `FACT_DICTIONARY_PATH` | unset | Local path to `fact-dictionary.xml`. Takes precedence over the URL. |
| `FACT_DICTIONARY_URL` | `.env.example` sets `http://localhost:3003/app/eitc/resources/fact-dictionary.xml`. With no `.env` at all the code falls back to the relative path `fact-dictionary.xml`, which will not exist. | Used when `FACT_DICTIONARY_PATH` is unset. Accepts `http`, `https`, or a local path. |
| `SCENARIOS_DIR` | `../../apps/credit-assistant/src/main/resources/credit-assistant/scenarios` | Scenario generator, resolved relative to `services/assistant/`. The default assumes the application is checked out under the repo's `apps/` directory; set it for any other layout. |
| `FLOW_DIR` | `../../apps/credit-assistant/src/main/resources/credit-assistant/flow` | Scenario generator's `search_flow`. Same default, same caveat. |
| `FRONTEND_ORIGIN` | `http://localhost:3003,http://localhost:5180` | CORS allow-list, comma-separated. |
| `PDF_DIR` | `data/irs_publications` | Indexer. |
| `HTML_DIR` | `data/html` | Indexer. |
| `LOG_LEVEL` | `INFO` | Structured JSON logging (`src/logging_config.py`). Not in `.env.example`. |

`CHROMA_SERVER_CORS_ALLOW_ORIGINS` appears in `.env.example` but is consumed by the ChromaDB server,
not by this code. `make chroma` sets it inline anyway, so editing it in `.env` has no effect on that
target.

### Using a hosted model instead of Ollama

Supported, and it needs no code change. LiteLLM picks the provider from the prefix on the model
string, and reads the provider's key from the environment:

| Provider | `LLM_MODEL` | Key |
|---|---|---|
| Ollama (local) | `ollama/llama3.1:8b` | none, set `OLLAMA_API_BASE` instead |
| Anthropic | `anthropic/claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai/gpt-4o` | `OPENAI_API_KEY` |

Set `SCENARIO_LLM_MODEL` on its own if you want the stronger model only for scenario generation,
which benefits most from it. Remember that embeddings still go through Ollama either way, so
`ollama serve` plus `nomic-embed-text` remains a requirement for RAG.

## The RAG index

One document is committed: `data/html/pub_596.html`, the HTML of IRS Publication 596, which is the
primary EITC reference. `data/irs_publications/` is gitignored, so any PDFs you want retrievable are
yours to supply.

```bash
make chroma    # ChromaDB HTTP server on :8001, persisting to ./data/chroma
make index     # uv run python -m src.rag.indexer
```

The indexer splits each document into sections by heading, then into overlapping ~600-word chunks
with 50 words of overlap, prepends each chunk's `A > B > C` heading breadcrumb so the embedding
carries its topic, embeds with `nomic-embed-text`, and upserts into a collection created with
`{"hnsw:space": "cosine"}`. Chunk ids are `<source>:<chunk_index>`, so re-running updates in place
rather than duplicating. Re-run after adding documents.

For IRS HTML specifically, the extractor picks the largest `field--name-body` div as the content
root, maps the Drupal heading role classes (`role-chap`, `role-hd1`, `role-hd2`) to logical outline
depth, and drops tables with more than 30 cells so the EIC lookup tables do not flood the index.

**The PDF branch of `main()` is currently commented out** (`src/rag/indexer.py`), so `make index`
processes `data/html/` only. `extract_pdf_chunks` still works and is still covered by `test_rag.py`.
Uncomment the loop if you need it.

Optionally, [chromadb-admin](https://github.com/flanker/chromadb-admin) gives you a browser view of
the collection:

```bash
docker run -p 3001:3001 fengzhichao/chromadb-admin
```

Open `http://localhost:3001` and connect to `http://host.docker.internal:8001`, since `localhost`
inside that container is the container itself.

## Layout

```
api/
  Makefile              # every command below
  pyproject.toml        # deps, black config, pytest testpaths
  uv.lock               # committed; the Docker build installs --frozen from it
  Dockerfile            # api image; entrypoint waits for Chroma and indexes on first run
  docker-entrypoint.sh
  .env.example
  data/
    chroma/             # Chroma persistence for `make chroma`
    html/               # HTML sources for the indexer
    irs_publications/   # PDF sources, gitignored
  docs/
    pub_596_html_structure.md   # notes on the IRS HTML the extractor targets
  src/
    api/
      app.py            # FastAPI app, CORS, orchestrator construction at import
      routes.py         # /chat and /scenario/generate handlers
      models.py         # request/response models
    agent/
      orchestrator.py         # chat loop
      tools.py                # chat tool schemas
      prompts.py              # chat system prompt
      scenario_orchestrator.py
      scenario_tools.py
      scenario_prompts.py
    facts/
      dictionary.py     # hardened lxml parse of fact-dictionary.xml into a Fact dataclass
      search.py         # identify_facts keyword search
    rag/
      indexer.py        # chunk, embed, upsert
      retriever.py      # embed query, cosine query against Chroma
    logging_config.py   # JSON log formatter
  tests/
```

## Commands

| Target | Runs |
|---|---|
| `make install` | `uv sync --extra dev` |
| `make install-hooks` | `uv run pre-commit install` |
| `make dev` | `uvicorn src.api.app:app --reload --port 8000` |
| `make chroma` | `chroma run --host 0.0.0.0 --port 8001 --path ./data/chroma` |
| `make index` | `python -m src.rag.indexer` |
| `make test` | `pytest tests/ -v` |
| `make lint` | `black --check src/ tests/` |
| `make format` | `black src/ tests/` |
| `make check-format` | `pre-commit run --all-files` (black plus isort) |
| `make clean` | removes `.venv` and `.pytest_cache` |

The repo root also has `make tidy`, which runs this project's `format` and `lint` only when `api/`
has uncommitted changes.

## Tests

```bash
make test
```

60 tests across `tests/test_api.py`, `test_facts.py`, `test_final_answer.py`, `test_orchestrator.py`,
`test_rag.py` and `test_scenario.py`. They mock LiteLLM, Ollama and Chroma, so **no services need to
be running** and no model needs to be pulled. The suite finishes in about ten seconds.

Black is pinned to the 24.8.x line in both `pyproject.toml` and `.pre-commit-config.yaml` on
purpose. Black 25 changed multi-line string formatting, which made `make lint` and
`make check-format` disagree.

## Gotchas

- **The orchestrators are built once, at import time.** `app.py` calls `_build_orchestrators()` at
  module level and swallows any failure, logging a warning and leaving both as `None`. Every request
  then gets a 503. Starting Ollama or Chroma afterwards does not help until you restart the server.
  If `/chat` returns 503, read the startup log first.
- **The fact dictionary is fetched once at startup.** With the default
  `FACT_DICTIONARY_URL`, the credit-assistant dev server must already be serving on :3003 when this
  process starts. Point `FACT_DICTIONARY_PATH` at a local file to remove that ordering constraint.
- **`OLLAMA_API_BASE` alone is not enough for a non-default Ollama address.** LiteLLM reads
  `OLLAMA_API_BASE`, but the `ollama` client used for embeddings reads `OLLAMA_HOST`. `app.py` copies
  `OLLAMA_HOST` into `OLLAMA_API_BASE` and not the reverse, so set `OLLAMA_HOST` if you need both to
  follow. The docker-compose service does exactly that.
- **ChromaDB runs on 8001**, moved off its own default of 8000 because this service already owns
  that port. In Docker the container listens on 8000 internally and is published as 8001.
- **The Chroma server and client versions are coupled.** `docker-compose.yml` pins
  `chromadb/chroma:1.5.9` to match the client in `uv.lock`. A 1.x server is wire-incompatible with a
  0.5.x client.
- **`make index` indexes HTML only** while the PDF loop stays commented out. Dropping a PDF into
  `data/irs_publications/` and re-running will silently index nothing new.
- **`data/chroma/`, `.venv/` and the `__pycache__` directories are not for editing or searching.**
