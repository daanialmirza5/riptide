import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Bot, Siren, Sparkles } from "lucide-react";
import { lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import ChaosPanel from "../components/console/ChaosPanel";
import { LogStream, SystemChart } from "../components/console/BottomDeck";
import InsightPanel from "../components/console/InsightPanel";
import KpiBar from "../components/console/KpiBar";
import SceneBoundary from "../components/three/SceneBoundary";
import { SevBadge, Spinner } from "../components/ui";
import { pct, secs, STATUS_COLOR } from "../lib/format";
import { useStore } from "../lib/store";

const NetworkScene = lazy(() => import("../components/three/NetworkScene"));

export default function Console() {
  return (
    <div className="relative h-full overflow-y-auto lg:overflow-hidden">
      <div className="relative h-[58vh] min-h-[380px] lg:absolute lg:inset-0 lg:h-auto">
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-tide-300">
              <Spinner className="h-6 w-6" />
            </div>
          }
        >
          <SceneBoundary label="3D topology">
            <NetworkScene />
          </SceneBoundary>
        </Suspense>
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center lg:hidden">
          <Legend />
        </div>
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center lg:hidden">
          <IncidentCallout />
        </div>
      </div>
      <div className="pointer-events-none relative z-10 flex flex-col gap-3 p-3 lg:absolute lg:inset-0 lg:grid lg:grid-cols-[300px_minmax(0,1fr)_380px] lg:grid-rows-[auto_minmax(0,1fr)_232px]">
        <div className="pointer-events-auto lg:col-span-3">
          <KpiBar />
        </div>
        <ChaosPanel className="pointer-events-auto max-h-[480px] lg:max-h-none" />
        <div className="hidden min-h-0 flex-col items-center justify-between lg:flex">
          <IncidentCallout />
          <Legend />
        </div>
        <InsightPanel className="pointer-events-auto max-h-[640px] lg:row-span-2 lg:max-h-none" />
        <div className="pointer-events-auto grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:col-span-2">
          <SystemChart className="h-[232px]" />
          <LogStream className="h-[232px]" />
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const mode = useStore((s) => s.viewMode);
  return (
    <div className="glass mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-2 text-[11px] text-slate-400">
      {mode === "health" ? (
        (["healthy", "degraded", "critical", "down"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5 capitalize">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
            {s}
          </span>
        ))
      ) : (
        <span className="flex items-center gap-2">
          risk
          <span className="h-2 w-24 rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500" />
        </span>
      )}
      <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />request</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" />failure spreading</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-400" />predicted cascade</span>
      <span className="hidden items-center gap-1.5 sm:flex"><span className="h-0.5 w-4 rounded bg-violet-300" />risk ring</span>
    </div>
  );
}

const STAGES = ["Detect", "Predict", "Diagnose", "Recover", "Resolve"] as const;

/** Lights up each stage of the incident as Riptide reaches it. */
function Lifecycle() {
  const inc = useStore((s) => s.snapshot?.incident);
  const actions = useStore((s) => s.snapshot?.actions ?? []);
  if (!inc) return null;
  const kinds = new Set(inc.timeline.map((e) => e.kind));
  const recovering = inc.actions.length > 0 || actions.some((a) => !a.done);
  const reached = [true, kinds.has("predict"), !!inc.rootCause, recovering, inc.status === "resolved"];
  const current = reached.lastIndexOf(true);
  return (
    <ol className="mt-2.5 flex items-center gap-1" aria-label="Incident lifecycle">
      {STAGES.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col gap-1">
          <span
            className={`h-1 rounded-full transition-colors duration-500 ${
              reached[i] ? (i === current && i < 4 ? "animate-pulse bg-cyan-300" : "bg-cyan-400/80") : "bg-white/10"
            }`}
          />
          <span className={`text-[10px] ${reached[i] ? "text-cyan-100" : "text-slate-500"}`}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function IncidentCallout() {
  const snap = useStore((s) => s.snapshot);
  const navigate = useNavigate();
  const inc = snap?.incident;
  const top = snap?.rca.candidates[0];
  const idle = snap && !inc && snap.faults.length === 0;
  return (
    <AnimatePresence mode="wait">
      {inc ? (
        <motion.div
          key="incident"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="glass-strong pointer-events-auto w-full max-w-[640px] border-rose-400/25 px-4 py-2.5"
        >
          <div className="flex items-center gap-3">
          <Siren size={18} className="shrink-0 text-rose-400" />
          <div className="min-w-0 text-sm">
            <div className="flex items-center gap-2">
              <SevBadge sev={inc.severity} />
              <span className="truncate font-medium text-white">{inc.title}</span>
            </div>
            <div className="truncate text-xs text-slate-400">
              {inc.rootCause
                ? `${inc.rootCause.service} · ${pct(inc.rootCause.confidence, 0)} confidence`
                : top
                  ? `${top.service} · ${pct(top.confidence, 0)} confidence`
                  : "diagnosing…"}
              {snap.kpis.timeToImpact !== null && <> · first failure in <span className="text-violet-300">{secs(snap.kpis.timeToImpact)}</span></>}
            </div>
          </div>
          {snap.autopilot ? (
            <span className="chip shrink-0 bg-emerald-400/15 text-emerald-200 ring-emerald-400/30">
              <Bot size={12} /> Autopilot
            </span>
          ) : (
            <button className="btn-primary shrink-0 px-3 py-1.5 text-xs" onClick={() => navigate("/recovery?run=1")}>
              Recover <ArrowRight size={13} />
            </button>
          )}
          </div>
          <Lifecycle />
        </motion.div>
      ) : idle ? (
        <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass flex items-center gap-2 px-4 py-2 text-xs text-slate-300">
          <Sparkles size={14} className="text-tide-300" />
          All 20 services nominal. Inject a scenario from the Chaos lab to watch Riptide predict the cascade.
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
