"""FastAPI application entrypoint for the Lodestar AIOps engine.

Run:  uvicorn app.main:app --host 0.0.0.0 --port 3200
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .engine import Engine
from .gateway import GatewayClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("aiops.main")

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://127.0.0.1:3100")
API_KEY = os.getenv("GATEWAY_API_KEY", "pg_live_demo_key")

client = GatewayClient(GATEWAY_URL, API_KEY)
engine = Engine(client)
_stop = threading.Event()


def _loop() -> None:
    engine.run_loop(_stop)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Warm the engine synchronously so the first /v1/insights call has data.
    if engine.pull_once():
        log.info("engine warmed on startup")
    else:
        log.warning("startup pull failed; engine will keep retrying")
    t = threading.Thread(target=_loop, name="aiops-pull-loop", daemon=True)
    t.start()
    yield
    _stop.set()
    t.join(timeout=3)


app = FastAPI(
    title="Lodestar AIOps Engine",
    version="0.1.0",
    description="Anomaly detection, health scoring and forecasting for Lodestar telemetry.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/v1/health")
async def health() -> dict:
    gateway_ok = client.health()
    return {
        "status": "ok" if gateway_ok else "degraded",
        "service": "aiops-engine",
        "gateway_reachable": gateway_ok,
    }


@app.get("/v1/stats")
async def stats() -> dict:
    return {"service": "aiops-engine", **engine.stats()}


@app.get("/v1/insights")
async def insights() -> dict:
    return engine.insights()
