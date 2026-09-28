import { test, expect, type Page } from "@playwright/test";
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
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json();
}

test("分组表单设置不同出发地，同组成员第三天直接加入", async ({
  page,
}, testInfo) => {
  await registerViaApi(page, {
    name: "全程成员",
    email: `origins-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "第三天游艇会集合",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
  });
  const snap = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  const late = await call<{ id: string }>(
      page,
      `/trips/${trip.id}/participants`,
      "POST",
      { name: "晚到同行者" },
    ),
    other = await call<{ id: string }>(
      page,
      `/trips/${trip.id}/participants`,
      "POST",
      { name: "同车朋友" },
    );
  const create = (title: string, day: number, extra: object = {}) =>
    call<{ id: string }>(page, `/days/${snap.days[day].id}/items`, "POST", {
      title,
      lat: 22,
      lng: 114,
      ...extra,
    });
  const old = await create("首日景点", 0);
  await create("第二天游玩", 1);
  const shared = await create("默认酒店", 2),
    meet = await create("七星湾游艇会", 2, {
      fixedTime: true,
      startMinutes: 600,
    });
  const poolA = await call<{ id: string }>(
      page,
      `/trips/${trip.id}/places`,
      "POST",
      { title: "深圳北站", lat: 22.6, lng: 114.03 },
    ),
    poolB = await call<{ id: string }>(
      page,
      `/trips/${trip.id}/places`,
      "POST",
      { title: "广州南站", lat: 22.9, lng: 113.27 },
    );
  const branches = [
    {
      id: crypto.randomUUID(),
      title: "深圳组",
      participantIds: [snap.participants[0].id, late.id],
      startMinutes: null,
    },
    {
      id: crypto.randomUUID(),
      title: "广州组",
      participantIds: [other.id],
      startMinutes: null,
    },
  ];
  const section = await call<{ id: string }>(
    page,
    `/days/${snap.days[2].id}/items`,
    "POST",
    {
      title: "分头出发",
      type: "parallel",
      parallelPlan: {
        splitItemId: shared.id,
        joinItemId: meet.id,
        joinPolicy: "wait_all",
        branches,
      },
    },
  );
  await page.goto(`/trips/${trip.id}/plan`);
  const root = page.locator(`#item-${section.id}`);
  await root
    .locator(":scope > header")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("分开地点", { exact: true }).selectOption("");
  await dialog
    .getByLabel("深圳组出发地点", { exact: true })
    .selectOption(`pool:${poolA.id}`);
  await dialog
    .getByLabel("广州组出发地点", { exact: true })
    .selectOption(`pool:${poolB.id}`);
  await dialog.getByLabel("深圳组出发时间", { exact: true }).fill("09:00");
  await dialog.getByLabel("广州组出发时间", { exact: true }).fill("09:00");
  const first = dialog.getByRole("group", { name: "1 组", exact: true });
  await first
    .getByText("成员加入时间 · 可设置中途参加", { exact: true })
    .click();
  await first
    .getByLabel("深圳组 晚到同行者参与范围", { exact: true })
    .selectOption("meeting");
  await first
    .getByLabel("晚到同行者到达集合点时间", { exact: true })
    .fill("11:00");
  await page.screenshot({
    path: testInfo.outputPath("different-origins-editor.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "保存分头行动", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => {
      const d = await call<DayPlan>(page, `/days/${snap.days[2].id}`);
      return d.legs.every((l) => l.status === "ready");
    })
    .toBe(true);
  const saved = await call<DayPlan>(page, `/days/${snap.days[2].id}`),
    plan = saved.items.find((i) => i.id === section.id)!.parallelPlan!;
  expect(plan.splitItemId).toBeNull();
  expect(plan.branches.every((b) => !!b.departureItemId)).toBe(true);
  for (const leg of saved.legs)
    await call(page, `/legs/${leg.id}`, "PATCH", {
      expectedVersion: leg.version,
      mode: "manual",
      manualDurationMinutes: 30,
    });
  await page.reload();
  await expect(page.locator(`#item-${section.id}`)).toContainText("深圳北站");
  await expect(page.locator(`#item-${section.id}`)).toContainText("广州南站");
  await page.getByLabel("查看谁的行程").selectOption(late.id);
  await expect(page.getByTestId(`item-${old.id}`)).toHaveCount(0);
  await expect(
    page.getByTestId(`item-${plan.branches[0].departureItemId}`),
  ).toHaveCount(0);
  await expect(
    page.getByTestId(`item-${meet.id}`).locator(".item-time"),
  ).toHaveText("11:00");
  await expect(page.locator(`#item-${section.id}`)).toContainText(
    "直接在「七星湾游艇会」加入",
  );
  await page.getByRole("link", { name: "查看", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "行程手册", exact: true }),
  ).toBeVisible();
  await page.getByLabel("查看谁的行程").selectOption(late.id);
  await expect(page.locator(`#itinerary-stop-${old.id}`)).toHaveCount(0);
  await expect(page.locator(`#itinerary-stop-${meet.id}`)).toContainText(
    "11:00",
  );
  await expect(page.locator(`#itinerary-stop-${meet.id}`)).toContainText(
    "加入行程",
  );
  await page.getByLabel("查看谁的行程").selectOption("me");
  await expect(page.locator(`#itinerary-stop-${old.id}`)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

test("在分组表单搜索或手动添加出发地，改动后清除旧保存错误", async ({
  page,
}) => {
  await registerViaApi(page, {
    name: "搜索成员",
    email: `origin-search-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "各自出发",
    startDate: "2026-10-01",
  });
  const snap = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  await call(page, `/trips/${trip.id}/participants`, "POST", {
    name: "手动成员",
  });
  const meet = await call<{ id: string }>(
    page,
    `/days/${snap.days[0].id}/items`,
    "POST",
    {
      title: "下午集合",
      lat: 34.25,
      lng: 108.95,
      fixedTime: true,
      startMinutes: 900,
    },
  );
  await page.goto(`/trips/${trip.id}/plan`);
  await page
    .getByRole("button", { name: "向第 1 天添加分头行动", exact: true })
    .click();
  await page.getByLabel("集合地点", { exact: true }).selectOption(meet.id);
  const dialog = page.getByRole("dialog"),
    first = dialog.getByRole("group", { name: "1 组", exact: true });
  await first.getByLabel("1 组出发地点", { exact: true }).selectOption("new");
  await first.getByLabel("1 组搜索出发地点").fill("钟楼");
  await first
    .getByRole("button", { name: "搜索出发地点", exact: true })
    .click();
  await first
    .locator(".branch-departure-results")
    .getByRole("button", { name: /钟楼/ })
    .first()
    .click();
  await dialog.getByLabel("2 组出发地点", { exact: true }).selectOption("new");
  await dialog.getByLabel("2 组出发地点名称").fill("朋友家");
  let rejected = false;
  await page.route(`**/api/trips/${trip.id}/parallel`, async (route) => {
    if (!rejected) {
      rejected = true;
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "VALIDATION",
            message: "分开点必须是该组实际出发前的地点",
          },
        }),
      });
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "保存分头行动", exact: true })
    .click();
  await expect(dialog).toContainText("分开点必须是该组实际出发前的地点");
  await dialog.getByLabel("2 组出发地点名称").fill("朋友家楼下");
  await expect(
    dialog.getByText("分开点必须是该组实际出发前的地点", { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "保存分头行动", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const day = await call<DayPlan>(page, `/days/${snap.days[0].id}`),
    section = day.items.find((i) => i.parallelPlan)!;
  expect(section.parallelPlan?.joinItemId).toBe(meet.id);
  expect(
    day.items.find(
      (i) => i.id === section.parallelPlan!.branches[1].departureItemId,
    )?.title,
  ).toBe("朋友家楼下");
  expect(
    day.items.find(
      (i) => i.id === section.parallelPlan!.branches[0].departureItemId,
    )?.lat,
  ).not.toBeNull();
  await page.reload();
  await page
    .locator(`#item-${section.id}`)
    .locator(":scope > header")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("2 组出发地点", { exact: true }),
  ).toHaveValue(`item:${section.parallelPlan!.branches[1].departureItemId}`);
});
