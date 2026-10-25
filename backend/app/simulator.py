"""Digital twin of the production platform.

One tick == one second of simulated time. Every tick the simulator derives
per-service metrics from traffic, capacity, injected faults, active remediation
actions and the health of each service's dependencies *on the previous tick*.
That one-tick lag is what makes failures ripple outward as a visible cascade.
"""
from __future__ import annotations

import copy
import math
import random
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from .topology import CACHE_FALLBACK, SERVICES, SPEC_BY_ID, callers_of, deps_of

STATUS_ORDER = {"healthy": 0, "degraded": 1, "critical": 2, "down": 3}


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if x < lo else hi if x > hi else x


def status_for(health: float) -> str:
    if health >= 0.8:
        return "healthy"
    if health >= 0.55:
        return "degraded"
    if health >= 0.25:
        return "critical"
    return "down"


@dataclass
class ServiceState:
    id: str
    replicas: int
    version: str
    rps: float = 0.0
    cpu: float = 0.0
    memory: float = 0.0
    latency: float = 0.0
    error_rate: float = 0.0
    saturation: float = 0.0
    health: float = 1.0
    status: str = "healthy"
    # internal accumulators
    leak_offset: float = 0.0
    saturation_offset: float = 0.0
    down_ticks: int = 0
    capacity_factor: float = 1.0
    crashes: int = 0


@dataclass
class Fault:
    id: str
    kind: str
    target: str
    started: int
    rate: float = 1.0
    progress: float = 0.0
    label: str = ""


@dataclass
class Action:
    id: str
    kind: str
    target: str
    started: int
    duration: int
    label: str
    done: bool = False


FAULT_KINDS = {
    "memory_leak": "Memory leak",
    "bad_deploy": "Faulty deployment",
    "pool_exhaustion": "Connection pool leak",
    "cache_failure": "Cache node failure",
    "traffic_surge": "Traffic surge",
    "broker_degradation": "Broker degradation",
    "provider_outage": "Provider outage",
}

ACTION_KINDS = {
    "restart": ("Rolling restart", 5),
    "rollback": ("Roll back release", 7),
    "scale_out": ("Scale out +2 replicas", 6),
    "circuit_breaker": ("Enable circuit breaker", 1),
    "failover": ("Fail over to replica", 7),
    "rate_limit": ("Adaptive rate limiting", 2),
    "switch_provider": ("Switch to backup provider", 4),
    "rebalance": ("Rebalance partitions", 8),
}

# Which actions permanently clear which fault kinds once they complete.
ACTION_FIXES = {
    "rollback": {"bad_deploy", "memory_leak"},
    "failover": {"pool_exhaustion"},
    "switch_provider": {"provider_outage"},
    "rebalance": {"broker_degradation"},
    "restart": {"cache_failure"},
}


