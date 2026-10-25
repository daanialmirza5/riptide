import type { Benchmark, Catalog, Incident, IncidentStats, LogAnalysis, LogLine, Recommendation, ServiceDetail, Topology, WhatIf } from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* non-JSON error */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  topology: () => request<Topology>("/api/topology"),
  catalog: () => request<Catalog>("/api/catalog"),
  injectScenario: (id: string) => post<{ injected: string }>(`/api/scenarios/${id}`),
  injectFault: (kind: string, target: string, rate = 1) => post("/api/faults", { kind, target, rate }),
  control: (action: "pause" | "resume" | "reset" | "speed" | "step", speed?: number) =>
    post<{ paused: boolean; speed: number }>("/api/control", { action, speed }),
  service: (id: string) => request<ServiceDetail>(`/api/services/${id}`),
  logs: (params: Record<string, string>) =>
    request<{ logs: LogLine[] }>(`/api/logs?${new URLSearchParams(params).toString()}`),
  evaluate: () => post<Recommendation>("/api/recovery/evaluate"),
  apply: (strategyId: string) => post<{ applied: string[]; strategy: string }>("/api/recovery/apply", { strategyId }),
  action: (kind: string, target: string) => post<{ applied: string[] }>("/api/actions", { kind, target }),
  autopilot: (enabled: boolean) => post<{ autopilot: boolean }>("/api/autopilot", { enabled }),
  whatif: (service: string) => post<WhatIf>(`/api/whatif/${service}`),
  benchmark: (refresh = false) =>
    request<{ status: "idle" | "running" | "ready" | "error"; result: Benchmark | null }>(`/api/benchmark${refresh ? "?refresh=true" : ""}`),
  incidents: () => request<{ incidents: Incident[]; stats: IncidentStats }>("/api/incidents"),
  reportUrl: (id: string) => `${BASE}/api/incidents/${id}/report`,
  analyzeLogs: (text: string) => post<LogAnalysis>("/api/analyze/logs", { text }),
  sampleLog: (scenario: string) => request<string>(`/api/analyze/sample?scenario=${scenario}`),
  wsUrl: () => {
    if (BASE) return BASE.replace(/^http/, "ws") + "/ws";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/ws`;
  },
};
