import type { DayPlan, Item, Participant } from "./types";
import {
  branchesOf,
  displayItems,
  contextualDays,
  planningItems,
} from "./parallel";
import { modeLabels, typeLabels } from "./types";
import { calculateTripTimelines, formatTime } from "./timeline";
import { compilePlan } from "./plan-graph";
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
  branch?: {
    title: string;
    people: string;
    color: string;
    sectionTitle: string;
  };
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

function connection(
  day: DayPlan,
  previous: Item | undefined,
  item: Item,
  branchId = "",
  routeRole = "main",
) {
  if (!previous || item.type === "note" || item.type === "parallel")
    return null;
  const leg = day.legs.find(
    (l) =>
      l.fromItemId === previous.id &&
      l.toItemId === item.id &&
      (l.branchId ?? "") === branchId &&
      (l.routeRole ?? "main") === routeRole,
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
export function itineraryDays(
  days: DayPlan[],
  participants: Participant[] = [],
  participantId: string | null = null,
): ItineraryDay[] {
  const timelines = calculateTripTimelines(days, participantId);
  const fullGraph = days.some((day) =>
    day.items.some((item) => item.parallelPlan),
  )
    ? compilePlan(days)
    : null;
  const knownPerson =
    !!participantId && !!fullGraph?.people.includes(participantId);
  return contextualDays(days)
    .sort((a, b) => a.position - b.position)
    .map((day) => {
      const graph = fullGraph ?? compilePlan([day]);
      const timeline = timelines.get(day.id)!;
      const allItems = planningItems(day);
      const branches = branchesOf(day);
      const allowed = new Set(
        branches
          .filter(
            (b) => !participantId || b.participantIds.includes(participantId),
          )
          .map((b) => b.id),
      );
      return {
        id: day.id,
        number: day.position + 1,
        title: day.title,
        date: itineraryDate(day.date),
        stops: displayItems(day)
          .filter(
            (item) =>
              (!item.branchId || allowed.has(item.branchId)) &&
              (!knownPerson ||
                item.parallelPlan ||
                timeline.entries
                  .find((e) => e.itemId === item.id)
                  ?.people?.some((p) => p.participantId === participantId)),
          )
          .map((item) => {
            const continued =
              !!item.parallelPlan &&
              !day.items.some((local) => local.id === item.id);
            const entry = timeline.entries.find(
              (e) => e.itemId === item.id,
            ) ?? {
              itemId: item.id,
              isDayStart: false,
              arrival: null,
              start: null,
              departure: null,
              earlyMinutes: 0,
              lateMinutes: 0,
              warnings: [],
            };
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
            if (scheduled && !entry.isDayStart) {
              add(
                entry.arrival === null
                  ? "到达时间待定"
                  : `预计 ${formatTime(entry.arrival)} 到达${entry.earlyMinutes ? `，提前 ${entry.earlyMinutes} 分钟` : ""}`,
                "info",
              );
            }
            add(item.description, "note");
            add(item.notes, "note");
            const branch = branches.find((b) => b.id === item.branchId);
            if (item.parallelPlan) {
              const split = allItems.find(
                (i) => i.id === item.parallelPlan!.splitItemId,
              );
              const join = allItems.find(
                (i) => i.id === item.parallelPlan!.joinItemId,
              );
              add(
                `${split ? `从「${split.title}」分开` : "各自出发"}；${join ? `在「${join.title}」集合` : "各自结束"}。以下各组并行安排。`,
                "info",
              );
              const visible = item.parallelPlan.branches.filter((b) =>
                allowed.has(b.id),
              );
              if (!visible.length)
                add("这段分头行动中，该同行者暂未分组。", "info");
              for (const b of visible)
                add(
                  `${b.title}：${
                    b.participantIds
                      .map((id) => participants.find((p) => p.id === id)?.name)
                      .filter(Boolean)
                      .join("、") || `${b.participantIds.length} 位同行者`
                  }${b.joinItemId !== undefined ? (b.joinItemId ? `；在「${allItems.find((i) => i.id === b.joinItemId)?.title ?? "集合点"}」集合` : "；各自结束") : ""}${b.catchUpItemId ? `；迟到后改赴「${allItems.find((i) => i.id === b.catchUpItemId)?.title ?? "后续会合点"}」` : ""}`,
                  "info",
                );
            }
            if (entry.rendezvous) {
              if (item.startMinutes !== null)
                add(
                  `约定集合时间：${formatTime(item.startMinutes * 60)}`,
                  "info",
                );
              add(
                `集合：${entry.rendezvous.policy === "wait_all" ? "等齐再走" : "按固定时间开始"}`,
                "info",
              );
              for (const group of entry.rendezvous.arrivals)
                add(
                  `${group.title}：${group.arrival === null ? "到达时间待定" : `预计 ${formatTime(group.arrival)} 到达`}${group.waitMinutes ? `，等待 ${group.waitMinutes} 分钟` : ""}${group.lateMinutes ? `，迟到 ${group.lateMinutes} 分钟` : ""}`,
                  "info",
                );
            }
            const incoming = graph.connections
              .filter(
                (c) =>
                  c.to.id === item.id &&
                  (!knownPerson || c.participantIds.includes(participantId!)),
              )
              .filter((c) => {
                const leg = day.legs.find(
                  (l) =>
                    l.fromItemId === c.from.id &&
                    l.toItemId === c.to.id &&
                    (l.branchId ?? "") === c.branchId &&
                    (l.routeRole ?? "main") === c.routeRole,
                );
                return (
                  !leg ||
                  (!participantId && c.routeRole !== "catch_up") ||
                  Object.hasOwn(timeline.departures, leg.id)
                );
              })
              .flatMap((c) => {
                const route = connection(
                  day,
                  c.from,
                  item,
                  c.branchId,
                  c.routeRole,
                );
                if (!route) return [];
                const label = graph.branches.get(c.branchId)?.title;
                const prefix = label
                  ? `${label}${c.routeRole === "catch_up" ? "（迟到后追赶）" : ""}：`
                  : "";
                return [
                  {
                    ...route,
                    summary: prefix + route.summary,
                    description: route.description
                      ? prefix + route.description
                      : "",
                    steps: route.steps.map((step) => prefix + step),
                  },
                ];
              });
            let inbound = incoming.length
              ? {
                  summary: incoming.map((c) => c.summary).join("；"),
                  description: incoming
                    .map((c) => c.description)
                    .filter(Boolean)
                    .join("；"),
                  steps: incoming.flatMap((c) => c.steps),
                }
              : null;
            if (entry.skipped) {
              inbound = null;
              add(
                `改赴「${allItems.find((i) => i.id === entry.catchUpTargetId)?.title ?? "后续会合点"}」，跳过此安排。`,
                "info",
              );
            }
            if (continued) add("跨日行动继续，分组与前一天保持一致。", "info");
            if (
              !participantId &&
              entry.people &&
              new Set(entry.people.map((p) => p.start)).size > 1 &&
              !item.parallelPlan
            )
              for (const person of entry.people) {
                const name =
                  participants.find((p) => p.id === person.participantId)
                    ?.name ??
                  graph.branches.get(person.branchId ?? "")?.title ??
                  "同行者";
                add(
                  `${name}：${person.skipped ? "改赴后续会合点" : `预计 ${formatTime(person.start)} 开始`}`,
                  "info",
                );
              }
            const stop: ItineraryStop = {
              id: continued ? `${item.id}:continue:${day.id}` : item.id,
              title: continued ? `续：${item.title}` : item.title,
              category: transport
                ? [transportLabels[transport.mode], transport.serviceNumber]
                    .filter(Boolean)
                    .join(" ")
                : item.placeCategory !== "未分类" && item.type === "place"
                  ? item.placeCategory
                  : typeLabels[item.type],
              time: continued
                ? "跨日继续"
                : entry.skipped
                  ? "改赴会合点"
                  : entry.personal
                    ? timeRange(entry.start, entry.departure)
                    : entry.rendezvous?.policy === "wait_all" && !transport
                      ? entry.arrival === null
                        ? "集合待确认"
                        : timeRange(entry.start, entry.departure)
                      : scheduled
                        ? timeRange(
                            item.startMinutes! * 60,
                            item.endMinutes !== null
                              ? item.endMinutes * 60
                              : transport
                                ? entry.departure
                                : item.startMinutes! * 60 +
                                  item.stayMinutes * 60,
                          )
                        : timeRange(entry.start, entry.departure),
              timing: entry.skipped
                ? "已跳过"
                : entry.personal
                  ? "个人预计时间"
                  : entry.rendezvous?.policy === "wait_all" && !transport
                    ? "预计集合"
                    : transport
                      ? transport.status === "confirmed"
                        ? "班次已确认"
                        : "班次待确认"
                      : scheduled
                        ? "固定时间"
                        : "预计时间",
              details,
              warnings: [...new Set(entry.warnings)],
              connection: inbound,
              ...(branch
                ? {
                    branch: {
                      title: branch.title,
                      color: branch.color,
                      sectionTitle: allItems.find(
                        (i) => i.id === branch.sectionId,
                      )!.title,
                      people: branch.participantIds
                        .map(
                          (id) => participants.find((p) => p.id === id)?.name,
                        )
                        .filter(Boolean)
                        .join("、"),
                    },
                  }
                : {}),
            };
            return stop;
          }),
      };
    });
}
