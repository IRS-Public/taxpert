# AI integration

This document describes how large language models are used in the Taxpert platform today, what
the two shipped AI surfaces do, how to turn them on, where their limits are, and what expansion
the project proposes. It is written for an engineer or architect deciding whether to build on
these surfaces. Two names appear throughout and mean different things: **Taxpert** is the whole
repository and platform, while the **`taxpert` package** is the optional npm workspace UI in
`packages/ui/` that renders the global nav, audit panel and tool panels over a running application.

## Related documents

- [Onboarding](./onboarding.md) for running the stack, including the api service and Ollama
- [Release status](./release-status.md) for component maturity
- [Why Taxpert](./why-taxpert.md) for the rationale behind the platform
- [Architecture](./architecture.md) for how the pieces fit together
- [Deployment](./deployment.md) for deployment topologies and CI
- [Root README](../README.md)

---

## 1. Design position

AI sits entirely outside the taxpayer-facing calculation path.

Eligibility and amounts are computed by the fact graph, a declarative Scala rules engine
cross-compiled to Scala.js and evaluated in the browser. No model output is consulted during that
evaluation. The two AI surfaces that exist are internal tooling for engineers and tax subject
matter experts, and both are gated behind build flags that default to off.

Three facts support this, each verifiable in the code:

| Claim | Where to check |
|---|---|
| The AI surfaces live in the workspace UI, which only mounts under `--auditMode` | `form-builder/src/main/resources/form-builder/templates/page.html` line 154, `th:if="${flags.auditMode}"` |
| Both AI features are additionally gated by their own default-off flags | `form-builder/src/main/scala/gov/irs/formbuilder/build/Flags.scala`, `aiScenarioGeneration` and `aiFactExplanation` |
| The api service is optional and absent from a production build | In the example applications' repository, `tax-withholding-estimator/src/main/resources/twe/templates/fragments/audit-panel.html` sets no `api-base` at all, and that application ships with no chat backend |

One nuance deserves stating plainly. The scenario generator does write into a fact graph.
`generateScenarioFromPrompt()` in `packages/ui/src/audit-panel/js/fact-graph-io.js` calls
`getConfig().graph.load(serialized)`, replacing the graph in the current browser session, and the
application recomputes eligibility from it. What the model supplies is a set of **writable input
facts**, in a developer's own session, in a build with the workspace and the flag switched on. The
model never produces a determination, a dollar amount or a derived fact, and
`ScenarioOrchestrator._validate_wrapper` refuses any override whose path is derived rather than
writable. No path was found in which an LLM output reaches a taxpayer-visible calculation in a
production build.

---

## 2. What exists today

