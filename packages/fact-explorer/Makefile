.PHONY: help
help: ## Print the help documentation
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## Install dependencies
	npm install

.PHONY: copy-uswds-assets
copy-uswds-assets: ## Vendor USWDS fonts/images into public/uswds/ (runs automatically after install)
	npm run copy-uswds-assets

.PHONY: dev
dev: ## Start development server
	npm run dev

.PHONY: build
build: ## Build for production
	npm run build

.PHONY: preview
preview: ## Preview production build locally
	npm run preview

.PHONY: test
test: ## Run tests
	npm test

.PHONY: lint
lint: ## Check code with ESLint
	npm run lint

.PHONY: lint-fix
lint-fix: ## Fix ESLint violations automatically
	npm run lint:fix

.PHONY: format
format: ## Format code with Prettier
	npm run format

.PHONY: format-check
format-check: ## Check code formatting without changes
	npm run format:check

.PHONY: check
check: lint-fix format format-check test ## Run all lint, format, and test checks

.PHONY: make-fgm
make-fgm: ## Generate every sibling Form Builder app's graph (APP=<id> for just one)
	npm run make-fgm -- $(if $(APP),--app $(APP))

.PHONY: build-registry
build-registry: ## Rediscover the apps beside this checkout into public/data/apps.json
	npm run build-registry
