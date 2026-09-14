import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import type { TripSnapshot } from "../src/domain/types";
import { registerViaApi } from "./registration";

const origin = "http://127.0.0.1:3100";
async function call<T>(
  page: Page,
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await page.request.fetch(`${origin}/api${path}`, {
    method,
    headers: { Origin: origin },
    ...(data === undefined ? {} : { data }),
  });
  expect(
    response.ok(),
    `${method} ${path}: ${await response.text()}`,
  ).toBeTruthy();
  return response.json() as Promise<T>;
}
async function register(page: Page) {
  await registerViaApi(page, {
    name: "行程查看测试",
    email: `itinerary-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
}
async function createTrip(page: Page, dates = true) {
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "杭州三日 · 山水之间",
    ...(dates ? { startDate: "2026-10-02", endDate: "2026-10-04" } : {}),
  });
  return call<TripSnapshot>(page, `/trips/${trip.id}`);
}
async function assertPng(page: Page, button: string) {
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(500);
  expect(bytes.length).toBeGreaterThan(10_000);
  return bytes;
}

test("查看行程：无编辑控件、按天浏览、手机布局、真实 PNG 和单日导出", async ({
  page,
}, testInfo) => {
  await register(page);
  const snapshot = await createTrip(page);
  const id = snapshot.trip.id;
  for (const item of [
    {
      title: "西湖边的早晨",
      type: "place",
      placeCategory: "自然风光",
      lat: 30.24,
      lng: 120.14,
      address: "杭州市西湖区北山街",
      stayMinutes: 90,
      description: "沿白堤慢慢走，留时间拍照。",
      notes: "带好相机与饮用水。",
    },
    {
      title: "湖畔午餐",
      type: "event",
      lat: 30.25,
      lng: 120.15,
      fixedTime: true,
      startMinutes: 720,
      endMinutes: 780,
      address: "北山街 18 号",
      notes: "已预约窗边的位置。",
    },
    {
      title: "灵隐听雨",
      type: "place",
      lat: 30.24,
      lng: 120.1,
      address: "灵隐路法云弄 1 号",
      stayMinutes: 120,
    },
  ])
    await call(page, `/days/${snapshot.days[0].id}/items`, "POST", item);
  await call(page, `/days/${snapshot.days[1].id}/items`, "POST", {
    title: "去往下一站",
    type: "transport",
    startMinutes: 1410,
    endMinutes: 1530,
    transport: {
      mode: "train",
      status: "confirmed",
      serviceNumber: "D123",
      origin: { name: "杭州站", lat: 30.25, lng: 120.18 },
      destination: { name: "上海站", lat: 31.25, lng: 121.45 },
    },
  });
  const planned = await call<TripSnapshot>(page, `/trips/${id}`);
  for (const [index, leg] of planned.days[0].legs.entries()) {
    await call(page, `/legs/${leg.id}`, "PATCH", {
      expectedVersion: leg.version,
      mode: "manual",
      manualDurationMinutes: index ? 35 : 20,
      manualDescription: index
        ? "乘坐公交前往灵隐，步行至入口"
        : "沿湖步行至餐厅",
    });
  }
  await call(page, `/days/${snapshot.days[1].id}`, "PATCH", {
    expectedVersion: planned.days[1].version,
    startMinutes: 1350,
  });
  await page.goto(`/trips/${id}/plan`);
  await page.getByRole("link", { name: "查看", exact: true }).click();
  await expect(page).toHaveURL(`/trips/${id}/view`);
  await expect(page.getByRole("heading", { name: "行程手册" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "行程设置", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /拖动|新增事项|添加交通/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("23:30 – 次日 01:30", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("杭州站 → 上海站", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("当天暂无安排，留一点时间自由探索。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "编辑行程", exact: true }),
  ).toHaveAttribute("href", `/trips/${id}/plan`);
  await page.screenshot({
    path: testInfo.outputPath("itinerary-desktop.png"),
    fullPage: true,
  });
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("itinerary-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "按天查看行程" })
    .getByRole("link")
    .nth(2)
    .click();
  await expect(page).toHaveURL(
    new RegExp(`#itinerary-day-${snapshot.days[2].id}$`),
  );
  await page.getByRole("button", { name: "导出行程图" }).click();
  await expect(
    page.getByRole("img", { name: /行程图，第 1 张/ }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("itinerary-export-mobile.png"),
  });
  const all = await assertPng(page, "下载 PNG 图片");
  const allDownload = testInfo.outputPath("itinerary-poster.png");
  await writeFile(allDownload, all);
  await page.getByLabel("导出范围").selectOption(snapshot.days[1].id);
  await expect(page.getByRole("img", { name: /行程图/ })).toBeVisible();
  const single = await assertPng(page, "下载 PNG 图片");
  expect(single.readUInt32BE(20)).toBeLessThan(all.readUInt32BE(20));
  await page.getByRole("checkbox", { name: "包含描述与备注" }).uncheck();
  await expect(
    page.getByRole("button", { name: "下载 PNG 图片" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "导出行程图" })).toBeFocused();
});

