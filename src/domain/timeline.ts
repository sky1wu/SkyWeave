import { DateTime } from "luxon";
import type { Item } from "./types";
import { routeEndpoint } from "./transport";
import { compilePlan, type PlanDay } from "./plan-graph";
import { located } from "./linear-timeline";
export { located, calculateLinearTimeline } from "./linear-timeline";
export type { TimelineEntry, PersonTiming } from "./linear-timeline";
export { calculateTimeline, calculateTripTimelines } from "./trip-timeline";

export function tripRouteConnections(days: PlanDay[]) {
  return compilePlan(days).connections.filter(
    ({ from, to }) =>
      located(routeEndpoint(from, "departure")) &&
      located(routeEndpoint(to, "arrival")),
  );
}
export function routeConnections(items: Item[]) {
  const ids = [...new Set(items.map((item) => item.dayId))];
  return tripRouteConnections(
    ids.map((id, position) => ({
      id,
      position,
      startMinutes: 480,
      items: items.filter((item) => item.dayId === id),
    })),
  );
}
export function routePairs(items: Item[]): [Item, Item][] {
  return routeConnections(items).map(({ from, to }) => [from, to]);
}

export function formatTime(seconds: number | null): string {
  if (seconds === null) return "时间待定";
  const m = Math.ceil(seconds / 60);
  const d = Math.floor(m / 1440),
    local = ((m % 1440) + 1440) % 1440;
  return `${d === -1 ? "前日 " : d < -1 ? `${-d} 天前 ` : d === 1 ? "次日 " : d > 1 ? `第 ${d + 1} 日 ` : ""}${String(Math.floor(local / 60)).padStart(2, "0")}:${String(local % 60).padStart(2, "0")}`;
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
