#!/usr/bin/env bash
# Entrypoint for the api container:
#   1. wait until ChromaDB answers,
#   2. build the RAG index on first run only (when the collection is empty),
#   3. hand off to uvicorn.
#
# Indexing embeds api/data/irs_publications/*.pdf via the host Ollama EMBEDDING_MODEL
# (nomic-embed-text), so `ollama serve` + `ollama pull nomic-embed-text` must be up.
set -euo pipefail

CHROMA_HOST="${CHROMA_HOST:-chromadb}"
CHROMA_PORT="${CHROMA_PORT:-8000}"
CHROMA_COLLECTION="${CHROMA_COLLECTION:-irs_publications}"

echo "[entrypoint] waiting for ChromaDB at ${CHROMA_HOST}:${CHROMA_PORT} ..."
uv run python - <<'PY'
import os, sys, time
import chromadb
host = os.environ.get("CHROMA_HOST", "chromadb")
port = int(os.environ.get("CHROMA_PORT", "8000"))
for _ in range(60):
    try:
        chromadb.HttpClient(host=host, port=port).heartbeat()
        print("[entrypoint] ChromaDB is up")
        sys.exit(0)
    except Exception:
        time.sleep(2)
print("[entrypoint] ERROR: ChromaDB never became reachable", file=sys.stderr)
sys.exit(1)
PY

echo "[entrypoint] checking whether the RAG index is populated ..."
NEED_INDEX="$(uv run python - <<'PY'
import os
import chromadb
host = os.environ.get("CHROMA_HOST", "chromadb")
port = int(os.environ.get("CHROMA_PORT", "8000"))
name = os.environ.get("CHROMA_COLLECTION", "irs_publications")
client = chromadb.HttpClient(host=host, port=port)
try:
    count = client.get_collection(name).count()
except Exception:
    count = 0
print("yes" if count == 0 else "no")
PY
)"

if [ "${NEED_INDEX}" = "yes" ]; then
    echo "[entrypoint] collection '${CHROMA_COLLECTION}' is empty -> indexing IRS publications"
    echo "[entrypoint] (needs host Ollama with '${EMBEDDING_MODEL:-nomic-embed-text}' pulled)"
    if ! uv run python -m src.rag.indexer; then
        echo "[entrypoint] WARNING: indexing failed; the chat will run without RAG retrieval" >&2
    fi
else
    echo "[entrypoint] index already populated; skipping"
fi

# Dev hot reload: set UVICORN_RELOAD=1 (see docker-compose.override.yml) to restart on
# source edits. WATCHFILES_FORCE_POLLING=true is needed for bind mounts on macOS.
RELOAD_ARGS=""
if [ "${UVICORN_RELOAD:-}" = "1" ] || [ "${UVICORN_RELOAD:-}" = "true" ]; then
    echo "[entrypoint] reload mode ON (watching src/)"
    RELOAD_ARGS="--reload --reload-dir src"
fi

echo "[entrypoint] starting API on :8000"
exec uv run uvicorn src.api.app:app \
    --host 0.0.0.0 --port 8000 --log-level info --timeout-keep-alive 60 ${RELOAD_ARGS}
