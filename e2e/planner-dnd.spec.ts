import { test, expect, type Locator, type Page } from "@playwright/test";
import type { Item, TripSnapshot } from "../src/domain/types";
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

async function setup(page: Page, count = 3) {
  await registerViaApi(page, {
    name: "拖拽回归",
    email: `drag-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "精确落点",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
  });
  const snapshot = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  const day = snapshot.days[0];
  const items: Item[] = [];
  for (let i = 0; i < count; i++)
    items.push(
      await call<Item>(page, `/days/${day.id}/items`, "POST", {
        title: `安排 ${i + 1}`,
        type: "note",
      }),
    );
  const place = await call<{ id: string }>(
    page,
    `/trips/${trip.id}/places`,
    "POST",
    {
      title: "新地点",
      type: "note",
      notes: "从卡片不同位置拿起也应跟随指针",
    },
  );
  await page.goto(`/trips/${trip.id}/plan`);
  await expect(page.getByTestId(`pool-${place.id}`)).toBeVisible();
  return { trip, day, items, place, snapshot };
}

async function startDrag(page: Page, source: Locator) {
  const box = (await source.boundingBox())!;
  // Grab well below the top of the card to catch preview/pointer offsets.
  const point = { x: box.x + 6, y: box.y + box.height * 0.65 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x - 12, point.y, { steps: 3 });
  await expect(page.locator(".planner-drag-preview")).toBeVisible();
}

function marker(page: Page, itemId: string) {
  return page.getByTestId(`item-${itemId}`).locator("..");
}

async function titles(page: Page, tripId: string, dayIndex = 0) {
  return (await call<TripSnapshot>(page, `/trips/${tripId}`)).days[
    dayIndex
  ].items.map((i) => i.title);
}

test("地点池：同一卡片上下半区实时切换插入线，保存顺序与预览一致", async ({
  page,
}) => {
  const { trip, items, place } = await setup(page);
  const first = (await page.getByTestId(`item-${items[0].id}`).boundingBox())!;
  await startDrag(page, page.getByTestId(`pool-${place.id}`));
  const x = first.x + first.width / 2;
  await page.mouse.move(x, first.y + first.height * 0.25, { steps: 12 });
  await expect(marker(page, items[0].id)).toHaveClass("drop-before");
  await page.mouse.move(x, first.y + first.height * 0.75, { steps: 5 });
  await expect(marker(page, items[1].id)).toHaveClass("drop-before");
  await expect(marker(page, items[0].id)).not.toHaveClass("drop-before");
  const preview = (await page.locator(".planner-drag-preview").boundingBox())!;
  expect(Math.abs(preview.x - x - 12)).toBeLessThan(5);
  expect(
    Math.abs(preview.y - (first.y + first.height * 0.75) - 12),
  ).toBeLessThan(5);
  await page.mouse.move(x, first.y + first.height * 0.25, { steps: 5 });
  await expect(marker(page, items[0].id)).toHaveClass("drop-before");
  await page.mouse.move(x, first.y + first.height * 0.75, { steps: 5 });
  await expect(marker(page, items[1].id)).toHaveClass("drop-before");
  await page.mouse.up();
  await expect
    .poll(() => titles(page, trip.id))
    .toEqual(["安排 1", "新地点", "安排 2", "安排 3"]);
  await expect(page.getByTestId(`pool-${place.id}`)).toContainText(
    "已安排 1 次",
  );
  await page.reload();
  await expect(page.locator(".item-title")).toHaveText([
    "安排 1",
    "新地点",
    "安排 2",
    "安排 3",
  ]);
});

test("地点池：空白区域内移动更新落点，放到面板外取消", async ({ page }) => {
  const { trip, day, items, place } = await setup(page);
  const first = (await page.getByTestId(`item-${items[0].id}`).boundingBox())!;
  const second = (await page.getByTestId(`item-${items[1].id}`).boundingBox())!;
  const last = (await page.getByTestId(`item-${items[2].id}`).boundingBox())!;
  await startDrag(page, page.getByTestId(`pool-${place.id}`));
  const x = first.x + 15;
  await page.mouse.move(
    x,
    first.y + first.height + (second.y - first.y - first.height) / 2,
    { steps: 12 },
  );
  await expect(marker(page, items[1].id)).toHaveClass("drop-before");
  await page.mouse.move(x, last.y + last.height + 16, { steps: 8 });
  await expect(page.locator(`[data-day-end="${day.id}"]`)).toHaveClass(
    /drop-indicator/,
  );
  await page.mouse.move(
    x,
    first.y + first.height + (second.y - first.y - first.height) / 2,
    { steps: 8 },
  );
  await expect(marker(page, items[1].id)).toHaveClass("drop-before");
  await page.mouse.up();
  await expect
    .poll(() => titles(page, trip.id))
    .toEqual(["安排 1", "新地点", "安排 2", "安排 3"]);
  await page.waitForTimeout(60);
  await startDrag(page, page.getByTestId(`pool-${place.id}`));
  await page.mouse.move(x, first.y + first.height * 0.25, { steps: 12 });
  await expect(page.locator(".drop-before")).toHaveCount(1);
  await page.mouse.move(720, 180, { steps: 10 });
  await expect(page.locator(".drop-before, .drop-indicator")).toHaveCount(0);
  await page.mouse.up();
  expect(await titles(page, trip.id)).toHaveLength(4);
});

test("地点池：拖到边缘自动滚动后，落点仍按指针位置计算", async ({ page }) => {
  const { trip, place } = await setup(page, 18);
  const pane = page.locator(".continuous-timeline");
  const rect = (await pane.boundingBox())!;
  await startDrag(page, page.getByTestId(`pool-${place.id}`));
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height - 18, {
    steps: 18,
  });
  await expect
    .poll(() => pane.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(180);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, {
    steps: 4,
  });
  const target = await pane
    .locator(".timeline-item")
    .evaluateAll((nodes, viewport) => {
      const node = nodes.find((node) => {
        const r = node.getBoundingClientRect();
        return (
          r.top > viewport.y + 120 &&
          r.bottom < viewport.y + viewport.height - 100
        );
      })!;
      const r = node.getBoundingClientRect();
      return {
        id: node.id.slice(5),
        x: r.x + r.width / 2,
        y: r.top - 4,
      };
    }, rect);
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await expect(marker(page, target.id)).toHaveClass("drop-before");
  await page.mouse.up();
  await expect
    .poll(async () => {
      const state = await call<TripSnapshot>(page, `/trips/${trip.id}`);
      const items = state.days[0].items;
      return items[items.findIndex((item) => item.id === target.id) - 1]?.title;
    })
    .toBe("新地点");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.waitForTimeout(60);
  await startDrag(page, page.getByTestId(`pool-${place.id}`));
  // Scrolled-out cards extend behind the toolbar but must not accept drops there.
  await page.mouse.move(rect.x + rect.width / 2, rect.y - 20, { steps: 12 });
  await expect(page.locator(".drop-before, .drop-indicator")).toHaveCount(0);
  await page.mouse.up();
  expect(await titles(page, trip.id)).toHaveLength(19);
});

test("地点池：空白日期可放入，分组尾部落点不误入共同时间线", async ({
  page,
}) => {
  const { trip, day, place, snapshot } = await setup(page, 0);
  const second = snapshot.days[1];
  await page
    .locator(".day-tabs")
    .getByRole("button", { name: /第 2 天/ })
    .click();
  await startDrag(page, page.getByTestId(`pool-${place.id}`));
  const empty = (await page
    .locator(`[data-day-end="${second.id}"]`)
    .boundingBox())!;
  await page.mouse.move(empty.x + empty.width / 2, empty.y + empty.height / 2, {
    steps: 12,
  });
  await expect(page.locator(`[data-day-end="${second.id}"]`)).toHaveClass(
    /drop-indicator/,
  );
  await page.mouse.up();
  await expect.poll(() => titles(page, trip.id, 1)).toEqual(["新地点"]);
  const branchId = crypto.randomUUID();
  const guest = await call<{ id: string }>(
    page,
    `/trips/${trip.id}/participants`,
    "POST",
    { name: "另一位同行者" },
  );
  await call(page, `/days/${day.id}/items`, "POST", {
    title: "分头行动",
    type: "parallel",
    parallelPlan: {
      splitItemId: null,
      joinItemId: null,
      joinPolicy: "wait_all",
      branches: [
        {
          id: branchId,
          title: "第一组",
          participantIds: [snapshot.participants[0].id],
          startMinutes: 540,
        },
        {
          id: crypto.randomUUID(),
          title: "第二组",
          participantIds: [guest.id],
          startMinutes: 540,
        },
      ],
    },
  });
  await page.reload();
  const lane = page.locator(
    `[data-branch-id="${branchId}"][data-branch-day="${day.id}"]`,
  );
  await expect(lane).toBeVisible();
  const end = (await lane.locator("[data-branch-end]").boundingBox())!;
  await startDrag(page, page.getByTestId(`pool-${place.id}`));
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 12,
  });
  await expect(lane.locator("[data-branch-end]")).toHaveClass(/drop-indicator/);
  await expect(page.locator(`[data-day-end="${day.id}"]`)).not.toHaveClass(
    /drop-indicator/,
  );
  await page.mouse.up();
  await expect
    .poll(async () => {
      const state = await call<TripSnapshot>(page, `/trips/${trip.id}`);
      return state.days[0].items.find((item) => item.title === "新地点")
        ?.branchId;
    })
    .toBe(branchId);
});
