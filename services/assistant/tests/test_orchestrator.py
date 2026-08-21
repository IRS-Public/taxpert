"""Tests for the sync AgentOrchestrator with mocked LiteLLM — no real network.

The orchestrator drives ``litellm.completion`` and reads ``response.choices[0].message``,
so the mocks here build that shape. Loop-level coverage includes the Class A output
fixes: the ``submit_final_answer`` terminal tool, recovery of hallucinated answer-shaped
tool names, empty-answer re-prompting, unknown-tool guidance, and leaked-JSON recovery.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from src.agent.orchestrator import MAX_ITERATIONS, AgentOrchestrator
from src.facts.dictionary import FactDictionary
from src.rag.retriever import RagRetriever

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_tool_call(name: str, arguments: Any, call_id: str = "call_1") -> MagicMock:
    """Build a mock tool call. ``arguments`` may be a dict or a JSON string,
    matching what LiteLLM passes through from different providers."""
    tool_call = MagicMock()
    tool_call.id = call_id
    tool_call.function.name = name
    tool_call.function.arguments = arguments
    return tool_call


def _make_response(content: str | None = None, tool_calls: list | None = None) -> MagicMock:
    msg = MagicMock()
    msg.content = content or ""
    msg.tool_calls = tool_calls or []
    msg.model_dump.return_value = {
        "role": "assistant",
        "content": content or "",
        "tool_calls": [],
    }
    choice = MagicMock()
    choice.message = msg
    response = MagicMock()
    response.choices = [choice]
    return response


def _make_orchestrator() -> AgentOrchestrator:
    dictionary = FactDictionary()
    rag = MagicMock(spec=RagRetriever)
    rag.query = MagicMock(return_value=[])
    return AgentOrchestrator(
        fact_dictionary=dictionary,
        rag_retriever=rag,
        model="test-model",
    )


def _sequence(*responses: MagicMock):
    """Return a fake completion that yields the given responses in order, and a
    counter object exposing ``.count``."""
    state = {"count": 0}

    def fake_completion(**kwargs):
        idx = state["count"]
        state["count"] += 1
        return responses[min(idx, len(responses) - 1)]

    return fake_completion, state


# ---------------------------------------------------------------------------
# Existing behaviours (ported to the litellm transport)
# ---------------------------------------------------------------------------


def test_identify_facts_tool_called_then_final_answer() -> None:
    orchestrator = _make_orchestrator()
    fake, state = _sequence(
        _make_response(tool_calls=[_make_tool_call("identify_facts", {"query": "eitc eligible"})]),
        _make_response(content="The taxpayer is eligible."),
    )

    with patch("src.agent.orchestrator.litellm.completion", side_effect=fake):
        answer = orchestrator.run("Is the taxpayer eligible?", [])

    assert state["count"] == 2
    assert answer == "The taxpayer is eligible."


def test_no_tool_calls_returns_content_directly() -> None:
    orchestrator = _make_orchestrator()
    response = _make_response(content="Direct answer: eligible.")

    with patch("src.agent.orchestrator.litellm.completion", return_value=response):
        answer = orchestrator.run("Quick question", [])

    assert answer == "Direct answer: eligible."


def test_max_iterations_respected() -> None:
    orchestrator = _make_orchestrator()
    infinite = _make_response(tool_calls=[_make_tool_call("identify_facts", {"query": "loop"})])
    fake, state = _sequence(infinite)

    with patch("src.agent.orchestrator.litellm.completion", side_effect=fake):
        answer = orchestrator.run("Trigger infinite loop", [])

    assert state["count"] == MAX_ITERATIONS
    assert "unable" in answer.lower() or "steps" in answer.lower()


def test_query_rag_tool_dispatched() -> None:
    orchestrator = _make_orchestrator()
    orchestrator._retriever.query = MagicMock(
        return_value=[{"content": "x", "source": "pub", "distance": 0.1}]
    )
    fake, state = _sequence(
        _make_response(tool_calls=[_make_tool_call("query_rag", {"query": "qualifying child"})]),
        _make_response(content="Eligible per Pub 596."),
    )

    with patch("src.agent.orchestrator.litellm.completion", side_effect=fake):
        answer = orchestrator.run("Is the child qualifying?", [])

    orchestrator._retriever.query.assert_called_once_with("qualifying child")
    assert answer == "Eligible per Pub 596."


def test_tracked_facts_with_values_serialised_into_user_message() -> None:
    orchestrator = _make_orchestrator()
    captured_messages: list[Any] = []
    response = _make_response(content="done")

    def fake_completion(**kwargs):
        captured_messages.append(kwargs.get("messages"))
        return response

    tracked = [{"path": "/eitcEligible", "value": True, "complete": True}]
    with patch("src.agent.orchestrator.litellm.completion", side_effect=fake_completion):
        orchestrator.run("explain", tracked)

    user_msg = captured_messages[0][1]["content"]
    assert "/eitcEligible" in user_msg
    assert "true" in user_msg.lower()


# ---------------------------------------------------------------------------
# Class A: terminal tool + recovery paths
# ---------------------------------------------------------------------------


def test_submit_final_answer_terminates_and_renders() -> None:
    """A submit_final_answer call ends the loop and renders structured Markdown."""
    orchestrator = _make_orchestrator()
    fake, state = _sequence(
        _make_response(
            tool_calls=[
                _make_tool_call(
                    "submit_final_answer",
                    {
                        "direct_answer": "The filer is Single.",
                        "reasoning_trace": [
                            {
                                "fact": "/eitcEligible/filingStatus",
                                "value": "Single",
                                "complete": True,
                                "explanation": "Determines HOH eligibility",
                            }
                        ],
                    },
                )
            ]
        ),
    )

    with patch("src.agent.orchestrator.litellm.completion", side_effect=fake):
        answer = orchestrator.run("Why single?", [])

    assert state["count"] == 1  # terminal — no second round-trip
    assert answer.startswith("**The filer is Single.**")
    assert "## Reasoning Trace" in answer
    assert "Fact `/eitcEligible/filingStatus`: value `Single` (complete)" in answer


def test_submit_final_answer_accepts_json_string_arguments() -> None:
    """Some providers deliver tool arguments as a JSON string, not a dict."""
    orchestrator = _make_orchestrator()
    fake, _ = _sequence(
        _make_response(
            tool_calls=[
                _make_tool_call("submit_final_answer", '{"direct_answer": "Not eligible."}')
            ]
        ),
    )

    with patch("src.agent.orchestrator.litellm.completion", side_effect=fake):
        answer = orchestrator.run("Eligible?", [])

    assert answer == "**Not eligible.**"


def test_hallucinated_answer_tool_recovered() -> None:
    """An invented answer-shaped tool name is recovered instead of erroring."""
    orchestrator = _make_orchestrator()
    fake, state = _sequence(
        _make_response(
            tool_calls=[
                _make_tool_call(
                    "final_answer",
                    {"name": "final_answer", "text": "The filer is single and not HOH."},
                )
            ]
        ),
    )

    with patch("src.agent.orchestrator.litellm.completion", side_effect=fake):
        answer = orchestrator.run("Why single?", [])

    assert state["count"] == 1
    assert answer == "The filer is single and not HOH."


def test_empty_answer_tool_reprompts_then_succeeds() -> None:
    """An answer tool with no usable content gets a re-prompt, then the model retries."""
    orchestrator = _make_orchestrator()
    fake, state = _sequence(
        _make_response(tool_calls=[_make_tool_call("final_answer", {})]),
        _make_response(
            tool_calls=[_make_tool_call("submit_final_answer", {"direct_answer": "Eligible."})]
        ),
    )

    with patch("src.agent.orchestrator.litellm.completion", side_effect=fake):
        answer = orchestrator.run("Eligible?", [])

    assert state["count"] == 2
    assert answer == "**Eligible.**"


def test_unknown_tool_gets_guidance_then_answers() -> None:
    """A genuinely unknown (non-answer-shaped) tool gets guidance and the loop continues."""
    orchestrator = _make_orchestrator()
    captured: list[Any] = []
    resp1 = _make_response(tool_calls=[_make_tool_call("frobnicate", {"x": 1})])
    resp2 = _make_response(content="Recovered answer.")
    state = {"count": 0}

    def fake_completion(**kwargs):
        captured.append(kwargs.get("messages"))
        state["count"] += 1
        return resp1 if state["count"] == 1 else resp2

    with patch("src.agent.orchestrator.litellm.completion", side_effect=fake_completion):
        answer = orchestrator.run("hmm", [])

    assert state["count"] == 2
    assert answer == "Recovered answer."
    # The guidance tool message was fed back before the second completion.
    second_call_messages = captured[1]
    tool_msgs = [m for m in second_call_messages if m.get("role") == "tool"]
    assert any("Unknown tool" in m["content"] for m in tool_msgs)


def test_leaked_json_content_recovered() -> None:
    """If the model inlines a JSON blob as plain content, recover the answer."""
    orchestrator = _make_orchestrator()
    leaked = '{"name": "final_answer", "text": "Recovered from content."}'
    response = _make_response(content=leaked)

    with patch("src.agent.orchestrator.litellm.completion", return_value=response):
        answer = orchestrator.run("Why?", [])

    assert answer == "Recovered from content."


# ---------------------------------------------------------------------------
# Class B: dependency-tree grounding + tool-result trimming
# ---------------------------------------------------------------------------


def test_dependency_tree_serialised_into_user_message() -> None:
    """The live dependency tree attached to a tracked fact must reach the model."""
    orchestrator = _make_orchestrator()
    captured: list[Any] = []
    response = _make_response(content="done")

    def fake_completion(**kwargs):
        captured.append(kwargs.get("messages"))
        return response

    tracked = [
        {
            "path": "/derivedFilingStatus",
            "value": "Single",
            "complete": True,
            "dependencies": [
                {"path": "/tentativelyHOHFromHomeUpkeep", "value": "false", "complete": True}
            ],
        }
    ]
    with patch("src.agent.orchestrator.litellm.completion", side_effect=fake_completion):
        orchestrator.run("Why single?", tracked)

    user_msg = captured[0][1]["content"]
    assert "/tentativelyHOHFromHomeUpkeep" in user_msg
    assert "dependencies" in user_msg


def test_compress_keeps_short_results_verbatim() -> None:
    orchestrator = _make_orchestrator()
    short = "x" * 100
    assert orchestrator._compress("identify_facts", short) == short


def test_compress_trims_long_results_preserving_head() -> None:
    """Long results keep a large head (not the old 500-char stub that shredded trees)."""
    from src.agent.orchestrator import _COMPRESS_KEEP, _COMPRESS_THRESHOLD

    orchestrator = _make_orchestrator()
    payload = "A" * (_COMPRESS_THRESHOLD + 5000)
    out = orchestrator._compress("query_rag", payload)

    assert out.startswith("A" * _COMPRESS_KEEP)
    assert "trimmed" in out
    # Keeps far more than the old 500-char behaviour.
    assert out.count("A") >= _COMPRESS_KEEP
