#!/usr/bin/env bash
# Lodestar smoke probe -------------------------------------------------------
# One command to verify the whole platform is answering:
#   scripts/smoke.sh           read-only probes (default)
#   scripts/smoke.sh --deep    also generate + list an SLA report (mutates the
#                              reporting plane; proves the C# write path)
#
# Exit codes: 0 = all core probes green, 1 = core failure, 2 = usage error.
# Code-tier planes (billing/reporting) warn but never fail the run: they are
# deployment peers, not the live data path.
set -u

WEB=http://127.0.0.1:3000
GATEWAY=http://127.0.0.1:3100
AIOPS=http://127.0.0.1:3200
BILLING=http://127.0.0.1:4100
REPORTING=http://127.0.0.1:4200
API_KEY="${LODESTAR_API_KEY:-pg_live_demo_key}"
TIMEOUT=4
DEEP=0
[ "${1:-}" = "--deep" ] && DEEP=1

pass=0; warn=0; fail=0
GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; DIM='\033[2m'; RESET='\033[0m'

probe() {
  # probe <label> <expect-substring> <method> <url> [curl-args...]
  local label="$1" expect="$2" method="$3" url="$4"; shift 4
  local body status
  body=$(curl -sS --max-time "$TIMEOUT" -X "$method" "$@" "$url" 2>/dev/null)
  status=$?
  if [ $status -ne 0 ]; then
    printf "  ${RED}FAIL${RESET}  %-34s connection failed/timeout\n" "$label"
    fail=$((fail+1)); return 1
  fi
  if [[ "$body" == *"$expect"* ]]; then
    printf "  ${GREEN}PASS${RESET}  %-34s %s\n" "$label" "$(echo "$body" | head -c 60 | tr -d '\n')"
    pass=$((pass+1)); return 0
  fi
  printf "  ${RED}FAIL${RESET}  %-34s expected '%s' in: %.80s\n" "$label" "$expect" "$body"
  fail=$((fail+1)); return 1
}

warn_probe() {
  # warn_probe <label> <expect-substring> <method> <url> [curl-args...]
  local label="$1" expect="$2" method="$3" url="$4"; shift 4
  local body status
  body=$(curl -sS --max-time "$TIMEOUT" -X "$method" "$@" "$url" 2>/dev/null)
  status=$?
  if [ $status -eq 0 ] && [[ "$body" == *"$expect"* ]]; then
    printf "  ${GREEN}PASS${RESET}  %-34s %s\n" "$label" "$(echo "$body" | head -c 60 | tr -d '\n')"
    pass=$((pass+1)); return 0
  fi
  printf "  ${YELLOW}WARN${RESET}  %-34s code tier offline or unexpected body\n" "$label"
  warn=$((warn+1)); return 0
}

sse_probe() {
  # sse_probe <label> <expect-substring> <url> [curl-args...]
  # A stream never ends, so curl hitting the 3s cap (exit 28) is expected:
  # the probe passes as long as the expected frame showed up in the window.
  local label="$1" expect="$2" url="$3"; shift 3
  local body status
  body=$(curl -sN --max-time 3 "$@" "$url" 2>/dev/null)
  status=$?
  if { [ $status -eq 0 ] || [ $status -eq 28 ]; } && [[ "$body" == *"$expect"* ]]; then
    printf "  ${GREEN}PASS${RESET}  %-34s stream alive (%s bytes in 3s)\n" "$label" "$(printf '%s' "$body" | wc -c)"
    pass=$((pass+1)); return 0
  fi
  printf "  ${RED}FAIL${RESET}  %-34s no '%s' within 3s of stream\n" "$label" "$expect"
  fail=$((fail+1)); return 1
}

echo "Lodestar smoke probe $(date -u '+%Y-%m-%dT%H:%M:%SZ') (deep=$DEEP)"
echo "-----------------------------------------------------------------------"

echo "data planes:"
probe "web console :3000"        '"status"'          GET "$WEB/api/health"
probe "ingest gateway :3100"     '"ok"'              GET "$GATEWAY/v1/health"
probe "aiops engine :3200"       '"ok"'              GET "$AIOPS/v1/health"
warn_probe "billing core :4100"  '"ok"'              GET "$BILLING/v1/health"
warn_probe "reporting :4200"     '"ok"'              GET "$REPORTING/healthz"

echo "console api:"
probe "GET /api/overview"        '"requestRate"'     GET "$WEB/api/overview"
probe "GET /api/services"        '"services"'        GET "$WEB/api/services"
probe "GET /api/metrics"         '"series"'          GET "$WEB/api/metrics?names=request.rate&range=15m&points=10"
probe "GET /api/logs"            '"logs"'            GET "$WEB/api/logs?limit=5"
probe "GET /api/alerts"          '"rules"'           GET "$WEB/api/alerts"
probe "GET /api/aiops"           '"anomalies"'       GET "$WEB/api/aiops"
probe "GET /api/billing"         '"quotas"'          GET "$WEB/api/billing"
probe "GET /api/reports"         '"reports"'         GET "$WEB/api/reports"
probe "GET evaluator status"     '"inProgress"'      GET "$WEB/api/alerts/rules/evaluate-all"
probe "GET drift snapshots"      '"watched"'         GET "$WEB/api/reports/snapshots?limit=6"

echo "gateway ingest round-trip:"
ts=$(date +%s%3N)
probe "POST /v1/ingest/metrics"  '"accepted":1'      POST "$GATEWAY/v1/ingest/metrics" \
  -H "x-api-key: $API_KEY" -H 'content-type: application/json' \
  -d "{\"metrics\":[{\"name\":\"smoke.probe\",\"value\":1,\"tags\":{\"source\":\"smoke\"},\"ts\":$ts}]}"
probe "GET query returns probe"  'smoke.probe'       GET "$GATEWAY/v1/query/metrics?names=smoke.probe&range=5m&points=5" \
  -H "x-api-key: $API_KEY"

echo "live streams (sse):"
sse_probe "gateway /v1/stream"   'event: heartbeat'  "$GATEWAY/v1/stream" -H "x-api-key: $API_KEY"
sse_probe "console /api/logs/stream" 'event:'        "$WEB/api/logs/stream"

if [ "$DEEP" -eq 1 ]; then
  echo "deep probes:"
  warn_probe "POST sla report (C# write)" '"availabilityPct"' POST "$WEB/api/reports" \
    -H 'content-type: application/json' \
    -d '{"serviceId":"api-gateway","windowDays":7,"sloTarget":99.9}'
  # Mutating but safe: breaches dedup on rule:<id>, quiet rules are untouched.
  probe "POST evaluator sweep"    '"checked"'         POST "$WEB/api/alerts/rules/evaluate-all"
  # Single-service drift snapshot: diff vs previous, dedup on drift:<service>.
  probe "POST drift snapshot"     '"results"'         POST "$WEB/api/reports/snapshots" \
    -H 'content-type: application/json' -d '{"serviceId":"api-gateway"}'
fi

echo "-----------------------------------------------------------------------"
printf "summary: ${GREEN}%d passed${RESET}" "$pass"
[ "$warn" -gt 0 ] && printf ", ${YELLOW}%d warned${RESET}" "$warn"
printf ", ${RED}%d failed${RESET}\n" "$fail"

if [ "$fail" -gt 0 ]; then exit 1; fi
exit 0
