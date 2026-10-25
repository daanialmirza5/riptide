"""Engine: owns the live digital twin and runs the observe -> predict -> diagnose
loop, broadcasting a snapshot to WebSocket subscribers every tick."""
from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import WebSocket

from . import rca as rca_mod
from . import recovery
from .incidents import IncidentManager
from .predictor import Predictor
from .scenarios import SCENARIO_BY_ID
from .simulator import FAULT_KINDS, Simulator
from .topology import SPEC_BY_ID

log = logging.getLogger("riptide.engine")

HISTORY_POINTS = 90


class Engine:
    def __init__(self, seed: int = 42) -> None:
        self.seed = seed
        self.lock = asyncio.Lock()
        self.clients: set[WebSocket] = set()
        self.speed = 1.0
        self.paused = False
        self.autopilot = False
        self._task: asyncio.Task | None = None
        self.reset()

    def reset(self) -> None:
        self.sim = Simulator(seed=self.seed)
        self.predictor = Predictor()
        self.incidents = IncidentManager()
        self.system_history: list[dict] = []
        self.last_recommendation: dict | None = None
        self.autopilot_log: list[dict] = []
        self._autopilot_ready_at = 0
        self._log_cursor = 0
        # warm up baselines on healthy traffic before anything can go wrong
        self.sim.emit_logs = False
        for _ in range(60):
            self.sim.step()
            self.predictor.observe(self.sim)
        self.sim.emit_logs = True
        self.forecast = self.predictor.forecast(self.sim)
        self.rca = rca_mod.analyse(self.sim, self.predictor, self.forecast)
        self._log_cursor = self.sim._log_seq

    # --------------------------------------------------------------- loop
    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.sleep(1.0 / self.speed)
                if self.paused:
                    continue
                async with self.lock:
                    self.advance()
                    payload = self.snapshot(include_logs=True)
                await self._broadcast(payload)
            except asyncio.CancelledError:
                raise
            except Exception:  # keep the loop alive; surface in server logs
                log.exception("engine tick failed")

    def advance(self) -> None:
        self.sim.step()
        self.predictor.observe(self.sim)
        self.forecast = self.predictor.forecast(self.sim)
        self.rca = rca_mod.analyse(self.sim, self.predictor, self.forecast)
        self.incidents.observe(self.sim, self.forecast, self.rca)
        if self.autopilot:
            self._autopilot_step()
        self.system_history.append(
            {
                "tick": self.sim.tick,
                "health": round(self.sim.system_health(), 4),
                "availability": round(self.sim.availability(), 4),
                "risk": self.forecast["systemRisk"],
                "crash": self.forecast["crashProbability"],
                "rps": round(self.sim.services["api-gateway"].rps),
            }
        )
        self.system_history = self.system_history[-HISTORY_POINTS * 2:]

    def _autopilot_step(self) -> None:
        """Self-healing: once a diagnosis is confident and no remediation is in
        flight, simulate the options and execute the winner. A cooldown lets each
        action take effect before Autopilot reconsiders."""
        sim = self.sim
        if self.incidents.current is None or sim.tick < self._autopilot_ready_at:
            return
        if any(not a.done for a in sim.actions):
            return
        top = (self.rca.get("candidates") or [None])[0]
        if top is None or top["confidence"] < 0.5 or top["hypothesis"] == "unknown":
            return
        if self.forecast["crashProbability"] < 0.25 and not any(s.status != "healthy" for s in sim.services.values()):
            return
        rec = self.recommend()
        best = rec["strategies"][0]
        self._autopilot_ready_at = sim.tick + 45
        if best["id"] == "baseline":
            return
        self.apply_strategy(best["id"])
        entry = {
            "tick": sim.tick,
            "ts": sim.timestamp(),
            "strategy": best["name"],
            "rootCause": f"{top['hypothesisLabel']} in {top['service']}",
            "availability": best["availability"],
            "baseline": next(s["availability"] for s in rec["strategies"] if s["id"] == "baseline"),
        }
        self.autopilot_log.insert(0, entry)
        self.autopilot_log = self.autopilot_log[:20]
        sim.event("autopilot", top["service"], f"Autopilot executed '{best['name']}' for {entry['rootCause']}")

    def whatif(self, service: str) -> dict:
        return recovery.blast_radius(self.sim, service)

    async def _broadcast(self, payload: dict) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    # ------------------------------------------------------------ commands
    def inject(self, scenario_id: str) -> dict:
        sc = SCENARIO_BY_ID.get(scenario_id)
        if sc is None:
            raise KeyError(scenario_id)
        for kind, target, rate in sc["faults"]:
            self.sim.inject_fault(kind, target, rate)
        self.sim.event("chaos", sc["faults"][0][1], f"Chaos injected: {sc['name']}", scenario=scenario_id)
        return {"injected": sc["id"], "tick": self.sim.tick}

    def inject_custom(self, kind: str, target: str, rate: float) -> dict:
        fault = self.sim.inject_fault(kind, target, rate)
        self.sim.event("chaos", target, f"Chaos injected: {FAULT_KINDS[kind]} on {target}")
        return {"injected": fault.id, "tick": self.sim.tick}

    def recommend(self) -> dict:
        rec = recovery.recommend(self.sim, self.rca)
        self.last_recommendation = rec
        return rec

    def apply_strategy(self, strategy_id: str) -> dict:
        rec = self.last_recommendation
        if rec is None:
            raise KeyError("no evaluation available — run an evaluation first")
        strat = next((s for s in rec["strategies"] if s["id"] == strategy_id), None)
        if strat is None:
            raise KeyError(strategy_id)
        applied = []
        for step in strat["steps"]:
            a = self.sim.apply_action(step["action"], step["target"])
            applied.append(a.label)
        if not strat["steps"]:
            self.sim.event("action", None, "Decision: hold — no intervention")
        return {"applied": applied, "strategy": strat["name"]}

    def apply_action(self, kind: str, target: str) -> dict:
        a = self.sim.apply_action(kind, target)
        return {"applied": [a.label]}

    # ------------------------------------------------------------ snapshot
    def snapshot(self, include_logs: bool = False) -> dict:
        sim = self.sim
        fc = self.forecast["services"]
        services = []
        for sid, s in sim.services.items():
            spec = SPEC_BY_ID[sid]
            f = fc[sid]
            services.append(
                {
                    "id": sid,
                    "status": s.status,
                    "health": round(s.health, 4),
                    "cpu": round(s.cpu, 1),
                    "memory": round(s.memory, 1),
                    "latency": round(s.latency, 1),
                    "errorRate": round(s.error_rate, 2),
                    "saturation": round(s.saturation, 1),
                    "rps": round(s.rps, 1),
                    "replicas": s.replicas,
                    "version": s.version,
                    "restarting": s.down_ticks > 0,
                    "breaker": sid in sim.breakers,
                    "risk": f["risk"],
                    "eta": f["eta"],
                    "anomaly": f["anomaly"],
                    "drivers": f["drivers"],
                    "via": f["via"],
                    "baseLatency": spec.base_latency,
                }
            )
        out = {
            "type": "tick",
            "tick": sim.tick,
            "ts": sim.timestamp(),
            "paused": self.paused,
            "speed": self.speed,
            "autopilot": self.autopilot,
            "autopilotLog": self.autopilot_log[:5],
            "kpis": {
                "health": round(sim.system_health(), 4),
                "availability": round(sim.availability(), 4),
                "crashProbability": self.forecast["crashProbability"],
                "systemRisk": self.forecast["systemRisk"],
                "timeToImpact": self.forecast["timeToImpact"],
                "blastRadius": self.forecast["blastRadius"],
                "demand": round(sim.demand, 3),
                "shed": round(sim.shed_fraction, 4),
                "rps": round(sim.services["api-gateway"].rps),
            },
            "services": services,
            "wavefront": self.forecast["wavefront"],
            "rca": self.rca,
            "faults": [
                {"id": f.id, "kind": f.kind, "label": f.label, "target": f.target, "age": sim.tick - f.started}
                for f in sim.faults
            ],
            "actions": [
                {
                    "id": a.id,
                    "kind": a.kind,
                    "target": a.target,
                    "label": a.label,
                    "progress": min(1.0, (sim.tick - a.started) / max(a.duration, 1)),
                    "done": a.done,
                }
                for a in sim.actions[-8:]
            ],
            "incident": self.incidents.current.to_dict() if self.incidents.current else None,
            "incidentStats": self.incidents.stats(),
            "history": self.system_history[-HISTORY_POINTS:],
        }
        if include_logs:
            new = [l for l in sim.logs if l["id"] > self._log_cursor]
            self._log_cursor = sim._log_seq
            out["logs"] = new[-60:]
        return out
