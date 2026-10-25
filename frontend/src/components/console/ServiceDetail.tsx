import { Bomb, Boxes, MousePointerClick, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { api } from "../../lib/api";
import { ms, pct, riskColor, secs } from "../../lib/format";
import { useStore } from "../../lib/store";
import type { ServiceDetail } from "../../lib/types";
import { useCommand } from "../../lib/useCommand";
import { Empty, Meter, StatusBadge } from "../ui";

const ACTIONS_FOR = (id: string, kind: string) => {
  const list = [
    { kind: "restart", label: "Restart" },
    { kind: "scale_out", label: "Scale +2" },
    { kind: "circuit_breaker", label: "Circuit breaker" },
  ];
  if (kind === "app" || kind === "edge") list.splice(1, 0, { kind: "rollback", label: "Roll back" });
  if (id === "postgres-primary") list.push({ kind: "failover", label: "Fail over" });
  if (id === "kafka") list.push({ kind: "rebalance", label: "Rebalance" });
  if (id === "payment-provider") list.push({ kind: "switch_provider", label: "Switch provider" });
  if (id === "api-gateway") list.push({ kind: "rate_limit", label: "Rate limit" });
  return list;
};

const CHARTS: { key: keyof ServiceDetail["series"][number]; label: string; color: string; fmt: (v: number) => string }[] = [
  { key: "health", label: "Health", color: "#34d399", fmt: (v) => pct(v, 0) },
  { key: "memory", label: "Memory %", color: "#a78bfa", fmt: (v) => `${v.toFixed(0)}%` },
  { key: "latency", label: "p99 latency", color: "#38bdf8", fmt: ms },
  { key: "error_rate", label: "Error rate %", color: "#f43f5e", fmt: (v) => `${v.toFixed(1)}%` },
  { key: "saturation", label: "Saturation %", color: "#fbbf24", fmt: (v) => `${v.toFixed(0)}%` },
  { key: "cpu", label: "CPU %", color: "#22d3ee", fmt: (v) => `${v.toFixed(0)}%` },
];

function WhatIfBox({ service }: { service: string }) {
  const whatif = useStore((s) => s.whatif);
  const setWhatif = useStore((s) => s.setWhatif);
  const sim = useCommand(api.whatif);
  const mine = whatif?.service === service ? whatif : null;
  const failed = mine?.impacted.filter((x) => x.failedAt !== null) ?? [];
  return (
    <div className="rounded-xl bg-gradient-to-br from-fuchsia-500/[0.07] to-transparent p-3 ring-1 ring-fuchsia-400/20">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-fuchsia-100">
            <Bomb size={14} /> What if it dies?
          </div>
          <p className="text-[11px] text-slate-400">Hard-fail this service in a forked twin and trace the blast radius.</p>
        </div>
        {mine ? (
          <button className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs" onClick={() => setWhatif(null)}>Clear</button>
        ) : (
          <button
            className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs"
            disabled={sim.pending}
            onClick={async () => {
              const r = await sim.run(service);
              if (r) setWhatif(r);
            }}
          >
            {sim.pending ? "Simulating…" : "Simulate outage"}
          </button>
        )}
      </div>
      {mine && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-abyss-950/50 py-1.5">
              <div className="font-mono text-sm text-white">{failed.length}</div>
              <div className="text-[10px] uppercase text-slate-500">services fail</div>
            </div>
            <div className="rounded-lg bg-abyss-950/50 py-1.5">
              <div className="font-mono text-sm text-white">{pct(mine.minAvailability, 0)}</div>
              <div className="text-[10px] uppercase text-slate-500">min avail.</div>
            </div>
            <div className="rounded-lg bg-abyss-950/50 py-1.5">
              <div className="font-mono text-sm text-white">${mine.revenueAtRisk.toLocaleString()}</div>
              <div className="text-[10px] uppercase text-slate-500">at risk / min</div>
            </div>
          </div>
          <ol className="space-y-0.5 font-mono text-[11px]">
            {mine.impacted.slice(0, 10).map((x) => (
              <li key={x.service} className="flex justify-between text-slate-300">
                <span>{x.service}</span>
                <span className={x.failedAt !== null ? "text-fuchsia-300" : "text-amber-300/80"}>
                  {x.failedAt !== null ? `fails at +${x.failedAt}s` : x.worst}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-slate-500">Affected nodes are ringed in magenta in the 3D view.</p>
        </div>
      )}
    </div>
  );
}

export default function ServiceDetailView() {
  const selected = useStore((s) => s.selected);
  const state = useStore((s) => (selected ? s.services[selected] : undefined));
  const spec = useStore((s) => s.topology?.services.find((x) => x.id === selected));
  const select = useStore((s) => s.select);
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const action = useCommand(api.action, (r) => r.applied.join(", "));

  useEffect(() => {
    if (!selected) return;
    let live = true;
    const load = () => api.service(selected).then((d) => live && setDetail(d)).catch(() => undefined);
    setDetail(null);
    load();
    const t = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [selected]);

  if (!selected || !state || !spec) {
    return <Empty icon={<MousePointerClick size={20} />} title="Select a service" body="Click any node in the 3D topology to inspect its live metrics, forecast and logs, or to act on it." />;
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-lg font-semibold text-white">{spec.name}</h3>
            <StatusBadge status={state.status} />
          </div>
          <p className="mt-0.5 text-xs text-slate-400">{spec.description}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5 font-mono text-[10px] text-slate-500">
            <span className="rounded bg-white/[0.04] px-1.5 py-0.5">{state.version}</span>
            <span className="rounded bg-white/[0.04] px-1.5 py-0.5"><Boxes size={10} className="mr-1 inline" />{state.replicas} replicas</span>
            <span className="rounded bg-white/[0.04] px-1.5 py-0.5">team {spec.team}</span>
            {state.breaker && <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-cyan-300">breaker on</span>}
          </div>
        </div>
        <button onClick={() => select(null)} className="rounded-lg p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="rounded-xl bg-white/[0.025] p-3 ring-1 ring-white/[0.05]">
        <div className="flex items-center justify-between text-xs">
          <span className="label">Failure risk</span>
          <span className="font-mono" style={{ color: riskColor(state.risk) }}>
            {pct(state.risk, 0)} {state.eta !== null && <span className="text-violet-300">· T-{secs(state.eta)}</span>}
          </span>
        </div>
        <Meter value={state.risk} color={riskColor(state.risk)} className="mt-2" />
        {state.drivers.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
            {state.drivers.map((d) => <li key={d}>• {d}</li>)}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ["CPU", `${state.cpu.toFixed(0)}%`],
          ["Memory", `${state.memory.toFixed(0)}%`],
          ["p99", ms(state.latency)],
          ["Errors", `${state.errorRate.toFixed(1)}%`],
          ["Saturation", `${state.saturation.toFixed(0)}%`],
          ["Req/s", Math.round(state.rps).toLocaleString()],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white/[0.025] px-2 py-2 ring-1 ring-white/[0.04]">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
            <div className="font-mono text-sm text-slate-100">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {CHARTS.map((c) => (
          <div key={c.key} className="rounded-xl bg-white/[0.02] p-2 ring-1 ring-white/[0.04]">
            <div className="flex justify-between px-1 text-[10px] text-slate-500">
              <span>{c.label}</span>
              {detail && detail.zscores[c.key] !== undefined && <span className="font-mono">z {detail.zscores[c.key].toFixed(1)}</span>}
            </div>
            <div className="h-14">
              {detail ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={detail.series} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                    <defs>
                      <linearGradient id={`g-${c.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor={c.color} stopOpacity={0.35} />
                        <stop offset="1" stopColor={c.color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <YAxis hide domain={c.key === "health" ? [0, 1] : ["auto", "auto"]} />
                    {detail.baseline[c.key] !== undefined && <ReferenceLine y={detail.baseline[c.key]} stroke="#64748b" strokeDasharray="3 3" />}
                    <Tooltip
                      cursor={{ stroke: "#334155" }}
                      contentStyle={{ background: "#0b1324", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, fontSize: 11 }}
                      labelFormatter={(_, p) => (p?.[0] ? `t+${p[0].payload.tick}s` : "")}
                      formatter={(v: number) => [c.fmt(v), c.label]}
                    />
                    <Area type="monotone" dataKey={c.key} stroke={c.color} strokeWidth={1.5} fill={`url(#g-${c.key})`} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full animate-pulse rounded bg-white/[0.03]" />
              )}
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="label mb-2">Operator actions</div>
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS_FOR(spec.id, spec.kind).map((a) => (
            <button key={a.kind} className="btn-ghost px-2.5 py-1.5 text-xs" disabled={action.pending} onClick={() => action.run(a.kind, spec.id)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <WhatIfBox service={spec.id} />

      {detail && detail.logs.length > 0 && (
        <div>
          <div className="label mb-2">Recent logs</div>
          <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-xl bg-abyss-950/60 p-2 font-mono text-[10.5px] ring-1 ring-white/[0.05]">
            {detail.logs.slice(-14).reverse().map((l) => (
              <div key={l.id} className="flex gap-2">
                <span className="text-slate-600">{l.ts.slice(11, 19)}</span>
                <span className={l.level === "ERROR" || l.level === "FATAL" ? "text-rose-400" : l.level === "WARN" ? "text-amber-300" : "text-slate-500"}>{l.level}</span>
                <span className="break-all text-slate-300">{l.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
