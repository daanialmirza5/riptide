"""Riptide API: REST + WebSocket surface over the failure-intelligence engine."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .benchmark import run_benchmark
from .engine import Engine
from .incidents import report_markdown
from .logparse import analyse_logs
from .predictor import METRICS
from .scenarios import SCENARIO_BY_ID, SCENARIOS, public
from .simulator import ACTION_KINDS, FAULT_KINDS, Simulator
from .topology import SPEC_BY_ID, topology_payload

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
engine = Engine(seed=int(os.getenv("RIPTIDE_SEED", "42")))


@asynccontextmanager
async def lifespan(_: FastAPI):
    engine.start()
    asyncio.create_task(_compute_benchmark())  # warm the evaluation cache in the background
    yield
    await engine.stop()


app = FastAPI(title="Riptide", version="1.0.0", description="Cascading failure prediction & recovery", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


class ControlBody(BaseModel):
    action: str = Field(pattern="^(pause|resume|reset|speed|step)$")
    speed: float | None = Field(default=None, ge=0.25, le=8)


class FaultBody(BaseModel):
    kind: str
    target: str
    rate: float = Field(default=1.0, ge=0.1, le=5)


class ActionBody(BaseModel):
    kind: str
    target: str


class ApplyBody(BaseModel):
    strategyId: str


class LogsBody(BaseModel):
    text: str = Field(max_length=20_000_000)


@app.get("/api/health")
async def health():
    return {"ok": True, "tick": engine.sim.tick, "clients": len(engine.clients)}


@app.get("/api/topology")
async def topology():
    return topology_payload()


@app.get("/api/state")
async def state():
    async with engine.lock:
        return engine.snapshot()


@app.get("/api/catalog")
async def catalog():
    return {
        "scenarios": [public(s) for s in SCENARIOS],
        "faults": [{"kind": k, "label": v} for k, v in FAULT_KINDS.items()],
        "actions": [{"kind": k, "label": v[0], "duration": v[1]} for k, v in ACTION_KINDS.items()],
    }


@app.post("/api/scenarios/{scenario_id}")
async def inject_scenario(scenario_id: str):
    if scenario_id not in SCENARIO_BY_ID:
        raise HTTPException(404, "unknown scenario")
    async with engine.lock:
        return engine.inject(scenario_id)


@app.post("/api/faults")
async def inject_fault(body: FaultBody):
    async with engine.lock:
        try:
            return engine.inject_custom(body.kind, body.target, body.rate)
        except ValueError as e:
            raise HTTPException(400, str(e))


@app.post("/api/control")
async def control(body: ControlBody):
    async with engine.lock:
        if body.action == "pause":
            engine.paused = True
        elif body.action == "resume":
            engine.paused = False
        elif body.action == "reset":
            engine.reset()
        elif body.action == "step":
            engine.advance()
        elif body.action == "speed" and body.speed:
            engine.speed = body.speed
        return {"paused": engine.paused, "speed": engine.speed, "tick": engine.sim.tick}


@app.get("/api/services/{service_id}")
async def service_detail(service_id: str, points: int = Query(120, ge=10, le=240)):
    if service_id not in SPEC_BY_ID:
        raise HTTPException(404, "unknown service")
    async with engine.lock:
        t = engine.predictor.tracks[service_id]
        start = engine.sim.tick - len(t.history["health"]) + 1
        hist = {m: list(t.history[m])[-points:] for m in METRICS}
        n = len(hist["health"])
        spec = SPEC_BY_ID[service_id]
        return {
            "id": service_id,
            "spec": topology_payload()["services"][list(SPEC_BY_ID).index(service_id)],
            "series": [
                {"tick": start + len(t.history["health"]) - n + i, **{m: round(hist[m][i], 3) for m in METRICS}}
                for i in range(n)
            ],
            "baseline": {m: round(b.mean, 3) for m, b in t.baseline.items()},
            "zscores": engine.predictor.zscores(service_id, engine.sim),
            "forecast": engine.forecast["services"][service_id],
            "logs": [l for l in engine.sim.logs if l["service"] == service_id][-40:],
            "baseLatency": spec.base_latency,
        }


@app.get("/api/logs")
async def logs(service: str | None = None, level: str | None = None, q: str | None = None, limit: int = Query(300, le=2000)):
    async with engine.lock:
        items = list(engine.sim.logs)
    if service:
        items = [l for l in items if l["service"] == service]
    if level:
        wanted = set(level.upper().split(","))
        items = [l for l in items if l["level"] in wanted]
    if q:
        ql = q.lower()
        items = [l for l in items if ql in l["message"].lower()]
    return {"logs": items[-limit:]}


@app.post("/api/recovery/evaluate")
async def evaluate():
    async with engine.lock:
        return engine.recommend()


@app.post("/api/recovery/apply")
async def apply(body: ApplyBody):
    async with engine.lock:
        try:
            return engine.apply_strategy(body.strategyId)
        except KeyError as e:
            raise HTTPException(409, str(e))


@app.post("/api/actions")
async def action(body: ActionBody):
    async with engine.lock:
        try:
            return engine.apply_action(body.kind, body.target)
        except ValueError as e:
            raise HTTPException(400, str(e))


class AutopilotBody(BaseModel):
    enabled: bool


@app.post("/api/autopilot")
async def autopilot(body: AutopilotBody):
    async with engine.lock:
        engine.autopilot = body.enabled
        engine.sim.event("autopilot", None, f"Autopilot {'engaged' if body.enabled else 'disengaged'}")
        return {"autopilot": engine.autopilot}


@app.post("/api/whatif/{service_id}")
async def whatif(service_id: str):
    if service_id not in SPEC_BY_ID:
        raise HTTPException(404, "unknown service")
    async with engine.lock:
        return engine.whatif(service_id)


_bench: dict = {"status": "idle", "result": None}


async def _compute_benchmark() -> None:
    _bench["status"] = "running"
    try:
        _bench["result"] = await asyncio.to_thread(run_benchmark)
        _bench["status"] = "ready"
    except Exception:
        logging.getLogger("riptide").exception("benchmark failed")
        _bench["status"] = "error"


@app.get("/api/benchmark")
async def benchmark(refresh: bool = False):
    if refresh or _bench["status"] in ("idle", "error"):
        if _bench["status"] != "running":
            asyncio.create_task(_compute_benchmark())
            _bench["status"] = "running"
    return {"status": _bench["status"], "result": _bench["result"]}


@app.get("/api/incidents")
async def incidents():
    async with engine.lock:
        return {"incidents": engine.incidents.summary(), "stats": engine.incidents.stats()}


@app.get("/api/incidents/{incident_id}/report", response_class=PlainTextResponse)
async def incident_report(incident_id: str):
    async with engine.lock:
        inc = engine.incidents.get(incident_id)
        if inc is None:
            raise HTTPException(404, "unknown incident")
        return PlainTextResponse(
            report_markdown(inc),
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{incident_id}.md"'},
        )


@app.post("/api/analyze/logs")
async def analyze_logs(body: LogsBody):
    if not body.text.strip():
        raise HTTPException(400, "empty log file")
    return analyse_logs(body.text, set(SPEC_BY_ID))


@app.get("/api/analyze/sample", response_class=PlainTextResponse)
async def sample_log(scenario: str = "db-pool-exhaustion", seconds: int = Query(150, ge=30, le=600)):
    """Generate a realistic log file from a fresh twin running the given scenario."""
    sc = SCENARIO_BY_ID.get(scenario)
    if sc is None:
        raise HTTPException(404, "unknown scenario")
    sim = Simulator(seed=7)
    for _ in range(40):
        sim.step()
    for kind, target, rate in sc["faults"]:
        sim.inject_fault(kind, target, rate)
    for _ in range(seconds):
        sim.step()
    text = "\n".join(f"{l['ts']} {l['level']:<5} [{l['service']}] {l['message']} trace={l['traceId']}" for l in sim.logs)
    return PlainTextResponse(
        text + "\n", headers={"Content-Disposition": f'attachment; filename="riptide-sample-{scenario}.log"'}
    )


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    engine.clients.add(websocket)
    try:
        async with engine.lock:
            snap = engine.snapshot()
        await websocket.send_json(snap | {"type": "hello", "topology": topology_payload()})
        while True:
            await websocket.receive_text()  # keepalive pings from the client
    except WebSocketDisconnect:
        pass
    finally:
        engine.clients.discard(websocket)


# ---- serve the built frontend when present (single-container deployment)
STATIC_DIR = Path(os.getenv("RIPTIDE_STATIC", Path(__file__).resolve().parents[2] / "frontend" / "dist")).resolve()
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file() and STATIC_DIR in candidate.resolve().parents:
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
