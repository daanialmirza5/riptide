import { CheckCircle2, FlaskConical, RefreshCw, ShieldCheck, Timer, Trophy, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { money, pct } from "../lib/format";
import type { Benchmark } from "../lib/types";

export default function BenchmarkPage() {
  const [status, setStatus] = useState<string>("loading");
  const [data, setData] = useState<Benchmark | null>(null);

  const poll = async (refresh = false) => {
    try {
      const r = await api.benchmark(refresh);
      setStatus(r.status);
      if (r.result) setData(r.result);
      return r.status;
    } catch {
      setStatus("error");
      return "error";
    }
  };

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async (refresh = false) => {
      const s = await poll(refresh);
      if (live && s === "running") timer = setTimeout(() => loop(), 1500);
    };
    loop();
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rerun = async () => {
    setStatus("running");
    await poll(true);
    const wait = async () => {
      const s = await poll();
      if (s === "running") setTimeout(wait, 1500);
    };
    setTimeout(wait, 1500);
  };

  const s = data?.summary;
  const chart = data?.scenarios.map((r) => ({
    name: r.name.replace(/ (traffic surge|brown-out|partition stall|node failure|pool exhaustion|memory leak|release)$/i, ""),
    full: r.name,
    without: r.availabilityWithout ?? 0,
    with: r.availabilityWith ?? 0,
  }));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-4">
        <div className="glass flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <div className="label flex items-center gap-1.5 text-amber-200/80"><Trophy size={12} /> Benchmark · measured, not claimed</div>
            <h1 className="mt-1 font-display text-2xl font-semibold text-white">How well does Riptide actually work?</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Every chaos scenario is replayed on {data?.seeds.length ?? 3} independent digital twins with different random seeds. Riptide only sees metrics and logs.
              We measure when it detects and correctly diagnoses the failure, how much warning it gives before the first service fails, and the availability its recommended fix preserves against doing nothing. Healthy platforms are also run to count false alarms.
            </p>
          </div>
          <button className="btn-ghost shrink-0" onClick={rerun} disabled={status === "running"}>
            {status === "running" ? <Spinner /> : <RefreshCw size={15} />}
            {status === "running" ? "Running…" : "Re-run benchmark"}
          </button>
        </div>

        {!data && (
          <div className="glass grid h-64 place-items-center">
            <div className="text-center">
              {status === "error" ? (
                <p className="text-sm text-rose-300">Benchmark failed. Check the server logs.</p>
              ) : (
                <>
                  <Spinner className="h-7 w-7 text-tide-300" />
                  <p className="mt-3 text-sm text-slate-400">Replaying {7 * 3} incidents across independent twins…</p>
                </>
              )}
            </div>
          </div>
        )}

        {data && s && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Big label="Correct root cause" value={pct(s.diagnosisAccuracy, 0)} sub={`${Math.round(s.diagnosisAccuracy * s.runs)}/${s.runs} incidents`} tone="#34d399" />
              <Big label="Diagnosed before any failure" value={pct(s.earlyDiagnosisRate, 0)} sub="root cause named pre-impact" tone="#22d3ee" />
              <Big label="Mean warning lead" value={s.meanLeadTime != null ? `${Math.round(s.meanLeadTime)}s` : "—"} sub="before first service fails" tone="#a78bfa" />
              <Big label="Mean time to diagnose" value={s.meanTimeToDiagnose != null ? `${s.meanTimeToDiagnose.toFixed(1)}s` : "—"} sub="from fault onset" />
              <Big
                label="Availability preserved"
                value={s.availabilityWith != null ? pct(s.availabilityWith, 0) : "—"}
                sub={s.availabilityWithout != null ? `vs ${pct(s.availabilityWithout, 0)} doing nothing` : ""}
                tone="#34d399"
              />
              <Big label="False alarms" value={`${s.falseAlarms}`} sub={`in ${Math.round(s.quietSeconds / 60)} min of healthy traffic`} tone={s.falseAlarms ? "#f43f5e" : "#34d399"} />
            </div>

            <Panel title="Availability over the next 2 minutes: with Riptide vs doing nothing" icon={<ShieldCheck size={15} />}>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barGap={4}>
                    <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
                    <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,.03)" }}
                      contentStyle={{ background: "#0b1324", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, fontSize: 11 }}
                      labelFormatter={(_, p) => p?.[0]?.payload.full ?? ""}
                      formatter={(v: number, k: string): [string, string] => [pct(v, 1), k === "with" ? "With Riptide" : "Doing nothing"]}
                    />
                    <Legend formatter={(k: string) => <span className="text-xs text-slate-300">{k === "with" ? "With Riptide's recommendation" : "Doing nothing"}</span>} />
                    <Bar isAnimationActive={false} dataKey="without" fill="#f43f5e" fillOpacity={0.75} radius={[4, 4, 0, 0]} />
                    <Bar isAnimationActive={false} dataKey="with" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Per-scenario results" icon={<FlaskConical size={15} />} bodyClassName="overflow-x-auto p-0">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3 font-medium">Scenario</th>
                    <th className="px-3 py-3 font-medium">Expected root cause</th>
                    <th className="px-3 py-3 font-medium">Diagnosed</th>
                    <th className="px-3 py-3 font-medium">Detect</th>
                    <th className="px-3 py-3 font-medium">Diagnose</th>
                    <th className="px-3 py-3 font-medium">Warning lead</th>
                    <th className="px-3 py-3 font-medium">Chosen fix</th>
                    <th className="px-3 py-3 font-medium">Availability</th>
                    <th className="px-3 py-3 font-medium">Services lost</th>
                    <th className="px-4 py-3 font-medium">Saved</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {data.scenarios.map((r) => {
                    const leads = r.runs.map((x) => x.leadTime).filter((x): x is number => x !== null);
                    return (
                      <tr key={r.scenario} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-medium text-slate-100">{r.name}</td>
                        <td className="px-3 py-3 font-mono text-xs text-slate-400">{r.expected.service}<br />{r.expected.hypothesis.replace(/_/g, " ")}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1 font-mono text-xs ${r.diagnosisRate === 1 ? "text-emerald-300" : "text-amber-300"}`}>
                            {r.diagnosisRate === 1 ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                            {Math.round(r.diagnosisRate * r.runs.length)}/{r.runs.length}
                          </span>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-slate-300">{r.timeToDetect != null ? `${r.timeToDetect.toFixed(0)}s` : "—"}</td>
                        <td className="px-3 py-3 font-mono text-xs text-slate-300">{r.timeToDiagnose != null ? `${r.timeToDiagnose.toFixed(0)}s` : "—"}</td>
                        <td className="px-3 py-3 font-mono text-xs text-violet-300">
                          {leads.length ? `${Math.round(leads.reduce((a, b) => a + b, 0) / leads.length)}s` : <span className="text-slate-500" title="No service failed outright when left alone">degraded only</span>}
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-200">{r.strategy ?? "—"}</td>
                        <td className="px-3 py-3 font-mono text-xs">
                          <span className="text-rose-300">{r.availabilityWithout != null ? pct(r.availabilityWithout, 0) : "—"}</span>
                          <span className="text-slate-600"> → </span>
                          <span className="text-emerald-300">{r.availabilityWith != null ? pct(r.availabilityWith, 0) : "—"}</span>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs">
                          <span className="text-rose-300">{r.servicesLostWithout?.toFixed(0) ?? "—"}</span>
                          <span className="text-slate-600"> → </span>
                          <span className="text-emerald-300">{r.servicesLostWith?.toFixed(0) ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-200">{money(r.revenueSaved)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
            <p className="flex items-center gap-1.5 px-1 text-xs text-slate-500">
              <Timer size={12} /> {data.summary.runs} incidents replayed in {data.elapsed}s · seeds {data.seeds.join(", ")} · times in simulated seconds from fault onset · revenue at $48/s checkout throughput.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Big({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="glass px-4 py-3.5">
      <div className="label">{label}</div>
      <div className="mt-1 font-display text-3xl font-semibold tabular-nums" style={{ color: tone ?? "#fff" }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
