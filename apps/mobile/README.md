# Lodestar Mobile — On-Call Companion

Flutter client for the **Lodestar Observability & AIOps Platform**. Built for
the engineer at 3 a.m.: check the fleet, ack the page, see the anomaly that
fired — before the laptop finishes opening.

## Features

- **Login with API key** — stored in `shared_preferences`, validated against the gateway
- **Home** — fleet KPIs (req/s, p99, error rate, agents) + live service health cards
- **Incidents** — AIOps anomaly feed with confidence, baseline vs observed, one-tap acknowledge
- **Insights** — forecasts (damped Holt, 95% band) rendered with `fl_chart`
- **Settings** — endpoint overrides, masked key management, accent theme

## Architecture

```
lib/
├── main.dart            bootstrap + providers
├── app.dart             routes, dark theme tokens (match web console)
├── config.dart          endpoint configuration
├── api/
│   └── lodestar_api.dart   Dio client (x-api-key interceptor, 5s timeouts)
├── models/models.dart   immutable DTOs mirroring the gateway contracts
├── state/
│   ├── session.dart     api key persistence
│   └── live_data.dart   5s polling loop with exponential backoff
├── screens/             login, home shell, home, incidents, insights, settings
└── widgets/             status pill, KPI tile, sparkline (CustomPainter), live dot
```

## Data plane

| Endpoint | Source |
| --- | --- |
| `GET /v1/stats`, `/v1/query/metrics`, `/v1/logs`, `/v1/health` | ingest-gateway (Go, :3100) |
| `GET /v1/insights` | aiops-engine (Python, :3200) |

Android emulator defaults: `http://10.0.2.2:3100` / `:3200` (host loopback).
Demo API key: `pg_live_demo_key`.

## Run

```bash
flutter pub get
flutter run                     # device / emulator with the compose stack up
flutter analyze                 # static checks (CI runs this)
```

See `android/README.md` for platform regeneration and signing.
