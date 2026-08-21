from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.api.routes import router as chat_router
from src.api.routes import set_orchestrator, set_scenario_orchestrator
from src.logging_config import configure_logging

load_dotenv()
configure_logging(os.environ.get("LOG_LEVEL", "INFO"))

# Suppress LiteLLM's noisy startup warnings about optional AWS providers (botocore not installed).
logging.getLogger("LiteLLM").setLevel(logging.ERROR)

# LiteLLM reads OLLAMA_API_BASE for Ollama models; support the legacy OLLAMA_HOST name too.
if "OLLAMA_API_BASE" not in os.environ and "OLLAMA_HOST" in os.environ:
    os.environ["OLLAMA_API_BASE"] = os.environ["OLLAMA_HOST"]

logger = logging.getLogger(__name__)


# Default scenario/flow directories. The application lives in its own repository, checked out under
# the taxpert repo's apps/ directory by convention (see apps/README.md). `make dev` runs uvicorn from
# services/assistant/, so these resolve relative to that cwd; both are overridable via env, and the
# scenario orchestrator is simply unavailable when they do not exist.
_DEFAULT_SCENARIOS_DIR = "../../apps/credit-assistant/src/main/resources/credit-assistant/scenarios"
_DEFAULT_FLOW_DIR = "../../apps/credit-assistant/src/main/resources/credit-assistant/flow"


def _build_orchestrators():
    """Construct both orchestrators sharing the fact dictionary + RAG retriever.

    Returns ``(chat, scenario)``; either may be None if its dependencies are
    unreachable (Ollama/Chroma) or, for the scenario one, the directories are missing.
    """
    try:
        from src.agent.orchestrator import AgentOrchestrator
        from src.agent.scenario_orchestrator import ScenarioOrchestrator
        from src.facts.dictionary import FactDictionary
        from src.rag.retriever import (
            RagRetriever,
            get_chroma_client,
            get_collection_name,
        )

        fact_dict_source = os.environ.get(
            "FACT_DICTIONARY_PATH",
            os.environ.get("FACT_DICTIONARY_URL", "fact-dictionary.xml"),
        )
        embedding_model = os.environ.get("EMBEDDING_MODEL", "nomic-embed-text")

        fact_dictionary = FactDictionary.load(fact_dict_source)
        logger.info("Fact dictionary loaded: %d facts", len(fact_dictionary.facts_by_path))

        chroma_client = get_chroma_client()
        rag_retriever = RagRetriever(
            client=chroma_client,
            collection_name=get_collection_name(),
            embedding_model=embedding_model,
        )

        chat = AgentOrchestrator(
            fact_dictionary=fact_dictionary,
            rag_retriever=rag_retriever,
        )
        logger.info("AgentOrchestrator initialised (model=%s)", chat._model)

        scenario = ScenarioOrchestrator(
            fact_dictionary=fact_dictionary,
            rag_retriever=rag_retriever,
            scenarios_dir=os.environ.get("SCENARIOS_DIR", _DEFAULT_SCENARIOS_DIR),
            flow_dir=os.environ.get("FLOW_DIR", _DEFAULT_FLOW_DIR),
        )
        logger.info("ScenarioOrchestrator initialised (model=%s)", scenario._model)

        return chat, scenario

    except Exception as exc:
        logger.warning(
            "Could not initialise orchestrators (Ollama or Chroma may be unavailable): %s",
            exc,
        )
        return None, None


app = FastAPI(title="EITC Chat Backend", version="0.1.0")

# FRONTEND_ORIGIN is a comma-separated allow-list so the same backend can serve both
# the credit-assistant audit panel (:3003) and Fact Explorer (:5180). Each browser
# preflight (OPTIONS) carries an Origin header that must match one of these, or the
# CORS middleware refuses the request and it falls through to a 400.
_frontend_origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGIN", "http://localhost:3003,http://localhost:5180").split(
        ","
    )
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(chat_router)

_chat_orchestrator, _scenario_orchestrator = _build_orchestrators()
set_orchestrator(_chat_orchestrator)
set_scenario_orchestrator(_scenario_orchestrator)
