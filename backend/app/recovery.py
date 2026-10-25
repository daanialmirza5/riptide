"""Recovery strategy generation and counterfactual evaluation.

Candidate strategies are derived from the RCA hypotheses (never from the
injected ground truth). Each is evaluated by forking the digital twin, applying
the strategy, and simulating the next HORIZON seconds. The baseline is the same
fork with no intervention, so every strategy is compared against "do nothing".
"""
from __future__ import annotations

from dataclasses import dataclass

from .simulator import ACTION_KINDS, Simulator, clamp
from .topology import SERVICES, SPEC_BY_ID, callers_of

HORIZON = 120
REVENUE_PER_SECOND = 48.0  # $ of checkout revenue flowing through the platform

ACTION_RISK = {
    "restart": 0.25,
    "rollback": 0.15,
    "scale_out": 0.1,
    "circuit_breaker": 0.2,
    "failover": 0.45,
    "rate_limit": 0.3,
    "switch_provider": 0.25,
    "rebalance": 0.3,
}
ACTION_COST = {  # $ per hour of extra infrastructure or ops effort
    "restart": 0,
    "rollback": 0,
    "scale_out": 14,
    "circuit_breaker": 0,
    "failover": 30,
    "rate_limit": 0,
    "switch_provider": 120,
    "rebalance": 8,
}


@dataclass
class Strategy:
    id: str
    name: str
    steps: list[tuple[str, str]]
    rationale: str


def _hottest(sim: Simulator, n: int = 3) -> list[str]:
    ranked = sorted(
        (s for s in SERVICES if s.kind in ("app", "edge")),
        key=lambda s: -sim.services[s.id].rps / (s.capacity * sim.services[s.id].replicas),
    )
    return [s.id for s in ranked[:n]]


