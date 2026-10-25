import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, CheckCircle2, FileSearch, Info, LifeBuoy, Radar, Siren, Trophy, X, XCircle } from "lucide-react";
import { Suspense } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useStore } from "../lib/store";
import Logo from "./Logo";
import { SevBadge, Spinner } from "./ui";

const NAV = [
  { to: "/console", label: "Command Center", icon: Radar },
  { to: "/recovery", label: "Recovery Lab", icon: LifeBuoy },
  { to: "/incidents", label: "Incidents", icon: Siren },
  { to: "/analyzer", label: "Log Analyzer", icon: FileSearch },
  { to: "/benchmark", label: "Benchmark", icon: Trophy },
];

export default function Shell() {
  const connection = useStore((s) => s.connection);
  const incident = useStore((s) => s.snapshot?.incident ?? null);
  const tick = useStore((s) => s.snapshot?.tick ?? 0);
  const location = useLocation();

  return (
    <div className="flex h-full flex-col">
      <header className="z-30 flex h-14 shrink-0 items-center gap-4 border-b border-white/[0.06] bg-abyss-950/80 px-4 backdrop-blur-xl">
        <NavLink to="/" className="flex items-center gap-2.5">
          <Logo className="h-7 w-7" />
          <span className="font-display text-lg font-semibold tracking-tight text-white">Riptide</span>
        </NavLink>
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition",
                  isActive ? "bg-white/[0.08] text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
                )
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {incident && location.pathname !== "/incidents" && (
            <NavLink
              to="/recovery"
              className="hidden items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-100 transition hover:bg-rose-500/20 lg:flex"
            >
              <SevBadge sev={incident.severity} />
              <span className="max-w-[260px] truncate">{incident.id} · {incident.title}</span>
            </NavLink>
          )}
          <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 font-mono text-xs text-slate-400 ring-1 ring-white/[0.06]">
            <Activity size={13} className={connection === "live" ? "text-emerald-400" : connection === "connecting" ? "text-amber-400" : "text-rose-400"} />
            {connection === "live" ? `LIVE · t+${tick}s` : connection === "connecting" ? "CONNECTING" : "OFFLINE — retrying"}
          </div>
        </div>
      </header>
      <main className="relative min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-tide-300">
              <Spinner className="h-6 w-6" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
      <nav className="flex shrink-0 justify-around border-t border-white/[0.06] bg-abyss-950/90 py-1.5 md:hidden">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => clsx("flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px]", isActive ? "text-tide-300" : "text-slate-500")}
          >
            <Icon size={18} />
            {label.split(" ")[0]}
          </NavLink>
        ))}
      </nav>
      <Toasts />
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? XCircle : Info;
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              className="glass-strong pointer-events-auto flex items-start gap-3 p-3"
            >
              <Icon size={18} className={t.tone === "success" ? "text-emerald-400" : t.tone === "error" ? "text-rose-400" : "text-tide-300"} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-100">{t.title}</div>
                {t.body && <div className="mt-0.5 text-xs text-slate-400">{t.body}</div>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-slate-500 hover:text-slate-300" aria-label="Dismiss">
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
