import { create } from "zustand";
import type { Catalog, LogLine, Recommendation, ServiceState, Snapshot, Topology, WhatIf } from "./types";

export interface Toast {
  id: number;
  tone: "info" | "success" | "error";
  title: string;
  body?: string;
}

interface State {
  connection: "connecting" | "live" | "offline";
  topology: Topology | null;
  snapshot: Snapshot | null;
  services: Record<string, ServiceState>;
  logs: LogLine[];
  catalog: Catalog | null;
  selected: string | null;
  viewMode: "health" | "risk";
  recommendation: Recommendation | null;
  whatif: WhatIf | null;
  toasts: Toast[];
  setWhatif: (w: WhatIf | null) => void;
  setConnection: (c: State["connection"]) => void;
  ingest: (s: Snapshot) => void;
  setCatalog: (c: Catalog) => void;
  select: (id: string | null) => void;
  setViewMode: (m: State["viewMode"]) => void;
  setRecommendation: (r: Recommendation | null) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

const MAX_LOGS = 600;
let toastSeq = 0;

export const useStore = create<State>((set) => ({
  connection: "connecting",
  topology: null,
  snapshot: null,
  services: {},
  logs: [],
  catalog: null,
  selected: null,
  viewMode: "health",
  recommendation: null,
  whatif: null,
  toasts: [],
  setWhatif: (whatif) => set({ whatif }),
  setConnection: (connection) => set({ connection }),
  ingest: (s) =>
    set((st) => {
      const services: Record<string, ServiceState> = {};
      for (const svc of s.services) services[svc.id] = svc;
      // a reset rewinds the tick counter: drop stale logs
      const rewound = st.snapshot && s.tick < st.snapshot.tick;
      const base = rewound ? [] : st.logs;
      const logs = s.logs?.length ? [...base, ...s.logs].slice(-MAX_LOGS) : base;
      return {
        snapshot: s,
        services,
        logs,
        topology: s.topology ?? st.topology,
        recommendation: rewound ? null : st.recommendation,
        whatif: rewound ? null : st.whatif,
      };
    }),
  setCatalog: (catalog) => set({ catalog }),
  select: (selected) => set({ selected }),
  setViewMode: (viewMode) => set({ viewMode }),
  setRecommendation: (recommendation) => set({ recommendation }),
  toast: (t) => {
    const id = ++toastSeq;
    set((st) => ({ toasts: [...st.toasts, { ...t, id }].slice(-4) }));
    setTimeout(() => set((st) => ({ toasts: st.toasts.filter((x) => x.id !== id) })), 4800);
  },
  dismiss: (id) => set((st) => ({ toasts: st.toasts.filter((x) => x.id !== id) })),
}));
