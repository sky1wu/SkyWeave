import { test, expect, type Page } from "@playwright/test";
import type { TripSnapshot } from "../src/domain/types";
const origin = "http://127.0.0.1:3100";
async function register(page: Page, name: string) {
  await page.goto(`${origin}/register`);
  await page.getByLabel("昵称").fill(name);
  await page
    .getByLabel("邮箱")
    .fill(`${name.toLowerCase()}-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("密码").fill("Trip-test-password-2026");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
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
  const dragHandle = await page.locator(".drag-handle").first().boundingBox();
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
  await page.getByRole("button", { name: "复制事项", exact: true }).click();
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
  await page.getByRole("button", { name: "添加一天", exact: true }).click();
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
  await page.getByLabel("地点分类", { exact: true }).fill("购物清单");
  await page.getByRole("button", { name: "保存地点", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const poolHandle = await page
    .getByRole("button", { name: "拖动地点池 西安SKP", exact: true })
    .boundingBox();
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
  const toolbar = await page.locator(".planner-toolbar").boundingBox();
  expect(toolbar!.y + toolbar!.height).toBeLessThan(165);
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
  await expect(page.locator(".leg-card .fixed-arrival")).toContainText(
    "距开始还剩 18 分钟",
  );
  snapshot = await call<TripSnapshot>(page, `/trips/${id}`);
  const leg = snapshot.days[0].legs[0];
  await page.locator(`[data-leg-id="${leg.id}"] .leg-summary`).click();
  await expect(page.locator(".trip-map")).toHaveAttribute(
    "data-focused-leg",
    leg.id,
  );
  await expect(page.getByTestId("test-map").locator("svg")).not.toHaveAttribute(
    "viewBox",
    "0 0 700 600",
  );
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
  await expect(page.getByRole("dialog")).toHaveAttribute(
    "aria-label",
    "编辑费用",
  );
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .getByRole("button", { name: "固定活动 更多操作", exact: true })
    .click();
  await page.getByRole("button", { name: "移至后一天", exact: true }).click();
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