def generate(sim: Simulator, rca: dict) -> list[Strategy]:
    out: list[Strategy] = [Strategy("baseline", "Do nothing", [], "Let the system evolve without intervention")]
    for cand in rca.get("candidates", [])[:2]:
        sid, hyp = cand["service"], cand["hypothesis"]
        name = SPEC_BY_ID[sid].name
        hot_callers = [c for c, w in sorted(callers_of()[sid], key=lambda x: -x[1])][:1]
        if hyp == "memory_leak":
            out += [
                Strategy(f"rollback-{sid}", f"Roll back {name}", [("rollback", sid)], "Revert the release that introduced the leak"),
                Strategy(f"restart-{sid}", f"Rolling restart {name}", [("restart", sid)], "Reclaim heap now; leak will recur"),
                Strategy(f"scale-{sid}", f"Scale out {name}", [("scale_out", sid)], "Spread load to slow the heap growth"),
                Strategy(f"restart-cb-{sid}", f"Restart + isolate {name}", [("restart", sid), ("circuit_breaker", sid)],
                         "Restart and shield callers with a circuit breaker"),
            ]
        elif hyp == "bad_deploy":
            out += [
                Strategy(f"rollback-{sid}", f"Roll back {name}", [("rollback", sid)], "Revert to the last known-good release"),
                Strategy(f"cb-{sid}", f"Circuit-break {name}", [("circuit_breaker", sid)], "Fail fast and serve fallbacks to callers"),
                Strategy(f"scale-{sid}", f"Scale out {name}", [("scale_out", sid)], "Add capacity to absorb retries"),
            ]
        elif hyp == "pool_exhaustion":
            out += [
                Strategy(f"failover-{sid}", f"Fail over {name}", [("failover", sid)], "Promote a fresh primary with clean pools"),
                Strategy(f"restart-{sid}", f"Restart {name}", [("restart", sid)], "Drop leaked connections; leak continues"),
                Strategy(f"scale-{sid}", f"Scale out {name}", [("scale_out", sid)], "Add capacity / connection slots"),
            ]
        elif hyp == "broker_backlog":
            out += [
                Strategy(f"rebalance-{sid}", f"Rebalance {name}", [("rebalance", sid)], "Reassign stalled partitions"),
                Strategy(f"scale-{sid}", f"Scale out {name}", [("scale_out", sid)], "Add brokers to drain backlog"),
                Strategy(f"cb-{sid}", f"Circuit-break {name}", [("circuit_breaker", sid)], "Buffer events locally, shield producers"),
            ]
        elif hyp == "cache_failure":
            out += [
                Strategy(f"restart-{sid}", f"Restart {name}", [("restart", sid)], "Replace the failed cache node"),
                Strategy(f"cb-{sid}", f"Bypass {name}", [("circuit_breaker", sid)], "Short-circuit cache calls"),
                Strategy("scale-postgres", "Scale Postgres for fall-through", [("scale_out", "postgres-primary"), ("scale_out", "postgres-replica")],
                         "Absorb cache-miss traffic on the databases"),
                Strategy(f"restart-cb-{sid}", f"Restart + bypass {name}", [("restart", sid), ("circuit_breaker", sid)],
                         "Repair the node while shielding callers"),
            ]
        elif hyp == "provider_degradation":
            out += [
                Strategy(f"switch-{sid}", "Switch to backup provider", [("switch_provider", sid)], "Route payments to the secondary processor"),
                Strategy(f"cb-{sid}", f"Circuit-break {name}", [("circuit_breaker", sid)], "Fail fast and queue payments for retry"),
                Strategy("scale-payment", "Scale out Payment", [("scale_out", "payment")], "Add workers to hold slow calls"),
            ]
        elif hyp == "overload":
            hot = _hottest(sim)
            out += [
                Strategy("scale-hot", "Scale out hottest services", [("scale_out", h) for h in hot],
                         f"Add replicas to {', '.join(hot)}"),
                Strategy("rate-limit", "Adaptive rate limiting", [("rate_limit", "api-gateway")], "Shed excess load at the edge"),
                Strategy("scale-rate-limit", "Scale out + rate limit", [("rate_limit", "api-gateway")] + [("scale_out", h) for h in hot],
                         "Protect now, add capacity for the surge"),
            ]
        else:
            out += [
                Strategy(f"restart-{sid}", f"Restart {name}", [("restart", sid)], "Generic recovery"),
                Strategy(f"scale-{sid}", f"Scale out {name}", [("scale_out", sid)], "Add capacity"),
            ]
            if hot_callers:
                out.append(Strategy(f"cb-{sid}", f"Circuit-break {name}", [("circuit_breaker", sid)], "Shield callers"))

    seen: set[str] = set()
    unique = []
    for s in out:
        if s.id not in seen:
            seen.add(s.id)
            unique.append(s)
    return unique[:7]


def evaluate(sim: Simulator, strategy: Strategy, horizon: int = HORIZON) -> dict:
    twin = sim.fork()
    for kind, target in strategy.steps:
        twin.apply_action(kind, target)
    health_series, avail_series, failed_series = [], [], []
    peak_failed = 0
    failed_ever: set[str] = set()
    for _ in range(horizon):
        twin.step()
        failed = [sid for sid, s in twin.services.items() if s.status in ("critical", "down")]
        failed_ever.update(failed)
        peak_failed = max(peak_failed, len(failed))
        health_series.append(round(twin.system_health(), 4))
        avail_series.append(round(twin.availability(), 4))
        failed_series.append(len(failed))

    recovered_at = None
    for i in range(len(health_series)):
        if all(h >= 0.9 for h in health_series[i:]) and all(f == 0 for f in failed_series[i:]):
            recovered_at = i
            break
    avg_avail = sum(avail_series) / horizon
    revenue_lost = sum(1 - a for a in avail_series) * REVENUE_PER_SECOND
    risk = 1 - _prod(1 - ACTION_RISK[k] for k, _ in strategy.steps) if strategy.steps else 0.0
    cost = sum(ACTION_COST[k] for k, _ in strategy.steps)
    ttr_score = 1 - (recovered_at if recovered_at is not None else horizon * 1.25) / (horizon * 1.25)
    end_health = sum(health_series[-10:]) / 10
    score = (
        0.38 * avg_avail
        + 0.22 * ttr_score
        + 0.18 * (1 - peak_failed / len(SERVICES))
        + 0.14 * end_health
        + 0.08 * (1 - risk)
    )
    return {
        "id": strategy.id,
        "name": strategy.name,
        "rationale": strategy.rationale,
        "steps": [{"action": k, "target": t, "label": ACTION_KINDS[k][0]} for k, t in strategy.steps],
        "score": round(score, 4),
        "availability": round(avg_avail, 4),
        "timeToRecover": recovered_at,
        "peakFailed": peak_failed,
        "servicesImpacted": sorted(failed_ever),
        "endHealth": round(end_health, 4),
        "revenueLost": round(revenue_lost),
        "risk": round(risk, 3),
        "costPerHour": cost,
        "series": {"health": health_series, "availability": avail_series, "failed": failed_series},
    }


