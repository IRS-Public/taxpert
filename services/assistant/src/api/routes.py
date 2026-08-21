"""Sync HTTP routes for the chat API."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, HTTPException
from src.agent.orchestrator import AgentOrchestrator
from src.agent.scenario_orchestrator import ScenarioOrchestrator
from src.api.models import ChatRequest, ChatResponse, ScenarioRequest, ScenarioResponse

logger = logging.getLogger(__name__)

router = APIRouter()

_orchestrator: AgentOrchestrator | None = None
_scenario_orchestrator: ScenarioOrchestrator | None = None


def set_orchestrator(orchestrator: AgentOrchestrator | None) -> None:
    """Register the shared AgentOrchestrator instance."""
    global _orchestrator
    _orchestrator = orchestrator


def set_scenario_orchestrator(orchestrator: ScenarioOrchestrator | None) -> None:
    """Register the shared ScenarioOrchestrator instance."""
    global _scenario_orchestrator
    _scenario_orchestrator = orchestrator


@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    """Run the agent loop once and return the full answer."""
    request_id = str(uuid.uuid4())

    if _orchestrator is None:
        logger.warning("Orchestrator not available", extra={"request_id": request_id})
        raise HTTPException(
            status_code=503,
            detail=(
                "The AI agent is not available. Ensure Ollama is running "
                "(`ollama serve`) and Chroma is running, then restart the backend."
            ),
        )

    logger.info(
        "Chat request received",
        extra={"request_id": request_id, "prompt_len": len(request.prompt)},
    )

    try:
        content = _orchestrator.run(
            prompt=request.prompt,
            tracked_facts=request.tracked_facts,
            context=request.context,
        )
    except Exception as exc:
        logger.exception(
            "Agent error during chat handling: %s",
            exc,
            extra={"request_id": request_id},
        )
        raise HTTPException(status_code=500, detail=f"Agent error: {exc}")

    logger.info(
        "Chat response complete",
        extra={"request_id": request_id, "response_len": len(content)},
    )
    return ChatResponse(content=content)


@router.post("/scenario/generate", response_model=ScenarioResponse)
def scenario_generate(request: ScenarioRequest) -> ScenarioResponse:
    """Run the scenario-generation agent loop once and return a draft Fact Graph."""
    request_id = str(uuid.uuid4())

    if _scenario_orchestrator is None:
        logger.warning("Scenario orchestrator not available", extra={"request_id": request_id})
        raise HTTPException(
            status_code=503,
            detail=(
                "The scenario generator is not available. Ensure Ollama is running "
                "(`ollama serve`) and the scenarios/flow directories are readable, "
                "then restart the backend."
            ),
        )

    logger.info(
        "Scenario request received",
        extra={"request_id": request_id, "prompt_len": len(request.prompt)},
    )

    try:
        result = _scenario_orchestrator.run(prompt=request.prompt)
    except Exception as exc:
        logger.exception(
            "Agent error during scenario generation: %s",
            exc,
            extra={"request_id": request_id},
        )
        raise HTTPException(status_code=500, detail=f"Agent error: {exc}")

    logger.info(
        "Scenario response complete",
        extra={"request_id": request_id, "scenario_filename": result.filename},
    )
    return ScenarioResponse(
        scenario_json=result.scenario_json,
        filename=result.filename,
        description=result.description,
    )
