"""Tests for the RAG indexer and retriever.

All tests work without a real Chroma or Ollama connection — every external
call is mocked.
"""

from __future__ import annotations

import tempfile
import textwrap
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import fitz  # pymupdf
from src.rag.indexer import (
    embed_chunks,
    extract_html_chunks,
    extract_pdf_chunks,
    index_document,
)
from src.rag.retriever import RagRetriever

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_temp_pdf(text_per_page: list[str]) -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp.close()

    doc = fitz.open()
    for text in text_per_page:
        page = doc.new_page()
        # insert_textbox wraps text across lines so it survives get_text();
        # insert_text writes a single line that clips at the page edge.
        rect = fitz.Rect(72, 72, page.rect.width - 72, page.rect.height - 72)
        page.insert_textbox(rect, text, fontsize=11)
    doc.save(tmp.name)
    doc.close()
    return tmp.name


def _make_temp_html(body: str) -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w", encoding="utf-8")
    tmp.write(body)
    tmp.close()
    return tmp.name


# ---------------------------------------------------------------------------
# PDF extraction
# ---------------------------------------------------------------------------


def test_extract_pdf_chunks_produces_dicts():
    sample_text = "INTRODUCTION\n\n" + ("This is a sentence about earned income tax credit. " * 20)
    pdf_path = _make_temp_pdf([sample_text])

    chunks = extract_pdf_chunks(pdf_path)

    assert len(chunks) >= 1
    required_keys = {"content", "page_number", "section_title", "chunk_index"}
    for chunk in chunks:
        assert required_keys == set(chunk.keys())
        assert isinstance(chunk["content"], str) and chunk["content"].strip()
        # Section-aligned extraction spans pages, so page_number is None.
        assert chunk["page_number"] is None
        assert isinstance(chunk["chunk_index"], int) and chunk["chunk_index"] >= 0


def test_pdf_chunk_overlap():
    # Unique tokens spread over several pages so the text exceeds one chunk;
    # consecutive chunks should share boundary words from the overlap window.
    pages = [
        " ".join(f"word{i}" for i in range(start, start + 300)) for start in range(0, 1200, 300)
    ]
    pdf_path = _make_temp_pdf(pages)

    chunks = extract_pdf_chunks(pdf_path)

    assert len(chunks) >= 2
    chunk0_words = set(chunks[0]["content"].split())
    chunk1_words = set(chunks[1]["content"].split())
    assert chunk0_words & chunk1_words


# ---------------------------------------------------------------------------
# HTML extraction
# ---------------------------------------------------------------------------


def test_extract_html_chunks_uses_breadcrumb_section_titles():
    # Each section must clear the _MIN_CHUNK_WORDS filter, so paragraphs are
    # padded to realistic length rather than one-liners.
    qc_para = (
        "A qualifying child must meet the age, relationship, residency, and joint return tests to count. "
        * 4
    )
    age_para = (
        "The child must be under nineteen at the end of the year, or under twenty-four if a full-time student. "
        * 4
    )
    html = textwrap.dedent(f"""
        <html><body>
          <h1>Qualifying Child</h1>
          <p>{qc_para}</p>
          <h2>Age Test</h2>
          <p>{age_para}</p>
        </body></html>
        """)
    path = _make_temp_html(html)
    chunks = extract_html_chunks(path)

    assert len(chunks) >= 2
    titles = {c["section_title"] for c in chunks}
    # Nested headings produce a breadcrumb trail, not a bare leaf title.
    assert "Qualifying Child" in titles
    assert "Qualifying Child > Age Test" in titles
    for c in chunks:
        assert c["page_number"] is None
        # The breadcrumb is prepended to the embedded content.
        assert c["content"].startswith(c["section_title"])


