# Lodestar - Operations Guide

Ports, health endpoints, log locations and troubleshooting for running
Lodestar locally, in compose, on k8s, and on AWS (ECS Fargate).

---

## Ports

| Service          | Port | Protocol      | Notes                                   |
| ---------------- | ---- | ------------- | --------------------------------------- |
| web              | 3000 | HTTP          | Next.js dashboard + `/api/*` BFF routes |
| ingest-gateway   | 3100 | HTTP + SSE    | Ingestion, query, stats, `/v1/stream`   |
| aiops-engine     | 3200 | HTTP          | Insights, health, stats (pull-based)    |
| billing-core     | 4100 | HTTP          | Spring Boot, H2 file DB                 |
| reporting        | 4200 | HTTP          | ASP.NET Core 8                          |
| pulseagent       | -    | outbound only | Ships /proc metrics to the gateway      |

## Health endpoints

| Service          | Health path        | Used by                                   |
| ---------------- | ------------------ | ----------------------------------------- |
| web              | `/api/health`      | Dockerfile HEALTHCHECK, compose, k8s, ALB |
| ingest-gateway   | `/v1/health`       | compose, k8s probes, HPA, ALB             |
| aiops-engine     | `/v1/health`       | compose, k8s probes, ALB                  |
| billing-core     | `/actuator/health` | compose, k8s probes (actuator assumed)    |
| reporting        | `/healthz`         | compose, k8s probes                       |

```sh
for p in 3000/api/health 3100/v1/health 3200/v1/health 4100/actuator/health 4200/healthz; do
  curl -sS -o /dev/null -w "%{http_code} http://localhost:$p\n" "http://localhost:$p"
done
```

## Local development quickstart

Prerequisites: bun >= 1.3, Go 1.23, Python 3.12, JDK 17 + Maven, .NET 8 SDK,
gcc/make. (Or skip everything: `make up` runs the whole stack in Docker.)

```sh
# 1. Web (Next.js + Prisma/SQLite)
bun install
bunx prisma generate
bun run db:push        # create/sync db/custom.db
make dev-web           # http://localhost:3000

# 2. Ingest gateway
make dev-gateway       # http://localhost:3100

# 3. AIOps engine
python -m venv .venv && source .venv/bin/activate
pip install -r services/aiops-engine/requirements.txt
make dev-aiops         # http://localhost:3200

# 4. Edge agent (optional, real /proc metrics)
make run-agent

# 5. Billing + reporting (code tier)
make dev-billing
make dev-reporting
```

Authentication for ingest endpoints: `x-api-key: pg_live_demo_key`.

### One-shot bring-up (sandbox / CI smoke)

`scripts/up-platform.sh` is an idempotent starter: it probes each plane's
health endpoint first and only launches what is missing, so it is safe to
re-run from cron sessions or after a restart.

```sh
bash scripts/up-platform.sh              # all planes: gateway agent aiops billing reporting
bash scripts/up-platform.sh billing      # just one plane
tail -f logs/<plane>.log                 # per-plane logs land in <repo>/logs/
```

## Docker Compose

```sh
make up                 # build + start core platform
docker compose --profile full up -d   # include pulseagent
make logs               # tail everything
make down               # stop
docker compose down -v  # stop and wipe the billing H2 volume
```

Persistence:
- web SQLite lives in `./db` (bind mount; survives `down`).
- billing H2 files live in the named volume `lodestar-billing-data`.

## Kubernetes

```sh
# Create the secret first (example file is not applied by kustomize):
kubectl apply -f k8s/base/secret.example.yaml   # demo key; replace for real envs

kubectl apply -k k8s/base
kubectl -n lodestar get pods,svc,hpa,ingress
kubectl -n lodestar logs -f deploy/ingest-gateway
```

Scaling: the gateway HPA targets 70% CPU with 2-6 replicas.

## AWS (ECS Fargate)

See `infra/terraform/README.md`. Log groups: `/ecs/lodestar-<env>/<service>`
with configurable retention (`log_retention_days`, default 30). Inspect with:

```sh
aws logs tail /ecs/lodestar-prod/ingest-gateway --follow
```

## Log locations

| Environment  | Where logs go                                                        |
| ------------ | -------------------------------------------------------------------- |
| Local (bun)  | `dev.log` (bun run dev), `server.log` (production start) at repo root |
| Go gateway   | stdout/stderr - capture in your terminal or compose/k8s              |
| Python aiops | stdout/stderr (uvicorn access + app logs)                            |
| Billing      | stdout (Spring Boot); H2 data in `billing-data` volume / `/data`     |
| Reporting    | stdout (ASP.NET Core console provider)                               |
| Compose      | `docker compose logs <service>` or `make logs`                       |
| k8s          | `kubectl -n lodestar logs deploy/<service>`                          |
| AWS ECS      | CloudWatch Logs `/ecs/lodestar-<env>/<service>`                      |

## Troubleshooting

| Symptom                                          | Likely cause and fix                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `web` shows simulated data everywhere            | Gateway/aiops unreachable: check `GATEWAY_URL`/`AIOPS_URL`; the 1.5s server-side timeout expired and fell back |
| `401`/`403` on `/v1/ingest/*`                    | Missing/wrong `x-api-key` header; use a `pg_live_*` key (`pg_live_demo_key` in dev)                       |
| Compose `web` container restarts                 | `./db` not writable by uid 1001; `chown -R 1001:1001 db` or set `DATABASE_URL` to a writable path         |
| k8s pods stuck `ContainerCreating`/`Init`        | `lodestar-secrets` Secret missing - see `k8s/base/secret.example.yaml`                                    |
| k8s `billing-core` probes fail                   | Actuator not enabled by the service; align `/actuator/health` with the billing service's real health path |
| k8s `reporting` probes fail                      | `/healthz` not mapped by the reporting service; align the probe path                                     |
| Ingress returns 404                              | Host header must match `lodestar.example.com` (edit `k8s/base/ingress.yaml` for your host)               |
| SSE `/v1/stream` buffers in nginx                | Ingress annotations disable proxy buffering; verify they survived overrides                              |
| HPA shows `<unknown>/70%`                        | Metrics-server not installed in the cluster; install it for CPU-based autoscaling                        |
| Terraform `apply` fails on ALB/TG name           | Name prefix too long - `project_name` + `environment` must keep names under 32 chars (validated variables)|
| Agent shows no real metrics                      | pulseagent needs host `/proc`: run `make run-agent` locally, or `--profile full` with `pid: host` in compose |
| Port conflict on startup                         | Another process owns 3000/3100/3200/4100/4200: `lsof -i :PORT` and free it, or override compose ports    |

## Resetting the platform

```sh
make down && docker compose down -v   # wipe volumes
rm -f db/custom.db && bun run db:push # fresh SQLite
make up
```
