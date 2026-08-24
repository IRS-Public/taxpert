"""Pydantic request and response bodies for the two routes.

Shapes are mirrored in packages/ui and packages/fact-explorer, so a change here
needs a matching change there.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ChatRequest(BaseModel):
    """Inbound chat request from the frontend."""

    prompt: str
    # Either plain fact paths, or {path, value, complete, dependencies} dicts.
    tracked_facts: list[Any] = []
    # "Explain this node" payload, keyed by a `kind` of fact, flow or scenario.
    context: dict[str, Any] | None = None


class ChatResponse(BaseModel):
    """Outbound chat response to the frontend."""

    content: str


class ScenarioRequest(BaseModel):
    """Inbound request to generate a Fact Graph scenario from a description."""

    prompt: str


class ScenarioResponse(BaseModel):
    """Outbound generated scenario.

    ``scenario_json`` is a flat map of fact path to
    ``{"$type": ..., "item": ...}`` wrapper, the same shape as the files in an
    application's own scenarios/ directory.
    """

    scenario_json: dict[str, Any]
    filename: str
    description: str


class ErrorResponse(BaseModel):
    error: str
