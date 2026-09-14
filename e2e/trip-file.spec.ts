import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { TripSnapshot } from "../src/domain/types";
import { registerViaApi } from "./registration";

const origin = "http://127.0.0.1:3100";
async function call<T>(page: Page, path: string, data?: unknown): Promise<T> {
  const response = await page.request.fetch(`${origin}/api${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { Origin: origin },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}

test("文件导出与导入：真实下载、跨页面完整数据、错误恢复、独立新行程和手机布局", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await registerViaApi(page, {
    name: "文件测试",
    email: `file-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", {
    title: "杭州 / 上海 🌄",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
  });
  const data = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  await call(page, `/days/${data.days[0].id}/items`, {
    type: "note",
    title: "湖边集合",
    notes: "记得带相机。",
  });
  await call(page, `/trips/${trip.id}/places`, {
    title: "尚未安排的地点",
    lat: 30.25,
    lng: 120.18,
    notes: "导出时也要保留",
  });
  await call(page, `/trips/${trip.id}/expenses`, {
    title: "共同车费",
    category: "transport",
    amountMinor: 12000,
    currency: "CNY",
    exchangeRateToBase: "1",
    payerParticipantId: data.participants[0].id,
    splitMethod: "equal",
    splitMeta: [{ participantId: data.participants[0].id, value: "1" }],
    incurredAt: Date.now(),
  });
  // The view snapshot omits both the place pool and ledger; export must fetch all.
  await page.goto(`/trips/${trip.id}/view`);
  await page.getByRole("button", { name: "导出行程文件", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "导出行程文件" }),
  ).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载 JSON 文件", exact: true })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("杭州 _ 上海 🌄.skyweave.json");
  const bytes = await readFile((await download.path())!);
  const exported = JSON.parse(bytes.toString("utf8"));
  expect(exported.poolPlaces[0].title).toBe("尚未安排的地点");
  expect(exported.expenses[0].title).toBe("共同车费");
  expect(exported.days).toHaveLength(2);

  await page.goto("/");
  await page.getByRole("button", { name: "从文件导入", exact: true }).click();
  const input = page.getByLabel("行程文件", { exact: true });
  const submit = page.getByRole("button", {
    name: "导入为新行程",
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await input.setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("not json"),
  });
  await submit.click();
  await expect(page.getByRole("alert")).toContainText("文件不是有效的 JSON");
  await input.setInputFiles({
    name: "future.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...exported, version: 999 })),
  });
  await submit.click();
  await expect(page.getByRole("alert")).toContainText("暂不支持此行程文件版本");
  expect(await call<unknown[]>(page, "/trips")).toHaveLength(1);
  // UTF-8 BOM is accepted, and import has its own limit above normal API bodies.
  await input.setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/json",
    buffer: Buffer.from(
      "\uFEFF" + JSON.stringify({ ...exported, padding: "x".repeat(600000) }),
    ),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("trip-import-mobile.png"),
  });
  await submit.click();
  await expect(page).toHaveURL(/\/trips\/[^/]+\/plan$/);
  const importedId = new URL(page.url()).pathname.split("/")[2];
  expect(importedId).not.toBe(trip.id);
  const imported = await call<TripSnapshot>(page, `/trips/${importedId}`);
  expect(imported.days[0].items[0].notes).toBe("记得带相机。");
  expect(imported.expenses[0].title).toBe("共同车费");
  expect(imported.poolPlaces[0].notes).toBe("导出时也要保留");
  expect(imported.members).toHaveLength(1);
  expect(imported.members[0].role).toBe("owner");
  expect(await call<unknown[]>(page, "/trips")).toHaveLength(2);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "杭州 / 上海 🌄", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "导出行程文件", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "下载 JSON 文件", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  for (const section of ["plan", "view"]) {
    await page.goto(`/trips/${importedId}/${section}`);
    await expect(
      page.getByRole("button", { name: "导出行程文件", exact: true }),
    ).toBeVisible();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.goto("/");
  await page.getByRole("button", { name: "从文件导入", exact: true }).click();
  await input.setInputFiles({
    name: "too-large.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(20 * 1024 * 1024 + 1, " "),
  });
  await expect(page.getByRole("alert")).toHaveText("行程文件不能超过 20 MB");
  await expect(submit).toBeDisabled();
  expect(errors).toEqual([]);
});

test("导入导出接口要求登录与同源写入，拒绝超限文件", async ({ page }) => {
  const anonymous = await page.request.post(`${origin}/api/trips/import`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(anonymous.status()).toBe(401);
  await registerViaApi(page, {
    name: "文件权限测试",
    email: `file-auth-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const foreign = await page.request.post(`${origin}/api/trips/import`, {
    headers: { Origin: "https://untrusted.example" },
    data: {},
  });
  expect(foreign.status()).toBe(403);
  const oversized = await page.request.post(`${origin}/api/trips/import`, {
    headers: { Origin: origin, "Content-Type": "application/json" },
    data: '"' + "x".repeat(20 * 1024 * 1024) + '"',
  });
  expect(oversized.status()).toBe(413);
  expect(await call<unknown[]>(page, "/trips")).toEqual([]);
});
