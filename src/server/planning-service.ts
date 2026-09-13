import { z } from "zod";
import { itemSourcePlaceIds } from "@/domain/planning";
import { routeEndpoint } from "@/domain/transport";
import type { Item, Leg } from "@/domain/types";
import { one, run, insert, update } from "./db";
import { AppError, requireValue } from "./errors";
import * as v from "./validation";
import {
  access,
  checkVersion,
  getDay,
  log,
  rebuildLegs,
  revision,
  touchDay,
  tx,
  uid,
  type Actor,
} from "./service-core";

export { getDay, rebuildLegs, touchDay } from "./service-core";

export function editDay(dayId: string, actor: Actor, body: unknown) {
  const { expectedVersion, ...data } = v.dayInput
    .extend({ startMinutes: v.dayInput.shape.startMinutes.removeDefault() })
    .partial()
    .extend({ expectedVersion: v.version })
    .parse(body);
  return tx(() => {
    const day = getDay(dayId);
    access(day.tripId, actor, "edit");
    checkVersion(day, expectedVersion);
    update("days", dayId, {
      ...data,
      version: day.version + 1,
      updatedAt: Date.now(),
      updatedByUserId: actor.id,
    });
    log(day.tripId, actor, "day.updated", "day", dayId, "更新了当天安排");
    return { id: dayId };
  });
}
function validItem(
  data: Pick<
    Item,
    "lat" | "lng" | "fixedTime" | "startMinutes" | "endMinutes" | "type"
  > & { transport?: Item["transport"] },
) {
  if (data.transport && data.type !== "transport")
    throw new AppError(400, "VALIDATION", "独立交通必须使用交通类型");
  if ((data.lat == null) !== (data.lng == null))
    throw new AppError(400, "VALIDATION", "经纬度必须成对填写");
  if (data.fixedTime && data.startMinutes == null)
    throw new AppError(400, "VALIDATION", "固定活动必须设置开始时间");
  if (
    data.endMinutes != null &&
    ((data.startMinutes == null && !data.transport) ||
      (data.startMinutes != null && data.endMinutes < data.startMinutes))
  )
    throw new AppError(
      400,
      "VALIDATION",
      "请设置有效的开始和结束时间，跨午夜请选择次日",
    );
}
export function createItem(dayId: string, actor: Actor, body: unknown) {
  const data = v.itemInput.parse(body);
  validItem({
    lat: null,
    lng: null,
    startMinutes: null,
    endMinutes: null,
    ...data,
  });
  return tx(() => {
    const day = getDay(dayId);
    access(day.tripId, actor, "edit");
    for (const sourceId of itemSourcePlaceIds({
      sourcePlaceId: data.sourcePlaceId ?? null,
      transport: data.transport ?? null,
    }))
      requireValue(
        one(
          "SELECT id FROM trip_places WHERE id=? AND tripId=?",
          sourceId,
          day.tripId,
        ),
        "地点不属于此行程",
      );
    const id = uid();
    insert("day_items", {
      id,
      dayId,
      position: day.items.length
        ? Math.max(...day.items.map((i) => i.position)) + 1
        : 0,
      ...data,
      ...revision(actor),
    });
    rebuildLegs(dayId, actor);
    touchDay(dayId, actor);
    log(
      day.tripId,
      actor,
      "item.created",
      "day_item",
      id,
      `添加了「${data.title}」`,
    );
    return { id };
  });
}
export function editItem(itemId: string, actor: Actor, body: unknown) {
  const { expectedVersion, ...data } = v.itemInput
    .extend({
      type: v.itemInput.shape.type.removeDefault(),
      stayMinutes: v.itemInput.shape.stayMinutes.removeDefault(),
      fixedTime: v.itemInput.shape.fixedTime.removeDefault(),
    })
    .partial()
    .extend({ expectedVersion: v.version })
    .parse(body);
  return tx(() => {
    const item = requireValue(
      one<Item>("SELECT * FROM day_items WHERE id=?", itemId),
    );
    const day = getDay(item.dayId);
    access(day.tripId, actor, "edit");
    checkVersion(item, expectedVersion);
    for (const sourceId of itemSourcePlaceIds({ ...item, ...data }))
      requireValue(
        one(
          "SELECT id FROM trip_places WHERE id=? AND tripId=?",
          sourceId,
          day.tripId,
        ),
        "地点不属于此行程",
      );
    validItem({ ...item, ...data });
    update("day_items", itemId, {
      ...data,
      version: item.version + 1,
      updatedAt: Date.now(),
      updatedByUserId: actor.id,
    });
    const endpointChanged = (side: "arrival" | "departure") => {
      const old = routeEndpoint(item, side),
        next = routeEndpoint({ ...item, ...data }, side);
      return (
        old.lat !== next.lat ||
        old.lng !== next.lng ||
        old.amapPoiId !== next.amapPoiId
      );
    };
    if (endpointChanged("arrival") || endpointChanged("departure")) {
      for (const leg of day.legs.filter(
        (l) =>
          (l.fromItemId === itemId && endpointChanged("departure")) ||
          (l.toItemId === itemId && endpointChanged("arrival")),
      )) {
        run("DELETE FROM route_alternatives WHERE travelLegId=?", leg.id);
        update("travel_legs", leg.id, {
          selectedAlternativeId: null,
          requestKey: null,
          status: "pending",
          version: leg.version + 1,
          ...(leg.mode === "manual" &&
          leg.manualDescription === "同一地点，无需移动"
            ? {
                mode: "transit",
                provider: "amap",
                manualDurationMinutes: null,
                manualDescription: null,
              }
            : {}),
        });
      }
    }
    rebuildLegs(day.id, actor);
    touchDay(day.id, actor);
    log(
      day.tripId,
      actor,
      "item.updated",
      "day_item",
      itemId,
      `修改了「${data.title ?? item.title}」`,
    );
    return { id: itemId };
  });
}
export function deleteItem(itemId: string, actor: Actor, expected: number) {
  return tx(() => {
    const item = requireValue(
      one<Item>("SELECT * FROM day_items WHERE id=?", itemId),
    );
    const day = getDay(item.dayId);
    access(day.tripId, actor, "edit");
    checkVersion(item, expected);
    run(
      "DELETE FROM comments WHERE targetType='day_item' AND targetId=?",
      itemId,
    );
    run("DELETE FROM day_items WHERE id=?", itemId);
    rebuildLegs(day.id, actor);
    touchDay(day.id, actor);
    log(
      day.tripId,
      actor,
      "item.deleted",
      "day_item",
      itemId,
      `删除了「${item.title}」`,
    );
    return { deleted: true };
  });
}
export function reorder(dayId: string, actor: Actor, body: unknown) {
  const data = z
    .strictObject({
      expectedVersion: v.version,
      itemIds: z.array(v.id).max(500),
    })
    .parse(body);
  return tx(() => {
    const day = getDay(dayId);
    access(day.tripId, actor, "edit");
    checkVersion(day, data.expectedVersion);
    if (
      data.itemIds.length !== day.items.length ||
      new Set(data.itemIds).size !== day.items.length ||
      data.itemIds.some((id) => !day.items.some((i) => i.id === id))
    )
      throw new AppError(
        400,
        "VALIDATION",
        "排序必须包含当天全部事项且不能重复",
      );
    data.itemIds.forEach((id, position) =>
      run(
        "UPDATE day_items SET position=?, version=version+1, updatedAt=?, updatedByUserId=? WHERE id=?",
        position,
        Date.now(),
        actor.id,
        id,
      ),
    );
    rebuildLegs(dayId, actor);
    touchDay(dayId, actor);
    log(day.tripId, actor, "item.reordered", "day", dayId, "调整了行程顺序");
    return { id: dayId };
  });
}
export function editLeg(legId: string, actor: Actor, body: unknown) {
  const { expectedVersion, ...data } = v.legInput.parse(body);
  return tx(() => {
    const leg = requireValue(
      one<Leg>("SELECT * FROM travel_legs WHERE id=?", legId),
    );
    const day = getDay(leg.dayId);
    access(day.tripId, actor, "edit");
    checkVersion(leg, expectedVersion);
    const mode = data.mode ?? leg.mode;
    if (
      data.selectedAlternativeId &&
      (mode === "manual" || (data.mode && data.mode !== leg.mode))
    )
      throw new AppError(400, "VALIDATION", "更换交通方式后请重新计算路线");
    if (
      data.selectedAlternativeId &&
      !one(
        "SELECT id FROM route_alternatives WHERE id=? AND travelLegId=?",
        data.selectedAlternativeId,
        legId,
      )
    )
      throw new AppError(400, "VALIDATION", "路线候选不属于此交通段");
    const modeChanged = mode !== leg.mode;
    if (modeChanged)
      run("DELETE FROM route_alternatives WHERE travelLegId=?", legId);
    update("travel_legs", legId, {
      ...data,
      provider: mode === "manual" ? "manual" : "amap",
      ...(modeChanged
        ? {
            selectedAlternativeId: null,
            selectionSource: "recommended",
            requestKey: null,
            error: null,
            status: mode === "manual" ? "ready" : "pending",
          }
        : {}),
      ...(data.selectedAlternativeId ? { selectionSource: "user" } : {}),
      version: leg.version + 1,
      updatedAt: Date.now(),
      updatedByUserId: actor.id,
    });
    touchDay(day.id, actor);
    log(
      day.tripId,
      actor,
      "leg.updated",
      "travel_leg",
      legId,
      data.selectedAlternativeId ? "切换了路线方案" : "调整了交通段",
    );
    return { id: legId };
  });
}
