import { z } from "zod";
import type { DayPlan, Item } from "./types";
import { compilePlan, type PlanDay } from "./plan-graph";

const id = z.string().min(1).max(100);
export const parallelPlanInput = z.strictObject({
  splitItemId: id.nullable(),
  joinItemId: id.nullable(),
  joinPolicy: z.enum(["wait_all", "fixed"]).default("wait_all"),
  branches: z
    .array(
      z.strictObject({
        id,
        title: z.string().trim().min(1).max(80),
        participantIds: z.array(id).min(1).max(100),
        startMinutes: z
          .number()
          .int()
          .min(0)
          .max(366 * 1440 + 10080)
          .nullable(),
        departureItemId: id.nullable().optional(),
        entrants: z
          .array(
            z.strictObject({
              participantId: id,
              at: z.enum(["departure", "meeting"]),
              arrivalMinutes: z
                .number()
                .int()
                .min(0)
                .max(10080)
                .nullable()
                .optional(),
            }),
          )
          .max(100)
          .optional(),
        joinItemId: id.nullable().optional(),
        joinPolicy: z.enum(["wait_all", "fixed"]).optional(),
        catchUpItemId: id.nullable().optional(),
      }),
    )
    .min(2)
    .max(8),
});
export type ParallelPlan = z.infer<typeof parallelPlanInput>;
export type PlanBranch = ParallelPlan["branches"][number];
export const branchColors = [
  "#167d8d",
  "#ad6130",
  "#7564a0",
  "#3f8058",
  "#b04c72",
  "#64719c",
  "#8b752c",
  "#536b70",
];

export function orderedItems(items: Item[]) {
  return [...items].sort((a, b) => a.position - b.position);
}
export function mainItems(day: Pick<DayPlan, "items">) {
  return orderedItems(day.items).filter((item) => !item.branchId);
}
export function branchItems(day: Pick<DayPlan, "items">, branchId: string) {
  return orderedItems(day.items).filter((item) => item.branchId === branchId);
}
export function planningItems(day: Pick<DayPlan, "items" | "contextItems">) {
  return [...(day.contextItems ?? []), ...day.items];
}
export function contextualDays(days: DayPlan[]): DayPlan[] {
  return days.map((day) => ({
    ...day,
    contextItems: days
      .filter((other) => other.id !== day.id)
      .flatMap((other) => other.items),
    contextLegs: days
      .filter((other) => other.id !== day.id)
      .flatMap((other) => other.legs),
    contextDays: days.map(({ id, position, startMinutes }) => ({
      id,
      position,
      startMinutes,
    })),
  }));
}
export function branchesOf(day: Pick<DayPlan, "items" | "contextItems">) {
  return planningItems(day).flatMap((item) =>
    (item.parallelPlan?.branches ?? []).map((branch, index) => ({
      ...branch,
      sectionId: item.id,
      parentBranchId: item.branchId ?? null,
      dayId: item.dayId,
      color: branchColors[index % branchColors.length],
      joinId:
        branch.joinItemId === undefined
          ? item.parallelPlan!.joinItemId
          : branch.joinItemId,
      policy: branch.joinPolicy ?? item.parallelPlan!.joinPolicy,
    })),
  );
}
export function sectionDescendants(items: Item[], sectionId: string) {
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    const section = items.find((item) => item.id === id);
    for (const branch of section?.parallelPlan?.branches ?? [])
      for (const child of items.filter((item) => item.branchId === branch.id))
        visit(child.id);
  };
  visit(sectionId);
  return result;
}
export function dayRoots(
  day: Pick<
    DayPlan,
    | "id"
    | "position"
    | "items"
    | "contextItems"
    | "contextDays"
    | "visibleParticipantId"
  >,
) {
  const all = planningItems(day),
    branches = branchesOf(day);
  const external = all
    .filter(
      (item) =>
        item.parallelPlan &&
        !item.branchId &&
        !day.items.some((local) => local.id === item.id) &&
        (!day.visibleParticipantId ||
          item.parallelPlan.branches.some((branch) =>
            branch.participantIds.includes(day.visibleParticipantId!),
          )) &&
        (day.contextDays?.find((d) => d.id === item.dayId)?.position ??
          Infinity) <= day.position,
    )
    .filter((item) => {
      const descendants = sectionDescendants(all, item.id);
      const endpoints = branches
        .filter((b) => descendants.has(b.sectionId))
        .flatMap((b) => [b.joinId, b.catchUpItemId]);
      return (item.dayId === day.id ? day.items : all).some(
        (candidate) =>
          (descendants.has(candidate.id) || endpoints.includes(candidate.id)) &&
          (day.contextDays?.find((d) => d.id === candidate.dayId)?.position ??
            day.position) >= day.position,
      );
    });
  return [...external, ...mainItems(day)];
}
export function displayItems(
  day: Pick<DayPlan, "items"> &
    Partial<
      Pick<
        DayPlan,
        | "id"
        | "position"
        | "contextItems"
        | "contextDays"
        | "visibleParticipantId"
      >
    >,
) {
  const roots =
    day.id !== undefined && day.position !== undefined
      ? dayRoots(day as DayPlan)
      : mainItems(day);
  const seen = new Set<string>();
  function expand(item: Item): Item[] {
    if (seen.has(item.id)) return [];
    seen.add(item.id);
    return [
      item,
      ...(item.parallelPlan?.branches.flatMap((branch) => {
        const children = branchItems(day, branch.id);
        const nested = planningItems(day).filter(
          (candidate) =>
            candidate.dayId !== day.id &&
            candidate.branchId === branch.id &&
            candidate.parallelPlan &&
            [...sectionDescendants(planningItems(day), candidate.id)].some(
              (id) => day.items.some((local) => local.id === id),
            ),
        );
        return [...nested, ...children].flatMap(expand);
      }) ?? []),
    ];
  }
  return roots.flatMap(expand);
}

