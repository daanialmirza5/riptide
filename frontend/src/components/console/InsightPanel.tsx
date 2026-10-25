import clsx from "clsx";
import { ArrowRight, BrainCircuit, ChevronRight, Crosshair, FileText, GitCommitHorizontal, Network, ScanSearch, Sparkles, TrendingUp, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pct, riskColor, secs } from "../../lib/format";
import { useStore } from "../../lib/store";
import type { Evidence, RcaCandidate } from "../../lib/types";
import { Empty, Meter, Panel } from "../ui";
import ServiceDetailView from "./ServiceDetail";

type Tab = "forecast" | "rca" | "service";

export default function InsightPanel({ className }: { className?: string }) {
  const selected = useStore((s) => s.selected);
  const [tab, setTab] = useState<Tab>("forecast");
  useEffect(() => {
    if (selected) setTab("service");
  }, [selected]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "forecast", label: "Forecast" },
    { id: "rca", label: "Root cause" },
    { id: "service", label: "Service" },
  ];

  return (
    <Panel className={className} bodyClassName="flex min-h-0 flex-col">
      <div className="flex gap-1 border-b border-white/[0.06] p-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx("flex-1 rounded-lg px-3 py-1.5 text-sm transition", tab === t.id ? "bg-white/[0.08] text-white" : "text-slate-400 hover:text-slate-200")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "forecast" && <Forecast />}
        {tab === "rca" && <RootCause />}
        {tab === "service" && <ServiceDetailView />}
      </div>
    </Panel>
  );
}

