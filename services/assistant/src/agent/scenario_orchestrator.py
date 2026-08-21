"""Synchronous agentic loop that generates an EITC Fact Graph scenario.

Mirrors AgentOrchestrator (same litellm loop, MAX_ITERATIONS, tool dispatch and
compression), but its terminal tool is ``submit_scenario`` and it can read the
existing scenarios and flow XML so the model can clone a known-good template.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import litellm
from lxml import etree
from src.agent.scenario_prompts import SCENARIO_SYSTEM_PROMPT
from src.agent.scenario_tools import SCENARIO_TOOLS
from src.facts.dictionary import FactDictionary
from src.facts.search import identify_facts
from src.rag.retriever import RagRetriever

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 12
_COMPRESS_THRESHOLD = 8000
_COMPRESS_KEEP = 6000

# Hardened XML parser (matches src/facts/dictionary.py) for reading flow/*.xml.
_SAFE_XML_PARSER = etree.XMLParser(
    resolve_entities=False, no_network=True, load_dtd=False, dtd_validation=False, huge_tree=False
)

_FILENAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
# Replace a /#<uuid> collection segment with the abstract /* form used in the dictionary.
_COLLECTION_ID_RE = re.compile(r"/#[^/]+")

# Allowed wrapper $types and the Python type their "item" must be. EnumWrapper and
# CollectionWrapper carry an object item, validated separately.
_SCALAR_ITEM_TYPES: dict[str, type | tuple[type, ...]] = {
    "DollarWrapper": str,
    "StringWrapper": str,
    "DayWrapper": str,
    "BooleanWrapper": bool,
    "IntWrapper": int,
    "RationalWrapper": str,
}
_OBJECT_WRAPPERS = {"EnumWrapper", "CollectionWrapper", "MultiEnumWrapper"}


@dataclass
class GeneratedScenario:
    scenario_json: dict[str, Any]
    filename: str
    description: str


class ScenarioOrchestrator:
    def __init__(
        self,
        fact_dictionary: FactDictionary,
        rag_retriever: RagRetriever,
        scenarios_dir: str,
        flow_dir: str,
        model: str | None = None,
    ) -> None:
        self._dictionary = fact_dictionary
        self._retriever = rag_retriever
        self._scenarios_dir = Path(scenarios_dir)
        self._flow_dir = Path(flow_dir)
        self._model = model or os.environ.get(
            "SCENARIO_LLM_MODEL", os.environ.get("LLM_MODEL", "ollama/llama3.1:8b")
        )

    # ------------------------------------------------------------------
    # Tool implementations
    # ------------------------------------------------------------------

    def _list_scenarios(self) -> str:
        items: list[dict[str, Any]] = []
        for path in sorted(self._scenarios_dir.glob("*.json")):
            items.append({"filename": path.name, **_parse_scenario_filename(path.name)})
        return json.dumps(items)

    def _read_scenario(self, filename: str) -> str:
        name = Path(filename).name  # strip any directory components (traversal guard)
        target = self._scenarios_dir / name
        if not target.is_file():
            return json.dumps(
                {"error": f"No scenario named {name!r}. Call list_scenarios for valid names."}
            )
        return target.read_text(encoding="utf-8")

    def _search_flow(self, query: str) -> str:
        terms = [t for t in query.lower().split() if t]
        if not terms:
            return json.dumps([])
        snippets: list[dict[str, str]] = []
        for path in sorted(self._flow_dir.glob("*.xml")):
            try:
                root = etree.fromstring(path.read_bytes(), parser=_SAFE_XML_PARSER)
            except etree.XMLSyntaxError:
                continue
            for elem in root.iter():
                if not isinstance(elem.tag, str):
                    continue
                blob = " ".join(
                    [etree.QName(elem.tag).localname] + [f"{k}={v}" for k, v in elem.attrib.items()]
                )
                if any(t in blob.lower() for t in terms):
                    snippets.append({"file": path.name, "element": blob.strip()})
                    if len(snippets) >= 20:
                        return json.dumps(snippets)
        return json.dumps(snippets)

    def _dispatch_tool(self, tool_name: str, arguments: dict[str, Any]) -> str:
        if tool_name == "list_scenarios":
            return self._list_scenarios()
        if tool_name == "read_scenario":
            return self._read_scenario(str(arguments.get("filename", "")))
        if tool_name == "identify_facts":
            return json.dumps(identify_facts(str(arguments.get("query", "")), [], self._dictionary))
        if tool_name == "search_flow":
            return self._search_flow(str(arguments.get("query", "")))
        if tool_name == "query_rag":
            return json.dumps(self._retriever.query(str(arguments.get("query", ""))))
        logger.warning("Unknown scenario tool called: %s", tool_name)
        return (
            f"Unknown tool '{tool_name}'. Available tools: list_scenarios, read_scenario, "
            "identify_facts, search_flow, query_rag, submit_scenario. To finish, call "
            "submit_scenario."
        )

    def _compress(self, tool_name: str, result: str) -> str:
        if len(result) <= _COMPRESS_THRESHOLD:
            return result
        return (
            f"{result[:_COMPRESS_KEEP]}\n"
            f"…[{tool_name} result trimmed — showing {_COMPRESS_KEEP} of {len(result)} chars]"
        )

    # ------------------------------------------------------------------
    # Base resolution + override validation
    # ------------------------------------------------------------------

    def _resolve_base(self, base_filename: str) -> Path | None:
        """Resolve the model's chosen base to a real scenario file.

        Weak models often invent a plausible-but-nonexistent filename (e.g.
        ``dq_mfs_married_2024_1tp_3qcs_250000.json``). We accept an exact match, else
        fall back to the existing file sharing the most underscore tokens (filing status,
        ``Nqcs``, ``dq`` prefix, year) — the income number rarely matches and is ignored.
        Returns None only when nothing overlaps at all.
        """
        name = Path(str(base_filename)).name
        exact = self._scenarios_dir / name
        if exact.is_file():
            return exact

        wanted = set(name.replace(".json", "").split("_"))
        best: tuple[int, Path] | None = None
        for path in sorted(self._scenarios_dir.glob("*.json")):
            tokens = set(path.name.replace(".json", "").split("_"))
            score = len(wanted & tokens)
            if score and (best is None or score > best[0]):
                best = (score, path)
        return best[1] if best and best[0] >= 2 else None

    def _validate_wrapper(self, path: str, wrapper: Any) -> str | None:
        """Return an error string if ``wrapper`` is not a valid serialized fact wrapper.

        This is the strict structural check the weak-model output failed: ``item`` must
        match its ``$type`` (no arrays where an object/scalar is expected), and the path
        must be a writable fact (or /meta/* or a collection member of one).
        """
        if not isinstance(wrapper, dict) or "$type" not in wrapper or "item" not in wrapper:
            return f'{path}: must be a single {{"$type": ..., "item": ...}} wrapper.'
        wtype = wrapper["$type"]
        item = wrapper["item"]
        if wtype in _SCALAR_ITEM_TYPES:
            expected = _SCALAR_ITEM_TYPES[wtype]
            # bool is a subclass of int — guard IntWrapper against booleans explicitly.
            if not isinstance(item, expected) or (expected is int and isinstance(item, bool)):
                return f"{path}: {wtype} item must be {getattr(expected, '__name__', expected)}."
        elif wtype == "EnumWrapper":
            if (
                not isinstance(item, dict)
                or not isinstance(item.get("value"), str)
                or not isinstance(item.get("enumOptionsPath"), str)
            ):
                return f"{path}: EnumWrapper item needs string 'value' and 'enumOptionsPath'."
        elif wtype == "CollectionWrapper":
            if not isinstance(item, dict) or not isinstance(item.get("items"), list):
                return f"{path}: CollectionWrapper item needs an 'items' array."
        elif wtype not in _OBJECT_WRAPPERS:
            return f"{path}: unknown wrapper type '{wtype}'."

        if path.startswith("/meta/"):
            return None
        abstract = _COLLECTION_ID_RE.sub("/*", path)
        fact = self._dictionary.facts_by_path.get(abstract)
        if fact is None:
            return f"{path}: not a known fact path (looked up as {abstract})."
        if not fact.is_writable:
            return f"{path}: fact is derived, not writable — scenarios cannot set it."
        return None

    @staticmethod
    def _safe_filename(filename: str, fallback: str = "scenario.json") -> str:
        name = Path(str(filename)).name.strip()
        if name and not name.endswith(".json"):
            name += ".json"
        # Junk/empty/unsafe model filename → use the (always-valid) base name instead.
        if not name or not _FILENAME_RE.match(name):
            return fallback
        return name

    # ------------------------------------------------------------------
    # Loop
    # ------------------------------------------------------------------

    def run(self, prompt: str) -> GeneratedScenario:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SCENARIO_SYSTEM_PROMPT},
            {"role": "user", "content": f"Scenario request: {prompt}"},
        ]
        base_retries = 0
        last_base: Path | None = None  # best base the model has looked at, for the fallback
        nudged = False

        for iteration in range(MAX_ITERATIONS):
            logger.info("Scenario agent iteration %d/%d", iteration + 1, MAX_ITERATIONS)

            # A few iterations before the budget runs out, push a dithering weak model to
            # commit — this is what turns "ran out of steps" 500s into real scenarios.
            if not nudged and iteration == MAX_ITERATIONS - 4:
                nudged = True
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Stop exploring now. Call submit_scenario with the closest "
                            "base_filename from list_scenarios and minimal overrides."
                        ),
                    }
                )

            response = litellm.completion(
                model=self._model, messages=messages, tools=SCENARIO_TOOLS
            )
            message = response.choices[0].message
            tool_calls = message.tool_calls

            if not tool_calls:
                # The model answered in prose instead of calling submit_scenario; nudge once
                # by re-appending the instruction, then continue.
                messages.append(message.model_dump())
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "You must finish by calling submit_scenario with base_filename, "
                            "description and filename (and overrides if needed) — not as text."
                        ),
                    }
                )
                continue

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

                logger.info("Executing scenario tool '%s'", tool_name)

                if tool_name == "submit_scenario":
                    result = self._build_from_submission(arguments)
                    if result is not None:
                        return result
                    # base_filename was unresolvable — give the model one chance to repick,
                    # then fall back to the closest base rather than 500.
                    base_retries += 1
                    if base_retries > 2:
                        return self._fallback_scenario(prompt, last_base)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": (
                                f"base_filename {arguments.get('base_filename')!r} did not match "
                                "any existing scenario. Call list_scenarios and pick an EXACT "
                                "filename from it as base_filename."
                            ),
                        }
                    )
                    continue

                # Remember the last base the model inspected — used as the fallback if it
                # never manages a clean submit_scenario.
                if tool_name == "read_scenario":
                    resolved = self._resolve_base(str(arguments.get("filename", "")))
                    if resolved is not None:
                        last_base = resolved

                raw_result = self._dispatch_tool(tool_name, arguments)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": self._compress(tool_name, raw_result),
                    }
                )

        # The model dithered without a usable submit — fall back instead of 500ing.
        return self._fallback_scenario(prompt, last_base)

    def _fallback_scenario(self, prompt: str, last_base: Path | None) -> GeneratedScenario:
        """Return the closest existing scenario (a valid serialization the browser can
        load), or raise if nothing plausibly matches the request."""
        fallback = last_base or self._select_base_from_prompt(prompt)
        if fallback is not None:
            logger.warning("Falling back to closest base scenario %s", fallback.name)
            return GeneratedScenario(
                scenario_json=json.loads(fallback.read_text(encoding="utf-8")),
                filename=fallback.name,
                description=f"Closest existing scenario for: {prompt}",
            )
        raise RuntimeError(
            "The scenario generator could not match a scenario to the request. "
            "Try a more specific description (filing status, number of children, year)."
        )

    def _select_base_from_prompt(self, prompt: str) -> Path | None:
        """Pick the existing scenario whose filename best matches the prompt's intent.

        A deterministic last resort: map filing status / qualifying-child count / year /
        disqualification words in the prompt to filename tokens and score the overlap.
        """
        p = prompt.lower()
        wanted: set[str] = set()
        for needle, token in (
            ("married filing separately", "mfs"),
            ("head of household", "hoh"),
            ("qualifying surviving spouse", "qss"),
            ("surviving spouse", "qss"),
            ("single", "single"),
            ("mfs", "mfs"),
            ("hoh", "hoh"),
            ("qss", "qss"),
        ):
            if needle in p:
                wanted.add(token)
        qc = re.search(r"(\d+)\s*(?:qcs?|qualifying child|children|child|kids?)", p)
        if qc:
            wanted.update({f"{qc.group(1)}qc", f"{qc.group(1)}qcs"})
        for year in ("2023", "2024", "2025", "2026"):
            if year in p:
                wanted.add(year)
        wants_dq = "disqualif" in p or "knockout" in p or bool(re.search(r"\bdq\b", p))
        if wants_dq:
            wanted.add("dq")
        if not wanted:
            return None

        best: tuple[int, Path] | None = None
        for path in sorted(self._scenarios_dir.glob("*.json")):
            tokens = set(path.name.replace(".json", "").split("_"))
            score = len(wanted & tokens)
            if not score:
                continue
            # Respect eligibility intent: a qualifying request shouldn't fall back to a dq_
            # scenario (and vice versa) when an equally-matching one exists.
            if ("dq" in tokens) != wants_dq:
                score -= 1
            if best is None or score > best[0]:
                best = (score, path)
        return best[1] if best else None

    def _build_from_submission(self, arguments: dict[str, Any]) -> GeneratedScenario | None:
        """Clone the resolved base scenario and apply validated overrides.

        Returns None when the base cannot be resolved (so the loop can re-prompt). The base
        file is always a valid serialization, so the merged graph stays loadable even when
        the model's overrides are partly dropped.
        """
        base_path = self._resolve_base(str(arguments.get("base_filename", "")))
        if base_path is None:
            return None
        try:
            scenario_json: dict[str, Any] = json.loads(base_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return None

        overrides = arguments.get("overrides") or []
        if isinstance(overrides, dict):  # tolerate a single override sent as an object
            overrides = [overrides]
        applied, dropped = 0, []
        for ov in overrides if isinstance(overrides, list) else []:
            if not isinstance(ov, dict):
                continue
            path, wrapper = ov.get("path"), ov.get("wrapper")
            if not isinstance(path, str):
                continue
            err = self._validate_wrapper(path, wrapper)
            if err is None:
                scenario_json[path] = wrapper
                applied += 1
            else:
                dropped.append(err)

        if dropped:
            logger.warning("Dropped %d invalid override(s): %s", len(dropped), "; ".join(dropped))
        logger.info("Built scenario from base %s (%d override(s) applied)", base_path.name, applied)
        return GeneratedScenario(
            scenario_json=scenario_json,
            filename=self._safe_filename(arguments.get("filename") or "", fallback=base_path.name),
            description=str(arguments.get("description", "")).strip(),
        )


def _parse_scenario_filename(filename: str) -> dict[str, Any]:
    """Decode the scenario-filename dimensions.

    Port of fact-explorer/src/model/scenarioFilename.js so the model sees the same
    dimensions the audit panel and Fact Explorer decode.
    """
    parts = filename.replace(".json", "").split("_")
    eligibility = "qualifying"
    if parts and parts[0] in ("dq", "ko"):
        eligibility = "disqualifying" if parts[0] == "dq" else "knockout"
        parts = parts[1:]

    filing_status = parts[0] if parts else ""
    parts = parts[1:]

    marital = None
    if filing_status == "hoh" and parts and parts[0] in ("married", "unmarried"):
        marital = parts[0]
        parts = parts[1:]

    qc_count = ""
    for part in parts:
        m = re.match(r"^(\d+)qcs?$", part, re.IGNORECASE)
        if m:
            qc_count = m.group(1)
            break

    income_band = "none"
    if parts:
        try:
            income = int(parts[-1])
        except ValueError:
            income = None
        if income is not None:
            if income < 20000:
                income_band = "low"
            elif income < 52000:
                income_band = "mid-low"
            elif income < 59000:
                income_band = "mid-high"
            else:
                income_band = "high"

    return {
        "eligibility": eligibility,
        "filing_status": filing_status,
        "marital": marital,
        "qc_count": qc_count,
        "income_band": income_band,
    }
