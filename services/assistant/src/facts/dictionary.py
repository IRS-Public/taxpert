"""Fact dictionary XML parser for the EITC fact-graph."""

from __future__ import annotations

import urllib.request
from dataclasses import dataclass
from urllib.parse import urlparse

from lxml import etree

# Hardened XML parser: disable DTD loading, entity resolution and network access
# so a malicious or malformed fact-dictionary.xml cannot trigger XXE / billion-laughs
# entity expansion or fetch external resources while we parse it.
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

        ``source`` is operator config (FACT_DICTIONARY_PATH / FACT_DICTIONARY_URL),
        not user input. We still restrict URL loads to the http/https schemes so a
        ``file://`` or other custom scheme can never be opened via ``urlopen`` (B310),
        and parse with a hardened parser that blocks XXE / entity expansion.
        """
        scheme = urlparse(source).scheme
        if scheme in ("http", "https"):
            with urllib.request.urlopen(
                source
            ) as response:  # nosec B310 — scheme restricted to http/https above
                xml_bytes = response.read()
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
        # Facts can appear as <Fact> or <WritableFact> elements anywhere in the tree
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

            # is_writable: True if tag is WritableFact OR has a <Writable> child
            is_writable = local == "WritableFact" or elem.find("Writable") is not None

            # Collect direct <Dependency> children only (not nested ones under Derived etc.)
            # The spec says "all <Dependency> children" — we treat all descendants to capture
            # the formula dependencies for this fact.
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
