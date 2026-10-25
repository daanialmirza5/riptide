"""Offline evaluation of the full pipeline against labelled chaos scenarios.

Every run uses a fresh, independent digital twin (never the live one), injects
a scenario, and measures what Riptide actually achieved from metrics and logs
alone: time to detect, time to a correct diagnosis, warning lead time before the
first real failure, and the availability its recommended fix preserves versus
doing nothing.
"""
from __future__ import annotations

import time

from . import recovery
from .engine import Engine
from .scenarios import SCENARIOS

SEEDS = (3, 11, 29)
MAX_TICKS = 180
QUIET_TICKS = 300


def _run(scenario: dict, seed: int) -> dict:
    e = Engine(seed=seed)
    for _ in range(20):
        e.advance()
    e.inject(scenario["id"])
    t0 = e.sim.tick
    root, hyp = scenario["expected"]
    detect = diagnose = warn = first_fail = None
    rec = None
    for _ in range(MAX_TICKS):
        e.advance()
        t = e.sim.tick - t0
        failing = any(s.status in ("critical", "down") for s in e.sim.services.values())
        if detect is None and e.incidents.current is not None:
            detect = t
        if warn is None and not failing and e.forecast["wavefront"]:
            warn = t
        if first_fail is None and failing:
            first_fail = t
        top = (e.rca.get("candidates") or [None])[0]
        if diagnose is None and top and top["service"] == root and top["hypothesis"] == hyp:
            diagnose = t
            rec = recovery.recommend(e.sim, e.rca)
        # keep the twin running unattended to see when the first real failure lands
        if diagnose is not None and first_fail is not None:
            break
    best = base = None
    if rec:
        best = rec["strategies"][0]
        base = next(s for s in rec["strategies"] if s["id"] == "baseline")
    return {
        "seed": seed,
        "detected": detect is not None,
        "diagnosed": diagnose is not None,
        "timeToDetect": detect,
        "timeToDiagnose": diagnose,
        "diagnosedBeforeFailure": diagnose is not None and (first_fail is None or diagnose <= first_fail),
        "leadTime": _lead(first_fail, warn, diagnose),
        "failedUnattended": first_fail is not None,
        "strategy": best["name"] if best else None,
        "availabilityWith": best["availability"] if best else None,
        "availabilityWithout": base["availability"] if base else None,
        "servicesLostWith": best["peakFailed"] if best else None,
        "servicesLostWithout": base["peakFailed"] if base else None,
        "revenueSaved": best["revenueSaved"] if best else 0,
    }


def _lead(first_fail: int | None, warn: int | None, diagnose: int | None) -> int | None:
    """Seconds of warning before the first failure: earliest of forecast or diagnosis."""
    signals = [x for x in (warn, diagnose) if x is not None]
    if first_fail is None or not signals or min(signals) >= first_fail:
        return None
    return first_fail - min(signals)


def _mean(xs: list) -> float | None:
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 2) if xs else None


def run_benchmark() -> dict:
    started = time.perf_counter()
    rows = []
    for sc in SCENARIOS:
        runs = [_run(sc, seed) for seed in SEEDS]
        rows.append(
            {
                "scenario": sc["id"],
                "name": sc["name"],
                "expected": {"service": sc["expected"][0], "hypothesis": sc["expected"][1]},
                "runs": runs,
                "diagnosisRate": sum(r["diagnosed"] for r in runs) / len(runs),
                "timeToDetect": _mean([r["timeToDetect"] for r in runs]),
                "timeToDiagnose": _mean([r["timeToDiagnose"] for r in runs]),
                "earlyDiagnosisRate": sum(r["diagnosedBeforeFailure"] for r in runs) / len(runs),
                "availabilityWith": _mean([r["availabilityWith"] for r in runs]),
                "availabilityWithout": _mean([r["availabilityWithout"] for r in runs]),
                "servicesLostWith": _mean([r["servicesLostWith"] for r in runs]),
                "servicesLostWithout": _mean([r["servicesLostWithout"] for r in runs]),
                "revenueSaved": round(sum(r["revenueSaved"] for r in runs) / len(runs)),
                "strategy": max({r["strategy"] for r in runs if r["strategy"]}, default=None,
                                key=lambda n: sum(r["strategy"] == n for r in runs)),
            }
        )

    # false-alarm check: healthy platforms must stay quiet
    false_alarms = 0
    for seed in SEEDS:
        e = Engine(seed=seed)
        for _ in range(QUIET_TICKS):
            e.advance()
        false_alarms += len(e.incidents.incidents)

    all_runs = [r for row in rows for r in row["runs"]]
    return {
        "scenarios": rows,
        "summary": {
            "runs": len(all_runs),
            "diagnosisAccuracy": round(sum(r["diagnosed"] for r in all_runs) / len(all_runs), 4),
            "earlyDiagnosisRate": round(sum(r["diagnosedBeforeFailure"] for r in all_runs) / len(all_runs), 4),
            "meanTimeToDetect": _mean([r["timeToDetect"] for r in all_runs]),
            "meanTimeToDiagnose": _mean([r["timeToDiagnose"] for r in all_runs]),
            "meanLeadTime": _mean([r["leadTime"] for r in all_runs]),
            "availabilityWith": _mean([r["availabilityWith"] for r in all_runs]),
            "availabilityWithout": _mean([r["availabilityWithout"] for r in all_runs]),
            "revenueSavedPerIncident": round(sum(r["revenueSaved"] for r in all_runs) / len(all_runs)),
            "falseAlarms": false_alarms,
            "quietSeconds": QUIET_TICKS * len(SEEDS),
        },
        "seeds": list(SEEDS),
        "elapsed": round(time.perf_counter() - started, 2),
    }
