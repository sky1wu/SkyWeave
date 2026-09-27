import { z } from "zod";
import { parallelPlanInput, sectionDescendants } from "@/domain/parallel";
import { insert, update, run } from "./db";
import { AppError, requireValue } from "./errors";
import {
  access,
  checkVersion,
  getDays,
  log,
  rebuildLegs,
  revision,
  tx,
  uid,
  type Actor,
} from "./service-core";
import { placeParallel } from "./planning-service";
import * as v from "./validation";

const expectedDays = z
  .array(z.strictObject({ id: v.id, expectedVersion: v.version }))
  .min(1)
  .max(366);
export const parallelSaveInput = z.strictObject({
  dayId: v.id,
  sectionId: v.id.optional(),
  expectedVersion: v.version.optional(),
  expectedDays,
  title: z.string().trim().min(1).max(200),
  branchId: v.id.nullable().optional(),
  parallelPlan: parallelPlanInput,
  assignments: z
    .array(
      z.strictObject({
        itemId: v.id,
        branchId: v.id.nullable(),
        expectedVersion: v.version,
      }),
    )
    .max(10000)
    .default([]),
});
export const parallelTransferInput = z.strictObject({
  sectionId: v.id,
  operation: z.enum(["copy", "move"]),
  targetDayId: v.id,
  targetBranchId: v.id.nullable().default(null),
  beforeItemId: v.id.nullable().optional(),
  expectedDays,
});
function checkedDays(
  tripId: string,
  actor: Actor,
  expected: z.infer<typeof expectedDays>,
) {
  access(tripId, actor, "edit");
  const days = getDays(tripId);
  if (
    expected.length !== days.length ||
    new Set(expected.map((d) => d.id)).size !== days.length ||
    days.some((day) => !expected.some((e) => e.id === day.id))
  )
    throw new AppError(409, "CONFLICT", "行程日期已变化，请刷新后重新操作");
  for (const day of days)
    checkVersion(day, expected.find((e) => e.id === day.id)!.expectedVersion);
  return days;
}
export function saveParallel(tripId: string, actor: Actor, body: unknown) {
  const data = parallelSaveInput.parse(body);
  return tx(() => {
    const days = checkedDays(tripId, actor, data.expectedDays),
      day = requireValue(
        days.find((d) => d.id === data.dayId),
        "日期不属于此行程",
      );
    const all = days.flatMap((d) => d.items);
    const old = data.sectionId
      ? requireValue(
          all.find((i) => i.id === data.sectionId && i.type === "parallel"),
          "行动段不存在",
        )
      : undefined;
    if (old) {
      if (data.expectedVersion === undefined)
        throw new AppError(400, "VALIDATION", "修改行动段需要其最新版本");
      checkVersion(old, data.expectedVersion);
      if (old.dayId !== data.dayId)
        throw new AppError(400, "VALIDATION", "请使用整段移动调整行动段日期");
    }
    if (
      new Set(data.assignments.map((a) => a.itemId)).size !==
      data.assignments.length
    )
      throw new AppError(400, "VALIDATION", "批量分组的事项不能重复");
    const id = old?.id ?? uid();
    const fields = {
      title: data.title,
      type: "parallel",
      branchId: data.branchId ?? old?.branchId ?? null,
      parallelPlan: data.parallelPlan,
    };
    if (old)
      update("day_items", id, {
        ...fields,
        version: old.version + 1,
        updatedAt: Date.now(),
        updatedByUserId: actor.id,
      });
    else
      insert("day_items", {
        id,
        dayId: day.id,
        position: Math.max(-1, ...day.items.map((i) => i.position)) + 1,
        ...fields,
        ...revision(actor),
      });
    for (const assignment of data.assignments) {
      const item = requireValue(
        all.find((i) => i.id === assignment.itemId),
        "事项不属于此行程",
      );
      if (item.id === id)
        throw new AppError(400, "VALIDATION", "行动段不能放入自己的分组");
      checkVersion(item, assignment.expectedVersion);
      update("day_items", item.id, {
        branchId: assignment.branchId,
        version: item.version + 1,
        updatedAt: Date.now(),
        updatedByUserId: actor.id,
      });
    }
    placeParallel(day.id, id, data.parallelPlan, actor);
    rebuildLegs(day.id, actor);
    run(
      "UPDATE days SET version=version+1, updatedAt=?, updatedByUserId=? WHERE id=?",
      Date.now(),
      actor.id,
      day.id,
    );
    log(
      tripId,
      actor,
      "item.updated",
      "day_item",
      id,
      `${old ? "调整" : "创建"}了分头行动「${data.title}」及组内安排`,
    );
    return { id };
  });
}
export function parallelTransferPreview(
  tripId: string,
  sectionId: string,
  actor: Actor,
) {
  access(tripId, actor);
  const days = getDays(tripId),
    all = days.flatMap((day) => day.items);
  const root = requireValue(
    all.find((item) => item.id === sectionId && item.parallelPlan),
    "行动段不存在",
  );
  const included = sectionDescendants(all, root.id);
  for (const item of all.filter((item) => included.has(item.id)))
    if (item.parallelPlan) {
      for (const id of [
        item.parallelPlan.splitItemId,
        item.parallelPlan.joinItemId,
        ...item.parallelPlan.branches.flatMap((b) => [
          b.joinItemId,
          b.catchUpItemId,
        ]),
      ])
        if (id) included.add(id);
    }
  const items = all.filter((item) => included.has(item.id));
  return { root, items, days };
}
export function transferParallel(tripId: string, actor: Actor, body: unknown) {
  const data = parallelTransferInput.parse(body);
  return tx(() => {
    const days = checkedDays(tripId, actor, data.expectedDays);
    const { root, items } = parallelTransferPreview(
      tripId,
      data.sectionId,
      actor,
    );
    const source = requireValue(days.find((day) => day.id === root.dayId));
    const target = requireValue(
      days.find((day) => day.id === data.targetDayId),
      "目标日期不属于此行程",
    );
    const delta = target.position - source.position;
    const destination = new Map<string, string>();
    for (const item of items) {
      const from = days.find((day) => day.id === item.dayId)!;
      const to = days.find((day) => day.position === from.position + delta);
      if (!to)
        throw new AppError(
          400,
          "VALIDATION",
          "目标日期范围不足，请先延长行程日期",
        );
      destination.set(item.id, to.id);
    }
    if (
      data.beforeItemId &&
      !target.items.some((i) => i.id === data.beforeItemId)
    )
      throw new AppError(400, "VALIDATION", "插入位置不属于目标日期");
    if (data.beforeItemId && items.some((i) => i.id === data.beforeItemId))
      throw new AppError(400, "VALIDATION", "不能将行动段移动到自己内部");
    const idMap = new Map(
      items.map((item) => [
        item.id,
        data.operation === "copy" ? uid() : item.id,
      ]),
    );
    const branchMap = new Map(
      items
        .flatMap((item) => item.parallelPlan?.branches ?? [])
        .map((b) => [b.id, data.operation === "copy" ? uid() : b.id]),
    );
    const ref = (id: string | null | undefined) =>
      id == null ? id : (idMap.get(id) ?? id);
    const nextPositions = new Map(
      days.map((day) => [
        day.id,
        Math.max(-1, ...day.items.map((i) => i.position)) + 1,
      ]),
    );
    for (const item of items) {
      const dayId = destination.get(item.id)!;
      const position = nextPositions.get(dayId)!;
      nextPositions.set(dayId, position + 1);
      const branchId =
        item.branchId && branchMap.has(item.branchId)
          ? branchMap.get(item.branchId)!
          : data.targetBranchId;
      const parallelPlan = item.parallelPlan
        ? {
            ...item.parallelPlan,
            splitItemId: ref(item.parallelPlan.splitItemId)!,
            joinItemId: ref(item.parallelPlan.joinItemId)!,
            branches: item.parallelPlan.branches.map((b) => ({
              ...b,
              id: branchMap.get(b.id)!,
              joinItemId: ref(b.joinItemId),
              catchUpItemId: ref(b.catchUpItemId),
            })),
          }
        : null;
      if (data.operation === "copy") {
        const fields = v.itemInput.strip().parse(item);
        insert("day_items", {
          ...fields,
          id: idMap.get(item.id)!,
          dayId,
          position,
          branchId,
          parallelPlan,
          ...revision(actor),
        });
      } else {
        update("day_items", item.id, {
          dayId,
          position,
          branchId,
          parallelPlan,
          version: item.version + 1,
          updatedAt: Date.now(),
          updatedByUserId: actor.id,
        });
        run(
          "UPDATE expenses SET dayId=?, version=version+1, updatedAt=?, updatedByUserId=? WHERE dayItemId=?",
          dayId,
          Date.now(),
          actor.id,
          item.id,
        );
      }
    }
    if (data.beforeItemId) {
      const movedIds = new Set(
        items
          .filter((item) => destination.get(item.id) === target.id)
          .map((item) => idMap.get(item.id)!),
      );
      const current = getDays(tripId)
        .find((day) => day.id === target.id)!
        .items.map((item) => item.id)
        .filter((id) => !movedIds.has(id));
      current.splice(current.indexOf(data.beforeItemId), 0, ...movedIds);
      current.forEach((id, position) =>
        run("UPDATE day_items SET position=? WHERE id=?", position, id),
      );
    }
    rebuildLegs(target.id, actor);
    if (data.operation === "copy") {
      const newLegs = getDays(tripId).flatMap((day) => day.legs);
      for (const old of days
        .flatMap((day) => day.legs)
        .filter(
          (leg) => idMap.has(leg.fromItemId) && idMap.has(leg.toItemId),
        )) {
        const leg = newLegs.find(
          (leg) =>
            leg.fromItemId === idMap.get(old.fromItemId) &&
            leg.toItemId === idMap.get(old.toItemId) &&
            (leg.branchId ?? "") ===
              (branchMap.get(old.branchId ?? "") ??
                data.targetBranchId ??
                "") &&
            (leg.routeRole ?? "main") === (old.routeRole ?? "main"),
        );
        if (!leg) continue;
        let selected: string | null = null;
        for (const alternative of old.alternatives) {
          const id = uid();
          insert("route_alternatives", {
            ...alternative,
            id,
            travelLegId: leg.id,
            polyline: alternative.polyline ?? [],
          });
          if (alternative.id === old.selectedAlternativeId) selected = id;
        }
        update("travel_legs", leg.id, {
          mode: old.mode,
          provider: old.provider,
          manualDurationMinutes: old.manualDurationMinutes,
          manualDistanceMeters: old.manualDistanceMeters,
          manualDescription: old.manualDescription,
          selectedAlternativeId: selected,
          selectionSource: old.selectionSource,
          status: old.mode === "manual" ? "ready" : "pending",
          requestKey: null,
        });
      }
    }
    run(
      "UPDATE days SET version=version+1, updatedAt=?, updatedByUserId=? WHERE id=?",
      Date.now(),
      actor.id,
      target.id,
    );
    log(
      tripId,
      actor,
      "item.updated",
      "day_item",
      idMap.get(root.id)!,
      `${data.operation === "copy" ? "复制" : "移动"}了「${root.title}」及 ${items.length - 1} 项关联安排`,
    );
    return {
      id: idMap.get(root.id)!,
      itemCount: items.length,
      dayId: target.id,
    };
  });
}