Two backend surfaces, one health check, one shared retrieval corpus. Everything is served by the
FastAPI service in `services/assistant/`, which listens on port 8000. On the browser side, one of the two surfaces
is fully wired in the applications and the other is reachable only from Fact Explorer, which
[Limitations](#5-limitations) covers.

### 2.1 Fact explanation and audit-panel chat

**What it does.** A subject matter expert asks a question in plain language about facts currently
in view. The answer is grounded in the live dependency values from the fact graph, in the fact
dictionary, and optionally in indexed IRS publications. Fact Explorer offers this from its canvas,
with an "Explain this node" button on fact nodes, flow elements and scenario summaries.

**Reachability caveat, verified.** Fact Explorer's `ChatPanel.jsx` is the only surface that reaches
`POST /chat` today. The audit-panel version exists in the `taxpert` package but is not reachable in
either Scala application. Read the note in [Limitations](#5-limitations) before planning around it.

**Endpoint.** `POST /chat`. Request (`services/assistant/src/api/models.py`, `ChatRequest`):

| Field | Type | Notes |
|---|---|---|
| `prompt` | string | Required. |
| `tracked_facts` | array | Defaults to `[]`. Either plain fact paths, or `{path, value, complete, dependencies}` objects resolved from the live graph. |
| `context` | object or null | Optional. Carries a `kind` discriminator of `fact`, `flow` or `scenario`. |

Response: `{ "content": "<markdown>" }`.

The browser builds `tracked_facts` by walking each tracked fact's dependency tree against the live
graph, bounded to depth 4 and 50 nodes (`FACT_TREE_MAX_DEPTH` and `FACT_TREE_MAX_NODES` in
`packages/ui/src/audit-panel/js/chat.js`, mirrored in `packages/fact-explorer/src/model/explainContext.js`).
That tree is the model's primary evidence, and the system prompt instructs it to read values from
the tree rather than inventing them.

**Tools available to the model** (`services/assistant/src/agent/tools.py`):

| Tool | Backing implementation |
|---|---|
| `identify_facts` | `services/assistant/src/facts/search.py`. Three tiers: exact path match, then tracked-fact match, then weighted keyword scoring where path and name hits score 3 and description hits score 1. Returns at most 5 facts. |
| `query_rag` | `services/assistant/src/rag/retriever.py`. Embeds the query with Ollama, cosine-queries the Chroma collection, returns the 5 nearest chunks with their heading breadcrumb. |
| `submit_final_answer` | Terminal. The backend renders `direct_answer`, `reasoning_trace`, `what_would_change` and `citations` into Markdown itself, so the formatting does not depend on the model. |

**Ordering.** The system prompt in `services/assistant/src/agent/prompts.py` makes the ordering explicit. Step 1
is `identify_facts`, and only when the dependency tree is insufficient. Step 2 is `query_rag`, and
only when a dollar threshold, eligibility rule or citation needs official grounding. The prompt
tells the model to skip retrieval for facts named `flowShould*`, `flowClickedNext*` or
`flowConfirmation*`, which are internal page-visibility gates that no IRS publication covers.

**Iteration cap.** `MAX_ITERATIONS = 10` in `services/assistant/src/agent/orchestrator.py`.

**Model configuration.** `LLM_MODEL`, default `ollama/llama3.1:8b`.

**Build flag.** `aiFactExplanation`. It becomes the `ai-fact-explanation-default` attribute on the
`<taxpert-audit-panel>` element, which the workspace reads as a build-time default and can override
at runtime.

### 2.2 Scenario generation

**What it does.** Turns a plain-language description of a test case ("head of household, two
qualifying children, disqualified on investment income") into a draft serialized fact graph, loads
it into the current browser session, and offers it as a download.

**Endpoint.** `POST /scenario/generate`.

Request: `{ "prompt": "<description>" }`.

Response: `{ "scenario_json": {...}, "filename": "...", "description": "..." }`.

**Tools** (`services/assistant/src/agent/scenario_tools.py`): `list_scenarios`, `read_scenario`,
`identify_facts`, `search_flow`, `query_rag`, and the terminal `submit_scenario`.

**The hybrid clone-or-build strategy.** The model does not author a whole fact graph. It picks the
nearest existing scenario from `list_scenarios` as `base_filename`, and the backend clones that
known-good serialization and applies only the model's overrides on top
(`ScenarioOrchestrator._build_from_submission`). Filenames encode their dimensions, so
`dq_mfs_2024_1tp_3qcs_59899.json` decodes to disqualifying, married filing separately, 2024, three
qualifying children. When a weak model invents a plausible filename that does not exist,
`_resolve_base` falls back to the existing file sharing the most underscore tokens, requiring at
least two. If the model never submits cleanly, the loop returns the closest existing scenario
rather than failing.

**Server-side validation is best effort.** `_validate_wrapper` checks per override that the `item`
matches its `$type` (a `DollarWrapper` item must be a string, an `IntWrapper` item an int and
explicitly not a bool, an `EnumWrapper` item an object with string `value` and `enumOptionsPath`),
and that the path resolves to a known **writable** fact after normalizing any `/#<uuid>` collection
segment to the abstract `/*` form. Paths under `/meta/` are exempt. Invalid overrides are dropped
and logged, and the base graph is returned unchanged for those paths, so the result stays loadable.

**The browser is the final validator.** `getConfig().graph.load()` runs `GraphFactory.fromJSON`,
which throws synchronously before the page reload, and `fact-graph-io.js` catches that and reports
it in the panel.

**The backend never writes to disk.** The generated scenario is returned in the response body,
stashed in sessionStorage across the reload, and offered through a Download button. Placing the
file into the application's own `src/main/resources/<appId>/scenarios/` is a manual step, in that
application's repository.

**Iteration cap.** `MAX_ITERATIONS = 12` in `services/assistant/src/agent/scenario_orchestrator.py`. At iteration
`MAX_ITERATIONS - 4` the loop injects a one-time nudge telling the model to stop exploring and
commit.

**Model configuration.** `SCENARIO_LLM_MODEL`, falling back to `LLM_MODEL`. **Build flag.**
`aiScenarioGeneration`.

### 2.3 Retrieval (RAG)

| Aspect | Current state |
|---|---|
| Store | ChromaDB, HTTP server mode, default `localhost:8001`, collection `irs_publications` created with `{"hnsw:space": "cosine"}` |
| Embedding model | `EMBEDDING_MODEL`, default `nomic-embed-text`, called through the `ollama` Python client directly rather than through LiteLLM |
| Chunking | Split into sections by heading, then overlapping chunks of about 600 words with 50 words of overlap. Chunks under 20 words are dropped. Each chunk is prefixed with its `A > B > C` heading breadcrumb before embedding. |
| Ids | `<source>:<chunk_index>`, so re-indexing updates in place |
| Corpus committed | One document, `services/assistant/data/html/pub_596.html` (IRS Publication 596). `services/assistant/data/irs_publications/` is gitignored. |
| Build command | `make index` from `services/assistant/`, which runs `python -m src.rag.indexer` |

**What the indexer actually handles today.** Verified in `services/assistant/src/rag/indexer.py`: the PDF loop in
`main()` is commented out (lines 432 to 438), so `make index` processes `data/html/*.html` and
`*.htm` only. `extract_pdf_chunks` is fully implemented and still exercised by `tests/test_rag.py`,
so uncommenting the loop restores PDF ingestion. `services/assistant/docker-entrypoint.sh` still describes its
first-run indexing as embedding `services/assistant/data/irs_publications/*.pdf`, which no longer matches.

The HTML extractor is tuned for IRS pages on the Drupal "barrio" theme. It picks the largest
`field--name-body` div as the content root, maps heading role classes to logical outline depth
rather than trusting the `h` tag number, and drops tables with more than 30 cells so the EIC lookup
tables do not flood the index.

### 2.4 `GET /health`

Returns `{"status": "ok"}` with HTTP 200 for as long as the process is up. It does not check
Ollama, Chroma, or whether either orchestrator was constructed. A running service with an
unreachable model still answers 200 here and 503 on `/chat`.

### 2.5 Turning the surfaces on

Both orchestrators are constructed at import time in `services/assistant/src/api/app.py`. If Ollama, Chroma or the
fact dictionary is unreachable, construction fails quietly and the routes answer 503 with a message
naming what to start.

From `credit-assistant/`, `make dev-ai` runs `sbt '~run --serve --auditMode --allScreens
--scenarioMode --aiScenarioGeneration --aiFactExplanation'`. The plain `make dev` target enables
the workspace without either AI feature. Note that only `--aiScenarioGeneration` currently changes
anything visible in the application, for the reason given in [Limitations](#5-limitations).

Either flag can also be toggled at runtime from the Workspace settings dialog behind the global
nav's gear, which writes a localStorage override under `taxpert:featureFlags`. The resolution order
is runtime override first, build-time attribute default second
(`packages/ui/src/audit-panel/js/feature-flags.js`).

The backend base URL resolves in this order (`fact-graph-io.js` and `chat.js`):

1. the `api-base` attribute on `<taxpert-audit-panel>`
2. `configure({ endpoints: { apiBase } })` in `packages/ui/src/shared/js/config.js`
3. the default `http://localhost:8000`

Full setup steps for the api service, Ollama and Chroma live in [Onboarding](./onboarding.md).

---

## 3. The architecture of the loop

Both orchestrators follow the same shape. Build a message list, call `litellm.completion` with a
tool schema, dispatch any tool calls in process, append the results, and repeat until the model
calls the terminal tool or the iteration budget runs out. Tool results longer than 8000 characters
are trimmed to 6000 before going back into history, with a marker noting the trim.

```
  Browser                          api service (FastAPI, :8000)
  ---------------------------      ---------------------------------
  fact-explorer ChatPanel.jsx  ---> POST /chat
  audit-panel/fact-graph-io.js ---> POST /scenario/generate
  audit-panel/chat.js (dormant)---> GET  /health
                                             |
                                             v
                                  +---------------------------+
                                  | Orchestrator loop         |
                                  |   chat:     max 10 rounds |
                                  |   scenario: max 12 rounds |
                                  +-----+---------------+-----+
                                        |               ^
                     litellm.completion |               | tool results
                     (model, messages,  |               | (8000 -> 6000 chars)
                      tools)            v               |
                                  +---------------------------+
                                  | LiteLLM provider router   |
                                  |  ollama/ anthropic/       |
                                  |  openai/                  |
                                  +-------------+-------------+
                                                v
                                  +---------------------------+
                                  | Ollama :11434 on the host |
                                  | or a hosted provider API  |
                                  +---------------------------+

  Tool dispatch, inside the api process:

    identify_facts  -> FactDictionary, parsed at startup
    query_rag       -> Ollama embed, then ChromaDB :8001 cosine query
    search_flow     -> flow/*.xml on disk          (scenario loop only)
    list_scenarios  -> scenarios/*.json on disk    (scenario loop only)
    read_scenario   -> scenarios/*.json on disk    (scenario loop only)
    submit_final_answer / submit_scenario -> terminal, ends the loop
```

The whole loop is synchronous. The route handlers are plain `def` functions, and the browser holds
one open request for the duration, with a 90 second `AbortController` timeout on both surfaces.

When the chat loop exhausts its 10 rounds without a terminal call, it logs a warning and returns a
fixed apology string. When the scenario loop exhausts its 12, it returns the closest matching
existing scenario as a fallback, or raises if nothing matches, which becomes a 500.

The chat loop carries a noticeable amount of recovery logic for weaker local models. It accepts
answer-shaped hallucinated tool names such as `final_answer` or `respond_to_user`, unwraps a nested
`{"arguments": ...}` envelope, and parses a fenced JSON blob returned as plain content rather than
showing it raw.

---

## 4. Model choice and provider portability

Model access goes through LiteLLM, so the provider is selected by the prefix on one environment
variable and needs no code change.

| Provider | `LLM_MODEL` value | Credential |
|---|---|---|
| Ollama, local | `ollama/llama3.1:8b` | none, set `OLLAMA_API_BASE` |
| Anthropic | `anthropic/claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai/gpt-4o` | `OPENAI_API_KEY` |

`SCENARIO_LLM_MODEL` overrides the model for `/scenario/generate` only, falling back to `LLM_MODEL`
when unset. Emitting an exact fact-graph serialization benefits more from a strong model than
answering a question does, so pointing only that route at a hosted model is a reasonable middle
setting.

Two consequences of switching to a hosted provider are worth planning for.

**Embeddings stay local.** `src/rag/indexer.py` and `src/rag/retriever.py` call the `ollama` Python
client directly rather than routing through LiteLLM. `EMBEDDING_MODEL` therefore still requires a
running Ollama with `nomic-embed-text` pulled, even when `LLM_MODEL` names a hosted provider.

**Prompt contents leave the machine.** Every request sends the system prompt plus the user message
to a third party. That payload contains fact paths, the resolved values and completeness flags of
the tracked dependency tree, fact descriptions returned by `identify_facts`, retrieved passages
from indexed publications, and, for scenario generation, the full contents of any scenario files
`read_scenario` returned. Treat that as an outbound data flow and review it against whatever
data-handling policy applies. The surfaces are designed around the fact dictionary and synthetic
scenarios, so nothing here should be real taxpayer data, and the review is still the operator's
to do.

---

## 5. Limitations

These are verified against the code as it stands.

| Limitation | Detail |
|---|---|
| The audit-panel chat does not render in either application | The chat is a section of the audit panel's legacy rail, which is hidden unless a host declares `legacyAuditPanel`, and neither application does. Detailed below the table. |
| Alpha maturity, no versioned API contract | The FastAPI app declares `title="EITC Chat Backend", version="0.1.0"`. There is no `/v1` prefix, no deprecation policy, and the response shapes are free to change. |
| No streaming | Routes are synchronous `def` handlers returning the finished answer. Perceived latency is the full loop, including every tool round trip. The browser shows a ticking "Thinking (Ns)" status because there is nothing else to show. |
| Fixed iteration cap | Chat stops at 10 rounds and returns a fixed "unable to complete the analysis" string. Scenario generation stops at 12 and silently substitutes the closest existing scenario, which can look like a successful generation. |
| No authentication | `services/assistant/src/api/app.py` adds no auth dependency, no API key check and no session handling. Any client that can reach the port can post to either route. |
| CORS is the only access control | `FRONTEND_ORIGIN` is a comma-separated allow-list, defaulting to `http://localhost:3003,http://localhost:5180`. It constrains browsers only. A direct `curl` is unaffected. |
| No rate limiting or cost control | No per-IP or per-user quota, no request budget, no token accounting. With a hosted provider, an open port is an open billing surface. |
| No evaluation harness | `services/assistant/tests/` mocks the model completely. Every orchestrator test patches `src.agent.orchestrator.litellm.completion` or its scenario equivalent with a scripted `MagicMock` sequence. The tests cover loop mechanics, answer rendering, override validation and fallback selection. They assert nothing about answer quality, and no fixed question set is graded against the fact dictionary. |
| Generated scenarios are drafts | Validation covers wrapper shape and writability per overridden path. It does not check that the scenario is internally coherent, that it exercises the knockout the description claims, or that the resulting outcome is the intended one. |
| Small, manually indexed corpus | One committed document, indexed by an operator running `make index`. There is no freshness check, no re-index trigger on source change, and no recorded publication date or revision. Retrieved chunks carry a source name and heading breadcrumb, and `source_url` is read back from metadata that the current indexer never writes. |
| Local model quality | The default is an 8B-class model. The volume of recovery code for hallucinated tool names, malformed arguments and invented filenames is a direct measure of how often it goes wrong. |
| No prompt-injection hardening | Retrieved document text, existing scenario file contents and flow XML snippets are placed into tool-result messages verbatim. Nothing scans them for instructions, and nothing marks them as untrusted to the model. |

### The audit-panel chat is currently unreachable in both applications

This is a real defect, verified in the code, and the most important thing to know before building
on the chat surface.

The "Explain and Analyze" chat is registered as a **rail section** of the audit panel
(`packages/ui/src/audit-panel/js/sections.js`, `sectionId: 'audit-panel-explain-section'`, template
`tap-explain` in `packages/ui/src/audit-panel/templates/audit-panel.html`). The rail has been
superseded by the tool panels and is hidden by default in
`packages/ui/src/audit-panel/styles/panel-shell.css`:

```css
body.audit-mode:not(.ff-legacy-audit-panel) .audit-panel {
  display: none;
}
```

The `<taxpert-audit-panel>` element adds the `audit-panel` class to itself, so that rule hides the
element and its section content area. The `legacyAuditPanel` flag would reveal it, and neither
application declares that flag: credit-assistant's `taxpert-config.html` lists exactly
`aiScenarioGeneration` and `aiFactExplanation`, and tax-withholding-estimator lists none, its
config recording that it retired `legacyAuditPanel` deliberately.

`initChat()` still runs at `packages/ui/src/audit-panel/js/taxpert-audit-panel.js:384`, so the code is
live and wired inside a `display: none` container. Running `make dev-ai` passes
`--aiFactExplanation` and reveals nothing in the application UI, which makes that a declared flag
that moves nothing. The `panel-shell.css` comment states the governing rule directly, that a
declared flag must move something.

Two options exist for whoever picks this up. Re-home the chat into a tool panel alongside Inspect,
Outcome tracker and Watchlist, which is where the rail's other reasons for existing already went.
Or drop `aiFactExplanation` from the applications' flag lists until a surface exists behind it. The
backend endpoint, the orchestrator and their tests are unaffected either way.

A related inconsistency, now resolved: `packages/fact-explorer/src/canvas/ChatPanel.jsx` used to
hardcode `const CHAT_API_URL = 'http://localhost:8000/chat'` rather than read
`config.endpoints.apiBase`. It now calls `chatApiUrl()`, which reads that config at call time —
the same order `packages/ui/src/audit-panel/js/chat.js` uses. The `apiBase` the Workspace settings
modal offers therefore reaches both callers, and a deployment with the backend elsewhere works.

---

## 6. How AI should be used here

The intended posture is narrow and worth stating as rules.

- **Use it as an accelerator for internal work.** Understanding why a fact resolved the way it did,
  finding the relevant fact paths, drafting a test scenario, locating the passage in a publication
  that a rule came from.
- **Keep a human reviewer on every output.** These surfaces are built for tax subject matter
  experts and engineers who can tell a right answer from a plausible one.
- **Never treat output as a tax determination.** The fact graph is the authority on eligibility and
  amounts. An explanation is a description of what the graph computed, and it can be wrong about
  that description while the graph remains right.
- **Never put it in the taxpayer path.** No taxpayer-facing screen calls the api service, and none
  should. The workspace mounts only under `--auditMode`.
- **Treat every output as a draft.** Especially citations. The prompt instructs the model to emit
  `citations` only for passages it actually retrieved, and the tool description repeats the
  instruction, which is guidance rather than enforcement.
- **Validate a generated scenario by loading it.** This is the operational rule. The backend's
  checks are partial by design, and `GraphFactory.fromJSON` in the browser is the real validator.
  A scenario that has not been loaded in the browser has not been validated. Confirm that it
  reaches the outcome its description claims before committing it to `scenarios/`.

---

## 7. Proposed expansion

Everything in this section is a proposal. None of it has been built.

One note on prior art. The typed-context idea below is not hypothetical — it has already landed. `packages/fact-explorer/src/model/explainContext.js`, the `context` field on
`ChatRequest`, the "Explain Context" section of the system prompt, the `EXPLAIN_BADGE` token in
`packages/fact-explorer/src/canvas/style.js` and `packages/fact-explorer/tests/explainContext.test.js` all exist. It
is best read now as the pattern to copy: define a typed context payload, build it with pure and
testable functions, and give the system prompt an explicit section describing how to read it.

The directions below are ordered roughly by cost.

| Direction | What would have to be built | Risk |
|---|---|---|
| **Re-home the chat into a tool panel** | A fourth tool registered beside Inspect, Outcome tracker and Watchlist, reusing `chat.js` unchanged, so `aiFactExplanation` gates something visible again | Lowest of these, and the prerequisite for the applications having a chat surface at all. |
| **Streaming responses** | Async orchestrator loops, a server-sent-events or chunked response, matching client rendering in `chat.js` and `ChatPanel.jsx` | Low and mostly mechanical. One design question: the chat loop currently renders `submit_final_answer` fields into Markdown deterministically, so streaming has to choose between the model's raw prose and the rendered structure. |
| **Evaluation harness** | A fixed question set with expected fact paths and outcomes, a grader that checks cited paths against the fact dictionary and values against committed scenarios, a separate make target | A fixed set becomes a target and stops representing real questions. It needs periodic replacement rather than only extension. |
| **Wider RAG corpus with provenance shown** | Metadata capture in `indexer.py` (`source_url` is already read by the retriever and never written), a corpus manifest with publication revision and index date, citation rendering in both clients | A larger untrusted corpus is a larger prompt-injection surface, which makes the hardening gap above more pressing. |
| **Authoring assistance** (flow XML, locale strings) | Tools that read the RNG schemas and existing flow modules, a validation step against `make validate-xml`, a review surface that shows a diff | Generated flow XML that validates can still be wrong in ways only a tax expert catches. It must produce a proposed diff and never a write. |
| **Batch test-scenario generation** | A batch mode over the existing generator, coverage tracking against the flow's knockouts, an automated load-and-assert step | A suite that grows faster than anyone reviews it, which is worse than a small hand-written one. |
| **Explanations tied to the real derivation chain** | An exported derivation trace from the fact graph, a tool that queries it, a validation step rejecting a `reasoning_trace` entry naming a fact not on the real path | Couples the api service to a fact-graph internal that is currently a debugging aid. |
| **Content review assistance** | A batch route over locale YAML for plain-language and reading-level checks, plus a review surface | Low, since nothing is applied automatically. Translated locales need a model genuinely competent in each of the seven shipped languages. |

The strongest single argument for the evaluation harness is that it is a precondition for most of
the others. Without it, there is no way to tell whether a corpus change, a model swap or a prompt
edit made answers better or worse.

---

## 8. Operational and security notes

**Logging.** `services/assistant/src/logging_config.py` installs a JSON formatter on the root logger, controlled
by `LOG_LEVEL` (default `INFO`, absent from `.env.example`). What reaches the logs:

| Logged | Not logged |
|---|---|
| A per-request UUID, `prompt_len`, `response_len` (`routes.py`) | The prompt text itself |
| Tool name and full tool arguments at INFO in the chat loop (`orchestrator.py`) | Tool arguments in the scenario loop, which logs the tool name only |
| Dropped override validation errors, including the offending fact path | Model responses |
| Full exception tracebacks on a 500 | |

The chat loop's `logger.info("Executing tool '%s' with args %s", ...)` line means every
`identify_facts` and `query_rag` query string lands in the logs at default level. Set `LOG_LEVEL`
to `WARNING` if that is not acceptable in a given environment.

**No taxpayer PII should reach these surfaces.** They operate on the fact dictionary, which is a
schema rather than data, and on synthetic scenarios committed to the repository. There is no
mechanism preventing someone typing real data into a prompt, so this is a policy, enforced by how
the surfaces are used rather than by code.

**CORS.** `FRONTEND_ORIGIN` is parsed into a list and passed to Starlette's `CORSMiddleware` with
`allow_credentials=True`, `allow_methods=["*"]` and `allow_headers=["*"]`. The default allows
`http://localhost:3003` and `http://localhost:5180`, and `docker-compose.yml` sets the same two
explicitly. Because credentials are allowed, the origin list must stay exact.

**Do not expose the api service publicly as configured.** It has no authentication, no rate
limiting, and a `/scenario/generate` route that reads files from configured directories on disk.
Filename traversal is guarded (`_read_scenario` strips directory components with `Path(...).name`,
and `_FILENAME_RE` restricts the output filename), and XML parsing is hardened against XXE and
entity expansion in both `facts/dictionary.py` and `scenario_orchestrator.py`. None of that
substitutes for keeping the port on a trusted network. See [Deployment](./deployment.md).

**Test status.** `cd api && make test` was run while writing this document: 60 tests passed in
1.71 seconds, with 44 warnings, all of them deprecation notices from Starlette's test client and
ChromaDB's telemetry module. The suite requires no network, no Ollama and no Chroma, because
`litellm.completion` is mocked in every orchestrator test.
