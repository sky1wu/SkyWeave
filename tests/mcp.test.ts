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
  ParticipantAlias,
  Settlement,
  Trip,
} from "@/domain/types";

const directory = mkdtempSync(`${tmpdir()}/trip-mcp-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
process.env.AMAP_TEST_MODE = "1";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
const s = await import("@/server/service");
const tokens = await import("@/server/mcp-tokens");
const { saveParticipantAlias } =
  await import("@/server/participant-alias-service");
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
          name: "get_participants",
          annotations: expect.objectContaining({ readOnlyHint: true }),
        }),
        expect.objectContaining({
          name: "update_participant_alias",
          annotations: expect.objectContaining({ readOnlyHint: false }),
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

type Participants = {
  tripId: string;
  participants: Participant[];
  participantAliases: ParticipantAlias[];
};
describe("MCP personal participant aliases", () => {
  const tools = ["get_participants", "get_expenses"];

  it("reads only the token owner's aliases for members and guests, including read-only viewers", async () => {
    const { trip, access } = fixture();
    s.joinInvite(
      s.createInvite(trip.id, owner, { role: "viewer" }).token,
      viewer,
    );
    const guestId = s.createParticipant(trip.id, owner, { name: "Guest" }).id;
    const before = s.snapshot(trip.id, owner);
    const member = before.participants.find((p) => p.userId === viewer.id)!;
    const guest = before.participants.find((p) => p.id === guestId)!;
    const ownerClient = await connect(access.token);
    const viewerAccess = tokens.createMcpToken(viewer, {
      name: "Read personal aliases",
      tripId: trip.id,
      permission: "read",
    });
    const viewerClient = await connect(viewerAccess.token);
    for (const tool of tools) {
      const data = await call<Participants>(viewerClient, tool, {
        tripId: trip.id,
      });
      expect(data.participantAliases).toEqual([]);
    }
    for (const actor of [owner, viewer]) {
      const aliases = [member, guest].map((participant) =>
        saveParticipantAlias(trip.id, participant.id, actor, {
          name: `${actor.id}-private-${participant.name}`,
          expectedVersion: 0,
        }),
      );
      const client = actor === owner ? ownerClient : viewerClient;
      for (const tool of tools) {
        const data = await call<Participants>(client, tool, {
          tripId: trip.id,
        });
        expect(data.tripId).toBe(trip.id);
        expect(data.participants).toEqual(before.participants);
        expect(data.participantAliases).toHaveLength(2);
        expect(data.participantAliases).toEqual(
          expect.arrayContaining(aliases),
        );
        expect(JSON.stringify(data)).not.toContain("email");
      }
    }
    const cleared = saveParticipantAlias(trip.id, member.id, owner, {
      name: "",
      expectedVersion: 1,
    });
    for (const tool of tools) {
      const own = await call<Participants>(ownerClient, tool, {
        tripId: trip.id,
      });
      expect(own.participantAliases).toContainEqual(cleared);
      expect(JSON.stringify(own)).not.toContain("mcp-viewer-private-");
      const other = await call<Participants>(viewerClient, tool, {
        tripId: trip.id,
      });
      expect(other.participantAliases).toContainEqual({
        participantId: member.id,
        name: "mcp-viewer-private-Viewer",
        version: 1,
      });
      expect(JSON.stringify(other)).not.toContain("mcp-owner-private-");
    }
    expect(s.snapshot(trip.id, owner)).toEqual(before);
  });

  it("enforces trip scope, rejects caller identity overrides and checks membership on every read", async () => {
    const { trip, access } = fixture();
    const other = s.createTrip(owner, { title: "Other alias trip" });
    const foreignParticipant = s.snapshot(other.id, owner).participants[0];
    saveParticipantAlias(other.id, foreignParticipant.id, owner, {
      name: "Other trip private alias",
      expectedVersion: 0,
    });
    const scoped = await connect(access.token);
    s.joinInvite(
      s.createInvite(trip.id, owner, { role: "viewer" }).token,
      viewer,
    );
    const allTrips = tokens.createMcpToken(viewer, {
      name: "Read accessible aliases",
      permission: "read",
    });
    const reader = await connect(allTrips.token);
    for (const tool of tools) {
      await error(scoped, tool, { tripId: other.id }, "TOKEN_SCOPE");
      await error(reader, tool, { tripId: other.id }, "NOT_FOUND");
      await error(scoped, tool, { tripId: trip.id, userId: viewer.id });
      const data = await call<Participants>(scoped, tool, {
        tripId: trip.id,
      });
      expect(data.participantAliases).toEqual([]);
      await call(reader, tool, { tripId: trip.id });
    }
    s.editMember(trip.id, viewer.id, owner, {
      status: "inactive",
      expectedVersion: 1,
    });
    for (const tool of tools)
      await error(reader, tool, { tripId: trip.id }, "NOT_FOUND");
  });
});

describe("MCP personal participant alias writes", () => {
  const tool = "update_participant_alias";

  it("sets, updates and clears guest aliases using their own versions, including concurrent browser edits", async () => {
    const { trip, access } = fixture();
    const guest = s.createParticipant(trip.id, owner, { name: "同行者原名" });
    const before = s.snapshot(trip.id, owner);
    const client = await connect(access.token);
    const target = { tripId: trip.id, participantId: guest.id };
    const created = await call<ParticipantAlias>(client, tool, {
      ...target,
      name: "  我的称呼  ",
      expectedVersion: 0,
    });
    expect(created).toEqual({ ...target, name: "我的称呼", version: 1 });
    const updated = await call<ParticipantAlias>(client, tool, {
      ...target,
      name: "新的称呼",
      expectedVersion: created.version,
    });
    expect(updated).toEqual({ ...target, name: "新的称呼", version: 2 });
    await error(
      client,
      tool,
      {
        ...target,
        name: "过期写入",
        expectedVersion: created.version,
      },
      "CONFLICT",
    );
    const browser = saveParticipantAlias(trip.id, guest.id, owner, {
      name: "网页中的称呼",
      expectedVersion: updated.version,
    });
    await error(
      client,
      tool,
      {
        ...target,
        name: "覆盖网页修改",
        expectedVersion: updated.version,
      },
      "CONFLICT",
    );
    const latest = await call<Participants>(client, "get_participants", {
      tripId: trip.id,
    });
    expect(latest.participantAliases).toEqual([browser]);
    const cleared = await call<ParticipantAlias>(client, tool, {
      ...target,
      name: "",
      expectedVersion: latest.participantAliases[0].version,
    });
    expect(cleared).toEqual({ ...target, name: "", version: 4 });
    for (const expectedVersion of [0, browser.version])
      await error(
        client,
        tool,
        {
          ...target,
          name: "清空前的版本",
          expectedVersion,
        },
        "CONFLICT",
      );
    const restored = await call<ParticipantAlias>(client, tool, {
      ...target,
      name: "重新设置",
      expectedVersion: cleared.version,
    });
    expect(restored).toEqual({ ...target, name: "重新设置", version: 5 });
    for (const readTool of ["get_participants", "get_expenses"]) {
      const data = await call<Participants>(client, readTool, {
        tripId: trip.id,
      });
      expect(data.participantAliases).toEqual([
        { participantId: guest.id, name: "重新设置", version: 5 },
      ]);
      expect(data.participants).toEqual(before.participants);
    }
    expect(s.snapshot(trip.id, owner)).toEqual(before);
  });

  it("allows a viewer's scoped edit token to change only personal aliases and rejects read-only tokens and removed members", async () => {
    const { trip, access, days } = fixture();
    s.joinInvite(
      s.createInvite(trip.id, owner, { role: "viewer" }).token,
      viewer,
    );
    const before = s.snapshot(trip.id, owner);
    const participant = before.participants.find((p) => p.userId === owner.id)!;
    const target = { tripId: trip.id, participantId: participant.id };
    const ownerClient = await connect(access.token);
    await call(ownerClient, tool, {
      ...target,
      name: "owner 的私有备注",
      expectedVersion: 0,
    });
    const edit = tokens.createMcpToken(viewer, {
      name: "Viewer personal edits",
      tripId: trip.id,
      permission: "edit",
    });
    const client = await connect(edit.token);
    expect(
      await call(client, tool, {
        ...target,
        name: "viewer 的私有备注",
        expectedVersion: 0,
      }),
    ).toEqual({ ...target, name: "viewer 的私有备注", version: 1 });
    const read = tokens.createMcpToken(viewer, {
      name: "Read-only aliases",
      tripId: trip.id,
      permission: "read",
    });
    const reader = await connect(read.token);
    await error(
      reader,
      tool,
      {
        ...target,
        name: "只读令牌覆盖",
        expectedVersion: 1,
      },
      "TOKEN_READ_ONLY",
    );
    await error(
      client,
      "update_day",
      {
        tripId: trip.id,
        dayId: days[0].id,
        expectedVersion: days[0].version,
        startMinutes: 600,
      },
      "FORBIDDEN",
    );
    for (const [actor, tokenClient] of [
      [owner, ownerClient],
      [viewer, reader],
    ] as const) {
      const data = await call<Participants>(tokenClient, "get_participants", {
        tripId: trip.id,
      });
      expect(data.participantAliases).toEqual([
        {
          participantId: participant.id,
          name: `${actor === owner ? "owner" : "viewer"} 的私有备注`,
          version: 1,
        },
      ]);
    }
    expect(s.snapshot(trip.id, owner)).toEqual(before);
    s.editMember(trip.id, viewer.id, owner, {
      status: "inactive",
      expectedVersion: 1,
    });
    await error(
      client,
      tool,
      {
        ...target,
        name: "移出后修改",
        expectedVersion: 1,
      },
      "NOT_FOUND",
    );
    expect(() =>
      tokens.createMcpToken(viewer, {
        name: "Removed member",
        tripId: trip.id,
        permission: "edit",
      }),
    ).toThrow();
  });

  it("rejects foreign trips and participants, caller overrides and invalid inputs without changing aliases", async () => {
    const { trip, access } = fixture();
    const other = s.createTrip(owner, { title: "Other alias writes" });
    const participant = s.snapshot(trip.id, owner).participants[0];
    const foreign = s.snapshot(other.id, owner).participants[0];
    const existing = saveParticipantAlias(trip.id, participant.id, owner, {
      name: "保留备注",
      expectedVersion: 0,
    });
    const client = await connect(access.token);
    const args = {
      tripId: trip.id,
      participantId: participant.id,
      name: "不应保存",
      expectedVersion: existing.version,
    };
    await error(client, tool, { ...args, tripId: other.id }, "TOKEN_SCOPE");
    for (const participantId of [foreign.id, "missing"])
      await error(client, tool, { ...args, participantId }, "NOT_FOUND");
    for (const invalid of [
      { ...args, userId: viewer.id },
      { ...args, name: null },
      { ...args, name: "x".repeat(101) },
      { ...args, name: undefined },
      { ...args, expectedVersion: -1 },
      { ...args, expectedVersion: 0.5 },
      { ...args, expectedVersion: undefined },
    ])
      await error(client, tool, invalid);
    expect(
      (
        await call<Participants>(client, "get_participants", {
          tripId: trip.id,
        })
      ).participantAliases,
    ).toEqual([existing]);
    const outsider = tokens.createMcpToken(editor, {
      name: "No trip access",
      permission: "edit",
    });
    await error(await connect(outsider.token), tool, args, "NOT_FOUND");
    expect(() =>
      tokens.createMcpToken(editor, {
        name: "No membership",
        tripId: trip.id,
        permission: "edit",
      }),
    ).toThrow();
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

it("supports atomic group planning and section copying through MCP and enforces read-only tokens", async () => {
  const owner = {
    id: crypto.randomUUID(),
    name: "Group owner",
    email: `${crypto.randomUUID()}@example.test`,
  };
  insert("users", { ...owner, createdAt: 0, updatedAt: 0 });
  const trip = s.createTrip(owner, {
    title: "MCP 分组验证",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
  });
  const data = s.snapshot(trip.id, owner);
  const f = {
    trip: data.trip,
    days: data.days,
    access: tokens.createMcpToken(owner, {
      name: "Groups",
      tripId: trip.id,
      permission: "edit",
    }),
  };
  const guest = s.createParticipant(f.trip.id, owner, { name: "分组同行者" });
  const start = s.createItem(f.days[0].id, owner, { title: "共同出发点" }),
    end = s.createItem(f.days[0].id, owner, { title: "共同集合点" });
  const client = await connect(f.access.token);
  const expectedDays = () =>
    s
      .snapshot(f.trip.id, owner)
      .days.map((day) => ({ id: day.id, expectedVersion: day.version }));
  const request = {
    tripId: f.trip.id,
    dayId: f.days[0].id,
    title: "MCP 分组",
    parallelPlan: {
      splitItemId: start.id,
      joinItemId: end.id,
      joinPolicy: "wait_all",
      branches: [
        {
          id: crypto.randomUUID(),
          title: "甲组",
          participantIds: [data.participants[0].id],
          startMinutes: null,
        },
        {
          id: crypto.randomUUID(),
          title: "乙组",
          participantIds: [guest.id],
          startMinutes: null,
        },
      ],
    },
    expectedDays: expectedDays(),
  };
  const saved = await call<{ id: string }>(
    client,
    "save_parallel_section",
    request,
  );
  const copied = await call<{ id: string }>(
    client,
    "transfer_parallel_section",
    {
      tripId: f.trip.id,
      sectionId: saved.id,
      operation: "copy",
      targetDayId: f.days[1].id,
      expectedDays: expectedDays(),
    },
  );
  expect(
    s.getDay(f.days[1].id).items.some((item) => item.id === copied.id),
  ).toBe(true);
  const read = tokens.createMcpToken(owner, {
    name: "Read groups",
    tripId: f.trip.id,
    permission: "read",
  });
  const viewer = await connect(read.token);
  const denied = await viewer.callTool({
    name: "save_parallel_section",
    arguments: { ...request, expectedDays: expectedDays() },
  });
  expect(denied.isError).toBe(true);
});

it("MCP sets inclusive personal participation boundaries and enforces token write permission", async () => {
  const f = fixture(),
    client = await connect(f.access.token);
  const person = s.createParticipant(f.trip.id, owner, {
    name: "中途同行者",
  }).id;
  const start = s.createItem(f.days[0].id, owner, { title: "加入点" });
  const end = s.createItem(f.days[1].id, owner, { title: "离开点" });
  const expectedDays = () =>
    s
      .snapshot(f.trip.id, owner)
      .days.map((day) => ({ id: day.id, expectedVersion: day.version }));
  await call(client, "set_participation", {
    tripId: f.trip.id,
    participantId: person,
    joinItemId: start.id,
    leaveItemId: end.id,
    expectedDays: expectedDays(),
  });
  expect(
    s.getDay(f.days[0].id).items.find((i) => i.id === start.id)
      ?.joinParticipantIds,
  ).toEqual([person]);
  expect(
    s.getDay(f.days[1].id).items.find((i) => i.id === end.id)
      ?.leaveParticipantIds,
  ).toEqual([person]);
  tokens.revokeMcpToken(owner, f.access.id);
  const read = tokens.createMcpToken(owner, {
    name: "Read-only boundaries",
    tripId: f.trip.id,
    permission: "read",
  });
  const readClient = await connect(read.token);
  const response = await readClient.callTool({
    name: "set_participation",
    arguments: {
      tripId: f.trip.id,
      participantId: person,
      leaveItemId: null,
      expectedDays: expectedDays(),
    },
  });
  expect(response.isError).toBe(true);
});
