import { test, expect, type Page } from "@playwright/test";
import type {
  TripSnapshot,
  VersionedSnapshot,
  DayGeometry,
} from "../src/domain/types";
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
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test("slow snapshots load once, tabs reuse the layout, and maps fetch only the active day's selected routes", async ({
  page,
}) => {
  await registerViaApi(page, {
    name: "Performance",
    email: `performance-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "轻量加载回归",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
  });
  const original = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  for (const day of original.days) {
    for (let index = 0; index < 2; index++)
      await call(page, `/days/${day.id}/items`, "POST", {
        title: `地点 ${index}`,
        lat: 22.28 + index * 0.01,
        lng: 114.16 + index * 0.01,
      });
    await call(page, `/days/${day.id}/routes/recalculate`, "POST", {});
  }
  const snapshots: string[] = [];
  const geometries: string[] = [];
  let documents = 0;
  let events = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === `/api/trips/${trip.id}`)
      snapshots.push(url.searchParams.get("section") ?? "full");
    if (url.pathname.endsWith("/geometry")) geometries.push(url.pathname);
    if (url.pathname === `/api/trips/${trip.id}/events`) events++;
    if (request.resourceType() === "document") documents++;
  });
  await page.route(
    `**/api/trips/${trip.id}?section=expenses`,
    async (route) => {
      const response = await route.fetch();
      // Longer than the old 180 ms sync debounce, to expose duplicate initial loads.
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({ response });
    },
  );
  const loaded = page.waitForResponse((response) =>
    response.url().endsWith(`/${trip.id}?section=expenses`),
  );
  await page.goto(`/trips/${trip.id}/expenses`);
  const response = await loaded;
  expect(response.headers()["server-timing"]).toMatch(/app;dur=/);
  const data = (await response.json()) as VersionedSnapshot;
  expect(data.days.every((day) => !day.legs.length)).toBe(true);
  await expect(page.locator(".trip-nav")).toBeVisible();
  // Let both the initial SSE sync and its former delayed refresh settle.
  await page.waitForTimeout(1200);
  expect(snapshots).toEqual(["expenses"]);
  expect(geometries).toEqual([]);
  const nav = page.getByRole("navigation", { name: "行程导航" });
  await nav.getByRole("link", { name: "成员", exact: true }).click();
  await expect(page.getByRole("heading", { name: "同行成员" })).toBeVisible();
  await nav.getByRole("link", { name: "费用", exact: true }).click();
  await expect(page).toHaveURL(`/trips/${trip.id}/expenses`);
  await expect(page.getByRole("heading", { name: "费用与结算" })).toBeVisible();
  expect(snapshots).toEqual(["expenses", "members"]);
  expect(documents).toBe(1);
  expect(events).toBe(1);

  const geometryLoaded = page.waitForResponse((response) =>
    response.url().endsWith(`/days/${original.days[0].id}/geometry`),
  );
  await nav.getByRole("link", { name: "行程", exact: true }).click();
  const geometry = (await (await geometryLoaded).json()) as DayGeometry;
  expect(geometry.alternatives).toHaveLength(1);
  expect(geometry.alternatives[0].polyline.length).toBeGreaterThan(1);
  await expect(page.locator(".planner-day").first()).toBeVisible();
  expect(geometries).toEqual([`/api/days/${original.days[0].id}/geometry`]);
  const secondGeometry = page.waitForResponse((response) =>
    response.url().endsWith(`/days/${original.days[1].id}/geometry`),
  );
  await page
    .locator(".day-bar")
    .getByRole("button", { name: /第 2 天|第2天|10.02|10月2/ })
    .first()
    .click();
  await secondGeometry;
  expect(geometries).toContain(`/api/days/${original.days[1].id}/geometry`);
  expect(documents).toBe(1);
  expect(events).toBe(1);
});
