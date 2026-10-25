import clsx from "clsx";
import { Cloud, Database, Eye, EyeOff, FlaskConical, GitBranch, Rocket, TrendingUp, Wrench } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useCommand } from "../../lib/useCommand";
import { Meter, Panel, Spinner } from "../ui";

const CATEGORY_ICON: Record<string, typeof Database> = {
  Application: Rocket,
  Data: Database,
  Change: GitBranch,
  Traffic: TrendingUp,
  External: Cloud,
};

const SEVERITY_TONE: Record<string, string> = {
  critical: "text-rose-300 bg-rose-500/10 ring-rose-400/30",
  high: "text-orange-300 bg-orange-500/10 ring-orange-400/30",
  medium: "text-amber-200 bg-amber-500/10 ring-amber-400/25",
};

export default function ChaosPanel({ className }: { className?: string }) {
  const catalog = useStore((s) => s.catalog);
  const faults = useStore((s) => s.snapshot?.faults ?? []);
  const actions = useStore((s) => s.snapshot?.actions ?? []);
  const [reveal, setReveal] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const inject = useCommand(api.injectScenario, (_, [id]) => `Chaos injected: ${catalog?.scenarios.find((s) => s.id === id)?.name ?? id}`);
  const running = actions.filter((a) => !a.done);

  return (
    <Panel title="Chaos lab" icon={<FlaskConical size={16} />} className={className} bodyClassName="flex min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        <p className="px-1 pb-1 text-xs leading-relaxed text-slate-400">
          Inject a real-world failure into the digital twin. Riptide never sees what you injected, only metrics and logs.
        </p>
        {!catalog && <div className="h-40 animate-pulse rounded-xl bg-white/[0.03]" />}
        {catalog?.scenarios.map((s) => {
          const Icon = CATEGORY_ICON[s.category] ?? Wrench;
          return (
            <button
              key={s.id}
              disabled={busy !== null}
              onClick={async () => {
                setBusy(s.id);
                await inject.run(s.id);
                setBusy(null);
              }}
              className="group w-full rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:border-tide-400/30 hover:bg-tide-400/[0.05] disabled:opacity-60"
            >
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-tide-300 ring-1 ring-white/[0.06] group-hover:text-tide-300">
                  {busy === s.id ? <Spinner className="h-3.5 w-3.5" /> : <Icon size={15} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-100">{s.name}</div>
                  <div className="text-[11px] text-slate-500">{s.category} · {s.targets.join(", ")}</div>
                </div>
                <span className={clsx("chip", SEVERITY_TONE[s.severity])}>{s.severity}</span>
              </div>
              <p className="mt-2 hidden text-xs leading-relaxed text-slate-400 group-hover:block">{s.summary}</p>
            </button>
          );
        })}
      </div>
      {(faults.length > 0 || running.length > 0) && (
        <div className="space-y-2 border-t border-white/[0.06] p-3">
          {faults.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label">Ground truth</span>
                <button className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300" onClick={() => setReveal((r) => !r)}>
                  {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
                  {reveal ? "hide" : "reveal"}
                </button>
              </div>
              {reveal ? (
                faults.map((f) => (
                  <div key={f.id} className="flex items-center justify-between rounded-lg bg-rose-500/[0.07] px-2.5 py-1.5 text-xs ring-1 ring-rose-400/20">
                    <span className="text-rose-200">{f.label} · {f.target}</span>
                    <span className="font-mono text-rose-300/70">{f.age}s</span>
                  </div>
                ))
              ) : (
                <div className="rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-xs text-slate-500">{faults.length} hidden fault(s)</div>
              )}
            </div>
          )}
          {running.map((a) => (
            <div key={a.id} className="rounded-lg bg-cyan-500/[0.06] px-2.5 py-2 ring-1 ring-cyan-400/20">
              <div className="mb-1.5 flex justify-between text-xs">
                <span className="truncate text-cyan-100">{a.label}</span>
                <span className="font-mono text-cyan-300/70">{Math.round(a.progress * 100)}%</span>
              </div>
              <Meter value={a.progress} color="#22d3ee" />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
