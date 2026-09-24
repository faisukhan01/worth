# Changelog

All notable changes to Lodestar are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-09-24

Initial release of the Lodestar Enterprise Observability & AIOps platform.

### Added

- **ingest-gateway (Go 1.23, :3100)** - zero-dependency ingestion service:
  `POST /v1/ingest/metrics`, `POST /v1/ingest/logs`, `GET /v1/query/metrics`,
  `GET /v1/logs`, `GET /v1/stats`, `GET /v1/health`, `GET /v1/stream` (SSE);
  `x-api-key` auth (`pg_live_*`); synthesizes traffic for 6 seed services.
- **aiops-engine (Python 3.12 / FastAPI / numpy, :3200)** - pull-based AIOps:
  anomalies, forecasts, per-service health scores and summary via
  `GET /v1/insights`; polls the gateway every 5s.
- **web (Next.js 16, :3000)** - 8-view enterprise dashboard at `/`, relative
  `/api/*` server-side proxy routes with 1.5s timeout + simulated fallback,
  Prisma + SQLite persistence (`db/custom.db`).
- **billing-core (Java 17 / Spring Boot 3, :4100)** - billing code tier with
  file-backed H2 storage.
- **reporting (C# / .NET 8, :4200)** - reporting code tier.
- **pulseagent (C)** - edge agent reading real host metrics from `/proc`
  (cpu, memory, load) and shipping them to the gateway.
- **Containers** - multi-stage `Dockerfile.web` (bun build -> node:20-alpine
  non-root runner with healthcheck), `.dockerignore`, `docker-compose.yml`
  wiring all five services plus the `full` profile for the agent, healthchecks,
  named volumes and the `lodestar-net` bridge network.
- **Kubernetes base** - `k8s/base` kustomize layer: namespace, configmap,
  secret template, deployments with probes/resources/securityContext, HPA on
  the gateway (CPU 70%, 2-6 replicas), nginx ingress routing `/v1` -> gateway
  and `/` + `/api` -> web.
- **CI/CD** - paths-filtered GitHub Actions `ci` (bun/go/python/maven/dotnet/
  flutter build + lint, no tests by project rule), `release` workflow pushing
  images to `ghcr.io/lodestar-oss/*` on `v*` tags with generated release
  notes, `codeql` scanning (go, java-kotlin, python, csharp), Dependabot
  across all ecosystems.
- **Infrastructure as code** - Terraform module (AWS provider ~> 5.0):
  VPC with 2 public + 2 private subnets, IGW/NAT, ECS Fargate cluster,
  task definitions and services with Cloud Map discovery, ALB with
  path-based routing and HTTPS placeholder, explicit security groups,
  CloudWatch log groups with retention.
- **Tooling and docs** - root `Makefile` (dev/build/lint/compose helpers),
  `ARCHITECTURE.md` with ADRs, `docs/api-contracts.md`,
  `docs/operations.md`, `CONTRIBUTING.md`, `SECURITY.md`, PR and issue
  templates, `.editorconfig`.

[0.1.0]: https://github.com/lodestar-oss/lodestar/releases/tag/v0.1.0
