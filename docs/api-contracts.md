# Lodestar - API Contracts

Authoritative integration contracts for the Lodestar platform. The source of
truth is the worklog "API Contracts" section; this document formats it for
operators and integrators. **Do not drift** - changes here require a PR that
touches the owning service and this file together.

---

## Ingest gateway (Go, port 3100)

Base URL: `http://localhost:3100` (local), `http://ingest-gateway:3100`
(compose), `http://ingest-gateway.<namespace>:3100` (k8s).

### Authentication

All `/v1/ingest/*` endpoints require an API key header. Any `pg_live_*`
prefixed key is accepted in dev; the demo key is `pg_live_demo_key`.

```
x-api-key: pg_live_demo_key
```

### POST /v1/ingest/metrics

Ingest a batch of metric points.

```json
{
  "metrics": [
    { "name": "cpu.usage", "value": 42.5, "tags": { "host": "edge-1" }, "ts": 1727140800000 },
    { "name": "mem.used_pct", "value": 61.2, "tags": { "host": "edge-1" }, "ts": 1727140800000 }
  ]
}
```

```sh
curl -sS -X POST http://localhost:3100/v1/ingest/metrics \
  -H "x-api-key: pg_live_demo_key" \
  -H "Content-Type: application/json" \
  -d '{"metrics":[{"name":"cpu.usage","value":42.5,"tags":{"host":"edge-1"},"ts":1727140800000}]}'
```

### POST /v1/ingest/logs

Ingest a batch of log events.

```json
{
  "logs": [
    { "level": "error", "service": "billing-core", "message": "invoice write failed", "ts": 1727140800123 }
  ]
}
```

```sh
curl -sS -X POST http://localhost:3100/v1/ingest/logs \
  -H "x-api-key: pg_live_demo_key" \
  -H "Content-Type: application/json" \
  -d '{"logs":[{"level":"error","service":"billing-core","message":"invoice write failed","ts":1727140800123}]}'
```

### GET /v1/query/metrics

Query metric series. Query parameters: `names` (comma-separated, required),
`range` (e.g. `15m`), `points` (resolution, e.g. `120`).

Response shape:

```json
{
  "series": [
    {
      "name": "cpu.usage",
      "tags": { "host": "edge-1" },
      "points": [ { "ts": 1727140800000, "value": 42.5 } ]
    }
  ]
}
```

```sh
curl -sS "http://localhost:3100/v1/query/metrics?names=cpu.usage,mem.used_pct&range=15m&points=120" \
  -H "x-api-key: pg_live_demo_key"
```

### GET /v1/logs

Query stored logs. Query parameters: `limit`, `level`, `service`, `q`
(substring search).

```sh
curl -sS "http://localhost:3100/v1/logs?limit=50&level=error&service=billing-core&q=invoice" \
  -H "x-api-key: pg_live_demo_key"
```

Response shape: `{"logs": [ ... ], "total": 1}`.

### GET /v1/stats

Gateway runtime stats (buffer sizes, ingest counters, connected agents).

```sh
curl -sS http://localhost:3100/v1/stats
```

### GET /v1/health

Liveness/readiness for compose healthchecks, k8s probes and the ALB target
group. Returns `200` when the gateway is serving.

```sh
curl -sS http://localhost:3100/v1/health
```

### GET /v1/stream (SSE)

Server-Sent Events feed of live metric/log events for real-time UIs.

```sh
curl -sS -N http://localhost:3100/v1/stream
```

**Note:** the gateway internally synthesizes traffic for 6 seed services
(`source=simulated`); the C pulseagent feeds REAL host metrics on top.

---

## AIOps engine (Python, port 3200)

Base URL: `http://localhost:3200` (local), `http://aiops:3200` (compose),
`http://aiops-engine.<namespace>:3200` (k8s).

The engine **pulls** from the gateway every 5 seconds (ADR-003); it exposes
read-only endpoints.

### GET /v1/insights

Anomaly detection, forecasts, per-service health and a summary.

```json
{
  "anomalies": [ { "service": "checkout", "metric": "cpu.usage", "score": 4.2, "ts": 1727140800000 } ],
  "forecasts": [ { "service": "checkout", "metric": "cpu.usage", "horizon_points": 12, "values": [43.1] } ],
  "health": [ { "service": "checkout", "score": 87, "status": "healthy" } ],
  "summary": "3/6 services healthy, 1 anomaly in the last 15m"
}
```

```sh
curl -sS http://localhost:3200/v1/insights
```

### GET /v1/health

Liveness/readiness endpoint (used by compose, k8s probes and the ALB).

```sh
curl -sS http://localhost:3200/v1/health
```

