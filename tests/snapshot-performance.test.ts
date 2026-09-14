import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { itineraryDays } from "@/domain/itinerary";
import { calculateBalances } from "@/domain/money";
import type { Day, DayPlan } from "@/domain/types";

const directory = mkdtempSync(`${tmpdir()}/trip-snapshot-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
const { sqlite, insert, many } = await import("@/server/db");
const { createTrip, snapshot } = await import("@/server/trip-service");
const { dayGeometry } = await import("@/server/service-core");
const { createInvite, createParticipant, joinInvite, editMember } =
  await import("@/server/collaboration-service");
const { saveExpense } = await import("@/server/finance-service");
const actor = { id: "owner", name: "Owner", email: "owner@example.test" };
const viewer = { id: "viewer", name: "Viewer", email: "viewer@example.test" };
let tripId: string;
let smallTripId: string;
let days: DayPlan[];

beforeAll(() => {
  for (const user of [actor, viewer])
    insert("users", { ...user, createdAt: Date.now(), updatedAt: Date.now() });
  tripId = createTrip(actor, {
    title: "Synthetic performance fixture",
    startDate: "2026-10-01",
    endDate: "2026-10-07",
  }).id;
  smallTripId = createTrip(actor, { title: "Separate trip" }).id;
  const revision = {
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    updatedByUserId: actor.id,
  };
  sqlite.transaction(() => {
    many<Day>(
      "SELECT * FROM days WHERE tripId=? ORDER BY position",
      tripId,
    ).forEach((day, d) => {
      for (let p = 0; p < 5; p++)
        insert("day_items", {
          id: `item-${d}-${p}`,
          dayId: day.id,
          type: "place",
          title: `Place ${p}`,
          position: p,
          lat: 23 + p * 0.01,
          lng: 113 + p * 0.01,
          ...revision,
        });
      for (let l = 0; l < 4; l++) {
        const leg = `leg-${d}-${l}`;
        insert("travel_legs", {
          id: leg,
          dayId: day.id,
          fromItemId: `item-${d}-${l}`,
          toItemId: `item-${d}-${l + 1}`,
          status: "ready",
          selectedAlternativeId: `alt-${d}-${l}-0`,
          ...revision,
        });
        for (let a = 0; a < 3; a++)
          insert("route_alternatives", {
            id: `alt-${d}-${l}-${a}`,
            travelLegId: leg,
            fingerprint: `fp-${d}-${l}-${a}`,
            position: a,
            label: `Option ${a}`,
            distanceMeters: 3500,
            durationSeconds: 1800,
            polyline: Array.from({ length: 350 }, (_, p) => [
              113 +
                d * 0.02 +
                l * 0.01 +
                a * 0.001 +
                p * 0.0001 +
                Math.sin(p) * 0.00001,
              23 + d * 0.01 + l * 0.005 + Math.cos(p) * 0.0001,
            ]),
            steps: [
              {
                mode: "walking",
                instruction: "Walk to the next stop",
                distanceMeters: 3500,
                durationSeconds: 1800,
              },
            ],
            summary: "Synthetic route",
            geometryComplete: true,
            fetchedAt: Date.now(),
          });
      }
    });
  })();
  const participant = snapshot(tripId, actor).participants[0];
  for (let i = 0; i < 10; i++)
    saveExpense(tripId, actor, {
      title: `Expense ${i}`,
      category: "food",
      amountMinor: 100,
      currency: "CNY",
      exchangeRateToBase: "1",
      payerParticipantId: participant.id,
      splitMethod: "equal",
      splitMeta: [{ participantId: participant.id, value: "1" }],
      incurredAt: Date.now(),
    });
  createParticipant(tripId, actor, { name: "Guest" });
  createInvite(tripId, actor, {});
  days = snapshot(tripId, actor).days;
});
afterAll(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("bounded workspace payloads and snapshot reads", () => {
  it("preserves timetable instructions and financial data without sending map geometry", () => {
    const full = snapshot(tripId, actor);
    const plan = snapshot(tripId, actor, "plan");
    const expenses = snapshot(tripId, actor, "expenses");
    const view = snapshot(tripId, actor, "view");
    expect(JSON.stringify(full).length).toBeGreaterThan(1_000_000);
    expect(JSON.stringify(plan).length).toBeLessThan(
      JSON.stringify(full).length * 0.15,
    );
    expect(JSON.stringify(expenses).length).toBeLessThan(
      JSON.stringify(full).length * 0.1,
    );
    expect(plan.days[0].legs[0].alternatives[0]).not.toHaveProperty("polyline");
    expect(itineraryDays(plan.days)).toEqual(itineraryDays(full.days));
    expect(itineraryDays(view.days)).toEqual(itineraryDays(full.days));
    expect(expenses.expenses).toEqual(full.expenses);
    expect(expenses.days.flatMap((day) => day.items)).toEqual(
      full.days.flatMap((day) => day.items),
    );
    expect(
      calculateBalances(
        expenses.participants.map((p) => p.id),
        expenses.expenses,
        expenses.settlements,
      ),
    ).toEqual(
      calculateBalances(
        full.participants.map((p) => p.id),
        full.expenses,
        full.settlements,
      ),
    );
    expect(expenses.days.every((day) => !day.legs.length)).toBe(true);
    expect(expenses.poolPlaces).toEqual([]);
    expect(
      full.days.every((day) =>
        day.legs.every((leg) =>
          leg.alternatives.every((a) => a.polyline?.length === 350),
        ),
      ),
    ).toBe(true);
  });

  it("returns the correct members, invites and activity for each section", () => {
    const full = snapshot(tripId, actor);
    const members = snapshot(tripId, actor, "members");
    const activity = snapshot(tripId, actor, "activity");
    expect(members.participants).toEqual(full.participants);
    expect(members.invites).toEqual(full.invites);
    expect(
      members.days.every((day) => !day.items.length && !day.legs.length),
    ).toBe(true);
    expect(activity.activity).toEqual(full.activity);
    expect(activity.comments).toEqual(full.comments);
    expect(activity.sequence).toBe(full.sequence);
  });

  it("uses a fixed number of queries independent of day, route and expense counts", () => {
    const spy = vi.spyOn(sqlite, "prepare");
    try {
      snapshot(smallTripId, actor);
      const small = spy.mock.calls.length;
      spy.mockClear();
      snapshot(tripId, actor);
      expect(spy.mock.calls.length).toBe(small);
      expect(small).toBeLessThan(20);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps WAL reads available while another connection owns the writer lock", () => {
    const writer = new Database(process.env.DATABASE_PATH!);
    sqlite.pragma("busy_timeout = 25");
    try {
      writer.exec("BEGIN IMMEDIATE");
      expect(snapshot(tripId, actor, "expenses").trip.id).toBe(tripId);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
      sqlite.pragma("busy_timeout = 5000");
    }
  });

  it("loads only selected geometry for the requested day and uses the route index", () => {
    const result = dayGeometry(days[0].id, actor);
    expect(result.version).toBe(days[0].version);
    expect(result.alternatives.map((a) => a.id).sort()).toEqual(
      days[0].legs.map((leg) => leg.selectedAlternativeId).sort(),
    );
    expect(result.alternatives.every((a) => a.polyline.length === 350)).toBe(
      true,
    );
    const plan = sqlite
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM route_alternatives WHERE travelLegId=? ORDER BY position",
      )
      .all(days[0].legs[0].id);
    expect(JSON.stringify(plan)).toContain("alternatives_leg_position");
    expect(JSON.stringify(plan)).not.toContain("TEMP B-TREE");
  });

  it("authorizes both lightweight snapshots and geometry, including after access is revoked", () => {
    expect(() => dayGeometry(days[0].id, viewer)).toThrow("权限");
    expect(() => snapshot(tripId, viewer, "plan")).toThrow("权限");
    joinInvite(createInvite(tripId, actor, { role: "viewer" }).token, viewer);
    expect(dayGeometry(days[0].id, viewer).alternatives).toHaveLength(4);
    expect(snapshot(tripId, viewer, "members").invites).toEqual([]);
    editMember(tripId, viewer.id, actor, {
      expectedVersion: 1,
      status: "inactive",
    });
    expect(() => dayGeometry(days[0].id, viewer)).toThrow("权限");
    expect(() => snapshot(tripId, viewer, "expenses")).toThrow("权限");
    expect(
      snapshot(smallTripId, actor).days.flatMap((day) => day.legs),
    ).toEqual([]);
  });
});
