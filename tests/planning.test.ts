import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { nextDayDate, inferPlaceCategory } from "@/domain/planning";
process.env.DATABASE_PATH = `${mkdtempSync(`${tmpdir()}/trip-planning-`)}/test.sqlite`;
const s = await import("@/server/service");
const p = await import("@/server/places");
const { insert } = await import("@/server/db");
const actor = { id: "planner", name: "Planner", email: "planner@example.test" };
insert("users", { ...actor, createdAt: 0, updatedAt: 0 });
function setup() {
  const { id } = s.createTrip(actor, {
    title: "规划",
    startDate: "2026-10-01",
  });
  return s.snapshot(id, actor);
}
describe("day dates and pooled places", () => {
  it("continues from the last dated day across month boundaries and falls back to the trip date", () => {
    expect(
      nextDayDate(
        "2026-10-01",
        [{ date: "2026-12-31", position: 0 }],
        "2026-09-12",
      ),
    ).toBe("2027-01-01");
    expect(
      nextDayDate(
        "2026-10-01",
        [
          { date: null, position: 0 },
          { date: null, position: 1 },
        ],
        "2026-09-12",
      ),
    ).toBe("2026-10-03");
    expect(nextDayDate(null, [{ date: null, position: 0 }], "2026-09-12")).toBe(
      "2026-09-13",
    );
    const snap = setup();
    const day = s.createDay(snap.trip.id, actor, { title: "第2天" });
    expect(s.getDay(day.id).date).toBe("2026-10-02");
    const next = s.createDay(snap.trip.id, actor, {});
    expect(s.getDay(next.id).date).toBe("2026-10-03");
    expect(s.getDay(next.id).title).toBe("第 3 天");
  });
  it("infers common POI categories and preserves custom categories", () => {
    expect(inferPlaceCategory(["050100"])).toBe("餐饮");
    expect(inferPlaceCategory(["110101"])).toBe("景点");
    expect(inferPlaceCategory([], "hotel")).toBe("住宿");
    const snap = setup();
    const created = p.savePoolPlace(snap.trip.id, actor, {
      title: "唱片店",
      placeCategory: "唱片",
      lat: 22,
      lng: 114,
    });
    expect(
      s
        .snapshot(snap.trip.id, actor)
        .poolPlaces.find((x) => x.id === created.id)?.placeCategory,
    ).toBe("唱片");
    expect(s.getDay(snap.days[0].id).items).toHaveLength(0);
  });
  it("deduplicates POI saves and supports repeat scheduling and insertion without consuming the pool", () => {
    const snap = setup(),
      dayId = snap.days[0].id;
    const place = p.savePoolPlace(snap.trip.id, actor, {
      title: "酒店",
      amapPoiId: "B001",
      lat: 22,
      lng: 114,
      placeCategory: "住宿",
    });
    expect(
      p.savePoolPlace(snap.trip.id, actor, {
        title: "酒店",
        amapPoiId: "B001",
        lat: 22,
        lng: 114,
      }),
    ).toEqual({ id: place.id, created: false });
    const existing = s.createItem(dayId, actor, {
      title: "末站",
      lat: 22.1,
      lng: 114.1,
    });
    const first = p.schedulePlace(snap.trip.id, place.id, actor, {
      dayId,
      expectedVersion: 1,
      expectedDayVersion: s.getDay(dayId).version,
      beforeItemId: existing.id,
    });
    expect(s.getDay(dayId).items.map((i) => i.id)).toEqual([
      first.id,
      existing.id,
    ]);
    const other = s.createDay(snap.trip.id, actor, { title: "次日" });
    p.schedulePlace(snap.trip.id, place.id, actor, {
      dayId: other.id,
      expectedVersion: 1,
      expectedDayVersion: 1,
    });
    expect(s.snapshot(snap.trip.id, actor).poolPlaces).toHaveLength(1);
    expect(
      s
        .snapshot(snap.trip.id, actor)
        .days.flatMap((d) => d.items)
        .filter((i) => i.sourcePlaceId === place.id),
    ).toHaveLength(2);
    p.deletePoolPlace(snap.trip.id, place.id, actor, 1);
    expect(s.getDay(dayId).items[0].sourcePlaceId).toBeNull();
    expect(s.getDay(dayId).items[0].placeCategory).toBe("住宿");
  });
  it("rejects stale scheduling and cross-trip targets atomically", () => {
    const snap = setup(),
      second = setup();
    const place = p.savePoolPlace(snap.trip.id, actor, {
      title: "地点",
      lat: 22,
      lng: 114,
    });
    s.createItem(snap.days[0].id, actor, { title: "并发新增" });
    expect(() =>
      p.schedulePlace(snap.trip.id, place.id, actor, {
        dayId: snap.days[0].id,
        expectedVersion: 1,
        expectedDayVersion: 1,
      }),
    ).toThrow();
    expect(() =>
      p.schedulePlace(snap.trip.id, place.id, actor, {
        dayId: second.days[0].id,
        expectedVersion: 1,
        expectedDayVersion: 1,
      }),
    ).toThrow();
    expect(s.getDay(snap.days[0].id).items).toHaveLength(1);
  });
  it("persists pool order, appends new places, and rejects stale or foreign reorders without partial writes", () => {
    const snap = setup();
    for (const title of ["A", "B", "C"])
      p.savePoolPlace(snap.trip.id, actor, { title });
    const places = s.snapshot(snap.trip.id, actor).poolPlaces;
    const request = {
      places: [places[2], places[0], places[1]].map((p) => ({
        id: p.id,
        expectedVersion: p.version,
      })),
    };
    p.reorderPoolPlaces(snap.trip.id, actor, request);
    expect(
      s.snapshot(snap.trip.id, actor).poolPlaces.map((p) => p.title),
    ).toEqual(["C", "A", "B"]);
    expect(() => p.reorderPoolPlaces(snap.trip.id, actor, request)).toThrow();
    const other = setup();
    const foreign = p.savePoolPlace(other.trip.id, actor, {
      title: "外部地点",
    });
    const current = s.snapshot(snap.trip.id, actor).poolPlaces;
    const invalid = {
      places: current.map((p) => ({ id: p.id, expectedVersion: p.version })),
    };
    invalid.places[2].id = foreign.id;
    expect(() => p.reorderPoolPlaces(snap.trip.id, actor, invalid)).toThrow();
    invalid.places[2].id = current[0].id;
    expect(() => p.reorderPoolPlaces(snap.trip.id, actor, invalid)).toThrow();
    expect(s.snapshot(snap.trip.id, actor).poolPlaces).toEqual(current);
    p.savePoolPlace(snap.trip.id, actor, { title: "D" });
    expect(
      s.snapshot(snap.trip.id, actor).poolPlaces.map((p) => p.title),
    ).toEqual(["C", "A", "B", "D"]);
    const viewer = {
      id: "pool-viewer",
      name: "Viewer",
      email: "pool-viewer@example.test",
    };
    insert("users", { ...viewer, createdAt: 0, updatedAt: 0 });
    insert("trip_members", {
      tripId: snap.trip.id,
      userId: viewer.id,
      role: "viewer",
      status: "active",
      joinedAt: 0,
    });
    expect(() =>
      p.reorderPoolPlaces(snap.trip.id, viewer, { places: [] }),
    ).toThrow();
  });
  it("moves items across days with their bills and rebuilds both route chains", () => {
    const snap = setup(),
      day = snap.days[0];
    const a = s.createItem(day.id, actor, { title: "A", lat: 22, lng: 114 }),
      b = s.createItem(day.id, actor, { title: "B", lat: 23, lng: 115 }),
      c = s.createItem(day.id, actor, { title: "C", lat: 24, lng: 116 });
    const next = s.createDay(snap.trip.id, actor, { title: "第二天" }),
      dest = s.createItem(next.id, actor, { title: "D", lat: 25, lng: 117 });
    s.saveExpense(snap.trip.id, actor, {
      title: "门票",
      category: "ticket",
      amountMinor: 1234,
      currency: "CNY",
      exchangeRateToBase: "1",
      payerParticipantId: snap.participants[0].id,
      splitMethod: "equal",
      splitMeta: [{ participantId: snap.participants[0].id, value: "1" }],
      incurredAt: 0,
      dayItemId: b.id,
    });
    p.moveItem(b.id, actor, {
      dayId: next.id,
      beforeItemId: dest.id,
      expectedVersion: 1,
      expectedSourceDayVersion: s.getDay(day.id).version,
      expectedTargetDayVersion: s.getDay(next.id).version,
    });
    expect(s.getDay(day.id).items.map((i) => i.id)).toEqual([a.id, c.id]);
    expect(
      s.getDay(day.id).legs.map((l) => [l.fromItemId, l.toItemId]),
    ).toEqual([[a.id, c.id]]);
    expect(s.getDay(next.id).items.map((i) => i.id)).toEqual([b.id, dest.id]);
    const bill = s.snapshot(snap.trip.id, actor).expenses[0];
    expect(bill.dayId).toBe(next.id);
    expect(bill.dayItemId).toBe(b.id);
    expect(bill.amountMinor).toBe(1234);
  });
  it("does not reset fixed times or custom starts on a partial category/date update", () => {
    const snap = setup(),
      day = snap.days[0];
    const item = s.createItem(day.id, actor, {
      title: "活动",
      type: "event",
      fixedTime: true,
      startMinutes: 720,
      endMinutes: 780,
      stayMinutes: 60,
    });
    s.editItem(item.id, actor, { expectedVersion: 1, placeCategory: "演出" });
    const changed = s.getDay(day.id).items[0];
    expect(changed.fixedTime).toBe(true);
    expect(changed.type).toBe("event");
    expect(changed.stayMinutes).toBe(60);
    s.editDay(day.id, actor, {
      expectedVersion: s.getDay(day.id).version,
      startMinutes: 600,
    });
    s.editDay(day.id, actor, {
      expectedVersion: s.getDay(day.id).version,
      date: "2026-10-05",
    });
    expect(s.getDay(day.id).startMinutes).toBe(600);
  });
  it("migrates existing dates and locations without deleting items or expense links", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys=ON");
    db.exec(readFileSync("drizzle/0000_bouncy_stryfe.sql", "utf8"));
    db.exec(
      "INSERT INTO users(id,name,email,createdAt,updatedAt)VALUES('u','U','u@test',0,0); INSERT INTO trips(id,title,startDate,createdAt,updatedAt,updatedByUserId)VALUES('t','T','2026-10-01',0,0,'u'); INSERT INTO days(id,tripId,title,position,date,createdAt,updatedAt,updatedByUserId)VALUES('d1','t','D1',0,'2026-10-01',0,0,'u'),('d2','t','D2',1,NULL,0,0,'u'); INSERT INTO day_items(id,dayId,type,position,title,lat,lng,amapPoiId,createdAt,updatedAt,updatedByUserId)VALUES('i1','d1','hotel',0,'Hotel',22,114,'B001',0,0,'u'),('i2','d2','hotel',0,'Hotel',22,114,'B001',0,0,'u');",
    );
    db.exec(
      "INSERT INTO trip_participants(id,tripId,name,userId,createdAt,updatedAt,updatedByUserId)VALUES('p','t','U','u',0,0,'u'); INSERT INTO expenses(id,tripId,dayId,dayItemId,title,category,amountMinor,currency,payerParticipantId,exchangeRateToBase,baseAmountMinor,splitMethod,splitMeta,incurredAt,createdByUserId,createdAt,updatedAt,updatedByUserId)VALUES('e','t','d1','i1','Bill','hotel',1234,'CNY','p','1',1234,'equal','[]',0,'u',0,0,'u');",
    );
    db.exec(readFileSync("drizzle/0001_glorious_wild_pack.sql", "utf8"));
    expect(
      db
        .prepare(
          "SELECT dayId,dayItemId,amountMinor FROM expenses WHERE id='e'",
        )
        .get(),
    ).toEqual({ dayId: "d1", dayItemId: "i1", amountMinor: 1234 });
    expect(db.prepare("SELECT date FROM days WHERE id='d2'").get()).toEqual({
      date: "2026-10-02",
    });
    expect(db.prepare("SELECT count(*) n FROM trip_places").get()).toEqual({
      n: 1,
    });
    expect(
      db
        .prepare(
          "SELECT sourcePlaceId,placeCategory FROM day_items WHERE id='i2'",
        )
        .get(),
    ).toEqual({ sourcePlaceId: "pool_i1", placeCategory: "住宿" });
    db.exec(
      "INSERT INTO trip_places(id,tripId,title,createdAt,updatedAt,updatedByUserId)VALUES('pool_new','t','New place',50,50,'u');",
    );
    const priorOrder = db
      .prepare("SELECT id FROM trip_places ORDER BY createdAt,id")
      .all();
    db.exec(readFileSync("drizzle/0002_pool_order.sql", "utf8"));
    expect(
      db.prepare("SELECT id FROM trip_places ORDER BY position").all(),
    ).toEqual(priorOrder);
    expect(
      db.prepare("SELECT position FROM trip_places ORDER BY position").all(),
    ).toEqual([{ position: 0 }, { position: 1 }]);
    db.prepare("DELETE FROM trip_places").run();
    expect(
      db
        .prepare("SELECT count(*) n FROM day_items WHERE sourcePlaceId IS NULL")
        .get(),
    ).toEqual({ n: 2 });
    db.close();
  });
});

