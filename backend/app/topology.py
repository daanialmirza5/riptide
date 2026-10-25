"""Service topology of the simulated production platform.

The graph is a DAG of caller -> callee edges. Each edge carries a criticality
weight in [0, 1]: how strongly a failure of the callee hurts the caller.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class ServiceSpec:
    id: str
    name: str
    kind: str  # edge | app | data | external
    tier: int  # 0 = edge, 1 = application, 2 = data / infrastructure
    base_rps: float
    capacity: float  # requests/s one replica can serve comfortably
    replicas: int
    base_latency: float  # p99 latency in ms when healthy
    base_memory: float  # resting memory utilisation %
    importance: float  # business weight used for system-level scores
    version: str
    team: str
    description: str


SERVICES: list[ServiceSpec] = [
    ServiceSpec("cdn", "CDN Edge", "edge", 0, 2400, 1400, 3, 35, 30, 0.6, "edge-7.2", "platform", "Static assets and edge routing"),
    ServiceSpec("api-gateway", "API Gateway", "edge", 0, 1500, 600, 4, 60, 40, 1.0, "v3.8.0", "platform", "Public entry point, auth offload, routing"),
    ServiceSpec("auth", "Auth Service", "app", 1, 700, 380, 3, 45, 42, 0.9, "v2.1.4", "identity", "Sessions, tokens and permissions"),
    ServiceSpec("user-profile", "User Profile", "app", 1, 300, 260, 2, 70, 38, 0.4, "v1.9.2", "identity", "Profiles, addresses and preferences"),
    ServiceSpec("catalog", "Catalog", "app", 1, 650, 340, 3, 80, 46, 0.7, "v4.0.3", "commerce", "Product catalogue and pricing"),
    ServiceSpec("search", "Search", "app", 1, 420, 250, 3, 120, 50, 0.5, "v2.6.0", "discovery", "Full-text product search"),
    ServiceSpec("recommendation", "Recommendations", "app", 1, 260, 200, 2, 150, 55, 0.3, "v1.4.7", "discovery", "Personalised product ranking"),
    ServiceSpec("cart", "Cart", "app", 1, 380, 260, 2, 55, 40, 0.7, "v2.2.0", "commerce", "Shopping cart state"),
    ServiceSpec("checkout", "Checkout", "app", 1, 160, 120, 3, 140, 44, 1.0, "v2.4.0", "commerce", "Checkout orchestration"),
    ServiceSpec("payment", "Payment", "app", 1, 150, 110, 3, 180, 45, 1.0, "v5.3.1", "payments", "Payment authorisation and capture"),
    ServiceSpec("orders", "Orders", "app", 1, 170, 140, 2, 90, 41, 0.9, "v3.0.2", "fulfilment", "Order lifecycle"),
    ServiceSpec("inventory", "Inventory", "app", 1, 320, 220, 2, 65, 39, 0.8, "v1.8.5", "fulfilment", "Stock reservation"),
    ServiceSpec("shipping", "Shipping", "app", 1, 90, 90, 2, 110, 36, 0.5, "v1.2.9", "fulfilment", "Carrier quotes and labels"),
    ServiceSpec("notification", "Notifications", "app", 1, 120, 120, 2, 95, 35, 0.3, "v1.6.1", "engagement", "Email, SMS and push"),
    ServiceSpec("postgres-primary", "Postgres Primary", "data", 2, 1100, 950, 2, 25, 58, 1.0, "pg-16.2", "data", "Primary OLTP database"),
    ServiceSpec("postgres-replica", "Postgres Replica", "data", 2, 800, 600, 2, 22, 52, 0.6, "pg-16.2", "data", "Read replica"),
    ServiceSpec("redis-cache", "Redis Cache", "data", 2, 2200, 1500, 2, 8, 48, 0.8, "redis-7.2", "data", "Session and hot-object cache"),
    ServiceSpec("kafka", "Kafka", "data", 2, 900, 650, 3, 30, 54, 0.7, "kafka-3.7", "data", "Event streaming backbone"),
    ServiceSpec("elasticsearch", "Elasticsearch", "data", 2, 450, 300, 3, 70, 60, 0.5, "es-8.13", "data", "Search index cluster"),
    ServiceSpec("payment-provider", "Payment Provider", "external", 2, 140, 400, 1, 260, 20, 0.9, "ext", "payments", "Third-party card processor"),
]

# (caller, callee, criticality)
DEPENDENCIES: list[tuple[str, str, float]] = [
    ("cdn", "api-gateway", 0.7),
    ("api-gateway", "auth", 0.9),
    ("api-gateway", "catalog", 0.6),
    ("api-gateway", "search", 0.4),
    ("api-gateway", "cart", 0.6),
    ("api-gateway", "checkout", 0.8),
    ("api-gateway", "user-profile", 0.4),
    ("api-gateway", "recommendation", 0.2),
    ("auth", "redis-cache", 0.7),
    ("auth", "postgres-primary", 0.8),
    ("user-profile", "postgres-replica", 0.7),
    ("user-profile", "redis-cache", 0.5),
    ("catalog", "postgres-replica", 0.8),
    ("catalog", "redis-cache", 0.6),
    ("search", "elasticsearch", 0.9),
    ("recommendation", "redis-cache", 0.5),
    ("recommendation", "kafka", 0.3),
    ("recommendation", "catalog", 0.4),
    ("cart", "redis-cache", 0.9),
    ("cart", "inventory", 0.4),
    ("checkout", "cart", 0.7),
    ("checkout", "payment", 0.95),
    ("checkout", "inventory", 0.8),
    ("checkout", "orders", 0.9),
    ("payment", "payment-provider", 0.9),
    ("payment", "postgres-primary", 0.8),
    ("payment", "kafka", 0.4),
    ("orders", "postgres-primary", 0.9),
    ("orders", "kafka", 0.7),
    ("inventory", "postgres-primary", 0.8),
    ("inventory", "redis-cache", 0.4),
    ("shipping", "kafka", 0.8),
    ("shipping", "orders", 0.4),
    ("notification", "kafka", 0.9),
    ("postgres-replica", "postgres-primary", 0.5),
    ("elasticsearch", "kafka", 0.2),
]

# When a cache degrades, its read traffic falls through to these stores.
CACHE_FALLBACK: dict[str, list[str]] = {"redis-cache": ["postgres-primary", "postgres-replica"]}

SPEC_BY_ID: dict[str, ServiceSpec] = {s.id: s for s in SERVICES}


@lru_cache(maxsize=1)
def deps_of() -> dict[str, list[tuple[str, float]]]:
    out: dict[str, list[tuple[str, float]]] = {s.id: [] for s in SERVICES}
    for caller, callee, w in DEPENDENCIES:
        out[caller].append((callee, w))
    return out


@lru_cache(maxsize=1)
def callers_of() -> dict[str, list[tuple[str, float]]]:
    out: dict[str, list[tuple[str, float]]] = {s.id: [] for s in SERVICES}
    for caller, callee, w in DEPENDENCIES:
        out[callee].append((caller, w))
    return out


@lru_cache(maxsize=1)
def topo_order() -> list[str]:
    """Callees before callers, so dependency risk is known before it is consumed."""
    deps = deps_of()
    seen: set[str] = set()
    order: list[str] = []

    def visit(n: str, stack: frozenset[str]) -> None:
        if n in seen:
            return
        if n in stack:
            raise ValueError(f"dependency cycle through {n}")
        for d, _ in deps[n]:
            visit(d, stack | {n})
        seen.add(n)
        order.append(n)

    for s in SERVICES:
        visit(s.id, frozenset())
    return order


def ancestors(service: str) -> set[str]:
    """Every service that transitively depends on `service`."""
    callers = callers_of()
    out: set[str] = set()
    stack = [service]
    while stack:
        for c, _ in callers[stack.pop()]:
            if c not in out:
                out.add(c)
                stack.append(c)
    return out


def descendants(service: str) -> set[str]:
    deps = deps_of()
    out: set[str] = set()
    stack = [service]
    while stack:
        for d, _ in deps[stack.pop()]:
            if d not in out:
                out.add(d)
                stack.append(d)
    return out


def topology_payload() -> dict:
    return {
        "services": [
            {
                "id": s.id,
                "name": s.name,
                "kind": s.kind,
                "tier": s.tier,
                "team": s.team,
                "importance": s.importance,
                "description": s.description,
                "baseLatency": s.base_latency,
                "baseRps": s.base_rps,
            }
            for s in SERVICES
        ],
        "edges": [{"source": a, "target": b, "weight": w} for a, b, w in DEPENDENCIES],
    }
