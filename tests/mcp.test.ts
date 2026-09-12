import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  DayPlan,
  TripSnapshot,
  Participant,
  Settlement,
  Trip,
} from "@/domain/types";

const directory = mkdtempSync(`${tmpdir()}/trip-mcp-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
process.env.AMAP_TEST_MODE = "1";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
const s = await import("@/server/service");
const tokens = await import("@/server/mcp-tokens");
const { insert, one, sqlite } = await import("@/server/db");
const { POST: handle } = await import("@/app/api/mcp/route");
const url = "http://localhost:3000/api/mcp";
const owner = { id: "mcp-owner", name: "Owner", email: "owner@example.test" };
const editor = {
  id: "mcp-editor",
  name: "Editor",
  email: "editor@example.test",
};
const viewer = {
  id: "mcp-viewer",
  name: "Viewer",
  email: "viewer@example.test",
};
const clients: Client[] = [];
beforeAll(() => {
  for (const user of [owner, editor, viewer])
    insert("users", { ...user, createdAt: Date.now(), updatedAt: Date.now() });
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  vi.restoreAllMocks();
});
afterAll(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const trip = s.createTrip(owner, {
    title: "MCP 香港行",
    startDate: "2026-10-02",
    endDate: "2026-10-03",
  });
  const access = tokens.createMcpToken(owner, {
    name: "Test agent",
    tripId: trip.id,
    permission: "edit",
  });
  return {
    trip: s.getTrip(trip.id),
    access,
    days: s.snapshot(trip.id, owner).days,
  };
}
async function connect(token: string) {
  const client = new Client({ name: "skyweave-test", version: "1.0.0" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (input, init) => handle(new Request(input, init)),
    }),
  );
  return client;
}
async function call<T>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = (await client.callTool({
    name,
    arguments: args,
  })) as CallToolResult;
  expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
  expect(response.structuredContent).toBeDefined();
  expect(JSON.parse((response.content[0] as { text: string }).text)).toEqual(
    response.structuredContent,
  );
  return response.structuredContent as T;
}
async function error(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  code?: string,
) {
  const response = (await client.callTool({
    name,
    arguments: args,
  })) as CallToolResult;
  expect(response.isError).toBe(true);
  if (code)
    expect(response.structuredContent).toMatchObject({ error: { code } });
}

describe("MCP authentication and transport", () => {
  it("stores only hashed secrets and scopes token management to the current user", () => {
    const { access, trip } = fixture();
    expect(
      one<{ tokenHash: string }>(
        "SELECT tokenHash FROM mcp_tokens WHERE id=?",
        access.id,
      )?.tokenHash,
    ).toHaveLength(64);
    const listed = tokens.listMcpTokens(owner);
    expect(JSON.stringify(listed)).not.toContain(access.token);
    expect(listed.find((token) => token.id === access.id)).not.toHaveProperty(
      "tokenHash",
    );
    expect(tokens.listMcpTokens(editor)).not.toContainEqual(
      expect.objectContaining({ id: access.id }),
    );
    expect(() => tokens.revokeMcpToken(editor, access.id)).toThrow(
      "令牌不存在",
    );
    expect(() =>
      tokens.createMcpToken(editor, { name: "No membership", tripId: trip.id }),
    ).toThrow();
  });
  it("requires Bearer authentication, rejects foreign origins and oversized/invalid requests", async () => {
    const { access } = fixture();
    const headers = {
      Authorization: `Bearer ${access.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    expect((await handle(new Request(url))).status).toBe(401);
    expect(
      (
        await handle(
          new Request(url, { headers: { Cookie: "session=anything" } }),
        )
      ).status,
    ).toBe(401);
    expect((await handle(new Request(url, { headers }))).status).toBe(405);
    expect(
      (await handle(new Request(url, { method: "DELETE", headers }))).status,
    ).toBe(405);
    expect(
      (
        await handle(
          new Request(url, {
            method: "POST",
            headers: { ...headers, Origin: "https://evil.example" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handle(new Request(url, { method: "POST", headers, body: "{" })))
        .status,
    ).toBe(400);
    expect(
      (
        await handle(
          new Request(url, {
            method: "POST",
            headers,
            body: "x".repeat(524289),
          }),
        )
      ).status,
    ).toBe(413);
    const bad = await handle(
      new Request(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "unknown" }),
      }),
    );
    expect((await bad.json()).error.code).toBe(-32601);
    expect(bad.headers.get("Cache-Control")).toBe("no-store");
  });
  it("negotiates the protocol with the official SDK and publishes typed annotated tools", async () => {
    const { access } = fixture();
    const client = await connect(access.token);
    const list = await client.listTools();
    expect(list.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "get_itinerary",
          annotations: expect.objectContaining({ readOnlyHint: true }),
        }),
        expect.objectContaining({
          name: "delete_expense",
          annotations: expect.objectContaining({ destructiveHint: true }),
        }),
      ]),
    );
    const create = list.tools.find((tool) => tool.name === "create_item")!;
    expect(create.inputSchema.required).toContain("expectedDayVersion");
    const data = await call<{ trips: Trip[] }>(client, "list_trips");
    expect(data.trips).toHaveLength(1);
    expect(
      tokens.listMcpTokens(owner).find((token) => token.id === access.id)
        ?.lastUsedAt,
    ).toBeTypeOf("number");
  });
  it("expires and revokes credentials on the next HTTP request, including existing clients", async () => {
    const { access, trip } = fixture();
    const client = await connect(access.token);
    tokens.revokeMcpToken(owner, access.id);
    await expect(
      client.callTool({ name: "list_trips", arguments: {} }),
    ).rejects.toThrow();
    const expiring = tokens.createMcpToken(owner, {
      name: "Expiring",
      tripId: trip.id,
      expiresInDays: 1,
    });
    vi.spyOn(Date, "now").mockReturnValue(expiring.expiresAt);
    expect(() =>
      tokens.authenticateMcp(
        new Request(url, {
          headers: { Authorization: `Bearer ${expiring.token}` },
        }),
      ),
    ).toThrow("过期");
  });
  it("deleting a scoped trip revokes its token instead of broadening its scope", () => {
    const { access, trip } = fixture();
    s.deleteTrip(trip.id, owner, trip.version);
    expect(() =>
      tokens.authenticateMcp(
        new Request(url, {
          headers: { Authorization: `Bearer ${access.token}` },
        }),
      ),
    ).toThrow();
  });
});

