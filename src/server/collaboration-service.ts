import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import type { Participant, Member, Invite } from "@/domain/types";
import { one, run, insert, update } from "./db";
import { AppError, requireValue } from "./errors";
import * as v from "./validation";
import {
  access,
  checkVersion,
  log,
  revision,
  tx,
  uid,
  type Actor,
} from "./service-core";

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
