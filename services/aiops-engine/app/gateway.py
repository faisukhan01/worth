"""Gateway client: pulls series snapshots from the Lodestar ingest-gateway.

Pull-based (ADR-003): the engine polls the gateway on a fixed cadence, so
the engine can restart, scale or fail without affecting ingest throughput.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

log = logging.getLogger("aiops.gateway")

METRIC_NAMES = [
    "request.rate",
    "error.rate",
    "latency.p50",
    "latency.p95",
    "latency.p99",
    "cpu.usage",
    "mem.used",
]


class GatewayClient:
    """Minimal stdlib HTTP client for the ingest-gateway query API."""

    def __init__(self, base_url: str, api_key: str, timeout: float = 4.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def query_metrics(self, names: list[str] | None = None, range_: str = "30m",
                      points: int = 180) -> list[dict[str, Any]]:
        names = names or METRIC_NAMES
        url = (
            f"{self.base_url}/v1/query/metrics?names={','.join(names)}"
            f"&range={range_}&points={points}"
        )
        req = urllib.request.Request(url, headers={
            "x-api-key": self.api_key,
            "accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            return payload.get("series", [])
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            log.warning("gateway query failed: %s", exc)
            return []

    def health(self) -> bool:
        try:
            with urllib.request.urlopen(f"{self.base_url}/v1/health",
                                        timeout=self.timeout) as resp:
                return resp.status == 200
        except (urllib.error.URLError, TimeoutError):
            return False
