import { test, expect, type Page } from "@playwright/test";
import type { ParticipantAlias, TripSnapshot } from "../src/domain/types";
import { registerViaApi } from "./registration";

const origin = "http://127.0.0.1:3100";
async function call<T>(
  page: Page,
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await page.request.fetch(`/api${path}`, {
    method,
    headers: { Origin: origin },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}

test("成员备注名：双账号隔离、只读成员可用、失败重试、持久化、清空与手机显示", async ({
  page,
  browser,
}) => {
  await registerViaApi(page, {
    name: "Alice",
    email: `alias-owner-${crypto.randomUUID()}@example.test`,
    password: "Aliases-test-password-2026",
  });
  const trip = await call<{ id: string }>(page, "/trips", "POST", {
    title: "私人备注名验收",
  });
  const invite = await call<{ token: string }>(
    page,
    `/trips/${trip.id}/invites`,
    "POST",
    { role: "viewer" },
  );
  const other = await browser.newContext({ baseURL: origin });
  try {
    const b = await other.newPage();
    const email = `alias-viewer-${crypto.randomUUID()}@example.test`;
    await registerViaApi(b, {
      name: "Bob",
      email,
      password: "Aliases-test-password-2026",
    });
    await call(b, `/invites/${invite.token}/join`, "POST", {});
    const before = await call<TripSnapshot>(page, `/trips/${trip.id}`);
    const target = before.participants.find(
      (p) => p.userId !== before.currentUserId,
    )!;
    const aliasesPath = `/trips/${trip.id}/participant-aliases`;
    const targetPath = `${aliasesPath}/${target.id}`;
    await page.route(
      `**/api${aliasesPath}`,
      (route) =>
        route.fulfill({
          status: 500,
          json: { error: { code: "INTERNAL", message: "加载失败" } },
        }),
      { times: 1 },
    );
    await page.goto(`/trips/${trip.id}/members`);
    const card = page.locator(".member-card").filter({ hasText: email });
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "备注名加载失败",
    );
    await expect(
      card.getByRole("button", { name: "设置备注名" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "重试加载备注名" }).click();
    await card.getByRole("button", { name: "设置备注名" }).click();
    const dialog = page.getByRole("dialog", { name: "设置备注名" });
    await expect(dialog).toContainText("仅你可见");
    await dialog.getByLabel("备注名", { exact: true }).fill("取消的备注");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(card.getByRole("heading")).toHaveText("Bob");
    await card.getByRole("button", { name: "设置备注名" }).click();
    const input = dialog.getByLabel("备注名", { exact: true });
    await expect(input).toBeEmpty();
    await input.fill("  私人小林  ");
    await page.route(
      `**/api${targetPath}`,
      (route) =>
        route.fulfill({
          status: 500,
          json: {
            error: { code: "INTERNAL", message: "备注名未保存，请重试。" },
          },
        }),
      { times: 1 },
    );
    await dialog.getByRole("button", { name: "保存备注名" }).click();
    await expect(dialog.getByRole("alert")).toContainText("备注名未保存");
    await expect(input).toHaveValue("  私人小林  ");
    await dialog.getByRole("button", { name: "保存备注名" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card.getByRole("heading")).toHaveText("私人小林");
    await expect(card.locator(".avatar")).toHaveText("私");
    await expect(card).toContainText("昵称：Bob");

    await b.goto(`/trips/${trip.id}/members`);
    const otherCard = b.locator(".member-card").filter({ hasText: email });
    await expect(otherCard.getByRole("heading")).toHaveText("Bob");
    await expect(b.getByText("私人小林", { exact: true })).toHaveCount(0);
    await otherCard.getByRole("button", { name: "设置备注名" }).click();
    await b.getByLabel("备注名", { exact: true }).fill("独立称呼");
    await b.getByRole("button", { name: "保存备注名" }).click();
    await expect(otherCard.getByRole("heading")).toHaveText("独立称呼");
    await expect(card.getByRole("heading")).toHaveText("私人小林");
    expect(await call(page, aliasesPath)).toEqual([
      { participantId: target.id, name: "私人小林", version: 1 },
    ]);
    expect(
      await call(b, `${aliasesPath}?userId=${before.currentUserId}`),
    ).toEqual([{ participantId: target.id, name: "独立称呼", version: 1 }]);
    const forged = await b.request.patch(`/api${targetPath}`, {
      headers: { Origin: origin },
      data: { userId: before.currentUserId, name: "篡改", expectedVersion: 1 },
    });
    expect(forged.status()).toBe(400);
    expect(await call<TripSnapshot>(page, `/trips/${trip.id}`)).toEqual(before);
    expect(
      JSON.stringify(await call(page, `/trips/${trip.id}/export`)),
    ).not.toContain("私人小林");
    const privateResponse = await page.request.get(`/api${aliasesPath}`);
    expect(privateResponse.headers()["cache-control"]).toBe("no-store");

    await page.reload();
    await expect(card.getByRole("heading")).toHaveText("私人小林");
    await card.getByRole("button", { name: "修改备注名" }).click();
    await input.fill("即将过期的编辑");
    await call(page, targetPath, "PATCH", {
      name: "另一个页面的称呼",
      expectedVersion: 1,
    });
    await dialog.getByRole("button", { name: "保存备注名" }).click();
    await expect(dialog.getByRole("alert")).toContainText("其他页面修改");
    await expect(
      dialog.getByRole("button", { name: "保存备注名" }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(card.getByRole("heading")).toHaveText("另一个页面的称呼");
    const latest = await call<ParticipantAlias[]>(page, aliasesPath);
    await call(page, targetPath, "PATCH", {
      name: "旅".repeat(100),
      expectedVersion: latest[0].version,
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(card.getByRole("heading")).toHaveText("旅".repeat(100));
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: "test-results/member-alias-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await card.getByRole("button", { name: "修改备注名" }).click();
    await page.screenshot({
      path: "test-results/member-alias-mobile.png",
      fullPage: true,
    });
    await input.fill("");
    await dialog.getByRole("button", { name: "保存备注名" }).click();
    await expect(card.getByRole("heading")).toHaveText("Bob");
    await expect(card.locator(".avatar")).toHaveText("B");
    await page.reload();
    await expect(
      card.getByRole("button", { name: "设置备注名" }),
    ).toBeEnabled();
    await expect(card.getByRole("heading")).toHaveText("Bob");
    await b.reload();
    await expect(otherCard.getByRole("heading")).toHaveText("独立称呼");

    await call(page, `/trips/${trip.id}/members/${target.userId}`, "PATCH", {
      status: "inactive",
      expectedVersion: 1,
    });
    expect((await b.request.get(`/api${aliasesPath}`)).status()).toBe(404);
    expect(
      (
        await b.request.patch(`/api${targetPath}`, {
          headers: { Origin: origin },
          data: { name: "失去权限", expectedVersion: 1 },
        })
      ).status(),
    ).toBe(404);
    await other.clearCookies();
    expect((await b.request.get(`/api${aliasesPath}`)).status()).toBe(401);
  } finally {
    await other.close();
  }
});
