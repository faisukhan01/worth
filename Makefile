# =============================================================================
# Lodestar - Enterprise Observability & AIOps Platform
# Root Makefile: local development, builds, lint, and docker compose helpers.
#
# Usage:
#   make            # list targets (default: help)
#   make dev-web    # Next.js dev server on :3000
#   make up         # full stack via docker compose
# =============================================================================

.DEFAULT_GOAL := help
COMPOSE ?= docker compose

# ----------------------------------------------------------------- help
.PHONY: help
help: ## Show this help
	@echo "Lodestar - available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ------------------------------------------------------------ development
.PHONY: dev-web
dev-web: ## Run the Next.js web app in dev mode (port 3000)
	bun run dev

.PHONY: dev-gateway
dev-gateway: ## Run the Go ingest gateway (port 3100)
	cd services/ingest-gateway && go run ./cmd/gateway

.PHONY: dev-aiops
dev-aiops: ## Run the Python AIOps engine (port 3200)
	cd services/aiops-engine && uvicorn app.main:app --host 0.0.0.0 --port 3200 --reload

.PHONY: dev-billing
dev-billing: ## Run the Java billing core (port 4100) - requires mvn + JDK 17
	if [ -d services/billing-core ]; then cd services/billing-core && mvn -q spring-boot:run; \
	else echo "services/billing-core not present"; fi

.PHONY: dev-reporting
dev-reporting: ## Run the .NET reporting service (port 4200) - requires dotnet 8
	if [ -d services/reporting ]; then cd services/reporting && dotnet run; \
	else echo "services/reporting not present"; fi

.PHONY: run-agent
run-agent: ## Build and run the C edge agent (reads /proc, ships to gateway)
	if [ -f edge/pulseagent/Makefile ]; then $(MAKE) -C edge/pulseagent; fi
	if [ -x edge/pulseagent/pulseagent ]; then ./edge/pulseagent/pulseagent; \
	else echo "edge/pulseagent/pulseagent binary not found - build failed or agent not present"; exit 1; fi

# ------------------------------------------------------------------ build
.PHONY: build
build: ## Build every stack present on disk (web, gateway, agent, billing)
	bun run build
	if [ -d services/ingest-gateway ]; then echo ">> building gateway" \
		&& cd services/ingest-gateway && go build ./...; fi
	if [ -f edge/pulseagent/Makefile ]; then echo ">> building pulseagent" \
		&& $(MAKE) -C edge/pulseagent; fi
	if [ -d services/billing-core ]; then echo ">> building billing-core" \
		&& cd services/billing-core && mvn -B -ntp package -DskipTests; fi

# ------------------------------------------------------------------ compose
.PHONY: up
up: ## Start the full platform with docker compose (build if needed)
	$(COMPOSE) up -d --build

.PHONY: down
down: ## Stop the platform and remove containers
	$(COMPOSE) down

.PHONY: logs
logs: ## Tail docker compose logs (all services, last 100 lines)
	$(COMPOSE) logs -f --tail=100

# ------------------------------------------------------------------- lint
.PHONY: lint
lint: ## Lint every stack present on disk
	bun run lint
	if [ -d services/ingest-gateway ]; then echo ">> go vet (gateway)" \
		&& cd services/ingest-gateway && go vet ./...; fi
	if [ -d services/aiops-engine ]; then echo ">> ruff (aiops)" \
		&& cd services/aiops-engine && ruff check .; fi

# ------------------------------------------------------------------- seed
.PHONY: seed
seed: ## Seed the Prisma/SQLite database (requires the db:seed script)
	bun run db:seed

# ------------------------------------------------------------------ clean
.PHONY: clean
clean: ## Remove build artifacts, logs, and local binaries
	rm -rf .next coverage
	rm -f dev.log server.log nohup.out
	if [ -d services/ingest-gateway ]; then rm -rf services/ingest-gateway/bin; fi
	if [ -d services/billing-core ]; then rm -rf services/billing-core/target; fi
	if [ -d services/reporting ]; then rm -rf services/reporting/bin services/reporting/obj; fi
	if [ -f edge/pulseagent/Makefile ]; then $(MAKE) -C edge/pulseagent clean || true; fi
