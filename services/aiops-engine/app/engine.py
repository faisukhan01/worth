"""AIOps engine: rolling state, detection loop and insight assembly."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any

import numpy as np

from .detectors import Detection, forecast, robust_baseline, severity_for
from .gateway import GatewayClient

log = logging.getLogger("aiops.engine")

WINDOW = 240          # rolling samples kept per series
PULL_INTERVAL = 5.0   # seconds between gateway pulls
SERVICE_KEYS = ("request.rate", "error.rate", "latency.p99")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _service_of(series: dict[str, Any]) -> str:
    tags = series.get("tags") or {}
    return tags.get("service") or tags.get("host") or "host"


class Engine:
    """Maintains rolling series state and computes insights on demand."""

    def __init__(self, client: GatewayClient) -> None:
        self.client = client
        self._state: dict[str, deque[float]] = {}
        self._timestamps: dict[str, deque[int]] = {}
        self._lock = threading.Lock()
        self._last_pull = 0.0
        self._warm = False
        self._anomaly_history: deque[dict] = deque(maxlen=60)
        self._started = time.time()

    # ---- ingestion ---------------------------------------------------------

    def _absorb(self, series_list: list[dict[str, Any]]) -> int:
        absorbed = 0
        with self._lock:
            for s in series_list:
                key = f"{s['name']}\x1f{_service_of(s)}\x1f{(s.get('tags') or {}).get('source', 'unknown')}"
                pts = s.get("points") or []
                if not pts:
                    continue
                vals = self._state.setdefault(key, deque(maxlen=WINDOW))
                stamps = self._timestamps.setdefault(key, deque(maxlen=WINDOW))
                existing_last = stamps[-1] if stamps else -1
                for p in pts:
                    if p["ts"] > existing_last:
                        vals.append(float(p["value"]))
                        stamps.append(int(p["ts"]))
                        existing_last = p["ts"]
                absorbed += 1
        return absorbed

    def pull_once(self) -> bool:
        series = self.client.query_metrics()
        if not series:
            return False
        return self._absorb(series) > 0

    def run_loop(self, stop: threading.Event) -> None:
        log.info("engine loop started (interval=%.1fs)", PULL_INTERVAL)
        while not stop.is_set():
            began = time.time()
            ok = self.pull_once()
            if ok and not self._warm:
                self._warm = True
                log.info("engine warmed up - insights available")
            if not ok:
                log.warning("pull produced no data; gateway may be restarting")
            self._last_pull = time.time()
            elapsed = time.time() - began
            stop.wait(max(0.5, PULL_INTERVAL - elapsed))

    # ---- insights -----------------------------------------------------------

    def insights(self) -> dict[str, Any]:
        with self._lock:
            snapshot = {k: (list(v), list(self._timestamps[k])) for k, v in self._state.items()}

        anomalies: list[dict] = []
        health: dict[str, dict] = {}
        series_meta: dict[str, dict] = {}

        for key, (values, stamps) in snapshot.items():
            name, service, source = key.split("\x1f")
            if not values:
                continue
            arr = np.asarray(values[-90:], dtype=float)
            det = robust_baseline(arr)
            meta = series_meta.setdefault(service, {"metrics": {}, "source": source})
            meta["metrics"][name] = det

            if det.is_anomaly and name in SERVICE_KEYS:
                anomalies.append(self._anomaly(service, name, det, stamps[-1] if stamps else None))

            self._score_health(health, service, name, det)

        # Newest first, cap the payload. Blend currently-firing detections
        # with recently-fired ones (last 3 minutes) so the feed stays useful
        # between anomaly windows.
        cutoff = time.time() - 180
        recent = []
        seen = set()
        for a in reversed(self._anomaly_history):
            key = (a["service"], a["metric"])
            ts = a.get("_epoch", 0)
            if key in seen or ts < cutoff:
                continue
            if any(x["service"] == a["service"] and x["metric"] == a["metric"] for x in anomalies):
                seen.add(key)
                continue
            recent.append({**a, "active": False})
            seen.add(key)
        anomalies = [{**a, "active": True} for a in anomalies] + recent
        anomalies.sort(key=lambda a: a["score"], reverse=True)
        anomalies = anomalies[:12]

        forecasts = self._build_forecasts(snapshot)
        health_list = [self._finalize_health(h) for h in health.values()]
        health_list.sort(key=lambda h: h["score"])

        overall = "healthy"
        if any(h["status"] == "critical" for h in health_list):
            overall = "critical"
        elif any(h["status"] == "degraded" for h in health_list):
            overall = "degraded"

        return {
            "anomalies": anomalies,
            "forecasts": forecasts,
            "health": health_list,
            "summary": {
                "services_monitored": len(health_list),
                "open_anomalies": len(anomalies),
                "overall_status": overall,
                "engine_warm": self._warm,
                "uptime_seconds": int(time.time() - self._started),
                "last_pull": _now_iso() if self._last_pull else None,
            },
        }

    # ---- helpers -------------------------------------------------------------

    def _anomaly(self, service: str, metric: str, det: Detection, ts: int | None) -> dict:
        direction = "spike" if det.observed > det.baseline else "drop"
        pct = abs(det.observed - det.baseline) / max(abs(det.baseline), 1e-9) * 100
        sev = severity_for(det.score)
        msg = (f"{metric} on {service} {direction}: {det.observed} vs baseline "
               f"{det.baseline} ({pct:+.0f}%, {det.score} sigma)")
        anomaly = {
            "id": uuid.uuid4().hex[:12],
            "service": service,
            "metric": metric,
            "severity": sev,
            "confidence": round(min(0.99, det.score / 10.0), 2),
            "score": det.score,
            "baseline": det.baseline,
            "observed": det.observed,
            "message": msg,
            "startedAt": datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat(timespec="seconds") if ts else _now_iso(),
            "detectedAt": _now_iso(),
            "_epoch": time.time(),
        }
        self._anomaly_history.append(anomaly)
        return anomaly

    @staticmethod
    def _score_health(health: dict, service: str, metric: str, det: Detection) -> None:
        h = health.setdefault(service, {"service": service, "penalty": 0.0, "notes": []})
        if metric == "error.rate" and det.observed > 1.5:
            h["penalty"] += min(35.0, det.observed * 4.0)
            h["notes"].append(f"error rate {det.observed:.1f}%")
        if metric == "latency.p99" and det.observed > 150:
            h["penalty"] += min(20.0, det.observed / 30.0)
            h["notes"].append(f"p99 {det.observed:.0f}ms")
        if metric == "cpu.usage" and det.observed > 90:
            h["penalty"] += 12.0
            h["notes"].append(f"cpu {det.observed:.0f}%")
        if det.is_anomaly:
            h["penalty"] += 6.0

    @staticmethod
    def _finalize_health(h: dict) -> dict:
        score = max(0, round(100 - h["penalty"]))
        status = "healthy" if score >= 85 else ("degraded" if score >= 60 else "critical")
        return {"service": h["service"], "score": score, "status": status,
                "notes": h["notes"][:3]}

    def _build_forecasts(self, snapshot: dict) -> list[dict]:
        out: list[dict] = []
        for key, (values, stamps) in snapshot.items():
            name, service, _source = key.split("\x1f")
            if name not in ("cpu.usage", "request.rate") or len(values) < 30:
                continue
            steps = forecast(np.asarray(values[-120:], dtype=float), horizon=12)
            if not steps or not stamps:
                continue
            step_ms = max(1, int((stamps[-1] - stamps[-len(stamps) + 1]) / max(len(stamps) - 2, 1))) if len(stamps) > 2 else 5000
            points = [{
                "ts": stamps[-1] + step_ms * s["step"],
                "value": s["value"],
                "lower": s["lower"],
                "upper": s["upper"],
            } for s in steps]
            out.append({"series": name, "service": service, "points": points})
        return out[:8]

    def stats(self) -> dict:
        with self._lock:
            return {
                "series_tracked": len(self._state),
                "anomaly_history": len(self._anomaly_history),
                "engine_warm": self._warm,
                "uptime_seconds": int(time.time() - self._started),
            }