/** Validate the complete trip before committing any structural write. */
export function parallelTripError(
  days: PlanDay[],
  people?: Set<string>,
): string | null {
  const items = days.flatMap((day) => day.items);
  const branches = items.flatMap((item) =>
    (item.parallelPlan?.branches ?? []).map((b) => ({ ...b, owner: item })),
  );
  const byBranch = new Map(branches.map((branch) => [branch.id, branch]));
  const byId = new Map(items.map((item) => [item.id, item]));
  const positions = new Map(days.map((day) => [day.id, day.position]));
  if (
    byBranch.size !== branches.length ||
    branches.some((b) => byId.has(b.id) || people?.has(b.id))
  )
    return "分组标识不能重复或使用已有事项、同行者的标识";
  const joinPolicies = new Map<string, string>();
  for (const item of items) {
    const boundaryPeople = [
      ...(item.joinParticipantIds ?? []),
      ...(item.leaveParticipantIds ?? []),
    ];
    if (boundaryPeople.length) {
      if (item.type === "parallel") return "请在具体事项上设置加入或离开点";
      for (const list of [item.joinParticipantIds, item.leaveParticipantIds])
        if (list && (list.length > 100 || new Set(list).size !== list.length))
          return "加入或离开人员不能重复";
      if (people && boundaryPeople.some((id) => !people.has(id)))
        return "加入或离开人员不属于此行程";
      if (
        item.participantIds &&
        boundaryPeople.some((id) => !item.participantIds!.includes(id))
      )
        return "请先清除此人的加入或离开点，再取消其参加当前事项";
      const parent = item.branchId ? byBranch.get(item.branchId) : undefined;
      if (
        parent &&
        boundaryPeople.some((id) => !parent.participantIds.includes(id))
      )
        return "加入或离开人员必须属于当前分组";
    }
    if (item.participantIds != null) {
      if (item.type === "parallel") return "分头行动段请通过分组设置成员";
      if (
        !item.participantIds.length ||
        item.participantIds.length > 100 ||
        new Set(item.participantIds).size !== item.participantIds.length
      )
        return "事项参与者至少选择一人且不能重复";
      if (people && item.participantIds.some((id) => !people.has(id)))
        return "事项参与者不属于此行程";
      const parent = item.branchId ? byBranch.get(item.branchId) : undefined;
      if (
        parent &&
        item.participantIds.some((id) => !parent.participantIds.includes(id))
      )
        return "组内事项的参与者只能选择本组成员";
    }
    if (item.branchId && !byBranch.has(item.branchId))
      return "事项所属分组不存在或不属于此行程";
    if (
      item.branchId &&
      positions.get(item.dayId)! <
        positions.get(byBranch.get(item.branchId)!.owner.dayId)!
    )
      return "组内事项日期不能早于所属行动段";
    if (item.type !== "parallel") {
      if (item.parallelPlan) return "只有分头行动段可以设置分组";
      continue;
    }
    const parsed = parallelPlanInput.safeParse(item.parallelPlan);
    if (!parsed.success) return "请设置至少两组同行者和有效的分头行动安排";
    if (
      item.transport ||
      item.fixedTime ||
      item.lat != null ||
      item.lng != null
    )
      return "请在分组内添加地点或交通，并在共同事项上设置集合时间";
    const ancestors = new Set([item.id]);
    let parent = item.branchId ? byBranch.get(item.branchId)?.owner : undefined;
    while (parent) {
      if (ancestors.has(parent.id)) return "分组不能形成循环嵌套";
      ancestors.add(parent.id);
      parent = parent.branchId
        ? byBranch.get(parent.branchId)?.owner
        : undefined;
    }
    const assigned = new Set<string>();
    const plan = parsed.data;
    const split = plan.splitItemId ? byId.get(plan.splitItemId) : undefined;
    if (
      plan.splitItemId &&
      (!split ||
        split.type === "parallel" ||
        split.type === "note" ||
        (split.branchId ?? null) !== (item.branchId ?? null))
    )
      return "分开点必须是同一层安排中的地点";
    const scope = days
      .flatMap((day) => orderedItems(day.items))
      .filter(
        (candidate) => (candidate.branchId ?? null) === (item.branchId ?? null),
      );
    const markerIndex = scope.findIndex(
      (candidate) => candidate.id === item.id,
    );
    if (
      split &&
      scope.findIndex((candidate) => candidate.id === split.id) >= markerIndex
    )
      return "分开点必须在行动段之前";
    for (const b of plan.branches) {
      const requiredPoints = [
        b.departureItemId === undefined ? plan.splitItemId : b.departureItemId,
        b.joinItemId === undefined ? plan.joinItemId : b.joinItemId,
        b.catchUpItemId,
      ];
      for (const id of requiredPoints) {
        const point = id ? byId.get(id) : undefined;
        if (
          point?.participantIds &&
          b.participantIds.some(
            (person) => !point.participantIds!.includes(person),
          )
        )
          return `「${point.title}」是「${b.title}」的出发或集合点，参与者必须包含该组全部成员`;
      }
      if (b.departureItemId) {
        const departure = byId.get(b.departureItemId);
        if (
          !departure ||
          departure.branchId !== b.id ||
          departure.type === "note" ||
          departure.type === "parallel"
        )
          return `「${b.title}」的出发地点必须是本组的地点或交通安排`;
        const first = [...days]
          .sort((a, b) => a.position - b.position)
          .flatMap((day) => orderedItems(day.items))
          .find(
            (candidate) =>
              candidate.branchId === b.id && candidate.type !== "note",
          );
        if (first?.id !== departure.id)
          return `「${b.title}」的出发地点必须排在本组其他安排之前`;
      }
      for (const person of b.participantIds) {
        if (people && !people.has(person)) return "分组成员不属于此行程";
        if (assigned.has(person))
          return "同一个人在同一段分头行动中只能加入一组";
        if (
          item.branchId &&
          !byBranch.get(item.branchId)!.participantIds.includes(person)
        )
          return "嵌套分组只能安排上一级分组中的同行者";
        assigned.add(person);
      }
      const entrants = b.entrants ?? [];
      if (
        new Set(entrants.map((entrant) => entrant.participantId)).size !==
          entrants.length ||
        entrants.some(
          (entrant) => !b.participantIds.includes(entrant.participantId),
        )
      )
        return `「${b.title}」的加入设置只能填写本组成员且不能重复`;
      const joinId =
        b.joinItemId === undefined ? plan.joinItemId : b.joinItemId;
      if (!joinId && entrants.some((entrant) => entrant.at === "meeting"))
        return `请先为「${b.title}」选择集合点，再设置在集合点加入的成员`;
      const join = joinId ? byId.get(joinId) : undefined;
      const policy = b.joinPolicy ?? plan.joinPolicy;
      if (joinId) {
        if (joinPolicies.has(joinId) && joinPolicies.get(joinId) !== policy)
          return "同一集合点请选择一致的集合规则";
        joinPolicies.set(joinId, policy);
      }
      if (
        joinId &&
        (!join ||
          join.type === "parallel" ||
          join.type === "note" ||
          (join.branchId ?? null) !== (item.branchId ?? null) ||
          scope.findIndex((i) => i.id === join.id) <= markerIndex)
      )
        return "集合点必须位于行动段之后，并属于同一层安排";
      if (
        join &&
        policy === "fixed" &&
        (join.startMinutes === null || (!join.fixedTime && !join.transport))
      )
        return "固定时间集合需要先为集合事项设置固定开始时间";
      if (b.catchUpItemId && (!join || policy !== "fixed"))
        return "迟到后追赶需要设置固定时间的原集合点";
      if (b.catchUpItemId && !byId.has(b.catchUpItemId))
        return "追赶集合点不存在";
    }
  }
  try {
    compilePlan([...days].sort((a, b) => a.position - b.position));
  } catch (error) {
    return (error as Error).message;
  }
  return null;
}
export function parallelDayError(items: Item[], people?: Set<string>) {
  return parallelTripError(
    [{ id: items[0]?.dayId ?? "day", position: 0, startMinutes: 480, items }],
    people,
  );
}

