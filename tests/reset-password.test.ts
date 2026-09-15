import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const directory = mkdtempSync(`${tmpdir()}/reset-password-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
process.env.BETTER_AUTH_SECRET = "reset-password-test-only-secret-0123456789";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
const { auth } = await import("@/server/auth");
const { sqlite, insert } = await import("@/server/db");
const service = await import("@/server/service");
const { createMcpToken } = await import("@/server/mcp-tokens");
const script = resolve("scripts/reset-password.mjs");
const oldPassword = "Old-test-password-123";
const newPassword = " 新密码-test-456 ";
let userNumber = 0;

afterAll(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

async function fixture() {
  const email = `reset-${++userNumber}@example.test`;
  const response = await auth.api.signUpEmail({
    body: { email, password: oldPassword, name: "Reset test" },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  const { user } = (await response.json()) as {
    user: { id: string; name: string; email: string };
  };
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  return { user, cookie };
}

function reset(
  email: string,
  input = `${newPassword}\n${newPassword}\n`,
  database = process.env.DATABASE_PATH,
  options = ["--password-stdin"],
) {
  const result = spawnSync(process.execPath, [script, email, ...options], {
    input,
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, DATABASE_PATH: database },
  });
  if (result.error) throw result.error;
  expect(result.stdout + result.stderr).not.toContain(newPassword);
  expect(result.stdout + result.stderr).not.toContain(oldPassword);
  return result;
}

function authRows() {
  return ["users", "accounts", "sessions", "verifications"].map((table) =>
    sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
  );
}

async function session(cookie: string) {
  return auth.api.getSession({ headers: new Headers({ cookie }) });
}

describe("administrator password reset CLI", () => {
  it("accepts the new password, rejects the old one, revokes sessions, and preserves other accounts and trip data", async () => {
    const { user, cookie } = await fixture();
    const other = await fixture();
    const secondLogin = await auth.api.signInEmail({
      body: { email: user.email, password: oldPassword },
      asResponse: true,
    });
    expect(secondLogin.status).toBe(200);
    const secondCookie = secondLogin.headers.get("set-cookie")!.split(";")[0];
    expect((await session(cookie))?.user.id).toBe(user.id);
    expect((await session(secondCookie))?.user.id).toBe(user.id);
    const trip = service.createTrip(user, { title: "重置后保留的行程" });
    const participant = service.snapshot(trip.id, user).participants[0];
    service.saveExpense(trip.id, user, {
      title: "晚餐",
      category: "food",
      amountMinor: 1000,
      currency: "CNY",
      exchangeRateToBase: "1",
      payerParticipantId: participant.id,
      splitMethod: "equal",
      splitMeta: [{ participantId: participant.id, value: "1" }],
      incurredAt: Date.now(),
    });
    createMcpToken(user, { name: "保留的 Agent", permission: "read" });
    const snapshot = service.snapshot(trip.id, user);
    const tokens = sqlite.prepare("SELECT * FROM mcp_tokens").all();
    const otherAccount = sqlite
      .prepare("SELECT * FROM accounts WHERE userId = ?")
      .get(other.user.id);
    for (const [id, identifier, value] of [
      ["reset-target", "reset-password:target-token", user.id],
      ["reset-other", "reset-password:other-token", other.user.id],
      ["unrelated", "unrelated-verification", user.id],
    ])
      insert("verifications", {
        id,
        identifier,
        value,
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

    const result = reset(` ${user.email.toUpperCase()} `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("密码已重置");
    expect(result.stdout).toContain("已注销 2 个登录会话");
    expect(await session(cookie)).toBeNull();
    expect(await session(secondCookie)).toBeNull();
    expect((await session(other.cookie))?.user.id).toBe(other.user.id);
    const oldLogin = await auth.api.signInEmail({
      body: { email: user.email, password: oldPassword },
      asResponse: true,
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await auth.api.signInEmail({
      body: { email: user.email, password: newPassword },
      asResponse: true,
    });
    expect(newLogin.status).toBe(200);
    expect(service.snapshot(trip.id, user)).toEqual(snapshot);
    expect(sqlite.prepare("SELECT * FROM mcp_tokens").all()).toEqual(tokens);
    expect(
      sqlite
        .prepare("SELECT * FROM accounts WHERE userId = ?")
        .get(other.user.id),
    ).toEqual(otherAccount);
    expect(
      sqlite.prepare("SELECT id FROM verifications ORDER BY id").all(),
    ).toEqual([{ id: "reset-other" }, { id: "unrelated" }]);
  });

  it.each([
    ["short\nshort\n", "8–128"],
    [`${"x".repeat(129)}\n${"x".repeat(129)}\n`, "8–128"],
    ["new-password-123\ndifferent-password\n", "不一致"],
    ["only-one-line\n", "两行"],
    ["first\nsecond\nthird\n", "两行"],
    ["x".repeat(4097), "过长"],
  ])(
    "rejects invalid input without changing accounts or sessions (%#)",
    async (input, message) => {
      const { user } = await fixture();
      const before = authRows();
      const result = reset(user.email, input);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
      expect(authRows()).toEqual(before);
    },
  );

  it("rejects unknown users, missing credential accounts, and missing databases", async () => {
    const { user } = await fixture();
    const before = authRows();
    expect(reset("missing@example.test").stderr).toContain("未找到");
    expect(authRows()).toEqual(before);
    sqlite.prepare("DELETE FROM accounts WHERE userId = ?").run(user.id);
    const withoutAccount = authRows();
    expect(reset(user.email).stderr).toContain("没有唯一的密码登录账号");
    expect(authRows()).toEqual(withoutAccount);
    const missing = `${directory}/missing.sqlite`;
    expect(reset(user.email, "", missing).status).toBe(1);
    expect(existsSync(missing)).toBe(false);
  });

  it("rolls back the password change when revoking sessions fails", async () => {
    const { user } = await fixture();
    const before = authRows();
    sqlite.exec(`CREATE TRIGGER reject_session_delete BEFORE DELETE ON sessions
      BEGIN SELECT RAISE(ABORT, 'test session deletion failure'); END`);
    try {
      const result = reset(user.email);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("test session deletion failure");
      expect(authRows()).toEqual(before);
    } finally {
      sqlite.exec("DROP TRIGGER reject_session_delete");
    }
  });

  it("requires an explicit stdin option outside a terminal and never accepts password arguments", async () => {
    const { user } = await fixture();
    const before = authRows();
    expect(reset(user.email, "", undefined, []).stderr).toContain("交互式终端");
    const result = reset(user.email, "", undefined, [newPassword]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("用法");
    expect(authRows()).toEqual(before);
  });
});
