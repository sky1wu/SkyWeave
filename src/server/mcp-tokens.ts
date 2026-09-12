import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpToken } from "@/domain/mcp";
import { insert, many, one, run } from "./db";
import { AppError } from "./errors";
import { access, tx, type Actor } from "./service";
import { id } from "./validation";

const tokenInput = z.strictObject({
  name: z.string().trim().min(1).max(100),
  permission: z.enum(["read", "edit"]).default("read"),
  tripId: id.nullable().default(null),
  expiresInDays: z.number().int().min(1).max(365).default(30),
});
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export function listMcpTokens(actor: Actor): McpToken[] {
  return many<McpToken>(
    `SELECT k.id, k.name, k.tokenPrefix, k.permission, k.tripId,
      t.title tripTitle, k.createdAt, k.expiresAt, k.lastUsedAt
     FROM mcp_tokens k LEFT JOIN trips t ON t.id=k.tripId
     WHERE k.userId=? ORDER BY k.createdAt DESC, k.id`,
    actor.id,
  );
}

export function createMcpToken(actor: Actor, body: unknown) {
  const data = tokenInput.parse(body);
  return tx(() => {
    if (data.tripId) access(data.tripId, actor, data.permission);
    const count = one<{ n: number }>(
      "SELECT count(*) n FROM mcp_tokens WHERE userId=? AND expiresAt>?",
      actor.id,
      Date.now(),
    )!.n;
    if (count >= 20)
      throw new AppError(
        400,
        "TOKEN_LIMIT",
        "最多保留 20 个有效令牌，请先撤销旧令牌",
      );
    const token = `sw_mcp_${randomBytes(32).toString("base64url")}`;
    const tokenId = randomUUID();
    insert("mcp_tokens", {
      id: tokenId,
      userId: actor.id,
      name: data.name,
      tokenHash: hash(token),
      tokenPrefix: token.slice(0, 15),
      permission: data.permission,
      tripId: data.tripId,
      createdAt: Date.now(),
      expiresAt: Date.now() + data.expiresInDays * 86400000,
    });
    return {
      ...listMcpTokens(actor).find((entry) => entry.id === tokenId)!,
      token,
    };
  });
}

export function revokeMcpToken(actor: Actor, tokenId: string) {
  const result = run(
    "DELETE FROM mcp_tokens WHERE id=? AND userId=?",
    id.parse(tokenId),
    actor.id,
  );
  if (!result.changes) throw new AppError(404, "NOT_FOUND", "令牌不存在");
  return { deleted: true };
}

export interface McpPrincipal {
  actor: Actor;
  permission: "read" | "edit";
  tripId: string | null;
}

export function authenticateMcp(request: Request): McpPrincipal {
  const match = /^Bearer (sw_mcp_[A-Za-z0-9_-]{43})$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  const entry = match
    ? one<{
        id: string;
        userId: string;
        name: string;
        email: string;
        permission: "read" | "edit";
        tripId: string | null;
      }>(
        `SELECT k.id, k.userId, u.name, u.email, k.permission, k.tripId
     FROM mcp_tokens k JOIN users u ON u.id=k.userId
     WHERE k.tokenHash=? AND k.expiresAt>?`,
        hash(match[1]),
        Date.now(),
      )
    : undefined;
  if (!entry)
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "MCP 令牌无效或已过期，请在用户设置中创建令牌",
    );
  run("UPDATE mcp_tokens SET lastUsedAt=? WHERE id=?", Date.now(), entry.id);
  return {
    actor: { id: entry.userId, name: entry.name, email: entry.email },
    permission: entry.permission,
    tripId: entry.tripId,
  };
}

export function mcpAccess(
  principal: McpPrincipal,
  tripId: string,
  write = false,
) {
  if (principal.tripId && principal.tripId !== tripId)
    throw new AppError(403, "TOKEN_SCOPE", "此令牌不能访问该行程");
  if (write && principal.permission !== "edit")
    throw new AppError(403, "TOKEN_READ_ONLY", "此令牌仅可读取日程与费用");
  return access(tripId, principal.actor, write ? "edit" : "read");
}
