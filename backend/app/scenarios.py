"""Curated chaos scenarios. Each is a list of faults to inject into the twin."""
from __future__ import annotations

SCENARIOS: list[dict] = [
    {
        "id": "payment-memory-leak",
        "expected": ("payment", "memory_leak"),
        "name": "Payment memory leak",
        "summary": "Release v5.4.0 of Payment leaks heap on every capture. OOM in ~90s, then checkout and the gateway follow.",
        "category": "Application",
        "severity": "high",
        "faults": [("memory_leak", "payment", 1.0)],
    },
    {
        "id": "db-pool-exhaustion",
        "expected": ("postgres-primary", "pool_exhaustion"),
        "name": "Database pool exhaustion",
        "summary": "A connection leak slowly drains Postgres primary's pool, starving auth, orders, inventory and payment.",
        "category": "Data",
        "severity": "critical",
        "faults": [("pool_exhaustion", "postgres-primary", 1.0)],
    },
    {
        "id": "cache-stampede",
        "expected": ("redis-cache", "cache_failure"),
        "name": "Cache node failure",
        "summary": "Redis primary fails. Every cache miss falls through to Postgres, which buckles under the read storm.",
        "category": "Data",
        "severity": "critical",
        "faults": [("cache_failure", "redis-cache", 1.0)],
    },
    {
        "id": "bad-deploy-checkout",
        "expected": ("checkout", "bad_deploy"),
        "name": "Faulty checkout release",
        "summary": "Checkout v2.5.0 ships a serialization bug — a step change in 5xx errors right after deploy.",
        "category": "Change",
        "severity": "medium",
        "faults": [("bad_deploy", "checkout", 1.0)],
    },
    {
        "id": "flash-sale",
        "expected": ("api-gateway", "overload"),
        "name": "Flash-sale traffic surge",
        "summary": "Traffic climbs to 2.1x in 45s. Gateway, auth and catalog saturate; retries amplify the load.",
        "category": "Traffic",
        "severity": "high",
        "faults": [("traffic_surge", "api-gateway", 1.0)],
    },
    {
        "id": "provider-outage",
        "expected": ("payment-provider", "provider_degradation"),
        "name": "Payment provider brown-out",
        "summary": "The third-party card processor slows to 13x latency, tying up payment workers and checkout.",
        "category": "External",
        "severity": "high",
        "faults": [("provider_outage", "payment-provider", 1.0)],
    },
    {
        "id": "kafka-stall",
        "expected": ("kafka", "broker_backlog"),
        "name": "Kafka partition stall",
        "summary": "A broker stalls; consumer lag grows until orders, shipping and notifications back up.",
        "category": "Data",
        "severity": "medium",
        "faults": [("broker_degradation", "kafka", 1.0)],
    },
]

SCENARIO_BY_ID = {s["id"]: s for s in SCENARIOS}


def public(s: dict) -> dict:
    return {k: v for k, v in s.items() if k not in ("faults", "expected")} | {
        "targets": sorted({t for _, t, _ in s["faults"]}),
    }
