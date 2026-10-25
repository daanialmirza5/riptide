"""Incident lifecycle: open on predicted or actual degradation, record a timeline,
measure prediction lead time, and close once the platform is stable again."""
from __future__ import annotations

from dataclasses import dataclass, field

from .simulator import Simulator
from .topology import SPEC_BY_ID


@dataclass
class Incident:
    id: str
    opened_tick: int
    opened_ts: str
    severity: str = "SEV3"
    status: str = "open"  # open | mitigating | resolved
    title: str = "Anomalous behaviour detected"
    root_cause: dict | None = None
    closed_tick: int | None = None
    closed_ts: str | None = None
    timeline: list[dict] = field(default_factory=list)
    predictions: dict[str, int] = field(default_factory=dict)  # service -> tick first predicted
    failures: dict[str, int] = field(default_factory=dict)  # service -> tick it actually failed
    peak_risk: float = 0.0
    peak_failed: int = 0
    actions: list[str] = field(default_factory=list)
    chaos: list[str] = field(default_factory=list)

    def add(self, tick: int, ts: str, kind: str, text: str, service: str | None = None) -> None:
        self.timeline.append({"tick": tick, "ts": ts, "kind": kind, "text": text, "service": service})

    def to_dict(self) -> dict:
        # only predictions issued strictly before the failure count as foresight
        lead = {
            s: self.failures[s] - self.predictions[s]
            for s in self.failures
            if s in self.predictions and self.predictions[s] < self.failures[s]
        }
        return {
            "id": self.id,
            "openedTick": self.opened_tick,
            "openedTs": self.opened_ts,
            "closedTick": self.closed_tick,
            "closedTs": self.closed_ts,
            "severity": self.severity,
            "status": self.status,
            "title": self.title,
            "rootCause": self.root_cause,
            "timeline": self.timeline,
            "peakRisk": round(self.peak_risk, 3),
            "peakFailed": self.peak_failed,
            "actions": self.actions,
            "leadTimes": lead,
            "avgLeadTime": round(sum(lead.values()) / len(lead), 1) if lead else None,
            "predictedServices": sorted(self.predictions),
            "failedServices": sorted(self.failures),
            "prevented": sorted(set(self.predictions) - set(self.failures)) if self.status == "resolved" else [],
            "duration": (self.closed_tick or 0) - self.opened_tick if self.closed_tick else None,
        }


