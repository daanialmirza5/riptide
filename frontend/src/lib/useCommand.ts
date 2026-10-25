import { useCallback, useState } from "react";
import { useStore } from "./store";

/** Wraps an API mutation with pending state and toast feedback. */
export function useCommand<A extends unknown[], R>(fn: (...args: A) => Promise<R>, success?: (r: R, args: NoInfer<A>) => string | null) {
  const [pending, setPending] = useState(false);
  const toast = useStore((s) => s.toast);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      try {
        const r = await fn(...args);
        const msg = success?.(r, args);
        if (msg) toast({ tone: "success", title: msg });
        return r;
      } catch (e) {
        toast({ tone: "error", title: "Request failed", body: e instanceof Error ? e.message : String(e) });
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [fn, success, toast],
  );
  return { run, pending };
}
