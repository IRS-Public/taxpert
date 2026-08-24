"""Keyword search over the fact dictionary, backing the ``identify_facts`` tool.

Returns static structure only (paths, names, types, dependency paths). Live
values come from the tracked-fact tree the browser sends.
See ../../../../docs/internals/assistant-service.md
"""

from __future__ import annotations

from .dictionary import FactDictionary


def identify_facts(
    query: str,
    tracked_facts: list[str],
    dictionary: FactDictionary,
    max_results: int = 5,
) -> list[dict]:
    """Search the fact dictionary and return the most relevant facts.

    Priority tiers (returns as soon as a tier yields results):
    1. Exact path match
    2. Tracked-facts match (path in tracked_facts AND query appears in fact text)
    3. Keyword scoring across all facts
    """

    def _to_result(fact) -> dict:
        return {
            "path": fact.path,
            "name": fact.name,
            "type_name": fact.type_name,
            "description": fact.description[:200],
            "is_writable": fact.is_writable,
            "dependencies": fact.dependencies,
        }

    # Tier 1: exact path match
    if query in dictionary.facts_by_path:
        return [_to_result(dictionary.facts_by_path[query])]

    q_lower = query.lower()

    # Tier 2: tracked facts match
    if tracked_facts:
        matches = [
            dictionary.facts_by_path[p]
            for p in tracked_facts
            if p in dictionary.facts_by_path
            and q_lower
            in (
                p + dictionary.facts_by_path[p].name + dictionary.facts_by_path[p].description
            ).lower()
        ]
        if matches:
            return [_to_result(f) for f in matches[:max_results]]

    # Tier 3: keyword scoring, weighting path and name hits above description
    # hits so the canonical fact for a term outranks incidental mentions.
    keywords = q_lower.split()
    if not keywords:
        return []

    _PATH_NAME_WEIGHT = 3
    _DESCRIPTION_WEIGHT = 1

    scored: list[tuple[int, object]] = []
    for fact in dictionary.facts_by_path.values():
        path_name = (fact.path + " " + fact.name).lower()
        description = fact.description.lower()
        score = 0
        for kw in keywords:
            if kw in path_name:
                score += _PATH_NAME_WEIGHT
            elif kw in description:
                score += _DESCRIPTION_WEIGHT
        if score > 0:
            scored.append((score, fact))

    scored.sort(key=lambda t: t[0], reverse=True)
    return [_to_result(fact) for _, fact in scored[:max_results]]