it("validates independent transport references and preserves endpoints when their pool source is removed", async () => {
  const snap = setup(),
    foreign = setup();
  const localPlace = p.savePoolPlace(snap.trip.id, actor, {
    title: "深圳北",
    lat: 22.6,
    lng: 114.0,
  });
  const outside = p.savePoolPlace(foreign.trip.id, actor, {
    title: "另一个行程的机场",
  });
  const plan = {
    mode: "train",
    origin: {
      name: "深圳北",
      sourcePlaceId: localPlace.id,
      lat: 22.6,
      lng: 114.0,
    },
    destination: { name: "北京南" },
  };
  expect(() =>
    s.createItem(snap.days[0].id, actor, {
      title: "越权",
      type: "transport",
      transport: {
        ...plan,
        destination: { name: "北京", sourcePlaceId: outside.id },
      },
    }),
  ).toThrow();
  expect(() =>
    s.createItem(snap.days[0].id, actor, {
      title: "错误类型",
      transport: plan,
    }),
  ).toThrow();
  expect(() =>
    s.createItem(snap.days[0].id, actor, {
      title: "半个坐标",
      type: "transport",
      transport: { ...plan, destination: { name: "北京", lat: 39.9 } },
    }),
  ).toThrow();
  const created = s.createItem(snap.days[0].id, actor, {
    title: "待定火车",
    type: "transport",
    transport: plan,
  });
  const item = s
    .getDay(snap.days[0].id)
    .items.find((i) => i.id === created.id)!;
  expect(item.transport).toMatchObject({
    status: "tentative",
    origin: { sourcePlaceId: localPlace.id },
    destination: { name: "北京南", lat: null },
  });
  const { poolPlaceCounts } = await import("@/domain/planning");
  expect(
    poolPlaceCounts(s.snapshot(snap.trip.id, actor).days).get(localPlace.id),
  ).toBe(1);
  p.deletePoolPlace(snap.trip.id, localPlace.id, actor, 1);
  const changed = s.getDay(item.dayId).items.find((i) => i.id === item.id)!;
  expect(changed.transport?.origin).toMatchObject({
    sourcePlaceId: null,
    name: "深圳北",
    lat: 22.6,
    lng: 114.0,
  });
  expect(changed.version).toBeGreaterThan(item.version);
  expect(() =>
    s.editItem(item.id, actor, {
      expectedVersion: item.version,
      notes: "过期修改",
    }),
  ).toThrow();
});
