"""Tests for the scenario-generation route + ScenarioOrchestrator (mocked LiteLLM).

Mirrors test_api.py (route-level 503/500/happy-path) and test_orchestrator.py (loop with
a mocked litellm.completion). No real network, Ollama, or Chroma.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from src.agent.scenario_orchestrator import (
    MAX_ITERATIONS,
    GeneratedScenario,
    ScenarioOrchestrator,
    _parse_scenario_filename,
)
from src.api import routes as routes_module
from src.api.app import app
from src.facts.dictionary import Fact, FactDictionary
from src.rag.retriever import RagRetriever


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


# ---------------------------------------------------------------------------
# Route-level
# ---------------------------------------------------------------------------


def test_scenario_returns_503_when_orchestrator_missing(client: TestClient) -> None:
    routes_module.set_scenario_orchestrator(None)
    response = client.post("/scenario/generate", json={"prompt": "single, 0 kids, 2023"})
    assert response.status_code == 503
    assert "scenario generator is not available" in response.json()["detail"]


def test_scenario_returns_generated_payload(client: TestClient) -> None:
    fake = MagicMock()
    fake.run.return_value = GeneratedScenario(
        scenario_json={"/jobsIncomeTotal": {"$type": "DollarWrapper", "item": "17639.00"}},
        filename="single_2023_1tp_0qc_17639.json",
        description="A single filer with no qualifying children.",
    )
    routes_module.set_scenario_orchestrator(fake)
    try:
        response = client.post("/scenario/generate", json={"prompt": "single, 0 kids, 2023"})
        assert response.status_code == 200
        body = response.json()
        assert body["filename"] == "single_2023_1tp_0qc_17639.json"
        assert body["scenario_json"]["/jobsIncomeTotal"]["$type"] == "DollarWrapper"
        fake.run.assert_called_once_with(prompt="single, 0 kids, 2023")
    finally:
        routes_module.set_scenario_orchestrator(None)


def test_scenario_returns_500_on_error(client: TestClient) -> None:
    fake = MagicMock()
    fake.run.side_effect = RuntimeError("boom")
    routes_module.set_scenario_orchestrator(fake)
    try:
        response = client.post("/scenario/generate", json={"prompt": "trigger error"})
        assert response.status_code == 500
        assert "Agent error" in response.json()["detail"]
    finally:
        routes_module.set_scenario_orchestrator(None)


def test_scenario_rejects_missing_prompt(client: TestClient) -> None:
    response = client.post("/scenario/generate", json={})
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Orchestrator helpers / fixtures
# ---------------------------------------------------------------------------


def _make_tool_call(name: str, arguments: Any, call_id: str = "call_1") -> MagicMock:
    tc = MagicMock()
    tc.id = call_id
    tc.function.name = name
    tc.function.arguments = arguments
    return tc


def _make_response(content: str | None = None, tool_calls: list | None = None) -> MagicMock:
    msg = MagicMock()
    msg.content = content or ""
    msg.tool_calls = tool_calls or []
    msg.model_dump.return_value = {"role": "assistant", "content": content or "", "tool_calls": []}
    choice = MagicMock()
    choice.message = msg
    response = MagicMock()
    response.choices = [choice]
    return response


def _sequence(*responses: MagicMock):
    state = {"count": 0}

    def fake_completion(**kwargs):
        idx = state["count"]
        state["count"] += 1
        return responses[min(idx, len(responses) - 1)]

    return fake_completion, state


def _dictionary() -> FactDictionary:
    d = FactDictionary()

    def add(path: str, writable: bool) -> None:
        d.facts_by_path[path] = Fact(
            path=path, name="", description="", is_writable=writable, type_name="", dependencies=[]
        )

    add("/jobsIncomeTotal", True)
    add("/ageRange", True)
    add("/initialFilingStatus", True)
    add("/familyAndHousehold", True)
    add("/familyAndHousehold/*/relationship", True)
    add("/agi", False)  # derived — scenarios may not set it
    return d


_BASE_SINGLE = {"/jobsIncomeTotal": {"$type": "DollarWrapper", "item": "17639.00"}}
_BASE_MFS_3QC = {
    "/initialFilingStatus": {
        "$type": "EnumWrapper",
        "item": {"value": "mfs", "enumOptionsPath": "/filingStatusOptions"},
    },
    "/jobsIncomeTotal": {"$type": "DollarWrapper", "item": "59899.00"},
}


def _orchestrator(tmp_path: Path) -> ScenarioOrchestrator:
    scenarios = tmp_path / "scenarios"
    flow = tmp_path / "flow"
    scenarios.mkdir()
    flow.mkdir()
    (scenarios / "single_2023_1tp_0qc_17639.json").write_text(json.dumps(_BASE_SINGLE))
    (scenarios / "dq_mfs_2024_1tp_3qcs_59899.json").write_text(json.dumps(_BASE_MFS_3QC))
    (flow / "agi.xml").write_text(
        '<Flow><fg-alert knockout="true" condition="/investmentIncomeWithinLimit" '
        'operator="isFalse">Too much investment income</fg-alert></Flow>'
    )
    rag = MagicMock(spec=RagRetriever)
    rag.query = MagicMock(return_value=[])
    return ScenarioOrchestrator(
        fact_dictionary=_dictionary(),
        rag_retriever=rag,
        scenarios_dir=str(scenarios),
        flow_dir=str(flow),
        model="test-model",
    )


def _submit(base_filename: str, overrides: list | None = None, **extra) -> MagicMock:
    args = {
        "base_filename": base_filename,
        "overrides": overrides or [],
        "description": extra.get("description", "A scenario."),
        "filename": extra.get("filename", "out.json"),
    }
    return _make_response(
        tool_calls=[_make_tool_call("submit_scenario", args, extra.get("id", "c1"))]
    )


# ---------------------------------------------------------------------------
# Orchestrator loop — base clone + overrides
# ---------------------------------------------------------------------------


def test_submit_clones_base_and_applies_override(tmp_path: Path) -> None:
    orch = _orchestrator(tmp_path)
    fake, state = _sequence(
        _submit(
            "dq_mfs_2024_1tp_3qcs_59899.json",
            overrides=[
                {
                    "path": "/jobsIncomeTotal",
                    "wrapper": {"$type": "DollarWrapper", "item": "250000.00"},
                }
            ],
            filename="dq_mfs_2024_1tp_3qcs_250000.json",
        ),
    )
    with patch("src.agent.scenario_orchestrator.litellm.completion", side_effect=fake):
        result = orch.run("250k AGI, MFS, 3 QCs")

    assert state["count"] == 1
    # untouched base facts preserved, override applied
    assert result.scenario_json["/initialFilingStatus"]["item"]["value"] == "mfs"
    assert result.scenario_json["/jobsIncomeTotal"] == {
        "$type": "DollarWrapper",
        "item": "250000.00",
    }
    assert result.filename == "dq_mfs_2024_1tp_3qcs_250000.json"


def test_invented_base_filename_fuzzy_resolves(tmp_path: Path) -> None:
    """The reported bug: model invents dq_mfs_married_2024_1tp_3qcs_250000.json."""
    orch = _orchestrator(tmp_path)
    fake, _ = _sequence(_submit("dq_mfs_married_2024_1tp_3qcs_250000.json"))
    with patch("src.agent.scenario_orchestrator.litellm.completion", side_effect=fake):
        result = orch.run("MFS married 3 QCs 250k")
    # Resolves to the real MFS 3-QC base, which loads fine.
    assert result.scenario_json == _BASE_MFS_3QC


def test_invalid_override_is_dropped_base_preserved(tmp_path: Path) -> None:
    orch = _orchestrator(tmp_path)
    fake, _ = _sequence(
        _submit(
            "single_2023_1tp_0qc_17639.json",
            overrides=[
                {"path": "/agi", "wrapper": {"$type": "DollarWrapper", "item": "1.00"}},  # derived
                {
                    "path": "/x",
                    "wrapper": {"$type": "DollarWrapper", "item": ["bad"]},
                },  # array item
            ],
        )
    )
    with patch("src.agent.scenario_orchestrator.litellm.completion", side_effect=fake):
        result = orch.run("single 0 kids")
    # Bad overrides dropped; base graph intact and loadable.
    assert result.scenario_json == _BASE_SINGLE


def test_unresolvable_base_retries_then_raises(tmp_path: Path) -> None:
    orch = _orchestrator(tmp_path)
    fake, state = _sequence(_submit("zzzzz.json"))
    with patch("src.agent.scenario_orchestrator.litellm.completion", side_effect=fake):
        with pytest.raises(RuntimeError):
            orch.run("nonsense base")
    assert state["count"] >= 2  # retried at least once before raising


def test_filename_is_sanitised(tmp_path: Path) -> None:
    orch = _orchestrator(tmp_path)
    fake, _ = _sequence(
        _submit("single_2023_1tp_0qc_17639.json", filename="../../etc/passwd"),
    )
    with patch("src.agent.scenario_orchestrator.litellm.completion", side_effect=fake):
        result = orch.run("anything")
    assert "/" not in result.filename
    assert result.filename.endswith(".json")


def test_raises_only_when_no_base_matches(tmp_path: Path) -> None:
    """Dithering with a prompt that matches no scenario at all still raises."""
    orch = _orchestrator(tmp_path)
    looping = _make_response(tool_calls=[_make_tool_call("identify_facts", {"query": "income"})])
    fake, state = _sequence(looping)
    with patch("src.agent.scenario_orchestrator.litellm.completion", side_effect=fake):
        with pytest.raises(RuntimeError):
            orch.run("xyzzy")
    assert state["count"] == MAX_ITERATIONS


def test_falls_back_to_last_read_base_on_exhaustion(tmp_path: Path) -> None:
    """Model reads a scenario then dithers — we return that base instead of 500ing."""
    orch = _orchestrator(tmp_path)
    fake, _ = _sequence(
        _make_response(
            tool_calls=[
                _make_tool_call("read_scenario", {"filename": "single_2023_1tp_0qc_17639.json"})
            ]
        ),
        _make_response(tool_calls=[_make_tool_call("identify_facts", {"query": "loop"})]),
    )
    with patch("src.agent.scenario_orchestrator.litellm.completion", side_effect=fake):
        result = orch.run("single 0 kids")
    assert result.scenario_json == _BASE_SINGLE


def test_falls_back_via_prompt_when_base_unresolvable(tmp_path: Path) -> None:
    """Model keeps giving a bad base — we match the prompt to the closest scenario."""
    orch = _orchestrator(tmp_path)
    fake, _ = _sequence(_submit("zzzzz.json"))
    with patch("src.agent.scenario_orchestrator.litellm.completion", side_effect=fake):
        result = orch.run("married filing separately with 3 qualifying children")
    assert result.scenario_json == _BASE_MFS_3QC


def test_select_base_from_prompt_matches_intent(tmp_path: Path) -> None:
    orch = _orchestrator(tmp_path)
    assert orch._select_base_from_prompt("mfs 3 qcs disqualified").name == (
        "dq_mfs_2024_1tp_3qcs_59899.json"
    )
    assert orch._select_base_from_prompt("single no kids").name == "single_2023_1tp_0qc_17639.json"
    assert orch._select_base_from_prompt("completely unrelated text") is None


# ---------------------------------------------------------------------------
# Wrapper validation + filename parsing units
# ---------------------------------------------------------------------------


def test_validate_wrapper_rejects_bad_shapes(tmp_path: Path) -> None:
    orch = _orchestrator(tmp_path)
    # array item where a scalar is expected (the class of bug that broke the browser)
    assert "must be str" in orch._validate_wrapper(
        "/jobsIncomeTotal", {"$type": "DollarWrapper", "item": ["x"]}
    )
    # IntWrapper must not accept a bool
    assert "must be int" in orch._validate_wrapper(
        "/ageRange", {"$type": "IntWrapper", "item": True}
    )
    # derived fact
    assert "derived" in orch._validate_wrapper("/agi", {"$type": "DollarWrapper", "item": "1.00"})
    # unknown path
    assert "not a known fact path" in orch._validate_wrapper(
        "/nope", {"$type": "DollarWrapper", "item": "1.00"}
    )
    # unknown wrapper type
    assert "unknown wrapper" in orch._validate_wrapper(
        "/jobsIncomeTotal", {"$type": "WatWrapper", "item": "1.00"}
    )
    # missing $type/item
    assert "single" in orch._validate_wrapper("/jobsIncomeTotal", {"item": "1.00"})


def test_validate_wrapper_accepts_valid(tmp_path: Path) -> None:
    orch = _orchestrator(tmp_path)
    assert (
        orch._validate_wrapper("/jobsIncomeTotal", {"$type": "DollarWrapper", "item": "17639.00"})
        is None
    )
    assert (
        orch._validate_wrapper("/meta/migrationsApplied", {"$type": "IntWrapper", "item": 2})
        is None
    )
    assert (
        orch._validate_wrapper(
            "/familyAndHousehold", {"$type": "CollectionWrapper", "item": {"items": ["abc"]}}
        )
        is None
    )
    assert (
        orch._validate_wrapper(
            "/familyAndHousehold/#abc/relationship",
            {"$type": "EnumWrapper", "item": {"value": "x", "enumOptionsPath": "/o"}},
        )
        is None
    )


def test_parse_scenario_filename_dimensions() -> None:
    assert _parse_scenario_filename("dq_hoh_unmarried_2024_1tp_2qcs_55768.json") == {
        "eligibility": "disqualifying",
        "filing_status": "hoh",
        "marital": "unmarried",
        "qc_count": "2",
        "income_band": "mid-high",
    }
    assert _parse_scenario_filename("single_2023_1tp_0qc_17639.json") == {
        "eligibility": "qualifying",
        "filing_status": "single",
        "marital": None,
        "qc_count": "0",
        "income_band": "low",
    }
