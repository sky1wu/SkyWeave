import Database from "better-sqlite3";
import { hashPassword } from "@better-auth/utils/password";
import nextEnv from "@next/env";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const usage = `用法：
  npm run user:reset-password -- 用户邮箱
  docker compose exec app node scripts/reset-password.mjs 用户邮箱

按提示输入两次新密码（输入不显示），密码长度为 8–128 个字符。
自动化可加 --password-stdin，从标准输入读取两行相同的新密码。
只操作已有数据库；支持 DATABASE_PATH，默认读取项目 .env* 配置。`;

async function readPasswords(fromStdin) {
  if (fromStdin) {
    let input = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input, "utf8") > 4096)
        throw new Error("密码输入过长。");
    }
    const lines = input.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
    if (lines.length !== 2)
      throw new Error("标准输入需要两行：新密码和确认新密码。");
    return lines;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("请在交互式终端运行；自动化请使用 --password-stdin。");

  // Readline handles editing and raw mode; its output is discarded so that
  // typed passwords never reach the terminal or a captured command log.
  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const terminal = createInterface({
    input: process.stdin,
    output: mutedOutput,
    terminal: true,
  });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  terminal.on("SIGINT", cancel);
  terminal.on("close", cancel);
  process.once("SIGTERM", cancel);
  try {
    const passwords = [];
    for (const prompt of ["新密码：", "再次输入新密码："]) {
      process.stdout.write(prompt);
      passwords.push(await terminal.question("", { signal: abort.signal }));
      process.stdout.write("\n");
    }
    return passwords;
  } catch (error) {
    if (abort.signal.aborted) throw new Error("已取消，未修改密码。");
    throw error;
  } finally {
    terminal.close();
    mutedOutput.end();
    process.removeListener("SIGTERM", cancel);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(usage);
    return;
  }
  const fromStdin = args.includes("--password-stdin");
  const positional = args.filter((arg) => arg !== "--password-stdin");
  if (
    positional.length !== 1 ||
    positional[0].startsWith("-") ||
    args.length !== (fromStdin ? 2 : 1)
  )
    throw new Error(usage);
  const email = positional[0].trim().toLowerCase();
  if (!email || /[\s\x00-\x1f\x7f]/.test(email) || !email.includes("@"))
    throw new Error("请输入有效的用户邮箱。");

  nextEnv.loadEnvConfig(process.cwd());
  const filename = resolve(
    process.env.DATABASE_PATH || "./data/trip-planner.sqlite",
  );
  const sqlite = new Database(filename, { fileMustExist: true });
  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    const user = sqlite
      .prepare("SELECT id, email FROM users WHERE email = ?")
      .get(email);
    if (!user) throw new Error("未找到该邮箱的用户，未修改任何账号。");
    const accounts = sqlite
      .prepare(
        "SELECT id FROM accounts WHERE userId = ? AND providerId = 'credential'",
      )
      .all(user.id);
    if (accounts.length !== 1)
      throw new Error("该用户没有唯一的密码登录账号，未修改任何账号。");

    console.log(`数据库：${filename}\n重置账号：${user.email}`);
    const [password, confirmation] = await readPasswords(fromStdin);
    if (password !== confirmation) throw new Error("两次输入的新密码不一致。");
    // Keep these limits in sync with src/server/auth.ts.
    if (password.length < 8 || password.length > 128)
      throw new Error("新密码需要 8–128 个字符。");
    const hash = await hashPassword(password);
    const revokedSessions = sqlite
      .transaction(() => {
        const result = sqlite
          .prepare(
            "UPDATE accounts SET password = ?, updatedAt = ? WHERE id = ? AND userId = ? AND providerId = 'credential'",
          )
          .run(hash, Date.now(), accounts[0].id, user.id);
        if (result.changes !== 1)
          throw new Error("账号已发生变化，请重新运行。");
        const sessions = sqlite
          .prepare("DELETE FROM sessions WHERE userId = ?")
          .run(user.id);
        sqlite
          .prepare(
            "DELETE FROM verifications WHERE value = ? AND identifier LIKE 'reset-password:%'",
          )
          .run(user.id);
        return sessions.changes;
      })
      .immediate();
    console.log(
      `密码已重置，已注销 ${revokedSessions} 个登录会话。用户可立即使用新密码登录。`,
    );
  } finally {
    sqlite.close();
  }
}

main().catch((error) => {
  console.error(`重置失败：${error.message}`);
  process.exitCode = 1;
});