test("只读成员可查看和导出，长备注自动分图且 ZIP 保留所有 PNG", async ({
  page,
  browser,
}) => {
  await register(page);
  const snapshot = await createTrip(page);
  await call(page, `/days/${snapshot.days[0].id}/items`, "POST", {
    type: "note",
    title: "长行程说明",
    notes: "路上的每一站都值得慢慢看。\n".repeat(180) + "最后一行也要保留。",
  });
  const invite = await call<{ token: string }>(
    page,
    `/trips/${snapshot.trip.id}/invites`,
    "POST",
    { role: "viewer", maxUses: 1 },
  );
  const context = await browser.newContext();
  const viewer = await context.newPage();
  await register(viewer);
  await call(viewer, `/invites/${invite.token}/join`, "POST", {});
  await viewer.goto(`${origin}/trips/${snapshot.trip.id}/view`);
  await expect(viewer.getByRole("heading", { name: "行程手册" })).toBeVisible();
  await expect(viewer.getByRole("link", { name: "编辑行程" })).toHaveCount(0);
  await viewer.evaluate(() => {
    const drawnText: string[] = [];
    Object.assign(window, { drawnText });
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      x,
      y,
      maxWidth,
    ) {
      drawnText.push(text);
      if (maxWidth === undefined) original.call(this, text, x, y);
      else original.call(this, text, x, y, maxWidth);
    };
  });
  await viewer.getByRole("button", { name: "导出行程图" }).click();
  await expect(
    viewer.getByRole("button", { name: "下载全部图片（ZIP）" }),
  ).toBeEnabled();
  await viewer.getByRole("button", { name: "下一张行程图" }).click();
  expect(
    await viewer.evaluate(
      () => (window as unknown as { drawnText: string[] }).drawnText,
    ),
  ).toContain("最后一行也要保留。");
  await expect(viewer.getByRole("img", { name: /第 2 张/ })).toBeVisible();
  await assertPng(viewer, "下载当前图片");
  const downloading = viewer.waitForEvent("download");
  await viewer.getByRole("button", { name: "下载全部图片（ZIP）" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const zip = await readFile((await download.path())!);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  const count = zip.readUInt16LE(zip.length - 12);
  expect(count).toBeGreaterThan(1);
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength;
    expect(zip.subarray(start, start + 8).toString("hex")).toBe(
      "89504e470d0a1a0a",
    );
    expect(zip.readUInt32BE(start + 20)).toBeLessThan(6400);
    offset = start + size;
  }
  await viewer.evaluate(() => {
    (window as unknown as { drawnText: string[] }).drawnText.length = 0;
  });
  await viewer.getByRole("checkbox", { name: "包含描述与备注" }).uncheck();
  await expect(
    viewer.getByRole("button", { name: "下载 PNG 图片", exact: true }),
  ).toBeEnabled();
  await assertPng(viewer, "下载 PNG 图片");
  expect(
    await viewer.evaluate(() =>
      (window as unknown as { drawnText: string[] }).drawnText.join(""),
    ),
  ).not.toContain("最后一行也要保留。");
  await context.close();
});

test("无日期行程可浏览、导出失败可重试", async ({ page }) => {
  await register(page);
  const snapshot = await createTrip(page, false);
  // Legacy snapshots can have no dates; new trips receive dates from the API.
  await page.route(`**/api/trips/${snapshot.trip.id}?section=view`, (route) =>
    route.fulfill({
      json: {
        ...snapshot,
        trip: { ...snapshot.trip, startDate: null, endDate: null },
        days: [],
      },
    }),
  );
  await page.goto(`/trips/${snapshot.trip.id}/view`);
  await expect(page.getByText("日期待定，旅程待启")).toBeVisible();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      HTMLCanvasElement.prototype.toBlob = original;
      callback(null);
      void args;
    };
  });
  await page.getByRole("button", { name: "导出行程图" }).click();
  await expect(
    page.getByText("图片生成失败，请重试或按天导出。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "重新生成" }).click();
  await expect(
    page.getByRole("button", { name: "下载 PNG 图片" }),
  ).toBeEnabled();
  await assertPng(page, "下载 PNG 图片");
});
