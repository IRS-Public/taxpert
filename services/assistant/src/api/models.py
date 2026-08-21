from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ChatRequest(BaseModel):
    """Inbound chat request from the frontend."""

    prompt: str
    # Either a plain list of fact paths, or a list of {path, value, ...} dicts.
    tracked_facts: list[Any] = []
    # Optional structured context for the "Explain this node" feature. A dict with a
    # `kind` discriminator: "fact" (a fact path), "flow" (a flow element's metadata
    # + bound fact + 1-hop neighbours), or "scenario" (the loaded scenario's outcome
    # + active knockouts). None for a plain audit-panel chat.
    context: dict[str, Any] | None = None


class ChatResponse(BaseModel):
    """Outbound chat response to the frontend."""

    content: str


class ScenarioRequest(BaseModel):
    """Inbound request to generate a Fact Graph scenario from a description."""

    prompt: str


class ScenarioResponse(BaseModel):
    """Outbound generated scenario.

    ``scenario_json`` is the serialized fact-graph object (a flat map of
    fact-path -> {"$type": ..., "item": ...} wrappers), exactly the shape of the
    files in credit-assistant/.../scenarios/. The frontend JSON.stringify's it
    before handing it to ``loadFactGraph()``.
    """

    scenario_json: dict[str, Any]
    filename: str
    description: str


class ErrorResponse(BaseModel):
    error: str
