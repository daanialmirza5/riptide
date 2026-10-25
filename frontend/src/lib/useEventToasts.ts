import { useEffect, useRef } from "react";
import { useStore } from "./store";

/** Announces incident lifecycle and Autopilot decisions anywhere in the app. */
export function useEventToasts() {
  const incident = useStore((s) => s.snapshot?.incident ?? null);
  const pilot = useStore((s) => s.snapshot?.autopilotLog?.[0] ?? null);
  const toast = useStore((s) => s.toast);
  const lastIncident = useRef<{ id: string; title: string } | null | undefined>(undefined);
  const lastPilot = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const prev = lastIncident.current;
    if (prev !== undefined) {
      if (incident && prev?.id !== incident.id) {
        toast({ tone: "error", title: `${incident.id} opened`, body: "Riptide detected a developing failure and is diagnosing it." });
      } else if (!incident && prev) {
        toast({ tone: "success", title: `${prev.id} resolved`, body: prev.title });
      }
    }
    lastIncident.current = incident ? { id: incident.id, title: incident.title } : null;
  }, [incident, toast]);

  useEffect(() => {
    const key = pilot ? `${pilot.tick}` : null;
    if (lastPilot.current !== undefined && key && key !== lastPilot.current && pilot) {
      toast({
        tone: "info",
        title: `Autopilot: ${pilot.strategy}`,
        body: `${pilot.rootCause}. Simulated availability ${(pilot.availability * 100).toFixed(1)}% vs ${(pilot.baseline * 100).toFixed(1)}% doing nothing.`,
      });
    }
    lastPilot.current = key;
  }, [pilot, toast]);
}
