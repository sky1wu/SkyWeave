import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { itineraryDays } from "@/domain/itinerary";
import { calculateTimeline, calculateTripTimelines } from "@/domain/timeline";
import { parallelTripError, type ParallelPlan } from "@/domain/parallel";
const directory = mkdtempSync(`${tmpdir()}/advanced-parallel-`);
process.env.DATABASE_PATH = `${directory}/test.sqlite`;
const s = await import("@/server/service");
const core = await import("@/server/service-core");
const bulk = await import("@/server/parallel-service");
const files = await import("@/server/trip-file-service");
const { insert, sqlite } = await import("@/server/db");
const actor = {
  id: "advanced-owner",
  name: "甲",
  email: "advanced@example.test",
};
insert("users", { ...actor, createdAt: 0, updatedAt: 0 });
afterAll(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});
function setup() {
  const { id } = s.createTrip(actor, {
    title: "复杂分组",
    startDate: "2026-10-01",
    endDate: "2026-10-04",
  });
  const people = [
    s.snapshot(id, actor).participants[0].id,
    s.createParticipant(id, actor, { name: "乙" }).id,
    s.createParticipant(id, actor, { name: "丙" }).id,
  ];
  const days = () => core.getDays(id),
    dayIds = days().map((d) => d.id);
  const versions = () =>
    days().map((d) => ({ id: d.id, expectedVersion: d.version }));
  const item = (title: string, day = 0, data: Record<string, unknown> = {}) =>
    s.createItem(dayIds[day], actor, { title, lat: 22, lng: 114, ...data }).id;
  const branch = (title: string, people: string[]) => ({
    id: crypto.randomUUID(),
    title,
    participantIds: people,
    startMinutes: null,
  });
  const manual = (minutes = 15) => {
    for (const leg of days().flatMap((d) => d.legs))
      s.editLeg(leg.id, actor, {
        expectedVersion: leg.version,
        mode: "manual",
        manualDurationMinutes: minutes,
      });
  };
  return { id, people, days, dayIds, versions, item, branch, manual };
}
function timing(f: ReturnType<typeof setup>, id: string, person?: string) {
  const day = f.days().find((d) => d.items.some((i) => i.id === id))!;
  return calculateTimeline(day, f.days(), person).entries.find(
    (e) => e.itemId === id,
  )!;
}

