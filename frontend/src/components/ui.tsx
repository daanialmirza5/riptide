import clsx from "clsx";
import type { ReactNode } from "react";
import { STATUS_COLOR, STATUS_LABEL } from "../lib/format";
import type { Status } from "../lib/types";

export function Panel({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("glass flex min-h-0 flex-col", className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            {icon && <span className="text-tide-300">{icon}</span>}
            {title}
          </div>
          {actions}
        </header>
      )}
      <div className={clsx("min-h-0 flex-1", bodyClassName ?? "p-4")}>{children}</div>
    </section>
  );
}

export function StatusDot({ status, pulse }: { status: Status; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {pulse && (status === "critical" || status === "down") && (
        <span className="absolute inline-flex h-full w-full animate-pulseRing rounded-full" style={{ background: STATUS_COLOR[status] }} />
      )}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className="chip"
      style={{ color: STATUS_COLOR[status], background: `${STATUS_COLOR[status]}1a`, boxShadow: `inset 0 0 0 1px ${STATUS_COLOR[status]}40` }}
    >
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function SevBadge({ sev }: { sev: string }) {
  const tone = sev === "SEV1" ? "bg-rose-500/20 text-rose-200 ring-rose-400/40" : sev === "SEV2" ? "bg-orange-500/20 text-orange-200 ring-orange-400/40" : "bg-amber-500/15 text-amber-200 ring-amber-400/30";
  return <span className={clsx("chip font-mono", tone)}>{sev}</span>;
}

export function Meter({ value, color, className }: { value: number; color: string; className?: string }) {
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]", className)}>
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.04] text-tide-300 ring-1 ring-white/10">{icon}</div>
      <div className="text-sm font-semibold text-slate-100">{title}</div>
      {body && <p className="max-w-sm text-sm text-slate-400">{body}</p>}
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}
