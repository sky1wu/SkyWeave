import { test, expect, type Page } from "@playwright/test";
import type { TripSnapshot } from "../src/domain/types";
import { submitRegistrationForm } from "./registration";
const origin = "http://127.0.0.1:3100";
async function register(page: Page, name: string) {
  await page.goto(`${origin}/register`);
  await page.getByLabel("昵称").fill(name);
  await page
    .getByLabel("邮箱")
    .fill(`${name.toLowerCase()}-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("密码").fill("Trip-test-password-2026");
  await submitRegistrationForm(page);
}
async function call<T>(
  page: Page,
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await page.request.fetch(`${origin}/api${path}`, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    ...(data !== undefined ? { data } : {}),
  });
  expect(
    response.ok(),
    `${method} ${path}: ${await response.text()}`,
  ).toBeTruthy();
  return (await response.json()) as T;
}
async function createTrip(page: Page, title: string) {
  await page.getByRole("button", { name: "创建行程", exact: true }).click();
  await page.getByLabel("行程名称").fill(title);
  await page.getByLabel("开始日期").fill("2026-10-02");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建行程", exact: true })
    .click();
  await expect(page).toHaveURL(/\/trips\/[^/]+\/plan/);
  return page.url().split("/").at(-2)!;
}
async function setTripDays(page: Page, tripId: string, count: number) {
  await page.getByRole("button", { name: "行程设置", exact: true }).click();
  await page.getByLabel("行程天数", { exact: true }).fill(String(count));
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect
    .poll(
      async () =>
        (await call<TripSnapshot>(page, `/trips/${tripId}`)).days.length,
    )
    .toBe(count);
  return (await call<TripSnapshot>(page, `/trips/${tripId}`)).days.at(-1)!;
}
async function searchAdd(page: Page, name: string) {
  await page.getByLabel("搜索地点", { exact: true }).fill(name);
  await page
    .locator(".search-results button")
    .filter({ hasText: name })
    .first()
    .click();
  const poolEntry = page
    .locator(".pool-entry")
    .filter({ has: page.locator(".pool-place-title", { hasText: name }) });
  await expect(poolEntry).toBeVisible();
  await poolEntry
    .getByRole("button", { name: new RegExp(`安排 ${name} 到`) })
    .click();
  await expect(
    page.locator(".item-title").filter({ hasText: name }),
  ).toBeVisible();
}
async function ready(page: Page, tripId: string) {
  await expect
    .poll(async () => {
      const s = await call<TripSnapshot>(page, `/trips/${tripId}`);
      return s.days[0].legs.every(
        (l) => l.mode === "manual" || l.status === "ready",
      );
    })
    .toBe(true);
  await expect(page.getByText("算路中", { exact: true })).not.toBeVisible();
}

test("西安：搜索、四种交通、候选切换、键盘排序、手机视口与刷新", async ({
  page,
}) => {
  await register(page, "Xian");
  const id = await createTrip(page, "西安周末慢游");
  for (const name of ["西安酒店", "西安SKP", "大唐不夜城", "大雁塔", "钟楼"])
    await searchAdd(page, name);
  await ready(page, id);
  const legs = page.locator(".leg-card");
  await legs.first().getByRole("button").first().click();
  await legs.first().getByLabel("交通方式").selectOption("walking");
  await ready(page, id);
  await legs.nth(1).getByRole("button").first().click();
  await legs.nth(1).getByLabel("交通方式").selectOption("driving");
  await ready(page, id);
  await legs.nth(2).getByRole("button").first().click();
  await legs.nth(2).getByLabel("交通方式").selectOption("cycling");
  await ready(page, id);
  await legs.nth(3).getByRole("button").first().click();
  const useSecond = legs.nth(3).getByRole("button", { name: "使用方案 2" });
  await useSecond.click();
  const selected = await call<TripSnapshot>(page, `/trips/${id}`);
  const transit = selected.days[0].legs.find((l) => l.mode === "transit")!;
  await expect(page.getByTestId(`map-leg-${transit.id}`)).toHaveAttribute(
    "data-alternative",
    transit.alternatives[1].id,
  );
  const handle = page.getByRole("button", {
    name: "拖动 西安SKP",
    exact: true,
  });
  await handle.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect
    .poll(async () =>
      (await call<TripSnapshot>(page, `/trips/${id}`)).days[0].items
        .map((i) => i.title)
        .indexOf("西安SKP"),
    )
    .toBe(2);
  await page.reload();
  await expect(page.locator(".item-title")).toHaveCount(5);
  await ready(page, id);
  const beforeDrag = await call<TripSnapshot>(page, `/trips/${id}`);
  const firstId = beforeDrag.days[0].items[0].id;
  // Start on the card surface, away from the dedicated keyboard handle.
  const dragHandle = await page.locator(".timeline-item").first().boundingBox();
  const dropItem = await page.locator(".timeline-item").nth(1).boundingBox();
  expect(dragHandle).not.toBeNull();
  expect(dropItem).not.toBeNull();
  await page.mouse.move(dragHandle!.x + 7, dragHandle!.y + 7);
  await page.mouse.down();
  await page.mouse.move(dragHandle!.x + 7, dragHandle!.y + 20, { steps: 3 });
  await page.mouse.move(dropItem!.x + 15, dropItem!.y + 45, { steps: 15 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await call<TripSnapshot>(page, `/trips/${id}`)).days[0].items[1].id,
    )
    .toBe(firstId);
  await ready(page, id);
  await page.screenshot({
    path: "test-results/xian-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".mobile-switch")
    .getByRole("button", { name: "地点池", exact: true })
    .click();
  await expect(page.getByLabel("搜索地点", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".mobile-switch")
    .getByRole("button", { name: "地图" })
    .click();
  await expect(page.getByTestId("test-map")).toBeVisible();
  await page.screenshot({
    path: "test-results/xian-mobile.png",
    fullPage: true,
  });
});

test("深圳—香港：手动过关、固定活动迟到、同址活动与跨午夜返程", async ({
  page,
}) => {
  await register(page, "HongKong");
  const id = await createTrip(page, "香港 Girls Band Cry");
  let s = await call<TripSnapshot>(page, `/trips/${id}`);
  const dayId = s.days[0].id;
  await call(page, `/days/${dayId}`, "PATCH", {
    expectedVersion: s.days[0].version,
    startMinutes: 660,
  });
  const places = await call<{
    places: {
      amapPoiId: string;
      name: string;
      lat: number;
      lng: number;
      address: string;
    }[];
  }>(page, "/places/search?q=" + encodeURIComponent("口岸"));
  expect(places.places.length).toBeGreaterThan(0);
  const names = [
    "电玩鲸电竞民宿（深圳皇岗口岸店）",
    "福田口岸",
    "落马洲站",
    "INCUBASE Arena",
    "MUJI 旺角",
    "星光大道",
    "中环",
    "AsiaWorld-Expo",
    "皇岗口岸",
  ];
  for (const name of names) {
    const place = (
      await call<{
        places: {
          amapPoiId: string;
          name: string;
          lat: number;
          lng: number;
          address: string;
        }[];
      }>(page, `/places/search?q=${encodeURIComponent(name)}`)
    ).places[0];
    await call(page, `/days/${dayId}/items`, "POST", {
      title: name,
      amapPoiId: place.amapPoiId,
      lat: place.lat,
      lng: place.lng,
      address: place.address,
      type:
        name === "福田口岸"
          ? "border"
          : name.includes("INCUBASE") || name.includes("Expo")
            ? "event"
            : name.includes("民宿")
              ? "hotel"
              : "place",
      stayMinutes: name === "福田口岸" ? 30 : 0,
      ...(name.includes("INCUBASE")
        ? { fixedTime: true, startMinutes: 720, endMinutes: 780 }
        : {}),
      ...(name.includes("Expo")
        ? {
            fixedTime: true,
            startMinutes: 1050,
            endMinutes: 1410,
            notes: "17:30 入场，19:00 LIVE；23:30 为测试返程时间",
          }
        : {}),
    });
  }
  s = await call<TripSnapshot>(page, `/trips/${id}`);
  const border = s.days[0].legs.find(
    (l) =>
      s.days[0].items.find((i) => i.id === l.fromItemId)?.title === "福田口岸",
  )!;
  await call(page, `/legs/${border.id}`, "PATCH", {
    expectedVersion: border.version,
    mode: "manual",
    manualDurationMinutes: 0,
    manualDescription: "过关等待 30 分钟已计入福田口岸事项，避免重复计算",
  });
  const first = s.days[0].legs.find(
    (l) => l.fromItemId === s.days[0].items[0].id,
  )!;
  await call(page, `/legs/${first.id}`, "PATCH", {
    expectedVersion: first.version,
    mode: "walking",
  });
  await page.reload();
  await ready(page, id);
  await expect(page.getByText(/预计迟到/).first()).toBeVisible();
  await expect(page.getByText("次日 00:12", { exact: true })).toBeVisible();
  await expect(page.locator(".manual-leg")).toContainText("手动");
  await page.getByRole("button", { name: "INCUBASE Arena 更多操作" }).click();
  await page.getByRole("menuitem", { name: "复制事项", exact: true }).click();
  await expect(
    page.locator(".item-title").filter({ hasText: "INCUBASE Arena（副本）" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".item-title")).toHaveCount(10);
  await page.screenshot({
    path: "test-results/hongkong-desktop.png",
    fullPage: true,
  });
});

test("同行者：添加后可取消或确认删除，保留已有账目", async ({ page }) => {
  await register(page, "GuestOwner");
  const id = await createTrip(page, "同行者删除验收");
  await page.getByRole("link", { name: "成员", exact: true }).click();
  await page.getByRole("button", { name: "添加同行者", exact: true }).click();
  await page.getByLabel("同行者姓名").fill("误添加的同行者");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加同行者", exact: true })
    .click();
  const card = page
    .locator(".member-card")
    .filter({ hasText: "误添加的同行者" });
  await expect(card).toBeVisible();
  const snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  const guest = snapshot.participants.find((p) => !p.userId)!;
  const invite = await call<{ token: string }>(
    page,
    `/trips/${id}/invites`,
    "POST",
    {
      participantId: guest.id,
    },
  );
  await card.getByRole("button", { name: "删除同行者", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "确认删除" });
  await expect(confirmation).toContainText("误添加的同行者");
  await expect(confirmation).toContainText("专属邀请链接将一并失效");
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(card).toBeVisible();
  expect(
    (await call<TripSnapshot>(page, `/trips/${id}`)).participants,
  ).toHaveLength(2);
  await card.getByRole("button", { name: "删除同行者", exact: true }).click();
  await confirmation.getByRole("button", { name: "删除", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".member-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "删除同行者" })).toHaveCount(0);
  const after = await call<TripSnapshot>(page, `/trips/${id}`);
  expect(after.participants).toHaveLength(1);
  expect(after.invites).toHaveLength(0);
  const rejectedInvite = await page.request.post(
    `${origin}/api/invites/${invite.token}/join`,
    {
      headers: { Origin: origin },
      data: {},
    },
  );
  expect(rejectedInvite.status()).toBe(404);

  const payer = await call<{ id: string }>(
    page,
    `/trips/${id}/participants`,
    "POST",
    {
      name: "有账目的同行者",
    },
  );
  await call(page, `/trips/${id}/expenses`, "POST", {
    title: "晚餐",
    category: "food",
    amountMinor: 100,
    currency: "CNY",
    exchangeRateToBase: "1",
    payerParticipantId: payer.id,
    splitMethod: "equal",
    splitMeta: [{ participantId: payer.id, value: "1" }],
    incurredAt: Date.now(),
  });
  await page.reload();
  const payerCard = page
    .locator(".member-card")
    .filter({ hasText: "有账目的同行者" });
  await payerCard
    .getByRole("button", { name: "删除同行者", exact: true })
    .click();
  await confirmation.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "请改用停用",
  );
  await expect(payerCard).toBeVisible();
  await expect(
    payerCard.getByRole("button", { name: "删除同行者" }),
  ).toBeEnabled();
  await payerCard.getByRole("button", { name: "停用", exact: true }).click();
  await expect(payerCard).toContainText("已停用 · 历史账目保留");
  const retained = await call<TripSnapshot>(page, `/trips/${id}`);
  expect(retained.expenses).toHaveLength(1);
  expect(retained.expenses[0].payerParticipantId).toBe(payer.id);
  expect(retained.expenses[0].splits[0].participantId).toBe(payer.id);
});

test("多人：邀请、SSE 双向修改、费用分摊、editor 结算、评论与持久化", async ({
  page,
  browser,
}) => {
  await register(page, "Alice");
  const id = await createTrip(page, "一起去香港");
  await page.getByRole("link", { name: "成员", exact: true }).click();
  await page.getByRole("button", { name: "添加同行者", exact: true }).click();
  await page.getByLabel("同行者姓名").fill("Carol");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加同行者", exact: true })
    .click();
  await page.getByRole("button", { name: "邀请朋友", exact: true }).click();
  await page.getByRole("button", { name: "生成邀请链接" }).click();
  const invite = await page.getByLabel("邀请链接").inputValue();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const contextB = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const b = await contextB.newPage();
  await register(b, "Bob");
  await b.goto(invite);
  await b.getByRole("button", { name: "接受邀请", exact: true }).click();
  await expect(b).toHaveURL(`${origin}/trips/${id}/plan`);
  await page.getByRole("link", { name: "行程", exact: true }).click();
  await searchAdd(page, "INCUBASE Arena");
  await expect(b.locator(".item-title")).toHaveText("INCUBASE Arena");
  await b
    .locator(".timeline-item")
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await b
    .getByLabel("名称", { exact: true })
    .fill("INCUBASE Arena · Bob 已确认");
  await b.getByRole("button", { name: "保存事项", exact: true }).click();
  await expect(page.locator(".item-title")).toHaveText(
    "INCUBASE Arena · Bob 已确认",
  );
  await page
    .locator(".item-quick-actions")
    .getByRole("button", { name: "＋记一笔", exact: true })
    .click();
  await page.getByLabel("费用名称").fill("三人晚餐");
  await page.getByLabel("费用金额").fill("600");
  await page
    .getByRole("dialog")
    .getByLabel("币种", { exact: true })
    .selectOption("HKD");
  await page.getByLabel("汇率", { exact: true }).fill("0.9");
  await page.getByRole("button", { name: "保存费用", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  let s = await call<TripSnapshot>(page, `/trips/${id}`);
  expect(s.expenses[0].baseAmountMinor).toBe(54000);
  expect(s.expenses[0].splits.map((x) => x.baseAmountMinor)).toEqual([
    18000, 18000, 18000,
  ]);
  await b.getByRole("link", { name: "费用", exact: true }).click();
  await expect(b.getByText("三人晚餐", { exact: true })).toBeVisible();
  const suggestion = b
    .locator(".settlement-row")
    .filter({ hasText: "Bob" })
    .first();
  await suggestion
    .getByRole("button", { name: "登记转账", exact: true })
    .click();
  await b.getByRole("button", { name: "确认已转账", exact: true }).click();
  s = await call<TripSnapshot>(page, `/trips/${id}`);
  expect(s.settlements).toHaveLength(1);
  expect(s.settlements[0].baseAmountMinor).toBe(18000);
  await page.getByRole("link", { name: "动态", exact: true }).click();
  await page.getByLabel("评论内容").fill("大家在入口集合");
  await page.getByRole("button", { name: "发表评论", exact: true }).click();
  await expect(page.getByText("大家在入口集合", { exact: true })).toBeVisible();
  await page.reload();
  s = await call<TripSnapshot>(page, `/trips/${id}`);
  expect(s.members).toHaveLength(2);
  expect(s.participants).toHaveLength(3);
  expect(s.expenses).toHaveLength(1);
  expect(s.settlements).toHaveLength(1);
  expect(s.comments).toHaveLength(1);
  await b.screenshot({
    path: "test-results/expenses-desktop.png",
    fullPage: true,
  });
  await contextB.close();
});

test("权限和实时恢复：viewer 不可修改，断线后补齐变化，移除成员即撤权", async ({
  page,
  browser,
}) => {
  await register(page, "Owner");
  const id = await createTrip(page, "协作权限验收");
  const link = await call<{ token: string }>(
    page,
    `/trips/${id}/invites`,
    "POST",
    { role: "viewer", maxUses: 1 },
  );
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const viewer = await context.newPage();
  await register(viewer, "Viewer");
  await call(viewer, `/invites/${link.token}/join`, "POST", {});
  await viewer.goto(`${origin}/trips/${id}/plan`);
  await expect(
    viewer.getByLabel("搜索地点", { exact: true }),
  ).not.toBeVisible();
  const snap = await call<TripSnapshot>(page, `/trips/${id}`);
  const day = snap.days[0];
  const denied = await viewer.request.post(
    `${origin}/api/days/${day.id}/items`,
    { headers: { Origin: origin }, data: { title: "越权添加" } },
  );
  expect(denied.status()).toBe(403);
  const wrongOrigin = await page.request.post(
    `${origin}/api/days/${day.id}/items`,
    {
      headers: { Origin: "https://other.example.test" },
      data: { title: "非法来源" },
    },
  );
  expect(wrongOrigin.status()).toBe(403);
  await context.setOffline(true);
  await call(page, `/days/${day.id}/items`, "POST", {
    title: "断线期间新增事项",
    type: "note",
  });
  await context.setOffline(false);
  await expect(viewer.locator(".item-title")).toHaveText("断线期间新增事项");
  const member = (await call<TripSnapshot>(page, `/trips/${id}`)).members.find(
    (m) => m.role === "viewer",
  )!;
  await call(page, `/trips/${id}/members/${member.userId}`, "PATCH", {
    expectedVersion: member.version,
    status: "inactive",
  });
  await expect(
    viewer.getByText("你已没有访问此行程的权限", { exact: true }),
  ).toBeVisible();
  const blocked = await viewer.request.get(`${origin}/api/trips/${id}`);
  expect(blocked.status()).toBe(404);
  await context.close();
});

test("地点池、自动日期、连续滚动、路线聚焦和关联账单", async ({ page }) => {
  await register(page, "PoolPlanner");
  const id = await createTrip(page, "连续规划验收");
  let snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  const first = snapshot.days[0].id;
  await setTripDays(page, id, 2);
  await expect
    .poll(
      async () => (await call<TripSnapshot>(page, `/trips/${id}`)).days.length,
    )
    .toBe(2);
  snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  const second = snapshot.days[1].id;
  expect(snapshot.days[1].date).toBe("2026-10-03");
  await page
    .locator(".day-tabs")
    .getByRole("button", { name: /第 1 天/ })
    .click();
  await page.getByLabel("搜索地点", { exact: true }).fill("西安SKP");
  await page.getByRole("button", { name: "收藏 西安SKP", exact: true }).click();
  await expect(page.locator(".pool-entry")).toHaveCount(1);
  expect(
    (await call<TripSnapshot>(page, `/trips/${id}`)).days.flatMap(
      (d) => d.items,
    ),
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "编辑地点池 西安SKP", exact: true })
    .click();
  await page.getByRole("combobox", { name: "地点分类", exact: true }).click();
  await page.getByLabel("搜索地点分类", { exact: true }).fill("购物清单");
  await page
    .getByRole("option", { name: "使用“购物清单”", exact: true })
    .click();
  await page.getByRole("button", { name: "保存地点", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const poolHandle = await page.locator(".pool-entry").boundingBox();
  const drop = await page.locator(`[data-day-end="${first}"]`).boundingBox();
  expect(poolHandle).not.toBeNull();
  expect(drop).not.toBeNull();
  await page.mouse.move(poolHandle!.x + 7, poolHandle!.y + 7);
  await page.mouse.down();
  await page.mouse.move(poolHandle!.x + 16, poolHandle!.y + 12, { steps: 3 });
  await page.mouse.move(drop!.x + drop!.width / 2, drop!.y + drop!.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await call<TripSnapshot>(page, `/trips/${id}`)).days[0].items.length,
    )
    .toBe(1);
  snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  expect(snapshot.poolPlaces).toHaveLength(1);
  expect(snapshot.days[0].items[0].placeCategory).toBe("购物清单");
  await expect(page.locator(".pool-entry")).toContainText("已安排 1 次");
  // dnd-kit suppresses click propagation for 50ms after a pointer drop.
  await page.waitForTimeout(60);
  await page
    .locator(".day-tabs")
    .getByRole("button", { name: /第 2 天/ })
    .click();
  await page
    .getByRole("button", { name: "安排 西安SKP 到第 2 天", exact: true })
    .click();
  await expect(page.locator(".pool-entry")).toContainText("已安排 2 次");
  for (let n = 0; n < 9; n++)
    await call(page, `/days/${first}/items`, "POST", {
      title: `备注 ${n + 1}`,
      type: "note",
    });
  await expect(page.locator(`#day-${first} .timeline-item`)).toHaveCount(10);
  const searchTop = (await page
    .getByLabel("搜索地点", { exact: true })
    .boundingBox())!.y;
  const scroll = page.locator(".continuous-timeline");
  await scroll.hover();
  await page.mouse.wheel(0, 10000);
  await expect(page.locator(".trip-map")).toHaveAttribute(
    "data-map-day",
    second,
  );
  expect(
    (await page.getByLabel("搜索地点", { exact: true }).boundingBox())!.y,
  ).toBe(searchTop);
  await page.mouse.wheel(0, -10000);
  await expect(page.locator(".trip-map")).toHaveAttribute(
    "data-map-day",
    first,
  );
  const workspace = await page.locator(".floating-workspace").boundingBox();
  expect(workspace!.y).toBeLessThan(110);
  const place = await call<{ id: string }>(
    page,
    `/trips/${id}/places`,
    "POST",
    { title: "固定活动", lat: 22.32, lng: 114.18, placeCategory: "活动" },
  );
  snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  const fixed = await call<{ id: string }>(
    page,
    `/trips/${id}/places/${place.id}/schedule`,
    "POST",
    {
      dayId: first,
      beforeItemId: snapshot.days[0].items[1].id,
      expectedVersion: 1,
      expectedDayVersion: snapshot.days[0].version,
    },
  );
  snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  const eventItem = snapshot.days[0].items.find((i) => i.id === fixed.id)!;
  await call(page, `/items/${fixed.id}`, "PATCH", {
    expectedVersion: eventItem.version,
    fixedTime: true,
    startMinutes: 720,
    endMinutes: 780,
  });
  snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  await call(page, `/days/${first}`, "PATCH", {
    expectedVersion: snapshot.days[0].version,
    startMinutes: 660,
  });
  await ready(page, id);
  await expect(page.locator(".timeline-item .fixed-arrival")).toContainText(
    "距开始还剩 18 分钟",
  );
  snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  const leg = snapshot.days[0].legs[0];
  await page.locator(`[data-leg-id="${leg.id}"] .leg-summary`).click();
  await expect(page.locator(".trip-map")).toHaveAttribute(
    "data-focused-leg",
    leg.id,
  );
  await expect(
    page.getByRole("img", { name: "测试地图", exact: true }),
  ).not.toHaveAttribute("viewBox", "0 0 700 600");
  await page.getByRole("button", { name: "使用方案 2", exact: true }).click();
  await expect(page.locator(".leg-card .fixed-arrival")).toContainText(
    "距开始还剩 14 分钟",
  );
  const payer = snapshot.participants[0].id;
  await call(page, `/trips/${id}/expenses`, "POST", {
    title: "活动门票",
    category: "ticket",
    amountMinor: 3000,
    currency: "CNY",
    exchangeRateToBase: "1",
    payerParticipantId: payer,
    splitMethod: "equal",
    splitMeta: [{ participantId: payer, value: "1" }],
    incurredAt: Date.now(),
    dayItemId: fixed.id,
  });
  const bill = page.locator(`#item-${fixed.id} .item-bill`);
  await expect(bill).toContainText("活动门票");
  await expect(bill).toContainText("30.00");
  await bill.click();
  await expect(
    page.getByRole("dialog", { name: "编辑费用", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .getByRole("button", { name: "固定活动 更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "移至后一天", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await call<TripSnapshot>(page, `/trips/${id}`)).expenses[0].dayId,
    )
    .toBe(second);
  await page.reload();
  snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  expect(snapshot.poolPlaces).toHaveLength(2);
  expect(snapshot.days[1].items.some((i) => i.id === fixed.id)).toBe(true);
});

test("地点卡片：整卡排序、筛选后移动、控件点击与刷新持久化", async ({
  page,
}) => {
  await register(page, "Cards");
  const id = await createTrip(page, "卡片操作");
  for (const [title, placeCategory] of [
    ["公园", "景点"],
    ["餐厅", "餐饮"],
    ["博物馆", "景点"],
  ])
    await call(page, `/trips/${id}/places`, "POST", { title, placeCategory });
  await expect(page.locator(".pool-entry")).toHaveCount(3);
  const mapRect = (await page.locator(".trip-map").boundingBox())!;
  const workspaceRect = (await page
    .locator(".floating-workspace")
    .boundingBox())!;
  expect(mapRect).toEqual(workspaceRect);
  await expect
    .poll(async () =>
      Number(
        (await page
          .locator(".trip-map")
          .getAttribute("data-map-insets"))!.split(",")[3],
      ),
    )
    .toBeGreaterThan(300);
  await page.getByLabel("筛选地点分类").selectOption("景点");
  await page.getByRole("button", { name: "折叠地点池", exact: true }).click();
  await expect(page.getByLabel("搜索地点", { exact: true })).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "展开地点池", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(async () =>
      Number(
        (await page
          .locator(".trip-map")
          .getAttribute("data-map-insets"))!.split(",")[3],
      ),
    )
    .toBe(40);
  await page.getByRole("button", { name: "折叠行程", exact: true }).click();
  await expect(page.locator(".continuous-timeline")).not.toBeVisible();
  await expect
    .poll(async () =>
      Number(
        (await page
          .locator(".trip-map")
          .getAttribute("data-map-insets"))!.split(",")[2],
      ),
    )
    .toBe(40);
  expect(await page.locator(".trip-map").boundingBox()).toEqual(mapRect);
  await page.getByRole("button", { name: "展开地点池", exact: true }).click();
  await expect(page.getByLabel("筛选地点分类")).toHaveValue("景点");
  await page.getByLabel("筛选地点分类").selectOption("");
  await page.getByRole("button", { name: "展开行程", exact: true }).click();
  const order = async () =>
    (await call<TripSnapshot>(page, `/trips/${id}`)).poolPlaces.map(
      (p) => p.title,
    );
  const first = (await page
    .locator(".pool-place-title")
    .first()
    .boundingBox())!;
  const third = (await page.locator(".pool-entry").nth(2).boundingBox())!;
  await page.mouse.move(first.x + 5, first.y + 8);
  await page.mouse.down();
  await page.mouse.move(first.x + 5, first.y + 22, { steps: 3 });
  await expect(page.locator(".planner-drag-preview")).toBeVisible();
  await page.mouse.move(third.x + 12, third.y + third.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
  await expect.poll(order).toEqual(["餐厅", "博物馆", "公园"]);
  await page.waitForTimeout(60);
  await page.getByLabel("筛选地点分类").selectOption("景点");
  await page
    .getByRole("button", { name: "拖动地点池 公园", exact: true })
    .focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(order).toEqual(["餐厅", "公园", "博物馆"]);
  await page.reload();
  await expect(page.locator(".pool-place-title")).toHaveText([
    "餐厅",
    "公园",
    "博物馆",
  ]);

  // Drag-like mouse movement on an action must never pick up its parent card.
  const edit = page.getByRole("button", {
    name: "编辑地点池 公园",
    exact: true,
  });
  await page.locator(".pool-entry").nth(1).hover();
  const editBox = (await edit.boundingBox())!;
  await page.mouse.move(editBox.x + 6, editBox.y + 6);
  await page.mouse.down();
  await page.mouse.move(editBox.x + 6, editBox.y + 50, { steps: 5 });
  await expect(page.locator(".planner-drag-preview")).not.toBeVisible();
  await page.mouse.up();
  await edit.click();
  await expect(page.getByRole("dialog", { name: "编辑地点" })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  // Cancel a whole-card drag without changing the saved order.
  const card = (await page.locator(".pool-entry").first().boundingBox())!;
  await page.mouse.move(card.x + 5, card.y + 8);
  await page.mouse.down();
  await page.mouse.move(card.x + 5, card.y + 30, { steps: 3 });
  await expect(page.locator(".planner-drag-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".planner-drag-preview")).not.toBeVisible();
  expect(await order()).toEqual(["餐厅", "公园", "博物馆"]);
});

test("手机卡片：滑动滚动、长按排序与取消", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await register(page, "TouchCards");
    const id = await createTrip(page, "手机卡片");
    const snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
    for (let i = 1; i <= 7; i++)
      await call(page, `/days/${snapshot.days[0].id}/items`, "POST", {
        title: `地点 ${i}`,
        type: "note",
      });
    await expect(page.locator(".timeline-item")).toHaveCount(7);
    const order = async () =>
      (await call<TripSnapshot>(page, `/trips/${id}`)).days[0].items.map(
        (i) => i.title,
      );
    const client = await context.newCDPSession(page);
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
      x = 0,
      y = 0,
    ) =>
      client.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y }],
      });
    const pane = page.locator(".continuous-timeline");
    const initial = await order();
    const card = (await page.locator(".timeline-item").nth(1).boundingBox())!;
    await touch("touchStart", card.x + 5, card.y + 50);
    for (let i = 1; i <= 5; i++)
      await touch("touchMove", card.x + 5, card.y + 50 - i * 25);
    await touch("touchEnd");
    await expect
      .poll(() => pane.evaluate((e) => e.scrollTop))
      .toBeGreaterThan(20);
    expect(await order()).toEqual(initial);
    await expect(page.locator(".planner-drag-preview")).not.toBeVisible();
    // Scaling makes the mismatch between viewport and scroll coordinates
    // deterministic, instead of relying on mobile compositor timing.
    await pane.evaluate((element) => {
      element.style.transform = "scale(0.9)";
      element.style.transformOrigin = "top left";
    });
    await page.locator(".day-tabs button").first().click();
    await expect
      .poll(() => pane.evaluate((e) => e.scrollTop))
      .toBeLessThanOrEqual(2);
    await pane.evaluate((element) => {
      element.style.removeProperty("transform");
      element.style.removeProperty("transform-origin");
    });
    const start = (await page.locator(".timeline-item").first().boundingBox())!;
    const target = (await page.locator(".timeline-item").nth(1).boundingBox())!;
    await touch("touchStart", start.x + 5, start.y + 12);
    await expect(page.locator(".planner-drag-preview")).toBeVisible();
    for (let i = 1; i <= 8; i++)
      await touch(
        "touchMove",
        start.x + 5,
        start.y + 12 + ((target.y + target.height / 2 - start.y - 12) * i) / 8,
      );
    await touch("touchEnd");
    await expect.poll(order).toEqual(["地点 2", "地点 1", ...initial.slice(2)]);
    await page.waitForTimeout(60);
    const cancel = (await page
      .locator(".timeline-item")
      .first()
      .boundingBox())!;
    await touch("touchStart", cancel.x + 5, cancel.y + 12);
    await expect(page.locator(".planner-drag-preview")).toBeVisible();
    await touch("touchCancel");
    await expect(page.locator(".planner-drag-preview")).not.toBeVisible();
    await page.reload();
    await expect(page.locator(".item-title").first()).toHaveText("地点 2");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/cards-mobile.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("地图规划：未安排地点、常驻名称、分类图标和跨日安排状态", async ({
  page,
}) => {
  await register(page, "MapPlaces");
  const id = await createTrip(page, "地图地点池");
  for (const place of [
    { title: "待安排公园", placeCategory: "景点", lat: 22.55, lng: 114.0 },
    { title: "待安排餐厅", placeCategory: "餐饮", lat: 22.56, lng: 114.1 },
    { title: "未定位地点", placeCategory: "其他" },
  ])
    await call(page, `/trips/${id}/places`, "POST", place);
  const park = page.getByRole("button", {
    name: "未安排地点 待安排公园",
    exact: true,
  });
  const food = page.getByRole("button", {
    name: "未安排地点 待安排餐厅",
    exact: true,
  });
  await expect(park).toBeVisible();
  await expect(park.locator(".test-map-label")).toHaveText("待安排公园");
  await expect(food.locator(".test-map-label")).toHaveText("待安排餐厅");
  await expect(park).toHaveAttribute("data-icon", "sight");
  await expect(food).toHaveAttribute("data-icon", "food");
  await expect(
    page.getByRole("button", { name: "未安排地点 未定位地点", exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("筛选地点分类").selectOption("餐饮");
  await page.getByRole("button", { name: "折叠地点池", exact: true }).click();
  await park.click();
  await expect(
    page.getByRole("button", { name: "折叠地点池", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".pool-entry.selected .pool-place-title"),
  ).toHaveText("待安排公园");
  await page
    .getByRole("button", { name: "安排 待安排公园 到第 1 天", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "地图地点 待安排公园", exact: true }),
  ).toBeVisible();
  await expect(park).not.toBeVisible();
  await expect(food).toBeVisible();
  await setTripDays(page, id, 2);
  await page
    .locator(".day-tabs")
    .getByRole("button", { name: /第 2 天/ })
    .click();
  await expect(
    page.getByRole("button", { name: "地图地点 待安排公园", exact: true }),
  ).not.toBeVisible();
  await expect(park).not.toBeVisible();
  await expect(food).toBeVisible();
  await page.reload();
  await expect(food.locator(".test-map-label")).toHaveText("待安排餐厅");
});

test("独立交通：暂定城市、补齐车站班次、接驳路线、跨午夜和费用关联", async ({
  page,
}) => {
  await register(page, "Independent");
  const id = await createTrip(page, "火车与飞机");
  let snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  const dayId = snapshot.days[0].id;
  await call(page, `/days/${dayId}/items`, "POST", {
    title: "深圳酒店",
    type: "hotel",
    lat: 22.5,
    lng: 114.05,
  });
  await page
    .getByRole("button", { name: "向第 1 天添加交通", exact: true })
    .click();
  await page.getByLabel("出发地名称", { exact: true }).fill("深圳");
  await page.getByLabel("到达地名称", { exact: true }).fill("北京");
  await page.getByLabel("名称（可选）", { exact: true }).fill("北上火车");
  await page.getByRole("button", { name: "保存交通", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await call(page, `/days/${dayId}/items`, "POST", {
    title: "北京酒店",
    type: "hotel",
    lat: 39.9,
    lng: 116.4,
  });
  snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  const transport = snapshot.days[0].items.find((i) => i.transport)!;
  expect(transport.transport).toMatchObject({
    mode: "train",
    status: "tentative",
    origin: { name: "深圳", lat: null },
    destination: { name: "北京", lat: null },
  });
  expect(snapshot.days[0].legs).toHaveLength(0);
  const card = page.getByTestId(`item-${transport.id}`);
  await expect(card).toContainText("暂定");
  await expect(card.locator(".item-time")).toHaveText("待定");
  await expect(
    page.locator(".timeline-item").last().locator(".item-time"),
  ).toHaveText("待定");
  const start = await call<{ id: string }>(
    page,
    `/trips/${id}/places`,
    "POST",
    { title: "深圳北站", placeCategory: "交通", lat: 22.6, lng: 114.03 },
  );
  const end = await call<{ id: string }>(page, `/trips/${id}/places`, "POST", {
    title: "北京南站",
    placeCategory: "交通",
    lat: 39.86,
    lng: 116.38,
  });
  await card.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByLabel("从地点池选择出发地", { exact: true })
    .selectOption(start.id);
  await page
    .getByLabel("从地点池选择到达地", { exact: true })
    .selectOption(end.id);
  await page.getByLabel("班次（可选）", { exact: true }).fill("G1234");
  await page.getByLabel("确认状态", { exact: true }).selectOption("confirmed");
  await page.getByLabel("出发时间", { exact: true }).fill("09:00");
  await page.getByLabel("到达时间", { exact: true }).fill("15:00");
  await page.getByRole("button", { name: "保存交通", exact: true }).click();
  await ready(page, id);
  snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  expect(snapshot.days[0].legs).toHaveLength(2);
  expect(
    snapshot.days[0].legs.some(
      (l) => l.fromItemId === transport.id && l.toItemId === transport.id,
    ),
  ).toBe(false);
  await expect(card).toContainText("G1234");
  await expect(card).toContainText("已确认");
  await expect(card).toContainText("距出发还剩 18 分钟");
  // A horizontal SVG line has zero bounding-box height despite its visible stroke.
  await expect(
    page.getByTestId(`map-transport-${transport.id}`),
  ).toHaveAttribute("stroke-dasharray", "10 8");
  await expect(page.getByTestId(`map-transport-${transport.id}`)).toHaveCSS(
    "visibility",
    "visible",
  );
  await expect(
    page.getByRole("button", { name: "地图地点 深圳北站", exact: true }),
  ).toHaveAttribute("data-icon", "train");
  await expect(
    page.getByRole("button", { name: "未安排地点 深圳北站", exact: true }),
  ).not.toBeVisible();
  await expect(page.locator(".pool-entry").first()).toContainText(
    "已安排 1 次",
  );
  await expect(
    page.locator(".timeline-item").last().locator(".item-time"),
  ).toHaveText("15:42");
  await card.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("交通类型", { exact: true }).selectOption("flight");
  await page.getByLabel("出发时间", { exact: true }).fill("23:30");
  await page.getByLabel("到达时间日期", { exact: true }).selectOption("1");
  await page.getByLabel("到达时间", { exact: true }).fill("01:10");
  await page.getByRole("button", { name: "保存交通", exact: true }).click();
  await ready(page, id);
  await expect(card).toContainText("次日 01:10");
  await expect(
    page.getByRole("button", { name: "地图地点 深圳北站", exact: true }),
  ).toHaveAttribute("data-icon", "plane");
  snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  await call(page, `/trips/${id}/expenses`, "POST", {
    title: "交通票款",
    category: "transport",
    amountMinor: 50000,
    currency: "CNY",
    exchangeRateToBase: "1",
    payerParticipantId: snapshot.participants[0].id,
    splitMethod: "equal",
    splitMeta: [{ participantId: snapshot.participants[0].id, value: "1" }],
    incurredAt: Date.now(),
    dayItemId: transport.id,
  });
  await expect(card).toContainText("交通票款");
  const next = await setTripDays(page, id, 2);
  await expect(
    page.locator(".day-tabs button").filter({ hasText: "第 2 天" }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "北上火车 更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "移至后一天", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await call<TripSnapshot>(page, `/trips/${id}`)).days[1].items.length,
    )
    .toBe(1);
  snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  expect(snapshot.days[1].items[0].transport?.serviceNumber).toBe("G1234");
  expect(
    snapshot.expenses.find((e) => e.dayItemId === transport.id)?.dayId,
  ).toBe(next.id);
  await page
    .locator(".day-tabs")
    .getByRole("button", { name: /第 2 天/ })
    .click();
  await card.locator(".item-title").click();
  await expect(page.locator(".trip-map")).toHaveAttribute(
    "data-map-day",
    next.id,
  );
  await page.reload();
  await expect(page.getByTestId(`item-${transport.id}`)).toContainText(
    "交通票款",
  );
});

test("SkyWeave：精简排序、日历拖动、自动路线、分类和城市选择", async ({
  page,
}) => {
  await register(page, "SkyWeave");
  const id = await createTrip(page, "三日规划");
  await expect(page).toHaveTitle("SkyWeave");
  await setTripDays(page, id, 3);
  await expect(page.locator(".day-tab")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "添加一天", exact: true }),
  ).not.toBeVisible();
  let snap = await call<TripSnapshot>(page, `/trips/${id}`);
  const [first, second, third] = snap.days.map((d) => d.id);
  const a = await call<{ id: string }>(page, `/days/${first}/items`, "POST", {
    title: "地点 A",
    lat: 22.5,
    lng: 114.05,
    address: "A 地址",
  });
  const b = await call<{ id: string }>(page, `/days/${first}/items`, "POST", {
    title: "地点 B",
    lat: 22.6,
    lng: 114.15,
  });
  for (const [title, lat] of [
    ["地点 C", 22.7],
    ["地点 D", 22.8],
  ] as const)
    await call(page, `/days/${third}/items`, "POST", {
      title,
      lat,
      lng: 114.2,
    });
  // A non-active day's new route is calculated without opening that day.
  await expect
    .poll(async () =>
      (await call<TripSnapshot>(page, `/trips/${id}`)).days
        .filter((d) => d.legs.length)
        .every((d) => d.legs.every((l) => l.status === "ready")),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: /重新计算/ })).toHaveCount(0);
  await page.getByRole("button", { name: "全部折叠", exact: true }).click();
  await expect(page.locator(".timeline-item.compact")).toHaveCount(4);
  await expect(
    page
      .getByTestId(`item-${a.id}`)
      .getByRole("button", { name: "地点 A 更多操作", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByTestId(`item-${a.id}`).locator(".item-address"),
  ).not.toBeVisible();
  await expect(page.locator(".leg-card").first()).not.toBeVisible();
  const cardA = (await page.getByTestId(`item-${a.id}`).boundingBox())!,
    cardB = (await page.getByTestId(`item-${b.id}`).boundingBox())!;
  expect(cardA.height).toBeLessThanOrEqual(48);
  await page.mouse.move(cardA.x + 45, cardA.y + 18);
  await page.mouse.down();
  await page.mouse.move(cardA.x + 45, cardA.y + 29, { steps: 3 });
  await page.mouse.move(cardB.x + 45, cardB.y + 18, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await call<TripSnapshot>(page, `/trips/${id}`)).days[0].items.map(
        (i) => i.id,
      ),
    )
    .toEqual([b.id, a.id]);
  await page.waitForTimeout(60);
  const from = (await page
      .locator(`[data-day-tab-id="${third}"]`)
      .boundingBox())!,
    to = (await page.locator(`[data-day-tab-id="${first}"]`).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 13);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 - 12, from.y + 13, {
    steps: 3,
  });
  await page.mouse.move(to.x + to.width / 2, to.y + 13, { steps: 14 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await call<TripSnapshot>(page, `/trips/${id}`)).days.map((d) => d.id),
    )
    .toEqual([third, first, second]);
  snap = await call<TripSnapshot>(page, `/trips/${id}`);
  expect(snap.days[0]).toMatchObject({ title: "第 1 天", date: "2026-10-02" });
  expect(snap.days[0].items.map((i) => i.title)).toEqual(["地点 C", "地点 D"]);
  expect(snap.days[1].date).toBe("2026-10-03");
  await page.locator(`[data-day-tab-id="${first}"]`).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect
    .poll(async () =>
      (await call<TripSnapshot>(page, `/trips/${id}`)).days.map((d) => d.id),
    )
    .toEqual([first, third, second]);
  await page.getByRole("button", { name: "全部展开", exact: true }).click();
  const route = page.locator(`#day-${first} .leg-card`).first();
  await route.getByRole("button", { name: /展开路线/ }).click();
  await expect(route.locator(".leg-summary")).toContainText("收起路线");
  await route.locator(".leg-close").click();
  await expect(route.locator(".leg-summary")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page
    .getByTestId(`item-${a.id}`)
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  const category = page.getByRole("combobox", {
    name: "地点分类",
    exact: true,
  });
  await category.click();
  await page
    .getByRole("listbox", { name: "地点分类选项", exact: true })
    .getByRole("option", { name: "餐饮", exact: true })
    .click();
  await category.click();
  await expect(
    page
      .getByRole("listbox", { name: "地点分类选项", exact: true })
      .getByRole("option", { name: "景点", exact: true }),
  ).toBeVisible();
  await page.getByLabel("搜索地点分类", { exact: true }).fill("咖啡");
  await page.getByRole("option", { name: "使用“咖啡”", exact: true }).click();
  await category.click();
  await expect(category).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("dialog", { name: "编辑行程事项", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存事项", exact: true }).click();
  await expect(page.getByTestId(`item-${a.id}`)).toContainText("咖啡");
  await page.getByRole("combobox", { name: "城市", exact: true }).click();
  await page.getByLabel("搜索城市", { exact: true }).fill("香港");
  await page.getByRole("option", { name: "香港", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "城市", exact: true }),
  ).toHaveText("香港");
  const search = page.waitForRequest(
    (request) =>
      request.url().includes("/places/autocomplete") &&
      new URL(request.url()).searchParams.get("city") === "香港",
  );
  await page.getByLabel("搜索地点", { exact: true }).fill("中环");
  await search;
  await page.getByLabel("搜索地点", { exact: true }).fill("");
  await setTripDays(page, id, 2);
  await page.getByRole("button", { name: "行程设置", exact: true }).click();
  await page.getByLabel("行程天数", { exact: true }).fill("1");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "仍有事项或费用",
  );
  expect((await call<TripSnapshot>(page, `/trips/${id}`)).days).toHaveLength(2);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .locator(`#day-${first}`)
    .getByRole("button", { name: "第 1 天设置", exact: true })
    .click();
  await expect(page.getByLabel("当天名称", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "删除这一天", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const obsolete = await page.request.post(`${origin}/api/trips/${id}/days`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(obsolete.status()).toBe(405);
  await page.reload();
  await expect(page.locator(".day-tab")).toHaveCount(2);
  await page.screenshot({
    path: "test-results/skyweave-planner.png",
    fullPage: true,
  });
});

test("事项时间：结束时间与停留时长双向同步、跨日和保存", async ({ page }) => {
  await register(page, "ItemTiming");
  const id = await createTrip(page, "事项时间联动");
  const snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  const item = await call<{ id: string }>(
    page,
    `/days/${snapshot.days[0].id}/items`,
    "POST",
    {
      title: "晚间活动",
      type: "event",
      fixedTime: true,
      startMinutes: 1140,
      endMinutes: 1260,
      stayMinutes: 0,
    },
  );
  const card = page.getByTestId(`item-${item.id}`);
  await card.getByRole("button", { name: "编辑", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "编辑行程事项",
    exact: true,
  });
  const start = dialog.getByLabel("开始时间", { exact: true });
  const end = dialog.getByLabel("结束时间", { exact: true });
  const endDay = dialog.getByLabel("结束时间日期", { exact: true });
  const stay = dialog.getByLabel("停留时间（分钟）", { exact: true });
  const save = dialog.getByRole("button", { name: "保存事项", exact: true });

  await expect(stay).toHaveValue("120");
  await end.fill("21:30");
  await expect(stay).toHaveValue("150");
  await stay.fill("90");
  await expect(end).toHaveValue("20:30");
  await stay.fill("0");
  await expect(end).toHaveValue("19:00");
  await end.fill("18:00");
  await expect(dialog).toContainText("结束时间不能早于开始时间");
  await expect(save).toBeDisabled();

  await stay.fill("360");
  await expect(end).toHaveValue("01:00");
  await expect(endDay).toHaveValue("1");
  await endDay.selectOption("2");
  await expect(stay).toHaveValue("1800");
  await endDay.selectOption("1");
  await end.fill("02:00");
  await expect(stay).toHaveValue("420");
  await start.fill("20:00");
  await expect(stay).toHaveValue("360");
  await save.click();
  await expect(dialog).not.toBeVisible();
  expect(
    (await call<TripSnapshot>(page, `/trips/${id}`)).days[0].items[0],
  ).toMatchObject({ startMinutes: 1200, endMinutes: 1560, stayMinutes: 360 });
  await expect(card).toContainText("停留 360 分钟");

  await page.reload();
  await card.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(end).toHaveValue("02:00");
  await expect(endDay).toHaveValue("1");
  await expect(stay).toHaveValue("360");
  await end.fill("");
  await expect(stay).toHaveValue("360");
  await end.fill("01:00");
  await expect(stay).toHaveValue("300");
  await start.fill("");
  await expect(end).toHaveValue("");
  await stay.fill("90");
  await expect(end).toHaveValue("");
  await dialog.getByLabel("开始时间日期", { exact: true }).selectOption("1");
  await start.fill("23:00");
  await expect(end).toHaveValue("00:30");
  await expect(endDay).toHaveValue("2");
  await stay.fill("");
  await expect(end).toHaveValue("");
  await stay.fill("120");
  await expect(end).toHaveValue("01:00");
  await expect(endDay).toHaveValue("2");
  await save.click();
  await expect(dialog).not.toBeVisible();
  expect(
    (await call<TripSnapshot>(page, `/trips/${id}`)).days[0].items[0],
  ).toMatchObject({ startMinutes: 2820, endMinutes: 2940, stayMinutes: 120 });
});

test("组件库交互：嵌套下拉、焦点返回、删除确认和手机抽屉", async ({ page }) => {
  await register(page, "Components");
  const id = await createTrip(page, "组件交互");
  const snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  const item = await call<{ id: string }>(
    page,
    `/days/${snapshot.days[0].id}/items`,
    "POST",
    { title: "保留事项", type: "note" },
  );
  const card = page.getByTestId(`item-${item.id}`),
    edit = card.getByRole("button", { name: "编辑", exact: true });
  await edit.click();
  const dialog = page.getByRole("dialog", {
    name: "编辑行程事项",
    exact: true,
  });
  await expect(dialog).toHaveAttribute("data-slot", "dialog-content");
  await dialog.getByLabel("名称", { exact: true }).fill("未提交修改");
  const category = dialog.getByRole("combobox", {
    name: "地点分类",
    exact: true,
  });
  await category.click();
  await page.getByLabel("搜索地点分类", { exact: true }).fill("餐");
  await page.keyboard.press("Enter");
  await expect(category).toHaveText("餐饮");
  await category.click();
  await expect(category).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("名称", { exact: true })).toHaveValue(
    "未提交修改",
  );
  for (let n = 0; n < 16; n++) {
    await page.keyboard.press("Tab");
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              !!document.activeElement?.closest('[data-slot="dialog-content"]'),
          ),
        { timeout: 2000 },
      )
      .toBe(true);
  }
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(edit).toBeFocused();
  expect(
    (await call<TripSnapshot>(page, `/trips/${id}`)).days[0].items[0].title,
  ).toBe("保留事项");
  await card
    .getByRole("button", { name: "保留事项 更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除事项", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "确认删除",
    exact: true,
  });
  await expect(confirmation).toContainText("相关费用将保留");
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(card).toBeVisible();
  await card
    .getByRole("button", { name: "保留事项 更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除事项", exact: true }).click();
  await confirmation.getByRole("button", { name: "删除", exact: true }).click();
  await expect(card).not.toBeVisible();
  await page.getByRole("button", { name: "行程设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "行程设置", exact: true });
  await settings.getByRole("button", { name: "删除行程", exact: true }).click();
  await expect(confirmation).toContainText("永久删除");
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "向第 1 天添加事项", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: "添加行程事项", exact: true });
  await expect(sheet).toHaveAttribute("data-slot", "sheet-content");
  await expect(sheet).toHaveAttribute("data-side", "bottom");
  await sheet.getByLabel("名称", { exact: true }).fill("手机事项");
  await sheet.getByRole("combobox", { name: "地点分类", exact: true }).click();
  await page.getByLabel("搜索地点分类", { exact: true }).fill("住宿");
  await page.getByRole("option", { name: "住宿", exact: true }).click();
  await sheet
    .getByRole("checkbox", { name: "固定时间活动", exact: true })
    .check();
  await sheet.getByLabel("开始时间", { exact: true }).fill("09:00");
  await sheet.getByLabel("结束时间", { exact: true }).fill("10:00");
  await expect(
    sheet.getByLabel("停留时间（分钟）", { exact: true }),
  ).toHaveValue("60");
  await sheet.getByRole("button", { name: "保存事项", exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await expect(page.locator(".item-title")).toHaveText("手机事项");
  expect(
    (await call<TripSnapshot>(page, `/trips/${id}`)).days[0].items[0],
  ).toMatchObject({
    fixedTime: true,
    startMinutes: 540,
    endMinutes: 600,
    stayMinutes: 60,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
