import { motion } from "framer-motion";
import { Activity, ArrowRight, Bomb, Bot, BrainCircuit, Trophy, Database, FileSearch, GitFork, LineChart, Radar, Server, ShieldCheck, Sparkles, Waves } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import SceneBoundary from "../components/three/SceneBoundary";
import { api } from "../lib/api";
import { pct } from "../lib/format";
import { useStore } from "../lib/store";
import type { Benchmark } from "../lib/types";

const HeroScene = lazy(() => import("../components/three/HeroScene"));

const STEPS = [
  {
    icon: Activity,
    title: "Observe",
    body: "Streams per-service metrics and logs from the live system and learns a healthy baseline for each one, unpolluted by incidents.",
  },
  {
    icon: LineChart,
    title: "Predict",
    body: "Trend regression estimates each service's time to failure, then noisy-OR propagation across the dependency graph forecasts the cascade wavefront.",
  },
  {
    icon: BrainCircuit,
    title: "Diagnose",
    body: "Personalised PageRank over the anomalous subgraph, plus onset ordering and change events, ranks root causes with explainable evidence.",
  },
  {
    icon: GitFork,
    title: "Simulate & recover",
    body: "Forks a digital twin for every candidate fix, simulates two minutes ahead, and ranks strategies by availability, recovery time, blast radius and risk.",
  },
];

