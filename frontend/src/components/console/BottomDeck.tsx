import clsx from "clsx";
import { Activity, Pause, Play, ScrollText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { clock } from "../../lib/format";
import { useStore } from "../../lib/store";
import { Panel } from "../ui";

const LEVEL_TONE: Record<string, string> = {
  INFO: "text-slate-500",
  WARN: "text-amber-300",
  ERROR: "text-rose-400",
  FATAL: "text-rose-300 font-semibold",
};

export function SystemChart({ className }: { className?: string }) {
  const history = useStore((s) => s.snapshot?.history ?? []);
  return (
    <Panel title="Platform pulse" icon={<Activity size={15} />} className={className} bodyClassName="px-2 pb-2 pt-1">
      <div className="h-full min-h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="g-health" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#22d3ee" stopOpacity={0.35} />
                <stop offset="1" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="g-crash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f43f5e" stopOpacity={0.35} />
                <stop offset="1" stopColor="#f43f5e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
            <XAxis dataKey="tick" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} tickFormatter={(t) => `${t}s`} />
            <YAxis domain={[0, 1]} tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v * 100)}`} />
            <Tooltip
              contentStyle={{ background: "#0b1324", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, fontSize: 11 }}
              labelFormatter={(t) => `t+${t}s`}
              formatter={(v: number, name: string) => [`${(v * 100).toFixed(1)}%`, name]}
            />
            <Area name="Health" type="monotone" dataKey="health" stroke="#22d3ee" strokeWidth={1.6} fill="url(#g-health)" isAnimationActive={false} />
            <Line name="Availability" type="monotone" dataKey="availability" stroke="#34d399" strokeWidth={1.2} dot={false} isAnimationActive={false} />
            <Area name="Crash probability" type="monotone" dataKey="crash" stroke="#f43f5e" strokeWidth={1.6} fill="url(#g-crash)" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export function LogStream({ className }: { className?: string }) {
  const logs = useStore((s) => s.logs);
  const selected = useStore((s) => s.selected);
  const [level, setLevel] = useState<"all" | "warn">("warn");
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const shown = useMemo(
    () => logs.filter((l) => (level === "all" || l.level !== "INFO") && (!selected || l.service === selected)).slice(-200),
    [logs, level, selected],
  );
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown, follow]);

  return (
    <Panel
      title={<span>Live logs {selected && <span className="ml-1 font-mono text-xs text-tide-300">· {selected}</span>}</span>}
      icon={<ScrollText size={15} />}
      className={className}
      bodyClassName="min-h-0 p-0"
      actions={
        <div className="flex items-center gap-1">
          {(["warn", "all"] as const).map((l) => (
            <button key={l} onClick={() => setLevel(l)} className={clsx("rounded-md px-2 py-0.5 text-[11px]", level === l ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300")}>
              {l === "warn" ? "warn+" : "all"}
            </button>
          ))}
          <button onClick={() => setFollow((f) => !f)} className="ml-1 rounded-md p-1 text-slate-500 hover:text-slate-300" title={follow ? "Pause auto-scroll" : "Follow"}>
            {follow ? <Pause size={12} /> : <Play size={12} />}
          </button>
        </div>
      }
    >
      <div ref={box} className="h-full overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.6]">
        {shown.length === 0 && <div className="py-6 text-center text-slate-600">Quiet. No {level === "warn" ? "warnings or errors" : "logs"} yet.</div>}
        {shown.map((l) => (
          <div key={l.id} className="flex gap-2 hover:bg-white/[0.02]">
            <span className="shrink-0 text-slate-600">{clock(l.ts)}</span>
            <span className={clsx("w-10 shrink-0", LEVEL_TONE[l.level])}>{l.level}</span>
            <span className="w-28 shrink-0 truncate text-tide-300/80">{l.service}</span>
            <span className="min-w-0 truncate text-slate-300" title={l.message}>{l.message}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
