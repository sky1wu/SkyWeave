import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { DateTime } from "luxon";
import { nextDayDate } from "@/domain/planning";
import { sqlite, one, many, run, insert, update } from "./db";
import { AppError, conflict, requireValue } from "./errors";
import * as v from "./validation";
import { routePairs } from "@/domain/timeline";
import { convertMoney, splitExpense, calculateBalances } from "@/domain/money";
import type {
  Trip,
  PoolPlace,
  Day,
  Item,
  Leg,
  Alternative,
  Participant,
  Member,
  TripSnapshot,
  DayPlan,
  Expense,
  Split,
  Settlement,
  Comment,
  Activity,
  Invite,
} from "@/domain/types";

export interface Actor {
  id: string;
  name: string;
  email: string;
  sessionId?: string;
}
export const uid = randomUUID;
export const tx = <T>(fn: () => T): T => sqlite.transaction(fn).immediate();
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
  return {
    ...day,
    items: many<Item>(
      "SELECT * FROM day_items WHERE dayId = ? ORDER BY position",
      id,
    ),
    legs: many<Leg>("SELECT * FROM travel_legs WHERE dayId = ?", id).map(
      (l) => ({
        ...l,
        alternatives: many<Alternative>(
          "SELECT * FROM route_alternatives WHERE travelLegId = ? ORDER BY position",
          l.id,
        ),
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
        ...(a.lat === b.lat && a.lng === b.lng
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
export function snapshot(tripId: string, actor: Actor): TripSnapshot {
  return tx(() => {
    const member = access(tripId, actor);
    const expenses = many<Expense>(
      "SELECT * FROM expenses WHERE tripId = ? ORDER BY incurredAt DESC, id",
      tripId,
    ).map((e) => ({
      ...e,
      splits: many<Split>(
        "SELECT * FROM expense_splits WHERE expenseId = ?",
        e.id,
      ),
    }));
    return {
      trip: getTrip(tripId),
      currentUserId: actor.id,
      role: member.role,
      poolPlaces: many<PoolPlace>(
        "SELECT * FROM trip_places WHERE tripId=? ORDER BY createdAt, id",
        tripId,
      ),
      days: many<Day>(
        "SELECT * FROM days WHERE tripId = ? ORDER BY position",
        tripId,
      ).map((d) => getDay(d.id)),
      participants: many<Participant>(
        "SELECT * FROM trip_participants WHERE tripId = ? ORDER BY createdAt, id",
        tripId,
      ),
      members: many<Member>(
        "SELECT m.*, u.name, u.email FROM trip_members m JOIN users u ON u.id = m.userId WHERE m.tripId = ? ORDER BY m.joinedAt",
        tripId,
      ),
      expenses,
      settlements: many<Settlement>(
        "SELECT * FROM settlements WHERE tripId = ? ORDER BY settledAt DESC",
        tripId,
      ),
      comments: many<Comment>(
        "SELECT c.*, u.name authorName FROM comments c JOIN users u ON u.id = c.authorUserId WHERE c.tripId = ? ORDER BY c.createdAt",
        tripId,
      ),
      activity: many<Activity>(
        "SELECT a.*, u.name actorName FROM activity_logs a JOIN users u ON u.id = a.actorUserId WHERE a.tripId = ? ORDER BY a.sequence DESC LIMIT 200",
        tripId,
      ),
      invites:
        member.role === "owner"
          ? many<Invite>(
              "SELECT id, tripId, role, participantId, expiresAt, maxUses, usedCount, revokedAt, createdByUserId, createdAt, version FROM trip_invites WHERE tripId = ? ORDER BY createdAt DESC",
              tripId,
            )
          : [],
    };
  });
}
export function balances(tripId: string, actor: Actor) {
  const data = snapshot(tripId, actor);
  return calculateBalances(
    data.participants.map((p) => p.id),
    data.expenses,
    data.settlements,
  );
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
}
export function createTrip(actor: Actor, body: unknown) {
  const data = v.tripInput.parse(body);
  validDates(data);
  return tx(() => {
    const id = uid();
    insert("trips", { id, ...data, ...revision(actor) });
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
    insert("days", {
      id: uid(),
      tripId: id,
      title: "第 1 天",
      date: data.startDate ?? null,
      position: 0,
      ...revision(actor),
    });
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
    validDates({ ...trip, ...data });
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
export function createDay(tripId: string, actor: Actor, body: unknown) {
  const data = v.dayInput
    .extend({ title: v.dayInput.shape.title.optional() })
    .parse(body);
  return tx(() => {
    access(tripId, actor, "edit");
    const id = uid();
    const pos = one<{ p: number }>(
      "SELECT coalesce(max(position),-1)+1 p FROM days WHERE tripId=?",
      tripId,
    )!.p;
    const trip = getTrip(tripId);
    const existing = many<Day>(
      "SELECT * FROM days WHERE tripId=? ORDER BY position",
      tripId,
    );
    const title = data.title ?? `第 ${pos + 1} 天`;
    const date =
      data.date === undefined
        ? nextDayDate(
            trip.startDate,
            existing,
            DateTime.now().setZone(trip.timezone).toISODate()!,
          )
        : data.date;
    insert("days", {
      id,
      tripId,
      position: pos,
      ...data,
      title,
      date,
      ...revision(actor),
    });
    log(tripId, actor, "day.updated", "day", id, `添加了「${title}」`);
    return { id };
  });
}
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
export function deleteDay(dayId: string, actor: Actor, expected: number) {
  return tx(() => {
    const day = getDay(dayId);
    access(day.tripId, actor, "edit");
    checkVersion(day, expected);
    run(
      "DELETE FROM comments WHERE targetType='day_item' AND targetId IN (SELECT id FROM day_items WHERE dayId=?)",
      dayId,
    );
    run("DELETE FROM days WHERE id=?", dayId);
    log(
      day.tripId,
      actor,
      "day.updated",
      "day",
      dayId,
      `删除了「${day.title}」`,
    );
    return { deleted: true };
  });
}
function validItem(
  data: Pick<Item, "lat" | "lng" | "fixedTime" | "startMinutes" | "endMinutes">,
) {
  if ((data.lat == null) !== (data.lng == null))
    throw new AppError(400, "VALIDATION", "经纬度必须成对填写");
  if (data.fixedTime && data.startMinutes == null)
    throw new AppError(400, "VALIDATION", "固定活动必须设置开始时间");
  if (
    data.endMinutes != null &&
    (data.startMinutes == null || data.endMinutes < data.startMinutes)
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
    if (data.sourcePlaceId)
      requireValue(
        one(
          "SELECT id FROM trip_places WHERE id=? AND tripId=?",
          data.sourcePlaceId,
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
    if (data.sourcePlaceId)
      requireValue(
        one(
          "SELECT id FROM trip_places WHERE id=? AND tripId=?",
          data.sourcePlaceId,
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
    if (
      (data.lat !== undefined && data.lat !== item.lat) ||
      (data.lng !== undefined && data.lng !== item.lng) ||
      (data.amapPoiId !== undefined && data.amapPoiId !== item.amapPoiId)
    ) {
      for (const leg of day.legs.filter(
        (l) => l.fromItemId === itemId || l.toItemId === itemId,
      )) {
        run("DELETE FROM route_alternatives WHERE travelLegId=?", leg.id);
        update("travel_legs", leg.id, {
          selectedAlternativeId: null,
          requestKey: null,
          status: "pending",
          version: leg.version + 1,
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

export function createParticipant(tripId: string, actor: Actor, body: unknown) {
  const data = z
    .strictObject({ name: z.string().trim().min(1).max(100) })
    .parse(body);
  return tx(() => {
    access(tripId, actor, "edit");
    const id = uid();
    insert("trip_participants", { id, tripId, ...data, ...revision(actor) });
    log(
      tripId,
      actor,
      "member.updated",
      "participant",
      id,
      `添加了同行者「${data.name}」`,
    );
    return { id };
  });
}
export function editParticipant(
  tripId: string,
  participantId: string,
  actor: Actor,
  body: unknown,
) {
  const { expectedVersion, ...data } = z
    .strictObject({
      expectedVersion: v.version,
      name: z.string().trim().min(1).max(100).optional(),
      status: z.enum(["active", "inactive"]).optional(),
    })
    .parse(body);
  return tx(() => {
    access(tripId, actor, "owner");
    const p = requireValue(
      one<Participant>(
        "SELECT * FROM trip_participants WHERE id=? AND tripId=?",
        participantId,
        tripId,
      ),
    );
    checkVersion(p, expectedVersion);
    if (p.userId && data.status)
      throw new AppError(
        400,
        "VALIDATION",
        "已注册同行者请通过成员管理停用或恢复",
      );
    update("trip_participants", participantId, {
      ...data,
      version: p.version + 1,
      updatedAt: Date.now(),
      updatedByUserId: actor.id,
    });
    log(
      tripId,
      actor,
      "member.updated",
      "participant",
      participantId,
      "更新了同行者信息",
    );
    return { id: participantId };
  });
}
export function editMember(
  tripId: string,
  userId: string,
  actor: Actor,
  body: unknown,
) {
  const data = z
    .strictObject({
      expectedVersion: v.version,
      role: z.enum(["editor", "viewer"]).optional(),
      status: z.enum(["active", "inactive"]).optional(),
    })
    .parse(body);
  return tx(() => {
    access(tripId, actor, "owner");
    const member = requireValue(
      one<Member>(
        "SELECT * FROM trip_members WHERE tripId=? AND userId=?",
        tripId,
        userId,
      ),
    );
    checkVersion(member, data.expectedVersion);
    if (member.role === "owner")
      throw new AppError(400, "VALIDATION", "不能移除或降级行程所有者");
    run(
      "UPDATE trip_members SET role=?, status=?, version=version+1 WHERE tripId=? AND userId=?",
      data.role ?? member.role,
      data.status ?? member.status,
      tripId,
      userId,
    );
    if (data.status)
      run(
        "UPDATE trip_participants SET status=?, version=version+1, updatedAt=?, updatedByUserId=? WHERE tripId=? AND userId=?",
        data.status,
        Date.now(),
        actor.id,
        tripId,
        userId,
      );
    log(
      tripId,
      actor,
      "member.updated",
      "member",
      userId,
      "更新了成员权限或状态",
    );
    return { userId };
  });
}
type StoredInvite = Invite & { tokenHash: string };
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function createInvite(tripId: string, actor: Actor, body: unknown) {
  const data = z
    .strictObject({
      role: z.enum(["editor", "viewer"]).default("editor"),
      participantId: v.id.nullable().optional(),
      expiresAt: z.number().int().optional(),
      maxUses: z.number().int().min(1).max(1000).default(10),
    })
    .parse(body);
  return tx(() => {
    access(tripId, actor, "owner");
    if (data.participantId) {
      const p = requireValue(
        one<Participant>(
          "SELECT * FROM trip_participants WHERE id=? AND tripId=? AND status='active'",
          data.participantId,
          tripId,
        ),
      );
      if (p.userId)
        throw new AppError(400, "VALIDATION", "此同行者已经绑定账号");
    }
    const expiresAt = data.expiresAt ?? Date.now() + 7 * 86400000;
    if (expiresAt <= Date.now() || expiresAt > Date.now() + 366 * 86400000)
      throw new AppError(400, "VALIDATION", "邀请有效期须在未来一年内");
    const token = randomBytes(32).toString("base64url"),
      id = uid();
    insert("trip_invites", {
      id,
      tripId,
      role: data.role,
      participantId: data.participantId ?? null,
      maxUses: data.participantId ? 1 : data.maxUses,
      expiresAt,
      tokenHash: tokenHash(token),
      createdByUserId: actor.id,
      createdAt: Date.now(),
    });
    log(tripId, actor, "member.updated", "invite", id, "创建了邀请链接");
    return { id, token, path: `/invite/${token}` };
  });
}
export function revokeInvite(
  tripId: string,
  id: string,
  actor: Actor,
  expected: number,
) {
  return tx(() => {
    access(tripId, actor, "owner");
    const invite = requireValue(
      one<StoredInvite>(
        "SELECT * FROM trip_invites WHERE id=? AND tripId=?",
        id,
        tripId,
      ),
    );
    checkVersion(invite, expected);
    update("trip_invites", id, {
      revokedAt: Date.now(),
      version: invite.version + 1,
    });
    log(tripId, actor, "member.updated", "invite", id, "撤销了邀请");
    return { revoked: true };
  });
}
export function joinInvite(token: string, actor: Actor) {
  return tx(() => {
    if (!/^[\w-]{43}$/.test(token))
      throw new AppError(404, "INVALID_INVITE", "邀请无效");
    const invite = requireValue(
      one<StoredInvite>(
        "SELECT * FROM trip_invites WHERE tokenHash=?",
        tokenHash(token),
      ),
      "邀请无效",
    );
    if (invite.revokedAt || invite.expiresAt <= Date.now())
      throw new AppError(410, "INVITE_EXPIRED", "邀请已过期或撤销");
    const member = one<Member>(
      "SELECT * FROM trip_members WHERE tripId=? AND userId=?",
      invite.tripId,
      actor.id,
    );
    const current = one<Participant>(
      "SELECT * FROM trip_participants WHERE tripId=? AND userId=?",
      invite.tripId,
      actor.id,
    );
    if (
      member?.status === "active" &&
      (!invite.participantId || current?.id === invite.participantId)
    )
      return { id: invite.tripId };
    if (invite.usedCount >= invite.maxUses)
      throw new AppError(410, "INVITE_EXHAUSTED", "邀请使用次数已耗尽");
    if (invite.participantId) {
      const p = requireValue(
        one<Participant>(
          "SELECT * FROM trip_participants WHERE id=? AND tripId=? AND status='active'",
          invite.participantId,
          invite.tripId,
        ),
      );
      if (p.userId || (current && current.id !== p.id))
        throw new AppError(
          409,
          "IDENTITY_CONFLICT",
          "此账号或同行者已经绑定其他身份，不能自动合并账目",
        );
      update("trip_participants", p.id, {
        userId: actor.id,
        version: p.version + 1,
        updatedAt: Date.now(),
        updatedByUserId: actor.id,
      });
    } else if (current)
      update("trip_participants", current.id, {
        status: "active",
        version: current.version + 1,
        updatedAt: Date.now(),
        updatedByUserId: actor.id,
      });
    else
      insert("trip_participants", {
        id: uid(),
        tripId: invite.tripId,
        userId: actor.id,
        name: actor.name,
        ...revision(actor),
      });
    if (member)
      run(
        "UPDATE trip_members SET status='active', role=?, version=version+1 WHERE tripId=? AND userId=?",
        invite.role,
        invite.tripId,
        actor.id,
      );
    else
      insert("trip_members", {
        tripId: invite.tripId,
        userId: actor.id,
        role: invite.role,
        joinedAt: Date.now(),
      });
    run(
      "UPDATE trip_invites SET usedCount=usedCount+1, version=version+1 WHERE id=?",
      invite.id,
    );
    log(
      invite.tripId,
      actor,
      "member.updated",
      "member",
      actor.id,
      "加入了行程",
    );
    return { id: invite.tripId };
  });
}

function person(tripId: string, id: string, allowInactive = false) {
  const p = requireValue(
    one<Participant>(
      "SELECT * FROM trip_participants WHERE id=? AND tripId=?",
      id,
      tripId,
    ),
    "同行者不属于此行程",
  );
  if (!allowInactive && p.status !== "active")
    throw new AppError(
      400,
      "INACTIVE_PARTICIPANT",
      "已停用同行者不能参与新费用",
    );
  return p;
}
export function saveExpense(
  tripId: string,
  actor: Actor,
  body: unknown,
  expenseId?: string,
) {
  const parsed = expenseId
    ? v.expenseInput.extend({ expectedVersion: v.version }).parse(body)
    : v.expenseInput.parse(body);
  return tx(() => {
    access(tripId, actor, "edit");
    const original = expenseId
      ? requireValue(
          one<Expense>(
            "SELECT * FROM expenses WHERE id=? AND tripId=?",
            expenseId,
            tripId,
          ),
        )
      : null;
    if (original && "expectedVersion" in parsed)
      checkVersion(original, parsed.expectedVersion as number);
    const data = v.expenseInput.parse(
      Object.fromEntries(
        Object.entries(parsed).filter(([k]) => k !== "expectedVersion"),
      ),
    );
    const oldPeople = original
      ? many<Split>(
          "SELECT * FROM expense_splits WHERE expenseId=?",
          original.id,
        )
          .map((s) => s.participantId)
          .concat(original.payerParticipantId)
      : [];
    person(
      tripId,
      data.payerParticipantId,
      oldPeople.includes(data.payerParticipantId),
    );
    for (const s of data.splitMeta)
      person(tripId, s.participantId, oldPeople.includes(s.participantId));
    if (data.dayId)
      requireValue(
        one("SELECT id FROM days WHERE id=? AND tripId=?", data.dayId, tripId),
        "日期不属于此行程",
      );
    if (data.dayItemId) {
      const item = requireValue(
        one<Item>(
          "SELECT i.* FROM day_items i JOIN days d ON d.id=i.dayId WHERE i.id=? AND d.tripId=?",
          data.dayItemId,
          tripId,
        ),
        "事项不属于此行程",
      );
      if (data.dayId && data.dayId !== item.dayId)
        throw new AppError(400, "VALIDATION", "事项与日期不一致");
      data.dayId = item.dayId;
    }
    const trip = getTrip(tripId);
    let baseAmountMinor: number, normalized: ReturnType<typeof splitExpense>;
    try {
      baseAmountMinor = convertMoney(
        data.amountMinor,
        data.currency,
        trip.baseCurrency,
        data.exchangeRateToBase,
      );
      normalized = splitExpense(
        data.amountMinor,
        baseAmountMinor,
        data.currency,
        data.splitMethod,
        data.splitMeta,
      );
    } catch (e) {
      throw new AppError(400, "INVALID_MONEY", (e as Error).message);
    }
    const id = expenseId ?? uid();
    if (original) {
      update("expenses", id, {
        ...data,
        baseAmountMinor,
        version: original.version + 1,
        updatedAt: Date.now(),
        updatedByUserId: actor.id,
      });
      run("DELETE FROM expense_splits WHERE expenseId=?", id);
    } else
      insert("expenses", {
        id,
        tripId,
        ...data,
        baseAmountMinor,
        createdByUserId: actor.id,
        ...revision(actor),
      });
    for (const s of normalized)
      insert("expense_splits", {
        id: uid(),
        expenseId: id,
        ...s,
        createdAt: Date.now(),
      });
    run(
      "UPDATE trips SET baseCurrencyLockedAt=coalesce(baseCurrencyLockedAt,?), updatedAt=? WHERE id=?",
      Date.now(),
      Date.now(),
      tripId,
    );
    // Check aggregate overflow inside the transaction, so invalid ledgers roll back.
    for (const total of many<{ amount: number }>(
      "SELECT sum(amountMinor) amount FROM expenses WHERE tripId=? GROUP BY currency",
      tripId,
    ))
      if (!Number.isSafeInteger(total.amount))
        throw new AppError(
          400,
          "INVALID_MONEY",
          "此币种累计金额超出可安全计算范围",
        );
    balances(tripId, actor);
    log(
      tripId,
      actor,
      original ? "expense.updated" : "expense.created",
      "expense",
      id,
      `${original ? "修改" : "添加"}了费用「${data.title}」`,
    );
    return { id };
  });
}
export function deleteExpense(id: string, actor: Actor, expected: number) {
  return tx(() => {
    const e = requireValue(
      one<Expense>("SELECT * FROM expenses WHERE id=?", id),
    );
    access(e.tripId, actor, "edit");
    checkVersion(e, expected);
    run("DELETE FROM comments WHERE targetType='expense' AND targetId=?", id);
    run("DELETE FROM expenses WHERE id=?", id);
    log(
      e.tripId,
      actor,
      "expense.deleted",
      "expense",
      id,
      `删除了费用「${e.title}」`,
    );
    return { deleted: true };
  });
}
export function createSettlement(tripId: string, actor: Actor, body: unknown) {
  const data = v.settlementInput.parse(body);
  return tx(() => {
    access(tripId, actor, "edit");
    person(tripId, data.fromParticipantId, true);
    person(tripId, data.toParticipantId, true);
    if (data.fromParticipantId === data.toParticipantId)
      throw new AppError(400, "VALIDATION", "转出人与收款人不能相同");
    let baseAmountMinor: number;
    try {
      baseAmountMinor = convertMoney(
        data.amountMinor,
        data.currency,
        getTrip(tripId).baseCurrency,
        data.exchangeRateToBase,
      );
    } catch (e) {
      throw new AppError(400, "INVALID_MONEY", (e as Error).message);
    }
    const id = uid();
    insert("settlements", {
      id,
      tripId,
      ...data,
      baseAmountMinor,
      createdByUserId: actor.id,
      ...revision(actor),
    });
    run(
      "UPDATE trips SET baseCurrencyLockedAt=coalesce(baseCurrencyLockedAt,?) WHERE id=?",
      Date.now(),
      tripId,
    );
    balances(tripId, actor);
    log(
      tripId,
      actor,
      "settlement.created",
      "settlement",
      id,
      "登记了一笔实际转账",
    );
    return { id };
  });
}
export function deleteSettlement(id: string, actor: Actor, expected: number) {
  return tx(() => {
    const s = requireValue(
      one<Settlement>("SELECT * FROM settlements WHERE id=?", id),
    );
    access(s.tripId, actor, "edit");
    checkVersion(s, expected);
    run("DELETE FROM settlements WHERE id=?", id);
    log(
      s.tripId,
      actor,
      "settlement.deleted",
      "settlement",
      id,
      "删除了一笔转账记录",
    );
    return { deleted: true };
  });
}
export function addComment(tripId: string, actor: Actor, body: unknown) {
  const data = z
    .strictObject({
      targetType: z.enum(["trip", "day_item", "expense"]),
      targetId: v.id,
      content: z.string().trim().min(1).max(4000),
    })
    .parse(body);
  return tx(() => {
    access(tripId, actor);
    if (data.targetType === "trip" && data.targetId !== tripId)
      throw new AppError(400, "VALIDATION", "评论目标不属于行程");
    if (data.targetType === "day_item")
      requireValue(
        one(
          "SELECT i.id FROM day_items i JOIN days d ON d.id=i.dayId WHERE i.id=? AND d.tripId=?",
          data.targetId,
          tripId,
        ),
      );
    if (data.targetType === "expense")
      requireValue(
        one(
          "SELECT id FROM expenses WHERE id=? AND tripId=?",
          data.targetId,
          tripId,
        ),
      );
    const id = uid();
    insert("comments", {
      id,
      tripId,
      ...data,
      authorUserId: actor.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    log(tripId, actor, "comment.created", "comment", id, "发表了评论");
    return { id };
  });
}