describe("MCP itinerary permissions and edits", () => {
  it("preserves omitted fields, reports stale versions, moves and deletes items through the SDK", async () => {
    const { access, trip, days } = fixture();
    const client = await connect(access.token);
    const a = await call<{ id: string; day: DayPlan }>(client, "create_item", {
      tripId: trip.id,
      dayId: days[0].id,
      expectedDayVersion: days[0].version,
      item: {
        title: "夜游",
        type: "event",
        fixedTime: true,
        startMinutes: 1380,
        endMinutes: 1500,
        stayMinutes: 120,
      },
    });
    const b = await call<{ day: DayPlan }>(client, "update_item", {
      tripId: trip.id,
      itemId: a.id,
      expectedVersion: 1,
      changes: { notes: "次日结束" },
    });
    expect(b.day.items[0]).toMatchObject({
      fixedTime: true,
      type: "event",
      stayMinutes: 120,
      version: 2,
    });
    await error(
      client,
      "update_item",
      {
        tripId: trip.id,
        itemId: a.id,
        expectedVersion: 1,
        changes: { title: "覆盖" },
      },
      "CONFLICT",
    );
    await error(
      client,
      "create_item",
      {
        tripId: trip.id,
        dayId: days[0].id,
        expectedDayVersion: days[0].version,
        item: { title: "过期新增" },
      },
      "CONFLICT",
    );
    const moved = await call<{
      source: { day: DayPlan };
      target: { day: DayPlan };
    }>(client, "move_item", {
      tripId: trip.id,
      itemId: a.id,
      dayId: days[1].id,
      expectedVersion: 2,
      expectedSourceDayVersion: b.day.version,
      expectedTargetDayVersion: days[1].version,
    });
    expect(moved.source.day.items).toHaveLength(0);
    expect(moved.target.day.items[0].id).toBe(a.id);
    const deleted = await call<{ day: DayPlan }>(client, "delete_item", {
      tripId: trip.id,
      itemId: a.id,
      expectedVersion: moved.target.day.items[0].version,
    });
    expect(deleted.day.items).toHaveLength(0);
    expect(s.snapshot(trip.id, owner).activity[0].actorUserId).toBe(owner.id);
  });
  it("does not accept extra fields or mismatched trip/entity IDs even if the user owns both trips", async () => {
    const { access, trip, days } = fixture();
    const other = fixture();
    const client = await connect(access.token);
    await error(
      client,
      "get_itinerary",
      { tripId: other.trip.id },
      "TOKEN_SCOPE",
    );
    await error(
      client,
      "get_day",
      { tripId: trip.id, dayId: other.days[0].id },
      "NOT_FOUND",
    );
    const foreign = s.createItem(other.days[0].id, owner, {
      title: "Other trip",
    });
    await error(
      client,
      "delete_item",
      { tripId: trip.id, itemId: foreign.id, expectedVersion: 1 },
      "NOT_FOUND",
    );
    await error(client, "create_item", {
      tripId: trip.id,
      dayId: days[0].id,
      expectedDayVersion: days[0].version,
      item: { title: "Invalid", unexpected: true },
    });
    expect(s.getDay(days[0].id).items).toHaveLength(0);
    expect(s.getDay(other.days[0].id).items).toHaveLength(1);
  });
  it("checks read-only tokens and live member permissions for writes and reads", async () => {
    const { trip, days } = fixture();
    const read = tokens.createMcpToken(owner, {
      name: "Read",
      tripId: trip.id,
    });
    const readClient = await connect(read.token);
    await call(readClient, "get_itinerary", { tripId: trip.id });
    await error(
      readClient,
      "update_day",
      {
        tripId: trip.id,
        dayId: days[0].id,
        expectedVersion: 1,
        startMinutes: 600,
      },
      "TOKEN_READ_ONLY",
    );
    s.joinInvite(
      s.createInvite(trip.id, owner, { role: "editor" }).token,
      editor,
    );
    const edit = tokens.createMcpToken(editor, {
      name: "Editor",
      permission: "edit",
      tripId: trip.id,
    });
    const editorClient = await connect(edit.token);
    await call(editorClient, "update_day", {
      tripId: trip.id,
      dayId: days[0].id,
      expectedVersion: 1,
      startMinutes: 600,
    });
    await error(
      editorClient,
      "update_trip",
      { tripId: trip.id, expectedVersion: 1, changes: { title: "Owner only" } },
      "FORBIDDEN",
    );
    s.editMember(trip.id, editor.id, owner, {
      expectedVersion: 1,
      role: "viewer",
    });
    await error(
      editorClient,
      "update_day",
      {
        tripId: trip.id,
        dayId: days[0].id,
        expectedVersion: 2,
        startMinutes: 700,
      },
      "FORBIDDEN",
    );
    s.editMember(trip.id, editor.id, owner, {
      expectedVersion: 2,
      status: "inactive",
    });
    await error(
      editorClient,
      "get_itinerary",
      { tripId: trip.id },
      "NOT_FOUND",
    );
    expect(
      (await call<{ trips: Trip[] }>(editorClient, "list_trips")).trips,
    ).toHaveLength(0);
  });
  it("searches, schedules pool places, reorders and recalculates routes without a browser", async () => {
    const { access, trip, days } = fixture();
    const client = await connect(access.token);
    const search = await call<{ places: unknown[] }>(client, "search_places", {
      tripId: trip.id,
      query: "西安",
      city: "西安",
    });
    expect(search.places.length).toBeGreaterThan(0);
    const place = await call<{ id: string }>(client, "save_place", {
      tripId: trip.id,
      place: { title: "A", lat: 34, lng: 108 },
    });
    const a = await call<{ id: string; day: DayPlan }>(
      client,
      "schedule_place",
      {
        tripId: trip.id,
        dayId: days[0].id,
        placeId: place.id,
        expectedVersion: 1,
        expectedDayVersion: days[0].version,
      },
    );
    const b = await call<{ id: string; day: DayPlan }>(client, "create_item", {
      tripId: trip.id,
      dayId: days[0].id,
      expectedDayVersion: a.day.version,
      item: { title: "B", lat: 34.1, lng: 108.1 },
    });
    const reordered = await call<{ day: DayPlan }>(client, "reorder_items", {
      tripId: trip.id,
      dayId: days[0].id,
      expectedVersion: b.day.version,
      itemIds: [b.id, a.id],
    });
    expect(reordered.day.items.map((item) => item.id)).toEqual([b.id, a.id]);
    const routes = await call<{ day: DayPlan }>(client, "recalculate_routes", {
      tripId: trip.id,
      dayId: days[0].id,
    });
    expect(routes.day.legs[0].alternatives.length).toBeGreaterThan(0);
    await call(client, "update_leg", {
      tripId: trip.id,
      legId: routes.day.legs[0].id,
      expectedVersion: routes.day.legs[0].version,
      mode: "manual",
      manualDurationMinutes: 30,
    });
    await call(client, "reorder_days", {
      tripId: trip.id,
      expectedVersion: trip.version,
      dayIds: [days[1].id, days[0].id],
    });
    expect(s.snapshot(trip.id, owner).days[0].id).toBe(days[1].id);
  });
});

