"""Root-cause analysis.

Candidates are anomalous services. Each is scored on five pieces of evidence:
  * personalised PageRank over the anomalous subgraph, walking caller -> callee
    with edge weights scaled by health-series correlation (MicroRCA-style),
  * whether its own dependencies are healthy (anomaly not inherited),
  * how early its anomaly started,
  * how much of the anomalous set it explains (its transitive callers),
  * its own anomaly intensity.
The winner is then classified into a failure hypothesis from its metric
signature, recent change events and log patterns.
"""
from __future__ import annotations

import math
from functools import lru_cache

from .predictor import Predictor, _slope
from .simulator import Simulator, clamp
from .topology import CACHE_FALLBACK, SPEC_BY_ID, callers_of, deps_of

HYPOTHESES = {
    "memory_leak": "Memory leak",
    "bad_deploy": "Faulty deployment",
    "pool_exhaustion": "Connection pool exhaustion",
    "broker_backlog": "Broker backlog / partition stall",
    "cache_failure": "Cache node failure",
    "overload": "Traffic overload",
    "provider_degradation": "Upstream provider degradation",
    "unknown": "Unclassified resource degradation",
}


def _corr(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    if n < 5:
        return 0.0
    a, b = a[-n:], b[-n:]
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    if va < 1e-9 or vb < 1e-9:
        return 0.0
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)


@lru_cache(maxsize=1)
def causal_deps() -> dict[str, list[tuple[str, float]]]:
    """Call edges plus load-coupling edges: a store that absorbs a cache's
    misses is causally downstream of that cache even though it never calls it."""
    out = {k: list(v) for k, v in deps_of().items()}
    for cache, stores in CACHE_FALLBACK.items():
        for store in stores:
            out[store].append((cache, 0.85))
    return out


def causal_ancestors(service: str) -> set[str]:
    rev: dict[str, list[str]] = {}
    for caller, edges in causal_deps().items():
        for callee, _ in edges:
            rev.setdefault(callee, []).append(caller)
    out: set[str] = set()
    stack = [service]
    while stack:
        for c in rev.get(stack.pop(), []):
            if c not in out:
                out.add(c)
                stack.append(c)
    return out


def ingress_surge(sim: Simulator) -> float:
    """Demand relative to normal, measured at the CDN: it has no callers, so
    retry storms inside the platform cannot inflate it."""
    return sim.services["cdn"].rps / SPEC_BY_ID["cdn"].base_rps