def test_extract_html_chunks_with_no_headings_falls_back_to_full_body():
    para = (
        "Just one paragraph of text that is long enough to survive the minimum chunk word filter applied during extraction. "
        * 3
    )
    html = f"<html><body><p>{para}</p></body></html>"
    path = _make_temp_html(html)
    chunks = extract_html_chunks(path)

    assert len(chunks) == 1
    assert "Just one paragraph of text" in chunks[0]["content"]
    assert chunks[0]["section_title"] is None


# ---------------------------------------------------------------------------
# Embedding + upsert
# ---------------------------------------------------------------------------


def test_embed_chunks_called_per_chunk():
    fake_embedding = [0.0] * 384
    chunks: list[dict[str, Any]] = [
        {"content": "chunk one", "page_number": 1, "section_title": None, "chunk_index": 0},
        {"content": "chunk two", "page_number": 1, "section_title": None, "chunk_index": 1},
        {"content": "chunk three", "page_number": 2, "section_title": None, "chunk_index": 2},
    ]

    with patch("src.rag.indexer.ollama.embed") as mock_embed:
        # ollama.embed returns an EmbedResponse whose .embeddings is a list of vectors.
        mock_embed.return_value = MagicMock(embeddings=[fake_embedding])
        result = embed_chunks(chunks, model="nomic-embed-text")

    assert mock_embed.call_count == 3
    assert len(result) == 3
    for vec in result:
        assert vec == fake_embedding


def test_index_document_upserts_to_collection():
    fake_embedding = [0.1] * 384
    chunks = [
        {"content": "alpha", "page_number": 1, "section_title": "A", "chunk_index": 0},
        {"content": "beta", "page_number": 2, "section_title": "B", "chunk_index": 1},
    ]
    fake_collection = MagicMock()

    with patch("src.rag.indexer.ollama.embed") as mock_embed:
        mock_embed.return_value = MagicMock(embeddings=[fake_embedding])
        n = index_document("pub_596", "pdf", chunks, fake_collection, "nomic-embed-text")

    assert n == 2
    fake_collection.upsert.assert_called_once()
    kwargs = fake_collection.upsert.call_args.kwargs
    assert kwargs["ids"] == ["pub_596:0", "pub_596:1"]
    assert kwargs["documents"] == ["alpha", "beta"]
    assert kwargs["metadatas"][0]["source"] == "pub_596"
    assert kwargs["metadatas"][0]["source_type"] == "pdf"
    assert kwargs["metadatas"][0]["page_number"] == 1
    assert kwargs["metadatas"][0]["section_title"] == "A"


# ---------------------------------------------------------------------------
# Retriever
# ---------------------------------------------------------------------------


def test_retriever_query_returns_normalised_shape():
    fake_embedding = [0.1] * 384

    fake_collection = MagicMock()
    fake_collection.query.return_value = {
        "documents": [["EITC requires earned income."]],
        "metadatas": [
            [
                {
                    "source": "pub_596",
                    "source_type": "pdf",
                    "page_number": 3,
                    "section_title": "EARNED INCOME",
                }
            ]
        ],
        "distances": [[0.12]],
    }

    fake_client = MagicMock()
    fake_client.get_or_create_collection.return_value = fake_collection

    with patch("src.rag.retriever.ollama.embed") as mock_embed:
        mock_embed.return_value = MagicMock(embeddings=[fake_embedding])
        retriever = RagRetriever(
            client=fake_client,
            collection_name="irs_publications",
            embedding_model="nomic-embed-text",
        )
        results = retriever.query("what is EITC?", n_results=5)

    assert len(results) == 1
    r = results[0]
    assert r["content"] == "EITC requires earned income."
    assert r["page_number"] == 3
    assert r["section_title"] == "EARNED INCOME"
    assert r["source"] == "pub_596"
    assert r["source_type"] == "pdf"
    assert isinstance(r["distance"], float)

    # Ensure the query passed our embedding
    fake_collection.query.assert_called_once()
    call_kwargs = fake_collection.query.call_args.kwargs
    assert call_kwargs["query_embeddings"] == [fake_embedding]
    assert call_kwargs["n_results"] == 5
