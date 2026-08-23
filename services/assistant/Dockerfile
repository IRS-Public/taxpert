# syntax=docker/dockerfile:1
#
# api — FastAPI chat backend. Build context is ./api.
# Deps are installed with uv from the committed uv.lock for reproducibility.
#
# The base is Docker Hub's python image with uv installed from PyPI, rather than astral's own
# `ghcr.io/astral-sh/uv:python3.12-bookworm-slim`. Nothing in this repository may depend on GitHub
# Packages — ghcr.io is that registry, and a pull from it is one `docker login` away from needing a
# token. uv is pinned here for the same reason the lockfile exists: the build should not drift.

FROM python:3.12-slim-bookworm AS runtime
ARG UV_VERSION=0.12.5
RUN pip install --no-cache-dir "uv==${UV_VERSION}"

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

# Install dependencies first (cached layer) using only the lock + manifest.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Then the application source (includes data/irs_publications used by the indexer).
COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