function Forecast() {
  const snap = useStore((s) => s.snapshot);
  const select = useStore((s) => s.select);
  if (!snap) return null;
  const at = [...snap.services].filter((s) => s.risk >= 0.2).sort((a, b) => b.risk - a.risk);
  const crash = snap.kpis.crashProbability;
  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl bg-gradient-to-br from-white/[0.04] to-transparent p-4 ring-1 ring-white/[0.06]">
        <div className="flex items-center justify-between">
          <span className="label">System crash probability</span>
          <TrendingUp size={14} className="text-slate-500" />
        </div>
        <div className="mt-2 flex items-end gap-3">
          <span className="font-display text-4xl font-semibold tabular-nums" style={{ color: riskColor(crash) }}>
            {pct(crash, 0)}
          </span>
          <span className="pb-1.5 text-xs text-slate-400">
            {snap.kpis.timeToImpact !== null ? <>first failure in <b className="text-violet-300">{secs(snap.kpis.timeToImpact)}</b></> : "no failure forecast in the next 2 minutes"}
          </span>
        </div>
        <Meter value={crash} color={riskColor(crash)} className="mt-3" />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Predicted failure wavefront</span>
          <span className="text-[11px] text-slate-500">{snap.wavefront.length} services</span>
        </div>
        {snap.wavefront.length === 0 ? (
          <div className="rounded-xl bg-emerald-500/[0.05] px-3 py-3 text-sm text-emerald-200/90 ring-1 ring-emerald-400/15">
            All clear. No cascade is forming.
          </div>
        ) : (
          <ol className="relative space-y-1.5 border-l border-violet-400/25 pl-4">
            {snap.wavefront.slice(0, 8).map((w, i) => (
              <li key={w.service} className="relative">
                <span className="absolute -left-[21px] top-2.5 h-2.5 w-2.5 rounded-full ring-2 ring-abyss-900" style={{ background: riskColor(w.risk) }} />
                <button onClick={() => select(w.service)} className="w-full rounded-lg px-2.5 py-1.5 text-left transition hover:bg-white/[0.04]">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-100">
                      <span className="mr-1.5 font-mono text-[11px] text-slate-500">{i + 1}</span>
                      {w.service}
                    </span>
                    <span className="font-mono text-xs text-violet-300">{w.eta !== null ? `T-${secs(w.eta)}` : "—"}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Meter value={w.risk} color={riskColor(w.risk)} />
                    <span className="w-9 text-right font-mono text-[11px] text-slate-400">{pct(w.risk, 0)}</span>
                  </div>
                  {w.via && <div className="mt-0.5 text-[11px] text-slate-500">cascades from {w.via}</div>}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {at.length > 0 && (
        <div>
          <span className="label">Risk drivers</span>
          <div className="mt-2 space-y-2">
            {at.slice(0, 4).map((s) => (
              <div key={s.id} className="rounded-xl bg-white/[0.025] p-3 ring-1 ring-white/[0.05]">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-100">{s.id}</span>
                  <span className="font-mono text-xs" style={{ color: riskColor(s.risk) }}>{pct(s.risk, 0)}</span>
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {s.drivers.map((d) => (
                    <li key={d} className="flex gap-1.5 text-xs text-slate-400">
                      <ChevronRight size={12} className="mt-0.5 shrink-0 text-slate-600" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const EVIDENCE_ICON: Record<Evidence["kind"], typeof Network> = {
  metric: TrendingUp,
  anomaly: Sparkles,
  change: GitCommitHorizontal,
  event: Crosshair,
  log: FileText,
  topology: Network,
};

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return (
    <ul className="space-y-1.5">
      {evidence.map((e, i) => {
        const Icon = EVIDENCE_ICON[e.kind] ?? Sparkles;
        return (
          <li key={i} className="flex gap-2.5 rounded-lg bg-white/[0.02] px-2.5 py-2 ring-1 ring-white/[0.04]">
            <Icon size={14} className="mt-0.5 shrink-0 text-tide-300" />
            <span className={clsx("text-xs leading-relaxed", e.kind === "log" ? "break-all font-mono text-slate-400" : "text-slate-300")}>{e.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function BlastPath({ path }: { path: string[] }) {
  const services = useStore((s) => s.services);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {path.map((p, i) => (
        <span key={p} className="flex items-center gap-1.5">
          <span
            className="rounded-md px-2 py-1 font-mono text-[11px] ring-1"
            style={{ color: riskColor(services[p]?.risk ?? 0), background: `${riskColor(services[p]?.risk ?? 0)}14`, borderColor: "transparent", boxShadow: `inset 0 0 0 1px ${riskColor(services[p]?.risk ?? 0)}40` }}
          >
            {p}
          </span>
          {i < path.length - 1 && <ArrowRight size={12} className="text-slate-600" />}
        </span>
      ))}
    </div>
  );
}

export function RootCauseCard({ c, compact }: { c: RcaCandidate; compact?: boolean }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-rose-500/[0.08] via-transparent to-violet-500/[0.06] p-4 ring-1 ring-rose-400/20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label text-rose-200/70">Most likely root cause</div>
          <div className="mt-1 font-display text-lg font-semibold text-white">{c.hypothesisLabel}</div>
          <div className="text-sm text-slate-300">
            in <span className="font-mono text-rose-200">{c.service}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-semibold tabular-nums text-white">{pct(c.confidence, 0)}</div>
          <div className="text-[11px] text-slate-400">confidence</div>
        </div>
      </div>
      {!compact && (
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {Object.entries(c.components).map(([k, v]) => (
            <div key={k} title={k}>
              <Meter value={v} color="#a78bfa" />
              <div className="mt-1 truncate text-[10px] capitalize text-slate-500">{k}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RootCause() {
  const rca = useStore((s) => s.snapshot?.rca);
  const navigate = useNavigate();
  if (!rca || rca.candidates.length === 0) {
    return <Empty icon={<ScanSearch size={20} />} title="Nothing to diagnose" body="All services are behaving within their learned baselines. Inject a scenario from the Chaos lab to see Riptide trace a failure." />;
  }
  const [top, ...rest] = rca.candidates;
  return (
    <div className="space-y-4 p-4">
      <RootCauseCard c={top} />
      <div>
        <div className="label mb-2 flex items-center gap-1.5"><Workflow size={12} /> Propagation path</div>
        <BlastPath path={top.path} />
      </div>
      <div>
        <div className="label mb-2 flex items-center gap-1.5"><BrainCircuit size={12} /> Evidence</div>
        <EvidenceList evidence={top.evidence} />
      </div>
      {rest.length > 0 && (
        <div>
          <div className="label mb-2">Other candidates</div>
          <div className="space-y-1.5">
            {rest.map((c) => (
              <div key={c.service} className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-white/[0.04]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-200">{c.service}</div>
                  <div className="truncate text-[11px] text-slate-500">{c.hypothesisLabel}</div>
                </div>
                <span className="font-mono text-xs text-slate-400">{pct(c.confidence, 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <button className="btn-primary w-full" onClick={() => navigate("/recovery?run=1")}>
        Simulate recovery strategies <ArrowRight size={15} />
      </button>
    </div>
  );
}