### GET /v1/stats

Engine runtime stats (last poll age, series analyzed, detection counters).

```sh
curl -sS http://localhost:3200/v1/stats
```

---

## Web dashboard (Next.js 16, port 3000)

- Browser clients call **only relative `/api/*` routes** (same-origin).
- The Next.js server-side routes fetch `127.0.0.1:3100` / `127.0.0.1:3200`
  (overridable via `GATEWAY_URL` / `AIOPS_URL`) with a **1.5s timeout** and
  fall back to simulated data, so the UI degrades gracefully when backends
  are down.
- Database: Prisma + SQLite at `db/custom.db` (see ADR-004 for the
  production posture).

```sh
curl -sS http://localhost:3000/api/health
curl -sS http://localhost:3000/api/insights
```

### GET /api/logs/stream (SSE proxy)

Server-side proxy for the gateway's `/v1/stream`: attaches `x-api-key`
EventSource cannot send, then pipes the event bytes unchanged
(`event: log` / `event: heartbeat`). The Logs view "Live tail" toggle
consumes it; disconnecting the client aborts the upstream fetch.

```sh
curl -sS -N --max-time 3 http://localhost:3000/api/logs/stream
```

### POST /api/alerts/rules/test (rule metrics)

Besides gateway metrics (`error.rate`, `latency.p99`, ...) the test-fire /
dry-run evaluator accepts **report-backed SLO metrics**:

| metric              | value evaluated                             |
| ------------------- | ------------------------------------------- |
| `slo.burn_rate`     | `summary.burnRate` of the newest SLA report |
| `slo.availability`  | `summary.availabilityPct` of the newest SLA report |

No gateway window applies - the report carries its own; the response adds
`reportId` / `reportFrom` / `reportTo` / `sloTarget` to the evaluation.
Services without a stored report evaluate to `evaluable: false`.

### Background rule evaluator

`src/lib/rule-evaluator.ts` is the single evaluation engine shared by the
test-fire route and the background sweep. Three entry points:

- `GET /api/alerts/rules/evaluate-all` - evaluator status:
  `{ last: SweepResult | null, inProgress: boolean }`. `SweepResult` carries
  `at`, `durationMs`, `checked/fired/deduped/autoResolved/quiet/notEvaluable/errors`
  and per-rule `results[]` (`action: fired | deduped | auto-resolved | quiet |
  not-evaluable | error`, `reason`, `incidentId?`).
- `POST /api/alerts/rules/evaluate-all` - run a sweep now (concurrent calls
  collapse into the in-progress sweep).
- Background loop - `src/instrumentation.ts` starts a 60s interval at boot;
  additionally every `GET /api/alerts` fires a sweep-on-read nudge when the
  last sweep is older than a minute, so breaches still register in runtimes
  where the instrumentation hook never booted.

Sweep semantics: every **enabled** rule is evaluated; a breach with no open
`rule:<id>` incident registers a real incident (`source=rule`, dedupKey
`rule:<ruleId>`, timeline `triggered` with the observed value); a breach with
an open incident counts as `deduped` (no spam); a cleared condition
auto-resolves the rule's incident **only while it is still `triggered`**
(acknowledged/mitigated incidents stay open for a human to close).

### PATCH /api/alerts/rules/:id

Body `{ enabled: boolean }` - arm/mute a rule. Muting also auto-resolves the
rule's untouched (`triggered`) auto-fired incident with a `rule muted by
operator` timeline entry.

### POST/GET /api/incidents/:id/postmortem

`GET` returns `{ postmortem: string | null }` - the stored AI-drafted
markdown (null = not drafted). `POST` drafts one via the LLM plane from the
incident's timeline (last 30 entries), service catalog context (tier, owner,
SLO target) and the newest SLA report summary when one exists; the markdown
is persisted on the incident and a `postmortem` timeline event is appended.
The console renders it read-only with copy/download, or regenerate.

---

## Billing core (Java 17 / Spring Boot 3, port 4100) and Reporting (C# / .NET 8, port 4200)

These are **code-tier** services: their detailed routes, request/response
shapes and health endpoints are documented in their own READMEs
(`services/billing-core/README.md`, `services/reporting/README.md`). The
platform-level contract for them is limited to their port assignment and the
standard health probe paths used by compose/k8s/ALB
(`/actuator/health` for billing, `/healthz` for reporting).

---

## Contract change protocol

1. Open a PR updating `docs/api-contracts.md` and the owning service.
2. Flag the change in the PR template ("This changes an existing API contract").
3. Update consumers (web proxy routes, aiops pull client, agents) in the same
   release window; CI must stay green (build/lint only - no tests by rule).
