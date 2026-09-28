import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { compilePlan } from "@/domain/plan-graph";
import { calculateTripTimelines } from "@/domain/timeline";
import { contextualDays, participantDay } from "@/domain/parallel";
import { itemAttendance } from "@/domain/item-participants";
import { itineraryDays } from "@/domain/itinerary";
import { mapLocations } from "@/domain/map-locations";
import { itemPayload } from "@/components/item-editor";

const directory = mkdtempSync(`${tmpdir()}/participation-bounds-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
const s = await import("@/server/service");
const core = await import("@/server/service-core");
const bounds = await import("@/server/participation-service");
const bulk = await import("@/server/parallel-service");
const files = await import("@/server/trip-file-service");
const { parseTripFile } = await import("@/server/trip-file-schema");
const { insert, sqlite } = await import("@/server/db");
const actor = {
  id: "bounds-owner",
  name: "全程成员",
  email: "bounds@example.test",
};
insert("users", { ...actor, createdAt: 0, updatedAt: 0 });
afterAll(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const trip = s.createTrip(actor, {
    title: "个人参与范围",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
  });
  const initial = s.snapshot(trip.id, actor);
  const guest = s.createParticipant(trip.id, actor, { name: "中途成员" }).id;
  const dayIds = initial.days.map((day) => day.id),
    owner = initial.participants[0].id;
  const add = (title: string, day: number, fields = {}) =>
    s.createItem(dayIds[day], actor, {
      title,
      lat: 22,
      lng: 114,
      stayMinutes: 10,
      ...fields,
    }).id;
  const before = add("第一天", 0),
    morning = add("加入前", 1),
    join = add("加入地点", 1),
    middle = add("一起游玩", 1),
    leave = add("离开地点", 1),
    after = add("离开后", 1),
    last = add("第三天", 2);
  const days = () => core.getDays(trip.id);
  const expectedDays = () =>
    days().map((day) => ({ id: day.id, expectedVersion: day.version }));
  const set = (
    data: { joinItemId?: string | null; leaveItemId?: string | null },
    person: string = guest,
  ) =>
    bounds.setParticipation(trip.id, actor, {
      participantId: person,
      ...data,
      expectedDays: expectedDays(),
    });
  return {
    tripId: trip.id,
    dayIds,
    owner,
    guest,
    before,
    morning,
    join,
    middle,
    leave,
    after,
    last,
    days,
    expectedDays,
    set,
    add,
  };
}

describe("participation boundaries", () => {
  it("includes both boundaries and excludes earlier/later items, routes, map markers and exported stops", () => {
    const f = fixture(),
      original = compilePlan(f.days()).connections.map((c) => [
        c.from.id,
        c.to.id,
      ]);
    f.set({ joinItemId: f.join, leaveItemId: f.leave });
    const days = f.days(),
      graph = compilePlan(days),
      times = calculateTripTimelines(days, f.guest);
    expect(graph.paths.get(f.guest)!.map((step) => step.itemId)).toEqual([
      f.join,
      f.middle,
      f.leave,
    ]);
    expect(graph.connections.map((c) => [c.from.id, c.to.id])).toEqual(
      original,
    );
    const own = contextualDays(days).map((day) =>
      participantDay(day, f.guest, times.get(day.id)),
    );
    expect(own.map((day) => day.items.map((i) => i.id))).toEqual([
      [],
      [f.join, f.middle, f.leave],
      [],
    ]);
    expect(own[1].legs.map((l) => [l.fromItemId, l.toItemId])).toEqual([
      [f.join, f.middle],
      [f.middle, f.leave],
    ]);
    expect(mapLocations(own[1], [], own).map((p) => p.itemId)).toEqual([
      f.join,
      f.middle,
      f.leave,
    ]);
    const participants = s.snapshot(f.tripId, actor).participants;
    const book = itineraryDays(days, participants, f.guest);
    expect(book.flatMap((day) => day.stops.map((stop) => stop.id))).toEqual([
      f.join,
      f.middle,
      f.leave,
    ]);
    expect(
      book[1].stops.at(-1)?.details.some((d) => d.text.includes("结束后离开")),
    ).toBe(true);
    expect(itemAttendance(days, participants).get(f.before)).toEqual([f.owner]);
    expect(itemAttendance(days, participants).get(f.after)).toEqual([f.owner]);
    expect(itemAttendance(days, participants).get(f.middle)).toEqual([
      f.owner,
      f.guest,
    ]);
    expect(times.get(f.dayIds[2])?.participationEnd?.itemId).toBe(f.leave);
  });

  it("supports only one item, replacing points and clearing each restriction independently", () => {
    const f = fixture();
    f.set({ joinItemId: f.middle, leaveItemId: f.middle });
    expect(
      compilePlan(f.days())
        .paths.get(f.guest)!
        .map((s) => s.itemId),
    ).toEqual([f.middle]);
    f.set({ joinItemId: f.join });
    expect(
      f.days()[1].items.find((i) => i.id === f.middle)?.joinParticipantIds,
    ).toBeNull();
    f.set({ leaveItemId: null });
    expect(compilePlan(f.days()).paths.get(f.guest)!.at(-1)?.itemId).toBe(
      f.last,
    );
    f.set({ joinItemId: null });
    const final = f.days();
    expect(
      final
        .flatMap((d) => d.items)
        .some(
          (i) => i.joinParticipantIds?.length || i.leaveParticipantIds?.length,
        ),
    ).toBe(false);
    expect(
      participantDay(
        final[0],
        f.guest,
        calculateTripTimelines(final, f.guest).get(f.dayIds[0]),
      ).items,
    ).toHaveLength(1);
  });

  it("rejects reversed or foreign bounds and stale writes atomically", () => {
    const f = fixture(),
      original = f.days();
    expect(() => f.set({ joinItemId: f.leave, leaveItemId: f.join })).toThrow(
      "离开点不能早于加入点",
    );
    expect(f.days()).toEqual(original);
    const foreign = fixture();
    expect(() => f.set({ joinItemId: foreign.join })).toThrow("不属于此行程");
    expect(() => f.set({ joinItemId: f.join }, foreign.guest)).toThrow(
      "不属于此行程",
    );
    const stale = f.expectedDays();
    f.set({ joinItemId: f.join });
    const saved = f.days();
    expect(() =>
      bounds.setParticipation(f.tripId, actor, {
        participantId: f.guest,
        leaveItemId: f.leave,
        expectedDays: stale,
      }),
    ).toThrow("已被其他成员修改");
    expect(f.days()).toEqual(saved);
    expect(() =>
      bounds.setParticipation(f.tripId, actor, {
        participantId: f.guest,
        leaveItemId: f.leave,
        expectedDays: f.expectedDays().slice(1),
      }),
    ).toThrow("行程日期已变化");
  });

  it("includes a newly joining person at a restricted point and protects endpoint deletion and exclusion", () => {
    const f = fixture();
    const current = f.days()[1].items.find((i) => i.id === f.join)!;
    s.editItem(f.join, actor, {
      expectedVersion: current.version,
      participantIds: [f.owner],
    });
    f.set({ joinItemId: f.join, leaveItemId: f.leave });
    const saved = f.days()[1].items.find((i) => i.id === f.join)!;
    expect(saved.participantIds).toEqual([f.owner, f.guest]);
    expect(() => s.deleteItem(saved.id, actor, saved.version)).toThrow(
      "加入或离开点",
    );
    expect(() =>
      s.editItem(saved.id, actor, {
        expectedVersion: saved.version,
        participantIds: [f.owner],
      }),
    ).toThrow("清除此人的加入或离开点");
    const day = f.days()[1];
    expect(() =>
      s.reorder(day.id, actor, {
        expectedVersion: day.version,
        itemIds: [f.morning, f.leave, f.middle, f.join, f.after],
      }),
    ).toThrow("离开点不能早于加入点");
    expect(f.days()[1]).toEqual(day);
  });

  it("replaces old group joining with direct joining, and a newly selected group join replaces the direct point", () => {
    const f = fixture();
    const plan = {
      splitItemId: null,
      joinItemId: null,
      joinPolicy: "wait_all" as const,
      branches: [
        {
          id: crypto.randomUUID(),
          title: "一组",
          participantIds: [f.owner],
          startMinutes: null,
        },
        {
          id: crypto.randomUUID(),
          title: "二组",
          participantIds: [f.guest],
          startMinutes: null,
          entrants: [{ participantId: f.guest, at: "departure" as const }],
        },
      ],
    };
    const section = s.createItem(f.dayIds[2], actor, {
      type: "parallel",
      title: "第三天分组",
      parallelPlan: plan,
    });
    const origin = f.add("第三天出发地", 2, { branchId: plan.branches[1].id });
    expect(compilePlan(f.days()).admissions.get(f.guest)?.itemId).toBe(origin);
    f.set({ joinItemId: f.join });
    expect(compilePlan(f.days()).admissions.get(f.guest)?.itemId).toBe(f.join);
    expect(
      f.days()[2].items.find((i) => i.id === section.id)?.parallelPlan
        ?.branches[1].entrants,
    ).toEqual([]);
    const marker = f.days()[2].items.find((i) => i.id === section.id)!;
    bulk.saveParallel(f.tripId, actor, {
      dayId: f.dayIds[2],
      sectionId: marker.id,
      expectedVersion: marker.version,
      expectedDays: f.expectedDays(),
      title: marker.title,
      parallelPlan: plan,
    });
    expect(
      f.days()[1].items.find((i) => i.id === f.join)?.joinParticipantIds,
    ).toBeNull();
    expect(compilePlan(f.days()).admissions.get(f.guest)?.itemId).toBe(origin);
    f.set({ joinItemId: null });
    expect(compilePlan(f.days()).admissions.has(f.guest)).toBe(false);
  });

  it("permits leaving within a group before its later rendezvous without making that group wait for the leaver", () => {
    const f = fixture(),
      meet = f.add("以后集合", 2);
    const plan = {
      splitItemId: null,
      joinItemId: meet,
      joinPolicy: "wait_all",
      branches: [
        {
          id: crypto.randomUUID(),
          title: "一组",
          participantIds: [f.owner],
          startMinutes: 600,
        },
        {
          id: crypto.randomUUID(),
          title: "二组",
          participantIds: [f.guest],
          startMinutes: 540,
        },
      ],
    };
    s.createItem(f.dayIds[2], actor, {
      title: "分组",
      type: "parallel",
      parallelPlan: plan,
    });
    const stop = f.add("提前离开的站点", 2, { branchId: plan.branches[1].id });
    f.add("其他组起点", 2, { branchId: plan.branches[0].id });
    f.set({ joinItemId: stop, leaveItemId: stop });
    expect(
      compilePlan(f.days())
        .paths.get(f.guest)!
        .map((s) => s.itemId),
    ).toEqual([stop]);
    const time = calculateTripTimelines(f.days())
      .get(f.dayIds[2])!
      .entries.find((e) => e.itemId === meet)!;
    expect(time.people?.map((p) => p.participantId)).toEqual([f.owner]);
    expect(() => f.set({ joinItemId: stop }, f.owner)).toThrow(
      "不在该事项所属分组",
    );
  });

  it("round-trips boundary markers, leaves copies unbounded and rejects invalid file references", () => {
    const f = fixture();
    f.set({ joinItemId: f.join, leaveItemId: f.leave });
    const source = f.days()[1].items.find((i) => i.id === f.join)!;
    const copied = s.createItem(f.dayIds[2], actor, itemPayload(source));
    expect(
      f.days()[2].items.find((i) => i.id === copied.id)?.joinParticipantIds,
    ).toBeNull();
    const file = files.exportTripFile(f.tripId, actor);
    expect(file.version).toBe(6);
    const restored = s.snapshot(files.importTripFile(actor, file).id, actor);
    const person = restored.participants.find((p) => p.name === "中途成员")!;
    const graph = compilePlan(restored.days);
    expect(
      graph.paths.get(person.id)!.map((s) => graph.byId.get(s.itemId)!.title),
    ).toEqual(["加入地点", "一起游玩", "离开地点"]);
    const bad = structuredClone(file);
    bad.days[0].items[0].joinParticipantIds = ["foreign-person"];
    expect(() => parseTripFile(bad)).toThrow("不属于此行程");
    const duplicate = structuredClone(file);
    duplicate.days[0].items[0].joinParticipantIds = [f.guest];
    expect(() => parseTripFile(duplicate)).toThrow("只能设置一个加入点");
  });

  it("rejects viewers and prevents deleting a participant referenced by boundaries", () => {
    const f = fixture();
    const viewer = {
      id: crypto.randomUUID(),
      name: "只读",
      email: `${crypto.randomUUID()}@example.test`,
    };
    insert("users", { ...viewer, createdAt: 0, updatedAt: 0 });
    insert("trip_members", {
      tripId: f.tripId,
      userId: viewer.id,
      role: "viewer",
      joinedAt: 0,
    });
    expect(() =>
      bounds.setParticipation(f.tripId, viewer, {
        participantId: f.guest,
        joinItemId: f.join,
        expectedDays: f.expectedDays(),
      }),
    ).toThrow("没有执行此操作的权限");
    f.set({ leaveItemId: f.leave });
    const person = s
      .snapshot(f.tripId, actor)
      .participants.find((p) => p.id === f.guest)!;
    expect(() =>
      s.deleteParticipant(f.tripId, person.id, actor, person.version),
    ).toThrow("加入或离开节点");
  });
  it("joins a flexible stop at its existing time without changing the other person's clock", () => {
    const f = fixture();
    const before = calculateTripTimelines(f.days())
      .get(f.dayIds[1])!
      .entries.find((e) => e.itemId === f.join)!;
    f.set({ joinItemId: f.join });
    const after = calculateTripTimelines(f.days())
      .get(f.dayIds[1])!
      .entries.find((e) => e.itemId === f.join)!;
    expect(after.people?.find((p) => p.participantId === f.guest)?.start).toBe(
      before.start,
    );
    expect(after.people?.find((p) => p.participantId === f.owner)?.start).toBe(
      before.start,
    );
  });

  it("keeps boundary identity when moved to a later date and preserves existing expenses", async () => {
    const f = fixture();
    f.set({ joinItemId: f.join, leaveItemId: f.leave });
    s.saveExpense(f.tripId, actor, {
      title: "行程费用",
      dayId: f.dayIds[1],
      dayItemId: f.middle,
      category: "food",
      amountMinor: 1000,
      currency: "CNY",
      exchangeRateToBase: "1",
      incurredAt: 0,
      payerParticipantId: f.owner,
      splitMethod: "equal",
      splitMeta: [
        { participantId: f.owner, value: "1" },
        { participantId: f.guest, value: "1" },
      ],
    });
    const bill = s.snapshot(f.tripId, actor).expenses;
    const days = f.days(),
      leave = days[1].items.find((i) => i.id === f.leave)!;
    const { moveItem } = await import("@/server/places");
    moveItem(leave.id, actor, {
      dayId: days[2].id,
      expectedVersion: leave.version,
      expectedSourceDayVersion: days[1].version,
      expectedTargetDayVersion: days[2].version,
    });
    const next = f.days();
    expect(
      next[2].items.find((i) => i.id === leave.id)?.leaveParticipantIds,
    ).toEqual([f.guest]);
    expect(compilePlan(next).paths.get(f.guest)!.at(-1)?.itemId).toBe(f.leave);
    expect(s.snapshot(f.tripId, actor).expenses).toEqual(bill);
  });
});
