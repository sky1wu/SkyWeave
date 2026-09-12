import { expect, test } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { DayPlan, Participant } from "../src/domain/types";

test("create a token in settings, edit itinerary and expenses over MCP, and revoke access", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:3100";
  await page.goto("/register");
  await page.getByLabel("昵称").fill("MCP 用户");
  await page.getByLabel("邮箱").fill(`mcp-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("密码").fill("Mcp-test-password-2026");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  const created = await page.request.post("/api/trips", {
    headers: { Origin: origin },
    data: {
      title: "Agent 旅行",
      startDate: "2026-10-02",
      endDate: "2026-10-03",
    },
  });
  expect(created.ok()).toBe(true);
  const trip = (await created.json()) as { id: string };
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Agent 访问 · MCP" });
  await expect(section.getByLabel("MCP 地址")).toHaveValue(`${origin}/api/mcp`);
  await section.getByLabel("令牌名称").fill("E2E Agent");
  await section.getByLabel("访问权限", { exact: true }).selectOption("edit");
  await section.getByRole("button", { name: "创建访问令牌" }).click();
  const tokenField = section.getByLabel("新令牌 · 仅显示这一次");
  await expect(tokenField).toBeVisible();
  const token = await tokenField.inputValue();
  await section.getByRole("button", { name: "已保存，关闭" }).click();
  await expect(tokenField).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    section.getByRole("button", { name: "撤销令牌 E2E Agent" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const client = new Client({ name: "e2e-agent", version: "1.0.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const itinerary = await client.callTool({
      name: "get_itinerary",
      arguments: { tripId: trip.id },
    });
    expect(itinerary.isError).not.toBe(true);
    const day = (itinerary.structuredContent as { days: { day: DayPlan }[] })
      .days[0].day;
    const item = await client.callTool({
      name: "create_item",
      arguments: {
        tripId: trip.id,
        dayId: day.id,
        expectedDayVersion: day.version,
        item: {
          title: "Agent 添加的晚餐",
          type: "event",
          fixedTime: true,
          startMinutes: 1080,
          endMinutes: 1140,
        },
      },
    });
    expect(item.isError).not.toBe(true);
    const finances = await client.callTool({
      name: "get_expenses",
      arguments: { tripId: trip.id },
    });
    const participant = (
      finances.structuredContent as { participants: Participant[] }
    ).participants[0];
    const expense = await client.callTool({
      name: "create_expense",
      arguments: {
        tripId: trip.id,
        expense: {
          title: "Agent 晚餐账单",
          category: "food",
          amountMinor: 1234,
          currency: "CNY",
          exchangeRateToBase: "1",
          payerParticipantId: participant.id,
          splitMethod: "equal",
          splitMeta: [{ participantId: participant.id, value: "1" }],
          incurredAt: Date.now(),
          dayItemId: (item.structuredContent as { id: string }).id,
        },
      },
    });
    expect(expense.isError).not.toBe(true);
    await page.goto(`/trips/${trip.id}/expenses`);
    await expect(
      page.getByText("Agent 晚餐账单", { exact: true }),
    ).toBeVisible();
    await page.goto(`/trips/${trip.id}/plan`);
    await expect(
      page.getByText("Agent 添加的晚餐", { exact: true }).first(),
    ).toBeVisible();
    await page.goto("/settings");
    await section.getByRole("button", { name: "撤销令牌 E2E Agent" }).click();
    await expect(section.getByText("还没有访问令牌。")).toBeVisible();
    await expect(
      client.callTool({ name: "list_trips", arguments: {} }),
    ).rejects.toThrow();
  } finally {
    await client.close();
  }
});
