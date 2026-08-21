"""Tests for the fact dictionary parser and keyword search."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from src.facts.dictionary import FactDictionary
from src.facts.search import identify_facts

# ---------------------------------------------------------------------------
# Fixture: load the dictionary once for the whole session
# ---------------------------------------------------------------------------

# Where to find a built fact dictionary, in the same precedence the service itself uses:
# FACT_DICTIONARY_PATH, then a local build, then FACT_DICTIONARY_URL. The local default is
# resolved from this file rather than hardcoded, so the suite runs from any checkout.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_LOCAL_PATH = Path(
    os.environ.get(
        "FACT_DICTIONARY_PATH",
        _REPO_ROOT / "credit-assistant/out/app/eitc/resources/fact-dictionary.xml",
    )
)
_FALLBACK_URL = os.environ.get(
    "FACT_DICTIONARY_URL",
    "http://localhost:3003/app/eitc/resources/fact-dictionary.xml",
)


@pytest.fixture(scope="session")
def dictionary() -> FactDictionary:
    source = str(_LOCAL_PATH) if _LOCAL_PATH.exists() else _FALLBACK_URL
    return FactDictionary.load(source)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_load_from_file(dictionary: FactDictionary) -> None:
    """Dictionary loads and contains more than 400 facts."""
    assert (
        len(dictionary.facts_by_path) > 400
    ), f"Expected > 400 facts, got {len(dictionary.facts_by_path)}"


def test_exact_path_match(dictionary: FactDictionary) -> None:
    """Exact path query returns exactly 1 result with the matching path first."""
    target = "/primaryFilerIsClaimingQualifyingChildren"
    results = identify_facts(target, [], dictionary)
    assert len(results) == 1
    assert results[0]["path"] == target


def test_keyword_search_filing_status(dictionary: FactDictionary) -> None:
    """Keyword search 'filing status' returns results with a relevant fact in top 5."""
    results = identify_facts("filing status", [], dictionary)
    assert len(results) > 0, "Expected at least one result for 'filing status'"
    assert len(results) <= 5

    paths_and_names = [(r["path"].lower(), r["name"].lower()) for r in results]
    found = any(
        ("filing" in p or "filing" in n) and ("status" in p or "status" in n)
        for p, n in paths_and_names
    )
    assert found, (
        "Expected a fact containing both 'filing' and 'status' in the top 5 results. "
        f"Got: {[r['path'] for r in results]}"
    )


def test_tracked_facts_priority(dictionary: FactDictionary) -> None:
    """Tracked facts are surfaced before non-tracked matches."""
    # Use a path that actually exists in the dictionary
    tracked_path = "/eitcChildGrossIncomeLimit"
    assert (
        tracked_path in dictionary.facts_by_path
    ), f"{tracked_path} not found in dictionary — update the test to a real path"

    results = identify_facts("eitc", [tracked_path], dictionary)
    assert len(results) > 0, "Expected at least one result"
    assert (
        results[0]["path"] == tracked_path
    ), f"Expected tracked fact '{tracked_path}' first, got '{results[0]['path']}'"


def test_no_raw_xml_in_results(dictionary: FactDictionary) -> None:
    """No result dict contains a key named 'xml' or 'raw_xml'."""
    results = identify_facts("income", [], dictionary)
    for result in results:
        assert "xml" not in result, f"Found forbidden key 'xml' in result: {result}"
        assert "raw_xml" not in result, f"Found forbidden key 'raw_xml' in result: {result}"
