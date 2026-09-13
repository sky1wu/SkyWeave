import type { DayPlan, Item } from "./types";
import { modeLabels, typeLabels } from "./types";
import { calculateTimeline, formatTime } from "./timeline";
import { transportLabels } from "./transport";

export type ItineraryDetail = {
  text: string;
  kind: "address" | "note" | "info";
};
export interface ItineraryStop {
  id: string;
  title: string;
  category: string;
  time: string;
  timing: string;
  details: ItineraryDetail[];
  warnings: string[];
  connection: { summary: string; description: string; steps: string[] } | null;
}
export interface ItineraryDay {
  id: string;
  number: number;
  title: string;
  date: string;
  stops: ItineraryStop[];
}
export interface ItineraryDocument {
  title: string;
  dates: string;
  timezone: string;
  days: ItineraryDay[];
}
export interface ItineraryShare {
  id: string;
  token: string;
  createdAt: number;
}

export function itineraryDate(date: string | null) {
  if (!date) return "日期待定";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function itineraryDateRange(start: string | null, end: string | null) {
  if (!start) return "日期待定";
  return end && end !== start ? `${start} — ${end}` : start;
}

function timeRange(start: number | null, end: number | null) {
  return end !== null && end !== start
    ? `${formatTime(start)} – ${formatTime(end)}`
    : formatTime(start);
}

function connection(day: DayPlan, previous: Item | undefined, item: Item) {
  if (!previous || item.type === "note") return null;
  const leg = day.legs.find(
    (l) => l.fromItemId === previous.id && l.toItemId === item.id,
  );
  if (!leg) return { summary: "交通待规划", description: "", steps: [] };
  const route = leg.alternatives.find(
    (a) => a.id === leg.selectedAlternativeId,
  );
  const manual = leg.mode === "manual";
  const minutes = manual
    ? leg.manualDurationMinutes
    : route
      ? Math.ceil(route.durationSeconds / 60)
      : null;
  const distance = manual ? leg.manualDistanceMeters : route?.distanceMeters;
  const distanceText =
    distance == null
      ? ""
      : distance >= 1000
        ? `${(distance / 1000).toFixed(1)} 公里`
        : `${distance} 米`;
  const status =
    !manual && leg.status !== "ready"
      ? leg.status === "error"
        ? "路线不可用"
        : "路线更新中"
      : "";
  return {
    summary: [
      manual ? "接驳交通" : modeLabels[leg.mode],
      minutes === null ? "用时待定" : `${minutes} 分钟`,
      distanceText,
      status,
    ]
      .filter(Boolean)
      .join(" · "),
    description: manual
      ? (leg.manualDescription ?? "")
      : (route?.summary ?? ""),
    steps: manual
      ? []
      : (route?.steps.map((step) => step.instruction).filter(Boolean) ?? []),
  };
}

/** One read model for the screen and poster, using the planner's timing rules. */
export function itineraryDays(days: DayPlan[]): ItineraryDay[] {
  return [...days]
    .sort((a, b) => a.position - b.position)
    .map((day) => {
      const timeline = calculateTimeline(day);
      let previous: Item | undefined;
      return {
        id: day.id,
        number: day.position + 1,
        title: day.title,
        date: itineraryDate(day.date),
        stops: [...day.items]
          .sort((a, b) => a.position - b.position)
          .map((item) => {
            const entry = timeline.entries.find((e) => e.itemId === item.id)!;
            const transport = item.transport;
            const scheduled =
              (item.fixedTime || !!transport) && item.startMinutes !== null;
            const details: ItineraryDetail[] = [];
            const add = (
              text: string | null | undefined,
              kind: ItineraryDetail["kind"],
            ) => {
              if (text?.trim()) details.push({ text, kind });
            };
            if (transport) {
              add(
                `${transport.origin.name} → ${transport.destination.name}`,
                "info",
              );
              add(
                transport.origin.address
                  ? `出发：${transport.origin.address}`
                  : null,
                "address",
              );
              add(
                transport.destination.address
                  ? `到达：${transport.destination.address}`
                  : null,
                "address",
              );
            } else add(item.address, "address");
            if (scheduled) {
              add(
                entry.arrival === null
                  ? "到达时间待定"
                  : `预计 ${formatTime(entry.arrival)} 到达${entry.earlyMinutes ? `，提前 ${entry.earlyMinutes} 分钟` : ""}`,
                "info",
              );
            }
            add(item.description, "note");
            add(item.notes, "note");
            const stop: ItineraryStop = {
              id: item.id,
              title: item.title,
              category: transport
                ? [transportLabels[transport.mode], transport.serviceNumber]
                    .filter(Boolean)
                    .join(" ")
                : item.placeCategory !== "未分类" && item.type === "place"
                  ? item.placeCategory
                  : typeLabels[item.type],
              time: scheduled
                ? timeRange(
                    item.startMinutes! * 60,
                    item.endMinutes !== null
                      ? item.endMinutes * 60
                      : transport
                        ? entry.departure
                        : item.startMinutes! * 60 + item.stayMinutes * 60,
                  )
                : timeRange(entry.start, entry.departure),
              timing: transport
                ? transport.status === "confirmed"
                  ? "班次已确认"
                  : "班次待确认"
                : scheduled
                  ? "固定时间"
                  : "预计时间",
              details,
              warnings: [...new Set(entry.warnings)],
              connection: connection(day, previous, item),
            };
            if (item.type !== "note") previous = item;
            return stop;
          }),
      };
    });
}
