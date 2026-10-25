import clsx from "clsx";
import { AlertTriangle, Brain, CheckCircle2, Clock, Download, FlaskConical, Hammer, Radar, ShieldCheck, Siren, Skull, TrendingUp, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Empty, Panel, SevBadge } from "../components/ui";
import { api } from "../lib/api";
import { clock, pct, secs } from "../lib/format";
import { useStore } from "../lib/store";
import type { Incident, IncidentStats } from "../lib/types";

const EVENT_STYLE: Record<string, { icon: typeof Radar; tone: string }> = {
  detect: { icon: Radar, tone: "text-sky-300 bg-sky-500/15" },
  predict: { icon: TrendingUp, tone: "text-violet-300 bg-violet-500/15" },
  rca: { icon: Brain, tone: "text-fuchsia-300 bg-fuchsia-500/15" },
  fail: { icon: AlertTriangle, tone: "text-rose-300 bg-rose-500/15" },
  crash: { icon: Skull, tone: "text-rose-300 bg-rose-500/20" },
  escalate: { icon: Siren, tone: "text-orange-300 bg-orange-500/15" },
  action: { icon: Wrench, tone: "text-cyan-300 bg-cyan-500/15" },
  action_done: { icon: Hammer, tone: "text-cyan-300 bg-cyan-500/15" },
  recover: { icon: CheckCircle2, tone: "text-emerald-300 bg-emerald-500/15" },
  resolve: { icon: ShieldCheck, tone: "text-emerald-300 bg-emerald-500/20" },
  chaos: { icon: FlaskConical, tone: "text-slate-300 bg-white/10" },
  deploy: { icon: Clock, tone: "text-amber-300 bg-amber-500/15" },
};

export default function Incidents() {
  const tick = useStore((s) => s.snapshot?.tick ?? 0);
  const [data, setData] = useState<{ incidents: Incident[]; stats: IncidentStats } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (tick % 2 !== 0 && data) return;
    api.incidents().then(setData).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const incidents = data?.incidents ?? [];
  const current = incidents.find((i) => i.id === selected) ?? incidents[0];
  const stats = data?.stats;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Incidents" value={stats ? `${stats.total}` : "—"} />
          <StatCard label="Open" value={stats ? `${stats.open}` : "—"} tone={stats?.open ? "#fb7185" : undefined} />
          <StatCard label="Mean time to recover" value={secs(stats?.mttr)} />
          <StatCard label="Avg prediction lead" value={stats?.avgLeadTime != null ? `${stats.avgLeadTime}s` : "—"} tone="#a78bfa" />
          <StatCard label="Failures prevented" value={stats ? `${stats.failuresPrevented}` : "—"} tone="#34d399" />
        </div>

        {incidents.length === 0 ? (
          <Panel>
            <Empty icon={<Siren size={20} />} title="No incidents yet" body="Incidents open automatically the moment Riptide predicts or detects degradation, and close themselves once the platform is stable." />
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Panel title="History" bodyClassName="p-2">
              <div className="space-y-1">
                {incidents.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => setSelected(i.id)}
                    className={clsx("w-full rounded-xl px-3 py-2.5 text-left transition", current?.id === i.id ? "bg-white/[0.07] ring-1 ring-white/10" : "hover:bg-white/[0.03]")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-400">{i.id}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={clsx("chip", i.status === "resolved" ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/25" : "bg-rose-500/10 text-rose-200 ring-rose-400/30")}>{i.status}</span>
                        <SevBadge sev={i.severity} />
                      </div>
                    </div>
                    <div className="mt-1 truncate text-sm font-medium text-slate-100">{i.title}</div>
                    <div className="text-[11px] text-slate-500">opened {clock(i.openedTs)}{i.duration !== null && ` · ${secs(i.duration)}`}</div>
                  </button>
                ))}
              </div>
            </Panel>
            {current && <IncidentDetail inc={current} />}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="glass px-4 py-3">
      <div className="label">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums text-white" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

function IncidentDetail({ inc }: { inc: Incident }) {
  const leads = Object.entries(inc.leadTimes);
  return (
    <Panel
      title={<span className="truncate">{inc.title}</span>}
      actions={
        <a className="btn-ghost px-2.5 py-1.5 text-xs" href={api.reportUrl(inc.id)} download>
          <Download size={13} /> Post-mortem
        </a>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini label="Peak risk" value={pct(inc.peakRisk, 0)} />
        <Mini label="Peak failed" value={`${inc.peakFailed}`} />
        <Mini label="Duration" value={inc.duration !== null ? secs(inc.duration) : "ongoing"} />
        <Mini label="Root cause" value={inc.rootCause ? inc.rootCause.service : "—"} />
      </div>

      {(leads.length > 0 || inc.prevented.length > 0) && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {leads.length > 0 && (
            <div className="rounded-xl bg-violet-500/[0.06] p-3 ring-1 ring-violet-400/20">
              <div className="label text-violet-200/80">Predicted before failure</div>
              <ul className="mt-2 space-y-1 text-sm">
                {leads.map(([svc, t]) => (
                  <li key={svc} className="flex justify-between">
                    <span className="font-mono text-slate-200">{svc}</span>
                    <span className="font-mono text-violet-300">{t}s early</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {inc.prevented.length > 0 && (
            <div className="rounded-xl bg-emerald-500/[0.06] p-3 ring-1 ring-emerald-400/20">
              <div className="label text-emerald-200/80">Failures prevented</div>
              <p className="mt-2 text-sm text-slate-300">Predicted to fail and remediated before impact:</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {inc.prevented.map((s) => <span key={s} className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[11px] text-emerald-200">{s}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="label mb-3 mt-5">Timeline</div>
      <ol className="relative space-y-3 border-l border-white/10 pl-6">
        {inc.timeline.map((e, i) => {
          const st = EVENT_STYLE[e.kind] ?? EVENT_STYLE.detect;
          const Icon = st.icon;
          return (
            <li key={i} className="relative">
              <span className={clsx("absolute -left-[37px] grid h-6 w-6 place-items-center rounded-full ring-4 ring-abyss-900", st.tone)}>
                <Icon size={12} />
              </span>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[11px] text-slate-500">{clock(e.ts)}</span>
                <span className="text-sm text-slate-200">{e.text}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2 ring-1 ring-white/[0.05]">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="truncate font-mono text-sm text-slate-100">{value}</div>
    </div>
  );
}
