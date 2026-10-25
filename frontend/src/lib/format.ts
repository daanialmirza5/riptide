import type { Status } from "./types";

export const STATUS_COLOR: Record<Status, string> = {
  healthy: "#34d399",
  degraded: "#fbbf24",
  critical: "#fb923c",
  down: "#f43f5e",
};

export const STATUS_LABEL: Record<Status, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  critical: "Critical",
  down: "Down",
};

export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

export const secs = (v: number | null | undefined) => {
  if (v === null || v === undefined) return "—";
  if (v < 1) return "now";
  if (v < 90) return `${Math.round(v)}s`;
  return `${Math.floor(v / 60)}m ${Math.round(v % 60)}s`;
};

export const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

export const money = (v: number) => `$${Math.round(v).toLocaleString()}`;

export const compact = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v)}`;

/** Blend green → amber → red for a 0..1 risk value. */
export function riskColor(r: number): string {
  if (r < 0.3) return "#34d399";
  if (r < 0.55) return "#fbbf24";
  if (r < 0.8) return "#fb923c";
  return "#f43f5e";
}

export const clock = (iso: string) => iso.slice(11, 19);
