import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { calculateTimeline } from "@/domain/timeline";
import { compilePlan } from "@/domain/plan-graph";
import { participantDay } from "@/domain/parallel";
import { itineraryDays } from "@/domain/itinerary";
import { mapLocations } from "@/domain/map-locations";
import { itemPayload } from "@/components/item-editor";

const directory = mkdtempSync(`${tmpdir()}/item-participants-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
const s = await import("@/server/service");
const files = await import("@/server/trip-file-service");
const { parseTripFile } = await import("@/server/trip-file-schema");
const { insert, sqlite } = await import("@/server/db");
const actor = {
  id: "item-people-owner",
  name: "甲",
  email: "item-people@example.test",
};
insert("users", { ...actor, createdAt: 0, updatedAt: 0 });
afterAll(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const trip = s.createTrip(actor, {
    title: "两人乘机，其他人留下",
    startDate: "2026-10-07",
    endDate: "2026-10-08",
  });
  const snapshot = s.snapshot(trip.id, actor),
    dayId = snapshot.days[0].id;
  const people = [
    snapshot.participants[0].id,
    s.createParticipant(trip.id, actor, { name: "乙" }).id,
    s.createParticipant(trip.id, actor, { name: "丙" }).id,
  ];
  s.editDay(dayId, actor, {
    expectedVersion: s.getDay(dayId).version,
    startMinutes: 300,
  });
  const start = s.createItem(dayId, actor, {
    title: "酒店",
    lat: 23,
    lng: 113,
    stayMinutes: 10,
  }).id;
  const flight = s.createItem(dayId, actor, {
    title: "广州飞西安",
    type: "transport",
    startMinutes: 385,
    endMinutes: 535,
    fixedTime: true,
    participantIds: people.slice(0, 2),
    transport: {
      mode: "flight",
      status: "confirmed",
      serviceNumber: "AQ1105",
      origin: { name: "广州机场", lat: 23.4, lng: 113.3 },
      destination: { name: "西安机场", lat: 34.4, lng: 108.7 },
    },
  }).id;
  const end = s.createItem(dayId, actor, {
    title: "后续安排",
    lat: 23.1,
    lng: 113.1,
    stayMinutes: 20,
  }).id;
  for (const leg of s.getDay(dayId).legs)
    s.editLeg(leg.id, actor, {
      expectedVersion: leg.version,
      mode: "manual",
      manualDurationMinutes: 15,
    });
  const day = () => s.getDay(dayId);
  const patch = (participantIds: string[] | null) =>
    s.editItem(flight, actor, {
      expectedVersion: day().items.find((i) => i.id === flight)!.version,
      participantIds,
    });
  return { tripId: trip.id, dayId, people, start, flight, end, day, patch };
}

describe("item participants", () => {
  it("keeps each person's route and clock independent without requiring groups", () => {
    const f = fixture(),
      day = f.day();
    const graph = compilePlan([day]);
    expect(graph.paths.get(f.people[0])!.map((s) => s.itemId)).toEqual([
      f.start,
      f.flight,
      f.end,
    ]);
    expect(graph.paths.get(f.people[2])!.map((s) => s.itemId)).toEqual([
      f.start,
      f.end,
    ]);
    expect(
      graph.connections.find((c) => c.from.id === f.start && c.to.id === f.end)
        ?.participantIds,
    ).toEqual([f.people[2]]);
    const own = calculateTimeline(day, undefined, f.people[2]);
    expect(own.entries.find((e) => e.itemId === f.end)?.start).toBe(325 * 60);
    const flying = calculateTimeline(day, undefined, f.people[0]);
    expect(flying.entries.find((e) => e.itemId === f.end)?.start).toBe(
      550 * 60,
    );
    const selected = participantDay(day, f.people[2], own);
    expect(selected.items.map((i) => i.id)).toEqual([f.start, f.end]);
    expect(selected.legs.map((l) => [l.fromItemId, l.toItemId])).toEqual([
      [f.start, f.end],
    ]);
    expect(
      mapLocations(selected, [], [day]).some(
        (point) => point.itemId === f.flight,
      ),
    ).toBe(false);
    expect(
      itineraryDays([day], [], f.people[2])[0].stops.map((stop) => stop.id),
    ).toEqual([f.start, f.end]);
    const all = itineraryDays(
      [day],
      s.snapshot(f.tripId, actor).participants,
    )[0];
    expect(
      all.stops.find((stop) => stop.id === f.flight)?.details,
    ).toContainEqual({ text: "参与者：甲、乙", kind: "info" });
  });

  it("persists edits, preserves unrelated items and expenses, and restores everyone with null", () => {
    const f = fixture();
    const bill = s.saveExpense(f.tripId, actor, {
      title: "机票",
      dayId: f.dayId,
      dayItemId: f.flight,
      amountMinor: 205800,
      currency: "CNY",
      exchangeRateToBase: "1",
      incurredAt: Date.now(),
      payerParticipantId: f.people[0],
      category: "transport",
      splitMethod: "equal",
      splitMeta: f.people
        .slice(0, 2)
        .map((participantId) => ({ participantId, value: "1" })),
    });
    expect(bill.id).toBeTruthy();
    const before = s.snapshot(f.tripId, actor);
    f.patch([f.people[1]]);
    const after = s.snapshot(f.tripId, actor);
    expect(after.expenses).toEqual(before.expenses);
    expect(after.days[0].items.filter((i) => i.id !== f.flight)).toEqual(
      before.days[0].items.filter((i) => i.id !== f.flight),
    );
    const unchangedLeg = before.days[0].legs.find(
      (l) => l.fromItemId === f.start && l.toItemId === f.end,
    )!;
    expect(after.days[0].legs.find((l) => l.id === unchangedLeg.id)).toEqual(
      unchangedLeg,
    );
    s.editItem(f.flight, actor, {
      expectedVersion: f.day().items.find((i) => i.id === f.flight)!.version,
      notes: "保持人员",
    });
    expect(
      f.day().items.find((i) => i.id === f.flight)?.participantIds,
    ).toEqual([f.people[1]]);
    f.patch(null);
    expect(
      f
        .day()
        .legs.some((l) => l.fromItemId === f.start && l.toItemId === f.end),
    ).toBe(false);
    expect(
      participantDay(
        f.day(),
        f.people[2],
        calculateTimeline(f.day()),
      ).items.some((i) => i.id === f.flight),
    ).toBe(true);
  });

  it("rejects empty, duplicate, foreign and stale selections atomically", () => {
    const f = fixture(),
      before = f.day();
    const foreignTrip = s.createTrip(actor, { title: "其他旅行" });
    const foreign = s.snapshot(foreignTrip.id, actor).participants[0].id;
    for (const selection of [[], [f.people[0], f.people[0]], [foreign]])
      expect(() => f.patch(selection)).toThrow();
    expect(f.day()).toEqual(before);
    const version = before.items.find((i) => i.id === f.flight)!.version;
    f.patch([f.people[1]]);
    expect(() =>
      s.editItem(f.flight, actor, {
        expectedVersion: version,
        participantIds: null,
      }),
    ).toThrow();
  });

  it("preserves selections when copying and round-trips them with new participant IDs", () => {
    const f = fixture(),
      flight = f.day().items.find((i) => i.id === f.flight)!;
    const copy = s.createItem(
      s.snapshot(f.tripId, actor).days[1].id,
      actor,
      itemPayload(flight),
    );
    expect(
      s.snapshot(f.tripId, actor).days[1].items.find((i) => i.id === copy.id)
        ?.participantIds,
    ).toEqual(f.people.slice(0, 2));
    const file = files.exportTripFile(f.tripId, actor);
    expect(file.version).toBe(6);
    const imported = files.importTripFile(actor, file),
      restored = s.snapshot(imported.id, actor);
    const restoredFlight = restored.days[0].items.find(
      (i) => i.title === flight.title,
    )!;
    expect(restoredFlight.participantIds).not.toEqual(flight.participantIds);
    expect(
      restoredFlight.participantIds?.map(
        (id) => restored.participants.find((p) => p.id === id)?.name,
      ),
    ).toEqual(["甲", "乙"]);
    expect(() =>
      parseTripFile(files.exportTripFile(imported.id, actor)),
    ).not.toThrow();
    const bad = structuredClone(file);
    bad.days[0].items.find((i) => i.id === f.flight)!.participantIds = [
      "missing-person",
    ];
    expect(() => parseTripFile(bad)).toThrow("参与者不属于此行程");
    f.patch(null);
    for (const version of [1, 2, 3, 4] as const) {
      const legacy = files.exportTripFile(f.tripId, actor);
      legacy.version = version;
      legacy.days.forEach((day) => {
        day.legs = [];
        day.items.forEach((item) => {
          delete item.participantIds;
        });
      });
      expect(() => files.importTripFile(actor, legacy)).not.toThrow();
    }
  });

  it("protects referenced people and generates bypass routes for newly added travelers", () => {
    const f = fixture(),
      participant = s
        .snapshot(f.tripId, actor)
        .participants.find((p) => p.id === f.people[1])!;
    expect(() =>
      s.deleteParticipant(f.tripId, participant.id, actor, participant.version),
    ).toThrow("已有事项安排");
    f.patch(f.people);
    expect(
      f
        .day()
        .legs.some((l) => l.fromItemId === f.start && l.toItemId === f.end),
    ).toBe(false);
    const extra = s.createParticipant(f.tripId, actor, { name: "新同行者" });
    expect(
      f
        .day()
        .legs.some((l) => l.fromItemId === f.start && l.toItemId === f.end),
    ).toBe(true);
    const timeline = calculateTimeline(f.day(), undefined, extra.id);
    expect(
      participantDay(f.day(), extra.id, timeline).items.map((i) => i.id),
    ).toEqual([f.start, f.end]);
  });

  it("constrains group items to their members and keeps shared anchors valid", () => {
    const f = fixture();
    const dayId = s.snapshot(f.tripId, actor).days[1].id;
    const split = s.createItem(dayId, actor, {
      title: "共同出发",
      lat: 23,
      lng: 113,
    }).id;
    const join = s.createItem(dayId, actor, {
      title: "集合",
      lat: 23,
      lng: 113,
    }).id;
    const branches = [
      {
        id: crypto.randomUUID(),
        title: "同行组",
        participantIds: f.people.slice(0, 2),
        startMinutes: null,
      },
      {
        id: crypto.randomUUID(),
        title: "独行组",
        participantIds: [f.people[2]],
        startMinutes: null,
      },
    ];
    s.createItem(dayId, actor, {
      title: "分头",
      type: "parallel",
      parallelPlan: {
        splitItemId: split,
        joinItemId: join,
        joinPolicy: "wait_all",
        branches,
      },
    });
    const child = s.createItem(dayId, actor, {
      title: "只给甲的活动",
      branchId: branches[0].id,
      participantIds: [f.people[0]],
      lat: 23,
      lng: 113,
    }).id;
    const day = s.getDay(dayId),
      timeline = calculateTimeline(day, undefined, f.people[1]);
    expect(
      participantDay(day, f.people[1], timeline).items.some(
        (i) => i.id === child,
      ),
    ).toBe(false);
    expect(() =>
      s.editItem(child, actor, {
        expectedVersion: day.items.find((i) => i.id === child)!.version,
        participantIds: [f.people[2]],
      }),
    ).toThrow("本组成员");
    for (const id of [split, join])
      expect(() =>
        s.editItem(id, actor, {
          expectedVersion: day.items.find((i) => i.id === id)!.version,
          participantIds: [f.people[0]],
        }),
      ).toThrow("该组全部成员");
    const section = day.items.find((i) => i.parallelPlan)!;
    expect(() =>
      s.editItem(section.id, actor, {
        expectedVersion: section.version,
        participantIds: [f.people[0]],
      }),
    ).toThrow("通过分组设置成员");
  });
});
