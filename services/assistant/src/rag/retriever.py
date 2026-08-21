"""Synchronous RAG retriever backed by ChromaDB (HTTP server mode)."""

from __future__ import annotations

import json
import os
from typing import Any

import chromadb
import ollama


def get_chroma_client() -> chromadb.api.ClientAPI:
    """Build a Chroma HttpClient from env vars."""
    host = os.environ.get("CHROMA_HOST", "localhost")
    port = int(os.environ.get("CHROMA_PORT", "8001"))
    return chromadb.HttpClient(host=host, port=port)


def get_collection_name() -> str:
    return os.environ.get("CHROMA_COLLECTION", "irs_publications")


class RagRetriever:
    def __init__(
        self,
        client: chromadb.api.ClientAPI,
        collection_name: str,
        embedding_model: str,
    ) -> None:
        self._client = client
        self._collection_name = collection_name
        self._embedding_model = embedding_model

    def query(self, query: str, n_results: int = 5) -> list[dict[str, Any]]:
        """Embed *query* and return the n nearest chunks ranked by cosine distance.

        Result dict keys: content, page_number, section_title, chapter, rule,
        subsection, source, source_type, source_url, distance.
        """
        response = ollama.embed(model=self._embedding_model, input=query)
        query_vec: list[float] = response.embeddings[0]

        collection = self._client.get_or_create_collection(
            name=self._collection_name,
            metadata={"hnsw:space": "cosine"},
        )

        result = collection.query(
            query_embeddings=[query_vec],
            n_results=n_results,
        )

        documents = (result.get("documents") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]

        out: list[dict[str, Any]] = []
        for content, meta, dist in zip(documents, metadatas, distances):
            meta = meta or {}
            page_number = meta.get("page_number")
            out.append(
                {
                    "content": content,
                    "page_number": int(page_number) if page_number is not None else None,
                    "section_title": meta.get("section_title") or None,
                    "chapter": meta.get("chapter") or None,
                    "rule": meta.get("rule") or None,
                    "subsection": meta.get("subsection") or None,
                    "source": meta.get("source", ""),
                    "source_type": meta.get("source_type", "pdf"),
                    "source_url": meta.get("source_url"),
                    "distance": float(dist),
                }
            )

        return out


def main(query: str, n_results: int) -> None:
    client = get_chroma_client()
    collection_name = get_collection_name()
    embedding_model = os.environ.get("EMBEDDING_MODEL", "nomic-embed-text")

    retriever = RagRetriever(client, collection_name, embedding_model)
    results = retriever.query(query, n_results=n_results)

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    query = "What is the investment income limit and how is it calculated?"
    n_results = 5
    main(query, n_results)
