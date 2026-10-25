import clsx from "clsx";
import { motion } from "framer-motion";
import { Award, BrainCircuit, CheckCircle2, FlaskConical, LifeBuoy, Play, RefreshCw, Workflow } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BlastPath, EvidenceList, RootCauseCard } from "../components/console/InsightPanel";
import { Empty, Panel, SevBadge, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { money, pct, secs } from "../lib/format";
import { useStore } from "../lib/store";
import type { StrategyResult } from "../lib/types";
import { useCommand } from "../lib/useCommand";

const PALETTE = ["#22d3ee", "#a78bfa", "#fbbf24", "#34d399", "#f472b6", "#60a5fa", "#fb923c"];
type Metric = "availability" | "health" | "failed";

export default function Recovery() {
  const snap = useStore((s) => s.snapshot);
  const rec = useStore((s) => s.recommendation);
  const setRec = useStore((s) => s.setRecommendation);
  const toast = useStore((s) => s.toast);
  const catalog = useStore((s) => s.catalog);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [metric, setMetric] = useState<Metric>("availability");
  const evaluate = useCommand(api.evaluate);
  const apply = useCommand(api.apply);
  const inject = useCommand(api.injectScenario, () => "Scenario injected. Riptide is watching");
  const autoRan = useRef(false);

  const top = snap?.rca.candidates[0] ?? null;
  const hasIssue = !!top;

  const run = async () => {
    const r = await evaluate.run();
    if (r) setRec(r);
  };

  useEffect(() => {
    if (params.get("run") && hasIssue && !autoRan.current) {
      autoRan.current = true;
      setParams({}, { replace: true });
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, hasIssue]);

  const doApply = async (s: StrategyResult) => {
    const r = await apply.run(s.id);
    if (r) {
      toast({ tone: "success", title: `Executing: ${r.strategy}`, body: r.applied.length ? r.applied.join(" · ") : "Holding. No intervention." });
      setRec(null);
      navigate("/console");
    }
  };

  const age = rec && snap ? snap.tick - rec.tick : 0;

  if (!hasIssue && !rec) {
    return (
      <div className="mx-auto grid h-full max-w-3xl place-items-center p-6">
        <Panel className="w-full">
          <Empty
            icon={<LifeBuoy size={22} />}
            title="No active failure to recover from"
            body="The Recovery Lab forks the live digital twin and simulates each candidate strategy two minutes into the future. Start a failure to see it in action."
            action={
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {catalog?.scenarios.slice(0, 3).map((s) => (
                  <button key={s.id} className="btn-ghost text-xs" disabled={inject.pending} onClick={async () => { await inject.run(s.id); navigate("/console"); }}>
                    <FlaskConical size={13} /> {s.name}
                  </button>
                ))}
              </div>
            }
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1500px] gap-4 p-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="space-y-4">
          {snap?.incident && (
            <Panel>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-slate-400">{snap.incident.id}</span>
                <SevBadge sev={snap.incident.severity} />
              </div>
              <div className="mt-1 font-display text-lg font-semibold text-white">{snap.incident.title}</div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat label="open for" value={secs(snap.tick - snap.incident.openedTick)} />
                <Stat label="crash prob." value={pct(snap.kpis.crashProbability, 0)} />
                <Stat label="impact in" value={secs(snap.kpis.timeToImpact)} />
              </div>
            </Panel>
          )}
          {top ? (
            <>
              <RootCauseCard c={top} />
              <Panel title="Propagation path" icon={<Workflow size={15} />}>
                <BlastPath path={top.path} />
                {top.impacted.length > 0 && <p className="mt-3 text-xs text-slate-400">Already affecting: {top.impacted.join(", ")}</p>}
              </Panel>
              <Panel title="Evidence" icon={<BrainCircuit size={15} />}>
                <EvidenceList evidence={top.evidence} />
              </Panel>
            </>
          ) : (
            <Panel>
              <div className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 size={16} /> Platform has stabilised since this simulation ran.
              </div>
            </Panel>
          )}
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="glass flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <div className="flex-1">
              <div className="label">Recovery Lab · counterfactual simulation</div>
              <h1 className="mt-1 font-display text-2xl font-semibold text-white">Which fix saves the platform?</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-400">
                Riptide forks the live digital twin once per strategy, applies it, and simulates the next {rec?.horizon ?? 120} seconds, comparing each against doing nothing.
              </p>
            </div>
            <button className="btn-primary shrink-0" onClick={run} disabled={evaluate.pending || !hasIssue}>
              {evaluate.pending ? <Spinner /> : rec ? <RefreshCw size={15} /> : <Play size={15} />}
              {evaluate.pending ? "Simulating futures…" : rec ? "Re-run simulation" : "Run simulation"}
            </button>
          </div>

          {evaluate.pending && !rec && (
            <div className="glass grid h-72 place-items-center">
              <div className="text-center">
                <Spinner className="h-7 w-7 text-tide-300" />
                <p className="mt-3 text-sm text-slate-400">Forking the twin and simulating every candidate future…</p>
              </div>
            </div>
          )}

          {rec && (
            <>
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass relative overflow-hidden p-5 ring-1 ring-cyan-400/25">
                <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-400/30">
                    <Award size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="label text-cyan-200/70">Recommended strategy</div>
                    <p className="mt-1 text-[15px] leading-relaxed text-slate-100">{rec.summary}</p>
                    <p className="mt-1 text-xs text-slate-500">Simulated at t+{rec.tick}s{age > 0 && ` · ${age}s ago`}{age > 20 && " · conditions have changed, consider re-running"}</p>
                  </div>
                </div>
              </motion.div>

              <Panel
                title="Simulated futures"
                actions={
                  <div className="flex rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06]">
                    {(["availability", "health", "failed"] as Metric[]).map((m) => (
                      <button key={m} onClick={() => setMetric(m)} className={clsx("rounded-md px-2.5 py-1 text-xs capitalize", metric === m ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200")}>
                        {m === "failed" ? "failed services" : m}
                      </button>
                    ))}
                  </div>
                }
              >
                <FuturesChart strategies={rec.strategies} metric={metric} recommended={rec.recommended} />
              </Panel>

              <div className="space-y-2.5">
                {rec.strategies.map((s, i) => (
                  <StrategyRow key={s.id} s={s} rank={i + 1} color={PALETTE[i % PALETTE.length]} recommended={s.id === rec.recommended} onApply={() => doApply(s)} pending={apply.pending} />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2 py-2 ring-1 ring-white/[0.05]">
      <div className="font-mono text-sm text-slate-100">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function FuturesChart({ strategies, metric, recommended }: { strategies: StrategyResult[]; metric: Metric; recommended: string }) {
  const data = useMemo(() => {
    const n = strategies[0]?.series[metric].length ?? 0;
    return Array.from({ length: n }, (_, t) => {
      const row: Record<string, number> = { t: t + 1 };
      for (const s of strategies) row[s.id] = s.series[metric][t];
      return row;
    });
  }, [strategies, metric]);
  const pctAxis = metric !== "failed";
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
          <XAxis dataKey="t" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(t) => `+${t}s`} minTickGap={36} />
          <YAxis
            domain={pctAxis ? [0, 1] : [0, "auto"]}
            tick={{ fill: "#64748b", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => (pctAxis ? `${Math.round(v * 100)}%` : `${v}`)}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{ background: "#0b1324", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, fontSize: 11 }}
            labelFormatter={(t) => `t+${t}s`}
            formatter={(v: number, id: string) => [pctAxis ? pct(v, 1) : v, strategies.find((s) => s.id === id)?.name ?? id]}
          />
          <Legend formatter={(id: string) => <span className="text-xs text-slate-300">{strategies.find((s) => s.id === id)?.name ?? id}</span>} />
          {strategies.map((s, i) => (
            <Line
              key={s.id}
              type="monotone"
              dataKey={s.id}
              stroke={s.id === "baseline" ? "#f43f5e" : PALETTE[i % PALETTE.length]}
              strokeWidth={s.id === recommended ? 3 : 1.5}
              strokeDasharray={s.id === "baseline" ? "5 4" : undefined}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function StrategyRow({ s, rank, color, recommended, onApply, pending }: { s: StrategyResult; rank: number; color: string; recommended: boolean; onApply: () => void; pending: boolean }) {
  const isBaseline = s.id === "baseline";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.05 }}
      className={clsx("glass flex flex-col gap-4 p-4 lg:flex-row lg:items-center", recommended && "ring-1 ring-cyan-400/40")}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg font-mono text-sm font-semibold" style={{ background: `${isBaseline ? "#f43f5e" : color}1f`, color: isBaseline ? "#f43f5e" : color }}>
          {rank}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-white">{s.name}</span>
            {recommended && <span className="chip bg-cyan-400/15 text-cyan-200 ring-cyan-400/30">Recommended</span>}
            {isBaseline && <span className="chip bg-rose-500/10 text-rose-200 ring-rose-400/25">Baseline</span>}
          </div>
          <p className="text-xs text-slate-400">{s.rationale}</p>
          {s.steps.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {s.steps.map((st, i) => (
                <span key={i} className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-slate-400 ring-1 ring-white/[0.05]">
                  {st.label} → {st.target}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-x-5 gap-y-2 sm:grid-cols-6 lg:w-[560px]">
        <Metric label="score" value={(s.score * 100).toFixed(0)} strong />
        <Metric label="availability" value={pct(s.availability, 1)} />
        <Metric label="recovers" value={s.timeToRecover === null ? "never" : `${s.timeToRecover}s`} warn={s.timeToRecover === null} />
        <Metric label="peak failed" value={`${s.peakFailed}`} warn={s.peakFailed > 3} />
        <Metric label="saved" value={money(s.revenueSaved)} />
        <Metric label="risk" value={pct(s.risk, 0)} />
      </div>
      <button className={clsx(recommended ? "btn-primary" : "btn-ghost", "shrink-0")} onClick={onApply} disabled={pending}>
        {isBaseline ? "Hold" : "Apply"}
      </button>
    </motion.div>
  );
}

function Metric({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div>
      <div className={clsx("font-mono text-sm tabular-nums", strong ? "font-semibold text-white" : warn ? "text-rose-300" : "text-slate-200")}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}