describe("advanced parallel plans", () => {
  it("allows nested groups and limits their people to the parent group", () => {
    const f = setup(),
      join = f.item("午餐", 0, { fixedTime: true, startMinutes: 720 }),
      parentMeet = f.item("馆内会合");
    const a = f.branch("游览组", f.people.slice(0, 2)),
      b = f.branch("休息组", [f.people[2]]);
    const outer = s.createItem(f.dayIds[0], actor, {
      title: "上午分头",
      type: "parallel",
      parallelPlan: {
        splitItemId: null,
        joinItemId: join,
        joinPolicy: "wait_all",
        branches: [a, b],
      },
    });
    s.editItem(parentMeet, actor, {
      expectedVersion: f.days()[0].items.find((i) => i.id === parentMeet)!
        .version,
      branchId: a.id,
    });
    const nestedBranches = [
      f.branch("展厅一", [f.people[0]]),
      f.branch("展厅二", [f.people[1]]),
    ];
    s.createItem(f.dayIds[0], actor, {
      title: "馆内分开",
      type: "parallel",
      branchId: a.id,
      parallelPlan: {
        splitItemId: null,
        joinItemId: parentMeet,
        joinPolicy: "wait_all",
        branches: nestedBranches,
      },
    });
    f.item("一厅", 0, { branchId: nestedBranches[0].id });
    f.item("二厅", 0, { branchId: nestedBranches[1].id });
    f.item("咖啡", 0, { branchId: b.id });
    f.manual();
    expect(parallelTripError(f.days(), new Set(f.people))).toBeNull();
    expect(timing(f, parentMeet).rendezvous?.arrivals).toHaveLength(2);
    expect(timing(f, join).start).toBe(720 * 60);
    const root = f.days()[0].items.find((i) => i.id === outer.id)!;
    expect(() =>
      s.editItem(root.id, actor, {
        expectedVersion: root.version,
        branchId: nestedBranches[0].id,
      }),
    ).toThrow("循环");
  });
  it("carries overnight routes into the rendezvous day and round-trips all cross-day references", () => {
    const f = setup(),
      join = f.item("次日酒店", 1, { fixedTime: true, startMinutes: 540 });
    const branches = [
      f.branch("甲组", [f.people[0]]),
      f.branch("乙组", [f.people[1]]),
    ].map((b) => ({ ...b, startMinutes: 1380 }));
    s.createItem(f.dayIds[0], actor, {
      title: "夜间分别出发",
      type: "parallel",
      parallelPlan: {
        splitItemId: null,
        joinItemId: join,
        joinPolicy: "wait_all",
        branches,
      },
    });
    branches.forEach((b, i) => f.item(`出发点${i}`, 0, { branchId: b.id }));
    f.manual(120);
    expect(f.days()[0].legs).toHaveLength(0);
    expect(f.days()[1].legs).toHaveLength(2);
    expect(timing(f, join)).toMatchObject({
      arrival: 60 * 60,
      start: 540 * 60,
    });
    const exported = files.exportTripFile(f.id, actor),
      restored = files.importTripFile(actor, exported);
    const imported = core.getDays(restored.id),
      recovered = imported[1].items.find((i) => i.title === "次日酒店")!;
    expect(
      calculateTripTimelines(imported)
        .get(imported[1].id)!
        .entries.find((e) => e.itemId === recovered.id)?.start,
    ).toBe(540 * 60);
    expect(parallelTripError(imported)).toBeNull();
  });
  it("lets only some groups meet first while another group joins later", () => {
    const f = setup(),
      first = f.item("先会合", 0, { fixedTime: true, startMinutes: 600 }),
      later = f.item("最终会合", 0, { fixedTime: true, startMinutes: 720 });
    const a = f.branch("早到组", [f.people[0]]),
      b = { ...f.branch("晚到组", [f.people[1]]), joinItemId: later };
    s.createItem(f.dayIds[0], actor, {
      title: "分批抵达",
      type: "parallel",
      parallelPlan: {
        splitItemId: null,
        joinItemId: first,
        joinPolicy: "wait_all",
        branches: [a, b],
      },
    });
    f.item("甲出发", 0, { branchId: a.id });
    f.item("乙出发", 0, { branchId: b.id });
    f.manual();
    expect(
      timing(f, first).rendezvous?.arrivals.map((a) => a.branchId),
    ).toEqual([a.id]);
    expect(
      timing(f, first).people?.some((p) => p.participantId === f.people[1]),
    ).toBe(false);
    expect(timing(f, later).rendezvous?.arrivals).toHaveLength(2);
  });
  it("keeps late people's clocks separate after a fixed appointment", () => {
    const f = setup(),
      meet = f.item("十点活动", 0, {
        fixedTime: true,
        startMinutes: 600,
        endMinutes: 615,
      }),
      next = f.item("下一站");
    const branches = [
      { ...f.branch("准时组", [f.people[0]]), startMinutes: 570 },
      { ...f.branch("迟到组", [f.people[1]]), startMinutes: 615 },
    ];
    s.createItem(f.dayIds[0], actor, {
      title: "各自出发",
      type: "parallel",
      parallelPlan: {
        splitItemId: null,
        joinItemId: meet,
        joinPolicy: "fixed",
        branches,
      },
    });
    branches.forEach((b, i) => f.item(`起点${i}`, 0, { branchId: b.id }));
    f.manual(15);
    expect(timing(f, next, f.people[0]).start).toBe(630 * 60);
    expect(timing(f, next, f.people[1]).start).toBe(645 * 60);
    expect(
      f.days()[0].legs.filter((leg) => leg.toItemId === next),
    ).toHaveLength(2);
  });
  it("reroutes a late group directly to a later meeting and skips intermediate activities", () => {
    const f = setup(),
      meet = f.item("十点集合", 0, {
        fixedTime: true,
        startMinutes: 600,
        endMinutes: 630,
      }),
      park = f.item("公园", 0, { stayMinutes: 15 }),
      catchUp = f.item("后续会合点");
    const a = { ...f.branch("准时组", [f.people[0]]), startMinutes: 540 },
      b = {
        ...f.branch("追赶组", [f.people[1]]),
        startMinutes: 630,
        catchUpItemId: catchUp,
      };
    s.createItem(f.dayIds[0], actor, {
      title: "原地集合或追赶",
      type: "parallel",
      parallelPlan: {
        splitItemId: null,
        joinItemId: meet,
        joinPolicy: "fixed",
        branches: [a, b],
      },
    });
    f.item("甲起点", 0, { branchId: a.id });
    const origin = f.item("乙起点", 0, { branchId: b.id });
    f.manual(15);
    const recovery = f
      .days()[0]
      .legs.find((leg) => leg.routeRole === "catch_up")!;
    expect(recovery).toMatchObject({
      fromItemId: origin,
      toItemId: catchUp,
      branchId: b.id,
    });
    s.editLeg(recovery.id, actor, {
      expectedVersion: recovery.version,
      mode: "manual",
      manualDurationMinutes: 60,
    });
    expect(timing(f, meet, f.people[1]).skipped).toBe(true);
    expect(timing(f, park, f.people[1]).skipped).toBe(true);
    const handbook = itineraryDays(
      f.days(),
      s.snapshot(f.id, actor).participants,
      f.people[1],
    );
    expect(handbook[0].stops.find((stop) => stop.id === park)?.timing).toBe(
      "已跳过",
    );
    expect(timing(f, catchUp, f.people[1]).arrival).toBe(690 * 60);
    expect(timing(f, catchUp, f.people[0]).start).toBe(690 * 60);
  });
  it("atomically splits existing items into groups, preserving all state on conflicts", () => {
    const f = setup(),
      start = f.item("酒店"),
      a = f.item("博物馆"),
      b = f.item("咖啡馆"),
      end = f.item("晚餐");
    const branches = [
      f.branch("甲组", [f.people[0]]),
      f.branch("乙组", [f.people[1]]),
    ];
    const assignments = [a, b].map((itemId, i) => ({
      itemId,
      branchId: branches[i].id,
      expectedVersion: f.days()[0].items.find((item) => item.id === itemId)!
        .version,
    }));
    const body = {
      dayId: f.dayIds[0],
      title: "下午分头",
      parallelPlan: {
        splitItemId: start,
        joinItemId: end,
        joinPolicy: "wait_all",
        branches,
      },
      expectedDays: f.versions(),
      assignments,
    };
    const result = bulk.saveParallel(f.id, actor, body);
    expect(f.days()[0].items.find((i) => i.id === a)?.branchId).toBe(
      branches[0].id,
    );
    const before = f.days();
    expect(() => bulk.saveParallel(f.id, actor, body)).toThrow();
    expect(f.days()).toEqual(before);
    expect(f.days()[0].items.some((i) => i.id === result.id)).toBe(true);
  });
  it("copies and moves a complete multi-day section with boundaries and fresh group identities", () => {
    const f = setup(),
      start = f.item("出发酒店"),
      end = f.item("次日集合", 1, { fixedTime: true, startMinutes: 540 });
    const branches = [
      f.branch("甲组", [f.people[0]]),
      f.branch("乙组", [f.people[1]]),
    ];
    const plan: ParallelPlan = {
      splitItemId: start,
      joinItemId: end,
      joinPolicy: "wait_all",
      branches,
    };
    const section = s.createItem(f.dayIds[0], actor, {
      title: "跨日行动段",
      type: "parallel",
      parallelPlan: plan,
    });
    branches.forEach((b, i) => f.item(`途中${i}`, 0, { branchId: b.id }));
    f.manual(30);
    const copied = bulk.transferParallel(f.id, actor, {
      sectionId: section.id,
      operation: "copy",
      targetDayId: f.dayIds[1],
      expectedDays: f.versions(),
    });
    const clone = f.days()[1].items.find((i) => i.id === copied.id)!;
    expect(clone.parallelPlan?.branches[0].id).not.toBe(branches[0].id);
    expect(
      f.days()[2].items.some((i) => i.id === clone.parallelPlan?.joinItemId),
    ).toBe(true);
    expect(
      f
        .days()
        .flatMap((d) => d.legs)
        .filter((l) => l.branchId === clone.parallelPlan?.branches[0].id)
        .every((l) => l.manualDurationMinutes === 30),
    ).toBe(true);
    bulk.transferParallel(f.id, actor, {
      sectionId: section.id,
      operation: "move",
      targetDayId: f.dayIds[2],
      expectedDays: f.versions(),
    });
    expect(f.days()[2].items.some((i) => i.id === section.id)).toBe(true);
    expect(f.days()[3].items.some((i) => i.id === end)).toBe(true);
    expect(parallelTripError(f.days())).toBeNull();
  });
  it("moves linked bills once, copies no bills, and rolls back out-of-range transfers", () => {
    const f = setup(),
      start = f.item("出发酒店"),
      end = f.item("次日集合", 1);
    const branches = [
      f.branch("甲组", [f.people[0]]),
      f.branch("乙组", [f.people[1]]),
    ];
    const section = s.createItem(f.dayIds[0], actor, {
      title: "带账单的行动段",
      type: "parallel",
      parallelPlan: {
        splitItemId: start,
        joinItemId: end,
        joinPolicy: "wait_all",
        branches,
      },
    });
    const child = f.item("已付门票", 0, { branchId: branches[0].id });
    s.saveExpense(f.id, actor, {
      title: "门票",
      category: "ticket",
      amountMinor: 1200,
      currency: "CNY",
      exchangeRateToBase: "1",
      payerParticipantId: f.people[0],
      splitMethod: "equal",
      splitMeta: [{ participantId: f.people[0], value: "1" }],
      incurredAt: 0,
      dayItemId: child,
    });
    bulk.transferParallel(f.id, actor, {
      sectionId: section.id,
      operation: "copy",
      targetDayId: f.dayIds[1],
      expectedDays: f.versions(),
    });
    expect(s.snapshot(f.id, actor).expenses).toHaveLength(1);
    const before = f.days();
    expect(() =>
      bulk.transferParallel(f.id, actor, {
        sectionId: section.id,
        operation: "move",
        targetDayId: f.dayIds[3],
        expectedDays: f.versions(),
      }),
    ).toThrow("日期范围不足");
    expect(f.days()).toEqual(before);
    bulk.transferParallel(f.id, actor, {
      sectionId: section.id,
      operation: "move",
      targetDayId: f.dayIds[2],
      expectedDays: f.versions(),
    });
    expect(s.snapshot(f.id, actor).expenses[0]).toMatchObject({
      dayItemId: child,
      dayId: f.dayIds[2],
      amountMinor: 1200,
    });
  });
  it("rejects unauthorized bulk changes and inconsistent meeting policies", () => {
    const f = setup(),
      join = f.item("集合", 0, { fixedTime: true, startMinutes: 600 });
    const branches = [
      f.branch("甲组", [f.people[0]]),
      { ...f.branch("乙组", [f.people[1]]), joinPolicy: "fixed" },
    ];
    expect(() =>
      s.createItem(f.dayIds[0], actor, {
        title: "冲突规则",
        type: "parallel",
        parallelPlan: {
          splitItemId: null,
          joinItemId: join,
          joinPolicy: "wait_all",
          branches,
        },
      }),
    ).toThrow("一致的集合规则");
    const viewer = {
      id: crypto.randomUUID(),
      name: "只读",
      email: `${crypto.randomUUID()}@example.test`,
    };
    insert("users", { ...viewer, createdAt: 0, updatedAt: 0 });
    insert("trip_members", {
      tripId: f.id,
      userId: viewer.id,
      role: "viewer",
      joinedAt: 0,
    });
    expect(() =>
      bulk.saveParallel(f.id, viewer, {
        dayId: f.dayIds[0],
        title: "未授权",
        parallelPlan: {
          splitItemId: null,
          joinItemId: join,
          joinPolicy: "fixed",
          branches,
        },
        expectedDays: f.versions(),
      }),
    ).toThrow("没有执行");
  });
  it("carries an overnight personal delay into an early appointment on the next day", () => {
    const f = setup(),
      meet = f.item("夜间活动", 0, {
        fixedTime: true,
        startMinutes: 1410,
        endMinutes: 1430,
      }),
      next = f.item("次日凌晨活动", 1, {
        fixedTime: true,
        startMinutes: 60,
        endMinutes: 90,
      });
    const branches = [
      { ...f.branch("准时组", [f.people[0]]), startMinutes: 1350 },
      { ...f.branch("晚到组", [f.people[1]]), startMinutes: 1500 },
    ];
    s.createItem(f.dayIds[0], actor, {
      title: "夜间分组",
      type: "parallel",
      parallelPlan: {
        splitItemId: null,
        joinItemId: meet,
        joinPolicy: "fixed",
        branches,
      },
    });
    branches.forEach((b, i) => f.item(`起点${i}`, 0, { branchId: b.id }));
    f.manual(30);
    expect(timing(f, next, f.people[0]).start).toBe(60 * 60);
    expect(timing(f, next, f.people[1]).start).toBe(90 * 60);
    expect(timing(f, next, f.people[1]).lateMinutes).toBe(30);
  });
  it("rejects scheduling a group item before the section's date without partial writes", () => {
    const f = setup(),
      branches = [
        f.branch("甲组", [f.people[0]]),
        f.branch("乙组", [f.people[1]]),
      ];
    s.createItem(f.dayIds[1], actor, {
      title: "次日行动段",
      type: "parallel",
      parallelPlan: {
        splitItemId: null,
        joinItemId: null,
        joinPolicy: "wait_all",
        branches,
      },
    });
    const before = f.days();
    expect(() =>
      f.item("错误的前一天安排", 0, { branchId: branches[0].id }),
    ).toThrow("不能早于");
    expect(f.days()).toEqual(before);
  });
  it("rolls back whole-day reorders that reverse a cross-day rendezvous", () => {
    const f = setup(),
      end = f.item("次日集合", 1),
      branches = [
        f.branch("甲组", [f.people[0]]),
        f.branch("乙组", [f.people[1]]),
      ];
    s.createItem(f.dayIds[0], actor, {
      title: "跨日段",
      type: "parallel",
      parallelPlan: {
        splitItemId: null,
        joinItemId: end,
        joinPolicy: "wait_all",
        branches,
      },
    });
    const before = f.days(),
      trip = s.getTrip(f.id);
    expect(() =>
      s.reorderDays(f.id, actor, {
        expectedVersion: trip.version,
        dayIds: [f.dayIds[1], f.dayIds[0], f.dayIds[2], f.dayIds[3]],
      }),
    ).toThrow("会破坏分组");
    expect(f.days()).toEqual(before);
    expect(s.getTrip(f.id).version).toBe(trip.version);
    s.reorderDays(f.id, actor, {
      expectedVersion: trip.version,
      dayIds: [f.dayIds[2], f.dayIds[0], f.dayIds[1], f.dayIds[3]],
    });
    expect(parallelTripError(f.days())).toBeNull();
  });
  it("allows another independent section on the same day and copying an unanchored section", () => {
    const f = setup(),
      branches = [
        f.branch("甲组", [f.people[0]]),
        f.branch("乙组", [f.people[1]]),
      ];
    const section = s.createItem(f.dayIds[0], actor, {
      title: "上午独立活动",
      type: "parallel",
      parallelPlan: {
        splitItemId: null,
        joinItemId: null,
        joinPolicy: "wait_all",
        branches,
      },
    });
    const origins = branches.map((b, i) =>
      f.item(`上午${i}`, 0, { branchId: b.id, stayMinutes: 30 }),
    );
    const copy = bulk.transferParallel(f.id, actor, {
      sectionId: section.id,
      operation: "copy",
      targetDayId: f.dayIds[0],
      expectedDays: f.versions(),
    });
    const cloned = f.days()[0].items.find((i) => i.id === copy.id)!;
    s.editItem(cloned.id, actor, {
      expectedVersion: cloned.version,
      parallelPlan: {
        ...cloned.parallelPlan,
        branches: cloned.parallelPlan!.branches.map((b) => ({
          ...b,
          startMinutes: 600,
        })),
      },
    });
    const afternoon = f
      .days()[0]
      .items.filter((i) =>
        cloned.parallelPlan!.branches.some((b) => b.id === i.branchId),
      );
    expect(afternoon).toHaveLength(2);
    expect(timing(f, afternoon[0].id).start).toBe(600 * 60);
    expect(
      f
        .days()[0]
        .legs.some((leg) => origins.some((id) => id === leg.fromItemId)),
    ).toBe(false);
  });
});
