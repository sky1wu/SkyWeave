import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { calculateTimeline, routeConnections } from "@/domain/timeline";
import { itineraryDays } from "@/domain/itinerary";
import {
  branchItems,
  parallelDayError,
  participantDay,
  type ParallelPlan,
} from "@/domain/parallel";
import { mapLocations } from "@/domain/map-locations";
import type { DayPlan } from "@/domain/types";

const directory = mkdtempSync(`${tmpdir()}/trip-parallel-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
process.env.AMAP_TEST_MODE = "1";
const s = await import("@/server/service");
const places = await import("@/server/places");
const files = await import("@/server/trip-file-service");
const { parseTripFile } = await import("@/server/trip-file-schema");
const { calculateDay } = await import("@/server/routing");
const { insert, sqlite } = await import("@/server/db");
const actor = {
  id: "parallel-owner",
  name: "小王",
  email: "parallel@example.test",
};
insert("users", { ...actor, createdAt: 0, updatedAt: 0 });
afterAll(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

function fixture(
  options: { split?: boolean; join?: boolean; empty?: boolean } = {},
) {
  const trip = s.createTrip(actor, {
    title: "分头出发",
    startDate: "2026-10-01",
    endDate: "2026-10-02",
  });
  const snap = s.snapshot(trip.id, actor),
    dayId = snap.days[0].id;
  const p1 = snap.participants[0].id,
    p2 = s.createParticipant(trip.id, actor, { name: "小张" }).id;
  const split = options.split
    ? s.createItem(dayId, actor, { title: "酒店", lat: 22, lng: 114 }).id
    : null;
  const join =
    options.join === false
      ? null
      : s.createItem(dayId, actor, {
          title: "餐厅集合",
          lat: 22.2,
          lng: 114.2,
          fixedTime: true,
          startMinutes: 600,
        }).id;
  const plan: ParallelPlan = {
    splitItemId: split,
    joinItemId: join,
    joinPolicy: "wait_all",
    branches: [
      {
        id: crypto.randomUUID(),
        title: "火车站组",
        participantIds: [p1],
        startMinutes: 540,
      },
      {
        id: crypto.randomUUID(),
        title: "机场组",
        participantIds: [p2],
        startMinutes: 600,
      },
    ],
  };
  const section = s.createItem(dayId, actor, {
    title: "上午分头行动",
    type: "parallel",
    parallelPlan: plan,
  }).id;
  const children = options.empty
    ? []
    : plan.branches.map(
        (b, i) =>
          s.createItem(dayId, actor, {
            title: i ? "机场" : "火车站",
            lat: 22.01 + i * 0.1,
            lng: 114.01 + i * 0.1,
            branchId: b.id,
          }).id,
      );
  for (const leg of s.getDay(dayId).legs)
    s.editLeg(leg.id, actor, {
      expectedVersion: leg.version,
      mode: "manual",
      manualDurationMinutes: leg.branchId === plan.branches[0].id ? 30 : 15,
    });
  return {
    tripId: trip.id,
    dayId,
    secondDayId: snap.days[1].id,
    plan,
    section,
    split,
    join,
    children,
    p1,
    p2,
    day: () => s.getDay(dayId),
  };
}
function editPlan(
  f: ReturnType<typeof fixture>,
  change: Partial<ParallelPlan>,
) {
  const item = f.day().items.find((i) => i.id === f.section)!;
  s.editItem(item.id, actor, {
    expectedVersion: item.version,
    parallelPlan: { ...item.parallelPlan, ...change },
  });
}
function stop(day: DayPlan, id: string) {
  return calculateTimeline(day).entries.find((e) => e.itemId === id)!;
}

describe("parallel itinerary clocks and routes", () => {
  it("routes independent origins to one shared rendezvous without connecting the groups", () => {
    const f = fixture();
    expect(
      f.day().legs.map((l) => [l.fromItemId, l.toItemId, l.branchId]),
    ).toEqual(f.children.map((id, i) => [id, f.join, f.plan.branches[i].id]));
    const entry = stop(f.day(), f.join!);
    expect(entry).toMatchObject({
      arrival: 615 * 60,
      start: 615 * 60,
      departure: 615 * 60,
    });
    expect(entry.rendezvous?.arrivals).toMatchObject([
      { arrival: 570 * 60, waitMinutes: 45, lateMinutes: 0 },
      { arrival: 615 * 60, waitMinutes: 0, lateMinutes: 15 },
    ]);
    expect(f.day().items.filter((i) => i.id === f.join)).toHaveLength(1);
  });
  it("preserves distinct travel modes for empty branches sharing both endpoints", () => {
    const f = fixture({ split: true, empty: true });
    expect(f.day().legs).toHaveLength(2);
    const [a, b] = f.day().legs;
    expect(a.fromItemId).toBe(b.fromItemId);
    expect(a.toItemId).toBe(b.toItemId);
    s.editLeg(a.id, actor, { expectedVersion: a.version, mode: "walking" });
    expect(f.day().legs.find((l) => l.id === b.id)?.mode).toBe("manual");
  });
  it("supports a common departure and separate destinations with no implicit reunion", () => {
    const f = fixture({ split: true, join: false });
    expect(f.day().legs.map((l) => [l.fromItemId, l.toItemId])).toEqual(
      f.children.map((id) => [f.split, id]),
    );
    expect(stop(f.day(), f.children[0]).start).toBe(570 * 60);
    expect(stop(f.day(), f.children[1]).start).toBe(615 * 60);
  });
  it("keeps a scheduled gathering's planned start and explains group lateness", () => {
    const f = fixture();
    editPlan(f, { joinPolicy: "fixed" });
    const entry = stop(f.day(), f.join!);
    expect(entry).toMatchObject({
      start: 600 * 60,
      departure: 600 * 60,
      arrival: 615 * 60,
    });
    expect(entry.warnings.join()).toContain("机场组预计迟到 15 分钟");
  });
  it("does not treat unknown travel or a missing origin as zero minutes", () => {
    const f = fixture();
    const leg = f.day().legs[1];
    s.editLeg(leg.id, actor, {
      expectedVersion: leg.version,
      manualDurationMinutes: null,
    });
    expect(stop(f.day(), f.join!).arrival).toBeNull();
    expect(stop(f.day(), f.join!).departure).toBeNull();
    expect(
      stop(f.day(), f.join!).rendezvous?.arrivals[0].waitMinutes,
    ).toBeNull();
    expect(
      itineraryDays([f.day()])[0].stops.find((s) => s.id === f.join)?.time,
    ).toBe("集合待确认");
    expect(stop(f.day(), f.join!).warnings.join()).toContain("集合时间待确认");
    const empty = fixture({ empty: true });
    expect(
      stop(empty.day(), empty.join!).rendezvous?.arrivals.every(
        (g) => g.arrival === null,
      ),
    ).toBe(true);
  });
  it("does not invent a successful train connection when a group misses departure", () => {
    const f = fixture();
    const join = f.day().items.find((i) => i.id === f.join)!;
    s.editItem(join.id, actor, {
      expectedVersion: join.version,
      type: "transport",
      endMinutes: 660,
      transport: {
        mode: "train",
        origin: { name: "车站", lat: 22.2, lng: 114.2 },
        destination: { name: "下一城", lat: 23, lng: 115 },
      },
    });
    editPlan(f, { joinPolicy: "fixed" });
    const incoming = f.day().legs;
    for (const l of incoming)
      s.editLeg(l.id, actor, {
        expectedVersion: l.version,
        mode: "manual",
        manualDurationMinutes: l.branchId === f.plan.branches[0].id ? 30 : 15,
      });
    expect(stop(f.day(), f.join!).departure).toBeNull();
    expect(stop(f.day(), f.join!).warnings.join()).toContain("赶不上");
    const unknown = f
      .day()
      .legs.find((l) => l.branchId === f.plan.branches[0].id)!;
    s.editLeg(unknown.id, actor, {
      expectedVersion: unknown.version,
      manualDurationMinutes: null,
    });
    expect(stop(f.day(), f.join!).arrival).toBeNull();
    expect(stop(f.day(), f.join!).departure).toBeNull();
    expect(stop(f.day(), f.join!).warnings.join()).toContain("赶不上");
  });
  it("allows regrouping later in the day and propagates the shared clock", () => {
    const f = fixture();
    const evening = s.createItem(f.dayId, actor, {
      title: "晚餐",
      lat: 22.3,
      lng: 114.3,
      startMinutes: 1080,
      fixedTime: true,
    }).id;
    const next: ParallelPlan = {
      ...f.plan,
      splitItemId: f.join,
      joinItemId: evening,
      branches: f.plan.branches.map((b, i) => ({
        ...b,
        id: crypto.randomUUID(),
        startMinutes: null,
        participantIds: [i ? f.p1 : f.p2],
      })),
    };
    s.createItem(f.dayId, actor, {
      title: "下午自由活动",
      type: "parallel",
      parallelPlan: next,
    });
    for (const l of f
      .day()
      .legs.filter((l) => next.branches.some((b) => b.id === l.branchId)))
      s.editLeg(l.id, actor, {
        expectedVersion: l.version,
        mode: "manual",
        manualDurationMinutes: 60,
      });
    const timeline = calculateTimeline(f.day());
    for (const l of f.day().legs.filter((l) => l.fromItemId === f.join))
      expect(timeline.departures[l.id]).toBe(615 * 60);
    expect(stop(f.day(), evening).start).toBe(1080 * 60);
    expect(parallelDayError(f.day().items)).toBeNull();
  });
  it("checks overlaps for the same people without flagging concurrent separate groups", () => {
    const f = fixture();
    for (const id of f.children) {
      const item = f.day().items.find((i) => i.id === id)!;
      s.editItem(id, actor, {
        expectedVersion: item.version,
        fixedTime: true,
        startMinutes: 540,
        endMinutes: 570,
      });
    }
    for (const id of f.children)
      expect(stop(f.day(), id).warnings.join()).not.toContain("时间重叠");
    const shared = s.createItem(f.dayId, actor, {
      title: "共同早餐",
      fixedTime: true,
      startMinutes: 550,
      endMinutes: 565,
    }).id;
    expect(stop(f.day(), shared).warnings.join()).toContain("时间重叠");
    expect(stop(f.day(), f.children[0]).warnings.join()).toContain("共同早餐");
  });
  it("includes shared note time before splitting instead of rewinding to the departure place", () => {
    const f = fixture({ split: true, empty: true });
    const note = s.createItem(f.dayId, actor, {
      title: "整理行李",
      type: "note",
      stayMinutes: 120,
    }).id;
    const day = f.day();
    s.reorder(f.dayId, actor, {
      expectedVersion: day.version,
      itemIds: [f.split!, note, f.section, f.join!],
    });
    const result = calculateTimeline(f.day());
    expect(result.departures[f.day().legs[0].id]).toBe(600 * 60);
  });
  it("keeps shared note duration before a rendezvous without rewinding the shared clock", () => {
    const f = fixture();
    const note = s.createItem(f.dayId, actor, {
      title: "等位取号",
      type: "note",
      stayMinutes: 30,
    }).id;
    const day = f.day();
    s.reorder(f.dayId, actor, {
      expectedVersion: day.version,
      itemIds: [f.section, note, f.join!, ...f.children],
    });
    expect(stop(f.day(), note).departure).toBe(645 * 60);
    expect(stop(f.day(), f.join!).start).toBe(645 * 60);
  });
  it("calculates every branch's routes, including multiple incoming routes", async () => {
    const f = fixture({ split: true, empty: true });
    for (const l of f.day().legs)
      s.editLeg(l.id, actor, { expectedVersion: l.version, mode: "walking" });
    await calculateDay(f.dayId, actor);
    expect(
      f
        .day()
        .legs.every((l) => l.selectedAlternativeId && l.status === "ready"),
    ).toBe(true);
  });
});

it("preserves an unanchored section's position when editing its settings", () => {
  const f = fixture({ join: false, empty: true });
  s.createItem(f.dayId, actor, { title: "之后的共同安排" });
  const before = f.day().items.map((i) => i.id);
  editPlan(f, {
    branches: f.plan.branches.map((b) => ({ ...b, title: b.title + "改名" })),
  });
  expect(f.day().items.map((i) => i.id)).toEqual(before);
});

describe("parallel editing and portable projections", () => {
  it("rejects overlapping people, foreign members, orphan branches and nested groups atomically", () => {
    const f = fixture();
    const before = f.day();
    expect(() =>
      editPlan(f, {
        branches: f.plan.branches.map((b) => ({
          ...b,
          participantIds: [f.p1],
        })),
      }),
    ).toThrow("只能加入一组");
    expect(() =>
      editPlan(f, {
        branches: f.plan.branches.map((b, i) =>
          i ? { ...b, participantIds: ["foreign"] } : b,
        ),
      }),
    ).toThrow("不属于此行程");
    expect(() =>
      s.createItem(f.dayId, actor, { title: "错误归属", branchId: "missing" }),
    ).toThrow("分组不存在");
    expect(() =>
      s.createItem(f.dayId, actor, {
        title: "嵌套",
        type: "parallel",
        branchId: f.plan.branches[0].id,
        parallelPlan: f.plan,
      }),
    ).toThrow();
    expect(f.day()).toEqual(before);
  });
  it("guards nonempty deletion, participant deletion and anchor changes", () => {
    const f = fixture();
    const section = f.day().items.find((i) => i.id === f.section)!;
    expect(() => s.deleteItem(section.id, actor, section.version)).toThrow(
      "仍有组内事项",
    );
    expect(() => s.deleteParticipant(f.tripId, f.p2, actor, 1)).toThrow(
      "已有分组安排",
    );
    const before = f.day();
    expect(() =>
      s.deleteItem(
        f.join!,
        actor,
        before.items.find((i) => i.id === f.join)!.version,
      ),
    ).toThrow("集合点");
    expect(f.day()).toEqual(before);
    editPlan(f, { joinItemId: null });
    expect(() =>
      s.editItem(section.id, actor, {
        expectedVersion: section.version,
        title: "过期编辑",
      }),
    ).toThrow();
  });
  it("moves items between branches and across days without retaining invalid branch membership", () => {
    const f = fixture();
    let item = f.day().items.find((i) => i.id === f.children[0])!;
    s.editItem(item.id, actor, {
      expectedVersion: item.version,
      branchId: f.plan.branches[1].id,
    });
    expect(branchItems(f.day(), f.plan.branches[0].id)).toHaveLength(0);
    item = f.day().items.find((i) => i.id === item.id)!;
    places.moveItem(item.id, actor, {
      dayId: f.secondDayId,
      expectedVersion: item.version,
      expectedSourceDayVersion: f.day().version,
      expectedTargetDayVersion: s.getDay(f.secondDayId).version,
    });
    expect(s.getDay(f.secondDayId).items[0].branchId).toBeNull();
    expect(routeConnections(f.day().items).length).toBe(f.day().legs.length);
  });
  it("schedules pooled places into a branch and protects viewer writes", () => {
    const f = fixture();
    const place = places.savePoolPlace(f.tripId, actor, {
      title: "博物馆",
      lat: 22.4,
      lng: 114.4,
    });
    const added = places.schedulePlace(f.tripId, place.id, actor, {
      dayId: f.dayId,
      branchId: f.plan.branches[0].id,
      expectedVersion: 1,
      expectedDayVersion: f.day().version,
    });
    expect(branchItems(f.day(), f.plan.branches[0].id).at(-1)?.id).toBe(
      added.id,
    );
    const viewer = {
      id: crypto.randomUUID(),
      name: "viewer",
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
      s.createItem(f.dayId, viewer, {
        title: "禁止编辑",
        branchId: f.plan.branches[0].id,
      }),
    ).toThrow("没有执行");
    expect(s.snapshot(f.tripId, viewer, "view").participants).toHaveLength(2);
  });
  it("filters personal maps and handbook entries while keeping the full rendezvous clock", () => {
    const f = fixture();
    const participants = s.snapshot(f.tripId, actor).participants;
    const own = itineraryDays([f.day()], participants, f.p1)[0];
    expect(own.stops.some((s) => s.id === f.children[1])).toBe(false);
    expect(own.stops.find((s) => s.id === f.join)?.time).toBe("10:15");
    expect(own.stops.find((s) => s.id === f.children[0])?.branch?.people).toBe(
      "小王",
    );
    expect(
      mapLocations(participantDay(f.day(), f.p1), [], []).map((p) => p.itemId),
    ).not.toContain(f.children[1]);
    const all = itineraryDays([f.day()])[0];
    expect(
      all.stops.find((s) => s.id === f.children[1])?.connection,
    ).toBeNull();
    expect(
      all.stops.find((s) => s.id === f.join)?.connection?.summary,
    ).toContain("机场组");
  });
  it("round-trips groups, people, shared anchors and per-branch routes with fresh IDs", () => {
    const f = fixture({ split: true });
    const file = files.exportTripFile(f.tripId, actor);
    expect(file.version).toBe(4);
    const imported = files.importTripFile(actor, file);
    const restored = s.snapshot(imported.id, actor);
    const marker = restored.days[0].items.find((i) => i.parallelPlan)!;
    const plan = marker.parallelPlan!;
    expect(marker.id).not.toBe(f.section);
    expect(plan.branches[0].id).not.toBe(f.plan.branches[0].id);
    expect(plan.branches.flatMap((b) => b.participantIds).sort()).toEqual(
      restored.participants.map((p) => p.id).sort(),
    );
    expect(
      parallelDayError(
        restored.days[0].items,
        new Set(restored.participants.map((p) => p.id)),
      ),
    ).toBeNull();
    expect(restored.days[0].legs).toHaveLength(f.day().legs.length);
    expect(stop(restored.days[0], plan.joinItemId!).start).toBe(
      stop(f.day(), f.join!).start,
    );
    expect(() =>
      parseTripFile(files.exportTripFile(imported.id, actor)),
    ).not.toThrow();
  });
  it("accepts legacy files and rejects branch references or route links that cross groups", () => {
    const f = fixture();
    const file = files.exportTripFile(f.tripId, actor);
    const wrong = structuredClone(file);
    wrong.days[0].legs[0].branchId = f.plan.branches[1].id;
    expect(() => parseTripFile(wrong)).toThrow("交通路线不属于");
    const orphan = structuredClone(file);
    orphan.days[0].items.find((i) => i.branchId)!.branchId = "missing";
    expect(() => parseTripFile(orphan)).toThrow("分组不存在");
    const legacy = {
      ...file,
      version: 1,
      days: file.days.map((day) => ({ ...day, items: [], legs: [] })),
    };
    expect(() => files.importTripFile(actor, legacy)).not.toThrow();
  });
});
