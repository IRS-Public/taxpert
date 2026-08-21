.PHONY: install install-hooks dev chroma index test lint format check-format clean

install:
	uv sync --extra dev

install-hooks:
	uv run pre-commit install

# Dev server with logs streamed to the terminal.
dev:
	uv run uvicorn src.api.app:app --reload --port 8000 --log-level info --timeout-keep-alive 60

# Run a local ChromaDB HTTP server. Defaults match .env.example.
chroma:
	CHROMA_SERVER_CORS_ALLOW_ORIGINS='["http://localhost:3001"]' uv run chroma run --host 0.0.0.0 --port 8001 --path ./data/chroma

# Index PDFs (data/irs_publications/*.pdf) and HTML (data/html/*.html) into Chroma.
index:
	uv run python -m src.rag.indexer

test:
	uv run pytest tests/ -v

lint:
	uv run black --check src/ tests/

format:
	uv run black src/ tests/

check-format:
	uv run pre-commit run --all-files

clean:
	rm -rf .venv .pytest_cache
