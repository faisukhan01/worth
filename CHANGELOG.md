# Changelog

All notable changes to Lodestar are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added - console iteration 10
- **Background rule evaluator** - armed rules are now evaluated every minute
  without human input. `src/lib/rule-evaluator.ts` is a single engine shared
  by the test-fire route, an on-demand sweep (`POST
  /api/alerts/rules/evaluate-all`) and the background loop
  (`src/instrumentation.ts`, 60s cadence) with a sweep-on-read nudge in
  `GET /api/alerts` so breaches keep flowing even without the hook. Breach
  with no open incident -> real incident registered (`source=rule`, dedupKey
  `rule:<id>`, observed value in the timeline); breach with open incident ->
  deduped; cleared condition -> auto-resolve while still `triggered`.
  The Rules tab gains an auto-evaluator status strip (pulsing liveness dot,
  last-sweep summary, "Sweep now") and per-rule last-verdict chips
  (fired / deduped / auto-resolved / quiet / no data) with reasons on hover.
- **Rule arm/mute** - `PATCH /api/alerts/rules/:id` (`{enabled}`) plus a
  toggle pill per rule row; muting also auto-resolves the rule's untouched
  auto-fired incident (`rule muted by operator` timeline entry) so muted
  rules leave no dangling alerts.
- **AI postmortem drafts** - new `POST/GET /api/incidents/:id/postmortem`:
  the LLM plane drafts a full postmortem (Summary, Impact, Timeline, Root
  cause analysis with clearly labelled hypotheses, What went well / What to
  improve, Action-item checklist) from the incident's live timeline, service
  catalog context and the newest SLA report summary. The markdown is stored
  on the incident (new `postmortem` column) with a `postmortem` timeline
  event; the expanded incident card renders it (dependency-free markdown
  renderer with task-checkbox support) alongside Copy / .md download /
  Regenerate.
- Ops: smoke.sh gains an evaluator-status probe (18 total) and a deep
  sweep probe; api-contracts.md documents the evaluator, mute and
  postmortem endpoints.

### Fixed - iteration 10
- Radix `DialogContent` missing-description a11y warning on the New-rule
  dialog (`aria-describedby={undefined}`).
- Postmortem reads/writes go through parameterized raw SQL for the new
  column so the long-running dev server (Turbopack-cached Prisma client)
  can use the feature before its next restart.

### Added - console iteration 7+8
- **SLO burn-rate alert rules (Alerts)** - the rule evaluator accepts
  report-backed metrics `slo.burn_rate` / `slo.availability`: instead of
  gateway series it reads the newest SLA report for the service from the C#
  reporting plane (no window applies; the report carries its own) and returns
  `reportId`/`reportFrom`/`reportTo`/`sloTarget` alongside the verdict. The
  new-rule dialog groups the SLO metrics under a "reporting plane" label,
  swaps in sensible thresholds (burn 2 / availability 99.9), disables the
  window input and explains the evaluation source; armed SLO rules carry a
  violet SLO badge in the rules table. Services without a stored report
  evaluate to `evaluable: false` with a pointed reason.
- **Live log tail (Logs)** - new `GET /api/logs/stream` server-side proxy for
  the gateway SSE fan-out (attaches `x-api-key` EventSource cannot send,
  pipes bytes unchanged, aborts upstream on client disconnect). The Logs view
  gains a Live tail toggle: fresh rows stream in above the ring buffer with a
  `live` badge and rise-in accent, dedupe against the 5s poller, respect the
  active level/service/grep filters (re-checked at render time so rows that
  arrived under an earlier filter cannot linger), and the footer shows live
  gateway stats (agents / rps / series) from SSE heartbeats.
- **Activity deep-links (Alerts)** - every audit-trail row is now a button:
  clicking it switches to the Incidents tab, resets filters, expands the
  incident, smooth-scrolls it into view and flashes a ring for 2.6s.
  Deep-linked resolved incidents beyond the usual 6-row tail are revealed.
- **Smoke probe: SSE** - `scripts/smoke.sh` gained a live-stream section
  probing gateway `/v1/stream` and the console proxy (17 checks total);
  docs/operations.md and docs/api-contracts.md updated accordingly.

### Fixed - iteration 7+8
- **Gateway SSE 500 "streaming unsupported"** - the log middleware's
  `statusRecorder` wrapper did not implement `http.Flusher`, so every
  `/v1/stream` request failed the flusher assertion and 500'd. The recorder
  now forwards Flush; gateway rebuilt and verified streaming through both the
  direct endpoint and the console proxy.

### Added - console iteration 6
- **Theme switching** - next-themes wired into the console (class strategy,
  dark default, OS preference honoured); topbar sun/moon toggle with a
  hydration-safe mount guard; per-theme `color-scheme` so form controls and
  scrollbars follow; verified across all views in both modes.
- **Alert rule test-fire + drills (Alerts)** - `POST /api/alerts/rules/test`
  evaluates a saved (or unsaved) rule against live gateway telemetry with
  gateway range-snapping and a host-metric fallback for agent feeds; the rules
  table gains per-row Test buttons whose verdict toasts offer a one-click
  "Fire drill" that registers a dedup'd DRILL incident for on-call rehearsal;
  the new-rule dialog shows a live dry-run preview before arming.
- **Auto-promotion (AIOps)** - persisted toggle in the anomaly feed; promotes
  active CRITICAL anomalies into the incident register automatically,
  rate-limited to one per 90s and dedup-aware so detection storms cannot flood
  the register.

### Added - console iteration 5
- **Error budgets panel (Overview)** - latest SLA report per service from the
  C# reporting plane: availability, remaining budget bar, burn rate; the host
  ribbon now plots real daily uptime from the newest report instead of
  synthetic data.
- **Inline incident actions (AIOps)** - anomaly cards that are already in the
  incident register expose acknowledge / resolve directly (PATCH lifecycle
  with 409 guards), closing the promote -> ack -> resolve loop in one view.
- **Report comparison (Reports)** - pick any two saved SLA reports (A/B chips
  in the saved list) and render a drift table (availability, budget, burn,
  downtime, failed requests, episodes) plus a day-aligned availability
  tornado strip with exact deltas; deltas are colored by operational impact,
  not sign.

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
