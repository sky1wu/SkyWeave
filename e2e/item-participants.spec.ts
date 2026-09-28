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
  await expect(
    page.getByRole("menuitem", {
      name: /设置参与者|从这里分头行动|在这里集合|移入某组路线/,
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", {
      name: "广州飞西安：谁参加，全部同行者",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("谁参加");
  await expect(dialog.getByLabel("出发时间", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("行动段名称")).toHaveCount(0);
  await dialog.getByLabel("参加人员").selectOption("selected");
  await dialog.getByRole("button", { name: "保存参与者", exact: true }).click();
  await expect(dialog).toContainText("请至少选择一位参与者");
  await dialog.getByRole("checkbox", { name: "甲", exact: true }).check();
  await dialog.getByRole("checkbox", { name: "乙", exact: true }).check();
  const saveRequest = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      request.url().endsWith(`/api/items/${flight.id}`),
  );
  await dialog.getByRole("button", { name: "保存参与者", exact: true }).click();
  expect(Object.keys((await saveRequest).postDataJSON()).sort()).toEqual([
    "expectedVersion",
    "participantIds",
  ]);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId(`item-${flight.id}`)).toContainText("甲、乙");
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
  await page
    .getByTestId(`item-${flight.id}`)
    .screenshot({ path: testInfo.outputPath("participants-card.png") });
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
    .getByRole("button", { name: /广州飞西安：谁参加/ })
    .click();
  await expect(
    dialog.getByRole("checkbox", { name: "甲", exact: true }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "丙", exact: true }),
  ).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sw-mobile-sheet")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await dialog
    .getByRole("group", { name: "谁参加", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("participants-mobile.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "保存参与者", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Ordinary activities use the same selection without changing groups.
  await page
    .getByTestId(`item-${end.id}`)
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await dialog.getByLabel("参加人员").selectOption("selected");
  await dialog.getByRole("checkbox", { name: "丙", exact: true }).check();
  await dialog.getByRole("button", { name: "保存事项", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("查看谁的行程").selectOption(other.id);
  await expect(page.getByTestId(`item-${end.id}`)).toContainText("丙");
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

test("组内事项清楚显示继承与部分成员，人员弹窗支持取消和冲突恢复", async ({
  page,
}, testInfo) => {
  await registerViaApi(page, {
    name: "甲",
    email: `group-people-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "组内谁参加",
    startDate: "2026-10-07",
  });
  const initial = await call<TripSnapshot>(page, `/trips/${trip.id}`),
    dayId = initial.days[0].id;
  const other = await call<{ id: string }>(
    page,
    `/trips/${trip.id}/participants`,
    "POST",
    { name: "乙" },
  );
  const third = await call<{ id: string }>(
    page,
    `/trips/${trip.id}/participants`,
    "POST",
    { name: "丙" },
  );
  const branches = [
    {
      id: crypto.randomUUID(),
      title: "家人组",
      participantIds: [initial.participants[0].id, other.id],
      startMinutes: null,
    },
    {
      id: crypto.randomUUID(),
      title: "独行组",
      participantIds: [third.id],
      startMinutes: null,
    },
  ];
  await call(page, `/days/${dayId}/items`, "POST", {
    title: "下午分头",
    type: "parallel",
    parallelPlan: {
      splitItemId: null,
      joinItemId: null,
      joinPolicy: "wait_all",
      branches,
    },
  });
  const item = await call<{ id: string }>(
    page,
    `/days/${dayId}/items`,
    "POST",
    { title: "参观博物馆", branchId: branches[0].id, notes: "原有说明" },
  );
  await page.goto(`/trips/${trip.id}/plan`);
  const card = page.getByTestId(`item-${item.id}`),
    picker = card.getByRole("button", { name: /参观博物馆：谁参加/ }),
    dialog = page.getByRole("dialog", { name: "谁参加", exact: true });
  await expect(picker).toContainText("本组全部成员");
  await expect(picker).toContainText("跟随「家人组」");
  await picker.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("参加人员").selectOption("selected");
  await expect(
    dialog.getByRole("checkbox", { name: "丙", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "甲", exact: true }).check();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(picker).toBeFocused();
  await expect(picker).toContainText("本组全部成员");
  await picker.click();
  await dialog.getByLabel("参加人员").selectOption("selected");
  await dialog.getByRole("checkbox", { name: "甲", exact: true }).check();
  await dialog.getByRole("button", { name: "保存参与者", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(picker).toContainText("本组部分成员");
  await card.screenshot({
    path: testInfo.outputPath("group-partial-members.png"),
  });
  const saved = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  expect(saved.days[0].items.find((i) => i.id === item.id)?.notes).toBe(
    "原有说明",
  );
  expect(
    saved.days[0].items.find((i) => i.parallelPlan)?.parallelPlan?.branches,
  ).toEqual(branches);
  await picker.click();
  await dialog.getByLabel("参加人员").selectOption("all");
  await dialog.getByRole("button", { name: "保存参与者", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(picker).toContainText("跟随「家人组」");
  const restored = await call<TripSnapshot>(page, `/trips/${trip.id}`),
    current = restored.days[0].items.find((i) => i.id === item.id)!;
  expect(current.participantIds).toBeNull();
  await picker.click();
  await dialog.getByLabel("参加人员").selectOption("selected");
  await dialog.getByRole("checkbox", { name: "乙", exact: true }).check();
  await call(page, `/items/${item.id}`, "PATCH", {
    expectedVersion: current.version,
    notes: "协作者的新说明",
  });
  await dialog.getByRole("button", { name: "保存参与者", exact: true }).click();
  await expect(dialog).toContainText("此内容已被其他成员修改");
  await expect(
    dialog.getByRole("checkbox", { name: "乙", exact: true }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.reload();
  await expect(card).toContainText("协作者的新说明");
  await expect(picker).toContainText("本组全部成员");
});

test("第三天加入的两组人员不会出现在前两天的谁参加摘要中", async ({
  page,
}, testInfo) => {
  await registerViaApi(page, {
    name: "全程成员",
    email: `attendance-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "第三天三组集合",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
  });
  const initial = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  const a = await call<{ id: string }>(
    page,
    `/trips/${trip.id}/participants`,
    "POST",
    { name: "第二组成员" },
  );
  const b = await call<{ id: string }>(
    page,
    `/trips/${trip.id}/participants`,
    "POST",
    { name: "第三组成员" },
  );
  const first = await call<{ id: string }>(
    page,
    `/days/${initial.days[0].id}/items`,
    "POST",
    { title: "第一天活动" },
  );
  const second = await call<{ id: string }>(
    page,
    `/days/${initial.days[1].id}/items`,
    "POST",
    { title: "第二天活动" },
  );
  const meet = await call<{ id: string }>(
    page,
    `/days/${initial.days[2].id}/items`,
    "POST",
    { title: "第三天集合" },
  );
  const people = [initial.participants[0].id, a.id, b.id];
  const branches = people.map((id, index) => ({
    id: crypto.randomUUID(),
    title: `${index + 1} 组`,
    participantIds: [id],
    startMinutes: null,
    ...(index ? { entrants: [{ participantId: id, at: "departure" }] } : {}),
  }));
  const snapshot = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  await call(page, `/trips/${trip.id}/parallel`, "POST", {
    dayId: initial.days[2].id,
    title: "三组分头",
    expectedDays: snapshot.days.map((d) => ({
      id: d.id,
      expectedVersion: d.version,
    })),
    parallelPlan: {
      splitItemId: null,
      joinItemId: meet.id,
      joinPolicy: "wait_all",
      branches,
    },
    departures: branches.map((branch, index) => ({
      branchId: branch.id,
      source: {
        kind: "place",
        place: { title: `${index + 1} 组出发地`, lat: 22, lng: 114 },
      },
    })),
  });
  await page.goto(`/trips/${trip.id}/plan`);
  for (const id of [first.id, second.id]) {
    const summary = page
      .getByTestId(`item-${id}`)
      .locator(".item-participant-summary");
    await expect(summary).toContainText("全程成员");
    await expect(summary).not.toContainText("全部同行者");
    await expect(summary).not.toContainText("第二组成员");
    await expect(summary).not.toContainText("第三组成员");
  }
  await page
    .getByTestId(`item-${first.id}`)
    .getByRole("button", { name: /谁参加/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "谁参加", exact: true });
  await expect(dialog.getByLabel("参加人员")).toHaveValue("all");
  await expect(dialog).toContainText("实际参加：全程成员");
  await expect(dialog.locator(".item-participants-field")).not.toContainText(
    "第二组成员",
  );
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByTestId(`item-${first.id}`).screenshot({
    path: testInfo.outputPath("actual-attendees-before-joining.png"),
  });
  await page.getByLabel("查看谁的行程").selectOption(a.id);
  await expect(page.getByTestId(`item-${first.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`item-${second.id}`)).toHaveCount(0);
  await page.getByLabel("查看谁的行程").selectOption("");
  await page
    .locator(".day-tabs")
    .getByRole("button", { name: /第 3 天/ })
    .click();
  const meeting = page.getByTestId(`item-${meet.id}`);
  await expect(meeting.locator(".item-participant-summary")).toContainText(
    "全部同行者",
  );
  const after = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  expect(
    after.days[0].items.find((i) => i.id === first.id)?.participantIds,
  ).toBeNull();
});
