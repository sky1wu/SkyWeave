import { it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
process.env.DATABASE_PATH = `${mkdtempSync(`${tmpdir()}/skyweave-calendar-`)}/test.sqlite`;
const s = await import("@/server/service");
const { insert } = await import("@/server/db");
const actor = {
  id: "calendar-owner",
  name: "Calendar",
  email: "calendar@example.test",
};
insert("users", { ...actor, createdAt: 0, updatedAt: 0 });
function setup() {
  const trip = s.createTrip(actor, {
    title: "日历",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
  });
  return s.snapshot(trip.id, actor);
}
it("creates exactly the configured days and preserves their identity while dates shift", () => {
  const snap = setup();
  expect(snap.days.map((d) => [d.title, d.date])).toEqual([
    ["第 1 天", "2026-10-01"],
    ["第 2 天", "2026-10-02"],
    ["第 3 天", "2026-10-03"],
  ]);
  s.createItem(snap.days[1].id, actor, { title: "保留事项" });
  s.editTrip(snap.trip.id, actor, {
    expectedVersion: snap.trip.version,
    startDate: "2026-12-31",
    endDate: "2027-01-03",
  });
  const after = s.snapshot(snap.trip.id, actor);
  expect(after.days).toHaveLength(4);
  expect(after.days.slice(0, 3).map((d) => d.id)).toEqual(
    snap.days.map((d) => d.id),
  );
  expect(after.days[1].date).toBe("2027-01-01");
  expect(after.days[1].items[0].title).toBe("保留事项");
  expect(() =>
    s.editDay(after.days[0].id, actor, {
      expectedVersion: after.days[0].version,
      title: "自定义名称",
    }),
  ).toThrow();
  expect(() =>
    s.createTrip(actor, {
      title: "倒序日期",
      startDate: "2026-10-02",
      endDate: "2026-10-01",
    }),
  ).toThrow();
});
it("blocks shrinking populated days and day-only bills atomically", () => {
  const snap = setup(),
    last = snap.days[2];
  const item = s.createItem(last.id, actor, { title: "最后一天" });
  const before = s.snapshot(snap.trip.id, actor);
  expect(() =>
    s.editTrip(snap.trip.id, actor, {
      expectedVersion: snap.trip.version,
      endDate: "2026-10-02",
    }),
  ).toThrow("仍有事项或费用");
  expect(s.snapshot(snap.trip.id, actor)).toEqual(before);
  s.deleteItem(item.id, actor, s.getDay(last.id).items[0].version);
  s.saveExpense(snap.trip.id, actor, {
    title: "当天账单",
    category: "other",
    amountMinor: 100,
    currency: "CNY",
    exchangeRateToBase: "1",
    payerParticipantId: snap.participants[0].id,
    splitMethod: "equal",
    splitMeta: [{ participantId: snap.participants[0].id, value: "1" }],
    incurredAt: 0,
    dayId: last.id,
  });
  expect(() =>
    s.editTrip(snap.trip.id, actor, {
      expectedVersion: snap.trip.version,
      endDate: "2026-10-02",
    }),
  ).toThrow("仍有事项或费用");
  const empty = setup();
  s.editTrip(empty.trip.id, actor, {
    expectedVersion: empty.trip.version,
    endDate: "2026-10-01",
  });
  expect(s.snapshot(empty.trip.id, actor).days.map((d) => d.id)).toEqual([
    empty.days[0].id,
  ]);
});
it("moves whole days, redates them, and rejects stale, duplicate, foreign and unauthorized orders", () => {
  const snap = setup();
  s.createItem(snap.days[2].id, actor, { title: "随整天移动" });
  s.saveExpense(snap.trip.id, actor, {
    title: "随日期移动的账单",
    category: "other",
    amountMinor: 100,
    currency: "CNY",
    exchangeRateToBase: "1",
    payerParticipantId: snap.participants[0].id,
    splitMethod: "equal",
    splitMeta: [{ participantId: snap.participants[0].id, value: "1" }],
    incurredAt: 0,
    dayId: snap.days[2].id,
  });
  const order = [snap.days[2].id, snap.days[0].id, snap.days[1].id];
  s.reorderDays(snap.trip.id, actor, {
    expectedVersion: snap.trip.version,
    dayIds: order,
  });
  const after = s.snapshot(snap.trip.id, actor);
  expect(after.days.map((d) => d.id)).toEqual(order);
  expect(after.days[0]).toMatchObject({ title: "第 1 天", date: "2026-10-01" });
  expect(after.days[0].items[0].title).toBe("随整天移动");
  expect(after.expenses[0].dayId).toBe(after.days[0].id);
  expect(after.days[0].version).toBeGreaterThan(snap.days[2].version);
  expect(() =>
    s.reorderDays(snap.trip.id, actor, {
      expectedVersion: snap.trip.version,
      dayIds: order,
    }),
  ).toThrow();
  expect(() =>
    s.reorderDays(snap.trip.id, actor, {
      expectedVersion: after.trip.version,
      dayIds: [order[0], order[0], order[1]],
    }),
  ).toThrow();
  const other = setup();
  expect(() =>
    s.reorderDays(snap.trip.id, actor, {
      expectedVersion: after.trip.version,
      dayIds: [order[0], order[1], other.days[0].id],
    }),
  ).toThrow();
  const viewer = {
    id: "calendar-viewer",
    name: "Viewer",
    email: "calendar-viewer@example.test",
  };
  insert("users", { ...viewer, createdAt: 0, updatedAt: 0 });
  insert("trip_members", {
    tripId: snap.trip.id,
    userId: viewer.id,
    role: "viewer",
    joinedAt: 0,
  });
  expect(() =>
    s.reorderDays(snap.trip.id, viewer, {
      expectedVersion: after.trip.version,
      dayIds: order,
    }),
  ).toThrow();
  expect(s.snapshot(snap.trip.id, actor).days).toEqual(after.days);
});
it("migrates old calendars by filling missing days without discarding old content", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const name of [
    "0000_bouncy_stryfe",
    "0001_glorious_wild_pack",
    "0002_pool_order",
    "0003_independent_transport",
  ])
    db.exec(readFileSync(`drizzle/${name}.sql`, "utf8"));
  db.exec(
    "INSERT INTO users(id,name,email,createdAt,updatedAt) VALUES('u','U','u@test',0,0); INSERT INTO trips(id,title,startDate,endDate,createdAt,updatedAt,updatedByUserId)VALUES('t','T','2026-10-01','2026-10-04',0,0,'u'); INSERT INTO days(id,tripId,title,date,position,createdAt,updatedAt,updatedByUserId)VALUES('d1','t','旧名称','2026-10-01',0,0,0,'u'),('d2','t','第二日',NULL,1,0,0,'u'); INSERT INTO day_items(id,dayId,type,position,title,createdAt,updatedAt,updatedByUserId)VALUES('i','d2','note',0,'保留内容',0,0,'u');",
  );
  db.exec(
    "INSERT INTO trips(id,title,startDate,endDate,createdAt,updatedAt,updatedByUserId)VALUES('short','Short','2026-11-01','2026-11-01',0,0,'u'); INSERT INTO days(id,tripId,title,position,createdAt,updatedAt,updatedByUserId)VALUES('s1','short','A',0,0,0,'u'),('s2','short','B',1,0,0,'u');",
  );
  db.exec(readFileSync("drizzle/0004_trip_calendar.sql", "utf8"));
  const days = db
    .prepare(
      "SELECT id,title,date FROM days WHERE tripId='t' ORDER BY position",
    )
    .all() as { id: string; title: string; date: string }[];
  expect(days).toHaveLength(4);
  expect(days.slice(0, 2).map((d) => d.id)).toEqual(["d1", "d2"]);
  expect(days.map((d) => d.date)).toEqual([
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
  ]);
  expect(days[1].title).toBe("第 2 天");
  expect(
    db.prepare("SELECT endDate FROM trips WHERE id='short'").get(),
  ).toEqual({ endDate: "2026-11-02" });
  expect(
    db
      .prepare("SELECT id FROM days WHERE tripId='short' ORDER BY position")
      .all(),
  ).toEqual([{ id: "s1" }, { id: "s2" }]);
  expect(
    db.prepare("SELECT dayId,title FROM day_items WHERE id='i'").get(),
  ).toEqual({ dayId: "d2", title: "保留内容" });
  expect(db.pragma("foreign_key_check")).toEqual([]);
  db.close();
});