/** Filtering is a projection only; calculate times from the complete day. */
export function participantDay(
  day: DayPlan,
  participantId: string | null,
  timeline?: {
    entries: import("./linear-timeline").TimelineEntry[];
    departures: Record<string, number | null>;
    activeLegIds?: string[];
    participationStart?: { position: number };
    participationEnd?: { position: number };
  },
  includeSkipped = false,
): DayPlan {
  if (!participantId)
    return timeline?.activeLegIds
      ? {
          ...day,
          legs: day.legs.filter((leg) =>
            timeline.activeLegIds!.includes(leg.id),
          ),
        }
      : day;
  if (
    (timeline?.participationStart &&
      day.position < timeline.participationStart.position) ||
    (timeline?.participationEnd &&
      day.position > timeline.participationEnd.position)
  )
    return {
      ...day,
      items: [],
      legs: [],
      contextItems: [],
      visibleParticipantId: participantId,
    };
  const allowed = new Set(
    branchesOf(day)
      .filter((b) => b.participantIds.includes(participantId))
      .map((b) => b.id),
  );
  const items = day.items.filter(
    (item) =>
      (!item.participantIds || item.participantIds.includes(participantId)) &&
      (!item.branchId || allowed.has(item.branchId)) &&
      (!timeline ||
        (!allowed.size &&
          !planningItems(day).some(
            (item) =>
              item.participantIds != null ||
              item.joinParticipantIds?.length ||
              item.leaveParticipantIds?.length,
          )) ||
        timeline.entries
          .find((entry) => entry.itemId === item.id)
          ?.people?.some(
            (person) =>
              person.participantId === participantId &&
              (includeSkipped || !person.skipped),
          )),
  );
  return {
    ...day,
    items,
    visibleParticipantId: participantId,
    contextItems: [
      ...(day.contextItems ?? []),
      ...day.items.filter(
        (item) => !items.some((visible) => visible.id === item.id),
      ),
    ],
    legs: day.legs.filter(
      (leg) =>
        items.some((item) => item.id === leg.toItemId) &&
        (!leg.branchId || allowed.has(leg.branchId)) &&
        (!timeline || Object.hasOwn(timeline.departures, leg.id)),
    ),
  };
}
