import { useEffect, useRef, useState } from "react";
import type { DayPlan } from "@/domain/types";
import { api, ApiFailure } from "@/lib/client";

export function useRouteRecalculation({
  days,
  editable,
  refresh,
  setError,
}: {
  days: DayPlan[];
  editable: boolean;
  refresh: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const [routing, setRouting] = useState(false);
  const current = useRef({ refresh, days });
  const routedVersions = useRef(new Map<string, number>());
  const routeJobs = useRef(0);

  useEffect(() => {
    current.current = { refresh, days };
  }, [refresh, days]);

  const routeRevision = days
    .filter((day) => day.legs.some((leg) => leg.mode !== "manual"))
    .map((day) => `${day.id}:${day.version}`)
    .join("|");

  useEffect(() => {
    if (!editable) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const targets = current.current.days.filter(
        (day) =>
          day.legs.some((leg) => leg.mode !== "manual") &&
          routedVersions.current.get(day.id) !== day.version,
      );
      if (!targets.length) return;
      routeJobs.current++;
      setRouting(true);
      try {
        for (const target of targets) {
          if (cancelled) break;
          routedVersions.current.set(target.id, target.version);
          try {
            await api(`/days/${target.id}/routes/recalculate`, "POST", {});
          } catch (error) {
            routedVersions.current.delete(target.id);
            throw error;
          }
        }
        await current.current.refresh();
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 409)
          await current.current.refresh();
        else if (!cancelled) setError((error as Error).message);
      } finally {
        routeJobs.current--;
        setRouting(routeJobs.current > 0);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [editable, routeRevision, setError]);

  return routing;
}
