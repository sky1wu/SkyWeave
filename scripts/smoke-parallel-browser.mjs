import { config } from "dotenv";
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
config({ path: ".env.local", quiet: true });
if (
  !process.env.AMAP_WEB_SERVICE_KEY ||
  !process.env.AMAP_JS_KEY ||
  !process.env.AMAP_SECURITY_CODE
)
  throw new Error("真实底图验证需要完整高德服务端和 JS 配置");
const directory = mkdtempSync(`${tmpdir()}/skyweave-live-browser-`);
const base = "http://127.0.0.1:3102";
const child = spawn(process.execPath, ["scripts/start.mjs"], {
  stdio: "ignore",
  env: {
    ...process.env,
    DATABASE_PATH: `${directory}/test.sqlite`,
    PORT: "3102",
    APP_HOST: "127.0.0.1",
    BETTER_AUTH_URL: base,
    BETTER_AUTH_SECRET: "isolated-live-map-validation-only-secret-0123456789",
    AMAP_TEST_MODE: "0",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
let browser;
let page;
const failures = [];
const report = {
  checkedAt: new Date().toISOString(),
  provider: "live AMap JS and Web Service",
  passed: false,
  checks: [],
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${base}/api/health`);
      ready = response.ok;
    } catch {
      /* Startup in progress. */
    }
    if (ready) break;
    if (child.exitCode !== null) throw new Error("隔离验证服务启动失败");
    await pause(300);
  }
  if (!ready) throw new Error("隔离验证服务启动超时");
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    failures.push({
      host: url.hostname,
      path: url.pathname,
      error: request.failure()?.errorText,
    });
  });
  async function api(path, method = "GET", data) {
    const response = await context.request.fetch(`${base}/api${path}`, {
      method,
      headers: { Origin: base },
      ...(data === undefined ? {} : { data }),
    });
    if (!response.ok())
      throw new Error(
        `验证接口 ${path.split("/")[1]} 返回 ${response.status()}`,
      );
    return response.json();
  }
  const registration = await context.request.post(
    `${base}/api/auth/sign-up/email`,
    {
      headers: { Origin: base },
      data: {
        name: "地图联调甲",
        email: `map-${crypto.randomUUID()}@example.test`,
        password: "Isolated-live-map-password-2026",
      },
    },
  );
  if (!registration.ok()) throw new Error("隔离测试账号创建失败");
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const trip = await api("/trips", "POST", {
    title: "杭州分头集合 · 真实地图验证",
    startDate: tomorrow,
  });
  const initial = await api(`/trips/${trip.id}`),
    day = initial.days[0];
  const other = await api(`/trips/${trip.id}/participants`, "POST", {
    name: "地图联调乙",
  });
  const points = [];
  for (const query of [
    "杭州东站",
    "杭州萧山国际机场",
    "杭州西湖湖滨银泰in77",
  ]) {
    const found = await api(
      `/places/search?q=${encodeURIComponent(query)}&city=${encodeURIComponent("杭州")}`,
    );
    if (!found.places?.length) throw new Error("真实地点搜索未返回结果");
    points.push(found.places[0]);
  }
  const point = (i) => ({
    title: points[i].name,
    lat: points[i].lat,
    lng: points[i].lng,
    amapPoiId: points[i].amapPoiId,
  });
  const meeting = await api(`/days/${day.id}/items`, "POST", {
    ...point(2),
    fixedTime: true,
    startMinutes: 720,
  });
  const branches = [initial.participants[0].id, other.id].map((id, i) => ({
    id: crypto.randomUUID(),
    title: i ? "机场组" : "车站组",
    participantIds: [id],
    startMinutes: 540,
  }));
  await api(`/days/${day.id}/items`, "POST", {
    title: "不同出发点，湖滨集合",
    type: "parallel",
    parallelPlan: {
      splitItemId: null,
      joinItemId: meeting.id,
      joinPolicy: "wait_all",
      branches,
    },
  });
  for (const [i, branch] of branches.entries())
    await api(`/days/${day.id}/items`, "POST", {
      ...point(i),
      branchId: branch.id,
    });
  const planned = await api(`/days/${day.id}`);
  for (const leg of planned.legs)
    await api(`/legs/${leg.id}`, "PATCH", {
      expectedVersion: leg.version,
      mode: "driving",
    });
  await api(`/days/${day.id}/routes/recalculate`, "POST", {});
  const routed = await api(`/days/${day.id}`);
  if (
    routed.legs.length !== 2 ||
    routed.legs.some(
      (leg) => leg.status !== "ready" || !leg.selectedAlternativeId,
    )
  )
    throw new Error("真实路线未全部完成");
  await page.goto(`${base}/trips/${trip.id}/plan`);
  await page.waitForFunction(
    () =>
      !!window.AMap &&
      (document.querySelectorAll(".map-container canvas").length > 0 ||
        [...document.querySelectorAll(".map-container img")].filter(
          (img) =>
            img instanceof HTMLImageElement &&
            img.complete &&
            img.naturalWidth >= 128 &&
            img.naturalHeight >= 128,
        ).length >= 2),
    {},
    { timeout: 45000 },
  );
  await page
    .locator(".map-place-marker")
    .first()
    .waitFor({ state: "visible", timeout: 20000 });
  if (await page.getByTestId("test-map").count())
    throw new Error("真实地图验证错误进入了模拟模式");
  await pause(3000);
  mkdirSync(".tmp", { recursive: true });
  await page.screenshot({
    path: ".tmp/live-parallel-map-desktop.png",
    fullPage: true,
  });
  report.checks.push({
    desktop: "real base-map tiles or canvas and POI markers rendered",
    routes: routed.legs.length,
  });
  await page.getByLabel("查看谁的行程").selectOption("me");
  await pause(1000);
  if ((await page.locator(".parallel-lane").count()) !== 1)
    throw new Error("个人筛选未限制到本人的分组");
  await page.setViewportSize({ width: 390, height: 844 });
  await pause(1000);
  if (
    !(await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ))
  )
    throw new Error("手机页面横向溢出");
  await page.screenshot({
    path: ".tmp/live-parallel-map-mobile.png",
    fullPage: true,
  });
  report.checks.push({
    mobile: "390px layout has no horizontal overflow",
    personalFilter: "one branch",
  });
  report.passed = true;
  console.log(
    "真实高德底图浏览器验证通过：双起点路线、个人筛选、桌面及手机布局。",
  );
} catch (error) {
  if (page) {
    mkdirSync(".tmp", { recursive: true });
    await page
      .screenshot({
        path: ".tmp/live-parallel-map-failure.png",
        fullPage: true,
      })
      .catch(() => {});
    const diagnostics = await page
      .evaluate(() => ({
        path: location.pathname,
        mapError: document.querySelector(".map-unavailable")?.textContent,
        hasSdk: !!window.AMap,
        canvases: document.querySelectorAll(".map-container canvas").length,
        mapNodes: document.querySelector(".map-container")?.childElementCount,
        tileImages: document.querySelectorAll(".map-container img").length,
      }))
      .catch(() => ({}));
    report.checks.push({ diagnostics, failures });
    console.log(JSON.stringify({ diagnostics, failures }));
  }
  report.checks.push({
    error: error instanceof Error ? error.message : "浏览器验证失败",
  });
  console.error(error instanceof Error ? error.message : "浏览器验证失败");
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  mkdirSync(".tmp", { recursive: true });
  writeFileSync(
    ".tmp/live-parallel-browser.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  rmSync(directory, { recursive: true, force: true });
  console.log("真实底图验证报告与截图位于 .tmp，隔离账号和测试数据库已清理。");
}
