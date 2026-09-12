import { z } from "zod";
import { one, insert, update, run } from "./db";
import {
  access,
  getDay,
  tx,
  uid,
  revision,
  checkVersion,
  log,
  createItem,
  touchDay,
  rebuildLegs,
  type Actor,
} from "./service";
import { requireValue, AppError } from "./errors";
import { poolInput, id, version } from "./validation";
import { inferPlaceCategory } from "@/domain/planning";
import type { PoolPlace, Item } from "@/domain/types";

function coordinates(data: { lat?: number | null; lng?: number | null }) {
  if ((data.lat == null) !== (data.lng == null))
    throw new AppError(400, "VALIDATION", "经纬度必须成对填写");
}
export function savePoolPlace(
  tripId: string,
  actor: Actor,
  body: unknown,
  placeId?: string,
) {
  const parsed = placeId
    ? poolInput.partial().extend({ expectedVersion: version }).parse(body)
    : poolInput.parse(body);
  return tx(() => {
    access(tripId, actor, "edit");
    const old = placeId
      ? requireValue(
          one<PoolPlace>(
            "SELECT * FROM trip_places WHERE id=? AND tripId=?",
            placeId,
            tripId,
          ),
        )
      : null;
    if (old && "expectedVersion" in parsed)
      checkVersion(old, parsed.expectedVersion as number);
    const data = Object.fromEntries(
      Object.entries(parsed).filter(([key]) => key !== "expectedVersion"),
    );
    coordinates({ ...old, ...data });
    const poiId = data.amapPoiId;
    if (typeof poiId === "string") {
      const duplicate = one<PoolPlace>(
        "SELECT * FROM trip_places WHERE tripId=? AND amapPoiId=?",
        tripId,
        poiId,
      );
      if (duplicate && duplicate.id !== placeId) {
        if (placeId)
          throw new AppError(409, "DUPLICATE_PLACE", "该地点已在地点池中");
        return { id: duplicate.id, created: false };
      }
    }
    const resultId = placeId ?? uid();
    if (old)
      update("trip_places", resultId, {
        ...data,
        version: old.version + 1,
        updatedAt: Date.now(),
        updatedByUserId: actor.id,
      });
    else
      insert("trip_places", {
        id: resultId,
        tripId,
        type: "place",
        placeCategory: inferPlaceCategory([], data.type as string | undefined),
        ...data,
        ...revision(actor),
      });
    log(
      tripId,
      actor,
      "place.updated",
      "pool_place",
      resultId,
      `${old ? "修改" : "收藏"}了地点「${data.title ?? old?.title}」`,
    );
    return { id: resultId, created: !old };
  });
}
export function deletePoolPlace(
  tripId: string,
  placeId: string,
  actor: Actor,
  expected: number,
) {
  return tx(() => {
    access(tripId, actor, "edit");
    const place = requireValue(
      one<PoolPlace>(
        "SELECT * FROM trip_places WHERE id=? AND tripId=?",
        placeId,
        tripId,
      ),
    );
    checkVersion(place, expected);
    run(
      "UPDATE day_items SET sourcePlaceId=NULL, version=version+1, updatedAt=?, updatedByUserId=? WHERE sourcePlaceId=?",
      Date.now(),
      actor.id,
      placeId,
    );
    run("DELETE FROM trip_places WHERE id=?", placeId);
    log(
      tripId,
      actor,
      "place.updated",
      "pool_place",
      placeId,
      `从地点池移除了「${place.title}」`,
    );
    return { deleted: true };
  });
}
function setOrder(dayId: string, ids: string[], actor: Actor) {
  ids.forEach((itemId, position) =>
    run(
      "UPDATE day_items SET position=?, version=version+1, updatedAt=?, updatedByUserId=? WHERE id=? AND dayId=? AND position!=?",
      position,
      Date.now(),
      actor.id,
      itemId,
      dayId,
      position,
    ),
  );
}
export function schedulePlace(
  tripId: string,
  placeId: string,
  actor: Actor,
  body: unknown,
) {
  const data = z
    .strictObject({
      dayId: id,
      beforeItemId: id.nullable().optional(),
      expectedVersion: version,
      expectedDayVersion: version,
    })
    .parse(body);
  return tx(() => {
    access(tripId, actor, "edit");
    const place = requireValue(
      one<PoolPlace>(
        "SELECT * FROM trip_places WHERE id=? AND tripId=?",
        placeId,
        tripId,
      ),
    );
    const day = getDay(data.dayId);
    if (day.tripId !== tripId)
      throw new AppError(404, "NOT_FOUND", "日期不属于此行程");
    checkVersion(place, data.expectedVersion);
    checkVersion(day, data.expectedDayVersion);
    if (data.beforeItemId && !day.items.some((i) => i.id === data.beforeItemId))
      throw new AppError(400, "VALIDATION", "插入位置不属于目标日期");
    const created = createItem(day.id, actor, {
      title: place.title,
      type: place.type,
      placeCategory: place.placeCategory,
      sourcePlaceId: place.id,
      amapPoiId: place.amapPoiId,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      notes: place.notes,
    });
    const ids = day.items.map((i) => i.id);
    ids.splice(
      data.beforeItemId ? ids.indexOf(data.beforeItemId) : ids.length,
      0,
      created.id,
    );
    setOrder(day.id, ids, actor);
    rebuildLegs(day.id, actor);
    return created;
  });
}
export function moveItem(itemId: string, actor: Actor, body: unknown) {
  const data = z
    .strictObject({
      dayId: id,
      beforeItemId: id.nullable().optional(),
      expectedVersion: version,
      expectedSourceDayVersion: version,
      expectedTargetDayVersion: version,
    })
    .parse(body);
  return tx(() => {
    const item = requireValue(
      one<Item>("SELECT * FROM day_items WHERE id=?", itemId),
    );
    const source = getDay(item.dayId),
      target = getDay(data.dayId);
    access(source.tripId, actor, "edit");
    if (source.tripId !== target.tripId)
      throw new AppError(400, "VALIDATION", "不能跨行程移动事项");
    checkVersion(item, data.expectedVersion);
    checkVersion(source, data.expectedSourceDayVersion);
    checkVersion(target, data.expectedTargetDayVersion);
    if (data.beforeItemId === itemId) return { id: itemId };
    if (
      data.beforeItemId &&
      !target.items.some((i) => i.id === data.beforeItemId)
    )
      throw new AppError(400, "VALIDATION", "插入位置不属于目标日期");
    const targetIds = target.items
      .map((i) => i.id)
      .filter((id) => id !== itemId);
    targetIds.splice(
      data.beforeItemId
        ? targetIds.indexOf(data.beforeItemId)
        : targetIds.length,
      0,
      itemId,
    );
    update("day_items", itemId, {
      dayId: target.id,
      version: item.version + 1,
      updatedAt: Date.now(),
      updatedByUserId: actor.id,
    });
    if (source.id !== target.id) {
      setOrder(
        source.id,
        source.items.filter((i) => i.id !== itemId).map((i) => i.id),
        actor,
      );
      run(
        "UPDATE expenses SET dayId=?, version=version+1, updatedAt=?, updatedByUserId=? WHERE dayItemId=?",
        target.id,
        Date.now(),
        actor.id,
        itemId,
      );
      touchDay(source.id, actor);
      rebuildLegs(source.id, actor);
    }
    setOrder(target.id, targetIds, actor);
    touchDay(target.id, actor);
    rebuildLegs(target.id, actor);
    log(
      source.tripId,
      actor,
      "item.reordered",
      "day_item",
      itemId,
      `将「${item.title}」移至「${target.title}」`,
    );
    return { id: itemId };
  });
}
