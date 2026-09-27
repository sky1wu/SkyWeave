import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { DayPlan, TripSnapshot } from "../src/domain/types";
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
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}

test("分头出发、集合等待、个人筛选、手机布局与导出", async ({
  page,
}, testInfo) => {
  await registerViaApi(page, {
    name: "小王",
    email: `parallel-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "杭州集合 · 分头行动",
    startDate: "2026-10-01",
  });
  const snapshot = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  const dayId = snapshot.days[0].id;
  const guest = await call<{ id: string }>(
    page,
    `/trips/${trip.id}/participants`,
    "POST",
    { name: "小张" },
  );
  const meeting = await call<{ id: string }>(
    page,
    `/days/${dayId}/items`,
    "POST",
    {
      title: "湖畔餐厅",
      lat: 30.25,
      lng: 120.15,
      fixedTime: true,
      startMinutes: 690,
    },
  );
  const station = await call<{ id: string }>(
    page,
    `/trips/${trip.id}/places`,
    "POST",
    { title: "杭州东站", lat: 30.29, lng: 120.2 },
  );
  const airport = await call<{ id: string }>(
    page,
    `/trips/${trip.id}/places`,
    "POST",
    { title: "萧山机场", lat: 30.23, lng: 120.43 },
  );
  await page.goto(`/trips/${trip.id}/plan`);
  await page.getByRole("button", { name: "湖畔餐厅 更多操作" }).click();
  await page.getByRole("menuitem", { name: "在这里集合", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("行动段名称").fill("上午各自出发");
  await dialog.getByLabel("第 1 组名称").fill("铁路组");
  await dialog.getByLabel("第 2 组名称").fill("航空组");
  await dialog.getByLabel("铁路组出发时间", { exact: true }).fill("10:00");
  await dialog.getByLabel("航空组出发时间", { exact: true }).fill("10:30");
  await dialog.getByRole("button", { name: "保存分头行动" }).click();
  await expect(dialog).toHaveCount(0);
  const rail = page
    .locator(".parallel-lane")
    .filter({ has: page.locator("summary", { hasText: "铁路组" }) });
  const air = page
    .locator(".parallel-lane")
    .filter({ has: page.locator("summary", { hasText: "航空组" }) });
  await rail.getByLabel("向铁路组添加收藏地点").selectOption(station.id);
  await rail.getByRole("button", { name: "加入", exact: true }).click();
  await expect(rail.locator(".item-title")).toHaveText("杭州东站");
  await air.getByLabel("向航空组添加收藏地点").selectOption(airport.id);
  await air.getByRole("button", { name: "加入", exact: true }).click();
  await expect(air.locator(".item-title")).toHaveText("萧山机场");
  await expect
    .poll(async () =>
      (await call<DayPlan>(page, `/days/${dayId}`)).legs.every(
        (l) => l.status === "ready",
      ),
    )
    .toBe(true);
  const day = await call<DayPlan>(page, `/days/${dayId}`);
  const section = day.items.find((i) => i.parallelPlan)!;
  for (const leg of day.legs)
    await call(page, `/legs/${leg.id}`, "PATCH", {
      expectedVersion: leg.version,
      mode: "manual",
      manualDurationMinutes:
        leg.branchId === section.parallelPlan!.branches[0].id ? 60 : 75,
    });
  await page.reload();
  await expect(page.locator(".rendezvous")).toContainText("等待 45 分钟");
  await expect(page.locator(".rendezvous")).toContainText("迟到 15 分钟");
  await expect(
    page.getByTestId(`item-${meeting.id}`).locator(".item-time"),
  ).toHaveText("11:45");
  await page.screenshot({
    path: testInfo.outputPath("parallel-desktop.png"),
    fullPage: true,
  });
  await page.getByLabel("查看谁的行程").selectOption("me");
  await expect(air).toHaveCount(0);
  await expect(rail).toBeVisible();
  await expect(
    page
      .getByTestId("test-map")
      .getByRole("button", { name: "地图地点 萧山机场" }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId(`item-${meeting.id}`).locator(".item-time"),
  ).toHaveText("11:45");
  await page.getByLabel("查看谁的行程").selectOption(guest.id);
  await expect(rail).toHaveCount(0);
  await expect(air).toBeVisible();
  await page.getByLabel("查看谁的行程").selectOption("");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("parallel-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "查看", exact: true }).click();
  await expect(page.locator(".itinerary-days")).toContainText("航空组");
  await expect(page.locator(".itinerary-days")).toContainText("等待 45 分钟");
  await page.getByLabel("查看谁的行程").selectOption("me");
  await expect(
    page
      .locator(".itinerary-stop-heading")
      .getByRole("heading", { name: "萧山机场", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".itinerary-stop-heading")
      .getByRole("heading", { name: "杭州东站", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "导出行程图", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载 PNG 图片", exact: true })
    .click();
  const bytes = await readFile((await (await download).path())!);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});

test("从共同起点分开，拖动事项到另一组并保存", async ({ page }) => {
  await registerViaApi(page, {
    name: "小李",
    email: `split-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "下午分头游玩",
    startDate: "2026-10-02",
  });
  const snapshot = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  const dayId = snapshot.days[0].id;
  await call(page, `/trips/${trip.id}/participants`, "POST", { name: "小陈" });
  await call(page, `/days/${dayId}/items`, "POST", {
    title: "共同酒店",
    lat: 30.2,
    lng: 120.1,
  });
  await page.goto(`/trips/${trip.id}/plan`);
  await page.getByRole("button", { name: "共同酒店 更多操作" }).click();
  await page
    .getByRole("menuitem", { name: "从这里分头行动", exact: true })
    .click();
  await page.getByRole("button", { name: "保存分头行动" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const section = (await call<DayPlan>(page, `/days/${dayId}`)).items.find(
    (i) => i.parallelPlan,
  )!;
  const [a, b] = section.parallelPlan!.branches;
  const first = await call<{ id: string }>(
    page,
    `/days/${dayId}/items`,
    "POST",
    { title: "博物馆", branchId: a.id },
  );
  const second = await call<{ id: string }>(
    page,
    `/days/${dayId}/items`,
    "POST",
    { title: "咖啡馆", branchId: b.id },
  );
  await page.reload();
  const source = page.getByTestId(`item-${first.id}`),
    target = page.getByTestId(`item-${second.id}`);
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!,
    to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 7, from.y + 7);
  await page.mouse.down();
  await page.mouse.move(from.x + 7, from.y + 22, { steps: 3 });
  await expect(page.locator(".planner-drag-preview")).toBeVisible();
  await page.mouse.move(to.x + 12, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await call<DayPlan>(page, `/days/${dayId}`)).items.find(
          (i) => i.id === first.id,
        )?.branchId,
    )
    .toBe(b.id);
  await page.reload();
  const firstLane = page
    .locator(".parallel-lane")
    .filter({ has: page.locator("summary", { hasText: "1 组" }) });
  const secondLane = page
    .locator(".parallel-lane")
    .filter({ has: page.locator("summary", { hasText: "2 组" }) });
  await expect(firstLane.locator(".timeline-item")).toHaveCount(0);
  await expect(secondLane.locator(".timeline-item")).toHaveCount(2);
  await secondLane.getByRole("button", { name: "博物馆 更多操作" }).click();
  await page.getByRole("menuitem", { name: "调整分组", exact: true }).click();
  await page.getByRole("dialog").getByRole("combobox").selectOption(a.id);
  await page.getByRole("button", { name: "保存分组", exact: true }).click();
  await expect(firstLane.locator(".item-title")).toHaveText("博物馆");
});
