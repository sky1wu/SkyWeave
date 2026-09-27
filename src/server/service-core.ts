import { randomUUID } from "node:crypto";
import { tripRouteConnections } from "@/domain/timeline";
import { parallelTripError } from "@/domain/parallel";
import { routeEndpoint } from "@/domain/transport";
import type {
  Trip,
  Day,
  Item,
  Leg,
  Alternative,
  RouteAlternative,
  Member,
  DayPlan,
  DayGeometry,
} from "@/domain/types";
import { sqlite, one, many, run, insert } from "./db";
import { AppError, conflict, requireValue } from "./errors";

export interface Actor {
  id: string;
  name: string;
  email: string;
  sessionId?: string;
}
export const uid = randomUUID;
export const tx = <T>(fn: () => T): T => sqlite.transaction(fn).immediate();
// A consistent read snapshot must not acquire SQLite's single writer slot.
export const readTx = <T>(fn: () => T): T => sqlite.transaction(fn).deferred();
export function tripSequence(tripId: string) {
  return one<{ sequence: number }>(
    "SELECT coalesce(max(sequence),0) sequence FROM activity_logs WHERE tripId=?",
    tripId,
  )!.sequence;
}
export function groupBy<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}
const summaryColumns =
  "id,travelLegId,provider,fingerprint,position,label,distanceMeters,durationSeconds,walkingDistanceMeters,transferCount,steps,summary,geometryComplete,fetchedAt"
    .split(",")
    .map((column) => `a.${column}`)
    .join(",");

export function getDays(
  tripId: string,
  options: { items: boolean; routes: "full" | "summary" | "none" } = {
    items: true,
    routes: "full",
  },
): DayPlan[] {
  const days = many<Day>(
    "SELECT * FROM days WHERE tripId=? ORDER BY position",
    tripId,
  );
  const items = groupBy(
    options.items
      ? many<Item>(
          "SELECT i.* FROM day_items i JOIN days d ON d.id=i.dayId WHERE d.tripId=? ORDER BY i.position",
          tripId,
        )
      : [],
    (item) => item.dayId,
  );
  const legs =
    options.routes === "none"
      ? []
      : many<Leg>(
          "SELECT l.* FROM travel_legs l JOIN days d ON d.id=l.dayId WHERE d.tripId=?",
          tripId,
        );
  const alternatives = groupBy(
    options.routes === "none"
      ? []
      : many<RouteAlternative>(
          `SELECT ${options.routes === "full" ? "a.*" : summaryColumns} FROM route_alternatives a JOIN travel_legs l ON l.id=a.travelLegId JOIN days d ON d.id=l.dayId WHERE d.tripId=? ORDER BY a.position`,
          tripId,
        ),
    (alternative) => alternative.travelLegId,
  );
  const groupedLegs = groupBy(
    legs.map((leg) => ({
      ...leg,
      alternatives: alternatives.get(leg.id) ?? [],
    })),
    (leg) => leg.dayId,
  );
  const participantIds = [...items.values()].some((rows) =>
    rows.some((item) => item.parallelPlan),
  )
    ? many<{ id: string }>(
        "SELECT id FROM trip_participants WHERE tripId=? AND status='active'",
        tripId,
      ).map((person) => person.id)
    : undefined;
  return days.map((day) => ({
    ...day,
    ...(participantIds ? { participantIds } : {}),
    items: items.get(day.id) ?? [],
    legs: groupedLegs.get(day.id) ?? [],
  }));
}

