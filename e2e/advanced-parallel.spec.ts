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
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}
test("批量拆分现有安排、组内再分开、跨日复制与整段移动", async ({
  page,
}, testInfo) => {
  await registerViaApi(page, {
    name: "甲",
    email: `advanced-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "四天分头旅行",
    startDate: "2026-10-01",
    endDate: "2026-10-04",
  });
  const snap = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  for (const name of ["乙", "丙"])
    await call(page, `/trips/${trip.id}/participants`, "POST", { name });
  const create = (title: string, day = 0) =>
    call<{ id: string }>(page, `/days/${snap.days[day].id}/items`, "POST", {
      title,
    });
  const hotel = await create("出发酒店"),
    museum = await create("博物馆"),
    coffee = await create("咖啡馆"),
    meet = await create("次日会合", 1);
  await page.goto(`/trips/${trip.id}/plan`);
  await page
    .getByRole("button", { name: "向第 1 天添加分头行动", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("分开地点", { exact: true }).selectOption(hotel.id);
  await dialog.getByLabel("行动段名称").fill("两日分头");
  await dialog.getByLabel("第 1 组名称").fill("家人组");
  await dialog.getByLabel("第 2 组名称").fill("独行组");
  await dialog
    .getByRole("checkbox", { name: "家人组 丙", exact: true })
    .check();
  await dialog.getByLabel("集合地点", { exact: true }).selectOption(meet.id);
  await dialog.getByText(/批量分配已有安排/).click();
  await dialog.getByLabel("博物馆所属分组").selectOption({ label: "家人组" });
  await dialog.getByLabel("咖啡馆所属分组").selectOption({ label: "独行组" });
  await dialog.getByRole("button", { name: "保存分头行动" }).click();
  await expect(dialog).toHaveCount(0);
  const day = await call<DayPlan>(page, `/days/${snap.days[0].id}`);
  const section = day.items.find((item) => item.title === "两日分头")!;
  expect(section.parallelPlan?.splitItemId).toBe(hotel.id);
  expect(day.items.find((item) => item.id === museum.id)?.branchId).toBe(
    section.parallelPlan!.branches[0].id,
  );
  expect(day.items.find((item) => item.id === coffee.id)?.branchId).toBe(
    section.parallelPlan!.branches[1].id,
  );
  const latest = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  const reversed = await page.request.post(
    `${origin}/api/trips/${trip.id}/days/reorder`,
    {
      headers: { Origin: origin },
      data: {
        expectedVersion: latest.trip.version,
        dayIds: [
          snap.days[1].id,
          snap.days[0].id,
          snap.days[2].id,
          snap.days[3].id,
        ],
      },
    },
  );
  expect(reversed.status()).toBe(400);
  const root = page.locator(`#item-${section.id}`);
  const family = root
    .locator(".parallel-lane")
    .filter({ has: page.locator("summary", { hasText: "家人组" }) });
  await family.getByRole("button", { name: "组内再分开", exact: true }).click();
  await dialog.getByLabel("行动段名称").fill("馆内再分组");
  await dialog.getByRole("button", { name: "保存分头行动" }).click();
  await expect(
    root.locator('.parallel-block[aria-label="馆内再分组"]'),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("nested-desktop.png"),
    fullPage: true,
  });
  await root
    .locator(":scope > header")
    .getByRole("button", { name: "复制整段", exact: true })
    .click();
  await dialog.getByLabel("目标起始日期").selectOption(snap.days[1].id);
  await expect(dialog).toContainText(
    "包含组内安排、嵌套分组和公共分开／集合点",
  );
  const copiedResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/parallel/transfer") && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "复制整段", exact: true }).click();
  const copied = await (await copiedResponse).json();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => {
      const state = await call<TripSnapshot>(page, `/trips/${trip.id}`);
      return state.days[1].items.some((i) => i.id === copied.id);
    })
    .toBe(true);
  await root
    .locator(":scope > header")
    .getByRole("button", { name: "移动整段", exact: true })
    .click();
  await dialog.getByLabel("目标起始日期").selectOption(snap.days[2].id);
  await dialog.getByRole("button", { name: "移动整段", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => {
      const state = await call<TripSnapshot>(page, `/trips/${trip.id}`);
      return (
        state.days[2].items.some((i) => i.id === section.id) &&
        state.days[3].items.some((i) => i.id === meet.id)
      );
    })
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.locator(`#item-${copied.id}`).waitFor();
  await page.locator(".continuous-timeline").evaluate((pane, id) => {
    const node = document.getElementById(`item-${id}`)!;
    pane.scrollTop +=
      node.getBoundingClientRect().top - pane.getBoundingClientRect().top - 8;
  }, copied.id);
  await page.screenshot({
    path: testInfo.outputPath("nested-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "查看", exact: true }).click();
  await expect(page.locator(".itinerary-days")).toContainText("跨日行动继续");
});

test("编辑分组的迟到追赶设置，个人视图跳过中间活动", async ({ page }) => {
  await registerViaApi(page, {
    name: "准时成员",
    email: `catch-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "迟到后会合",
    startDate: "2026-10-01",
  });
  const snap = await call<TripSnapshot>(page, `/trips/${trip.id}`),
    dayId = snap.days[0].id;
  const guest = await call<{ id: string }>(
    page,
    `/trips/${trip.id}/participants`,
    "POST",
    { name: "迟到成员" },
  );
  const create = (title: string, extra: object = {}) =>
    call<{ id: string }>(page, `/days/${dayId}/items`, "POST", {
      title,
      lat: 30.2,
      lng: 120.1,
      ...extra,
    });
  const meeting = await create("十点集合", {
      fixedTime: true,
      startMinutes: 600,
      endMinutes: 630,
    }),
    park = await create("途中公园", { stayMinutes: 15 }),
    later = await create("后续会合点");
  const branches = [
    {
      id: crypto.randomUUID(),
      title: "准时组",
      participantIds: [snap.participants[0].id],
      startMinutes: 540,
    },
    {
      id: crypto.randomUUID(),
      title: "追赶组",
      participantIds: [guest.id],
      startMinutes: 630,
    },
  ];
  const section = await call<{ id: string }>(
    page,
    `/days/${dayId}/items`,
    "POST",
    {
      title: "各自抵达",
      type: "parallel",
      parallelPlan: {
        splitItemId: null,
        joinItemId: meeting.id,
        joinPolicy: "fixed",
        branches,
      },
    },
  );
  await create("甲起点", { branchId: branches[0].id });
  await create("乙起点", { branchId: branches[1].id });
  await page.goto(`/trips/${trip.id}/plan`);
  await page
    .locator(`#item-${section.id}`)
    .locator(":scope > header")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("追赶组迟到后会合点")
    .selectOption(later.id);
  await page.getByRole("button", { name: "保存分头行动", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const day = await call<DayPlan>(page, `/days/${dayId}`);
  for (const leg of day.legs)
    await call(page, `/legs/${leg.id}`, "PATCH", {
      expectedVersion: leg.version,
      mode: "manual",
      manualDurationMinutes: leg.routeRole === "catch_up" ? 60 : 15,
    });
  await page.reload();
  await page.getByLabel("查看谁的行程").selectOption(guest.id);
  await expect(page.getByTestId(`item-${park.id}`)).toContainText("改赴");
  await expect(
    page.getByTestId(`item-${later.id}`).locator(".item-time"),
  ).toHaveText("11:30");
  await page.getByRole("link", { name: "查看", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "行程手册", exact: true }),
  ).toBeVisible();
  await page.getByLabel("查看谁的行程").selectOption(guest.id);
  await expect(page.getByLabel("查看谁的行程")).toHaveValue(guest.id);
  await expect(page.locator(`#itinerary-stop-${park.id}`)).toContainText(
    "已跳过",
  );
  await expect(page.locator(`#itinerary-stop-${later.id}`)).toContainText(
    "11:30",
  );
});
