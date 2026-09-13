import { amap } from "@/amap/service";
import type { RouteRequest } from "@/amap/requests";
import { calculateTimeline, departureISO } from "@/domain/timeline";
import type { Leg } from "@/domain/types";
import { routeEndpoint } from "@/domain/transport";
import {
  access,
  getDay,
  getTrip,
  log,
  tx,
  uid,
  type Actor,
  touchDay,
} from "./service-core";
import { one, insert, run, update } from "./db";
import { AppError, conflict, requireValue } from "./errors";

export async function calculateLeg(legId: string, actor: Actor, force = false) {
  const leg = requireValue(
    one<Leg>("SELECT * FROM travel_legs WHERE id=?", legId),
  );
  const day = getDay(leg.dayId);
  access(day.tripId, actor, "edit");
  if (leg.mode === "manual") return { changed: false };
  const origin = routeEndpoint(
      requireValue(day.items.find((i) => i.id === leg.fromItemId)),
      "departure",
    ),
    destination = routeEndpoint(
      requireValue(day.items.find((i) => i.id === leg.toItemId)),
      "arrival",
    );
  const departure = calculateTimeline(day).departures[legId] ?? null;
  const request: RouteRequest = {
    mode: leg.mode,
    origin: {
      lat: origin.lat!,
      lng: origin.lng!,
      ...(origin.amapPoiId ? { amapPoiId: origin.amapPoiId } : {}),
    },
    destination: {
      lat: destination.lat!,
      lng: destination.lng!,
      ...(destination.amapPoiId ? { amapPoiId: destination.amapPoiId } : {}),
    },
    departureTime: departureISO(
      day.date,
      departure,
      getTrip(day.tripId).timezone,
    ),
  };
  const key = amap.key(request);
  if (!force && leg.requestKey === key && leg.status !== "pending")
    return { changed: false };
  let candidates: Awaited<ReturnType<typeof amap.routes>> = [],
    error: string | null = null;
  try {
    candidates = await amap.routes(request);
    if (!candidates.length)
      error = "高德未找到路线，请尝试其他交通方式或手动交通段";
  } catch (e) {
    error = e instanceof AppError ? e.message : "路线计算失败，请稍后重试";
  }
  return tx(() => {
    access(day.tripId, actor, "edit");
    const current = one<Leg>("SELECT * FROM travel_legs WHERE id=?", legId);
    if (
      !current ||
      current.version !== leg.version ||
      getDay(day.id).version !== day.version
    )
      conflict();
    const selected = day.legs
      .find((l) => l.id === legId)
      ?.alternatives.find((a) => a.id === leg.selectedAlternativeId);
    run("DELETE FROM route_alternatives WHERE travelLegId=?", legId);
    const saved = candidates.map((c, i) => ({
      ...c,
      id: uid(),
      travelLegId: legId,
      position: i,
      label: `方案 ${i + 1}`,
      fetchedAt: Date.now(),
    }));
    for (const candidate of saved) insert("route_alternatives", candidate);
    const match =
      selected && saved.find((c) => c.fingerprint === selected.fingerprint);
    const selectionLost =
      leg.selectionSource === "user" && selected && !match && saved.length;
    update("travel_legs", legId, {
      selectedAlternativeId: (match ?? saved[0])?.id ?? null,
      selectionSource: match ? leg.selectionSource : "recommended",
      status: error ? "error" : "ready",
      error,
      requestKey: key,
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
      selectionLost
        ? "原路线方案不可用，已选择新的推荐方案"
        : error
          ? "路线计算未完成"
          : "更新了交通路线候选",
    );
    return { changed: true };
  });
}
const globalRouting = globalThis as typeof globalThis & {
  tripRouting?: Map<string, Promise<unknown>>;
};
const pending =
  globalRouting.tripRouting ?? new Map<string, Promise<unknown>>();
globalRouting.tripRouting = pending;
export async function calculateDay(dayId: string, actor: Actor, force = false) {
  access(getDay(dayId).tripId, actor, "edit");
  const running = pending.get(dayId);
  if (running) return running;
  const task = (async () => {
    const day = getDay(dayId);
    for (const item of day.items) {
      const leg = day.legs.find((l) => l.toItemId === item.id);
      if (leg) await calculateLeg(leg.id, actor, force);
    }
    return { id: dayId };
  })().finally(() => pending.delete(dayId));
  pending.set(dayId, task);
  return task;
}
