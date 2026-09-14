"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { DayGeometry, DayPlan, TripSection } from "@/domain/types";
import { TripStore } from "@/lib/trip-store";

const TripData = createContext<TripStore | null>(null);
export function TripDataProvider({
  tripId,
  children,
}: {
  tripId: string;
  children: React.ReactNode;
}) {
  const [store] = useState(() => new TripStore(tripId));
  useEffect(() => {
    const events = new EventSource(`/api/trips/${tripId}/events`);
    const unsubscribe = store.subscribe(() => {
      if (store.isRevoked()) events.close();
    });
    const sync = (event: MessageEvent) => {
      const { sequence } = JSON.parse(event.data) as { sequence: number };
      if (Number.isSafeInteger(sequence) && sequence >= 0)
        void store.sync(sequence).catch(() => {});
    };
    events.addEventListener("sync", sync);
    events.addEventListener("change", sync);
    events.addEventListener("revoked", () => {
      events.close();
      store.revoke();
    });
    const focus = () => {
      void store.checkRevision().catch(() => {});
    };
    // A dropped/expired session can make reconnect fail before another sync event.
    events.addEventListener("error", focus);
    window.addEventListener("focus", focus);
    return () => {
      events.close();
      unsubscribe();
      window.removeEventListener("focus", focus);
      store.cancel();
    };
  }, [store, tripId]);
  return <TripData.Provider value={store}>{children}</TripData.Provider>;
}

function useStore() {
  const store = useContext(TripData);
  if (!store) throw new Error("TripDataProvider is required");
  return store;
}
export function useTripData(section: TripSection) {
  const store = useStore();
  const get = useCallback(() => store.get(section), [store, section]);
  const state = useSyncExternalStore(store.subscribe, get, get);
  useEffect(() => {
    void store.activate(section).catch(() => {});
  }, [store, section]);
  const refresh = useCallback(() => store.refresh(section), [store, section]);
  return { ...state, refresh };
}

export function useDayGeometry(summary: DayPlan | undefined) {
  const store = useStore();
  const [result, setResult] = useState<{
    key?: string;
    data?: DayGeometry;
    error?: string;
  }>({});
  const dayId = summary?.id;
  const version = summary?.version;
  const key = `${dayId}:${version}`;
  const needsGeometry =
    summary?.legs.some(
      (leg) => leg.selectedAlternativeId && leg.mode !== "manual",
    ) ?? false;
  useEffect(() => {
    if (!dayId || version === undefined || !needsGeometry) return;
    let cancelled = false;
    store
      .geometry({ id: dayId, version })
      .then((data) => {
        if (cancelled) return;
        setResult({ key, data });
        if (data.version !== version)
          void store.checkRevision().catch(() => {});
      })
      .catch((error: Error) => {
        if (!cancelled && error.name !== "AbortError") {
          setResult({ key, error: "路线地图加载失败，请切换日期重试" });
          void store.checkRevision().catch(() => {});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [store, dayId, version, key, needsGeometry]);
  const day = useMemo(() => {
    if (
      !summary ||
      result.data?.dayId !== summary.id ||
      result.data.version !== summary.version
    )
      return summary;
    const geometry = new Map(
      result.data.alternatives.map((a) => [a.id, a.polyline]),
    );
    return {
      ...summary,
      legs: summary.legs.map((leg) => ({
        ...leg,
        alternatives: leg.alternatives.map((a) => ({
          ...a,
          polyline: geometry.get(a.id),
        })),
      })),
    };
  }, [summary, result]);
  return {
    day,
    error: needsGeometry && result.key === key ? (result.error ?? "") : "",
  };
}
