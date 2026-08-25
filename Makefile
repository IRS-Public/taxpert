# Convenience wrapper around the docker-compose stack. See README.md.
.PHONY: up down logs build rebuild ps tidy apps

# Every service in this repository is behind a profile, because none of them is an application:
# a bare `docker compose up` deliberately starts nothing. These targets run the lot. Narrow it with
# `make up PROFILES=--profile explorer`.
PROFILES ?= --profile explorer --profile ai

# The application mounts, one fragment per app, from docker-compose.apps.d/ — see the README there.
# A generated app's `make up` writes its own fragment, which is how an application living outside
# TAXPERT_APPS_DIR reaches Fact Explorer without a symlink that would dangle inside the container.
#
# Naming any -f at all turns off Compose's automatic pickup of docker-compose.override.yml, so the
# overlay has to be listed explicitly here. Order is the merge order: base, dev overlay, then the
# app mounts, whose `volumes:` entries append to the ones already there rather than replacing them.
COMPOSE_FILES := -f docker-compose.yml -f docker-compose.override.yml $(patsubst %,-f %,$(wildcard docker-compose.apps.d/*.yml))
COMPOSE := docker compose $(COMPOSE_FILES) $(PROFILES)

# Where the applications are, resolved the way Compose resolves it for the bind mount: the
# environment first, then .env, then the ./apps default. Only `make apps` reads this — the compose
# files interpolate ${TAXPERT_APPS_DIR} themselves — and it is here so that what that target prints
# is what the container will actually mount, rather than the default it would otherwise assume.
APPS_DIR := $(or $(TAXPERT_APPS_DIR),$(shell sed -n 's/^TAXPERT_APPS_DIR=//p' .env 2>/dev/null | tail -1),./apps)

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
	@$(MAKE) --no-print-directory apps
	$(COMPOSE) up --build

down: ## Stop and remove the stack
	$(COMPOSE) down

logs: ## Tail logs from all services
	$(COMPOSE) logs -f

build: ## Build images without starting
	$(COMPOSE) build

rebuild: ## Tear down the stack, drop its volumes, and rebuild images from scratch (no cache)
	@# down -v first: the chroma-data volume persists across plain `down`/`up`, so a stale document
	@# index would otherwise survive a "from scratch" rebuild. Compose recreates it empty on the
	@# next `up`, at which point chromadb repopulates it.
	$(COMPOSE) down -v
	$(COMPOSE) build --no-cache
	$(COMPOSE) up

ps: ## Show service status
	$(COMPOSE) ps

apps: ## List the applications Fact Explorer will discover, and where each comes from
	@# Printed before every `up` because the two sources answer different questions and a missing
	@# app is otherwise a blank menu with no explanation. Author Mode is per-app: the Authoring Suite
	@# entry appears for an app whose descriptor sets capabilities.authorMode, and the API it talks to
	@# runs in that app's own stack, not this one.
	@echo "==> TAXPERT_APPS_DIR: $(APPS_DIR)"
	@for d in $(APPS_DIR)/*/; do \
		[ -f "$$d/fact-explorer.app.json" ] && echo "    $$(basename $$d)"; \
	done 2>/dev/null || true
	@if [ -n "$(wildcard docker-compose.apps.d/*.yml)" ]; then \
		echo "==> docker-compose.apps.d:"; \
		for f in $(wildcard docker-compose.apps.d/*.yml); do \
			echo "    $$(basename $$f .yml)  ($$f)"; \
		done; \
	else \
		echo "==> docker-compose.apps.d: no application fragments"; \
		echo "    A generated app registers itself here on its own \`make up\`."; \
	fi
