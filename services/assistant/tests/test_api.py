"""Tests for the sync HTTP API (POST /chat, GET /health)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from src.api import routes as routes_module
from src.api.app import app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# /chat — orchestrator unavailable
# ---------------------------------------------------------------------------


def test_chat_returns_503_when_orchestrator_missing(client: TestClient) -> None:
    routes_module.set_orchestrator(None)

    response = client.post("/chat", json={"prompt": "hello", "tracked_facts": []})
    assert response.status_code == 503
    assert "AI agent is not available" in response.json()["detail"]


# ---------------------------------------------------------------------------
# /chat — happy path
# ---------------------------------------------------------------------------


def test_chat_returns_orchestrator_output(client: TestClient) -> None:
    fake_orchestrator = MagicMock()
    fake_orchestrator.run.return_value = "The taxpayer is eligible."
    routes_module.set_orchestrator(fake_orchestrator)

    try:
        response = client.post(
            "/chat",
            json={"prompt": "Is the taxpayer eligible?", "tracked_facts": ["/eitcEligible"]},
        )
        assert response.status_code == 200
        assert response.json() == {"content": "The taxpayer is eligible."}
        fake_orchestrator.run.assert_called_once_with(
            prompt="Is the taxpayer eligible?",
            tracked_facts=["/eitcEligible"],
            context=None,
        )
    finally:
        routes_module.set_orchestrator(None)


def test_chat_forwards_explain_context(client: TestClient) -> None:
    fake_orchestrator = MagicMock()
    fake_orchestrator.run.return_value = "ok"
    routes_module.set_orchestrator(fake_orchestrator)

    context = {"kind": "flow", "element": {"id": "p:fg-alert:ko", "tag": "fg-alert"}}
    try:
        response = client.post(
            "/chat",
            json={"prompt": "Explain this", "tracked_facts": [], "context": context},
        )
        assert response.status_code == 200
        fake_orchestrator.run.assert_called_once_with(
            prompt="Explain this",
            tracked_facts=[],
            context=context,
        )
    finally:
        routes_module.set_orchestrator(None)


# ---------------------------------------------------------------------------
# /chat — orchestrator raises
# ---------------------------------------------------------------------------


def test_chat_returns_500_on_orchestrator_error(client: TestClient) -> None:
    fake_orchestrator = MagicMock()
    fake_orchestrator.run.side_effect = RuntimeError("boom")
    routes_module.set_orchestrator(fake_orchestrator)

    try:
        response = client.post("/chat", json={"prompt": "trigger error", "tracked_facts": []})
        assert response.status_code == 500
        assert "Agent error" in response.json()["detail"]
    finally:
        routes_module.set_orchestrator(None)


# ---------------------------------------------------------------------------
# /chat — request validation
# ---------------------------------------------------------------------------


def test_chat_rejects_missing_prompt(client: TestClient) -> None:
    response = client.post("/chat", json={"tracked_facts": []})
    assert response.status_code == 422
