import { expect, test, type Page } from "@playwright/test";
import type { TripSnapshot } from "../src/domain/types";
import type { ItineraryShare } from "../src/domain/itinerary";
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
async function register(page: Page) {
  await registerViaApi(page, {
    name: "分享测试用户",
    email: `sharing-${crypto.randomUUID()}@example.test`,
    password: "Trip-test-password-2026",
  });
}

test("创建、复制和取消分享：访客免登录查看最新行程，旧链接永久失效", async ({
  page,
  browser,
}, testInfo) => {
  await register(page);
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "杭州公开行程",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
  });
  const snapshot = await call<TripSnapshot>(page, `/trips/${trip.id}`);
  const item = await call<{ id: string }>(
    page,
    `/days/${snapshot.days[0].id}/items`,
    "POST",
    { type: "note", title: "西湖边集合", notes: "带好饮用水" },
  );
  await page.goto(`/trips/${trip.id}/view`);
  await page.getByRole("button", { name: "分享行程", exact: true }).click();
  await expect(
    page.getByText("尚未开启公开分享", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "创建分享链接" }).click();
  const link = page.getByRole("textbox", { name: "公开链接" });
  await expect(link).toHaveValue(
    new RegExp(`^${origin}/share/[A-Za-z0-9_-]{43}$`),
  );
  const url = await link.inputValue();
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.getByRole("button", { name: "复制链接" }).click();
  await expect(
    page.getByRole("button", { name: "已复制", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.screenshot({ path: testInfo.outputPath("share-desktop.png") });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "分享行程", exact: true }).click();
  await expect(link).toHaveValue(url);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(link).toHaveValue(url);
  expect(
    await page
      .locator(".itinerary-toolbar a")
      .evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(48);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("share-mobile.png") });

  const context = await browser.newContext();
  const guest = await context.newPage();
  try {
    await guest.goto(url);
    await expect(
      guest.getByRole("heading", { name: "杭州公开行程" }),
    ).toBeVisible();
    await expect(
      guest.getByRole("heading", { name: "西湖边集合" }),
    ).toBeVisible();
    await expect(guest.getByText("带好饮用水", { exact: true })).toBeVisible();
    await expect(
      guest.getByRole("link", { name: /编辑行程|费用|成员|动态/ }),
    ).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "分享行程" })).toHaveCount(
      0,
    );
    await expect(
      guest.getByRole("button", { name: "导出行程图" }),
    ).toBeVisible();
    await expect(guest.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    const token = url.split("/").at(-1)!;
    const publicResponse = await guest.request.get(
      `${origin}/api/share/${token}`,
    );
    expect(publicResponse.headers()["cache-control"]).toBe("no-store");
    expect(Object.keys(await publicResponse.json()).sort()).toEqual([
      "dates",
      "days",
      "timezone",
      "title",
    ]);
    expect(
      (await guest.request.get(`${origin}/api/trips/${trip.id}`)).status(),
    ).toBe(401);
    expect(await context.cookies()).toHaveLength(0);
    for (const width of [320, 390, 768, 1024]) {
      await guest.setViewportSize({ width, height: 844 });
      expect(
        await guest.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await guest.screenshot({
      path: testInfo.outputPath("public-itinerary.png"),
      fullPage: true,
    });
    await call(page, `/items/${item.id}`, "PATCH", {
      expectedVersion: 1,
      title: "更新为湖畔集合",
    });
    await guest.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      guest.getByRole("heading", { name: "更新为湖畔集合" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "取消分享", exact: true }).click();
    await expect(
      page.getByText("尚未开启公开分享", { exact: true }),
    ).toBeVisible();
    const revoked = await guest.request.get(`${origin}/api/share/${token}`);
    expect(revoked.status()).toBe(404);
    expect(revoked.headers()["cache-control"]).toBe("no-store");
    await expect(
      guest.getByRole("heading", { name: "分享链接已失效" }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      guest.getByRole("heading", { name: "更新为湖畔集合" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "创建分享链接" }).click();
    await expect(link).toBeVisible();
    const newUrl = await link.inputValue();
    expect(newUrl).not.toBe(url);
    await guest.reload();
    await expect(
      guest.getByRole("heading", { name: "分享链接已失效" }),
    ).toBeVisible();
    await guest.goto(newUrl);
    await expect(
      guest.getByRole("heading", { name: "更新为湖畔集合" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("分享管理拒绝未登录、非所有者、跨站写入，公开链接仅支持读取", async ({
  page,
  browser,
}) => {
  await register(page);
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "分享访问控制",
  });
  const path = `/trips/${trip.id}/share`;
  const { share } = await call<{ share: ItineraryShare }>(
    page,
    path,
    "POST",
    {},
  );
  const deniedOrigin = await page.request.post(`${origin}/api${path}`, {
    headers: { Origin: "https://example.test" },
    data: {},
  });
  expect(deniedOrigin.status()).toBe(403);
  for (const role of [null, "outsider", "viewer", "editor"] as const) {
    const context = await browser.newContext();
    const visitor = await context.newPage();
    try {
      if (role) {
        await register(visitor);
        if (role !== "outsider") {
          const invite = await call<{ token: string }>(
            page,
            `/trips/${trip.id}/invites`,
            "POST",
            { role },
          );
          await call(visitor, `/invites/${invite.token}/join`, "POST", {});
          await visitor.goto(`${origin}/trips/${trip.id}/view`);
          await expect(
            visitor.getByRole("heading", { name: "行程手册" }),
          ).toBeVisible();
          await expect(
            visitor.getByRole("button", { name: "分享行程" }),
          ).toHaveCount(0);
        }
      }
      for (const method of ["GET", "POST", "DELETE"]) {
        const response = await visitor.request.fetch(
          `${origin}/api${path}${method === "DELETE" ? `/${share.id}` : ""}`,
          {
            method,
            headers: { Origin: origin },
            ...(method === "GET" ? {} : { data: {} }),
          },
        );
        expect(response.status()).toBe(
          !role ? 401 : role === "outsider" ? 404 : 403,
        );
      }
      expect(
        (
          await visitor.request.get(`${origin}/api/share/${share.token}`)
        ).status(),
      ).toBe(200);
      expect(
        (
          await visitor.request.post(`${origin}/api/share/${share.token}`, {
            data: {},
          })
        ).status(),
      ).toBe(405);
    } finally {
      await context.close();
    }
  }
});
