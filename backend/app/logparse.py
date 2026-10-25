"""Bring-your-own-logs analyzer.

Parses arbitrary service logs, infers the dependency graph from upstream
mentions, detects failure precursor patterns, and ranks services by failure
risk and root-cause likelihood.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import datetime, timezone

LEVELS = {"TRACE": 0, "DEBUG": 0, "INFO": 1, "NOTICE": 1, "WARN": 2, "WARNING": 2, "ERROR": 3, "ERR": 3, "FATAL": 4, "CRITICAL": 4, "PANIC": 4}

TS_RE = re.compile(r"(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})")
LEVEL_RE = re.compile(r"\b(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL|PANIC)\b", re.I)
SERVICE_RES = [
    re.compile(r"\[([a-z][\w.-]{1,40})\]", re.I),
    re.compile(r"\b(?:service|svc|app|component)[=:]\s*\"?([a-z][\w.-]{1,40})", re.I),
]
UPSTREAM_RE = re.compile(
    r"(?:upstream(?: request)? to|upstream connect error.*?—|from|calling|call to|Circuit|connect(?:ion)? to)\s+([a-z][\w-]{2,40})",
    re.I,
)

PATTERNS: list[tuple[str, str, re.Pattern, float]] = [
    ("memory", "Memory pressure / leak", re.compile(r"OutOfMemory|OOM|heap|GC pause|memory", re.I), 0.9),
    ("pool", "Connection pool exhaustion", re.compile(r"connection slots|pool.*(exhaust|timeout|not available)|too many connections", re.I), 0.85),
    ("timeout", "Timeouts / latency", re.compile(r"timed? ?out|deadline exceeded|slow request|p99", re.I), 0.6),
    ("dependency", "Dependency unavailable", re.compile(r"503|unavailable|connection refused|ECONNREFUSED|upstream connect|reset before headers", re.I), 0.7),
    ("backlog", "Queue / consumer backlog", re.compile(r"lag=|consumer lag|queue depth|backlog", re.I), 0.7),
    ("crash", "Crash / restart loop", re.compile(r"exit 137|OOMKilled|CrashLoop|restartCount|terminated|panic", re.I), 1.0),
    ("cpu", "CPU saturation", re.compile(r"CPU throttl|cpu.*(100|9\d)%", re.I), 0.5),
    ("change", "Change event (deploy/config)", re.compile(r"deploy|rolled out|release|config reloaded", re.I), 0.3),
    ("retry", "Retry storm", re.compile(r"retry|retrying|attempt \d", re.I), 0.5),
]

RECOMMENDATIONS = {
    "memory": "Roll back the latest release or restart pods; capture a heap dump to locate the leak.",
    "pool": "Fail over or recycle the database; audit connection lifecycle in the most frequent callers.",
    "timeout": "Add timeouts with jittered retries and a circuit breaker on the slow dependency.",
    "dependency": "Isolate the failing dependency behind a circuit breaker and serve degraded responses.",
    "backlog": "Rebalance partitions or add consumers to drain the backlog.",
    "crash": "Stop the crash loop: roll back or pin the last healthy image, then raise memory limits temporarily.",
    "cpu": "Scale out horizontally and enable adaptive rate limiting at the edge.",
    "retry": "Cap retries and add exponential backoff to prevent retry amplification.",
}


def analyse_logs(text: str, known_services: set[str] | None = None) -> dict:
    lines = [l for l in text.splitlines() if l.strip()][:200_000]
    per_service: dict[str, Counter] = defaultdict(Counter)
    patterns: dict[str, Counter] = defaultdict(Counter)
    samples: dict[str, list[str]] = defaultdict(list)
    edges: Counter = Counter()
    first_error: dict[str, int] = {}
    timeline: dict[str, Counter] = defaultdict(Counter)
    parsed = 0

    for idx, line in enumerate(lines):
        ts_m = TS_RE.search(line)
        lvl_m = LEVEL_RE.search(line)
        level = lvl_m.group(1).upper() if lvl_m else "INFO"
        sev = LEVELS.get(level, 1)
        service = None
        for rx in SERVICE_RES:
            m = rx.search(line)
            if m and m.group(1).upper() not in LEVELS:
                service = m.group(1).lower()
                break
        if service is None:
            service = "unknown"
        parsed += 1
        per_service[service]["lines"] += 1
        if sev >= 2:
            per_service[service]["warn"] += 1
        if sev >= 3:
            per_service[service]["error"] += 1
            first_error.setdefault(service, idx)
        bucket = ts_m.group(1)[:16] if ts_m else f"L{idx // max(1, len(lines) // 30):03d}"
        if sev >= 3:
            timeline[bucket][service] += 1
        timeline[bucket]["_total"] += 0
        if sev >= 2:
            for key, _, rx, _ in PATTERNS:
                if rx.search(line):
                    patterns[service][key] += 1
                    if len(samples[service]) < 4 and line not in samples[service]:
                        samples[service].append(line.strip()[:240])
        for m in UPSTREAM_RE.finditer(line):
            target = m.group(1).lower()
            if target != service and (known_services is None or target in known_services or target in per_service):
                edges[(service, target)] += 1

    services = [s for s in per_service if s != "unknown"] or list(per_service)
    order = sorted(first_error, key=first_error.get)
    n_err_services = max(len(order), 1)
    results = []
    for s in services:
        c = per_service[s]
        err_ratio = c["error"] / max(c["lines"], 1)
        pat_score = sum(min(patterns[s][key], 20) / 20 * weight for key, _, _, weight in PATTERNS)
        downstream_bad = sum(cnt for (a, b), cnt in edges.items() if a == s and per_service[b]["error"] > 0)
        upstream_refs = sum(cnt for (a, b), cnt in edges.items() if b == s)
        risk = min(1.0, 0.55 * min(err_ratio * 3, 1) + 0.3 * min(pat_score / 1.5, 1) + 0.15 * min(c["warn"] / 40, 1))
        early = 1 - order.index(s) / n_err_services if s in order else 0
        intrinsic = 1 - min(downstream_bad / max(c["error"], 1), 1)
        root_score = 0.4 * early + 0.3 * intrinsic + 0.3 * min(upstream_refs / 10, 1) if c["error"] else 0
        top_patterns = [
            {"key": k, "label": next(p[1] for p in PATTERNS if p[0] == k), "count": v}
            for k, v in patterns[s].most_common(4)
        ]
        results.append(
            {
                "service": s,
                "lines": c["lines"],
                "warnings": c["warn"],
                "errors": c["error"],
                "errorRatio": round(err_ratio, 4),
                "risk": round(risk, 3),
                "rootScore": round(root_score, 3),
                "patterns": top_patterns,
                "samples": samples[s],
                "referencedBy": upstream_refs,
            }
        )
    results.sort(key=lambda r: -r["risk"])
    root = max(results, key=lambda r: r["rootScore"], default=None)
    recs = []
    if root and root["rootScore"] > 0:
        for p in root["patterns"][:3]:
            if p["key"] in RECOMMENDATIONS:
                recs.append({"service": root["service"], "pattern": p["label"], "action": RECOMMENDATIONS[p["key"]]})

    buckets = sorted(timeline)
    series = [
        {"bucket": b if not b.startswith("L") else f"#{i + 1}", "errors": sum(v for k, v in timeline[b].items() if k != "_total")}
        for i, b in enumerate(buckets)
    ]
    return {
        "linesParsed": parsed,
        "services": results,
        "edges": [{"source": a, "target": b, "count": n} for (a, b), n in edges.most_common(60)],
        "rootCause": root if root and root["rootScore"] > 0 else None,
        "recommendations": recs,
        "errorTimeline": series[-60:],
        "analysedAt": datetime.now(timezone.utc).isoformat(),
    }
