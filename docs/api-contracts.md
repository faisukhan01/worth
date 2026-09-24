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

Every sweep verdict is also persisted to a local `rule_sweeps` table (kept
to the newest 3000 rows) and returned by the status endpoint as `history` -
a per-rule verdict timeline (`{ at, action, currentValue }[]`, oldest ->
newest) that powers the sparkstrip in the rules table.

### GET/POST /api/reports/snapshots (report drift watch)

`src/lib/report-drift.ts` snapshots every catalogued service's 7-day SLA
through the C# reporting plane every **3 minutes** (background loop + a
sweep-on-read nudge in GET), stores the numbers in a local `report_snapshots`
table (48 kept per service) and diffs each snapshot against the previous one.

- `GET /api/reports/snapshots?limit=24` -
  `{ watched: string[], snapshots: Record<service, DriftSnapshot[]>, lastCycle, inProgress }`
  where `DriftSnapshot = { id, service, takenAt, windowDays, sloTarget,
  availability, burnRate, budgetRemaining, reportId }` (oldest -> newest per
  service).
- `POST /api/reports/snapshots` - take a cycle now. Body
  `{ serviceId?: string }`; without it every watched service is snapshotted.
  Returns the cycle: `{ at, durationMs, taken, drifts, results[] }` with per
  service `snapshot`, `diff` and optional `incidentId` / `incidentAction`.

Drift semantics: availability change >= **0.05pp** or burn change >= **x0.75**
between consecutive snapshots is drift; >= 0.2pp / x2 escalates to `critical`.
Drift registers a real incident (`source=report-drift`, dedupKey
`drift:<service>`) that dedupes while open and **auto-resolves once the
numbers settle** while still `triggered`. Full cycles only update
`lastCycle`; single-service POSTs only touch their own row.

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

## Admin / tenant onboarding (web tier, `/api/admin/*`)

Operator-only surface for onboarding client companies. Secrets follow a
write-once discipline: the full key/value is stored (needed for gateway
activation) but list endpoints only ever return masked forms; the raw
secret appears in exactly one response - the POST that created it.

- `GET /api/admin/tenants` -> `{tenants: [...]}` with each tenant's
  `keys` (masked), `sites` (incl. last probe result) and `credentials`
  (masked).
- `POST /api/admin/tenants` `{name, contact?, plan?, notes?,
  website?: {url, label?, kind?}}` -> 201 `{tenant, firstKey: {secret}}`.
  A first ingest key is provisioned automatically; the slug dedupes
  (`acme-corp`, `acme-corp-2`, ...). Validation: name >= 2 chars, contact
  must contain `@` when present, `plan` in
  `starter|growth|scale|enterprise`, website URL must parse as http(s).
- `PATCH /api/admin/tenants/:id` `{name?, contact?, plan?, status?,
  notes?}` - status is `active|suspended`; bad plan/status -> 400.
- `DELETE /api/admin/tenants/:id` - cascades keys, sites, credentials.
- `POST /api/admin/tenants/:id/keys` `{label?}` -> 201
  `{key: {masked...}, secret}` (shown once). 409 after 10 active keys.
- `DELETE /api/admin/keys/:id` - revoke (idempotent, sets `revoked`).
- `POST /api/admin/tenants/:id/sites` `{url, label?, kind?}` -> 201
  `{site}` (409 after 20 sites; `kind` in `website|api|software`).
- `POST /api/admin/sites/:id` - probe the endpoint NOW (GET, redirect
  follow, 8s timeout): persists `lastStatus up|down` (non-5xx counts as
  up), `lastHttpStatus`, `lastLatencyMs`, `lastCheckedAt` -> `{site,
  probe: {ok, httpStatus, latencyMs}}`.
- `DELETE /api/admin/sites/:id` - stop monitoring.
- `POST /api/admin/tenants/:id/credentials` `{name, value, kind?}` -> 201
  `{credential: {masked}}` (`kind` in `webhook|slack|custom`; 409 after
  10; value >= 8 chars).
- `DELETE /api/admin/credentials/:id` - remove.

Tenant ingest keys use the gateway-compatible `pg_live_` prefix. To
activate one against the Go gateway, add the full secret to the gateway's
`API_KEYS` allow-list (comma-separated env var) and restart the plane;
unlisted keys receive 401 from `/v1/ingest/*`.

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