def blast_radius(sim: Simulator, service: str, horizon: int = 60) -> dict:
    """What-if: hard-fail `service` in a forked twin and record how the outage spreads."""
    twin = sim.fork()
    twin.services[service].down_ticks = horizon + 1
    failed_at: dict[str, int] = {}
    worst: dict[str, str] = {}
    avail = []
    rank = {"healthy": 0, "degraded": 1, "critical": 2, "down": 3}
    for t in range(1, horizon + 1):
        twin.step()
        avail.append(round(twin.availability(), 4))
        for sid, s in twin.services.items():
            if rank[s.status] > rank.get(worst.get(sid, "healthy"), 0):
                worst[sid] = s.status
            if s.status in ("critical", "down") and sid not in failed_at:
                failed_at[sid] = t
    impacted = sorted(
        ({"service": sid, "failedAt": failed_at.get(sid), "worst": st} for sid, st in worst.items() if st != "healthy"),
        key=lambda x: (x["failedAt"] if x["failedAt"] is not None else 1e9, x["service"]),
    )
    lost = sum(1 - a for a in avail) * REVENUE_PER_SECOND
    return {
        "service": service,
        "horizon": horizon,
        "impacted": impacted,
        "failed": sum(1 for x in impacted if x["failedAt"] is not None),
        "minAvailability": min(avail),
        "availability": avail,
        "revenueAtRisk": round(lost),
    }


def recommend(sim: Simulator, rca: dict) -> dict:
    strategies = generate(sim, rca)
    results = [evaluate(sim, s) for s in strategies]
    baseline = next(r for r in results if r["id"] == "baseline")
    for r in results:
        r["revenueSaved"] = max(0, baseline["revenueLost"] - r["revenueLost"])
    ranked = sorted(results, key=lambda r: -r["score"])
    best = ranked[0]
    return {
        "tick": sim.tick,
        "horizon": HORIZON,
        "rootCause": (rca.get("candidates") or [None])[0],
        "strategies": ranked,
        "recommended": best["id"],
        "baseline": baseline["id"],
        "summary": _summary(best, baseline),
    }


def _summary(best: dict, baseline: dict) -> str:
    if best["id"] == "baseline":
        return "No intervention outperforms letting the system settle on its own."
    if best["timeToRecover"] == 0 and best["peakFailed"] == 0:
        ttr = "prevents the outage entirely"
    elif best["timeToRecover"] is not None:
        ttr = f"recovers the platform in {best['timeToRecover']}s"
    else:
        ttr = "stabilises the platform"
    return (
        f"{best['name']} {ttr}, keeps availability at {best['availability'] * 100:.1f}% "
        f"(vs {baseline['availability'] * 100:.1f}% doing nothing) and protects "
        f"${best['revenueSaved']:,} of revenue over the next {HORIZON}s."
    )


def _prod(xs) -> float:
    p = 1.0
    for x in xs:
        p *= x
    return clamp(p)