class IncidentManager:
    def __init__(self) -> None:
        self.incidents: list[Incident] = []
        self.current: Incident | None = None
        self._calm = 0
        self._seq = 0
        self._last_status: dict[str, str] = {}
        self._last_root: tuple[str, str] | None = None
        self._event_cursor = 0

    def observe(self, sim: Simulator, forecast: dict, rca: dict) -> None:
        tick, ts = sim.tick, sim.timestamp()
        statuses = {sid: s.status for sid, s in sim.services.items()}
        risks = forecast["services"]
        max_risk = max(v["risk"] for v in risks.values())
        failing = [sid for sid, st in statuses.items() if st in ("critical", "down")]
        trigger = (
            failing
            or max_risk >= 0.55
            or any(v["anomaly"] > 0.7 for v in risks.values())
            or bool(rca.get("candidates"))
        )

        new_events = sim.events[self._event_cursor:] if self._event_cursor <= len(sim.events) else sim.events
        self._event_cursor = len(sim.events)

        if self.current is None and trigger:
            self._seq += 1
            inc = Incident(id=f"INC-{1000 + self._seq}", opened_tick=tick, opened_ts=ts)
            top = max(risks.items(), key=lambda kv: kv[1]["risk"])
            inc.add(tick, ts, "detect", f"Anomaly detected — {top[0]} risk {top[1]['risk'] * 100:.0f}%", top[0])
            self.current = inc
            self.incidents.insert(0, inc)
            self._last_root = None

        inc = self.current
        if inc is None:
            self._last_status = statuses
            return

        for e in new_events:
            if e["kind"] in ("action", "action_done", "deploy", "crash", "chaos", "autopilot"):
                inc.add(e["tick"], e["ts"], e["kind"], e["message"], e.get("service"))
                if e["kind"] == "action":
                    inc.actions.append(e["message"])
                    if inc.status == "open":
                        inc.status = "mitigating"
                if e["kind"] == "chaos":
                    inc.chaos.append(e["message"])

        for sid, v in risks.items():
            if v["risk"] >= 0.6 and sid not in inc.predictions and statuses[sid] not in ("critical", "down"):
                inc.predictions[sid] = tick
                eta = f" in ~{v['eta']:.0f}s" if v["eta"] is not None else ""
                inc.add(tick, ts, "predict", f"Predicted failure of {sid}{eta} (p={v['risk'] * 100:.0f}%)", sid)
        for sid, st in statuses.items():
            prev = self._last_status.get(sid, "healthy")
            if st in ("critical", "down") and prev not in ("critical", "down"):
                inc.failures.setdefault(sid, tick)
                inc.add(tick, ts, "fail", f"{sid} became {st.upper()}", sid)
            elif st == "healthy" and prev in ("critical", "down"):
                inc.add(tick, ts, "recover", f"{sid} recovered", sid)

        cands = rca.get("candidates") or []
        c = cands[0] if cands else None
        current = inc.root_cause
        stronger = c is not None and (
            current is None
            or (
                inc.status == "open"  # once remediation starts, the diagnosis is locked
                and c["hypothesis"] != "unknown"
                and (current["hypothesis"] == "unknown" or c["confidence"] > current["confidence"] + 0.15)
            )
        )
        if c and c["confidence"] >= 0.35 and (c["service"], c["hypothesis"]) != self._last_root and stronger:
            self._last_root = (c["service"], c["hypothesis"])
            inc.root_cause = {k: c[k] for k in ("service", "hypothesis", "hypothesisLabel", "confidence")}
            inc.title = f"{c['hypothesisLabel']} in {SPEC_BY_ID[c['service']].name}"
            inc.add(tick, ts, "rca", f"Root cause: {c['hypothesisLabel']} in {c['service']} ({c['confidence'] * 100:.0f}% confidence)", c["service"])

        inc.peak_risk = max(inc.peak_risk, max_risk)
        inc.peak_failed = max(inc.peak_failed, len(failing))
        crit_weight = max((SPEC_BY_ID[s].importance for s in failing), default=0)
        if "api-gateway" in failing or (len(failing) >= 4):
            sev = "SEV1"
        elif failing and crit_weight >= 0.8:
            sev = "SEV2"
        else:
            sev = "SEV3"
        if _rank(sev) < _rank(inc.severity):
            inc.add(tick, ts, "escalate", f"Severity escalated to {sev}")
            inc.severity = sev

        if not trigger and all(st == "healthy" for st in statuses.values()) and max_risk < 0.3:
            self._calm += 1
            if self._calm >= 10:
                inc.status = "resolved"
                inc.closed_tick, inc.closed_ts = tick, ts
                inc.add(tick, ts, "resolve", f"Incident resolved after {tick - inc.opened_tick}s")
                self.current = None
                self._calm = 0
        else:
            self._calm = 0
        self._last_status = statuses

    def summary(self) -> list[dict]:
        return [i.to_dict() for i in self.incidents[:30]]

    def get(self, incident_id: str) -> Incident | None:
        return next((i for i in self.incidents if i.id == incident_id), None)

    def stats(self) -> dict:
        resolved = [i for i in self.incidents if i.closed_tick is not None]
        dicts = [i.to_dict() for i in self.incidents]
        leads = [v for d in dicts for v in d["leadTimes"].values()]
        return {
            "failuresPrevented": sum(len(d["prevented"]) for d in dicts),
            "total": len(self.incidents),
            "open": sum(1 for i in self.incidents if i.status != "resolved"),
            "mttr": round(sum(i.closed_tick - i.opened_tick for i in resolved) / len(resolved), 1) if resolved else None,
            "avgLeadTime": round(sum(leads) / len(leads), 1) if leads else None,
            "predictedFailures": len(leads),
        }


def _rank(sev: str) -> int:
    return {"SEV1": 1, "SEV2": 2, "SEV3": 3}[sev]


def report_markdown(inc: Incident) -> str:
    d = inc.to_dict()
    lines = [
        f"# {inc.id}: {inc.title}",
        "",
        f"- **Severity:** {inc.severity}",
        f"- **Status:** {inc.status}",
        f"- **Opened:** {inc.opened_ts}",
        f"- **Closed:** {inc.closed_ts or '—'}",
        f"- **Duration:** {d['duration']}s" if d["duration"] is not None else "- **Duration:** ongoing",
        f"- **Peak failed services:** {inc.peak_failed}",
        f"- **Peak predicted risk:** {inc.peak_risk * 100:.0f}%",
    ]
    if inc.root_cause:
        rc = inc.root_cause
        lines.append(f"- **Root cause:** {rc['hypothesisLabel']} in `{rc['service']}` ({rc['confidence'] * 100:.0f}% confidence)")
    if d["leadTimes"]:
        lines += ["", "## Prediction lead time", ""]
        lines += [f"- `{s}` failure predicted **{t}s** before it happened" for s, t in d["leadTimes"].items()]
    if d["prevented"]:
        lines += ["", "## Failures prevented", ""]
        lines += [f"- `{s}` was predicted to fail and remediated before impact" for s in d["prevented"]]
    if inc.actions:
        lines += ["", "## Remediation", ""] + [f"- {a}" for a in inc.actions]
    lines += ["", "## Timeline", "", "| Time | Event |", "|---|---|"]
    lines += [f"| {e['ts'][11:19]} | {e['text']} |" for e in inc.timeline]
    lines += ["", "_Generated by Riptide failure intelligence._", ""]
    return "\n".join(lines)
