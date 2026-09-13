import { useEffect, useRef, useState } from "react";
import type { DayPlan, Item, PoolPlace } from "@/domain/types";
import type { MapFocus, MapInsets } from "../map";
import type { PlannerView } from "./types";

export function useMapFocus({
  workspaceRef,
  poolCollapsed,
  timelineCollapsed,
  view,
  setFocus,
  setSelected,
  setSelectedDay,
  setSelectedPool,
  setView,
  setError,
  lockNavigation,
  markInteraction,
}: {
  workspaceRef: React.RefObject<HTMLDivElement | null>;
  poolCollapsed: boolean;
  timelineCollapsed: boolean;
  view: PlannerView;
  setFocus: (focus: MapFocus | null) => void;
  setSelected: (id: string | null) => void;
  setSelectedDay: (id: string) => void;
  setSelectedPool: (id: string | null) => void;
  setView: (view: PlannerView) => void;
  setError: (message: string) => void;
  lockNavigation: () => number;
  markInteraction: () => number;
}) {
  const [mapInsets, setMapInsets] = useState<MapInsets>([48, 42, 48, 48]);
  const focusSequence = useRef(0);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = workspace.getBoundingClientRect();
        const narrow = bounds.width <= 1000;
        const next: MapInsets = [
          narrow ? (view === "map" ? 110 : 70) : 90,
          40,
          40,
          40,
        ];
        for (const panel of workspace.querySelectorAll<HTMLElement>(
          ".floating-panel",
        )) {
          const rect = panel.getBoundingClientRect();
          if (!rect.width || !rect.height || panel.dataset.collapsed === "true")
            continue;
          if (narrow) {
            if (panel.classList.contains("floating-timeline"))
              next[1] = bounds.bottom - rect.top + 20;
            else next[0] = rect.bottom - bounds.top + 20;
          } else if (panel.classList.contains("floating-timeline"))
            next[2] = rect.right - bounds.left + 30;
          else next[3] = bounds.right - rect.left + 30;
        }
        const vertical = Math.max(1, bounds.height - 140);
        if (next[0] + next[1] > vertical) {
          const ratio = vertical / (next[0] + next[1]);
          next[0] *= ratio;
          next[1] *= ratio;
        }
        const rounded = next.map(Math.round) as MapInsets;
        setMapInsets((previous) =>
          previous.every((value, index) => value === rounded[index])
            ? previous
            : rounded,
        );
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    for (const panel of workspace.querySelectorAll(".floating-panel"))
      observer.observe(panel);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [poolCollapsed, timelineCollapsed, view, workspaceRef]);

  useEffect(() => {
    const timer = setTimeout(
      () => window.dispatchEvent(new Event("resize")),
      30,
    );
    return () => clearTimeout(timer);
  }, [view]);

  function focusLeg(day: DayPlan, legId: string) {
    lockNavigation();
    setSelectedPool(null);
    setSelectedDay(day.id);
    if (window.innerWidth <= 1000) setView("timeline");
    setFocus({ kind: "leg", id: legId, request: ++focusSequence.current });
  }

  function locate(place: PoolPlace) {
    markInteraction();
    if (place.lat === null || place.lng === null) {
      setError("该地点没有坐标，可在地点池中编辑补充");
      return;
    }
    setSelected(null);
    setSelectedPool(place.id);
    setFocus({
      kind: "point",
      title: place.title,
      poolPlaceId: place.id,
      category: place.placeCategory,
      lat: place.lat,
      lng: place.lng,
      request: ++focusSequence.current,
    });
    setView("map");
  }

  function focusItem(item: Item) {
    setFocus({ kind: "item", id: item.id, request: ++focusSequence.current });
  }

  function focusDay() {
    setSelected(null);
    setFocus({ kind: "day", request: ++focusSequence.current });
    setView("map");
  }

  return { mapInsets, focusLeg, locate, focusItem, focusDay };
}
