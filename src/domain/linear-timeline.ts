import type { DayPlan, Item } from "./types";
import { transportTiming } from "./transport";
export interface TimelineEntry {
  itemId: string;
  isDayStart: boolean;
  // The first item has no inbound arrival; null otherwise means unknown.
  arrival: number | null;
  start: number | null;
  departure: number | null;
  earlyMinutes: number;
  lateMinutes: number;
  warnings: string[];
  branchId?: string;
  people?: PersonTiming[];
  skipped?: boolean;
  catchUpTargetId?: string;
  personal?: boolean;
  rendezvous?: {
    policy: "wait_all" | "fixed";
    arrivals: {
      branchId: string;
      title: string;
      participantIds: string[];
      arrival: number | null;
      waitMinutes: number | null;
      lateMinutes: number | null;
      catchUpTitle?: string;
    }[];
  };
}
export function located(item: Pick<Item, "lat" | "lng">) {
  return (
    item.lat !== null &&
    item.lng !== null &&
    Number.isFinite(item.lat) &&
    Number.isFinite(item.lng)
  );
}
export function calculateLinearTimeline(
  day: DayPlan,
  initial?: {
    clock: number | null;
    previous?: Item;
    hasArrival?: boolean;
    prior?: TimelineEntry;
  },
) {
  let clock: number | null = initial ? initial.clock : day.startMinutes * 60;
  let previous: Item | undefined = initial?.previous;
  const entries: TimelineEntry[] = [];
  const departures: Record<string, number | null> = {};
  for (const item of [...day.items].sort((a, b) => a.position - b.position)) {
    const isDayStart =
      entries.length === 0 && !initial?.previous && !initial?.hasArrival;
    const warnings: string[] = [];
    if (item.type !== "note") {
      if (item.transport) {
        if (!located(item.transport.origin)) warnings.push("出发地点待定位");
        if (!located(item.transport.destination))
          warnings.push("到达地点待定位");
      } else if (!located(item)) warnings.push("地点没有坐标");
      if (previous) {
        const leg = day.legs.find(
          (l) => l.fromItemId === previous!.id && l.toItemId === item.id,
        );
        if (leg) {
          departures[leg.id] = clock;
          const alternative = leg.alternatives.find(
            (a) => a.id === leg.selectedAlternativeId,
          );
          const duration =
            leg.mode === "manual"
              ? leg.manualDurationMinutes === null
                ? null
                : leg.manualDurationMinutes * 60
              : (alternative?.durationSeconds ?? null);
          if (leg.mode === "manual" && duration === null)
            warnings.push("手动交通段未设置时间");
          if (leg.mode !== "manual" && !alternative)
            warnings.push(
              leg.status === "error" ? "路线不可用" : "没有选择路线",
            );
          clock = clock === null || duration === null ? null : clock + duration;
        } else {
          warnings.push("相邻地点路线不可用");
          clock = null;
        }
      }
      previous = item;
    }
    const arrival = isDayStart ? null : clock;
    if (item.transport) {
      const timing = transportTiming(
        item,
        arrival,
        isDayStart ? day.startMinutes * 60 : undefined,
      );
      clock = timing.departure;
      entries.push({
        itemId: item.id,
        isDayStart,
        arrival,
        ...timing,
        warnings: [...warnings, ...timing.warnings],
      });
      continue;
    }
    const fixedStart =
      item.startMinutes === null ? null : item.startMinutes * 60;
    const plannedEnd =
      item.endMinutes !== null
        ? item.endMinutes * 60
        : fixedStart !== null
          ? fixedStart + item.stayMinutes * 60
          : null;
    let earlyMinutes = 0,
      lateMinutes = 0;
    if (item.fixedTime && fixedStart !== null) {
      if (arrival !== null) {
        earlyMinutes = Math.max(0, Math.ceil((fixedStart - arrival) / 60));
        lateMinutes = Math.max(0, Math.ceil((arrival - fixedStart) / 60));
      }
      if (lateMinutes) warnings.push(`预计迟到 ${lateMinutes} 分钟`);
      if (
        arrival !== null &&
        plannedEnd !== null &&
        plannedEnd > fixedStart &&
        arrival >= plannedEnd
      )
        warnings.push("活动已结束，预计错过");
      if (!isDayStart && arrival === null)
        warnings.push("到达时间不确定，后续按活动时间暂估");
      clock = arrival === null ? fixedStart : Math.max(arrival, fixedStart);
      const start = clock;
      clock = Math.max(clock, plannedEnd ?? clock);
      entries.push({
        itemId: item.id,
        isDayStart,
        arrival,
        start,
        departure: clock,
        earlyMinutes,
        lateMinutes,
        warnings,
      });
    } else {
      if (fixedStart !== null)
        clock = clock === null ? fixedStart : Math.max(clock, fixedStart);
      const start = clock;
      if (clock !== null)
        clock =
          plannedEnd !== null
            ? Math.max(clock, plannedEnd)
            : clock + item.stayMinutes * 60;
      if (!isDayStart && arrival === null) warnings.push("到达时间不确定");
      entries.push({
        itemId: item.id,
        isDayStart,
        arrival,
        start,
        departure: clock,
        earlyMinutes,
        lateMinutes,
        warnings,
      });
    }
  }
  for (let i = 0; i < entries.length; i++) {
    const item = day.items.find((x) => x.id === entries[i].itemId)!;
    const prior = i ? entries[i - 1] : initial?.prior;
    if (
      item.fixedTime &&
      item.startMinutes !== null &&
      prior &&
      prior.departure !== null &&
      prior.departure > item.startMinutes * 60
    )
      entries[i].warnings.push("与前一事项时间重叠");
  }
  return { entries, departures };
}

export type PersonTiming = Pick<
  TimelineEntry,
  | "arrival"
  | "start"
  | "departure"
  | "earlyMinutes"
  | "lateMinutes"
  | "warnings"
  | "isDayStart"
  | "skipped"
  | "catchUpTargetId"
> & { participantId: string; branchId?: string };
