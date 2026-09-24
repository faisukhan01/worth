# ingest-gateway

High-throughput telemetry ingestion service for **Lodestar**. Zero external
dependencies: the entire service is Go standard library, which keeps the
container at ~8 MB (distroless) and the p99 ingest path free of third-party
risk (ADR-002).

## Responsibilities

- Accept batched metrics and structured logs from agents and services
- Keep hot telemetry in bounded in-memory ring buffers (2 h per series)
- Serve downsampled series queries, log search, gateway stats and health
- Fan out live log traffic over Server-Sent Events (`GET /v1/stream`)
- Synthesise reference traffic for the six seed services so dashboards are
  never empty (`internal/collector`, disable via build tag in production)

## API

All protected routes require `x-api-key: <key>` (see `API_KEYS`).

| Method | Path                  | Description                                  |
| ------ | --------------------- | -------------------------------------------- |
| POST   | `/v1/ingest/metrics`  | Batch metric samples                         |
| POST   | `/v1/ingest/logs`     | Batch structured log lines                   |
| GET    | `/v1/query/metrics`   | Downsampled series (`names`, `range`, `points`, `service`, `source`) |
| GET    | `/v1/logs`            | Newest-first log search (`limit`, `level`, `service`, `q`) |
| GET    | `/v1/stream`          | SSE stream (`log` + `heartbeat` events)      |
| GET    | `/v1/stats`           | Gateway statistics                           |
| GET    | `/v1/health`          | Liveness probe                               |

## Run

```bash
make run                     # go run ./cmd/gateway (port 3100)
API_KEYS=k1,k2 make run      # custom keys
docker build -t lodestar/ingest-gateway .
```

## Example

```bash
curl -s -X POST localhost:3100/v1/ingest/metrics \
  -H 'content-type: application/json' \
  -H 'x-api-key: pg_live_demo_key' \
  -d '{"metrics":[{"name":"cpu.usage","value":42.5,"tags":{"host":"edge-1","source":"agent"}}]}'

curl -s 'localhost:3100/v1/query/metrics?names=latency.p99&range=30m&points=120&service=checkout-service' \
  -H 'x-api-key: pg_live_demo_key'
```

## Configuration

| Variable       | Default             | Notes                          |
| -------------- | ------------------- | ------------------------------ |
| `PORT`         | `3100`              | HTTP listen port               |
| `API_KEYS`     | `pg_live_demo_key`  | Comma-separated allow-list     |
| `RING_SECONDS` | `7200`              | Per-series retention (seconds) |
| `LOG_CAPACITY` | `8000`              | Log ring capacity              |

## Why Go

Concurrency-cheap fan-in of thousands of concurrent agent connections,
predictable GC pauses under sustained ingest, single static binary deploys.
This is the same reasoning Datadog's Vector-agents and GitHub's log ingestion
pipelines apply.
