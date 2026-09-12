import { DateTime } from "luxon";
import type { DayPlan, Item } from "./types";
export interface TimelineEntry {
  itemId: string;
  arrival: number | null;
  start: number | null;
  departure: number | null;
  earlyMinutes: number;
  lateMinutes: number;
  warnings: string[];
}
export function located(item: Pick<Item, "lat" | "lng">) {
  return (
    item.lat !== null &&
    item.lng !== null &&
    Number.isFinite(item.lat) &&
    Number.isFinite(item.lng)
  );
}
export function routePairs(items: Item[]): [Item, Item][] {
  const points = [...items]
    .sort((a, b) => a.position - b.position)
    .filter((i) => i.type !== "note");
  return points
    .slice(1)
    .flatMap((item, i): [Item, Item][] =>
      located(points[i]) && located(item) ? [[points[i], item]] : [],
    );
}
export function calculateTimeline(day: DayPlan) {
  let clock: number | null = day.startMinutes * 60;
  let previous: Item | undefined;
  const entries: TimelineEntry[] = [];
  const departures: Record<string, number | null> = {};
  for (const item of [...day.items].sort((a, b) => a.position - b.position)) {
    const warnings: string[] = [];
    if (item.type !== "note") {
      if (!located(item)) warnings.push("地点没有坐标");
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
    const arrival = clock;
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
      if (arrival === null) warnings.push("到达时间不确定，后续按活动时间暂估");
      clock = arrival === null ? fixedStart : Math.max(arrival, fixedStart);
      const start = clock;
      clock = Math.max(clock, plannedEnd ?? clock);
      entries.push({
        itemId: item.id,
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
      if (arrival === null) warnings.push("到达时间不确定");
      entries.push({
        itemId: item.id,
        arrival,
        start,
        departure: clock,
        earlyMinutes,
        lateMinutes,
        warnings,
      });
    }
  }
  for (let i = 1; i < entries.length; i++) {
    const item = day.items.find((x) => x.id === entries[i].itemId)!;
    const prior = entries[i - 1];
    if (
      item.fixedTime &&
      item.startMinutes !== null &&
      prior.departure !== null &&
      prior.departure > item.startMinutes * 60
    )
      entries[i].warnings.push("与前一事项时间重叠");
  }
  return { entries, departures };
}
export function formatTime(seconds: number | null): string {
  if (seconds === null) return "时间待定";
  const m = Math.ceil(seconds / 60);
  const d = Math.floor(m / 1440);
  return `${d === 1 ? "次日 " : d > 1 ? `第 ${d + 1} 日 ` : ""}${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export function departureISO(
  date: string | null,
  seconds: number | null,
  timezone: string,
): string | undefined {
  if (!date || seconds === null) return;
  return (
    DateTime.fromISO(date, { zone: timezone })
      .startOf("day")
      .plus({ seconds })
      .toISO() ?? undefined
  );
}
