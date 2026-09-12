import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
const directory = mkdtempSync(`${tmpdir()}/trip-e2e-`);
const child = spawn(process.execPath, ["scripts/start.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_PATH: `${directory}/test.sqlite`,
    PORT: "3100",
    APP_HOST: "127.0.0.1",
    BETTER_AUTH_URL: "http://127.0.0.1:3100",
    BETTER_AUTH_SECRET: "isolated-e2e-secret-not-for-deployment-0123456789",
    AMAP_TEST_MODE: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("exit", (code) => {
  rmSync(directory, { recursive: true, force: true });
  process.exit(code ?? 0);
});
