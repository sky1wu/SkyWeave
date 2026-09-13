import { useCallback, useEffect, useRef } from "react";
import type { Item } from "@/domain/types";
import type { MapFocus } from "../map";
import type { PlannerView } from "./types";

export function useDayNavigation({
  activeDayId,
  setSelectedDay,
  setSelected,
  setSelectedPool,
  setFocus,
  setView,
  setTimelineCollapsed,
}: {
  activeDayId?: string;
  setSelectedDay: (id: string) => void;
  setSelected: (id: string | null) => void;
  setSelectedPool: (id: string | null) => void;
  setFocus: (focus: MapFocus | null) => void;
  setView: (view: PlannerView) => void;
  setTimelineCollapsed: (collapsed: boolean) => void;
}) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const interactionSequence = useRef(0);
  const navigationLock = useRef(false);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const scrollFrame = useRef<number | null>(null);

  const markInteraction = useCallback(() => ++interactionSequence.current, []);
  const isLatestInteraction = useCallback(
    (sequence: number) => interactionSequence.current === sequence,
    [],
  );
  const lockNavigation = useCallback(() => {
    const sequence = markInteraction();
    navigationLock.current = true;
    clearTimeout(navigationTimer.current);
    navigationTimer.current = setTimeout(() => {
      navigationLock.current = false;
    }, 1000);
    return sequence;
  }, [markInteraction]);
  const releaseNavigationLock = useCallback(() => {
    navigationLock.current = false;
  }, []);

  useEffect(
    () => () => {
      clearTimeout(navigationTimer.current);
      if (scrollFrame.current !== null)
        cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );

  const followScroll = useCallback(() => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      if (navigationLock.current) return;
      const pane = timelineRef.current;
      if (!pane) return;
      const top = pane.getBoundingClientRect().top;
      const sections = [...pane.querySelectorAll<HTMLElement>(".planner-day")];
      let current: HTMLElement | undefined = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= top + 75) current = section;
        else break;
      }
      if (
        pane.scrollHeight > pane.clientHeight + 2 &&
        pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2
      )
        current = sections.at(-1);
      const id = current?.dataset.dayId;
      if (id && id !== activeDayId) {
        setSelectedDay(id);
        setFocus(null);
      }
    });
  }, [activeDayId, setFocus, setSelectedDay]);

  const jumpToDay = useCallback(
    (id: string) => {
      lockNavigation();
      setSelectedDay(id);
      setFocus(null);
      setView("timeline");
      setTimelineCollapsed(false);
      requestAnimationFrame(() => {
        const pane = timelineRef.current;
        const section = document.getElementById(`day-${id}`);
        if (!pane || !section) return;
        const top = Math.max(
          0,
          Math.min(
            pane.scrollHeight - pane.clientHeight,
            pane.scrollTop +
              section.getBoundingClientRect().top -
              pane.getBoundingClientRect().top,
          ),
        );
        if (Math.abs(pane.scrollTop - top) > 1)
          pane.scrollTo({ top, behavior: "smooth" });
      });
    },
    [lockNavigation, setFocus, setSelectedDay, setTimelineCollapsed, setView],
  );

  const selectItem = useCallback(
    (item: Item) => {
      lockNavigation();
      setSelectedPool(null);
      setSelected(item.id);
      setSelectedDay(item.dayId);
      setTimelineCollapsed(false);
      setView("timeline");
      requestAnimationFrame(() =>
        document
          .getElementById(`item-${item.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      );
    },
    [
      lockNavigation,
      setSelected,
      setSelectedDay,
      setSelectedPool,
      setTimelineCollapsed,
      setView,
    ],
  );

  return {
    timelineRef,
    interactionSequence,
    followScroll,
    jumpToDay,
    selectItem,
    lockNavigation,
    markInteraction,
    isLatestInteraction,
    releaseNavigationLock,
  };
}
