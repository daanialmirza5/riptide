"""End-to-end behavioural tests of the twin, predictor, RCA and recovery lab."""
import pytest

from app.engine import Engine
from app.logparse import analyse_logs
from app.scenarios import SCENARIOS
from app.topology import topo_order

EXPECTED_ROOT = {s["id"]: s["expected"] for s in SCENARIOS}


def run(engine: Engine, ticks: int) -> None:
    for _ in range(ticks):
        engine.advance()


def test_topology_is_dag():
    assert len(topo_order()) == 20


def test_healthy_platform_raises_no_incident():
    e = Engine(seed=3)
    run(e, 240)
    assert e.incidents.incidents == []
    assert all(s.status == "healthy" for s in e.sim.services.values())
    assert e.forecast["crashProbability"] < 0.2


@pytest.mark.parametrize("scenario", [s["id"] for s in SCENARIOS])
def test_scenario_detected_and_diagnosed(scenario):
    e = Engine(seed=11)
    run(e, 20)
    e.inject(scenario)
    root, hyp = EXPECTED_ROOT[scenario]
    diagnosed = False
    for _ in range(150):
        e.advance()
        c = e.rca.get("candidates")
        if c and c[0]["hypothesis"] == hyp and (root is None or c[0]["service"] == root):
            diagnosed = True
            break
    assert diagnosed, f"{scenario}: got {[(x['service'], x['hypothesis']) for x in e.rca.get('candidates', [])]}"
    assert e.incidents.current is not None


@pytest.mark.parametrize("scenario", [s["id"] for s in SCENARIOS])
def test_recommended_strategy_beats_doing_nothing(scenario):
    e = Engine(seed=5)
    run(e, 20)
    e.inject(scenario)
    run(e, 45)
    rec = e.recommend()
    best = rec["strategies"][0]
    base = next(s for s in rec["strategies"] if s["id"] == "baseline")
    assert best["id"] != "baseline", scenario
    assert best["availability"] >= base["availability"]
    assert best["score"] > base["score"]


def test_memory_leak_failure_is_predicted_ahead_of_time():
    e = Engine(seed=21)
    run(e, 20)
    e.inject("payment-memory-leak")
    run(e, 200)
    stats = e.incidents.stats()
    assert stats["predictedFailures"] >= 1
    assert stats["avgLeadTime"] and stats["avgLeadTime"] > 10


def test_early_remediation_counts_prevented_failures():
    e = Engine(seed=4)
    run(e, 20)
    e.inject("payment-memory-leak")
    run(e, 55)
    rec = e.recommend()
    assert rec["strategies"][0]["steps"][0]["action"] == "rollback"
    e.apply_strategy(rec["recommended"])
    run(e, 120)
    assert e.incidents.stats()["failuresPrevented"] >= 1


def test_applying_recommendation_resolves_incident():
    e = Engine(seed=8)
    run(e, 20)
    e.inject("payment-memory-leak")
    run(e, 50)
    rec = e.recommend()
    e.apply_strategy(rec["recommended"])
    run(e, 160)
    assert e.incidents.current is None
    assert e.incidents.incidents[0].status == "resolved"
    assert e.incidents.incidents[0].root_cause["service"] == "payment"


def test_diagnosis_survives_recovery_noise():
    e = Engine(seed=13)
    run(e, 20)
    e.inject("cache-stampede")
    run(e, 40)
    e.apply_strategy(e.recommend()["recommended"])
    run(e, 150)
    inc = e.incidents.incidents[0]
    assert inc.status == "resolved"
    assert inc.root_cause["service"] == "redis-cache"


@pytest.mark.parametrize("scenario", [s["id"] for s in SCENARIOS])
def test_autopilot_heals_without_a_human(scenario):
    e = Engine(seed=17)
    e.autopilot = True
    run(e, 20)
    e.inject(scenario)
    run(e, 260)
    assert e.autopilot_log, f"{scenario}: autopilot never acted"
    assert e.incidents.current is None, f"{scenario}: incident still open"
    assert e.incidents.incidents[0].status == "resolved"


def test_autopilot_stays_idle_when_healthy():
    e = Engine(seed=2)
    e.autopilot = True
    run(e, 200)
    assert e.autopilot_log == [] and e.sim.actions == []


def test_whatif_blast_radius_follows_dependencies():
    e = Engine(seed=1)
    out = e.whatif("postgres-primary")
    hit = {x["service"] for x in out["impacted"] if x["failedAt"] is not None}
    assert {"postgres-primary", "orders", "payment"} <= hit
    assert out["minAvailability"] < 0.9
    leaf = e.whatif("notification")
    assert all(x["service"] in ("notification",) for x in leaf["impacted"] if x["failedAt"] is not None)
    # the live twin is untouched by what-if runs
    assert all(s.status == "healthy" for s in e.sim.services.values())


def test_log_analyzer_finds_root():
    from app.simulator import Simulator

    sim = Simulator(seed=7)
    for _ in range(30):
        sim.step()
    sim.inject_fault("pool_exhaustion", "postgres-primary")
    for _ in range(160):
        sim.step()
    text = "\n".join(f"{l['ts']} {l['level']} [{l['service']}] {l['message']}" for l in sim.logs)
    out = analyse_logs(text)
    assert out["linesParsed"] > 100
    assert out["rootCause"]["service"] == "postgres-primary"