type Finances = {
  id: string;
  expenses: TripSnapshot["expenses"];
  settlements: Settlement[];
  participants: Participant[];
  balances: { participantId: string; net: number }[];
};
describe("MCP expenses and settlements", () => {
  it("creates, updates and deletes split expenses and settlement records with version checks", async () => {
    const { access, trip, days } = fixture();
    const guest = s.createParticipant(trip.id, owner, { name: "Guest" });
    const client = await connect(access.token);
    const initial = await call<Finances>(client, "get_expenses", {
      tripId: trip.id,
    });
    const payer = initial.participants.find((p) => p.userId === owner.id)!;
    const expense = {
      title: "晚餐",
      category: "food",
      amountMinor: 10001,
      currency: "HKD",
      exchangeRateToBase: "0.9",
      payerParticipantId: payer.id,
      splitMethod: "equal",
      splitMeta: [
        { participantId: payer.id, value: "1" },
        { participantId: guest.id, value: "1" },
      ],
      incurredAt: Date.now(),
      dayId: days[0].id,
    };
    const created = await call<Finances>(client, "create_expense", {
      tripId: trip.id,
      expense,
    });
    expect(
      created.expenses[0].splits.reduce(
        (sum, split) => sum + split.amountMinor,
        0,
      ),
    ).toBe(10001);
    expect(
      created.expenses[0].splits.reduce(
        (sum, split) => sum + split.baseAmountMinor,
        0,
      ),
    ).toBe(created.expenses[0].baseAmountMinor);
    const updated = await call<Finances>(client, "update_expense", {
      tripId: trip.id,
      expenseId: created.id,
      expectedVersion: 1,
      expense: { ...expense, amountMinor: 20000 },
    });
    expect(updated.expenses[0]).toMatchObject({
      amountMinor: 20000,
      version: 2,
    });
    await error(
      client,
      "update_expense",
      { tripId: trip.id, expenseId: created.id, expectedVersion: 1, expense },
      "CONFLICT",
    );
    const balance = await call<Finances>(client, "get_balances", {
      tripId: trip.id,
    });
    expect(
      balance.balances.find((p) => p.participantId === guest.id)?.net,
    ).toBe(-9000);
    const paid = await call<Finances>(client, "create_settlement", {
      tripId: trip.id,
      settlement: {
        fromParticipantId: guest.id,
        toParticipantId: payer.id,
        amountMinor: 9000,
        currency: "CNY",
        exchangeRateToBase: "1",
        settledAt: Date.now(),
      },
    });
    expect(paid.balances.every((p) => p.net === 0)).toBe(true);
    await error(
      client,
      "delete_settlement",
      { tripId: trip.id, settlementId: paid.id, expectedVersion: 2 },
      "CONFLICT",
    );
    const unpaid = await call<Finances>(client, "delete_settlement", {
      tripId: trip.id,
      settlementId: paid.id,
      expectedVersion: 1,
    });
    expect(unpaid.settlements).toHaveLength(0);
    expect(unpaid.balances.find((p) => p.participantId === guest.id)?.net).toBe(
      -9000,
    );
    await error(
      client,
      "delete_expense",
      { tripId: trip.id, expenseId: created.id, expectedVersion: 1 },
      "CONFLICT",
    );
    const deleted = await call<Finances>(client, "delete_expense", {
      tripId: trip.id,
      expenseId: created.id,
      expectedVersion: 2,
    });
    expect(deleted.expenses).toHaveLength(0);
    expect(deleted.balances.every((p) => p.net === 0)).toBe(true);
  });
  it("rejects read-only/viewer writes, cross-trip records and invalid financial inputs without saving", async () => {
    const { trip, access } = fixture();
    const other = fixture();
    const participant = s.snapshot(trip.id, owner).participants[0];
    const foreignParticipant = s.snapshot(other.trip.id, owner).participants[0];
    const client = await connect(access.token);
    const expense = {
      title: "测试",
      category: "other",
      amountMinor: 100,
      currency: "CNY",
      exchangeRateToBase: "1",
      payerParticipantId: participant.id,
      splitMethod: "equal",
      splitMeta: [{ participantId: participant.id, value: "1" }],
      incurredAt: Date.now(),
    };
    await error(client, "create_expense", {
      tripId: trip.id,
      expense: { ...expense, payerParticipantId: foreignParticipant.id },
    });
    await error(client, "create_expense", {
      tripId: trip.id,
      expense: { ...expense, amountMinor: 1.1 },
    });
    await error(
      client,
      "create_expense",
      { tripId: trip.id, expense: { ...expense, exchangeRateToBase: "0" } },
      "INVALID_MONEY",
    );
    const foreign = s.saveExpense(other.trip.id, owner, {
      ...expense,
      payerParticipantId: foreignParticipant.id,
      splitMeta: [{ participantId: foreignParticipant.id, value: "1" }],
    });
    await error(
      client,
      "delete_expense",
      { tripId: trip.id, expenseId: foreign.id, expectedVersion: 1 },
      "NOT_FOUND",
    );
    await error(
      client,
      "update_expense",
      { tripId: trip.id, expenseId: foreign.id, expectedVersion: 1, expense },
      "NOT_FOUND",
    );
    const read = tokens.createMcpToken(owner, {
      name: "Read finances",
      tripId: trip.id,
    });
    const reader = await connect(read.token);
    await call(reader, "get_expenses", { tripId: trip.id });
    await error(
      reader,
      "create_expense",
      { tripId: trip.id, expense },
      "TOKEN_READ_ONLY",
    );
    s.joinInvite(
      s.createInvite(trip.id, owner, { role: "viewer" }).token,
      viewer,
    );
    const view = tokens.createMcpToken(viewer, {
      name: "Cannot elevate",
      permission: "edit",
    });
    const viewerClient = await connect(view.token);
    await error(
      viewerClient,
      "create_expense",
      { tripId: trip.id, expense },
      "FORBIDDEN",
    );
    expect(s.snapshot(trip.id, owner).expenses).toHaveLength(0);
    expect(s.snapshot(other.trip.id, owner).expenses).toHaveLength(1);
  });
});
