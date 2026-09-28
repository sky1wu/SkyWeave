import { z } from "zod";
import type { DayPlan, Item } from "@/domain/types";
import type { ParallelPlan } from "@/domain/parallel";
import { one, update } from "./db";
import { AppError, requireValue } from "./errors";
import {
  access,
  checkVersion,
  getDays,
  log,
  rebuildLegs,
  touchDay,
  tx,
  type Actor,
} from "./service-core";
import * as v from "./validation";

export const participationInput = z
  .strictObject({
    participantId: v.id,
    joinItemId: v.id.nullable().optional(),
    leaveItemId: v.id.nullable().optional(),
    expectedDays: z
      .array(z.strictObject({ id: v.id, expectedVersion: v.version }))
      .min(1)
      .max(366),
  })
  .refine(
    (data) => data.joinItemId !== undefined || data.leaveItemId !== undefined,
    "请选择加入或离开设置",
  );

function writeItem(item: Item, fields: Partial<Item>, actor: Actor) {
  update("day_items", item.id, {
    ...fields,
    version: item.version + 1,
    updatedAt: Date.now(),
    updatedByUserId: actor.id,
  });
}

/** A newly chosen group admission replaces a direct item admission for that person. */
export function syncGroupAdmissions(
  days: DayPlan[],
  previous: ParallelPlan | null | undefined,
  next: ParallelPlan,
  actor: Actor,
) {
  const changed = new Set(
    next.branches.flatMap((branch) =>
      (branch.entrants ?? [])
        .filter((entrant) => {
          const old = previous?.branches
            .find((b) => b.id === branch.id)
            ?.entrants?.find((e) => e.participantId === entrant.participantId);
          return !old || JSON.stringify(old) !== JSON.stringify(entrant);
        })
        .map((entry) => entry.participantId),
    ),
  );
  if (!changed.size) return;
  for (const item of days.flatMap((day) => day.items)) {
    if (!item.joinParticipantIds?.some((id) => changed.has(id))) continue;
    const ids = item.joinParticipantIds.filter((id) => !changed.has(id));
    writeItem(item, { joinParticipantIds: ids.length ? ids : null }, actor);
  }
}

export function setParticipation(tripId: string, actor: Actor, body: unknown) {
  const data = participationInput.parse(body);
  return tx(() => {
    access(tripId, actor, "edit");
    const participant = requireValue(
      one<{ id: string; name: string }>(
        "SELECT id,name FROM trip_participants WHERE tripId=? AND id=?",
        tripId,
        data.participantId,
      ),
      "同行者不属于此行程",
    );
    const days = getDays(tripId);
    if (
      data.expectedDays.length !== days.length ||
      new Set(data.expectedDays.map((d) => d.id)).size !== days.length ||
      days.some((day) => !data.expectedDays.some((d) => d.id === day.id))
    )
      throw new AppError(409, "CONFLICT", "行程日期已变化，请刷新后重新操作");
    for (const day of days)
      checkVersion(
        day,
        data.expectedDays.find((d) => d.id === day.id)!.expectedVersion,
      );
    const all = days.flatMap((day) => day.items);
    for (const id of [data.joinItemId, data.leaveItemId]) {
      if (!id) continue;
      const item = requireValue(
        all.find((item) => item.id === id),
        "加入或离开点不属于此行程",
      );
      if (item.type === "parallel")
        throw new AppError(400, "VALIDATION", "请在具体事项上设置加入或离开点");
      const branch = all
        .flatMap((item) => item.parallelPlan?.branches ?? [])
        .find((branch) => branch.id === item.branchId);
      if (branch && !branch.participantIds.includes(participant.id))
        throw new AppError(
          400,
          "VALIDATION",
          "此人不在该事项所属分组，请先调整路线归属",
        );
    }
    const touched = new Set<string>();
    for (const item of all) {
      const fields: Partial<Item> = {};
      for (const [field, target] of [
        ["joinParticipantIds", data.joinItemId],
        ["leaveParticipantIds", data.leaveItemId],
      ] as const) {
        if (target === undefined) continue;
        const ids = (item[field] ?? []).filter((id) => id !== participant.id);
        if (item.id === target) ids.push(participant.id);
        if (JSON.stringify(ids) !== JSON.stringify(item[field] ?? []))
          fields[field] = ids.length ? ids : null;
      }
      if (
        data.joinItemId !== undefined &&
        item.parallelPlan?.branches.some((b) =>
          b.entrants?.some((e) => e.participantId === participant.id),
        )
      )
        fields.parallelPlan = {
          ...item.parallelPlan,
          branches: item.parallelPlan.branches.map((b) => ({
            ...b,
            ...(b.entrants
              ? {
                  entrants: b.entrants.filter(
                    (e) => e.participantId !== participant.id,
                  ),
                }
              : {}),
          })),
        };
      // The inclusive boundary itself must include this person.
      if (
        (item.id === data.joinItemId || item.id === data.leaveItemId) &&
        item.participantIds &&
        !item.participantIds.includes(participant.id)
      )
        fields.participantIds = [...item.participantIds, participant.id];
      if (Object.keys(fields).length) {
        writeItem(item, fields, actor);
        touched.add(item.dayId);
      }
    }
    if (touched.size) {
      const first = [...touched][0];
      rebuildLegs(first, actor);
      // Even clearing the final boundary changes personal paths across the trip.
      for (const day of days) touchDay(day.id, actor);
      log(
        tripId,
        actor,
        "item.updated",
        "participant",
        participant.id,
        `调整了「${participant.name}」的加入与离开范围`,
      );
    }
    return { participantId: participant.id };
  });
}
