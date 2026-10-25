"""Failure prediction.

Three signals are fused per service:
  1. Anomaly score: deviation from an EWMA baseline learned only while healthy.
  2. Time-to-failure: least-squares trend of each metric extrapolated to its
     failure threshold (OOM, pool exhaustion, error budget, latency ceiling).
  3. Cascade risk: noisy-OR propagation of failure probability along the
     dependency graph (callees first), with propagation delays producing a
     predicted failure wavefront.
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

from .simulator import Simulator, clamp
from .topology import SPEC_BY_ID, deps_of, topo_order

HISTORY = 240
TREND_WINDOW = 20
HORIZON = 120  # seconds we forecast ahead
METRICS = ("cpu", "memory", "latency", "error_rate", "saturation", "health")


@dataclass
class Baseline:
    mean: float
    var: float


@dataclass
class ServiceTrack:
    history: dict[str, deque] = field(default_factory=lambda: {m: deque(maxlen=HISTORY) for m in METRICS})
    baseline: dict[str, Baseline] = field(default_factory=dict)
    onset: int | None = None
    calm_ticks: int = 0
    anomaly: float = 0.0


def _slope(values: list[float]) -> tuple[float, float]:
    """Least-squares slope per tick and its standard error."""
    n = len(values)
    if n < 6:
        return 0.0, float("inf")
    xm = (n - 1) / 2
    ym = sum(values) / n
    sxx = sum((i - xm) ** 2 for i in range(n))
    sxy = sum((i - xm) * (v - ym) for i, v in enumerate(values))
    b = sxy / sxx
    resid = sum((v - (ym + b * (i - xm))) ** 2 for i, v in enumerate(values))
    se = math.sqrt(resid / max(n - 2, 1) / sxx)
    return b, se


def failure_thresholds(service_id: str) -> dict[str, float]:
    spec = SPEC_BY_ID[service_id]
    return {
        "memory": 99.5,
        "saturation": 99.0,
        "error_rate": 30.0,
        "latency": spec.base_latency * 11,
        "cpu": 99.0,
    }


METRIC_LABEL = {
    "memory": "Heap memory",
    "saturation": "Pool / queue saturation",
    "error_rate": "Error rate",
    "latency": "p99 latency",
    "cpu": "CPU",
    "health": "Health",
}

METRIC_FLOOR = {"cpu": 3.0, "memory": 1.5, "latency": 0.0, "error_rate": 0.5, "saturation": 3.0, "health": 0.02}


class Predictor:
    def __init__(self) -> None:
        self.tracks: dict[str, ServiceTrack] = {sid: ServiceTrack() for sid in SPEC_BY_ID}

    def observe(self, sim: Simulator) -> None:
        for sid, s in sim.services.items():
            t = self.tracks[sid]
            vals = {m: getattr(s, m) for m in METRICS}
            for m, v in vals.items():
                t.history[m].append(v)
            # learn baseline only while healthy so incidents don't poison it
            if s.health >= 0.9 and s.down_ticks == 0:
                for m, v in vals.items():
                    b = t.baseline.get(m)
                    if b is None:
                        t.baseline[m] = Baseline(v, (0.05 * abs(v) + 0.5) ** 2)
                    else:
                        a = 0.03
                        d = v - b.mean
                        b.mean += a * d
                        b.var = (1 - a) * (b.var + a * d * d)
            t.anomaly = self._anomaly(sid, t, vals)
            anomalous = t.anomaly > 0.45 or s.health < 0.8
            if anomalous:
                t.calm_ticks = 0
                if t.onset is None:
                    t.onset = sim.tick
            else:
                t.calm_ticks += 1
                if t.calm_ticks > 12:
                    t.onset = None

    def _anomaly(self, sid: str, t: ServiceTrack, vals: dict[str, float]) -> float:
        spec = SPEC_BY_ID[sid]
        zmax = 0.0
        for m in ("cpu", "memory", "latency", "error_rate", "saturation"):
            b = t.baseline.get(m)
            if b is None:
                continue
            floor = METRIC_FLOOR[m] or spec.base_latency * 0.15
            z = (vals[m] - b.mean) / max(math.sqrt(b.var), floor)
            zmax = max(zmax, z)
        return round(clamp(1 - math.exp(-max(0.0, zmax - 2.5) / 4.0)), 4)

    def zscores(self, sid: str, sim: Simulator) -> dict[str, float]:
        spec = SPEC_BY_ID[sid]
        t = self.tracks[sid]
        s = sim.services[sid]
        out = {}
        for m in ("cpu", "memory", "latency", "error_rate", "saturation"):
            b = t.baseline.get(m)
            if b is None:
                continue
            floor = METRIC_FLOOR[m] or spec.base_latency * 0.15
            out[m] = round((getattr(s, m) - b.mean) / max(math.sqrt(b.var), floor), 2)
        return out

    # ---------------------------------------------------------- forecasting
    def forecast(self, sim: Simulator) -> dict:
        deps = deps_of()
        local: dict[str, dict] = {}
        for sid, s in sim.services.items():
            local[sid] = self._local_forecast(sid, sim)

        risk: dict[str, float] = {}
        eta: dict[str, float | None] = {}
        via: dict[str, str | None] = {}
        for sid in topo_order():
            loc = local[sid]
            survive = 1.0 - loc["p"]
            best_eta, best_via = loc["eta"], None
            for dep, w in deps[sid]:
                breaker = 0.25 if dep in sim.breakers else 1.0
                transmitted = clamp(w * 0.92 * risk[dep] * breaker)
                survive *= 1.0 - transmitted
                if transmitted > 0.35 and eta[dep] is not None:
                    cand = eta[dep] + 3 + 12 * (1 - w)
                    if best_eta is None or cand < best_eta:
                        best_eta, best_via = cand, dep
            risk[sid] = clamp(1.0 - survive)
            eta[sid] = None if best_eta is None else round(min(best_eta, HORIZON * 2), 1)
            via[sid] = best_via

        services = {}
        for sid in sim.services:
            loc = local[sid]
            drivers = list(loc["drivers"])
            if via[sid]:
                drivers.insert(0, f"Cascade from {via[sid]} (at risk {risk[via[sid]] * 100:.0f}%)")
            services[sid] = {
                "risk": round(risk[sid], 4),
                "localRisk": round(loc["p"], 4),
                "eta": eta[sid] if risk[sid] >= 0.3 else None,
                "anomaly": self.tracks[sid].anomaly,
                "drivers": drivers[:4],
                "via": via[sid],
                "trends": loc["trends"],
            }

        wavefront = sorted(
            (
                {"service": sid, "eta": v["eta"], "risk": v["risk"], "via": v["via"]}
                for sid, v in services.items()
                if v["risk"] >= 0.5 and sim.services[sid].status not in ("critical", "down")
            ),
            key=lambda x: (x["eta"] if x["eta"] is not None else 1e9, -x["risk"]),
        )
        gw = services["api-gateway"]
        weighted = sum(services[s]["risk"] * SPEC_BY_ID[s].importance for s in services) / sum(
            SPEC_BY_ID[s].importance for s in services
        )
        return {
            "services": services,
            "wavefront": wavefront,
            "crashProbability": round(max(gw["risk"], services["checkout"]["risk"] * 0.9), 4),
            "systemRisk": round(weighted, 4),
            "timeToImpact": min((w["eta"] for w in wavefront if w["eta"] is not None), default=None),
            "blastRadius": sum(1 for v in services.values() if v["risk"] >= 0.5),
        }

    def _local_forecast(self, sid: str, sim: Simulator) -> dict:
        s = sim.services[sid]
        t = self.tracks[sid]
        if s.down_ticks > 0 or s.status == "down":
            return {"p": 1.0, "eta": 0.0, "drivers": ["Service is currently down"], "trends": {}}
        thresholds = failure_thresholds(sid)
        best_eta: float | None = None
        drivers: list[tuple[float, str]] = []
        trends: dict[str, float] = {}
        for m, limit in thresholds.items():
            series = list(t.history[m])[-TREND_WINDOW:]
            b, se = _slope(series)
            trends[m] = round(b, 4)
            cur = series[-1] if series else getattr(s, m)
            if cur >= limit:
                best_eta = 0.0
                drivers.append((0.0, f"{METRIC_LABEL[m]} at failure threshold"))
                continue
            significant = b > 0 and b > 2.5 * se and b > _min_slope(m, sid)
            if not significant:
                continue
            e = (limit - cur) / b
            if e <= HORIZON * 1.5:
                drivers.append((e, f"{METRIC_LABEL[m]} {_fmt_rate(m, b)} → limit in {e:.0f}s"))
                if best_eta is None or e < best_eta:
                    best_eta = e

        # current-condition risk: an unhealthy service is likely to tip over
        cond = clamp((0.85 - s.health) / 0.6) ** 1.2
        trend_p = 0.0 if best_eta is None else clamp(1.0 / (1.0 + (best_eta / 45.0) ** 1.6))
        p = 1 - (1 - cond) * (1 - trend_p) * (1 - 0.35 * t.anomaly)
        if cond > 0.15:
            drivers.append((1e6, f"Health {s.health * 100:.0f}% ({s.status})"))
        drivers.sort(key=lambda d: d[0])
        return {"p": clamp(p), "eta": best_eta, "drivers": [d[1] for d in drivers], "trends": trends}


def _min_slope(metric: str, sid: str) -> float:
    if metric == "latency":
        return SPEC_BY_ID[sid].base_latency * 0.03
    return {"memory": 0.12, "saturation": 0.15, "error_rate": 0.12, "cpu": 0.25}.get(metric, 0.1)


def _fmt_rate(metric: str, b: float) -> str:
    if metric == "latency":
        return f"rising {b:.0f}ms/s"
    return f"rising {b:.2f}%/s"
