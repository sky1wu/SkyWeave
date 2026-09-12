import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
const directory = dirname(
  process.env.DATABASE_PATH || "/app/data/trip-planner.sqlite",
);
mkdirSync(directory, { recursive: true });
if (
  !process.env.BETTER_AUTH_SECRET ||
  process.env.BETTER_AUTH_SECRET.startsWith("replace-with-")
) {
  const filename = join(directory, "auth-secret");
  try {
    process.env.BETTER_AUTH_SECRET = readFileSync(filename, "utf8").trim();
  } catch {
    process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
    writeFileSync(filename, process.env.BETTER_AUTH_SECRET, {
      mode: 0o600,
      flag: "wx",
    });
  }
}
await import("./server.js");
