# Internals: the assistant service

`services/assistant/` is the FastAPI backend behind two workspace features: the audit panel's chat,
and AI scenario generation in the Manage scenario modal.

It runs an LLM tool-calling loop through LiteLLM, with keyword search over an application's fact
dictionary and cosine-similarity retrieval over indexed IRS publications in ChromaDB.

It serves on port 8000. Both frontends reach it through `config.endpoints.apiBase`.

## Commands

Run from `services/assistant/`.

| Command | Does |
|---|---|
| `make install` | `uv sync --extra dev` |
| `make dev` | uvicorn on port 8000 with reload |
| `make chroma` | A local ChromaDB HTTP server on port 8001, storing under `./data/chroma` |
| `make index` | Builds the RAG index |
| `make test` | `pytest tests/ -v` |
| `make lint` | `black --check` |
| `make format` | `black` |
| `make check-format` | `pre-commit run --all-files` |
| `make install-hooks` | Installs the pre-commit hooks |
| `make clean` | Removes `.venv` and `.pytest_cache` |

`make dev` and `make index` both need a reachable Ollama. `make index` and any RAG query also need a
reachable Chroma.

## Layout

| Module | Role |
|---|---|
| `src/api/app.py` | The FastAPI app: CORS, `/health`, and construction of both orchestrators |
| `src/api/routes.py` | The two POST routes, plus the setters `app.py` injects through |
| `src/api/models.py` | The Pydantic request and response models |
| `src/agent/orchestrator.py` | The chat tool-calling loop |
| `src/agent/tools.py` | The chat loop's tool schemas |
| `src/agent/prompts.py` | The chat system prompt |
| `src/agent/scenario_orchestrator.py` | The scenario tool-calling loop |
| `src/agent/scenario_tools.py` | The scenario loop's tool schemas |
| `src/agent/scenario_prompts.py` | The scenario system prompt |
| `src/facts/dictionary.py` | Parses an application's `fact-dictionary.xml` into `Fact` records |
| `src/facts/search.py` | Keyword search over that dictionary |
| `src/rag/indexer.py` | Chunks documents, embeds them, upserts into ChromaDB |
| `src/rag/retriever.py` | Embeds a query and cosine-queries ChromaDB |
| `src/logging_config.py` | Logging setup |

## Startup

**Both orchestrators are constructed once at import time.** If that fails, the routes answer 503
until the process is restarted, so the startup log is the first place to look when a request returns
503 rather than an error from the model.

The fact dictionary is loaded once at startup, from `FACT_DICTIONARY_PATH` or
`FACT_DICTIONARY_URL`, and shared by both orchestrators.

## The routes

| Route | Request | Response |
|---|---|---|
| `POST /chat` | `{ prompt, tracked_facts, context }` | `{ content }`, Markdown |
| `POST /scenario/generate` | `{ prompt }` | `{ scenario_json, filename, description }` |
| `GET /health` | | Liveness |

`scenario_json` carries the `{"$type": ..., "item": ...}` wrapper, the same shape as the files in an
application's scenarios directory, so a generated scenario loads through the same path as a
committed one.

**Handlers are synchronous**, so the caller holds one request open for the whole agent loop. The
browser side sets a long timeout to match.

## The chat loop

`AgentOrchestrator` calls `litellm.completion` with the schemas in `tools.py`, dispatches the tools
in process, and ends when the model calls an answer-shaped tool.

| Tool | Does |
|---|---|
| `identify_facts` | Keyword search over the fact dictionary |
| `query_rag` | Cosine-similarity retrieval over the indexed publications |
| `submit_final_answer` | Terminal. Its arguments are rendered to Markdown by this module |

Rendering the answer from the terminal tool's arguments, rather than from free-text content, is what
keeps the response shape stable across models.

The module carries recovery paths for weak local models, which is the main reason it is longer than
the loop itself would need.

`identify_facts` returns **static structure only**: paths, names, types and dependency paths. Live
values are not read here. They come from the tracked-fact tree the browser sends in the request,
because the graph lives in the browser and this service has no session.

## The scenario loop

`ScenarioOrchestrator` is the same loop shape, with the scenarios and flow directories readable as
tools.

| Tool | Does |
|---|---|
| `list_scenarios` | Lists the committed scenario files |
| `read_scenario` | Reads one |
| `identify_facts` | As above |
| `search_flow` | Searches the flow XML |
| `query_rag` | As above |
| `submit_scenario` | Terminal |

**The model picks an existing scenario as a base, and this module applies only its validated
overrides on top.** The model does not author a whole graph, so a generated scenario inherits a
committed one's structure and can only differ where the overrides say so.

## The RAG index

`make index` runs `src.rag.indexer`. It chunks documents, embeds them with Ollama, and upserts into
ChromaDB.

| Constant | Value | Meaning |
|---|---|---|
| `_CHUNK_WORDS` | 600 | Target chunk size |
| `_OVERLAP_WORDS` | 50 | Overlap between consecutive chunks |
| `_MIN_CHUNK_WORDS` | 20 | Fragments smaller than this are dropped as nav scraps and stray cells |
| `_MAX_TABLE_CELLS` | 30 | Tables larger than this are skipped, which is what excludes the EIC lookup tables |

Skipping large tables is deliberate. A lookup table retrieved as prose is noise: the numbers are in
the fact dictionary, and the publications are indexed for their explanations.

**The PDF branch of `main` is commented out**, so a normal run indexes `HTML_DIR` only.

`retriever.py` embeds through the `ollama` client directly rather than through LiteLLM, so **a
running Ollama is required even when `LLM_MODEL` names a hosted provider**.

## Environment

| Variable | Default |
|---|---|
| `LLM_MODEL` | `ollama/llama3.1:8b` |
| `EMBEDDING_MODEL` | `nomic-embed-text` |
| `CHROMA_HOST` | `localhost` |
| `CHROMA_PORT` | `8001` |
| `CHROMA_COLLECTION` | `irs_publications` |
| `FACT_DICTIONARY_URL` | `fact-dictionary.xml` |
| `FLOW_DIR` | a path derived in the module |
| `SCENARIOS_DIR` | a path derived in the module |
| `HTML_DIR` | `data/html` |
| `PDF_DIR` | `data/irs_publications` |
| `FRONTEND_ORIGIN` | `http://localhost:3003,http://localhost:5180` |
| `LOG_LEVEL` | `INFO` |

`FRONTEND_ORIGIN` is comma-separated and drives CORS. The two defaults are credit-assistant's dev
server and Fact Explorer's.

## XML parsing is hardened

`dictionary.py` parses with a hardened lxml parser: no external entity resolution, no entity
expansion, no network fetches.

**`scenario_orchestrator.py` builds its own parser for the flow XML.** Keep the two in step. A
change to one that is not made to the other leaves half the service reading untrusted XML with a
permissive parser.

## Gotchas

| Watch out for | Why |
|---|---|
| A route answering 503 | An orchestrator failed to construct at import. Read the startup log |
| RAG failing with a hosted `LLM_MODEL` | Embeddings still go through Ollama directly |
| Expecting `make index` to pick up PDFs | The PDF branch is commented out |
| Expecting the chat to know live fact values | It reads static structure. Values arrive in the request |
| Hardening one XML parser and not the other | There are two, in `dictionary.py` and `scenario_orchestrator.py` |
| A long chat request appearing to hang | Handlers are synchronous and hold the request for the whole loop |
