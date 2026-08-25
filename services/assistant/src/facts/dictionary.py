"""Parses an application's fact-dictionary.xml into ``Fact`` records by path.

Loaded once at startup from FACT_DICTIONARY_PATH or FACT_DICTIONARY_URL, and
shared by both orchestrators. See ../../../../docs/internals/assistant-service.md
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

import requests
from lxml import etree

# Hardened against XXE, entity expansion and external fetches. Keep in step with
# the parser in src/agent/scenario_orchestrator.py.
_SAFE_XML_PARSER = etree.XMLParser(
    resolve_entities=False,
    no_network=True,
    load_dtd=False,
    dtd_validation=False,
    huge_tree=False,
)


@dataclass
class Fact:
    path: str
    name: str
    description: str
    is_writable: bool
    type_name: str
    dependencies: list[str]


class FactDictionary:
    """Parsed representation of a fact-dictionary.xml file."""

    def __init__(self) -> None:
        self.facts_by_path: dict[str, Fact] = {}

    @classmethod
    def load(cls, source: str) -> "FactDictionary":
        """Load and parse a fact dictionary from a file path or HTTP(S) URL.

        URL loads go through ``requests`` (never ``urllib``, which also
        understands ``file://``) and are further restricted to http/https so a
        dynamic source string can never resolve to a local file read.
        """
        scheme = urlparse(source).scheme
        if scheme in ("http", "https"):
            response = requests.get(source, timeout=30)
            response.raise_for_status()
            xml_bytes = response.content
        elif scheme in ("", "file"):
            path = source[len("file://") :] if scheme == "file" else source
            with open(path, "rb") as fh:
                xml_bytes = fh.read()
        else:
            raise ValueError(f"Unsupported fact-dictionary source scheme: {scheme!r}")

        root = etree.fromstring(xml_bytes, parser=_SAFE_XML_PARSER)
        instance = cls()
        instance._parse(root)
        return instance

    def _parse(self, root: etree._Element) -> None:
        """Walk the XML tree and populate facts_by_path."""
        # <Fact> and <WritableFact> elements can appear at any depth.
        for elem in root.iter():
            local = etree.QName(elem.tag).localname if isinstance(elem.tag, str) else None
            if local not in ("Fact", "WritableFact"):
                continue

            path_attr = elem.get("path")
            if not path_attr:
                continue

            type_attr = elem.get("type", "")

            name_elem = elem.find("Name")
            name = (name_elem.text or "").strip() if name_elem is not None else ""

            desc_elem = elem.find("Description")
            description = (desc_elem.text or "").strip() if desc_elem is not None else ""

            is_writable = local == "WritableFact" or elem.find("Writable") is not None

            # All <Dependency> descendants, not only direct children, so nested
            # formula operands are captured too.
            dependencies: list[str] = []
            for dep in elem.iter("Dependency"):
                dep_path = dep.get("path")
                if dep_path:
                    dependencies.append(dep_path)

            fact = Fact(
                path=path_attr,
                name=name,
                description=description,
                is_writable=is_writable,
                type_name=type_attr,
                dependencies=dependencies,
            )
            self.facts_by_path[path_attr] = fact
