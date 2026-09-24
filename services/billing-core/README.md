# billing-core (Java 17 / Spring Boot 3)

Usage metering, quota enforcement, plan catalog and invoicing for Lodestar.
Listens on **port 4100**; persistence is an embedded H2 file database (`./data/billing` locally,
`/data/billing` in the container).

## Why Java here

Billing is the one subsystem where money must never be miscounted, so it gets the ecosystem with
the deepest hardening for exactly that problem: Java's strict static typing and `BigDecimal`
decimal arithmetic (no binary floating-point money anywhere), plus two decades of battle-
tested Spring tooling (JPA transactions, validation, actuator health probes and structured
scheduling). The rest of the platform optimises for throughput (Go, C) or developer velocity
(TypeScript, C#); billing optimises for auditability and correctness. Spring Boot 3.3 on Java 17
also runs lean enough to live happily in a single small container next to the other services.

## Domain model

- `Plan` - code-defined catalog (`STARTER` / `PRO` / `ENTERPRISE`) with base price, included
  events, included hosts and per-million overage.
- `UsageRecord` - append-only metered ledger, indexed `(org_id, metric_name, recorded_at)`.
- `ConsumedEvent` - idempotency tombstones keyed by producer event id.
- `QuotaState` - two-tier limits per `(org, metric)`: soft limit (default 80% of hard) warns,
  hard limit blocks ingestion.
- `Subscription` / `Invoice` - one subscription per org; invoices persist rendered line items as
  a JSON document and are immutable once issued.

Billable metrics: `ingested.events`, `ingested.gb`, `aiops.insights`.

## Run

Requires JDK 17+ and Maven (see repo root toolchain notes).

```bash
make run        # mvn spring-boot:run -> http://localhost:4100
make build      # mvn -DskipTests package
make docker-build
```

On first boot a demo tenant `org_demo` (PRO plan, 12 seats, 30 days of hourly usage, quota
states) is seeded automatically. Set `lodestar.billing.seed.enabled=false` to disable.

## API

All responses are JSON; errors are RFC 7807 problem documents.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/v1/usage/batch` | Ingest metered usage events (idempotent per external id, max 1000/batch) |
| GET | `/v1/usage/current` | Consumption over the open billing period |
| GET | `/v1/usage/summary` | Consumption for `period=yyyy-MM` with hourly/daily series |
| POST | `/v1/quotas/check` | "May I consume N more?" - commits on allow |
| GET | `/v1/quotas` | List quotas of an org |
| PUT | `/v1/quotas` | Admin limit override (`x-admin-key` header required) |
| POST | `/v1/invoices/generate` | Generate (or regenerate a draft) invoice for a period |
| GET | `/v1/invoices` | List invoices of an org |
| GET | `/v1/invoices/{id}` | Fetch one invoice |
| POST | `/v1/invoices/{id}/issue` | Draft -> issued (immutable) |
| POST | `/v1/invoices/{id}/pay` | Issued -> paid |
| GET | `/v1/plans` | Plan catalog |
| GET | `/v1/plans/{name}` | Single plan |
| GET | `/v1/health` | Liveness/dependency summary (actuator also at `/actuator/health`) |

### curl examples

```bash
# 1. Plan catalog
curl -s http://localhost:4100/v1/plans | jq
curl -s http://localhost:4100/v1/plans/PRO | jq

# 2. Ingest a batch of usage events
curl -s -X POST http://localhost:4100/v1/usage/batch \
  -H 'Content-Type: application/json' \
  -d '{
    "events": [
      {
        "externalId": "evt-0001",
        "orgId": "org_demo",
        "serviceId": "ingest-gateway",
        "metricName": "ingested.events",
        "quantity": 250000,
        "recordedAt": "2025-01-15T10:00:00Z"
      },
      {
        "externalId": "evt-0002",
        "orgId": "org_demo",
        "serviceId": "ingest-gateway",
        "metricName": "ingested.gb",
        "quantity": 4.5,
        "recordedAt": "2025-01-15T10:00:00Z"
      }
    ]
  }' | jq
# Re-submitting the same externalId is acknowledged as a duplicate, never billed twice.

# 3. Current-period consumption
curl -s "http://localhost:4100/v1/usage/current?orgId=org_demo" | jq
# Explicit month + hourly rollup
curl -s "http://localhost:4100/v1/usage/summary?orgId=org_demo&period=2025-01&granularity=hour" | jq

# 4. Quota check (does NOT require admin key; commits allowed consumption)
curl -s -X POST http://localhost:4100/v1/quotas/check \
  -H 'Content-Type: application/json' \
  -d '{"orgId": "org_demo", "metricName": "ingested.events", "additional": 1000000}' | jq

# 5. List and override quotas
curl -s "http://localhost:4100/v1/quotas?orgId=org_demo" | jq
curl -s -X PUT http://localhost:4100/v1/quotas \
  -H 'Content-Type: application/json' -H 'x-admin-key: change-me-admin-key' \
  -d '{"orgId": "org_demo", "metricName": "ingested.gb", "softLimit": 1500, "hardLimit": 2000}' | jq

# 6. Generate an invoice for the previous calendar month
curl -s -X POST http://localhost:4100/v1/invoices/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "orgId": "org_demo",
    "periodStart": "2025-01-01T00:00:00Z",
    "periodEnd": "2025-02-01T00:00:00Z"
  }' | jq

# 7. Issue, pay, fetch
ID=$(curl -s "http://localhost:4100/v1/invoices?orgId=org_demo" | jq -r '.[0].id')
curl -s -X POST "http://localhost:4100/v1/invoices/$ID/issue" | jq
curl -s -X POST "http://localhost:4100/v1/invoices/$ID/pay" | jq
curl -s "http://localhost:4100/v1/invoices/$ID" | jq

# 8. Health
curl -s http://localhost:4100/v1/health | jq
```

## Configuration

`src/main/resources/application.yml` (overridable via environment variables, e.g.
`SPRING_DATASOURCE_URL` in the container image):

| Key | Default | Meaning |
| --- | ------- | ------- |
| `server.port` | 4100 | HTTP port |
| `spring.datasource.url` | `jdbc:h2:file:./data/billing` | H2 file database location |
| `lodestar.billing.seed.enabled` | true | Seed the demo tenant on first boot |
| `lodestar.billing.admin-api-key` | `change-me-admin-key` | Key for admin quota overrides |
| `lodestar.billing.purge-cron` | `0 0 3 * * *` | Nightly idempotency tombstone purge |
| `lodestar.cors.allowed-origins` | `http://localhost:3000` | Dev CORS origins (comma separated) |

Production note: H2 keeps the demo self-contained. The ledger schema is intentionally simple
(single table, composite index, append-only writes) so swapping in Postgres via
`spring.datasource.url` requires no code changes; the idempotency tombstone table is the one
component documented for replacement with Redis at high throughput.
