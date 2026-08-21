"""Tests for submit_final_answer rendering and leaked-JSON recovery.

These exercise the pure-function logic added for the Class A (output formatting)
fixes — they do not touch the LLM transport, so they are stable regardless of the
litellm/ollama wiring used by the agentic loop.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from src.agent.orchestrator import AgentOrchestrator
from src.facts.dictionary import FactDictionary
from src.rag.retriever import RagRetriever


def _orch() -> AgentOrchestrator:
    return AgentOrchestrator(
        fact_dictionary=FactDictionary(),
        rag_retriever=MagicMock(spec=RagRetriever),
        model="test-model",
    )


# ---------------------------------------------------------------------------
# _is_answer_tool
# ---------------------------------------------------------------------------


def test_is_answer_tool_recognises_real_and_hallucinated_names() -> None:
    orch = _orch()
    assert orch._is_answer_tool("submit_final_answer")
    # Hallucinated names seen in production transcripts.
    assert orch._is_answer_tool("final_answer")
    assert orch._is_answer_tool("respond_to_user")
    assert orch._is_answer_tool("answer_eligibility_question")
    assert orch._is_answer_tool("response")
    # Real working tools are not answer tools.
    assert not orch._is_answer_tool("identify_facts")
    assert not orch._is_answer_tool("query_rag")


# ---------------------------------------------------------------------------
# _render_final_answer / _try_render_answer
# ---------------------------------------------------------------------------


def test_render_full_structured_answer() -> None:
    orch = _orch()
    md = orch._render_final_answer(
        {
            "direct_answer": "The filer is Single because filingStatus is Single.",
            "reasoning_trace": [
                {
                    "fact": "/eitcEligible/filingStatus",
                    "value": "Single",
                    "complete": True,
                    "explanation": "Determines HOH eligibility",
                }
            ],
            "what_would_change": [
                {
                    "fact": "/paidMoreThanHalfHomeCostsForChild",
                    "from": "false",
                    "to": "true",
                    "effect": "Could qualify for HOH",
                }
            ],
            "citations": ["IRS Pub. 596, p. 12"],
        }
    )
    assert md.startswith("**The filer is Single")
    assert "## Reasoning Trace" in md
    assert "Fact `/eitcEligible/filingStatus`: value `Single` (complete)" in md
    assert "Determines HOH eligibility" in md
    assert "## What Would Change This?" in md
    assert "Change `/paidMoreThanHalfHomeCostsForChild` from `false` to `true`" in md
    assert "## Sources" in md
    assert "IRS Pub. 596, p. 12" in md


def test_render_minimal_answer_omits_empty_sections() -> None:
    orch = _orch()
    md = orch._render_final_answer({"direct_answer": "Not eligible."})
    assert md == "**Not eligible.**"
    assert "Reasoning Trace" not in md
    assert "Sources" not in md


def test_trace_item_marks_incomplete() -> None:
    orch = _orch()
    md = orch._render_final_answer(
        {
            "direct_answer": "Cannot determine.",
            "reasoning_trace": [
                {
                    "fact": "/adjustmentsToIncome",
                    "value": "Incomplete",
                    "complete": False,
                    "explanation": "Required input missing",
                }
            ],
        }
    )
    assert "value `Incomplete` (incomplete)" in md


def test_try_render_unwraps_nested_arguments_envelope() -> None:
    orch = _orch()
    rendered = orch._try_render_answer(
        {"name": "final_answer", "arguments": {"direct_answer": "Eligible."}}
    )
    assert rendered == "**Eligible.**"


def test_try_render_falls_back_to_text_key() -> None:
    orch = _orch()
    # The hallucinated {"name": "response", "text": "..."} shape from transcripts.
    rendered = orch._try_render_answer(
        {"name": "response", "text": "The filer is single and not HOH."}
    )
    assert rendered == "The filer is single and not HOH."


def test_try_render_returns_none_when_empty() -> None:
    orch = _orch()
    # {"name": "final_answer"} with no usable content.
    assert orch._try_render_answer({"name": "final_answer"}) is None
    assert orch._try_render_answer("not a dict") is None


# ---------------------------------------------------------------------------
# _coerce_text_answer
# ---------------------------------------------------------------------------


def test_coerce_passes_through_prose() -> None:
    orch = _orch()
    assert orch._coerce_text_answer("**Eligible.** Because AGI is low.") == (
        "**Eligible.** Because AGI is low."
    )


def test_coerce_recovers_leaked_structured_json() -> None:
    orch = _orch()
    leaked = '{"name": "final_answer", "arguments": {"direct_answer": "Not eligible."}}'
    assert orch._coerce_text_answer(leaked) == "**Not eligible.**"


def test_coerce_recovers_leaked_text_json() -> None:
    orch = _orch()
    leaked = '{"name": "final_answer", "text": "The filer is single."}'
    assert orch._coerce_text_answer(leaked) == "The filer is single."


def test_coerce_strips_json_code_fence() -> None:
    orch = _orch()
    leaked = '```json\n{"direct_answer": "Eligible."}\n```'
    assert orch._coerce_text_answer(leaked) == "**Eligible.**"


def test_coerce_empty_returns_fallback() -> None:
    orch = _orch()
    out = orch._coerce_text_answer("")
    assert "wasn't able" in out or "rephrase" in out
