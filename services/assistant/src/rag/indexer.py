"""Builds the RAG index: chunk documents, embed with Ollama, upsert into ChromaDB.

Run with ``uv run python -m src.rag.indexer`` (``make index``). Requires a
reachable Ollama and a reachable Chroma server. The PDF branch of ``main`` is
commented out, so a normal run indexes HTML_DIR only.

Chunking strategy and the IRS-HTML heuristics are explained in
../../../../docs/internals/assistant-service.md
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any, Iterator

import fitz  # pymupdf
import ollama
from bs4 import BeautifulSoup
from src.rag.retriever import get_chroma_client, get_collection_name

logger = logging.getLogger(__name__)

_CHUNK_WORDS = 600
_OVERLAP_WORDS = 50
_MIN_CHUNK_WORDS = 20  # drop fragments smaller than this (nav scraps, stray cells)
_MAX_TABLE_CELLS = 30  # skip data tables bigger than this (EIC lookup tables)

_HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
_BLOCK_TAGS = {"p", "li", "td", "th", "pre"}

# IRS pages encode outline depth in heading role classes, not in the h-tag
# number, so both a Rule and its sub-topic can be <h4>.
_ROLE_DEPTH = {
    "role-chap": 1,  # "1. Rules for Everyone"
    "role-highlight": 1,  # intro Q&A ("What Is the EIC?")
    "worksheet": 2,  # worksheets sit beside Rules within a chapter
    "role-hd1": 2,  # "Rule 1—Adjusted Gross Income (AGI) Limits"
    "role-hd2": 3,  # "Earned Income"
    "role-hd3": 4,
}


def _heading_level(line: str) -> int | None:
    """Infer a heading depth for a plain-text line, or None if it is body text.

    Extracted PDF text has no markup, so depth comes from case: ALL-CAPS is
    depth 1, Title Case is depth 2.
    """
    stripped = line.strip()
    if not stripped or len(stripped) >= 80:
        return None
    # Dot leaders mark a table-of-contents entry, never a section heading.
    if ". ." in stripped or "..." in stripped:
        return None
    if stripped.isupper():
        return 1
    if stripped.istitle():
        return 2
    return None


def _split_into_chunks(text: str, chunk_words: int, overlap_words: int) -> list[str]:
    """Split *text* into overlapping chunks of ~chunk_words words."""
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    words = text.split()
    if not words:
        return []

    chunks: list[str] = []
    start = 0

    while start < len(words):
        end = min(start + chunk_words, len(words))

        if end < len(words):
            snap_start = start + int(chunk_words * 0.8)
            window = " ".join(words[snap_start:end])
            para_idx = window.rfind("\n\n")
            sent_idx = max(
                window.rfind(". "),
                window.rfind("! "),
                window.rfind("? "),
            )

            if para_idx != -1:
                prefix = window[: para_idx + 2]
                end = snap_start + len(prefix.split())
            elif sent_idx != -1:
                prefix = window[: sent_idx + 2]
                end = snap_start + len(prefix.split())

        chunks.append(" ".join(words[start:end]))
        if end >= len(words):
            break
        start = max(end - overlap_words, start + 1)

    return chunks


def _split_into_sections(text: str) -> list[tuple[str | None, str]]:
    """Split *text* into (breadcrumb_title, body) pairs on heading boundaries.

    Each title is the ``A > B`` trail of the headings scoping the body.
    """
    stack: list[tuple[int, str]] = []
    sections: list[tuple[str | None, str]] = []
    current_lines: list[str] = []

    def breadcrumb() -> str | None:
        return " > ".join(title for _, title in stack) or None

    for line in text.splitlines():
        level = _heading_level(line)
        if level is not None:
            if current_lines:
                sections.append((breadcrumb(), "\n".join(current_lines)))
                current_lines = []
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, line.strip()))
        else:
            current_lines.append(line)

    if current_lines:
        sections.append((breadcrumb(), "\n".join(current_lines)))

    return sections or [(None, text)]


def extract_pdf_chunks(pdf_path: str) -> list[dict[str, Any]]:
    """Open a PDF and return section-aligned chunk dicts.

    Chunks follow section boundaries rather than page boundaries, so
    page_number is always None.

    Keys: content, page_number, section_title, chunk_index.
    """
    doc = fitz.open(pdf_path)
    full_text = "\n".join(page.get_text() for page in doc)  # type: ignore[attr-defined]
    doc.close()

    all_chunks: list[dict[str, Any]] = []
    chunk_index = 0

    for section_title, section_text in _split_into_sections(full_text):
        for content in _split_into_chunks(section_text, _CHUNK_WORDS, _OVERLAP_WORDS):
            if len(content.split()) < _MIN_CHUNK_WORDS:
                continue
            embed_text = f"{section_title}\n\n{content}" if section_title else content
            all_chunks.append(
                {
                    "content": embed_text,
                    "page_number": None,
                    "section_title": section_title,
                    "chunk_index": chunk_index,
                }
            )
            chunk_index += 1

    return all_chunks


def _select_content_root(soup: BeautifulSoup) -> Any:
    """Pick the element holding the publication prose, skipping site chrome.

    IRS pages carry several ``field--name-body`` divs, most of them short stubs,
    so the largest one is the article. Other HTML falls back to article/main/body.
    """
    bodies = soup.find_all("div", class_="field--name-body")
    if bodies:
        return max(bodies, key=lambda b: len(b.get_text()))
    return soup.find("article") or soup.find("main") or soup.body or soup


def _heading_depth(tag: Any) -> int:
    """Logical outline depth for a heading, preferring IRS role classes."""
    for cls in tag.get("class") or []:
        if cls in _ROLE_DEPTH:
            return _ROLE_DEPTH[cls]
    return int(tag.name[1])  # h1 -> 1 ... h6 -> 6


def _section_meta(stack: list[tuple[int, str]]) -> dict[str, Any] | None:
    """Build a metadata dict from the current heading stack, or None if empty.

    Keys: section_title (the full ``A > B > C`` breadcrumb), chapter (depth 1),
    rule (depth 2), subsection (deepest heading at depth 3 or more).
    """
    if not stack:
        return None
    meta: dict[str, Any] = {
        "section_title": " > ".join(t for _, t in stack),
    }
    for depth, title in stack:
        if depth == 1:
            meta["chapter"] = title
        elif depth == 2:
            meta["rule"] = title
        else:
            meta["subsection"] = title
    return meta


def _extract_html_sections(root: Any) -> list[tuple[dict[str, Any] | None, str]]:
    """Walk *root* and group block text under a breadcrumb of ancestor headings.

    Returns ``(meta, text)`` pairs, *meta* as built by ``_section_meta``. Content
    before the first heading is dropped, since on IRS pages it duplicates the
    table of contents.
    """
    stack: list[tuple[int, str]] = []
    sections: list[tuple[dict[str, Any] | None, str]] = []
    buffer: list[str] = []
    seen_heading = False

    for element in root.descendants:
        name = getattr(element, "name", None)
        if name in _HEADING_TAGS:
            title = element.get_text(" ", strip=True)
            if not title:
                continue
            if buffer and seen_heading:
                sections.append((_section_meta(stack), "\n".join(buffer)))
            buffer = []
            seen_heading = True
            depth = _heading_depth(element)
            while stack and stack[-1][0] >= depth:
                stack.pop()
            stack.append((depth, title))
        elif name in _BLOCK_TAGS:
            txt = element.get_text(" ", strip=True)
            if txt:
                buffer.append(txt)

    if buffer and seen_heading:
        sections.append((_section_meta(stack), "\n".join(buffer)))

    if not sections:  # heading-less document: keep the whole body
        full_text = root.get_text("\n", strip=True)
        if full_text:
            sections = [(None, full_text)]

    return sections


def extract_html_chunks(html_path: str) -> list[dict[str, Any]]:
    """Parse an HTML file and return section-aligned chunk dicts.

    HTML has no pagination, so page_number is always None. The chunk's
    breadcrumb is prepended to its content before embedding.
    """
    with open(html_path, "r", encoding="utf-8") as fh:
        soup = BeautifulSoup(fh.read(), "html.parser")

    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    root = _select_content_root(soup)

    # The EIC lookup tables are thousands of numeric cells with no prose.
    for table in root.find_all("table"):
        if len(table.find_all("td")) > _MAX_TABLE_CELLS:
            table.decompose()

    all_chunks: list[dict[str, Any]] = []
    chunk_index = 0
    for section_meta, section_text in _extract_html_sections(root):
        section_title = section_meta.get("section_title") if section_meta else None
        for content in _split_into_chunks(section_text, _CHUNK_WORDS, _OVERLAP_WORDS):
            if len(content.split()) < _MIN_CHUNK_WORDS:
                continue
            embed_text = f"{section_title}\n\n{content}" if section_title else content
            all_chunks.append(
                {
                    "content": embed_text,
                    "page_number": None,
                    "section_title": section_title,
                    "chapter": section_meta.get("chapter") if section_meta else None,
                    "rule": section_meta.get("rule") if section_meta else None,
                    "subsection": section_meta.get("subsection") if section_meta else None,
                    "chunk_index": chunk_index,
                }
            )
            chunk_index += 1

    return all_chunks


def embed_chunks(chunks: list[dict[str, Any]], model: str) -> list[list[float]]:
    embeddings: list[list[float]] = []
    for chunk in chunks:
        response = ollama.embed(
            model=model,
            input=chunk["content"],
            options={"num_ctx": 8192},
        )
        embeddings.append(response.embeddings[0])
    return embeddings


def index_document(
    source_name: str,
    source_type: str,
    chunks: list[dict[str, Any]],
    collection: Any,
    embedding_model: str,
) -> int:
    """Embed and upsert all chunks for one document. Returns the count inserted.

    Ids are ``<source_name>:<chunk_index>``, so re-running updates in place.
    """
    if not chunks:
        return 0

    vectors = embed_chunks(chunks, embedding_model)

    ids = [f"{source_name}:{c['chunk_index']}" for c in chunks]
    metadatas = [
        {
            "source": source_name,
            "source_type": source_type,
            "page_number": c["page_number"] if c["page_number"] is not None else -1,
            "section_title": c["section_title"] or "",
            "chapter": c.get("chapter") or "",
            "rule": c.get("rule") or "",
            "subsection": c.get("subsection") or "",
            "chunk_index": c["chunk_index"],
        }
        for c in chunks
    ]
    documents = [c["content"] for c in chunks]

    collection.upsert(
        ids=ids,
        embeddings=vectors,
        metadatas=metadatas,
        documents=documents,
    )
    return len(chunks)


def _iter_pdfs(root: Path) -> Iterator[Path]:
    if root.exists():
        yield from sorted(root.glob("*.pdf"))


def _iter_html(root: Path) -> Iterator[Path]:
    if root.exists():
        yield from sorted(root.glob("*.html"))
        yield from sorted(root.glob("*.htm"))


def main() -> None:
    from dotenv import load_dotenv

    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    embedding_model = os.environ.get("EMBEDDING_MODEL", "nomic-embed-text")
    pdf_dir = Path(os.environ.get("PDF_DIR", "data/irs_publications"))
    html_dir = Path(os.environ.get("HTML_DIR", "data/html"))

    client = get_chroma_client()
    # client.delete_collection(name=get_collection_name())
    collection = client.get_or_create_collection(
        name=get_collection_name(),
        metadata={"hnsw:space": "cosine"},
    )

    total_files = 0
    total_chunks = 0

    # PDF indexing is off by default. Uncomment to index PDF_DIR as well.
    # for pdf_path in _iter_pdfs(pdf_dir):
    #     name = pdf_path.stem
    #     logger.info("Indexing PDF %s", pdf_path.name)
    #     chunks = extract_pdf_chunks(str(pdf_path))
    #     n = index_document(name, "pdf", chunks, collection, embedding_model)
    #     logger.info("  -> %d chunks", n)
    #     total_files += 1
    #     total_chunks += n

    for html_path in _iter_html(html_dir):
        name = html_path.stem
        logger.info("Indexing HTML %s", html_path.name)
        chunks = extract_html_chunks(str(html_path))
        n = index_document(name, "html", chunks, collection, embedding_model)
        logger.info("  -> %d chunks", n)
        total_files += 1
        total_chunks += n

    if total_files == 0:
        logger.warning("No documents found. Drop PDFs in %s or HTML in %s.", pdf_dir, html_dir)
    else:
        logger.info("Indexed %d files, %d total chunks", total_files, total_chunks)


if __name__ == "__main__":
    main()
