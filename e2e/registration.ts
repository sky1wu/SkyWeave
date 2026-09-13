import {
  expect,
  type APIResponse,
  type Page,
  type Response,
} from "@playwright/test";

const origin = "http://127.0.0.1:3100";

async function submitRegistration(
  page: Page,
  submit: () => Promise<APIResponse | Response>,
) {
  let response = await submit();
  // All test accounts share one local IP and the production sign-up limit.
  if (response.status() === 429) {
    await page.waitForTimeout(
      Number(response.headers()["retry-after"] ?? 60) * 1000 + 100,
    );
    response = await submit();
  }
  expect(response.ok(), `Sign-up failed: ${await response.text()}`).toBe(true);
}

export async function registerViaApi(
  page: Page,
  account: { name: string; email: string; password: string },
) {
  await submitRegistration(page, () =>
    page.request.post(`${origin}/api/auth/sign-up/email`, {
      headers: { Origin: origin },
      data: account,
    }),
  );
}

export async function submitRegistrationForm(page: Page) {
  await submitRegistration(page, async () => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/auth/sign-up/email") &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "创建账号", exact: true }).click(),
    ]);
    return response;
  });
  await expect(page).toHaveURL(`${origin}/`);
}
