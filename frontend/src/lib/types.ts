export type Status = "healthy" | "degraded" | "critical" | "down";

export interface ServiceSpec {
  id: string;
  name: string;
  kind: "edge" | "app" | "data" | "external";
  tier: number;
  team: string;
  importance: number;
  description: string;
  baseLatency: number;
  baseRps: number;
}

export interface Edge {
  source: string;
  target: string;
  weight: number;
}

export interface Topology {
  services: ServiceSpec[];
  edges: Edge[];
}

export interface ServiceState {
  id: string;
  status: Status;
  health: number;
  cpu: number;
  memory: number;
  latency: number;
  errorRate: number;
  saturation: number;
  rps: number;
  replicas: number;
  version: string;
  restarting: boolean;
  breaker: boolean;
  risk: number;
  eta: number | null;
  anomaly: number;
  drivers: string[];
  via: string | null;
  baseLatency: number;
}

export interface Evidence {
  kind: "metric" | "event" | "change" | "anomaly" | "log" | "topology";
  text: string;
  weight: number;
}

export interface RcaCandidate {
  service: string;
  score: number;
  confidence: number;
  hypothesis: string;
  hypothesisLabel: string;
  evidence: Evidence[];
  components: Record<string, number>;
  onsetTick: number;
  impacted: string[];
  path: string[];
}

export interface Rca {
  status: "nominal" | "incident";
  candidates: RcaCandidate[];
  anomalous: string[];
}

export interface TimelineEvent {
  tick: number;
  ts: string;
  kind: string;
  text: string;
  service: string | null;
}

export interface Incident {
  id: string;
  openedTick: number;
  openedTs: string;
  closedTick: number | null;
  closedTs: string | null;
  severity: "SEV1" | "SEV2" | "SEV3";
  status: "open" | "mitigating" | "resolved";
  title: string;
  rootCause: { service: string; hypothesis: string; hypothesisLabel: string; confidence: number } | null;
  timeline: TimelineEvent[];
  peakRisk: number;
  peakFailed: number;
  actions: string[];
  leadTimes: Record<string, number>;
  avgLeadTime: number | null;
  predictedServices: string[];
  failedServices: string[];
  prevented: string[];
  duration: number | null;
}

export interface IncidentStats {
  total: number;
  open: number;
  mttr: number | null;
  avgLeadTime: number | null;
  predictedFailures: number;
  failuresPrevented: number;
}

export interface LogLine {
  id: number;
  tick: number;
  ts: string;
  service: string;
  level: "INFO" | "WARN" | "ERROR" | "FATAL";
  message: string;
  traceId: string;
}

export interface HistoryPoint {
  tick: number;
  health: number;
  availability: number;
  risk: number;
  crash: number;
  rps: number;
}

export interface Snapshot {
  type: "tick" | "hello";
  tick: number;
  ts: string;
  paused: boolean;
  speed: number;
  autopilot: boolean;
  autopilotLog: AutopilotEntry[];
  kpis: {
    health: number;
    availability: number;
    crashProbability: number;
    systemRisk: number;
    timeToImpact: number | null;
    blastRadius: number;
    demand: number;
    shed: number;
    rps: number;
  };
  services: ServiceState[];
  wavefront: { service: string; eta: number | null; risk: number; via: string | null }[];
  rca: Rca;
  faults: { id: string; kind: string; label: string; target: string; age: number }[];
  actions: { id: string; kind: string; target: string; label: string; progress: number; done: boolean }[];
  incident: Incident | null;
  incidentStats: IncidentStats;
  history: HistoryPoint[];
  logs?: LogLine[];
  topology?: Topology;
}

export interface AutopilotEntry {
  tick: number;
  ts: string;
  strategy: string;
  rootCause: string;
  availability: number;
  baseline: number;
}

export interface WhatIf {
  service: string;
  horizon: number;
  impacted: { service: string; failedAt: number | null; worst: Status }[];
  failed: number;
  minAvailability: number;
  availability: number[];
  revenueAtRisk: number;
}

export interface BenchmarkRow {
  scenario: string;
  name: string;
  expected: { service: string; hypothesis: string };
  diagnosisRate: number;
  timeToDetect: number | null;
  timeToDiagnose: number | null;
  earlyDiagnosisRate: number;
  availabilityWith: number | null;
  availabilityWithout: number | null;
  servicesLostWith: number | null;
  servicesLostWithout: number | null;
  revenueSaved: number;
  strategy: string | null;
  runs: { seed: number; leadTime: number | null; diagnosed: boolean; timeToDiagnose: number | null }[];
}

export interface Benchmark {
  scenarios: BenchmarkRow[];
  summary: {
    runs: number;
    diagnosisAccuracy: number;
    earlyDiagnosisRate: number;
    meanTimeToDetect: number | null;
    meanTimeToDiagnose: number | null;
    meanLeadTime: number | null;
    availabilityWith: number | null;
    availabilityWithout: number | null;
    revenueSavedPerIncident: number;
    falseAlarms: number;
    quietSeconds: number;
  };
  seeds: number[];
  elapsed: number;
}

export interface Scenario {
  id: string;
  name: string;
  summary: string;
  category: string;
  severity: string;
  targets: string[];
}

export interface Catalog {
  scenarios: Scenario[];
  faults: { kind: string; label: string }[];
  actions: { kind: string; label: string; duration: number }[];
}

export interface StrategyResult {
  id: string;
  name: string;
  rationale: string;
  steps: { action: string; target: string; label: string }[];
  score: number;
  availability: number;
  timeToRecover: number | null;
  peakFailed: number;
  servicesImpacted: string[];
  endHealth: number;
  revenueLost: number;
  revenueSaved: number;
  risk: number;
  costPerHour: number;
  series: { health: number[]; availability: number[]; failed: number[] };
}

export interface Recommendation {
  tick: number;
  horizon: number;
  rootCause: RcaCandidate | null;
  strategies: StrategyResult[];
  recommended: string;
  baseline: string;
  summary: string;
}

export interface ServiceDetail {
  id: string;
  spec: ServiceSpec;
  series: { tick: number; cpu: number; memory: number; latency: number; error_rate: number; saturation: number; health: number }[];
  baseline: Record<string, number>;
  zscores: Record<string, number>;
  logs: LogLine[];
  baseLatency: number;
}

export interface LogAnalysis {
  linesParsed: number;
  services: {
    service: string;
    lines: number;
    warnings: number;
    errors: number;
    errorRatio: number;
    risk: number;
    rootScore: number;
    patterns: { key: string; label: string; count: number }[];
    samples: string[];
    referencedBy: number;
  }[];
  edges: { source: string; target: string; count: number }[];
  rootCause: LogAnalysis["services"][number] | null;
  recommendations: { service: string; pattern: string; action: string }[];
  errorTimeline: { bucket: string; errors: number }[];
  analysedAt: string;
}