def analyse(sim: Simulator, pred: Predictor, forecast: dict | None = None) -> dict:
    tracks = pred.tracks
    local_risk = {sid: v["localRisk"] for sid, v in (forecast or {}).get("services", {}).items()}
    anomalous = [
        sid
        for sid, s in sim.services.items()
        if tracks[sid].anomaly > 0.45 or s.health < 0.8 or s.down_ticks > 0 or local_risk.get(sid, 0) >= 0.2
    ]
    if not anomalous:
        return {"status": "nominal", "candidates": [], "anomalous": []}

    deps = causal_deps()
    aset = set(anomalous)
    intensity = {
        sid: max(tracks[sid].anomaly, 1 - sim.services[sid].health, 0.8 * local_risk.get(sid, 0)) for sid in anomalous
    }

    # ---- personalised PageRank over anomalous subgraph (caller -> callee)
    window = 40
    health_series = {sid: list(tracks[sid].history["health"])[-window:] for sid in anomalous}
    out_edges: dict[str, list[tuple[str, float]]] = {sid: [] for sid in anomalous}
    for sid in anomalous:
        for dep, w in deps[sid]:
            if dep in aset:
                c = abs(_corr(health_series[sid], health_series[dep]))
                out_edges[sid].append((dep, w * (0.3 + 0.7 * c)))
    total_int = sum(intensity.values()) or 1.0
    pers = {sid: intensity[sid] / total_int for sid in anomalous}
    rank = dict(pers)
    d = 0.85
    for _ in range(40):
        nxt = {sid: (1 - d) * pers[sid] for sid in anomalous}
        for sid in anomalous:
            edges = out_edges[sid]
            tw = sum(w for _, w in edges)
            if tw <= 0:
                nxt[sid] += d * rank[sid]  # sink keeps its mass: likely origin
                continue
            for dep, w in edges:
                nxt[dep] += d * rank[sid] * w / tw
        rank = nxt
    rmax = max(rank.values()) or 1.0

    onsets = {sid: tracks[sid].onset if tracks[sid].onset is not None else sim.tick for sid in anomalous}
    first, last = min(onsets.values()), max(onsets.values())
    span = max(last - first, 1)

    scored = []
    for sid in anomalous:
        inherited = 0.0
        for dep, w in deps[sid]:
            if dep in aset:
                inherited = max(inherited, w * intensity[dep])
        explains = len(aset & causal_ancestors(sid)) / max(len(aset) - 1, 1)
        onset_score = 1 - (onsets[sid] - first) / span if span > 1 else 1.0
        components = {
            "pagerank": rank[sid] / rmax,
            "isolation": 1 - inherited,
            "onset": onset_score,
            "explains": explains,
            "intensity": intensity[sid],
        }
        score = (
            0.28 * components["pagerank"]
            + 0.27 * components["isolation"]
            + 0.2 * components["onset"]
            + 0.15 * components["explains"]
            + 0.1 * components["intensity"]
        )
        scored.append((score, sid, components))
    scored.sort(reverse=True)

    # A platform-wide demand surge has no faulty component: it enters at the edge.
    surge = ingress_surge(sim)
    if surge > 1.45:
        entry = next((x for x in scored if x[1] == "api-gateway"), None)
        if entry is None:
            entry = (0.0, "api-gateway", {"pagerank": 0, "isolation": 1, "onset": 1, "explains": 1, "intensity": 0})
        else:
            scored.remove(entry)
        scored.insert(0, (max(scored[0][0] if scored else 0, entry[0]) + 0.15, "api-gateway", entry[2]))
        onsets.setdefault("api-gateway", first)

    total = sum(math.exp(6 * s) for s, _, _ in scored)
    candidates = []
    for score, sid, comp in scored[:4]:
        hyp, evidence = _classify(sid, sim, pred)
        candidates.append(
            {
                "service": sid,
                "score": round(score, 4),
                "confidence": round(math.exp(6 * score) / total, 4),
                "hypothesis": hyp,
                "hypothesisLabel": HYPOTHESES[hyp],
                "evidence": evidence,
                "components": {k: round(v, 3) for k, v in comp.items()},
                "onsetTick": onsets[sid],
                "impacted": sorted(aset & causal_ancestors(sid)),
                "path": _blast_path(sid, aset | _at_risk(pred, sim)),
            }
        )
    return {"status": "incident", "candidates": candidates, "anomalous": sorted(anomalous)}


def _at_risk(pred: Predictor, sim: Simulator) -> set[str]:
    return {sid for sid, t in pred.tracks.items() if sim.services[sid].health < 0.9}


def _blast_path(root: str, involved: set[str]) -> list[str]:
    """Shortest route from the root cause up to the user-facing edge."""
    callers = callers_of()
    prev: dict[str, str | None] = {root: None}
    queue = [root]
    while queue:
        cur = queue.pop(0)
        if SPEC_BY_ID[cur].kind == "edge":
            path = [cur]
            while prev[path[-1]] is not None:
                path.append(prev[path[-1]])  # type: ignore[arg-type]
            return list(reversed(path))
        for c, _ in sorted(callers[cur], key=lambda x: -x[1]):
            if c not in prev and (c in involved or SPEC_BY_ID[c].kind == "edge"):
                prev[c] = cur
                queue.append(c)
    return [root]


