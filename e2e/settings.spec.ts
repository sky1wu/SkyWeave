import { test, expect, type Page } from "@playwright/test";
import type { TripSnapshot } from "../src/domain/types";
import { registerViaApi } from "./registration";

const origin = "http://127.0.0.1:3100";
const password = "Settings-test-password-2026";
const newPassword = "Settings-new-password-2026";

async function register(page: Page) {
  const email = `settings-${crypto.randomUUID()}@example.test`;
  await registerViaApi(page, {
    email,
    password,
    name: "旅行者",
  });
  return email;
}

test("用户设置需要登录，登录后返回设置页", async ({ page }) => {
  const email = await register(page);
  await page.context().clearCookies();
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings/);
  await expect(page.getByRole("heading", { name: "用户设置" })).toHaveCount(0);
  for (const endpoint of ["update-user", "change-password"]) {
    const response = await page.request.post(`/api/auth/${endpoint}`, {
      headers: { Origin: origin },
      data: { name: "未登录", currentPassword: password, newPassword },
    });
    expect(response.status()).toBe(401);
  }
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/settings`);
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue("旅行者");
});

test("昵称校验、保存失败重试、持久化、成员同步与手机入口", async ({ page }) => {
  const email = await register(page);
  const response = await page.request.post("/api/trips", {
    headers: { Origin: origin },
    data: {
      title: "设置入口测试",
      timezone: "Asia/Shanghai",
      baseCurrency: "CNY",
    },
  });
  expect(response.ok()).toBe(true);
  const trip = (await response.json()) as { id: string };
  await page.goto("/");
  await page.getByRole("link", { name: "用户设置" }).click();
  await expect(page).toHaveTitle("用户设置 · SkyWeave");
  await expect(page.getByLabel("登录邮箱")).toHaveValue(email);
  await expect(page.getByLabel("登录邮箱")).toHaveAttribute("readonly", "");
  const name = page.getByLabel("昵称", { exact: true });
  const save = page.getByRole("button", { name: "保存昵称" });
  await expect(save).toBeDisabled();
  await name.fill("   ");
  await save.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "不能只包含空格",
  );
  await name.fill("  一起去旅行  ");
  await page.route("**/api/auth/update-user", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        code: "INTERNAL_SERVER_ERROR",
        message: "Unavailable",
      }),
    }),
  );
  await save.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "昵称未保存",
  );
  await expect(name).toHaveValue("  一起去旅行  ");
  await expect(save).toBeEnabled();
  await page.unroute("**/api/auth/update-user");
  await save.click();
  await expect(
    page.getByRole("status").filter({ hasText: "昵称已保存。" }),
  ).toBeVisible();
  await expect(page.getByRole("complementary")).toContainText("一起去旅行");
  await expect(name).toHaveValue("一起去旅行");
  await expect(save).toBeDisabled();
  await page.reload();
  await expect(name).toHaveValue("一起去旅行");
  await page.screenshot({
    path: "test-results/settings-desktop.png",
    fullPage: true,
  });

  for (const width of [320, 390, 768, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/settings-mobile.png",
    fullPage: true,
  });

  await page.goto(`/trips/${trip.id}/members`);
  const snapshot = await page.request.get(`/api/trips/${trip.id}`);
  expect(((await snapshot.json()) as TripSnapshot).members[0].name).toBe(
    "一起去旅行",
  );
  const memberCard = page.locator(".member-card");
  await expect(memberCard.getByRole("heading")).toHaveText("一起去旅行");
  await expect(memberCard.locator(".avatar")).toHaveText("一");
  await expect(
    memberCard.getByRole("button", { name: "修改姓名", exact: true }),
  ).toHaveCount(0);
  const renamed = await page.request.post("/api/auth/update-user", {
    headers: { Origin: origin },
    data: { name: "山海旅行者" },
  });
  expect(renamed.ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(memberCard.getByRole("heading")).toHaveText("山海旅行者");
  await expect(memberCard.locator(".avatar")).toHaveText("山");
  const link = page.getByRole("link", { name: "用户设置", exact: true });
  await expect(link).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await link.click();
  await expect(name).toHaveValue("山海旅行者");
  await page.getByRole("link", { name: "所有行程" }).click();
  await expect(page.getByRole("link", { name: "用户设置" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("修改密码校验、撤销其他设备、退出失败重试与新密码登录", async ({
  page,
  browser,
}) => {
  const email = await register(page);
  const other = await browser.newContext({ baseURL: origin });
  try {
    const otherLogin = await other.request.post("/api/auth/sign-in/email", {
      headers: { Origin: origin },
      data: { email, password },
    });
    expect(otherLogin.ok()).toBe(true);
    await page.goto("/settings");
    const current = page.getByLabel("当前密码", { exact: true });
    const next = page.getByLabel("新密码", { exact: true });
    const confirm = page.getByLabel("确认新密码", { exact: true });
    const change = page.getByRole("button", { name: "修改密码", exact: true });
    await current.fill(password);
    await next.fill(newPassword);
    await confirm.fill("Different-password-2026");
    await change.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "两次输入的新密码不一致",
    );
    await next.fill(password);
    await confirm.fill(password);
    await change.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "新密码不能与当前密码相同",
    );
    await next.fill(newPassword);
    await confirm.fill(newPassword);
    await current.fill("Incorrect-password-2026");
    await change.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "当前密码不正确",
    );
    await current.fill(password);
    await change.click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "密码已修改，其他设备需要重新登录。" }),
    ).toBeVisible();
    await expect(current).toBeEmpty();
    await expect(next).toBeEmpty();
    await expect(confirm).toBeEmpty();
    expect((await page.request.get("/api/trips")).status()).toBe(200);
    expect((await other.request.get("/api/trips")).status()).toBe(401);

    await page.route("**/api/auth/sign-out", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unavailable",
        }),
      }),
    );
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "退出未成功",
    );
    await expect(page).toHaveURL(`${origin}/settings`);
    await page.unroute("**/api/auth/sign-out");
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/login`);
    expect((await page.request.get("/api/trips")).status()).toBe(401);
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "邮箱或密码不正确",
    );
    await page.getByLabel("密码").fill(newPassword);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
    await page.getByRole("link", { name: "用户设置" }).click();
    await expect(page.getByLabel("登录邮箱")).toHaveValue(email);
  } finally {
    await other.close();
  }
});

test("保存时登录失效会返回登录页", async ({ page }) => {
  await register(page);
  await page.goto("/settings");
  await page.getByLabel("昵称", { exact: true }).fill("新的昵称");
  await page.context().clearCookies();
  await page.getByRole("button", { name: "保存昵称" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings/);
  await expect(page.getByLabel("昵称", { exact: true })).toHaveCount(0);
});
