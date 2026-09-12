import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 12000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    wait: { stdout: /Ready in/ },
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    reuseExistingServer: false,
    timeout: 30000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
