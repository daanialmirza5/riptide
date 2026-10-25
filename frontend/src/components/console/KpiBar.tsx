import clsx from "clsx";
import { Bot, Gauge, HeartPulse, Pause, Play, RotateCcw, ShieldCheck, Timer, Waves, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../../lib/api";
import { compact, pct, riskColor, secs } from "../../lib/format";
import { useStore } from "../../lib/store";
import { useCommand } from "../../lib/useCommand";

function Kpi({ label, value, hint, icon, tone, emphasis }: { label: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; tone?: string; emphasis?: boolean }) {
  return (
    <div className={clsx("glass flex min-w-0 items-center gap-3 px-3.5 py-2.5", emphasis && "ring-1 ring-rose-400/40")}>
      <div className="hidden h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] sm:grid 2xl:hidden min-[1780px]:grid" style={{ color: tone }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="label truncate">{label}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-xl font-semibold tabular-nums text-white" style={tone ? { color: tone } : undefined}>
            {value}
          </span>
          {hint && <span className="truncate text-[11px] text-slate-500">{hint}</span>}
        </div>
      </div>
    </div>
  );
}

export default function KpiBar() {
  const snap = useStore((s) => s.snapshot);
  const mode = useStore((s) => s.viewMode);
  const setMode = useStore((s) => s.setViewMode);
  const control = useCommand(api.control, (_, [action]) => (action === "reset" ? "Digital twin reset to a healthy baseline" : null));
  const autopilot = useCommand(api.autopilot, (r) =>
    r.autopilot ? "Autopilot engaged. Riptide will heal incidents on its own" : "Autopilot off. Recommendations need your approval",
  );
  if (!snap) {
    return <div className="glass h-[62px] animate-pulse" />;
  }
  const k = snap.kpis;
  const crash = k.crashProbability;
  return (
    <div className="flex flex-col gap-3 xl:flex-row">
      <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        <Kpi label="System health" value={pct(k.health, 0)} icon={<HeartPulse size={18} />} tone={riskColor(1 - k.health)} />
        <Kpi label="Availability" value={pct(k.availability, 1)} hint={k.shed > 0.01 ? `${pct(k.shed, 0)} shed` : "end-to-end"} icon={<ShieldCheck size={18} />} tone={riskColor((1 - k.availability) * 4)} />
        <Kpi label="Crash probability" value={pct(crash, 0)} hint="next 2 min" icon={<Gauge size={18} />} tone={riskColor(crash)} emphasis={crash >= 0.6} />
        <Kpi label="Time to impact" value={secs(k.timeToImpact)} hint={k.timeToImpact !== null ? "predicted" : "no cascade"} icon={<Timer size={18} />} tone={k.timeToImpact !== null ? "#a78bfa" : undefined} />
        <Kpi label="Blast radius" value={k.blastRadius} hint="services at risk" icon={<Zap size={18} />} tone={k.blastRadius ? riskColor(Math.min(1, k.blastRadius / 6)) : undefined} />
        <Kpi label="Throughput" value={`${compact(k.rps)}/s`} hint={`${k.demand.toFixed(2)}x demand`} icon={<Waves size={18} />} tone="#7dd3fc" />
      </div>
      <div className="glass flex items-center gap-1.5 p-2">
        <button
          onClick={() => autopilot.run(!snap.autopilot)}
          disabled={autopilot.pending}
          title="Autopilot: when Riptide is confident, it simulates the options and executes the best recovery on its own"
          className={clsx(
            "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 transition",
            snap.autopilot
              ? "bg-emerald-400/15 text-emerald-200 ring-emerald-400/40 shadow-[0_0_18px_-4px_rgba(52,211,153,.6)]"
              : "bg-white/[0.04] text-slate-300 ring-white/10 hover:bg-white/[0.08]",
          )}
        >
          <Bot size={14} className={snap.autopilot ? "animate-pulse" : undefined} />
          Autopilot {snap.autopilot ? "on" : "off"}
        </button>
        <div className="flex rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06]" role="group" aria-label="Colour nodes by">
          {(["health", "risk"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={clsx("rounded-md px-2.5 py-1 text-xs capitalize transition", mode === m ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200")}
            >
              {m}
            </button>
          ))}
        </div>
        <button className="btn-ghost h-8 w-8 p-0" title={snap.paused ? "Resume" : "Pause"} onClick={() => control.run(snap.paused ? "resume" : "pause")}>
          {snap.paused ? <Play size={15} /> : <Pause size={15} />}
        </button>
        <select
          aria-label="Simulation speed"
          className="h-8 rounded-lg border border-white/10 bg-abyss-800 px-2 text-xs text-slate-200 focus:outline-none"
          value={snap.speed}
          onChange={(e) => control.run("speed", Number(e.target.value))}
        >
          {[0.5, 1, 2, 4].map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
        <button className="btn-ghost h-8 w-8 p-0" title="Reset digital twin" onClick={() => control.run("reset")}>
          <RotateCcw size={15} />
        </button>
      </div>
    </div>
  );
}
