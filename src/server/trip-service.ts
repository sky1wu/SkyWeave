import { z } from "zod";
import { DateTime } from "luxon";
import { dayTitle, tripDates } from "@/domain/calendar";
import type {
  Trip,
  PoolPlace,
  Day,
  Participant,
  Member,
  TripSection,
  VersionedSnapshot,
  Expense,
  Split,
  Settlement,
  Comment,
  Activity,
  Invite,
} from "@/domain/types";
import { one, many, run, insert, update } from "./db";
import { AppError } from "./errors";
import * as v from "./validation";
import {
  access,
  checkVersion,
  getDays,
  getTrip,
  groupBy,
  log,
  readTx,
  revision,
  tx,
  tripSequence,
  uid,
  type Actor,
} from "./service-core";

export function snapshot(
  tripId: string,
  actor: Actor,
  section?: TripSection,
): VersionedSnapshot {
  return readTx(() => {
    const member = access(tripId, actor);
    const includes = (...sections: TripSection[]) =>
      !section || sections.includes(section);
    const splits = groupBy(
      includes("plan", "expenses")
        ? many<Split>(
            "SELECT s.* FROM expense_splits s JOIN expenses e ON e.id=s.expenseId WHERE e.tripId=?",
            tripId,
          )
        : [],
      (split) => split.expenseId,
    );
    const expenses = (
      includes("plan", "expenses")
        ? many<Expense>(
            "SELECT * FROM expenses WHERE tripId = ? ORDER BY incurredAt DESC, id",
            tripId,
          )
        : []
    ).map((e) => ({
      ...e,
      splits: splits.get(e.id) ?? [],
    }));
    return {
      sequence: tripSequence(tripId),
      trip: getTrip(tripId),
      currentUserId: actor.id,
      role: member.role,
      poolPlaces: includes("plan")
        ? many<PoolPlace>(
            "SELECT * FROM trip_places WHERE tripId=? ORDER BY position, createdAt, id",
            tripId,
          )
        : [],
      days: getDays(tripId, {
        items: includes("plan", "view", "expenses"),
        routes: !section
          ? "full"
          : includes("plan", "view")
            ? "summary"
            : "none",
      }),
      participants: includes("plan", "expenses", "members")
        ? many<Participant>(
            "SELECT * FROM trip_participants WHERE tripId = ? ORDER BY createdAt, id",
            tripId,
          )
        : [],
      members: many<Member>(
        "SELECT m.*, u.name, u.email FROM trip_members m JOIN users u ON u.id = m.userId WHERE m.tripId = ? ORDER BY m.joinedAt",
        tripId,
      ),
      expenses,
      settlements: includes("expenses")
        ? many<Settlement>(
            "SELECT * FROM settlements WHERE tripId = ? ORDER BY settledAt DESC",
            tripId,
          )
        : [],
      comments: includes("plan", "expenses", "activity")
        ? many<Comment>(
            "SELECT c.*, u.name authorName FROM comments c JOIN users u ON u.id = c.authorUserId WHERE c.tripId = ? ORDER BY c.createdAt",
            tripId,
          )
        : [],
      activity: includes("activity")
        ? many<Activity>(
            "SELECT a.*, u.name actorName FROM activity_logs a JOIN users u ON u.id = a.actorUserId WHERE a.tripId = ? ORDER BY a.sequence DESC LIMIT 200",
            tripId,
          )
        : [],
      invites:
        member.role === "owner" && includes("members")
          ? many<Invite>(
              "SELECT id, tripId, role, participantId, expiresAt, maxUses, usedCount, revokedAt, createdByUserId, createdAt, version FROM trip_invites WHERE tripId = ? ORDER BY createdAt DESC",
              tripId,
            )
          : [],
    };
  });
}
export function listTrips(actor: Actor) {
  return many<
    Trip & { role: Member["role"]; memberCount: number; dayCount: number }
  >(
    "SELECT t.*, m.role, (SELECT count(*) FROM trip_members x WHERE x.tripId=t.id AND x.status='active') memberCount, (SELECT count(*) FROM days d WHERE d.tripId=t.id) dayCount FROM trips t JOIN trip_members m ON m.tripId=t.id WHERE m.userId=? AND m.status='active' ORDER BY t.updatedAt DESC",
    actor.id,
  );
}
function validDates(data: {
  startDate?: string | null;
  endDate?: string | null;
}) {
  if (data.startDate && data.endDate && data.endDate < data.startDate)
    throw new AppError(400, "VALIDATION", "结束日期不能早于开始日期");
  if (!data.startDate || !data.endDate)
    throw new AppError(400, "VALIDATION", "请设置开始和结束日期");
  try {
    return tripDates(data.startDate, data.endDate);
  } catch (e) {
    throw new AppError(400, "VALIDATION", (e as Error).message);
  }
}
export function createTrip(actor: Actor, body: unknown) {
  const data = v.tripInput.parse(body);
  const startDate =
    data.startDate ??
    data.endDate ??
    DateTime.now().setZone(data.timezone).toISODate()!;
  const endDate = data.endDate ?? startDate;
  const dates = validDates({ startDate, endDate });
  return tx(() => {
    const id = uid();
    insert("trips", { id, ...data, startDate, endDate, ...revision(actor) });
    insert("trip_members", {
      tripId: id,
      userId: actor.id,
      role: "owner",
      joinedAt: Date.now(),
    });
    insert("trip_participants", {
      id: uid(),
      tripId: id,
      name: actor.name,
      userId: actor.id,
      ...revision(actor),
    });
    dates.forEach((date, position) =>
      insert("days", {
        id: uid(),
        tripId: id,
        title: dayTitle(position),
        date,
        position,
        ...revision(actor),
      }),
    );
    log(id, actor, "trip.created", "trip", id, `创建了行程「${data.title}」`);
    return { id };
  });
}
export function editTrip(tripId: string, actor: Actor, body: unknown) {
  const { expectedVersion, ...data } = v.tripInput
    .extend({
      timezone: v.tripInput.shape.timezone.removeDefault(),
      baseCurrency: v.tripInput.shape.baseCurrency.removeDefault(),
    })
    .partial()
    .extend({ expectedVersion: v.version })
    .parse(body);
  return tx(() => {
    access(tripId, actor, "owner");
    const trip = getTrip(tripId);
    checkVersion(trip, expectedVersion);
    const dates = validDates({ ...trip, ...data });
    const calendarChanged =
      (data.startDate !== undefined && data.startDate !== trip.startDate) ||
      (data.endDate !== undefined && data.endDate !== trip.endDate);
    if (calendarChanged) {
      const existing = many<Day>(
        "SELECT * FROM days WHERE tripId=? ORDER BY position, id",
        tripId,
      );
      for (const day of existing.slice(dates.length)) {
        const populated = one<{ n: number }>(
          "SELECT (SELECT count(*) FROM day_items WHERE dayId=?) + (SELECT count(*) FROM expenses WHERE dayId=?) n",
          day.id,
          day.id,
        )!.n;
        if (populated)
          throw new AppError(
            409,
            "DAY_HAS_CONTENT",
            `${day.title}仍有事项或费用，请整理后再缩短行程`,
          );
      }
      for (const day of existing.slice(dates.length))
        run("DELETE FROM days WHERE id=?", day.id);
      dates.forEach((date, position) => {
        const day = existing[position];
        if (!day)
          insert("days", {
            id: uid(),
            tripId,
            position,
            title: dayTitle(position),
            date,
            ...revision(actor),
          });
        else if (
          day.date !== date ||
          day.position !== position ||
          day.title !== dayTitle(position)
        )
          update("days", day.id, {
            date,
            position,
            title: dayTitle(position),
            version: day.version + 1,
            updatedAt: Date.now(),
            updatedByUserId: actor.id,
          });
      });
    }
    if (
      trip.baseCurrencyLockedAt &&
      data.baseCurrency &&
      data.baseCurrency !== trip.baseCurrency
    )
      throw new AppError(400, "CURRENCY_LOCKED", "已有账目，结算币种已锁定");
    update("trips", tripId, {
      ...data,
      version: trip.version + 1,
      updatedAt: Date.now(),
      updatedByUserId: actor.id,
    });
    if (data.timezone && data.timezone !== trip.timezone)
      run(
        "UPDATE days SET version=version+1, updatedAt=?, updatedByUserId=? WHERE tripId=?",
        Date.now(),
        actor.id,
        tripId,
      );
    log(tripId, actor, "trip.updated", "trip", tripId, "更新了行程信息");
    return { id: tripId };
  });
}
export function deleteTrip(tripId: string, actor: Actor, expected: number) {
  return tx(() => {
    access(tripId, actor, "owner");
    checkVersion(getTrip(tripId), expected);
    run("DELETE FROM trips WHERE id = ?", tripId);
    return { deleted: true };
  });
}
export function reorderDays(tripId: string, actor: Actor, body: unknown) {
  const data = z
    .strictObject({
      expectedVersion: v.version,
      dayIds: z.array(v.id).min(1).max(366),
    })
    .parse(body);
  return tx(() => {
    access(tripId, actor, "edit");
    const trip = getTrip(tripId);
    checkVersion(trip, data.expectedVersion);
    const days = many<Day>(
        "SELECT * FROM days WHERE tripId=? ORDER BY position, id",
        tripId,
      ),
      byId = new Map(days.map((d) => [d.id, d]));
    if (
      data.dayIds.length !== days.length ||
      new Set(data.dayIds).size !== days.length ||
      data.dayIds.some((id) => !byId.has(id))
    )
      throw new AppError(409, "CONFLICT", "行程日期已变化，请刷新后重试");
    const dates = tripDates(trip.startDate!, trip.endDate!);
    data.dayIds.forEach((id, position) => {
      const day = byId.get(id)!;
      if (day.position !== position || day.date !== dates[position])
        update("days", id, {
          position,
          date: dates[position],
          title: dayTitle(position),
          version: day.version + 1,
          updatedAt: Date.now(),
          updatedByUserId: actor.id,
        });
    });
    update("trips", tripId, {
      version: trip.version + 1,
      updatedAt: Date.now(),
      updatedByUserId: actor.id,
    });
    log(tripId, actor, "day.reordered", "trip", tripId, "调整了每日行程顺序");
    return { id: tripId };
  });
}