class Simulator:
    def __init__(self, seed: int = 42, emit_logs: bool = True) -> None:
        self.seed = seed
        self.rng = random.Random(seed)
        self.tick = 0
        self.epoch = datetime.now(timezone.utc).replace(microsecond=0)
        self.services: dict[str, ServiceState] = {
            s.id: ServiceState(id=s.id, replicas=s.replicas, version=s.version) for s in SERVICES
        }
        self.faults: list[Fault] = []
        self.actions: list[Action] = []
        self.breakers: set[str] = set()
        self.rate_limit: float | None = None
        self.shed_fraction = 0.0
        self.demand = 1.0
        self.emit_logs = emit_logs
        self.logs: deque[dict] = deque(maxlen=4000)
        self.events: list[dict] = []  # deploys, chaos, actions — change events for RCA
        self._log_seq = 0
        self._id_seq = 0
        for _ in range(3):
            self.step()

    # ------------------------------------------------------------------ utils
    def _next_id(self, prefix: str) -> str:
        self._id_seq += 1
        return f"{prefix}-{self._id_seq:04d}"

    def timestamp(self, tick: int | None = None) -> str:
        return (self.epoch + timedelta(seconds=self.tick if tick is None else tick)).isoformat()

    def fork(self) -> "Simulator":
        """Deep copy for counterfactual what-if runs, without the log buffer."""
        logs, self.logs = self.logs, deque(maxlen=1)
        try:
            twin = copy.deepcopy(self)
        finally:
            self.logs = logs
        twin.emit_logs = False
        twin.rng = random.Random(self.seed * 7919 + self.tick)
        return twin

    def event(self, kind: str, service: str | None, message: str, **extra) -> dict:
        ev = {"tick": self.tick, "ts": self.timestamp(), "kind": kind, "service": service, "message": message, **extra}
        self.events.append(ev)
        if len(self.events) > 300:
            self.events = self.events[-300:]
        return ev

    def log(self, service: str, level: str, message: str) -> None:
        if not self.emit_logs:
            return
        self._log_seq += 1
        self.logs.append(
            {
                "id": self._log_seq,
                "tick": self.tick,
                "ts": self.timestamp(),
                "service": service,
                "level": level,
                "message": message,
                "traceId": f"{self.rng.getrandbits(48):012x}",
            }
        )

    # ------------------------------------------------------------- mutations
    def inject_fault(self, kind: str, target: str, rate: float = 1.0) -> Fault:
        if kind not in FAULT_KINDS:
            raise ValueError(f"unknown fault kind {kind}")
        if target not in self.services:
            raise ValueError(f"unknown service {target}")
        fault = Fault(self._next_id("F"), kind, target, self.tick, rate, label=FAULT_KINDS[kind])
        self.faults.append(fault)
        if kind in ("bad_deploy", "memory_leak"):  # both arrive with a release
            svc = self.services[target]
            new_version = _bump(svc.version)
            self.event("deploy", target, f"Deployed {target} {new_version} (was {svc.version})", version=new_version)
            self.log(target, "INFO", f"Deployment complete: {target} {new_version} rolled out to {svc.replicas} pods")
            svc.version = new_version
        return fault

    def apply_action(self, kind: str, target: str) -> Action:
        if kind not in ACTION_KINDS:
            raise ValueError(f"unknown action {kind}")
        if target not in self.services:
            raise ValueError(f"unknown service {target}")
        label, duration = ACTION_KINDS[kind]
        action = Action(self._next_id("A"), kind, target, self.tick, duration, f"{label}: {target}")
        self.actions.append(action)
        self.event("action", target, action.label, action=kind)
        self.log(target, "INFO", f"Remediation started: {label.lower()} on {target}")
        if kind == "circuit_breaker":
            self.breakers.add(target)
        if kind == "rate_limit":
            self.rate_limit = 1.35
        return action

    # ------------------------------------------------------------------ step
    def step(self) -> None:
        self.tick += 1
        rng = self.rng
        # Minor jitter is absorbed by timeouts and retries; only real degradation propagates.
        deficit = {k: clamp((0.9 - s.health) / 0.9) for k, s in self.services.items()}

        self._advance_actions()
        for f in self.faults:
            f.progress += f.rate

        # --- global demand: gentle diurnal wave, noise, and any surge faults
        surge = 1.0
        for f in self.faults:
            if f.kind == "traffic_surge":
                surge *= 1.0 + 1.1 * clamp(f.progress / 45.0)
        self.demand = (1.0 + 0.06 * math.sin(self.tick / 75.0)) * surge * (1 + rng.gauss(0, 0.015))
        admitted = self.demand
        self.shed_fraction = 0.0
        if self.rate_limit is not None and self.demand > self.rate_limit:
            admitted = self.rate_limit
            self.shed_fraction = 1.0 - admitted / self.demand

        deps = deps_of()
        callers = callers_of()
        fault_by_target: dict[str, list[Fault]] = {}
        for f in self.faults:
            fault_by_target.setdefault(f.target, []).append(f)

        for spec in SERVICES:
            s = self.services[spec.id]
            faults = fault_by_target.get(spec.id, [])

            # ---- load: admitted demand, retry storms from struggling callers, cache fall-through
            rps = spec.base_rps * (admitted if spec.kind != "external" else admitted * 0.95)
            if callers[spec.id]:
                rps *= 1.0 + 0.4 * deficit[spec.id]  # callers retry failed requests
            for cache, stores in CACHE_FALLBACK.items():
                if spec.id in stores:
                    rps *= 1.0 + 1.4 * deficit[cache]
            s.rps = rps * (1 + rng.gauss(0, 0.02))

            capacity = spec.capacity * s.replicas * s.capacity_factor
            util = s.rps / max(capacity, 1.0)

            # ---- dependency impact (noisy-OR over unhealthy callees)
            survive = 1.0
            for dep, w in deps[spec.id]:
                hit = w * deficit[dep]
                if dep in self.breakers:
                    hit *= 0.22
                survive *= 1.0 - clamp(hit)
            dep_impact = 1.0 - survive

            cpu = 10 + 68 * util + rng.gauss(0, 1.5)
            memory = spec.base_memory + 7 * util + s.leak_offset + rng.gauss(0, 0.6)
            latency = spec.base_latency * (1 + 1.6 * util**3) * (1 + rng.gauss(0, 0.04))
            if util > 1:
                latency *= 1 + (util - 1) * 3
            latency += spec.base_latency * 7 * dep_impact
            error = 0.15 + abs(rng.gauss(0, 0.08)) + 48 * dep_impact**1.25 + max(0.0, util - 1.05) * 30
            saturation = 18 + 52 * min(util, 1.6) + s.saturation_offset + rng.gauss(0, 1.0)

            # ---- injected faults
            for f in faults:
                p = f.progress
                if f.kind == "memory_leak":
                    s.leak_offset += 0.5 * f.rate
                elif f.kind == "bad_deploy":
                    error += 11 + 3 * math.sin(self.tick / 4) + abs(rng.gauss(0, 1.5))
                    latency *= 1.9
                    cpu += 9
                elif f.kind == "pool_exhaustion":
                    s.saturation_offset += 0.45 * f.rate
                elif f.kind == "cache_failure":
                    ramp = clamp(p / 18.0)
                    error += 62 * ramp
                    latency += spec.base_latency * 25 * ramp
                elif f.kind == "broker_degradation":
                    s.saturation_offset += 0.6 * f.rate
                elif f.kind == "provider_outage":
                    ramp = clamp(p / 25.0)
                    latency *= 1 + 13 * ramp
                    error += 42 * ramp

            # ---- non-linear resource effects
            if memory > 88:  # GC thrash
                latency *= 1 + (memory - 88) / 3.5
                error += (memory - 88) * 1.4
                cpu += (memory - 88) * 2
            if saturation > 90:  # pool / queue exhausted: requests wait then time out
                latency *= 1 + (saturation - 90) / 2.5
                error += (saturation - 90) * 2.6

            if s.down_ticks > 0:
                s.down_ticks -= 1
                cpu, memory, latency, error, saturation = 3.0, spec.base_memory * 0.4, 0.0, 100.0, 0.0
            elif memory >= 99.5:
                s.crashes += 1
                s.down_ticks = 6
                s.leak_offset = 0.0
                self.log(spec.id, "FATAL", "java.lang.OutOfMemoryError: Java heap space — pod terminated (exit 137)")
                self.event("crash", spec.id, f"{spec.id} crashed: OOMKilled")
                cpu, memory, latency, error, saturation = 3.0, spec.base_memory * 0.4, 0.0, 100.0, 0.0

            s.cpu = clamp(cpu, 0, 100)
            s.memory = clamp(memory, 0, 100)
            s.latency = max(0.0, latency)
            s.error_rate = clamp(error, 0, 100)
            s.saturation = clamp(saturation, 0, 100)
            s.health = self._health(spec, s)
            s.status = status_for(s.health)

        if self.emit_logs:
            self._emit_logs()

    def _health(self, spec, s: ServiceState) -> float:
        if s.down_ticks > 0 or s.error_rate >= 99.9:
            return 0.0
        err_p = clamp(s.error_rate / 35.0)
        lat_p = clamp((s.latency / spec.base_latency - 1.6) / 10.0)
        cpu_p = clamp((s.cpu - 82) / 18.0)
        mem_p = clamp((s.memory - 85) / 14.0)
        sat_p = clamp((s.saturation - 85) / 15.0)
        parts = [err_p, lat_p, cpu_p, mem_p, sat_p]
        penalty = 0.8 * max(parts) + 0.2 * sum(parts) / len(parts)
        return round(clamp(1.0 - penalty), 4)

    def _advance_actions(self) -> None:
        for a in self.actions:
            if a.done:
                continue
            elapsed = self.tick - a.started
            s = self.services[a.target]
            if a.kind in ("restart", "rollback"):
                s.capacity_factor = 0.55 if elapsed < a.duration else 1.0
            if a.kind == "failover" and elapsed < a.duration:
                s.capacity_factor = 0.6
            if elapsed < a.duration:
                continue
            a.done = True
            s.capacity_factor = 1.0
            fixes = ACTION_FIXES.get(a.kind, set())
            cleared = [f for f in self.faults if f.target == a.target and f.kind in fixes]
            self.faults = [f for f in self.faults if f not in cleared]
            if a.kind == "restart":
                s.leak_offset = 0.0
                s.saturation_offset *= 0.25
                s.down_ticks = 0
            elif a.kind == "rollback":
                s.leak_offset = 0.0
                s.version = SPEC_BY_ID[a.target].version
            elif a.kind in ("failover", "rebalance"):
                s.saturation_offset = 0.0
            elif a.kind == "scale_out":
                s.replicas += 2
            self.log(a.target, "INFO", f"Remediation complete: {a.label}")
            self.event("action_done", a.target, f"Completed: {a.label}")

    # ----------------------------------------------------------------- logs
    def _emit_logs(self) -> None:
        rng = self.rng
        deps = deps_of()
        for spec in SERVICES:
            s = self.services[spec.id]
            if s.down_ticks > 0:
                if rng.random() < 0.5:
                    self.log(spec.id, "ERROR", f"Readiness probe failed: HTTP 503 — pod restarting (restartCount={s.crashes})")
                continue
            if rng.random() < 0.035:
                self.log(spec.id, "INFO", rng.choice(_INFO_LINES).format(rps=int(s.rps), lat=int(s.latency)))
            if s.memory > 82 and rng.random() < 0.25 + (s.memory - 82) / 30:
                pause = int(40 + (s.memory - 80) ** 2 * 3)
                lvl = "ERROR" if s.memory > 93 else "WARN"
                self.log(spec.id, lvl, f"GC pause {pause}ms (G1 Evacuation) heap={s.memory:.0f}% of 2048MB")
            if s.saturation > 80 and rng.random() < 0.3:
                if spec.id.startswith("postgres"):
                    self.log(spec.id, "WARN" if s.saturation < 94 else "ERROR",
                             f"remaining connection slots are reserved — active={int(s.saturation * 2)}/200")
                elif spec.id == "kafka":
                    self.log(spec.id, "WARN" if s.saturation < 94 else "ERROR",
                             f"Consumer group order-processors lag={int((s.saturation - 60) * 4200)} on topic orders.v1")
                else:
                    self.log(spec.id, "WARN", f"Worker queue depth high: {int(s.saturation * 12)} pending tasks")
            if s.error_rate > 4 and rng.random() < clamp(s.error_rate / 40, 0.15, 0.85):
                bad = [d for d, _ in deps[spec.id] if self.services[d].health < 0.75]
                if bad:
                    d = rng.choice(bad)
                    msg = rng.choice(_UPSTREAM_ERRORS).format(dep=d, ms=int(self.services[d].latency) + 1000)
                else:
                    msg = rng.choice(_LOCAL_ERRORS.get(spec.kind, _LOCAL_ERRORS["app"]))
                self.log(spec.id, "ERROR", msg)
            elif s.latency > spec.base_latency * 3 and rng.random() < 0.3:
                self.log(spec.id, "WARN", f"Slow request p99={int(s.latency)}ms exceeds SLO {int(spec.base_latency * 2)}ms")
            if s.cpu > 88 and rng.random() < 0.2:
                self.log(spec.id, "WARN", f"CPU throttling detected: {s.cpu:.0f}% of limit, {s.replicas} replicas")
        if self.shed_fraction > 0.02 and rng.random() < 0.4:
            self.log("api-gateway", "WARN", f"Rate limiter shedding {self.shed_fraction * 100:.1f}% of requests (429)")

    # ------------------------------------------------------------- snapshot
    def availability(self) -> float:
        """Share of user requests that succeed end-to-end through the gateway."""
        gw = self.services["api-gateway"]
        return clamp((1 - self.shed_fraction) * (1 - gw.error_rate / 100))

    def system_health(self) -> float:
        total = sum(s.importance for s in SERVICES)
        return sum(self.services[s.id].health * s.importance for s in SERVICES) / total