export function dayGeometry(dayId: string, actor: Actor): DayGeometry {
  return readTx(() => {
    const day = requireValue(one<Day>("SELECT * FROM days WHERE id=?", dayId));
    access(day.tripId, actor);
    return {
      dayId,
      version: day.version,
      // The map draws only the selected route, not every candidate.
      alternatives: many<Pick<Alternative, "id" | "polyline">>(
        "SELECT a.id, a.polyline FROM route_alternatives a JOIN travel_legs l ON l.id=a.travelLegId AND l.selectedAlternativeId=a.id WHERE l.dayId=?",
        dayId,
      ),
    };
  });
}
export function revision(actor: Actor) {
  const now = Date.now();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    updatedByUserId: actor.id,
  };
}
export function access(
  tripId: string,
  actor: Actor,
  permission: "read" | "edit" | "owner" = "read",
): Member {
  const member = one<Member>(
    "SELECT * FROM trip_members WHERE tripId = ? AND userId = ? AND status = 'active'",
    tripId,
    actor.id,
  );
  if (!member)
    throw new AppError(404, "NOT_FOUND", "行程不存在或你已没有访问权限");
  if (
    (permission === "edit" && member.role === "viewer") ||
    (permission === "owner" && member.role !== "owner")
  )
    throw new AppError(403, "FORBIDDEN", "你没有执行此操作的权限");
  return member;
}
export function log(
  tripId: string,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
) {
  insert("activity_logs", {
    id: uid(),
    tripId,
    actorUserId: actor.id,
    action,
    entityType,
    entityId,
    summary,
    createdAt: Date.now(),
  });
}
export function checkVersion(entity: { version: number }, expected: number) {
  if (entity.version !== expected) conflict();
}
export function getTrip(id: string) {
  return requireValue(one<Trip>("SELECT * FROM trips WHERE id = ?", id));
}
export function getDay(id: string): DayPlan {
  const day = requireValue(one<Day>("SELECT * FROM days WHERE id = ?", id));
  const alternatives = groupBy(
    many<Alternative>(
      "SELECT a.* FROM route_alternatives a JOIN travel_legs l ON l.id=a.travelLegId WHERE l.dayId=? ORDER BY a.position",
      id,
    ),
    (alternative) => alternative.travelLegId,
  );
  return {
    ...day,
    participantIds: many<{ id: string }>(
      "SELECT id FROM trip_participants WHERE tripId=? AND status='active'",
      day.tripId,
    ).map((person) => person.id),
    items: many<Item>(
      "SELECT * FROM day_items WHERE dayId = ? ORDER BY position",
      id,
    ),
    legs: many<Leg>("SELECT * FROM travel_legs WHERE dayId = ?", id).map(
      (l) => ({
        ...l,
        alternatives: alternatives.get(l.id) ?? [],
      }),
    ),
  };
}
export function touchDay(id: string, actor: Actor) {
  run(
    "UPDATE days SET version = version + 1, updatedAt = ?, updatedByUserId = ? WHERE id = ?",
    Date.now(),
    actor.id,
    id,
  );
}
export function rebuildLegs(dayId: string, actor: Actor) {
  const owner = requireValue(one<Day>("SELECT * FROM days WHERE id=?", dayId));
  const days = getDays(owner.tripId);
  const error = parallelTripError(
    days,
    new Set(
      many<{ id: string }>(
        "SELECT id FROM trip_participants WHERE tripId=?",
        owner.tripId,
      ).map((p) => p.id),
    ),
  );
  if (error) throw new AppError(400, "VALIDATION", error);
  const pairs = tripRouteConnections(days);
  const old = days.flatMap((day) => day.legs);
  for (const leg of old)
    if (
      !pairs.some(
        ({ from, to, branchId, routeRole }) =>
          from.id === leg.fromItemId &&
          to.id === leg.toItemId &&
          branchId === (leg.branchId ?? "") &&
          routeRole === (leg.routeRole ?? "main"),
      )
    )
      run("DELETE FROM travel_legs WHERE id=?", leg.id);
  for (const { from: a, to: b, branchId, routeRole } of pairs) {
    const existing = old.find(
      (leg) =>
        leg.fromItemId === a.id &&
        leg.toItemId === b.id &&
        (leg.branchId ?? "") === branchId &&
        (leg.routeRole ?? "main") === routeRole,
    );
    if (existing) {
      if (existing.dayId !== b.dayId)
        run(
          "UPDATE travel_legs SET dayId=?, version=version+1, updatedAt=?, updatedByUserId=? WHERE id=?",
          b.dayId,
          Date.now(),
          actor.id,
          existing.id,
        );
      continue;
    }
    const from = routeEndpoint(a, "departure"),
      to = routeEndpoint(b, "arrival");
    insert("travel_legs", {
      id: uid(),
      dayId: b.dayId,
      branchId,
      routeRole,
      fromItemId: a.id,
      toItemId: b.id,
      ...(from.lat === to.lat && from.lng === to.lng
        ? {
            mode: "manual",
            provider: "manual",
            manualDurationMinutes: 0,
            manualDistanceMeters: 0,
            manualDescription: "同一地点，无需移动",
            status: "ready",
          }
        : {}),
      ...revision(actor),
    });
  }
  if (days.some((day) => day.items.some((item) => item.parallelPlan)))
    for (const day of days) if (day.id !== dayId) touchDay(day.id, actor);
}
export function touchRelatedDays(dayId: string, actor: Actor) {
  const day = requireValue(one<Day>("SELECT * FROM days WHERE id=?", dayId));
  if (
    one(
      "SELECT i.id FROM day_items i JOIN days d ON d.id=i.dayId WHERE d.tripId=? AND i.parallelPlan IS NOT NULL LIMIT 1",
      day.tripId,
    )
  )
    run(
      "UPDATE days SET version=version+1, updatedAt=?, updatedByUserId=? WHERE tripId=? AND id!=?",
      Date.now(),
      actor.id,
      day.tripId,
      dayId,
    );
}