export default function Landing() {
  const snap = useStore((s) => s.snapshot);
  const connection = useStore((s) => s.connection);
  const [bench, setBench] = useState<Benchmark["summary"] | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      api
        .benchmark()
        .then((r) => {
          if (!live) return;
          if (r.result) setBench(r.result.summary);
          else if (r.status === "running") timer = setTimeout(load, 3000);
        })
        .catch(() => undefined);
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  return (
    <div className="h-full overflow-y-auto">
      <section className="relative h-[100svh] min-h-[640px] overflow-hidden">
        <div className="absolute inset-0">
          <Suspense fallback={null}>
            <SceneBoundary label="Hero animation">
              <HeroScene />
            </SceneBoundary>
          </Suspense>
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-abyss-950/30 via-transparent to-abyss-950" />
        <header className="relative z-10 mx-auto flex max-w-7xl items-center gap-3 px-5 py-5">
          <Logo className="h-8 w-8" />
          <span className="font-display text-xl font-semibold text-white">Riptide</span>
          <nav className="ml-8 hidden gap-6 text-sm text-slate-400 md:flex">
            <a href="#how" className="hover:text-white">How it works</a>
            <a href="#architecture" className="hover:text-white">Architecture</a>
            <Link to="/analyzer" className="hover:text-white">Log analyzer</Link>
          </nav>
          <Link to="/console" className="btn-primary ml-auto">
            Launch console <ArrowRight size={15} />
          </Link>
        </header>

        <div className="relative z-10 mx-auto flex h-[calc(100%-80px)] max-w-7xl flex-col justify-center px-5 pb-24">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="max-w-2xl">
            <div className="glass inline-flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300">
              <span className={`h-2 w-2 rounded-full ${connection === "live" ? "bg-emerald-400" : "bg-amber-400"}`} />
              {connection === "live" && snap
                ? `Live digital twin · ${snap.services.length} services · health ${pct(snap.kpis.health, 0)}`
                : "Connecting to the live digital twin…"}
            </div>
            <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl">
              See the outage <span className="text-gradient">before it cascades.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
              Riptide predicts which services will fail next, traces the failure back to its root cause and simulates every recovery strategy, so you can act while the system is still standing.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/console" className="btn-primary px-5 py-3 text-base">
                <Radar size={18} /> Open Command Center
              </Link>
              <Link to="/analyzer" className="btn-ghost px-5 py-3 text-base">
                <FileSearch size={18} /> Analyse your logs
              </Link>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
            className="mt-14 grid max-w-3xl grid-cols-3 gap-3"
          >
            {(bench
              ? [
                  ["Root cause accuracy", pct(bench.diagnosisAccuracy, 0), `${bench.runs} replayed incidents`],
                  ["Warning before failure", bench.meanLeadTime != null ? `${Math.round(bench.meanLeadTime)}s` : "—", "mean lead time, measured"],
                  ["Availability kept", bench.availabilityWith != null ? pct(bench.availabilityWith, 0) : "—", `vs ${bench.availabilityWithout != null ? pct(bench.availabilityWithout, 0) : "—"} doing nothing`],
                ]
              : [
                  ["Forecast horizon", "120s", "time-to-failure per service"],
                  ["Failure classes", "7 / 7", "diagnosed in automated tests"],
                  ["Recovery options", "up to 7", "futures simulated per incident"],
                ]
            ).map(([k, v, d]) => (
              <div key={k} className="glass px-4 py-3">
                <div className="font-display text-2xl font-semibold text-white">{v}</div>
                <div className="text-xs font-medium text-slate-300">{k}</div>
                <div className="hidden text-[11px] text-slate-500 sm:block">{d}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      <section id="how" className="grid-bg relative border-t border-white/[0.05] py-24">
        <div className="mx-auto max-w-7xl px-5">
          <div className="label text-tide-300">How it works</div>
          <h2 className="mt-2 max-w-2xl font-display text-4xl font-semibold text-white">From the first faint signal to a verified fix</h2>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: i * 0.08 }}
                className="glass relative p-6"
              >
                <div className="flex items-center justify-between">
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-violet-500/20 text-tide-300 ring-1 ring-white/10">
                    <Icon size={20} />
                  </div>
                  <span className="font-mono text-xs text-slate-600">0{i + 1}</span>
                </div>
                <h3 className="mt-5 font-display text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
              </motion.div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {[
              { icon: Bot, title: "Autopilot", body: "Flip one switch and Riptide closes the loop: detect, diagnose, simulate and execute the best fix with no human in the way.", to: "/console" },
              { icon: Bomb, title: "What-if blast radius", body: "Click any service and ask what happens if it dies. The forked twin plays out the cascade and rings every casualty in 3D.", to: "/console" },
              { icon: Trophy, title: "Measured, not claimed", body: "A built-in benchmark replays every failure class on independent twins and reports accuracy, warning lead time and availability saved.", to: "/benchmark" },
            ].map(({ icon: Icon, title, body, to }) => (
              <Link key={title} to={to} className="glass group flex gap-4 p-5 transition hover:ring-1 hover:ring-cyan-400/30">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-violet-300 ring-1 ring-white/10">
                  <Icon size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 font-display font-semibold text-white">
                    {title} <ArrowRight size={14} className="opacity-0 transition group-hover:opacity-100" />
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">{body}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="architecture" className="border-t border-white/[0.05] py-24">
        <div className="mx-auto max-w-7xl px-5">
          <div className="label text-tide-300">Architecture</div>
          <h2 className="mt-2 font-display text-4xl font-semibold text-white">One engine, four intelligence layers</h2>
          <div className="mt-12 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1.4fr_auto_1fr]">
            <ArchCol
              title="Signals"
              items={[
                { icon: Server, label: "20-service digital twin", sub: "metrics @ 1 Hz" },
                { icon: Waves, label: "Structured log stream", sub: "INFO → FATAL" },
                { icon: FileSearch, label: "Uploaded log files", sub: "bring your own" },
              ]}
            />
            <Arrow />
            <div className="glass p-5 ring-1 ring-cyan-400/20">
              <div className="label">Riptide engine · FastAPI</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  ["Baseline learner", "EWMA per metric"],
                  ["Failure predictor", "trend ETA + noisy-OR graph"],
                  ["Root-cause ranker", "PageRank + causal heuristics"],
                  ["Recovery lab", "counterfactual twin forks"],
                  ["Incident manager", "timeline, lead time, MTTR"],
                  ["Log intelligence", "pattern + dependency mining"],
                ].map(([a, b]) => (
                  <div key={a} className="rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/[0.05]">
                    <div className="text-sm font-medium text-slate-100">{a}</div>
                    <div className="text-[11px] text-slate-500">{b}</div>
                  </div>
                ))}
              </div>
            </div>
            <Arrow />
            <ArchCol
              title="Experience"
              items={[
                { icon: Radar, label: "3D command center", sub: "WebSocket, 1 Hz" },
                { icon: ShieldCheck, label: "Recovery decisions", sub: "simulate → apply" },
                { icon: Database, label: "Post-mortems", sub: "markdown export" },
              ]}
            />
          </div>
        </div>
      </section>

      <section className="border-t border-white/[0.05] py-20">
        <div className="mx-auto flex max-w-4xl flex-col items-center px-5 text-center">
          <Sparkles className="text-violet-300" />
          <h2 className="mt-4 font-display text-4xl font-semibold text-white">Break something. Watch Riptide catch it.</h2>
          <p className="mt-3 max-w-xl text-slate-400">Inject a memory leak, a cache failure or a flash-sale surge into the live twin and follow the prediction, diagnosis and recovery in real time.</p>
          <Link to="/console" className="btn-primary mt-8 px-6 py-3 text-base">
            Enter the Command Center <ArrowRight size={16} />
          </Link>
        </div>
      </section>
      <footer className="border-t border-white/[0.05] py-8 text-center text-xs text-slate-600">Riptide · cascading failure intelligence</footer>
    </div>
  );
}

function ArchCol({ title, items }: { title: string; items: { icon: typeof Server; label: string; sub: string }[] }) {
  return (
    <div className="glass p-5">
      <div className="label">{title}</div>
      <div className="mt-3 space-y-2">
        {items.map(({ icon: Icon, label, sub }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/[0.05]">
            <Icon size={16} className="text-tide-300" />
            <div>
              <div className="text-sm text-slate-100">{label}</div>
              <div className="text-[11px] text-slate-500">{sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="hidden items-center justify-center text-slate-600 lg:flex">
      <ArrowRight size={22} />
    </div>
  );
}