def _classify(sid: str, sim: Simulator, pred: Predictor) -> tuple[str, list[dict]]:
    spec = SPEC_BY_ID[sid]
    s = sim.services[sid]
    t = pred.tracks[sid]
    z = pred.zscores(sid, sim)
    hist = {m: list(t.history[m]) for m in t.history}
    mem_slope, _ = _slope(hist["memory"][-30:])
    sat_slope, _ = _slope(hist["saturation"][-30:])
    err = hist["error_rate"]
    err_step = (sum(err[-6:]) / 6 - sum(err[-30:-10]) / 20) if len(err) >= 30 else 0.0
    recent_deploy = next(
        (e for e in reversed(sim.events) if e["kind"] == "deploy" and e["service"] == sid and sim.tick - e["tick"] < 180),
        None,
    )
    crashes = [e for e in sim.events if e["kind"] == "crash" and e["service"] == sid and sim.tick - e["tick"] < 240]
    base = t.baseline
    gw = sim.services["api-gateway"]
    gw_base = pred.tracks["api-gateway"].baseline.get("cpu")
    surge = ingress_surge(sim)

    evidence: list[dict] = []

    def ev(kind: str, text: str, weight: float) -> None:
        evidence.append({"kind": kind, "text": text, "weight": round(weight, 2)})

    hyp = "unknown"
    if surge > 1.45 and spec.kind != "external" and s.rps > spec.base_rps * 1.3:
        hyp = "overload"
        ev("metric", f"Platform traffic at {surge:.1f}x normal — {sid} serving {s.rps:.0f} req/s, CPU {s.cpu:.0f}%", 0.9)
        if gw_base:
            ev("metric", f"Gateway CPU {gw.cpu:.0f}% vs {gw_base.mean:.0f}% baseline", 0.7)
    elif mem_slope > 0.2 or crashes:
        hyp = "memory_leak"
        ev("metric", f"Heap grows {mem_slope:.2f}%/s with no matching traffic increase", 0.9)
        if crashes:
            ev("event", f"{len(crashes)} OOMKilled restart(s) observed", 0.85)
        if recent_deploy:
            ev("change", f"Leak began after release {recent_deploy.get('version')} ({sim.tick - recent_deploy['tick']}s ago)", 0.8)
    elif spec.kind == "external" and s.latency > spec.base_latency * 2.5:
        hyp = "provider_degradation"
        ev("metric", f"Provider p99 {s.latency:.0f}ms vs {spec.base_latency:.0f}ms baseline", 0.9)
    elif sid == "redis-cache" and s.error_rate > 5:
        hyp = "cache_failure"
        ev("metric", f"Cache error rate {s.error_rate:.0f}% — clients falling back to Postgres", 0.9)
    elif sid == "kafka" and (sat_slope > 0.2 or s.saturation > 85):
        hyp = "broker_backlog"
        ev("metric", f"Consumer lag saturation {s.saturation:.0f}% rising {sat_slope:.2f}%/s", 0.9)
    elif sat_slope > 0.2 or s.saturation > 88:
        hyp = "pool_exhaustion"
        ev("metric", f"Connection pool {s.saturation:.0f}% used, rising {sat_slope:.2f}%/s", 0.9)
    elif recent_deploy and err_step > 5:
        hyp = "bad_deploy"
        ev("change", f"Error rate stepped +{err_step:.1f}pp right after release {recent_deploy.get('version')}", 0.95)
    elif s.cpu > 85 and s.rps > spec.base_rps * 1.4:
        hyp = "overload"
        ev("metric", f"Traffic {s.rps:.0f} req/s = {s.rps / spec.base_rps:.1f}x normal, CPU {s.cpu:.0f}%", 0.9)
    elif recent_deploy:
        hyp = "bad_deploy"
        ev("change", f"Recent release {recent_deploy.get('version')} precedes degradation", 0.6)

    for m, zz in sorted(z.items(), key=lambda kv: -kv[1])[:3]:
        if zz > 3:
            b = base.get(m)
            ev("anomaly", f"{m.replace('_', ' ')} z={zz:.1f} ({getattr(s, m):.1f} vs baseline {b.mean if b else 0:.1f})", clamp(zz / 12))
    lines = [l for l in reversed(sim.logs) if l["service"] == sid and l["level"] in ("ERROR", "FATAL", "WARN")][:3]
    for l in lines:
        ev("log", f"[{l['level']}] {l['message']}", 0.5)
    healthy_deps = [d for d, _ in deps_of()[sid] if sim.services[d].health >= 0.85]
    if deps_of()[sid] and len(healthy_deps) == len(deps_of()[sid]):
        ev("topology", "All downstream dependencies healthy — degradation originates here", 0.7)
    elif not deps_of()[sid]:
        ev("topology", "Leaf dependency — no downstream services to inherit failure from", 0.6)
    return hyp, evidence
