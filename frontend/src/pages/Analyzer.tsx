import clsx from "clsx";
import { FileSearch, FileUp, Lightbulb, Network, ScanSearch, Sparkles, Target } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Empty, Meter, Panel, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { pct, riskColor } from "../lib/format";
import { useStore } from "../lib/store";
import type { LogAnalysis } from "../lib/types";

const MAX_BYTES = 15 * 1024 * 1024;

export default function Analyzer() {
  const catalog = useStore((s) => s.catalog);
  const toast = useStore((s) => s.toast);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<LogAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [sample, setSample] = useState("db-pool-exhaustion");
  const input = useRef<HTMLInputElement>(null);

  const analyse = async (body: string) => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      setResult(await api.analyzeLogs(body));
    } catch (e) {
      toast({ tone: "error", title: "Analysis failed", body: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const loadFile = async (f: File) => {
    if (f.size > MAX_BYTES) {
      toast({ tone: "error", title: "File too large", body: "Logs up to 15 MB are supported in the browser." });
      return;
    }
    const body = await f.text();
    setFileName(f.name);
    setText(body);
    analyse(body);
  };

  const loadSample = async (id: string = sample) => {
    setBusy(true);
    try {
      const body = await api.sampleLog(id);
      setFileName(`riptide-sample-${id}.log`);
      setText(body);
      setResult(await api.analyzeLogs(body));
    } catch (e) {
      toast({ tone: "error", title: "Could not generate sample", body: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  // deep link: /analyzer?sample=<scenario> generates and analyses a sample log on arrival
  const [params] = useSearchParams();
  const autoSample = useRef(false);
  useEffect(() => {
    const id = params.get("sample");
    if (id && !autoSample.current) {
      autoSample.current = true;
      setSample(id);
      loadSample(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const lineCount = useMemo(() => (text ? text.split("\n").length : 0), [text]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-4">
        <div className="glass p-5">
          <div className="label">Log Analyzer</div>
          <h1 className="mt-1 font-display text-2xl font-semibold text-white">Bring your own logs</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Drop a production log file. Riptide infers the service dependency graph from upstream references, detects failure precursors (heap pressure, pool exhaustion, retry storms, crash loops) and ranks the most likely root cause.
          </p>
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files?.[0];
                if (f) loadFile(f);
              }}
              className={clsx(
                "flex min-h-[150px] flex-col rounded-xl border border-dashed p-3 transition",
                drag ? "border-tide-400 bg-tide-400/[0.06]" : "border-white/15 bg-white/[0.02]",
              )}
            >
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setFileName(null);
                }}
                placeholder={"Paste logs here, or drop a .log / .txt file.\n2026-10-25T08:01:12Z ERROR [orders] upstream request to postgres-primary timed out after 3000ms"}
                className="min-h-[110px] flex-1 resize-y bg-transparent font-mono text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none"
                spellCheck={false}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input ref={input} type="file" accept=".log,.txt,.json,.out,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
                <button className="btn-ghost text-xs" onClick={() => input.current?.click()}>
                  <FileUp size={14} /> Choose file
                </button>
                <button className="btn-primary text-xs" disabled={busy || !text.trim()} onClick={() => analyse(text)}>
                  {busy ? <Spinner /> : <ScanSearch size={14} />} Analyse
                </button>
                <span className="ml-auto font-mono text-[11px] text-slate-500">{fileName ?? (lineCount ? `${lineCount.toLocaleString()} lines` : "")}</span>
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.025] p-4 ring-1 ring-white/[0.05]">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                <Sparkles size={15} className="text-violet-300" /> No logs handy?
              </div>
              <p className="mt-1 text-xs text-slate-400">Generate a realistic 2.5-minute log from a fresh digital twin running a failure scenario.</p>
              <select
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                className="mt-3 w-full rounded-lg border border-white/10 bg-abyss-800 px-2.5 py-2 text-sm text-slate-200 focus:outline-none"
                aria-label="Sample scenario"
              >
                {catalog?.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button className="btn-ghost mt-2 w-full text-xs" disabled={busy} onClick={() => loadSample()}>
                {busy ? <Spinner /> : <FileSearch size={14} />} Generate &amp; analyse
              </button>
            </div>
          </div>
        </div>

        {!result && !busy && (
          <Panel>
            <Empty icon={<FileSearch size={20} />} title="Waiting for logs" body="Results appear here: risk-ranked services, inferred dependencies, error timeline and recommended fixes." />
          </Panel>
        )}
        {busy && !result && (
          <div className="glass grid h-48 place-items-center">
            <Spinner className="h-6 w-6 text-tide-300" />
          </div>
        )}
        {result && <Results r={result} />}
      </div>
    </div>
  );
}

function Results({ r }: { r: LogAnalysis }) {
  const totalErrors = r.services.reduce((a, s) => a + s.errors, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Lines parsed", r.linesParsed.toLocaleString()],
          ["Services found", `${r.services.length}`],
          ["Errors", totalErrors.toLocaleString()],
          ["Dependencies inferred", `${r.edges.length}`],
        ].map(([k, v]) => (
          <div key={k} className="glass px-4 py-3">
            <div className="label">{k}</div>
            <div className="mt-1 font-display text-2xl font-semibold text-white">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          {r.rootCause && (
            <div className="rounded-2xl bg-gradient-to-br from-rose-500/[0.09] via-transparent to-violet-500/[0.06] p-5 ring-1 ring-rose-400/20">
              <div className="flex items-center gap-2 text-rose-200/80">
                <Target size={15} /> <span className="label text-rose-200/80">Probable origin</span>
              </div>
              <div className="mt-1 font-display text-2xl font-semibold text-white">{r.rootCause.service}</div>
              <div className="mt-1 text-sm text-slate-300">
                {r.rootCause.errors} errors · first service to fail · referenced {r.rootCause.referencedBy}× as an upstream by others
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.rootCause.patterns.map((p) => (
                  <span key={p.key} className="chip bg-white/[0.05] text-slate-200 ring-white/10">{p.label} · {p.count}</span>
                ))}
              </div>
              {r.recommendations.length > 0 && (
                <div className="mt-4 space-y-2">
                  {r.recommendations.map((rec, i) => (
                    <div key={i} className="flex gap-2.5 rounded-lg bg-abyss-950/50 px-3 py-2 ring-1 ring-white/[0.05]">
                      <Lightbulb size={15} className="mt-0.5 shrink-0 text-amber-300" />
                      <div className="text-sm text-slate-200">
                        <span className="text-slate-400">{rec.pattern}: </span>
                        {rec.action}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <Panel title="Error timeline">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={r.errorTimeline} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(b: string) => (b.length > 10 ? b.slice(11) : b)} minTickGap={24} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0b1324", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, fontSize: 11 }} cursor={{ fill: "rgba(255,255,255,.03)" }} />
                  <Bar isAnimationActive={false} dataKey="errors" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Services by failure risk" bodyClassName="p-2">
            <div className="divide-y divide-white/[0.04]">
              {r.services.map((s) => (
                <details key={s.service} className="group px-2 py-2.5">
                  <summary className="flex cursor-pointer list-none items-center gap-3">
                    <span className="w-36 shrink-0 truncate font-mono text-sm text-slate-200">{s.service}</span>
                    <Meter value={s.risk} color={riskColor(s.risk)} />
                    <span className="w-12 shrink-0 text-right font-mono text-xs" style={{ color: riskColor(s.risk) }}>{pct(s.risk, 0)}</span>
                    <span className="hidden w-28 shrink-0 text-right text-[11px] text-slate-500 sm:block">{s.errors} err · {s.warnings} warn</span>
                  </summary>
                  <div className="mt-2 space-y-2 pl-1">
                    <div className="flex flex-wrap gap-1">
                      {s.patterns.map((p) => (
                        <span key={p.key} className="chip bg-white/[0.04] text-slate-300 ring-white/10">{p.label} · {p.count}</span>
                      ))}
                    </div>
                    {s.samples.map((line, i) => (
                      <div key={i} className="break-all rounded bg-abyss-950/60 px-2 py-1 font-mono text-[10.5px] text-slate-400">{line}</div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </Panel>
        </div>

        <Panel title="Inferred dependency graph" icon={<Network size={15} />}>
          <DependencyGraph r={r} />
          <p className="mt-2 text-xs text-slate-500">Edges come from upstream references in error messages. Thicker means more often referenced. Node colour shows failure risk.</p>
        </Panel>
      </div>
    </div>
  );
}

function DependencyGraph({ r }: { r: LogAnalysis }) {
  const nodes = r.services.slice(0, 24);
  const size = 380;
  const c = size / 2;
  const pos = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n, i) => {
      const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      out[n.service] = { x: c + Math.cos(a) * (c - 56), y: c + Math.sin(a) * (c - 56) };
    });
    return out;
  }, [nodes, c]);
  const maxCount = Math.max(1, ...r.edges.map((e) => e.count));
  if (nodes.length === 0) return <div className="text-sm text-slate-500">No services detected.</div>;
  return (
    <svg viewBox={`-90 0 ${size + 180} ${size}`} className="w-full" role="img" aria-label="Inferred service dependency graph">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
        </marker>
      </defs>
      {r.edges.map((e, i) => {
        const a = pos[e.source];
        const b = pos[e.target];
        if (!a || !b) return null;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const pad = 10;
        return (
          <line
            key={i}
            x1={a.x + (dx / len) * pad}
            y1={a.y + (dy / len) * pad}
            x2={b.x - (dx / len) * (pad + 2)}
            y2={b.y - (dy / len) * (pad + 2)}
            stroke="#64748b"
            strokeOpacity={0.35 + (e.count / maxCount) * 0.5}
            strokeWidth={0.8 + (e.count / maxCount) * 2.4}
            markerEnd="url(#arrow)"
          />
        );
      })}
      {nodes.map((n) => {
        const p = pos[n.service];
        const isRoot = r.rootCause?.service === n.service;
        return (
          <g key={n.service}>
            {isRoot && <circle cx={p.x} cy={p.y} r={14} fill="none" stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="3 2" />}
            <circle cx={p.x} cy={p.y} r={8} fill={riskColor(n.risk)} fillOpacity={0.9} />
            <text
              x={p.x + (p.x >= c ? 13 : -13)}
              y={p.y + 3.5}
              fontSize={10}
              fontFamily="JetBrains Mono, monospace"
              textAnchor={p.x >= c ? "start" : "end"}
              fill="#cbd5e1"
            >
              {n.service}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