def _bump(version: str) -> str:
    if version.startswith("v"):
        parts = version[1:].split(".")
        if len(parts) == 3 and all(p.isdigit() for p in parts):
            return f"v{parts[0]}.{int(parts[1]) + 1}.0"
    return version + "-next"


_INFO_LINES = [
    "Handled {rps} req/s, p99={lat}ms",
    "Health check OK",
    "Config reloaded from configmap",
    "Connection pool stats: idle=12 active=8",
    "Cache hit ratio 0.94",
]

_UPSTREAM_ERRORS = [
    "upstream request to {dep} timed out after {ms}ms",
    "upstream connect error or disconnect/reset before headers — {dep}",
    "Circuit {dep} half-open: call failed, retrying (attempt 3/3)",
    "HTTP 503 from {dep}: service unavailable",
]

_LOCAL_ERRORS = {
    "app": [
        "Unhandled exception in request handler: NullPointerException at OrderMapper.java:118",
        "Request failed with 500: internal error",
        "Deadline exceeded while processing request",
    ],
    "edge": ["502 Bad Gateway returned to client", "Upstream cluster overflow — request rejected"],
    "data": ["Query cancelled: statement timeout", "Replication lag exceeded 10s", "Connection refused"],
    "external": ["Provider returned 504 Gateway Timeout", "TLS handshake timeout to provider endpoint"],
}
