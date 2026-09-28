import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
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

test("单条航班指定两人，其他人的时间、地图和导出不包含航班", async ({
  page,
}, testInfo) => {
  await registerViaApi(page, {
    name: "甲",
    email: `item-people-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "两人乘机",
    startDate: "2026-10-07",
  });
  const initial = await call<TripSnapshot>(page, `/trips/${trip.id}`),
    day = initial.days[0];
  await call(page, `/trips/${trip.id}/participants`, "POST", { name: "乙" });
  const other = await call<{ id: string }>(
    page,
    `/trips/${trip.id}/participants`,
    "POST",
    { name: "丙" },
  );
  await call(page, `/days/${day.id}`, "PATCH", {
    expectedVersion: day.version,
    startMinutes: 300,
  });
  await call(page, `/days/${day.id}/items`, "POST", {
    title: "酒店",
    lat: 23,
    lng: 113,
    stayMinutes: 10,
  });
  const flight = await call<{ id: string }>(
    page,
    `/days/${day.id}/items`,
    "POST",
    {
      title: "广州飞西安",
      type: "transport",
      fixedTime: true,
      startMinutes: 385,
      endMinutes: 535,
      transport: {
        mode: "flight",
        status: "confirmed",
        serviceNumber: "AQ1105",
        origin: { name: "广州机场", lat: 23.4, lng: 113.3 },
        destination: { name: "西安机场", lat: 34.4, lng: 108.7 },
      },
    },
  );
  const end = await call<{ id: string }>(
    page,
    `/days/${day.id}/items`,
    "POST",
    { title: "后续安排", lat: 23.1, lng: 113.1 },
  );
  await page.goto(`/trips/${trip.id}/plan`);
  await page.getByRole("button", { name: "广州飞西安 更多操作" }).click();
  await page.getByRole("menuitem", { name: "设置参与者", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("参与范围").selectOption("selected");
  await dialog.getByRole("button", { name: "保存交通", exact: true }).click();
  await expect(dialog).toContainText("请至少选择一位参与者");
  await dialog.getByRole("checkbox", { name: "甲", exact: true }).check();
  await dialog.getByRole("checkbox", { name: "乙", exact: true }).check();
  await dialog.getByRole("button", { name: "保存交通", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId(`item-${flight.id}`)).toContainText(
    "参与者：甲、乙",
  );
  const saved = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  expect(
    saved.days[0].items.find((item) => item.id === flight.id)?.participantIds,
  ).toHaveLength(2);
  expect(saved.days[0].items.some((item) => item.parallelPlan)).toBe(false);
  for (const leg of saved.days[0].legs)
    await call(page, `/legs/${leg.id}`, "PATCH", {
      expectedVersion: leg.version,
      mode: "manual",
      manualDurationMinutes: 15,
    });
  await page.reload();
  await page.getByLabel("查看谁的行程").selectOption(other.id);
  await expect(page.getByTestId(`item-${flight.id}`)).toHaveCount(0);
  await expect(
    page.getByTestId(`item-${end.id}`).locator(".item-time"),
  ).toHaveText("05:25");
  await expect(
    page
      .getByTestId("test-map")
      .getByRole("button", { name: "地图地点 广州机场" }),
  ).toHaveCount(0);
  await page.getByLabel("查看谁的行程").selectOption("me");
  await expect(page.getByTestId(`item-${flight.id}`)).toBeVisible();
  await expect(
    page.getByTestId(`item-${end.id}`).locator(".item-time"),
  ).toHaveText("09:10");
  await page
    .getByTestId(`item-${flight.id}`)
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await expect(
    dialog.getByRole("checkbox", { name: "甲", exact: true }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "丙", exact: true }),
  ).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await dialog
    .getByRole("group", { name: "参与者", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("participants-mobile.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "保存交通", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Ordinary activities use the same selection without changing groups.
  await page
    .getByTestId(`item-${end.id}`)
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await dialog.getByLabel("参与范围").selectOption("selected");
  await dialog.getByRole("checkbox", { name: "丙", exact: true }).check();
  await dialog.getByRole("button", { name: "保存事项", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("查看谁的行程").selectOption(other.id);
  await expect(page.getByTestId(`item-${end.id}`)).toContainText("参与者：丙");
  await page.getByRole("link", { name: "查看", exact: true }).click();
  await expect(page.locator(".itinerary-days")).toBeVisible();
  await page.getByLabel("查看谁的行程").selectOption(other.id);
  await expect(page.locator(".itinerary-days")).not.toContainText("广州飞西安");
  await expect(page.locator(".itinerary-days")).toContainText("后续安排");
  await page.getByRole("button", { name: "导出行程图", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载 PNG 图片", exact: true })
    .click();
  const bytes = await readFile((await (await download).path())!);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});
