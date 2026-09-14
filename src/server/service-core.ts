import { randomUUID } from "node:crypto";
import { routePairs } from "@/domain/timeline";
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
  return days.map((day) => ({
    ...day,
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
  const day = getDay(dayId);
  const pairs = routePairs(day.items);
  for (const leg of day.legs)
    if (
      !pairs.some(([a, b]) => a.id === leg.fromItemId && b.id === leg.toItemId)
    )
      run("DELETE FROM travel_legs WHERE id = ?", leg.id);
  for (const [a, b] of pairs)
    if (!day.legs.some((l) => l.fromItemId === a.id && l.toItemId === b.id))
      insert("travel_legs", {
        id: uid(),
        dayId,
        fromItemId: a.id,
        toItemId: b.id,
        ...(routeEndpoint(a, "departure").lat ===
          routeEndpoint(b, "arrival").lat &&
        routeEndpoint(a, "departure").lng === routeEndpoint(b, "arrival").lng
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
