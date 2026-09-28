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

test("谁参加中快捷设置加入和离开，跨日筛选、地图、导出与清除范围一致", async ({
  page,
}, testInfo) => {
  await registerViaApi(page, {
    name: "全程成员",
    email: `bounds-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "只参加中间一段",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
  });
  const snapshot = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  const guest = await call<{ id: string }>(
    page,
    `/trips/${trip.id}/participants`,
    "POST",
    { name: "中途成员" },
  );
  const add = (title: string, day: number) =>
    call<{ id: string }>(page, `/days/${snapshot.days[day].id}/items`, "POST", {
      title,
      lat: 22,
      lng: 114,
      stayMinutes: 10,
    });
  const before = await add("第一天活动", 0),
    early = await add("加入前活动", 1),
    join = await add("地铁站加入", 1),
    middle = await add("共同游玩", 1),
    leave = await add("机场送别", 1),
    after = await add("送别后晚餐", 1),
    last = await add("第三天活动", 2);
  await page.goto(`/trips/${trip.id}/plan`);
  const dialog = page.getByRole("dialog", { name: "谁参加", exact: true });
  async function open(id: string) {
    await page
      .getByTestId(`item-${id}`)
      .getByRole("button", { name: /谁参加/ })
      .click();
    await dialog.getByText("设置加入与离开", { exact: true }).click();
    await dialog.getByLabel("给谁设置参与范围").selectOption(guest.id);
  }
  await open(join.id);
  await expect(dialog).toContainText("加入：从行程开始");
  await dialog.getByRole("button", { name: "从此处加入", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId(`item-${join.id}`)).toContainText(
    "中途成员从此处加入",
  );
  await open(leave.id);
  await expect(dialog).toContainText("加入：第 2 天 · 地铁站加入");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sw-mobile-sheet")).toBeVisible();
  // The responsive modal remounts its children; reopen the quick settings.
  if (!(await dialog.getByLabel("给谁设置参与范围").isVisible()))
    await dialog.getByText("设置加入与离开", { exact: true }).click();
  await dialog.getByLabel("给谁设置参与范围").selectOption(guest.id);
  await dialog
    .getByRole("button", { name: "此项结束后离开", exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("join-leave-mobile.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "此项结束后离开", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByTestId(`item-${leave.id}`)).toContainText(
    "中途成员此项结束后离开",
  );
  await page.getByLabel("查看谁的行程").selectOption(guest.id);
  for (const item of [before, early, after, last])
    await expect(page.getByTestId(`item-${item.id}`)).toHaveCount(0);
  for (const item of [join, middle, leave])
    await expect(page.getByTestId(`item-${item.id}`)).toBeVisible();
  await expect(page.locator(".participation-note")).toContainText("机场送别");
  await expect(
    page
      .getByTestId("test-map")
      .getByRole("button", { name: "地图地点 加入前活动" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "查看", exact: true }).click();
  await expect(page.locator(".itinerary-days")).toBeVisible();
  await page.getByLabel("查看谁的行程").selectOption(guest.id);
  await expect(page.locator(".itinerary-days")).not.toContainText("第一天活动");
  await expect(page.locator(".itinerary-days")).not.toContainText("送别后晚餐");
  await expect(page.locator(".itinerary-days")).toContainText("机场送别");
  await page.getByRole("button", { name: "导出行程图", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载 PNG 图片", exact: true })
    .click();
  expect(
    (await readFile((await (await download).path())!))
      .subarray(0, 8)
      .toString("hex"),
  ).toBe("89504e470d0a1a0a");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.goto(`/trips/${trip.id}/plan`);
  await open(leave.id);
  await expect(dialog).toContainText("机场送别结束后");
  await dialog
    .getByRole("button", { name: "清除离开限制", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await open(join.id);
  await dialog
    .getByRole("button", { name: "清除加入限制", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const saved = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  expect(
    saved.days
      .flatMap((day) => day.items)
      .some(
        (i) => i.joinParticipantIds?.length || i.leaveParticipantIds?.length,
      ),
  ).toBe(false);
  await expect(page.getByTestId(`item-${before.id}`)).toContainText(
    "全部同行者",
  );
});

test("错误的离开点保留原范围，未保存的选人修改不会被快捷设置覆盖", async ({
  page,
}) => {
  await registerViaApi(page, {
    name: "范围测试",
    email: `bounds-error-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "参与范围校验",
    startDate: "2026-10-01",
  });
  const snapshot = await call<TripSnapshot>(page, `/trips/${trip.id}`),
    person = snapshot.participants[0].id;
  const early = await call<{ id: string }>(
    page,
    `/days/${snapshot.days[0].id}/items`,
    "POST",
    { title: "早期安排" },
  );
  const later = await call<{ id: string }>(
    page,
    `/days/${snapshot.days[0].id}/items`,
    "POST",
    { title: "实际加入点" },
  );
  const latest = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  await call(page, `/trips/${trip.id}/participation`, "POST", {
    participantId: person,
    joinItemId: later.id,
    expectedDays: latest.days.map((d) => ({
      id: d.id,
      expectedVersion: d.version,
    })),
  });
  await page.goto(`/trips/${trip.id}/plan`);
  await page
    .getByTestId(`item-${early.id}`)
    .getByRole("button", { name: /谁参加/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "谁参加", exact: true });
  await dialog.getByText("设置加入与离开", { exact: true }).click();
  await dialog.getByLabel("给谁设置参与范围").selectOption(person);
  await dialog
    .getByRole("button", { name: "此项结束后离开", exact: true })
    .click();
  await expect(dialog).toContainText("不能早于加入点");
  await expect(dialog).toContainText("实际加入点");
  await dialog.getByLabel("参加人员").selectOption("selected");
  await expect(
    dialog.getByRole("button", { name: "从此处加入", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText("请先保存当前事项的人员选择");
  const saved = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  expect(
    saved.days[0].items.find((i) => i.id === later.id)?.joinParticipantIds,
  ).toEqual([person]);
  expect(
    saved.days[0].items.find((i) => i.id === early.id)?.leaveParticipantIds,
  ).toBeNull();
});
