# pulseagent

Ultra-light edge telemetry agent for **Lodestar**, written in C99 with zero
external dependencies. It samples the host via `/proc` and ships metrics to
the Lodestar ingest-gateway every 2 seconds.

## Collected metrics

| Metric         | Source                     | Description                    |
| -------------- | -------------------------- | ------------------------------ |
| `cpu.usage`    | `/proc/stat` (delta)       | Busy % across all cores        |
| `mem.used`     | `/proc/meminfo`            | Used % (total - available)     |
| `mem.used.gb`  | `/proc/meminfo`            | Used memory in GB              |
| `load.1m`      | `/proc/loadavg`            | 1-minute load average          |
| `net.rx.kbps`  | `/proc/net/dev` (delta)    | Receive throughput KB/s        |
| `net.tx.kbps`  | `/proc/net/dev` (delta)    | Transmit throughput KB/s       |

Every sample is tagged `source=agent` and `host=<hostname>` so the platform
distinguishes real host telemetry from synthesised reference traffic.

## Build & run

```bash
make
./pulseagent
```

## Configuration (environment)

| Variable             | Default                    |
| -------------------- | -------------------------- |
| `PULSE_GATEWAY_URL`  | `http://127.0.0.1:3100`    |
| `PULSE_INTERVAL_MS`  | `2000`                     |
| `PULSE_API_KEY`      | `pg_live_demo_key`         |

Failures back off exponentially (capped at 30 s) and the agent shuts down
cleanly on `SIGINT`/`SIGTERM`.

## Systemd

A unit file is provided under `deploy/`:

```bash
sudo cp deploy/pulseagent.service /etc/systemd/system/
sudo systemctl enable --now pulseagent
```

## Why C

The agent runs on the smallest possible footprint: no runtime, no garbage
collector, ~20 KB binary, single-digit millisecond CPU cost per sample. The
same reasoning drove DD-Agent's C++ core and Vector's Rust core.
