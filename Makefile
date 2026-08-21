# Convenience wrapper around the docker-compose stack. See README.md.
.PHONY: up down logs build rebuild ps tidy

# Every service in this repository is behind a profile, because none of them is an application:
# a bare `docker compose up` deliberately starts nothing. These targets run the lot. Narrow it with
# `make up PROFILES=--profile explorer`.
PROFILES ?= --profile explorer --profile ai

# Run each sub-project's format + lint commands, but only for repos that have
# uncommitted changes (staged, unstaged, or untracked). A repo with a clean
# working tree is skipped entirely.
tidy: ## Format + lint only the sub-projects with changes
	@if [ -n "$$(git status --porcelain -- services/assistant)" ]; then \
		echo "==> assistant: changes detected, running format + lint"; \
		$(MAKE) -C services/assistant format && $(MAKE) -C services/assistant lint; \
	else \
		echo "==> assistant: no changes, skipping"; \
	fi
	@if [ -n "$$(git status --porcelain -- packages/fact-explorer)" ]; then \
		echo "==> fact-explorer: changes detected, running format + lint"; \
		$(MAKE) -C packages/fact-explorer format && $(MAKE) -C packages/fact-explorer lint; \
	else \
		echo "==> fact-explorer: no changes, skipping"; \
	fi
	@if [ -n "$$(git status --porcelain -- packages/ui)" ]; then \
		echo "==> taxpert: changes detected, running format + lint"; \
		npm --prefix packages/ui run format && npm --prefix packages/ui run lint; \
	else \
		echo "==> taxpert: no changes, skipping"; \
	fi

up: ## Build (first run) and start the whole stack
	docker compose $(PROFILES) up --build

down: ## Stop and remove the stack
	docker compose $(PROFILES) down

logs: ## Tail logs from all services
	docker compose $(PROFILES) logs -f

build: ## Build images without starting
	docker compose $(PROFILES) build

rebuild: ## Tear down the stack, drop its volumes, and rebuild images from scratch (no cache)
	@# down -v first: the chroma-data volume persists across plain `down`/`up`, so a stale document
	@# index would otherwise survive a "from scratch" rebuild. Compose recreates it empty on the
	@# next `up`, at which point chromadb repopulates it.
	docker compose $(PROFILES) down -v
	docker compose $(PROFILES) build --no-cache
	docker compose $(PROFILES) up

ps: ## Show service status
	docker compose $(PROFILES) ps
