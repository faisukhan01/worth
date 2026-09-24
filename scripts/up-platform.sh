#!/usr/bin/env bash
# up-platform.sh - idempotent starter for every Lodestar background plane.
#
# Usage:  bash scripts/up-platform.sh [plane ...]
# Planes: gateway agent aiops billing reporting   (default: all)
#
# Each plane is only started when its health endpoint does not answer, so the
# script is safe to re-run from cron sessions or after a sandbox restart.
# Logs land in <repo>/logs/<plane>.log - tail them to diagnose crashes.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/logs"
mkdir -p "$LOGS"
PLANES=(${@:-gateway agent aiops billing reporting})

# --- toolchains (user-space installs, see docs/operations.md) ---------------
export PATH="$HOME/toolchains/go/bin:$HOME/toolchains/jdk/bin:$HOME/.dotnet:$PATH"
DOTNET="$HOME/toolchains/dotnet/dotnet"
[ -x "$DOTNET" ] || DOTNET="$(command -v dotnet || true)"

port_up() { # port_up <port> <health-path>
  curl -sf -m 2 "http://127.0.0.1:$1$2" >/dev/null 2>&1
}

start() { # start <name> <port> <health-path> <cwd> <cmd...>
  local name="$1" port="$2" health="$3" cwd="$4"; shift 4
  if port_up "$port" "$health"; then
    echo "[up]      $name already healthy on :$port"
    return 0
  fi
  echo "[start]   $name on :$port ..."
  (cd "$cwd" && setsid nohup "$@" >"$LOGS/$name.log" 2>&1 < /dev/null &)
  sleep 1
  if port_up "$port" "$health"; then
    echo "[ok]      $name answered immediately"
  else
    echo "[pending] $name launched - watch $LOGS/$name.log"
  fi
}

for p in "${PLANES[@]}"; do
  case "$p" in
    gateway)
      start gateway 3100 /v1/health "$ROOT/services/ingest-gateway" ./bin/gateway
      ;;
    agent)
      if pgrep -f "pulseagent" >/dev/null 2>&1; then
        echo "[up]      pulseagent already running"
      else
        start agent 0 /dev/null "$ROOT/edge/pulseagent" ./pulseagent
      fi
      ;;
    aiops)
      start aiops 3200 /v1/health "$ROOT/services/aiops-engine" \
        ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 3200
      ;;
    billing)
      JAR="$(ls "$ROOT"/services/billing-core/target/billing-core-*.jar 2>/dev/null | head -1)"
      if [ -z "$JAR" ]; then
        echo "[skip]    billing-core jar not built (cd services/billing-core && mvn -q package -DskipTests)"
        continue
      fi
      mkdir -p "$ROOT/services/billing-core/data"
      start billing 4100 /v1/health "$ROOT/services/billing-core" \
        java -XX:+UseSerialGC -Xmx256m -jar "$JAR"
      ;;
    reporting)
      DLL="$ROOT/services/reporting/bin/Release/net8.0/Lodestar.Reporting.dll"
      if [ ! -f "$DLL" ] || [ -z "$DOTNET" ]; then
        echo "[skip]    reporting not built or dotnet missing"
        continue
      fi
      start reporting 4200 /v1/health "$ROOT/services/reporting" \
        env ASPNETCORE_URLS=http://127.0.0.1:4200 ASPNETCORE_ENVIRONMENT=Production "$DOTNET" "$DLL"
      ;;
    *)
      echo "[unknown] plane '$p' (known: gateway agent aiops billing reporting)"
      ;;
  esac
done

echo
echo "plane status:"
port_up 3100 /v1/health && echo "  gateway   :3100 up" || echo "  gateway   :3100 DOWN"
pgrep -f pulseagent >/dev/null 2>&1 && echo "  agent     running" || echo "  agent     NOT RUNNING"
port_up 3200 /v1/health && echo "  aiops     :3200 up" || echo "  aiops     :3200 DOWN"
port_up 4100 /v1/health && echo "  billing   :4100 up" || echo "  billing   :4100 DOWN"
port_up 4200 /v1/health && echo "  reporting :4200 up" || echo "  reporting :4200 DOWN"
