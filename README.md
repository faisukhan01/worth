<div align="center">

<img src="docs/assets/logo.svg" alt="Lodestar" width="72" />

# Lodestar

**Enterprise Observability & AIOps Platform**

Unified telemetry ingestion, explainable anomaly detection, and on-call
incident workflows — in one polyglot platform.

`Go` · `C` · `Python` · `Java` · `C#` · `TypeScript` · `Dart/Kotlin` · `DevOps`

[Architecture](ARCHITECTURE.md) · [API Contracts](docs/api-contracts.md) · [Operations](docs/operations.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## Why Lodestar

Infrastructure teams run 20+ tools stitched together with duct tape: one for
metrics, one for logs, one for alerting, one for on-call. Lodestar collapses
that stack into a single system where a metric sample that leaves `/proc`
on an edge host reaches an explainable AI verdict and an actionable incident
register in under a minute — with **every link in that chain owned by the
language best suited to it**.

| Plane | Service | Language | Why this language |
| --- | --- | --- | --- |
| Data plane | [`ingest-gateway`](services/ingest-gateway) | **Go 1.23** (zero deps) | Cheap goroutine fan-in, predictable latency, single 8 MB distroless binary |
| Edge | [`pulseagent`](edge/pulseagent) | **C99** | ~20 KB binary, no runtime, runs on the smallest VMs and containers |
| Intelligence | [`aiops-engine`](services/aiops-engine) | **Python 3.12** / FastAPI | NumPy-native detectors (EWMA + robust z-score, damped Holt forecasts) |
| Commerce | [`billing-core`](services/billing-core) | **Java 17** / Spring Boot 3 | BigDecimal money math, auditable metering → quota → invoice pipeline |
| Reporting | [`reporting`](services/reporting) | **C# / .NET 8** | SRE-grade SLA math, RFC 4180 CSV export, minimal APIs |
| Console | [`web`](src/app/page.tsx) | **TypeScript** / Next.js 16 | Dense, fast operator UI with hand-rolled SVG charts |
| Companion | [`mobile`](apps/mobile) | **Flutter** + **Kotlin** | On-call from your pocket: ack, resolve, watch forecasts |

## The console

Eight views, dark by default, live every 5 seconds:

**Overview** — fleet KPIs with sparklines, live traffic chart, real host
telemetry from the C agent, AIOps verdict, open incidents ·
**Services** — catalog with SLOs and 90-day uptime ribbons ·
**Metrics** — explorer with percentile breakdowns ·
**Logs** — grep-able live tail ·
**Alerts** — rules + incident lifecycle (ack → mitigate → resolve) ·
**AIOps** — anomaly feed with baseline/observed/sigma, forecast bands ·
**Usage** — metered billing projection · **Settings** — keys, team, topology.

## Quickstart (local)

```bash
# 1. Web console + control plane (SQLite)
bun install && bun run db:push && bun run db:seed
bun run dev                       # http://localhost:3000

# 2. Data plane (Go gateway) — terminal 2
cd services/ingest-gateway && go run ./cmd/gateway   # :3100

# 3. Intelligence plane (Python) — terminal 3
cd services/aiops-engine
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 3200

# 4. Real host telemetry (C agent) — terminal 4
cd edge/pulseagent && make && ./pulseagent
```

Or with Docker:

```bash
docker compose up --build
```

## One flow, end to end

```text
/proc (C agent) ──▶ ingest-gateway (Go, ring buffers) ──▶ aiops-engine (Python)
                                                        │     robust z-score
                     ▲                                  ▼     damped Holt
                     └────────────── Next.js console ◀──┘
                                        │
                              Prisma/SQLite (catalog, incidents, usage)
                                        │
                     billing-core (Java) · reporting (C#)
```

1. `pulseagent` samples `/proc` and POSTs batched metrics every 2 s.
2. The gateway keeps 2 h of hot series in memory and synthesises reference
   traffic for six seed services (including scheduled anomaly windows).
3. The AIOps engine pulls every 5 s, scores each series against an
   EWMA/median-MAD baseline, and publishes explainable anomalies.
4. The console fuses all three planes with the organisational store and lets
   you ack, mitigate and resolve what matters.

## Repository layout

```text
├── src/                    Next.js 16 console (App Router, shadcn/ui, Prisma)
├── services/
│   ├── ingest-gateway/     Go telemetry API (cmd/ + internal/)
│   ├── aiops-engine/       FastAPI detectors & forecasts
│   ├── billing-core/       Spring Boot metering & invoices
│   └── reporting/          .NET 8 SLA reports & CSV export
├── edge/pulseagent/        C99 host agent (Makefile, systemd unit)
├── apps/mobile/            Flutter on-call companion
├── k8s/base/               Kustomize manifests (deployments, HPA, ingress)
├── infra/terraform/        AWS ECS Fargate + ALB (validated variables)
├── .github/workflows/      CI (paths-filtered), release (GHCR), CodeQL
├── docs/                   API contracts, operations runbook
└── ARCHITECTURE.md         ADRs: polyglot rationale, pull-based AIOps, …
```

## Status

`v0.1.0` — all six services compile and the Go/Python/C tier runs live in the
reference sandbox; CI is green per stack; K8s and Terraform ready for the
first cloud deployment.

---

<div align="center">
<sub>Built by the Lodestar team. See everything. Fix what matters.</sub>
</div>
