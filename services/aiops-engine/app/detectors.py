"""Telemetry detectors: baselining, anomaly scoring and forecasting.

The engine is intentionally explainable: every anomaly ships the baseline,
the observed value and a z-score so operators can audit *why* it fired.
This "glass box" approach outperforms black-box models for operator trust
and is the same philosophy Elastic applies to its ML jobs (ADR-003).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

EPS = 1e-9


@dataclass(frozen=True)
class Detection:
    """Result of scoring the latest point of a series."""

    score: float          # robust z-score magnitude
    baseline: float       # expected value (EWMA)
    observed: float       # latest raw value
    is_anomaly: bool


def robust_baseline(values: np.ndarray, alpha: float = 0.25) -> Detection:
    """Score the newest point of *values* against an EWMA + MAD baseline.

    - EWMA tracks the smooth local level of the series.
    - A median/MAD z-score over the recent window guards against the EWMA
      being dragged along by a sustained shift (masking).
    """
    if values.size < 8:
        return Detection(score=0.0, baseline=float(np.mean(values)) if values.size else 0.0,
                         observed=float(values[-1]) if values.size else 0.0, is_anomaly=False)

    ewma = values[0]
    for v in values[:-1]:
        ewma = alpha * v + (1 - alpha) * ewma

    window = values[-60:]
    median = float(np.median(window))
    mad = float(np.median(np.abs(window - median)))
    if mad < EPS:
        mad = float(np.std(window)) or EPS

    observed = float(values[-1])
    z = abs(observed - median) / (1.4826 * mad)

    # Require both a statistical deviation and a material move vs EWMA.
    move = abs(observed - float(ewma)) / max(abs(float(ewma)), EPS)
    is_anomaly = z >= 4.0 and move >= 0.18
    return Detection(score=round(z, 2), baseline=round(float(ewma), 3),
                     observed=round(observed, 3), is_anomaly=is_anomaly)


def forecast(values: np.ndarray, horizon: int = 12, alpha: float = 0.35,
             beta: float = 0.12, phi: float = 0.9) -> list[dict]:
    """Damped Holt linear trend forecast with an empirical prediction band.

    Returns [{ts_offset, value, lower, upper}] where ts_offset is the step
    index (the caller maps it to wall-clock timestamps).
    """
    if values.size < 12:
        return []

    level = float(values[0])
    trend = float(values[1] - values[0])
    for v in values[1:]:
        prev_level = level
        level = alpha * float(v) + (1 - alpha) * (level + phi * trend)
        trend = beta * (level - prev_level) + (1 - beta) * phi * trend

    # Empirical prediction band from recent residual dispersion.
    recent = values[-30:]
    band = max(float(np.std(recent - np.mean(recent))) * 1.96, 0.05 * abs(level) + EPS)

    out: list[dict] = []
    damp = 0.0
    for step in range(1, horizon + 1):
        damp += phi ** step
        value = level + damp * trend
        out.append({
            "step": step,
            "value": round(float(value), 3),
            "lower": round(float(value - band), 3),
            "upper": round(float(value + band), 3),
        })
    return out


def severity_for(score: float) -> str:
    """Map a robust z-score to a severity label."""
    if score >= 6.0:
        return "critical"
    if score >= 4.5:
        return "warning"
    return "info"
