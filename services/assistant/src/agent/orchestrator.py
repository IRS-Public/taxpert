"""Synchronous agentic loop for the EITC diagnostic assistant."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import litellm
from src.agent.prompts import SYSTEM_PROMPT
from src.agent.tools import TOOLS
from src.facts.dictionary import FactDictionary
from src.facts.search import identify_facts
from src.rag.retriever import RagRetriever

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 10
# Tool results longer than this many chars are trimmed before adding to history.
_COMPRESS_THRESHOLD = 8000
# When trimming, how much of the result to keep (enough to preserve a dependency
# tree or a few RAG passages, not the 500-char stub that shredded them before).
_COMPRESS_KEEP = 6000

# The only tools the model is allowed to call.
_KNOWN_TOOLS = {"identify_facts", "query_rag", "submit_final_answer"}

# Weak models often try to "answer" by inventing a tool name (e.g. final_answer,
# respond_to_user, answer_eligibility_question) instead of calling submit_final_answer.
# We recognise those by these substrings and recover the answer from their arguments.
_ANSWER_TOOL_HINTS = ("answer", "final", "respond", "response", "result")

# Guidance fed back to the model when it calls submit_final_answer (or an answer-shaped
# hallucinated tool) without a usable direct_answer.
_RETRY_GUIDANCE = (
    "submit_final_answer needs a non-empty 'direct_answer' (one sentence stating the "
    "outcome and the decisive reason). Call submit_final_answer again with 'direct_answer', "
    "plus 'reasoning_trace' and 'what_would_change' where applicable."
)


class AgentOrchestrator:
    def __init__(
        self,
        fact_dictionary: FactDictionary,
        rag_retriever: RagRetriever,
        model: str | None = None,
    ) -> None:
        self._dictionary = fact_dictionary
        self._retriever = rag_retriever
        self._model = model or os.environ.get("LLM_MODEL", "ollama/llama3.1:8b")

    def _compress(self, tool_name: str, result: str) -> str:
        if len(result) <= _COMPRESS_THRESHOLD:
            return result
        return (
            f"{result[:_COMPRESS_KEEP]}\n"
            f"…[{tool_name} result trimmed — showing {_COMPRESS_KEEP} of {len(result)} chars]"
        )

    def _dispatch_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        tracked_facts: list[str],
    ) -> str:
        """Execute a single tool call and return its result as a JSON string."""
        if tool_name == "identify_facts":
            query: str = arguments.get("query", "")
            results = identify_facts(query, tracked_facts, self._dictionary)
            return json.dumps(results)

        elif tool_name == "query_rag":
            query = arguments.get("query", "")
            results = self._retriever.query(query)
            return json.dumps(results)

        else:
            logger.warning("Unknown tool called: %s", tool_name)
            return (
                f"Unknown tool '{tool_name}'. The only available tools are: "
                "identify_facts (search the fact dictionary), query_rag (search IRS "
                "publications), and submit_final_answer (deliver your answer to the SME). "
                "To answer the SME, call submit_final_answer."
            )

    # ------------------------------------------------------------------
    # Final-answer rendering & recovery
    # ------------------------------------------------------------------

    @staticmethod
    def _is_answer_tool(tool_name: str) -> bool:
        """True if ``tool_name`` looks like an attempt to deliver a final answer.

        Covers ``submit_final_answer`` plus the hallucinated tool names weak models
        invent (``final_answer``, ``respond_to_user``, ``answer_eligibility_question``…).
        """
        name = tool_name.lower()
        return name == "submit_final_answer" or any(h in name for h in _ANSWER_TOOL_HINTS)

    def _try_render_answer(self, arguments: Any) -> str | None:
        """Render an answer payload to Markdown, or return None if not usable.

        Accepts the structured ``submit_final_answer`` shape, the nested ``{"arguments": …}``
        shape, and loose ``{"text"/"message"/"answer"/"content": …}`` shapes that leak from
        weak models.
        """
        if not isinstance(arguments, dict):
            return None

        args = arguments
        # Unwrap a nested {"name": ..., "arguments": {...}} envelope.
        if isinstance(args.get("arguments"), dict):
            args = args["arguments"]

        direct = args.get("direct_answer")
        if isinstance(direct, str) and direct.strip():
            return self._render_final_answer(args)

        # Loose fallbacks: the model put free text under another key.
        for key in ("text", "message", "answer", "content", "direct_answer"):
            value = args.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        return None

    def _render_final_answer(self, args: dict[str, Any]) -> str:
        """Deterministically render a ``submit_final_answer`` payload to Markdown."""
        direct = str(args.get("direct_answer", "")).strip()
        lines: list[str] = [f"**{direct}**", ""]

        trace = args.get("reasoning_trace")
        if isinstance(trace, list) and trace:
            lines.append("## Reasoning Trace")
            lines.extend(self._format_trace_item(item) for item in trace)
            lines.append("")

        changes = args.get("what_would_change")
        if isinstance(changes, list) and changes:
            lines.append("## What Would Change This?")
            lines.extend(self._format_change_item(item) for item in changes)
            lines.append("")

        citations = args.get("citations")
        if isinstance(citations, list) and citations:
            lines.append("## Sources")
            lines.extend(f"- {str(c).strip()}" for c in citations if str(c).strip())

        return "\n".join(lines).strip()

    @staticmethod
    def _format_trace_item(item: Any) -> str:
        if not isinstance(item, dict):
            return f"- {item}"
        fact = item.get("fact") or item.get("path") or ""
        value = item.get("value")
        complete = item.get("complete")
        explanation = (
            item.get("explanation")
            or item.get("note")
            or item.get("role")
            or item.get("description")
            or ""
        )

        head = f"Fact `{fact}`" if fact else ""
        if value is not None and str(value) != "":
            status = ""
            if complete is True:
                status = " (complete)"
            elif complete is False:
                status = " (incomplete)"
            value_part = f"value `{value}`{status}"
            head = f"{head}: {value_part}" if head else value_part

        if head and explanation:
            return f"- {head} — {explanation}"
        return f"- {head or explanation}"

    @staticmethod
    def _format_change_item(item: Any) -> str:
        if not isinstance(item, dict):
            return f"- {item}"
        fact = item.get("fact") or item.get("path") or ""
        frm = item.get("from")
        to = item.get("to")
        effect = item.get("effect") or item.get("description") or ""

        text = f"Change `{fact}`" if fact else "Change"
        if frm is not None and to is not None:
            text += f" from `{frm}` to `{to}`"
        if effect:
            text += f" — {effect}"
        return f"- {text}"

    def _coerce_text_answer(self, content: str | None) -> str:
        """Recover a usable answer from a plain-content message.

        Strong models return Markdown prose here. Weak models sometimes inline a
        tool-call-shaped JSON blob instead; try to parse and render it rather than
        showing the SME raw JSON.
        """
        text = (content or "").strip()
        if not text:
            return (
                "I wasn't able to produce an answer. Please rephrase the question or add "
                "the relevant facts to the audit panel."
            )

        candidate = text
        if candidate.startswith("```"):
            # Strip a ```json … ``` fence.
            candidate = candidate.strip("`")
            if candidate.lower().startswith("json"):
                candidate = candidate[4:]
            candidate = candidate.strip()

        if candidate.startswith("{"):
            try:
                data = json.loads(candidate)
            except (ValueError, TypeError):
                return text
            rendered = self._try_render_answer(data)
            if rendered:
                return rendered

        return text

    def run(
        self,
        prompt: str,
        tracked_facts: list[dict[str, Any]] | list[str],
        context: dict[str, Any] | None = None,
    ) -> str:
        """Run the agentic loop synchronously and return the final answer.

        ``tracked_facts`` may be a plain list of fact paths (for compatibility with
        ``identify_facts``), or a list of pre-resolved {path, value, ...} dicts that
        the model can read directly in the user message.

        ``context`` is the optional "Explain this node" payload — a dict with a
        ``kind`` of ``fact``/``flow``/``scenario`` carrying the selected node's
        metadata, bound fact, 1-hop neighbours, or scenario outcome.
        """
        tracked_paths: list[str] = [
            f["path"] if isinstance(f, dict) and "path" in f else str(f) for f in tracked_facts
        ]

        user_content = (
            f"Tracked facts (currently visible in the audit panel). Each entry has the "
            f"fact's current `value` and `complete` flag, and a nested `dependencies` "
            f"tree giving the live, resolved values of every fact it depends on. These "
            f"are the authoritative current values from the fact graph — reason over "
            f"them directly and never invent a value or a dependency not shown here:\n"
            f"{json.dumps(tracked_facts)}\n\n"
        )

        if context:
            user_content += (
                f"Explain context (the node the SME asked you to explain). Its `kind` is one "
                f"of `fact`, `flow`, or `scenario`; use it as described in the system prompt — "
                f"it is authoritative and drawn from the same fact graph as the tracked facts:\n"
                f"{json.dumps(context)}\n\n"
            )

        user_content += f"User question: {prompt}"

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        for iteration in range(MAX_ITERATIONS):
            logger.info("Agent iteration %d/%d", iteration + 1, MAX_ITERATIONS)

            response = litellm.completion(
                model=self._model,
                messages=messages,
                tools=TOOLS,
            )

            message = response.choices[0].message
            tool_calls = message.tool_calls

            if tool_calls:
                messages.append(message.model_dump())

                for tool_call in tool_calls:
                    tool_name = tool_call.function.name
                    raw_args = tool_call.function.arguments
                    try:
                        arguments: dict[str, Any] = (
                            raw_args if isinstance(raw_args, dict) else json.loads(raw_args or "{}")
                        )
                    except (ValueError, TypeError):
                        arguments = {}

                    logger.info("Executing tool '%s' with args %s", tool_name, arguments)

                    # Terminal: the model is trying to deliver the final answer. Accept
                    # submit_final_answer and any answer-shaped hallucinated tool name.
                    if self._is_answer_tool(tool_name):
                        rendered = self._try_render_answer(arguments)
                        if rendered:
                            logger.info("Final answer delivered via tool '%s'", tool_name)
                            return rendered
                        # Answer attempt with no usable content — nudge and re-prompt.
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": _RETRY_GUIDANCE,
                            }
                        )
                        continue

                    raw_result = self._dispatch_tool(tool_name, arguments, tracked_paths)
                    compressed = self._compress(tool_name, raw_result)

                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": compressed,
                        }
                    )

            else:
                return self._coerce_text_answer(message.content)

        logger.warning("Agent reached MAX_ITERATIONS (%d) without a final answer", MAX_ITERATIONS)
        return (
            "I was unable to complete the analysis within the allowed number of steps. "
            "Please try rephrasing your question or reducing the scope."
        )
