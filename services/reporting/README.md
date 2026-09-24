# reporting (C# / .NET 8 Minimal API)

SLA/SLO availability reporting for Lodestar: computes availability, error budgets, daily
rollups and incident summaries from hourly telemetry, stores reports as JSON documents and
exports them as CSV. Listens on **port 4200**.

## Why C# here

Reporting is the platform's analytics/BI surface: it is tabular, computation-heavy and consumed
by humans and export pipelines, which is exactly the workload C# and .NET are tuned for. LINQ
expresses the rollup and grouping logic declaratively, `record` types give immutable API
contracts in one line each, and .NET 8's minimal APIs deliver the small HTTP surface without
ceremony. Strong typing with nullable reference types (warnings-as-errors in this project) keeps
the SLO math honest, and the language's first-class `DateOnly`/`DateTimeOffset` handling removes
the timezone bugs that plague report windows. C# also keeps billing-core (Java) and reporting
(C#) independent at the runtime level, so a reporting restart or deploy can never touch money
paths.

## How it works

- `SimulatedTelemetrySource` produces deterministic hourly request/error/latency samples per
  service (diurnal curve, weekends, occasional incidents). PRODUCTION NOTE: production binds
  this interface to the Go ingest gateway on port 3100 (`GET /v1/query/metrics`), folding real
  counters into the same `TelemetrySample` shape.
- `SlaCalculator` implements the Google-SRE formulas: availability `(1 - F/N) * 100`, error
  budget `(1 - slo) * window`, burn rate `(F/N) / (1 - slo)` with the 14.4 (fast) / 6.0 (slow)
  alerting thresholds, plus per-UTC-day rollups and 2%-error-rate incident detection.
- `FileReportStore` persists each report as JSON under `{Reporting:DataDir}/reports/` with
  semaphore-serialized, atomic (temp-file + move) writes.
- `RetentionWorker` sweeps reports older than `Reporting:RetentionDays` (default 90) at startup
  and every six hours.

## Run

Requires the .NET 8 SDK.

```bash
make run           # dotnet run -> http://localhost:4200 (Development)
make build         # dotnet build -c Release
make docker-build  # multi-stage container image
```

In Development the Swagger UI is served at `http://localhost:4200/swagger`; CORS is open for
the dashboard dev server. In Production Swagger is disabled and the image runs as non-root with
reports written under `/tmp/reporting` (override `Reporting__DataDir` plus a volume for durable
storage).

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/v1/reports/sla` | Generate an SLA report for a service/window and store it |
| GET | `/v1/reports/sla/{id}/export?format=csv\|json` | Export a stored report (default json) |
| GET | `/v1/reports` | List stored reports (`serviceId`, `limit` optional) |
| GET | `/v1/reports/{id}` | Fetch one stored report |
| GET | `/v1/health` | Health summary (same handler as `/healthz`, used by platform probes) |

Errors are RFC 7807 problem documents; validation failures return `application/problem+json`
with an `errors` map.

### curl examples

```bash
# 1. Generate a 7-day SLA report with the default SLO (99.9)
curl -s -X POST http://localhost:4200/v1/reports/sla \
  -H 'Content-Type: application/json' \
  -d '{
    "serviceId": "ingest-gateway",
    "from": "2025-01-08T00:00:00Z",
    "to": "2025-01-15T00:00:00Z"
  }' | jq
# => 201 Created; copy the "id" from the response body

# 2. Stricter SLO target on a 30-day window
curl -s -X POST http://localhost:4200/v1/reports/sla \
  -H 'Content-Type: application/json' \
  -d '{
    "serviceId": "aiops-engine",
    "from": "2024-12-16T00:00:00Z",
    "to": "2025-01-15T00:00:00Z",
    "sloTarget": 99.95
  }' | jq

# 3. List stored reports (optionally filtered)
curl -s "http://localhost:4200/v1/reports?limit=10" | jq '.[].id'
curl -s "http://localhost:4200/v1/reports?serviceId=ingest-gateway" | jq

# 4. Fetch one report
ID=<paste-id>
curl -s "http://localhost:4200/v1/reports/$ID" | jq '.summary'

# 5. Export as CSV (RFC 4180; summary + daily + incidents sections)
curl -s "http://localhost:4200/v1/reports/$ID/export?format=csv"

# 6. Health
curl -s http://localhost:4200/v1/health | jq
```

## Configuration

| Key | Default | Meaning |
| --- | ------- | ------- |
| `Reporting:DataDir` | `data` | Root directory for stored reports (`/tmp/reporting` in the image) |
| `Reporting:DefaultSlo` | `99.9` | SLO target applied when a request omits `sloTarget` |
| `Reporting:RetentionDays` | `90` | Age beyond which stored reports are deleted |

All keys can be overridden with standard .NET configuration (environment variables use the
double-underscore form, e.g. `Reporting__DefaultSlo=99.95`).

## Platform integration notes

- Kubernetes probes and the compose healthcheck target `/healthz`; the API contract also
  exposes the identical payload at `/v1/health`. Both are served by the same handler.
- The container image is the stock `mcr.microsoft.com/dotnet/aspnet:8.0` runtime (includes
  `curl` for the healthcheck) running as the non-root `app` user.
- CI builds this project with `dotnet build -c Release` under `TreatWarningsAsErrors`; there
  are intentionally no test files (project-wide rule).
